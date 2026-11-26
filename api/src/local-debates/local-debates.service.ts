import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { DuelDebateAnalysisService } from '../arguments/duel-debate-analysis.service';
import { QueueService, M1LocalJobData, M23LocalJobData } from '../queue/queue.service';
import { N8nService } from '../n8n/n8n.service';
import { PostHogService } from '../posthog/posthog.service';
import { ModerationService, SupportedLanguage } from '../moderation/moderation.service';

// Limites de débats mensuels par rôle
const DEBATE_LIMITS = {
  FREE: 10,
  PREMIUM: 50,
  CREATOR: 70,
  BUSINESS: 999,
} as const;

type SubscriptionRole = 'FREE' | 'PREMIUM' | 'CREATOR' | 'BUSINESS';

function getDebateLimitForRole(role: SubscriptionRole): number {
  return DEBATE_LIMITS[role] || DEBATE_LIMITS.FREE;
}

/**
 * Types pour les débats locaux
 */
export interface CreateLocalDebateDto {
  title: string;
  player1Name: string;
  player1Viewpoint: string;
  player2Name: string;
  player2Viewpoint: string;
  privateContext?: string;
  gameMode?: 'COMPETITIVE' | 'EXPLORATORY'; // Mode de jeu
  maxArgumentTime: number; // 30, 60, ou 90 secondes
  player1Timer: number;    // En secondes
  player2Timer: number;    // En secondes
}

export interface AddLocalArgumentDto {
  playerId: 'player1' | 'player2';
  playerName: string;
  rawText: string;
  duration: number; // Durée d'enregistrement en secondes
}

/**
 * Service pour gérer les débats locaux avec pipeline IA
 * Réutilise le pipeline M1→M2→M3 des débats classiques
 */
@Injectable()
export class LocalDebatesService {
  private readonly logger = new Logger(LocalDebatesService.name);

  // n8n is now the default - always enabled
  private readonly useN8nAnalysis: boolean = true;

  constructor(
    private readonly prismaService: PrismaService,
    private readonly duelDebateAnalysisService: DuelDebateAnalysisService,
    private readonly queueService: QueueService,
    private readonly n8nService: N8nService,
    private readonly configService: ConfigService,
    private readonly posthog: PostHogService,
    private readonly moderationService: ModerationService,
  ) {
    this.logger.log(`🚀 LocalDebatesService initialized - n8n analysis enabled`);
  }

  /**
   * Créer un nouveau débat local avec analyse IA initiale
   */
  async createLocalDebate(hostUserId: string, data: CreateLocalDebateDto) {
    try {
      this.logger.log(`🎮 Création débat local pour utilisateur ${hostUserId}`);

      // Vérifier les limites selon le rôle utilisateur
      const user = await this.prismaService.user.findUnique({
        where: { id: hostUserId },
        select: {
          role: true,
          monthlyDebateCount: true,
          monthlyDebateReset: true,
          preferredLanguage: true,
        }
      });

      if (!user) {
        throw new BadRequestException('Utilisateur non trouvé');
      }

      // ✅ MODÉRATION : Vérifier le contenu pour insultes/contenu inapproprié
      const moderationLanguage = (user.preferredLanguage || 'fr') as SupportedLanguage;
      const moderationResult = this.moderationService.validateLocalDebateContent(
        data.title,
        data.player1Viewpoint,
        data.player2Viewpoint,
        moderationLanguage,
      );

      if (!moderationResult.isClean) {
        this.logger.warn(`Profanity detected in local debate creation by user ${hostUserId}: ${moderationResult.allDetectedWords.join(', ')}`);
        throw new BadRequestException({
          error: 'PROFANITY_DETECTED',
          message: 'Le contenu contient des termes inappropriés. Veuillez reformuler.',
          fields: Object.fromEntries(
            Object.entries(moderationResult.fields).map(([key, value]) => [key, value.hasProfanity])
          ),
          detectedInFields: Object.keys(moderationResult.fields).filter(
            (key) => moderationResult.fields[key].hasProfanity
          ),
        });
      }

      // ✅ VALIDATION DES LIMITES SELON LE RÔLE (POUR TOUS LES UTILISATEURS)
      const userRole = (user.role || 'FREE') as SubscriptionRole;
      const debateLimit = getDebateLimitForRole(userRole);

      // Vérifier si 30 jours se sont écoulés depuis le dernier reset
      const now = new Date();
      const resetDate = new Date(user.monthlyDebateReset);
      const daysSinceReset = Math.floor((now.getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24));
      const shouldReset = daysSinceReset >= 30;

      if (shouldReset) {
        // Reset du compteur tous les 30 jours
        await this.prismaService.user.update({
          where: { id: hostUserId },
          data: {
            monthlyDebateCount: 0,
            monthlyDebateReset: now
          }
        });
      } else if (user.monthlyDebateCount >= debateLimit) {
        // Message d'erreur personnalisé selon le rôle
        const nextRole = userRole === 'FREE' ? 'Premium' : userRole === 'PREMIUM' ? 'Creator' : 'Business';
        throw new BadRequestException(
          `Limite de ${debateLimit} débats par mois atteinte pour le plan ${userRole}. ${userRole !== 'BUSINESS' ? `Passez au plan ${nextRole} pour plus de débats !` : ''}`
        );
      }

      // 1. Créer le débat en base
      const localDebate = await this.prismaService.localDebate.create({
        data: {
          title: data.title,
          hostUserId,
          player1Name: data.player1Name,
          player1Viewpoint: data.player1Viewpoint,
          player2Name: data.player2Name,
          player2Viewpoint: data.player2Viewpoint,
          privateContext: data.privateContext,
          gameMode: data.gameMode || 'COMPETITIVE',
          maxArgumentTime: data.maxArgumentTime,
          player1Timer: data.player1Timer,
          player2Timer: data.player2Timer,
          currentTurn: 'player1',
          status: 'active',
        },
        include: {
          hostUser: {
            select: { id: true, username: true }
          },
          arguments: true
        }
      });

      // ✅ Incrémenter le compteur mensuel pour TOUS les utilisateurs
      await this.prismaService.user.update({
        where: { id: hostUserId },
        data: {
          monthlyDebateCount: { increment: 1 }
        }
      });

      // Track debate participation in PostHog (local debate)
      this.posthog.trackDebateParticipated(hostUserId, localDebate.id, 'local', 'creator');

      // 2. Lancer l'analyse IA du cadrage en arrière-plan
      this.analyzeDebateFraming(localDebate.id, data, user.preferredLanguage || 'en')
        .catch(error => {
          this.logger.warn(`⚠️ Analyse cadrage échouée pour débat ${localDebate.id}:`, error.message);
        });

      this.logger.log(`✅ Débat local créé: ${localDebate.id}`);
      return localDebate;

    } catch (error) {
      this.logger.error(`❌ Erreur création débat local:`, error);
      throw error;
    }
  }

  /**
   * Analyser le cadrage du débat avec l'IA
   * Utilise n8n si activé, sinon fallback sur le service legacy
   */
  private async analyzeDebateFraming(localDebateId: string, data: CreateLocalDebateDto, language: string = 'en') {
    try {
      if (this.useN8nAnalysis) {
        // Utiliser n8n pour l'analyse M0
        this.logger.log(`🚀 Using n8n M0 analysis for local debate ${localDebateId} with gameMode ${data.gameMode || 'COMPETITIVE'}`);
        await this.n8nService.callStartLocalDebate(
          localDebateId,
          data.title,
          data.player1Viewpoint,
          data.player2Viewpoint,
          (data.gameMode as 'COMPETITIVE' | 'EXPLORATORY') || 'COMPETITIVE',
          language,
        );
        this.logger.log(`✅ n8n M0 analysis completed for local debate ${localDebateId}`);
      } else {
        // Fallback: Utiliser le service d'analyse legacy
        this.logger.log(`📋 Using legacy analysis for local debate ${localDebateId}`);
        const analysisResult = await this.duelDebateAnalysisService.analyzeDebateForDuel(
          localDebateId,
          data.title,
          data.player1Viewpoint,
          data.player2Viewpoint
        );

        // Sauvegarder les résultats legacy
        await this.prismaService.localDebate.update({
          where: { id: localDebateId },
          data: {
            contextPhrase: analysisResult.contextPhrase,
            tone: analysisResult.tone,
            reliabilityCoef: analysisResult.reliabilityCoef,
            impactCoef: analysisResult.impactCoef,
            topicCategory: analysisResult.topicCategory,
            topicId: analysisResult.topicId,
            moderationStatus: analysisResult.moderationStatus,
          }
        });
      }

    } catch (error) {
      this.logger.error(`❌ Erreur analyse cadrage débat ${localDebateId}:`, error);
      throw error;
    }
  }

  /**
   * Ajouter un argument au débat local
   */
  async addLocalArgument(localDebateId: string, data: AddLocalArgumentDto) {
    try {
      this.logger.log(`📝 Ajout argument débat local ${localDebateId} par ${data.playerId}`);

      // Récupérer le débat pour validation
      const localDebate = await this.prismaService.localDebate.findUnique({
        where: { id: localDebateId },
        include: { arguments: true }
      });

      if (!localDebate) {
        throw new NotFoundException(`Débat local ${localDebateId} non trouvé`);
      }

      if (localDebate.status !== 'active') {
        throw new BadRequestException(`Débat ${localDebateId} terminé`);
      }

      if (localDebate.currentTurn !== data.playerId) {
        throw new BadRequestException(`Ce n'est pas le tour de ${data.playerId}`);
      }

      // Calculer le turnIndex
      const turnIndex = localDebate.arguments.length + 1;

      // Créer l'argument en base
      const localArgument = await this.prismaService.localArgument.create({
        data: {
          localDebateId,
          playerId: data.playerId,
          playerName: data.playerName,
          rawText: data.rawText,
          cleanText: data.rawText, // Sera modifié par M1
          duration: data.duration,
          turnIndex,
          state: 'submitted',
        }
      });

      // Changer le tour au joueur suivant
      const nextTurn = data.playerId === 'player1' ? 'player2' : 'player1';
      await this.prismaService.localDebate.update({
        where: { id: localDebateId },
        data: { currentTurn: nextTurn }
      });

      this.logger.log(`🔄 Tour changé: ${data.playerId} → ${nextTurn}`);

      // Déclencher le pipeline d'analyse M1→M2→M3
      await this.triggerArgumentAnalysisPipeline(localArgument.id, localDebate.hostUserId);

      this.logger.log(`✅ Argument local créé: ${localArgument.id}`);
      return localArgument;

    } catch (error) {
      this.logger.error(`❌ Erreur ajout argument local:`, error);
      throw error;
    }
  }

  /**
   * Déclencher le pipeline d'analyse pour un argument local
   * Utilise n8n si activé et M0 complété, sinon fallback sur les queues legacy
   */
  private async triggerArgumentAnalysisPipeline(localArgumentId: string, hostUserId: string) {
    try {
      this.logger.log(`🚀 Déclenchement pipeline analyse pour argument local ${localArgumentId}`);

      // Récupérer les données nécessaires
      const localArgument = await this.prismaService.localArgument.findUnique({
        where: { id: localArgumentId },
        include: {
          localDebate: {
            include: {
              arguments: true,
              hostUser: {
                select: { preferredLanguage: true }
              }
            }
          }
        }
      });

      if (!localArgument) {
        throw new Error(`Argument local ${localArgumentId} non trouvé`);
      }

      const localDebate = localArgument.localDebate;

      // Check if we should use n8n for this argument
      const shouldUseN8n = this.useN8nAnalysis &&
                           localDebate.n8nM0Completed &&
                           localDebate.n8nBranchCode;

      if (shouldUseN8n) {
        // ===== USE N8N PIPELINE =====
        this.logger.log(`🚀 Using n8n pipeline for LOCAL argument ${localArgumentId}`);

        // Build arguments history for context (use n8nArgumentSummary if available, fallback to cleanText)
        const previousArgs = localDebate.arguments
          .filter(arg => arg.id !== localArgumentId)
          .sort((a, b) => a.turnIndex - b.turnIndex);

        const argumentsHistory = previousArgs
          .map(arg => `[${arg.playerId}] ${arg.n8nArgumentSummary || arg.cleanText}`)
          .join('\n\n');

        const last3Messages = previousArgs
          .slice(-3)
          .map(arg => `[${arg.playerId}] ${arg.n8nArgumentSummary || arg.cleanText}`)
          .join('\n\n');

        // Update state before calling n8n
        await this.prismaService.localArgument.update({
          where: { id: localArgumentId },
          data: { state: 'processing_m1' }
        });

        // Call n8n M1 webhook (synchronous response with M1 results)
        const m1Result = await this.n8nService.callLocalMessageAnalysis(
          localArgumentId,
          localDebate,
          localArgument.rawText,
          localArgument.playerId,
          argumentsHistory,
          last3Messages,
        );

        // Save M1 results immediately
        await this.n8nService.saveLocalM1Result(m1Result);

        this.logger.log(`✅ n8n M1 completed for LOCAL argument ${localArgumentId}, M2-M3 continuing async`);
        // n8n will call /n8n/m3-result when M2-M3 are done

      } else {
        // ===== USE LEGACY QUEUE PIPELINE =====
        this.logger.log(`📋 Using legacy queue pipeline for LOCAL argument ${localArgumentId}`);

        // Adapter les données au format M1LocalJobData
        const m1LocalJobData = {
          localArgumentId: localArgumentId,
          localDebateId: localArgument.localDebateId,
          userId: hostUserId,
          rawText: localArgument.rawText,
          factCheckEnabled: true, // Activer le fact-checking pour les débats locaux
        };

        // Ajouter à la queue M1 Local (reformulation) - utilise le pipeline dédié
        await this.queueService.addM1LocalJob(m1LocalJobData);

        // Mettre à jour l'état
        await this.prismaService.localArgument.update({
          where: { id: localArgumentId },
          data: { state: 'processing_m1' }
        });

        this.logger.log(`✅ Argument local ${localArgumentId} ajouté à la queue M1 legacy`);
      }

    } catch (error) {
      this.logger.error(`❌ Erreur déclenchement pipeline argument ${localArgumentId}:`, error);

      // Marquer comme échoué
      await this.prismaService.localArgument.update({
        where: { id: localArgumentId },
        data: { state: 'failed' }
      });

      throw error;
    }
  }

  /**
   * Récupérer un débat local complet
   */
  async getLocalDebate(localDebateId: string) {
    const localDebate = await this.prismaService.localDebate.findUnique({
      where: { id: localDebateId },
      include: {
        hostUser: {
          select: { id: true, username: true }
        },
        arguments: {
          orderBy: { turnIndex: 'asc' },
          include: {
            moduleResults: true
          }
        }
      }
    });

    if (!localDebate) {
      throw new NotFoundException(`Débat local ${localDebateId} non trouvé`);
    }

    return localDebate;
  }

  /**
   * Mettre à jour un débat local (changement de tour, timers, etc.)
   */
  async updateLocalDebate(localDebateId: string, updates: {
    currentTurn?: 'player1' | 'player2';
    player1Timer?: number;
    player2Timer?: number;
    status?: 'active' | 'completed';
  }) {
    return await this.prismaService.localDebate.update({
      where: { id: localDebateId },
      data: updates
    });
  }

  /**
   * Récupérer les détails d'un argument local
   */
  async getLocalArgumentDetail(localDebateId: string, localArgumentId: string) {
    const localArgument = await this.prismaService.localArgument.findUnique({
      where: { id: localArgumentId },
      include: {
        localDebate: {
          select: {
            id: true,
            title: true,
            player1Name: true,
            player2Name: true,
            player1Viewpoint: true,
            player2Viewpoint: true,
          }
        },
        moduleResults: true
      }
    });

    if (!localArgument) {
      throw new NotFoundException(`Argument local ${localArgumentId} non trouvé`);
    }

    if (localArgument.localDebateId !== localDebateId) {
      throw new NotFoundException(`Argument ${localArgumentId} n'appartient pas au débat ${localDebateId}`);
    }

    // Retourner dans un format compatible avec ArgumentDetailDuel
    // Convertir sourcesData au format attendu par le frontend
    const sources = Array.isArray(localArgument.sourcesData)
      ? (localArgument.sourcesData as Array<{ title?: string; url: string; tier?: number; quality_score?: number; description?: string }>).map((s, idx) => ({
          title: s.title || `Source #${idx + 1}`,
          url: s.url,
          summary: s.description,
          metadata: { tier: s.tier, quality_score: s.quality_score }
        }))
      : [];

    return {
      id: localArgument.id,
      cleanText: localArgument.cleanText,
      rawText: localArgument.rawText,
      scoreTotal: localArgument.scoreTotal,
      reliability: localArgument.reliability,
      impact: localArgument.impact,
      justification: localArgument.justification,
      // Champs n8n pour l'affichage détaillé
      briefJustification: localArgument.n8nBriefJustification,
      strengths: localArgument.n8nStrengths || [],
      weaknesses: localArgument.n8nWeaknesses || [],
      sources: sources,
      sourcesData: localArgument.sourcesData || [],
      turnIndex: localArgument.turnIndex,
      playerId: localArgument.playerId,
      playerName: localArgument.playerName,
      state: localArgument.state,
      moduleResults: localArgument.moduleResults,
      debate: {
        id: localArgument.localDebate.id,
        title: localArgument.localDebate.title,
        hostView: localArgument.localDebate.player1Viewpoint,
        guestView: localArgument.localDebate.player2Viewpoint,
      },
      author: {
        username: localArgument.playerName,
        isCurrentUser: localArgument.playerId === 'player1', // Player1 = utilisateur actuel
      }
    };
  }

  /**
   * Vérifier l'état de traitement des arguments d'un débat local
   * Retourne le nombre d'arguments en cours de traitement et leurs détails
   */
  async getProcessingStatus(localDebateId: string) {
    const localDebate = await this.prismaService.localDebate.findUnique({
      where: { id: localDebateId },
      include: {
        arguments: {
          select: {
            id: true,
            state: true,
            turnIndex: true,
            playerId: true,
            playerName: true,
          }
        }
      }
    });

    if (!localDebate) {
      throw new NotFoundException(`Débat local ${localDebateId} non trouvé`);
    }

    // Filtrer les arguments en cours de traitement
    const processingArguments = localDebate.arguments.filter(arg =>
      arg.state !== 'completed' && arg.state !== 'failed'
    );

    const hasProcessingArguments = processingArguments.length > 0;

    this.logger.log(`📊 Statut débat ${localDebateId}: ${processingArguments.length}/${localDebate.arguments.length} arguments en traitement`);

    return {
      hasProcessingArguments,
      processingCount: processingArguments.length,
      totalArguments: localDebate.arguments.length,
      completedCount: localDebate.arguments.filter(arg => arg.state === 'completed').length,
      failedCount: localDebate.arguments.filter(arg => arg.state === 'failed').length,
      processingArgs: processingArguments.map(arg => ({
        id: arg.id,
        state: arg.state,
        turnIndex: arg.turnIndex,
        playerId: arg.playerId,
        playerName: arg.playerName,
      }))
    };
  }

  /**
   * Terminer un débat local
   */
  async endLocalDebate(localDebateId: string) {
    this.logger.log(`🏁 Fin débat local ${localDebateId}`);

    return await this.prismaService.localDebate.update({
      where: { id: localDebateId },
      data: {
        status: 'completed',
        updatedAt: new Date(),
      }
    });
  }

  /**
   * Récupérer l'historique des débats locaux d'un utilisateur
   */
  async getUserLocalDebates(hostUserId: string, limit: number = 20) {
    return await this.prismaService.localDebate.findMany({
      where: { hostUserId },
      include: {
        arguments: {
          select: {
            id: true,
            playerId: true,
            scoreTotal: true,
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      take: limit
    });
  }

  /**
   * Supprimer un débat local
   */
  async deleteLocalDebate(localDebateId: string) {
    this.logger.log(`🗑️ Suppression débat local ${localDebateId}`);

    return await this.prismaService.localDebate.delete({
      where: { id: localDebateId }
    });
  }

  /**
   * Obtenir les statistiques des débats locaux d'un utilisateur
   */
  async getUserLocalDebatesStats(hostUserId: string) {
    const totalDebates = await this.prismaService.localDebate.count({
      where: { hostUserId }
    });

    const completedDebates = await this.prismaService.localDebate.count({
      where: {
        hostUserId,
        status: 'completed'
      }
    });

    const totalArguments = await this.prismaService.localArgument.count({
      where: {
        localDebate: { hostUserId }
      }
    });

    const avgScoreResult = await this.prismaService.localArgument.aggregate({
      where: {
        localDebate: { hostUserId },
        state: 'completed'
      },
      _avg: {
        scoreTotal: true
      }
    });

    return {
      totalDebates,
      completedDebates,
      activeDebates: totalDebates - completedDebates,
      totalArguments,
      averageScore: Math.round(avgScoreResult._avg.scoreTotal || 0)
    };
  }

  /**
   * Récupérer le récapitulatif complet d'un débat local terminé
   * Format compatible avec RecapA/RecapB du mode en ligne
   */
  async getLocalDebateRecap(localDebateId: string, userId: string) {
    try {
      // Récupérer le débat avec tous les arguments
      const localDebate = await this.prismaService.localDebate.findUnique({
        where: { id: localDebateId },
        include: {
          hostUser: {
            select: {
              id: true,
              username: true,
              avatarUrl: true,
            }
          },
          arguments: {
            orderBy: { turnIndex: 'asc' },
            include: {
              moduleResults: true
            }
          }
        }
      });

      if (!localDebate) {
        throw new Error(`Débat local ${localDebateId} non trouvé`);
      }

      // Vérifier que l'utilisateur est le propriétaire
      if (localDebate.hostUserId !== userId) {
        throw new Error('Vous n\'êtes pas le propriétaire de ce débat local');
      }

      // Séparer les arguments par joueur
      const player1Arguments = localDebate.arguments.filter(arg => arg.playerId === 'player1');
      const player2Arguments = localDebate.arguments.filter(arg => arg.playerId === 'player2');

      // Fonction helper pour calculer les stats d'un joueur
      const calculatePlayerStats = (argList: any[], playerName: string) => {
        if (argList.length === 0) {
          return {
            totalScore: 0,
            bestArgument: null,
            worstArgument: null,
            averageScore: 0,
          };
        }

        const totalScore = argList.reduce((sum, arg) => sum + arg.scoreTotal, 0);
        const sortedByScore = [...argList].sort((a, b) => b.scoreTotal - a.scoreTotal);

        return {
          totalScore,
          bestArgument: sortedByScore[0] ? {
            id: sortedByScore[0].id,
            text: sortedByScore[0].cleanText,
            score: sortedByScore[0].scoreTotal,
            reliability: sortedByScore[0].reliability,
            impact: sortedByScore[0].impact,
            justification: sortedByScore[0].justification || 'Argument bien construit',
            turnIndex: sortedByScore[0].turnIndex,
            sources: sortedByScore[0].sourcesData || []
          } : null,
          worstArgument: sortedByScore[sortedByScore.length - 1] ? {
            id: sortedByScore[sortedByScore.length - 1].id,
            text: sortedByScore[sortedByScore.length - 1].cleanText,
            score: sortedByScore[sortedByScore.length - 1].scoreTotal,
            reliability: sortedByScore[sortedByScore.length - 1].reliability,
            impact: sortedByScore[sortedByScore.length - 1].impact,
            justification: sortedByScore[sortedByScore.length - 1].justification || 'Argument à améliorer',
            turnIndex: sortedByScore[sortedByScore.length - 1].turnIndex,
            sources: sortedByScore[sortedByScore.length - 1].sourcesData || []
          } : null,
          averageScore: Math.round(totalScore / argList.length)
        };
      };

      const player1Stats = calculatePlayerStats(player1Arguments, localDebate.player1Name);
      const player2Stats = calculatePlayerStats(player2Arguments, localDebate.player2Name);

      // Déterminer le gagnant
      let winner: 'host' | 'guest' | 'tie';
      if (player1Stats.totalScore > player2Stats.totalScore) {
        winner = 'host'; // Player1 = host par convention
      } else if (player2Stats.totalScore > player1Stats.totalScore) {
        winner = 'guest'; // Player2 = guest par convention
      } else {
        winner = 'tie';
      }

      // Retourner le format compatible avec RecapA/RecapB
      return {
        debate: {
          id: localDebate.id,
          title: localDebate.title,
          hostView: localDebate.player1Viewpoint,
          guestView: localDebate.player2Viewpoint,
          topic: localDebate.topicId ? {
            id: localDebate.topicId,
            label: localDebate.topicCategory || 'Débat local',
            parentId: null
          } : null,
          isLocal: true // Indicateur pour le frontend
        },
        players: {
          host: {
            username: localDebate.player1Name,
            avatarUrl: null,
            eloChange: 0, // Pas de changement ELO en mode local
            xpGain: 0, // Pas de XP en mode local
            currentElo: 0,
          },
          guest: {
            username: localDebate.player2Name,
            avatarUrl: null,
            eloChange: 0,
            xpGain: 0,
            currentElo: 0,
          }
        },
        stats: {
          host: player1Stats,
          guest: player2Stats
        },
        result: {
          winner,
          hostScore: player1Stats.totalScore,
          guestScore: player2Stats.totalScore
        },
        allArguments: localDebate.arguments.map(arg => ({
          id: arg.id,
          userId: arg.playerId, // On garde playerId comme userId pour compatibilité
          playerName: arg.playerName,
          cleanText: arg.cleanText,
          scoreTotal: arg.scoreTotal,
          reliability: arg.reliability,
          impact: arg.impact,
          justification: arg.justification,
          turnIndex: arg.turnIndex,
          sources: arg.sourcesData || [],
          state: arg.state,
          isArgument: arg.isArgument,
        }))
      };

    } catch (error) {
      this.logger.error(`❌ Erreur récupération récap débat local ${localDebateId}:`, error);
      throw error;
    }
  }
}