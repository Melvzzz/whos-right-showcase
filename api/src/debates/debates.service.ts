import { Injectable, BadRequestException, NotFoundException, Inject, forwardRef, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDebateDto } from './dto/create-debate.dto';
import { CreatePrivateDebateDto } from './dto/create-private-debate.dto';
import { SocketGateway } from '../gateways/socket.gateway';
import { TimerService } from '../gateways/timer.service';
import { DuelDebateAnalysisService } from '../arguments/duel-debate-analysis.service';
import { ScoringService } from '../scoring/scoring.service';
import { N8nService } from '../n8n/n8n.service';
import { PostHogService } from '../posthog/posthog.service';
import { ModerationService, SupportedLanguage } from '../moderation/moderation.service';
import { BotPlayerService } from '../bots/bot-player.service';
import { NotificationService } from '../notifications/notification.service';

// Limites de débats mensuels par rôle
const DEBATE_LIMITS = {
  FREE: 10,
  PREMIUM: 50,
  CREATOR: 70,
  BUSINESS: 999,
} as const;

// Limites de débats asynchrones simultanés par rôle
const ASYNC_DEBATE_LIMITS = {
  FREE: 3,
  PREMIUM: 15,
  CREATOR: 30,
  BUSINESS: 30,
} as const;

// Limite d'analyses d'arguments gratuites par debate (FREE uniquement)
const FREE_ARGUMENT_VIEW_LIMIT = 3;

type SubscriptionRole = 'FREE' | 'PREMIUM' | 'CREATOR' | 'BUSINESS';

function getDebateLimitForRole(role: SubscriptionRole): number {
  return DEBATE_LIMITS[role] || DEBATE_LIMITS.FREE;
}

@Injectable()
export class DebatesService {
  private readonly logger = new Logger(DebatesService.name);
  private readonly useN8nAnalysis: boolean;

  constructor(
    private prisma: PrismaService,
    private socketGateway: SocketGateway,
    private timerService: TimerService,
    private duelDebateAnalysisService: DuelDebateAnalysisService,
    private scoringService: ScoringService,
    @Inject(forwardRef(() => N8nService))
    private n8nService: N8nService,
    private configService: ConfigService,
    private posthog: PostHogService,
    private moderationService: ModerationService,
    @Inject(forwardRef(() => BotPlayerService))
    private botPlayerService: BotPlayerService,
    private notificationService: NotificationService,
  ) {
    // n8n is now the default - always enabled
    this.useN8nAnalysis = true;
    this.logger.log(`🚀 DebatesService initialized - n8n analysis enabled`);
  }

  /**
   * Crée un nouveau débat
   * @param userId ID de l'utilisateur qui crée le débat (hôte)
   * @param data Données du débat
   * @returns Le débat nouvellement créé
   */
  async create(userId: string, data: CreateDebateDto) {
    // Validation de base
    if (!data.title || !data.hostView) {
      throw new BadRequestException('Le titre et le point de vue de l\'hôte sont obligatoires');
    }

    // ✅ MODÉRATION : Vérifier le contenu pour insultes/contenu inapproprié
    const moderationLanguage = (data.language || 'fr') as SupportedLanguage;
    const moderationResult = this.moderationService.validateDebateContent(
      data.title,
      data.hostView,
      data.guestView,
      moderationLanguage,
    );

    if (!moderationResult.isClean) {
      this.logger.warn(`Profanity detected in debate creation by user ${userId}: ${moderationResult.allDetectedWords.join(', ')}`);
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

    // Vérifier les limites selon le rôle utilisateur
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        preferredLanguage: true,
        role: true,
        monthlyDebateCount: true,
        monthlyDebateReset: true
      }
    });

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    // ✅ VALIDATION DES LIMITES SELON LE RÔLE (POUR TOUS LES UTILISATEURS)
    const userRole = (user.role || 'FREE') as SubscriptionRole;
    const debateLimit = getDebateLimitForRole(userRole);

    // Vérifier si 30 jours se sont écoulés depuis le dernier reset (au lieu du mois calendaire)
    const now = new Date();
    const resetDate = new Date(user.monthlyDebateReset);
    const daysSinceReset = Math.floor((now.getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24));
    const shouldReset = daysSinceReset >= 30;

    if (shouldReset) {
      // Reset du compteur tous les 30 jours
      await this.prisma.user.update({
        where: { id: userId },
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

    // ✅ ASYNC : Vérifier les limites de débats asynchrones simultanés
    if (data.isLive === false) {
      await this.checkAsyncDebateLimit(userId);
    }

    // Utiliser la langue fournie ou la langue préférée de l'utilisateur
    const debateLanguage = data.language || user.preferredLanguage || 'fr';

    // Préparation des données pour la création du débat
    const debateData: any = {
      hostId: userId,
      title: data.title,
      hostView: data.hostView,
      guestView: data.guestView || null,
      mode: data.mode || 5, // Par défaut 5 minutes
      gameMode: data.gameMode || 'COMPETITIVE', // Mode de jeu (COMPETITIVE ou EXPLORATORY)
      themes: data.themes || [], // Thèmes sélectionnés
      status: 'waiting', // Statut initial: en attente d'un adversaire
      // ✅ ASYNC : Champs pour débats asynchrones
      isLive: data.isLive !== undefined ? data.isLive : true, // Par défaut: débat live
      maxMessagesPerUser: data.isLive === false && data.maxMessagesPerUser ? data.maxMessagesPerUser : null,
      // ✅ ASYNC : Expiration pour débats async non rejoints (2 jours)
      expiresAt: data.isLive === false ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) : null,
    };

    // ✅ NOUVEAU : Ajouter la langue seulement si le champ existe (gestion migration)
    try {
      // Tester si le champ language est disponible
      const testDebate = await this.prisma.debate.findFirst({
        where: { id: 'test-non-existant' },
        select: { language: true }
      });
      // Si pas d'erreur, ajouter la langue
      debateData.language = debateLanguage;
    } catch (languageFieldError) {
      // Si le champ language n'existe pas encore, ne pas l'inclure
      console.warn('⚠️ Champ language pas encore disponible pour création débat, ignoré temporairement');
    }

    // Création du débat avec les paramètres préparés
    const debate = await this.prisma.debate.create({
      data: debateData,
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
      },
    });

    // Création du timer pour l'hôte
    await this.prisma.debateTimer.create({
      data: {
        debateId: debate.id,
        userId: userId,
        remainingSec: debate.mode * 60, // Conversion mode (minutes) en secondes
      },
    });

    // ✅ Incrémenter le compteur mensuel pour TOUS les utilisateurs
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        monthlyDebateCount: { increment: 1 }
      }
    });

    // ✅ Incrémenter le compteur de la suggestion utilisée (si applicable)
    if (data.suggestionId && data.suggestionType) {
      try {
        if (data.suggestionType === 'evergreen') {
          await this.prisma.debateEvergreen.update({
            where: { id: data.suggestionId },
            data: { totalDebates: { increment: 1 } }
          });
        } else if (data.suggestionType === 'trending') {
          await this.prisma.debateTrending.update({
            where: { id: data.suggestionId },
            data: { totalDebates: { increment: 1 } }
          });
        }
        this.logger.log(`📊 Suggestion ${data.suggestionType}/${data.suggestionId} compteur incrémenté`);
      } catch (error) {
        // Ne pas bloquer la création du débat si la suggestion n'existe pas
        this.logger.warn(`⚠️ Impossible d'incrémenter le compteur de la suggestion: ${error.message}`);
      }
    }

    // Track debate participation in PostHog
    const debateType = debate.isLive ? 'live_duel' : 'async_duel';
    this.posthog.trackDebateParticipated(userId, debate.id, debateType, 'creator');

    // NOTE: n8n M0 sera appelé dans arguments.service.ts quand le premier message est envoyé
    // car on a besoin du guestView qui n'est pas encore connu à la création du débat

    return debate;
  }

  /**
   * ✅ NOUVEAU : Crée un débat privé avec invitation (mode ami)
   * @param userId ID de l'utilisateur qui crée le débat (hôte)
   * @param data Données du débat privé
   * @returns Le débat et l'invitation créés
   */
  async createPrivateDebate(userId: string, data: CreatePrivateDebateDto) {
    // Validation de base
    if (!data.title || !data.hostView) {
      throw new BadRequestException('Le titre et le point de vue de l\'hôte sont obligatoires');
    }

    // ✅ MODÉRATION : Vérifier le contenu pour insultes/contenu inapproprié
    const moderationResult = this.moderationService.validateDebateContent(
      data.title,
      data.hostView,
      undefined, // Pas de guestView pour les débats privés
    );

    if (!moderationResult.isClean) {
      this.logger.warn(`Profanity detected in private debate creation by user ${userId}: ${moderationResult.allDetectedWords.join(', ')}`);
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

    // Vérifier les limites selon le rôle utilisateur (identique à create())
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        preferredLanguage: true,
        role: true,
        monthlyDebateCount: true,
        monthlyDebateReset: true
      }
    });

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
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
      await this.prisma.user.update({
        where: { id: userId },
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

    // Récupérer la langue préférée de l'utilisateur créateur
    let userLanguage = user.preferredLanguage || 'fr';

    // ✅ Déterminer si le débat est async (isLive = false)
    const isLive = data.isLive !== false; // Par défaut: live (true)

    // ✅ Si async, vérifier la limite de débats asynchrones simultanés
    if (!isLive) {
      await this.checkAsyncDebateLimit(userId);
    }

    // Créer le débat privé
    const debate = await this.prisma.debate.create({
      data: {
        hostId: userId,
        title: data.title,
        hostView: data.hostView,
        mode: data.mode || 5,
        gameMode: data.gameMode || 'COMPETITIVE', // Mode de jeu (COMPETITIVE ou EXPLORATORY)
        themes: data.themes || [],
        status: 'waiting',
        isPrivate: true, // ✅ Marquer comme privé
        privateContext: data.privateContext, // ✅ Ajouter le contexte privé
        language: userLanguage,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // ✅ Expire après 48h si non rejoint
        // ✅ Champs async (si isLive = false)
        isLive,
        maxMessagesPerUser: !isLive ? (data.maxMessagesPerUser || 10) : undefined,
        currentTurnUserId: !isLive ? userId : undefined, // ✅ L'hôte commence
        turnNumber: !isLive ? 0 : undefined,
        turnStartedAt: !isLive ? new Date() : undefined,
      },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
      },
    });

    // Créer le timer pour l'hôte (uniquement pour les débats live)
    if (isLive) {
      await this.prisma.debateTimer.create({
        data: {
          debateId: debate.id,
          userId: userId,
          remainingSec: debate.mode * 60,
        },
      });
    }

    // ✅ Incrémenter le compteur mensuel pour TOUS les utilisateurs
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        monthlyDebateCount: { increment: 1 }
      }
    });

    // Créer l'invitation en utilisant le PrismaService directement
    // (pour éviter dépendance circulaire)
    const inviteCode = this.generateInviteCode();
    const appUrl = process.env.APP_URL || 'https://whosright.app';
    const inviteUrl = `${appUrl}/invite/${inviteCode}`;

    const invitation = await this.prisma.debateInvitation.create({
      data: {
        debateId: debate.id,
        inviterUserId: userId,
        inviteCode,
        inviteUrl,
        privateContext: data.privateContext,
        expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000), // ✅ 48h pour les débats privés
      },
    });

    // Mettre à jour le débat avec l'ID de l'invitation
    await this.prisma.debate.update({
      where: { id: debate.id },
      data: { invitationId: invitation.id },
    });

    // Track debate participation in PostHog (friend duel creator)
    this.posthog.trackDebateParticipated(userId, debate.id, 'friend_duel', 'creator');

    // NOTE: n8n M0 sera appelé dans arguments.service.ts quand le premier message est envoyé

    return {
      debate,
      invitation: {
        id: invitation.id,
        inviteCode: invitation.inviteCode,
        inviteUrl: invitation.inviteUrl,
      },
    };
  }

  /**
   * Génère un code d'invitation court et unique
   */
  private generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  /**
   * Récupère tous les débats, avec filtrage optionnel
   * @param filter Options de filtrage (status, includeAll, languages, isLive)
   * @returns Liste des débats
   */
  async findAll(filter: { status?: string; includeAll?: boolean; languages?: string[]; isLive?: boolean } = {}) {
    // Nettoyer les réservations expirées et les débats abandonnés avant de récupérer les débats
    await this.cleanupExpiredReservations();
    await this.cleanupAbandonedDebates();

    // Construction de la query basée sur les filtres
    const where: any = {};

    if (filter.status) {
      where['status'] = filter.status;
    } else if (!filter.includeAll) {
      // Par défaut, on ne montre que les débats "waiting" (pas les réservés, annulés, etc.)
      where['status'] = 'waiting';
    }
    // Si includeAll est true, on ne filtre pas par status

    // ✅ NOUVEAU : Exclure les débats privés de la liste publique
    where['isPrivate'] = false;

    // ✅ NOUVEAU : Filtrage par mode live/async
    if (filter.isLive !== undefined) {
      where['isLive'] = filter.isLive;
    }

    // ✅ NOUVEAU : Filtrage par langues multiples (avec gestion d'erreur pour migration)
    if (filter.languages && filter.languages.length > 0) {
      try {
        // Vérifier si le champ language existe en testant une requête
        await this.prisma.debate.findFirst({
          where: { language: filter.languages[0] },
          select: { id: true }
        });
        // Si pas d'erreur, ajouter le filtre avec "in" pour multi-langues
        where['language'] = { in: filter.languages };
      } catch (languageFieldError) {
        // Si le champ language n'existe pas encore (migration pas appliquée)
        console.warn('⚠️ Champ language pas encore disponible, filtrage par langue désactivé temporairement');
        // Ne pas ajouter le filtre par langue
      }
    }

    // Récupération des débats avec leurs hôtes
    return this.prisma.debate.findMany({
      where,
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
            isBot: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });
  }

  /**
   * Trouve un débat par son ID
   * @param id ID du débat
   * @returns Le débat ou null
   */
  async findOne(id: string) {
    const debate = await this.prisma.debate.findUnique({
      where: { id },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
        arguments: {
          orderBy: {
            turnIndex: 'asc',
          },
          select: {
            id: true,
            userId: true,
            turnIndex: true,
            cleanText: true,
            gifCategory: true,
            createdAt: true,
          },
        },
        timers: true,
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${id} non trouvé`);
    }

    return debate;
  }

  /**
   * ✅ NOUVEAU : Récupère le récapitulatif complet d'un débat terminé
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui demande le récap (pour calculer les rôles)
   * @returns Données complètes de récapitulatif avec stats et arguments
   */
  async getDebateRecap(debateId: string, userId: string) {
    // Récupérer le débat avec tous les arguments et leurs scores
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
        // ✅ TEMPORAIRE : Topic inclus séparément le temps de régénérer Prisma
        arguments: {
          orderBy: {
            turnIndex: 'asc',
          },
          // ✅ SUPPRIMÉ : include: { sources: true } car on utilise maintenant sourcesData JSON
        },
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    // ✅ TEMPORAIRE : Récupérer le topic séparément le temps de régénérer Prisma
    let topic = null;
    if (debate.topicId) {
      topic = await this.prisma.topic.findUnique({
        where: { id: debate.topicId },
        select: {
          id: true,
          label: true,
          parentId: true,
        },
      });
    }

    // Vérifier que l'utilisateur a participé au débat
    if (debate.hostId !== userId && debate.guestId !== userId) {
      throw new BadRequestException('Vous n\'avez pas participé à ce débat');
    }

    // Séparer les arguments par joueur
    const hostArguments = debate.arguments.filter(arg => arg.userId === debate.hostId);
    const guestArguments = debate.arguments.filter(arg => arg.userId === debate.guestId);

    // Calculer les statistiques pour chaque joueur
    const calculatePlayerStats = (argList: any[]) => {
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
        } : null,
        worstArgument: sortedByScore[sortedByScore.length - 1] ? {
          id: sortedByScore[sortedByScore.length - 1].id,
          text: sortedByScore[sortedByScore.length - 1].cleanText,
          score: sortedByScore[sortedByScore.length - 1].scoreTotal,
          reliability: sortedByScore[sortedByScore.length - 1].reliability,
          impact: sortedByScore[sortedByScore.length - 1].impact,
          justification: sortedByScore[sortedByScore.length - 1].justification || 'Argument à améliorer',
          turnIndex: sortedByScore[sortedByScore.length - 1].turnIndex,
        } : null,
        averageScore: Math.round(totalScore / argList.length),
      };
    };

    const hostStats = calculatePlayerStats(hostArguments);
    const guestStats = calculatePlayerStats(guestArguments);

    // Déterminer le gagnant
    // ✅ CORRIGÉ : Si le débat a été quitté (forfait), utiliser le finalWinner persisté
    let winner: 'host' | 'guest' | 'tie' = 'tie';
    // @ts-ignore - finalWinner ajouté par migration
    if (debate.status === 'quit' && debate.finalWinner) {
      // @ts-ignore
      winner = debate.finalWinner;
    } else if (hostStats.totalScore > guestStats.totalScore) {
      winner = 'host';
    } else if (guestStats.totalScore > hostStats.totalScore) {
      winner = 'guest';
    }

    // ✅ AMÉLIORATION : Lecture seule des données ELO/XP - ne jamais déclencher de finalisation
    let hostEloChange = 0;
    let guestEloChange = 0;
    let hostXPGain = 0;
    let guestXPGain = 0;

    if (debate.guest) {
      try {
        // ✅ PRIORITÉ : Lire directement les données persistées dans le débat
        // @ts-ignore - Ces champs sont ajoutés par migration
        if (debate.hostEloChange !== null && debate.guestEloChange !== null &&
            debate.hostXPGain !== null && debate.guestXPGain !== null &&
            debate.scoringTimestamp !== null) {

          // @ts-ignore - Utiliser les données persistées
          hostEloChange = debate.hostEloChange;
          guestEloChange = debate.guestEloChange;
          hostXPGain = debate.hostXPGain;
          guestXPGain = debate.guestXPGain;
        } else {
          // ⚠️ Données non encore calculées - utiliser fallback simple
          console.warn('⚠️ Scoring pas encore calculé pour débat', debateId, '- utilisation fallback');

          const eloChange = Math.abs(hostStats.totalScore - guestStats.totalScore) > 20 ? 15 : 10;
          hostEloChange = winner === 'host' ? eloChange : -eloChange;
          guestEloChange = winner === 'guest' ? eloChange : -eloChange;
          hostXPGain = winner === 'host' ? 55 : 25;
          guestXPGain = winner === 'guest' ? 55 : 25;
        }
      } catch (error) {
        console.warn('⚠️ Erreur lecture scoring, utilisation fallback:', error.message);
        // Fallback vers simulation simple en cas d'erreur
        const eloChange = Math.abs(hostStats.totalScore - guestStats.totalScore) > 20 ? 15 : 10;
        hostEloChange = winner === 'host' ? eloChange : -eloChange;
        guestEloChange = winner === 'guest' ? eloChange : -eloChange;
        hostXPGain = winner === 'host' ? 55 : 25;
        guestXPGain = winner === 'guest' ? 55 : 25;
      }
    }
    
    // ✅ PREMIUM GATING : Récupérer les argument views et le rôle de l'utilisateur
    const [currentUser, existingViews] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { role: true },
      }),
      this.prisma.argumentView.findMany({
        where: { userId, debateId },
        select: { argumentId: true },
      }),
    ]);

    const userRole = (currentUser?.role || 'FREE') as SubscriptionRole;
    const viewedArgumentIds = existingViews.map(v => v.argumentId);
    const argumentViewLimit = userRole === 'FREE' ? FREE_ARGUMENT_VIEW_LIMIT : null; // null = illimité

    return {
      debate: {
        id: debate.id,
        title: debate.title,
        hostView: debate.hostView,
        guestView: debate.guestView,
        mode: debate.mode,
        status: debate.status,
        createdAt: debate.createdAt,
        endedAt: debate.endedAt,
        topic: topic,
        isPrivate: debate.isPrivate,
        forfeitedBy: debate.status === 'quit'
          ? (debate.finalWinner === 'host' ? 'guest' : debate.finalWinner === 'guest' ? 'host' : null)
          : null,
      },
      players: {
        host: {
          id: debate.host.id,
          username: debate.host.username,
          selectedAvatarId: debate.host.selectedAvatarId,
          currentElo: debate.host.elo,
          eloChange: hostEloChange,
          xpGain: hostXPGain,
          topicXpGain: topic ? hostXPGain : null,
        },
        guest: debate.guest ? {
          id: debate.guest.id,
          username: debate.guest.username,
          selectedAvatarId: debate.guest.selectedAvatarId,
          currentElo: debate.guest.elo,
          eloChange: guestEloChange,
          xpGain: guestXPGain,
          topicXpGain: topic ? guestXPGain : null,
        } : null,
      },
      stats: {
        host: hostStats,
        guest: guestStats,
      },
      result: {
        winner,
        hostScore: hostStats.totalScore,
        guestScore: guestStats.totalScore,
        totalArguments: debate.arguments.length,
      },
      // ✅ PREMIUM GATING : Infos de gating pour le frontend
      argumentViewLimit,
      viewedArgumentIds,
      allArguments: debate.arguments.map(arg => ({
        id: arg.id,
        userId: arg.userId,
        turnIndex: arg.turnIndex,
        rawText: arg.rawText,
        cleanText: arg.cleanText,
        scoreTotal: arg.scoreTotal,
        reliability: arg.reliability,
        impact: arg.impact,
        justification: arg.justification,
        gifCategory: arg.gifCategory,
        factChecked: arg.factChecked,
        sources: (arg as any).sourcesData || [],
        // Nouveaux champs d'analyse n8n
        briefJustification: (arg as any).n8nBriefJustification || null,
        strengths: (arg as any).n8nStrengths || [],
        weaknesses: (arg as any).n8nWeaknesses || [],
        createdAt: arg.createdAt,
      })),
    };
  }

  /**
   * ✅ PREMIUM GATING : Enregistre la consultation d'un argument par un utilisateur FREE
   * Les utilisateurs FREE sont limités à FREE_ARGUMENT_VIEW_LIMIT analyses par debate
   */
  async viewArgument(debateId: string, userId: string, argumentId: string) {
    // Vérifier le rôle de l'utilisateur
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });

    const userRole = (user?.role || 'FREE') as SubscriptionRole;

    // Premium+ : accès illimité
    if (userRole !== 'FREE') {
      // Créer le view pour le tracking (optionnel) mais toujours autoriser
      await this.prisma.argumentView.upsert({
        where: { userId_argumentId: { userId, argumentId } },
        create: { userId, debateId, argumentId },
        update: {},
      });
      return { allowed: true, remaining: null };
    }

    // Vérifier si cet argument a déjà été vu
    const existingView = await this.prisma.argumentView.findUnique({
      where: { userId_argumentId: { userId, argumentId } },
    });

    if (existingView) {
      // Déjà vu : autoriser sans décrémenter
      const viewCount = await this.prisma.argumentView.count({
        where: { userId, debateId },
      });
      return { allowed: true, remaining: Math.max(0, FREE_ARGUMENT_VIEW_LIMIT - viewCount) };
    }

    // Compter les views existants pour ce debate
    const viewCount = await this.prisma.argumentView.count({
      where: { userId, debateId },
    });

    if (viewCount >= FREE_ARGUMENT_VIEW_LIMIT) {
      return { allowed: false, remaining: 0 };
    }

    // Créer le view
    await this.prisma.argumentView.create({
      data: { userId, debateId, argumentId },
    });

    return { allowed: true, remaining: FREE_ARGUMENT_VIEW_LIMIT - viewCount - 1 };
  }

  /**
   * 🎓 COACHING : Récupère le coaching post-debate pour un utilisateur.
   * Applique le gating premium : FREE voit les 5 indicateurs + 1 coaching item (le moins grave).
   * PREMIUM+ voit tout.
   */
  async getCoaching(debateId: string, userId: string) {
    // Vérifier la participation
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      select: { hostId: true, guestId: true },
    });

    if (!debate || (debate.hostId !== userId && debate.guestId !== userId)) {
      return { status: 'not_available' };
    }

    // Vérifier le minimum d'arguments
    const { canCoach } = await this.n8nService.canGenerateCoaching(debateId);
    if (!canCoach) {
      return { status: 'insufficient_arguments' };
    }

    // Chercher le CoachingResult
    const coaching = await this.prisma.coachingResult.findUnique({
      where: { debateId_userId: { debateId, userId } },
    });

    if (!coaching) {
      return { status: 'not_available' };
    }

    if (coaching.status === 'pending') {
      return { status: 'pending' };
    }

    if (coaching.status === 'error') {
      return { status: 'error' };
    }

    // Status = 'ready' — appliquer le gating premium
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    const userRole = (user?.role || 'FREE') as SubscriptionRole;
    const isFree = userRole === 'FREE';

    const indicators = coaching.indicators as any;
    const coachingItems = (coaching.coachingItems as any[]) || [];
    // Normalize: old records may have learnings as an array, new ones as a single object
    const rawLearning = coaching.learnings as any;
    const learning = Array.isArray(rawLearning) ? (rawLearning[0] || null) : rawLearning;

    if (!isFree) {
      // Premium+ : tout visible
      return {
        status: 'ready',
        indicators,
        coachingItems: coachingItems.slice(0, 2).map((item: any) => ({ ...item, locked: false })),
        learning: learning ? { ...learning, locked: false } : null,
      };
    }

    // FREE : indicateurs visibles, le plus critique (rank 1) est masqué, le reste déverrouillé
    // Max 2 items affichés
    const displayItems = coachingItems.slice(0, 2);

    return {
      status: 'ready',
      indicators, // Toujours visible
      coachingItems: displayItems.map((item: any) => {
        if (item.rank === 1) {
          // Le plus critique est verrouillé pour FREE
          return {
            rank: item.rank,
            type: item.type,
            severity: item.severity,
            title: item.title,
            quote: null,
            explanation: null,
            suggestion: null,
            locked: true,
          };
        }
        return { ...item, locked: false };
      }),
      // FREE : learning visible (accessible à tous)
      learning: learning ? { ...learning, locked: false } : null,
    };
  }

  /**
   * Permet à un utilisateur de rejoindre un débat en tant qu'invité
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui rejoint
   * @param guestView Point de vue de l'invité
   * @returns Le débat mis à jour
   */
  async join(debateId: string, userId: string, guestView: string) {
    console.log('🔄 [DebatesService] Début de join():', {
      debateId,
      userId,
      guestViewLength: guestView?.length
    });

    // ✅ MODÉRATION : Vérifier le contenu pour insultes/contenu inapproprié
    const moderationResult = this.moderationService.checkProfanity(guestView);
    if (moderationResult.hasProfanity) {
      this.logger.warn(`Profanity detected in guestView when joining debate ${debateId} by user ${userId}: ${moderationResult.detectedWords.join(', ')}`);
      throw new BadRequestException({
        error: 'PROFANITY_DETECTED',
        message: 'Ton point de vue contient des termes inappropriés. Veuillez reformuler.',
        field: 'guestView',
      });
    }

    // ✅ VÉRIFIER LES LIMITES DE DÉBATS AVANT DE REJOINDRE
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        role: true,
        monthlyDebateCount: true,
        monthlyDebateReset: true
      }
    });

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    const userRole = (user.role || 'FREE') as SubscriptionRole;
    const debateLimit = getDebateLimitForRole(userRole);

    // Vérifier si 30 jours se sont écoulés depuis le dernier reset
    const now = new Date();
    const resetDate = new Date(user.monthlyDebateReset);
    const daysSinceReset = Math.floor((now.getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24));
    const shouldReset = daysSinceReset >= 30;

    if (shouldReset) {
      // Reset du compteur tous les 30 jours
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          monthlyDebateCount: 0,
          monthlyDebateReset: now
        }
      });
    } else if (user.monthlyDebateCount >= debateLimit) {
      // Limite atteinte
      const nextRole = userRole === 'FREE' ? 'Premium' : userRole === 'PREMIUM' ? 'Creator' : 'Business';
      throw new BadRequestException(
        `Limite de ${debateLimit} débats par mois atteinte pour le plan ${userRole}. ${userRole !== 'BUSINESS' ? `Passez au plan ${nextRole} pour plus de débats !` : ''}`
      );
    }

    // Vérifier si le débat existe et est en attente
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
    });

    // ✅ ASYNC : Vérifier les limites de débats asynchrones simultanés AVANT de rejoindre
    if (debate && debate.isLive === false) {
      await this.checkAsyncDebateLimit(userId);
    }

    console.log('📊 [DebatesService] Débat trouvé:', {
      exists: !!debate,
      id: debate?.id,
      status: debate?.status,
      hostId: debate?.hostId,
      guestId: debate?.guestId,
      title: debate?.title
    });

    if (!debate) {
      console.error('❌ [DebatesService] Débat non trouvé');
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    // Le débat doit être soit 'waiting' soit 'reserved' par cet utilisateur
    if (debate.status !== 'waiting' && debate.status !== 'reserved') {
      console.error('❌ [DebatesService] Statut invalide:', debate.status);
      throw new BadRequestException('Ce débat n\'est pas disponible');
    }

    // Si le débat est réservé, vérifier que c'est par le bon utilisateur
    if (debate.status === 'reserved' && debate.reservedBy !== userId) {
      console.error('❌ [DebatesService] Débat réservé par un autre utilisateur:', {
        reservedBy: debate.reservedBy,
        currentUser: userId
      });
      throw new BadRequestException('Ce débat est réservé par un autre utilisateur');
    }

    if (debate.hostId === userId) {
      console.error('❌ [DebatesService] Tentative de rejoindre son propre débat');
      throw new BadRequestException('Vous ne pouvez pas rejoindre votre propre débat');
    }

    console.log('✅ [DebatesService] Validations passées, activation immédiate du débat...');

    // 🆕 ÉTAPE 0.5 : Récupérer les ELO actuels des participants pour les sauvegarder
    const [host, guest] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: debate.hostId }, select: { elo: true } }),
      this.prisma.user.findUnique({ where: { id: userId }, select: { elo: true } })
    ]);

    console.log('📊 [DebatesService] ELO des participants au début du débat:', {
      hostElo: host?.elo,
      guestElo: guest?.elo
    });

    // 🆕 ÉTAPE 1 : Activer le débat immédiatement (AVANT l'analyse)
    // ✅ ASYNC : Pour les débats async publics, garder le statut 'reserved' jusqu'au premier argument
    // ✅ PRIVATE ASYNC : Pour les débats privés async, passer directement à 'active' (pas de délai 5min)
    const isAsyncDebate = debate.isLive === false;
    const isPrivateAsyncDebate = isAsyncDebate && debate.isPrivate === true;
    const debateStatus = isPrivateAsyncDebate ? 'active' : (isAsyncDebate ? 'reserved' : 'active');

    const updateData: any = {
      guestId: userId,
      guestView: guestView,
      status: debateStatus,
      // Valeurs par défaut temporaires (seront mises à jour par l'analyse)
      moderationStatus: 'pending',
      // ✅ NOUVEAU : Sauvegarder les ELO au moment du débat
      hostEloAtDebate: host?.elo || 1000,
      guestEloAtDebate: guest?.elo || 1000
    };

    // ✅ ASYNC : Initialiser les champs de tour pour les débats asynchrones
    if (isAsyncDebate) {
      updateData.currentTurnUserId = userId; // C'est au tour de l'invité de jouer en premier
      updateData.turnStartedAt = new Date();
      updateData.turnNumber = 1;
      // Pour les débats async publics, on garde reservedBy pour le délai de 5min
      // Pour les débats privés async, pas besoin car le débat est déjà actif
      if (!isPrivateAsyncDebate) {
        updateData.reservedBy = userId;
      }
    }

    const updatedDebate = await this.prisma.debate.update({
      where: { id: debateId },
      data: updateData,
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
          },
        },
      },
    });

    // 🔍 DEBUG : Vérifier que le guestId a bien été persisté
    console.log('🔍 [DEBUG] After update - updatedDebate.guestId:', updatedDebate.guestId);
    console.log('🔍 [DEBUG] After update - updatedDebate.guest:', updatedDebate.guest);

    // Vérification en relisant le débat
    const verifyDebate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      select: { guestId: true, status: true, reservedBy: true }
    });
    console.log('🔍 [DEBUG] Verification read - guestId:', verifyDebate?.guestId, 'status:', verifyDebate?.status);

    // Créer un timer pour l'invité
    await this.prisma.debateTimer.create({
      data: {
        debateId: debateId,
        userId: userId,
        remainingSec: debate.mode * 60, // Conversion mode (minutes) en secondes
      },
    });

    // 🚀 Notification Socket.IO : Un invité a rejoint le débat
    console.log('🔔 [DebatesService] Envoi de la notification debate_started via Socket.IO');
    
    // Vérifier combien de clients sont dans la room
    const roomId = `debate:${debateId}`;
    const roomSize = this.socketGateway.server.sockets.adapter.rooms.get(roomId)?.size || 0;
    console.log(`📊 [DebatesService] Room ${roomId} contient ${roomSize} client(s) avant émission`);
    
    this.socketGateway.emitToRoom(roomId, 'debate_started', {
      debateId: debateId,
      debate: updatedDebate,
      message: 'Le débat commence maintenant !',
      timestamp: new Date().toISOString()
    });
    
    console.log('✅ [DebatesService] Événement debate_started émis à la room:', roomId);

    // Notification spécifique à l'hôte
    this.socketGateway.emitToRoom(`user:${debate.hostId}`, 'guest_joined_debate', {
      debateId: debateId,
      guest: updatedDebate.guest,
      debate: updatedDebate,
      message: `${updatedDebate.guest?.username} a rejoint votre débat !`
    });

    // 🆕 ÉTAPE 2 : Lancer l'analyse EN ARRIÈRE-PLAN (UNIQUEMENT pour les débats LIVE)
    // ✅ ASYNC : Pour les débats async, l'analyse se lancera au premier argument (voir arguments.service.ts:222-318)
    if (!isAsyncDebate) {
      console.log('🔄 [DebatesService] Lancement analyse en arrière-plan pendant le compte à rebours (LIVE)...');
      this.performDebateAnalysisAsync(debateId, debate.title, debate.hostView, guestView, debate.gameMode || 'COMPETITIVE');
    } else {
      console.log('⏭️ [DebatesService] Analyse différée au premier argument (ASYNC)');
    }

    // ✅ Incrémenter le compteur mensuel de débats pour l'invité
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        monthlyDebateCount: { increment: 1 }
      }
    });

    // Track debate joined in PostHog
    const debateType = debate.isPrivate ? 'friend_duel' : (debate.isLive ? 'live_duel' : 'async_duel');
    this.posthog.trackDebateJoined(userId, debateId, debateType);
    this.posthog.trackDebateParticipated(userId, debateId, debateType, 'joiner');

    // ✅ BOT SYSTEM: Notify bot player service that a user joined
    // This starts the bot session if the host is a bot
    try {
      await this.botPlayerService.onDebateStarted(debateId);
    } catch (botError) {
      this.logger.warn(`Bot notification failed for debate ${debateId}: ${botError.message}`);
    }

    console.log('✅ [DebatesService] Join terminé avec succès');
    return updatedDebate;
  }

  /**
   * 🔄 MÉTHODE ASYNCHRONE : Lance l'analyse du débat en arrière-plan
   * S'exécute pendant le compte à rebours d'introduction (10s)
   * Utilise n8n si activé, sinon fallback sur le service legacy
   */
  private async performDebateAnalysisAsync(
    debateId: string,
    title: string,
    hostView: string,
    guestView: string,
    gameMode: string = 'COMPETITIVE'
  ) {
    try {
      console.log(`🔄 [DebatesService] Début analyse asynchrone pour débat ${debateId} avec gameMode ${gameMode}...`);
      const startTime = Date.now();

      if (this.useN8nAnalysis) {
        // ===== USE N8N PIPELINE =====
        this.logger.log(`🚀 Using n8n M0 analysis for LIVE debate ${debateId} with gameMode ${gameMode}`);

        // Call n8n StartDebate webhook - it saves results via callback
        await this.n8nService.callStartDebate(
          debateId,
          title,
          hostView,
          guestView,
          gameMode, // Use the actual game mode (COMPETITIVE/EXPLORATORY)
        );

        const processingTime = Date.now() - startTime;
        this.logger.log(`✅ n8n M0 analysis completed for LIVE debate ${debateId} in ${processingTime}ms`);

        // Fetch the updated debate to get n8n results
        const updatedDebate = await this.prisma.debate.findUnique({
          where: { id: debateId },
          select: {
            n8nM0Completed: true,
            n8nBranchCode: true,
            n8nNature: true,
            n8nComplexity: true,
          },
        });

        // Notify clients that n8n analysis is ready
        this.socketGateway.emitToRoom(
          `debate:${debateId}`,
          'debate_analysis_ready',
          {
            debateId,
            n8nCompleted: updatedDebate?.n8nM0Completed,
            branchCode: updatedDebate?.n8nBranchCode,
            nature: updatedDebate?.n8nNature,
            complexity: updatedDebate?.n8nComplexity,
            processingTime,
          }
        );

      } else {
        // ===== USE LEGACY PIPELINE =====
        this.logger.log(`📋 Using legacy analysis for LIVE debate ${debateId}`);

        // Lancer l'analyse sans timeout - elle se termine naturellement
        const analysisResult = await this.duelDebateAnalysisService.analyzeDebateForDuel(
          debateId,
          title,
          hostView,
          guestView
        );

        const processingTime = Date.now() - startTime;
        console.log(`⏱️ [DebatesService] Analyse terminée en ${processingTime}ms`);

        // 🚫 Si modération rejetée, mettre le débat en statut rejeté
        if (analysisResult.moderationStatus === 'rejected') {
          console.error(`🚫 [DebatesService] Modération échouée pour ${debateId}: ${analysisResult.rejectionReason}`);

          await this.prisma.debate.update({
            where: { id: debateId },
            data: {
              status: 'rejected',
              moderationStatus: 'rejected'
            }
          });

          // Notifier les clients que le débat est rejeté
          this.socketGateway.emitToRoom(
            `debate:${debateId}`,
            'debate_rejected',
            {
              debateId,
              reason: analysisResult.rejectionReason,
              message: 'Ce débat a été rejeté par la modération automatique.'
            }
          );

          return;
        }

        // ✅ Sauvegarder les résultats d'analyse
        await this.prisma.debate.update({
          where: { id: debateId },
          data: {
            contextPhrase: analysisResult.contextPhrase,
            tone: analysisResult.tone,
            reliabilityCoef: analysisResult.reliabilityCoef,
            impactCoef: analysisResult.impactCoef,
            topicCategory: analysisResult.topicCategory,
            topicId: analysisResult.topicId,
            moderationStatus: 'approved'
          }
        });

        console.log(`✅ [DebatesService] Analyse sauvegardée pour ${debateId}: tone=${analysisResult.tone}, topic=${analysisResult.topicCategory}`);

        // Notifier les clients que l'analyse est terminée
        this.socketGateway.emitToRoom(
          `debate:${debateId}`,
          'debate_analysis_ready',
          {
            debateId,
            tone: analysisResult.tone,
            topicCategory: analysisResult.topicCategory,
            processingTime
          }
        );
      }

    } catch (error) {
      console.error(`❌ [DebatesService] Erreur analyse asynchrone pour ${debateId}: ${error.message}`);

      // En cas d'erreur, utiliser des valeurs par défaut
      try {
        // Essayer de trouver un topic par défaut en base
        const defaultTopic = await this.prisma.topic.findFirst({
          where: {
            OR: [
              { label: { contains: 'Temps libre' } },
              { label: { contains: 'Modes de vie' } }
            ]
          },
          orderBy: { isMainTopic: 'asc' }
        });

        await this.prisma.debate.update({
          where: { id: debateId },
          data: {
            contextPhrase: `Débat: ${title}`,
            tone: 'modéré',
            reliabilityCoef: 1.5,
            impactCoef: 1.5,
            topicCategory: defaultTopic?.label || 'Temps libre & hobbies',
            topicId: defaultTopic?.id || null,
            moderationStatus: 'approved'
          }
        });

        console.log(`⚠️ [DebatesService] Valeurs par défaut appliquées pour ${debateId}`);

        // Notifier les clients avec valeurs par défaut
        this.socketGateway.emitToRoom(
          `debate:${debateId}`,
          'debate_analysis_fallback',
          {
            debateId,
            message: 'Analyse utilisée avec paramètres par défaut',
            tone: 'modéré'
          }
        );

      } catch (fallbackError) {
        console.error(`❌ [DebatesService] Erreur fallback pour ${debateId}: ${fallbackError.message}`);
        // Le débat continue avec les valeurs initiales
      }
    }
  }

  /**
   * Réserve un débat pour prévisualisation (30 secondes max)
   * @param debateId ID du débat à réserver
   * @param userId ID de l'utilisateur qui réserve
   * @returns Le débat réservé
   */
  async reserve(debateId: string, userId: string) {
    // Vérifier si le débat existe et est disponible
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    if (debate.status !== 'waiting') {
      throw new BadRequestException('Ce débat n\'est pas disponible pour réservation');
    }

    if (debate.hostId === userId) {
      throw new BadRequestException('Vous ne pouvez pas réserver votre propre débat');
    }

    // Récupérer les informations de l'utilisateur qui réserve
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        selectedAvatarId: true,
        role: true,
        monthlyDebateCount: true,
        monthlyDebateReset: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // ✅ VÉRIFIER LES LIMITES DE DÉBATS AVANT DE RÉSERVER
    const userRole = (user.role || 'FREE') as SubscriptionRole;
    const debateLimit = getDebateLimitForRole(userRole);

    // Vérifier si 30 jours se sont écoulés depuis le dernier reset
    const now = new Date();
    const resetDate = new Date(user.monthlyDebateReset);
    const daysSinceReset = Math.floor((now.getTime() - resetDate.getTime()) / (1000 * 60 * 60 * 24));
    const shouldReset = daysSinceReset >= 30;

    if (shouldReset) {
      // Reset du compteur tous les 30 jours
      await this.prisma.user.update({
        where: { id: userId },
        data: {
          monthlyDebateCount: 0,
          monthlyDebateReset: now
        }
      });
    } else if (user.monthlyDebateCount >= debateLimit) {
      // Limite atteinte - empêcher la réservation
      const nextRole = userRole === 'FREE' ? 'Premium' : userRole === 'PREMIUM' ? 'Creator' : 'Business';
      throw new BadRequestException(
        `Limite de ${debateLimit} débats par mois atteinte pour le plan ${userRole}. ${userRole !== 'BUSINESS' ? `Passez au plan ${nextRole} pour plus de débats !` : ''}`
      );
    }

    // Réserver le débat
    const updatedDebate = await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'reserved',
        reservedBy: userId,
        reservedAt: new Date(),
      },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
          },
        },
      },
    });

    // 🚀 Notification Socket.IO : Le débat a été réservé
    console.log('🔔 [DebatesService] Envoi de la notification debate_reserved via Socket.IO');
    
    // Notifier l'hôte que son débat a été réservé
    this.socketGateway.emitToRoom(`user:${debate.hostId}`, 'debate_reserved', {
      debateId: debateId,
      username: user.username,
      userId: userId,
      timestamp: new Date().toISOString(),
      message: `${user.username} a réservé votre débat`
    });

    // Notifier également la room du débat si elle existe
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_reserved', {
      debateId: debateId,
      username: user.username,
      userId: userId,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ [DebatesService] Événement debate_reserved émis pour le débat ${debateId} par ${user.username}`);

    return updatedDebate;
  }

  /**
   * Libère la réservation d'un débat
   * @param debateId ID du débat à libérer
   * @param userId ID de l'utilisateur qui libère (pour vérification)
   * @returns Le débat libéré
   */
  async unreserve(debateId: string, userId: string) {
    // Vérifier si le débat existe et est réservé par cet utilisateur
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    if (debate.status !== 'reserved') {
      throw new BadRequestException('Ce débat n\'est pas réservé');
    }

    if (debate.reservedBy !== userId) {
      throw new BadRequestException('Vous ne pouvez pas libérer la réservation de ce débat');
    }

    // Récupérer les informations de l'utilisateur qui libère
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        username: true,
        selectedAvatarId: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Utilisateur non trouvé');
    }

    // Libérer la réservation
    const updatedDebate = await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'waiting',
        reservedBy: null,
        reservedAt: null,
      },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
          },
        },
      },
    });

    // 🚀 Notification Socket.IO : La réservation a été libérée
    console.log('🔔 [DebatesService] Envoi de la notification debate_unreserved via Socket.IO');
    
    // Notifier l'hôte que la réservation a été libérée
    this.socketGateway.emitToRoom(`user:${debate.hostId}`, 'debate_unreserved', {
      debateId: debateId,
      username: user.username,
      userId: userId,
      timestamp: new Date().toISOString(),
      message: `${user.username} a annulé sa réservation`
    });

    // Notifier également la room du débat si elle existe
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_unreserved', {
      debateId: debateId,
      username: user.username,
      userId: userId,
      timestamp: new Date().toISOString()
    });

    console.log(`✅ [DebatesService] Événement debate_unreserved émis pour le débat ${debateId} par ${user.username}`);

    return updatedDebate;
  }

  /**
   * ✅ ASYNC : Libère un débat rejoint sans avoir envoyé d'argument
   * Utilisé quand le guest quitte l'écran de débat async avant d'envoyer son premier argument
   * Le débat repasse en status 'waiting' et le guestId/guestView sont réinitialisés
   * @param debateId ID du débat à libérer
   * @param userId ID de l'utilisateur (guest) qui libère
   */
  async releaseJoin(debateId: string, userId: string) {
    console.log(`🔓 [DebatesService] Tentative de libération du débat ${debateId} par l'utilisateur ${userId}`);

    // Vérifier si le débat existe
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        _count: {
          select: { arguments: true }
        },
        host: {
          select: { id: true, username: true }
        }
      }
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    // Vérifier que c'est bien le guest qui essaie de libérer
    if (debate.guestId !== userId) {
      throw new BadRequestException('Vous ne pouvez pas libérer ce débat car vous n\'êtes pas l\'invité');
    }

    // Vérifier qu'aucun argument n'a été envoyé
    if (debate._count.arguments > 0) {
      throw new BadRequestException('Impossible de libérer un débat où des arguments ont déjà été envoyés');
    }

    // Vérifier que le débat est bien en status 'reserved' (pas encore actif)
    if (debate.status !== 'reserved') {
      throw new BadRequestException(`Impossible de libérer un débat avec le statut "${debate.status}"`);
    }

    // Récupérer les informations du guest
    const guest = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, username: true }
    });

    // Réinitialiser le débat à l'état 'waiting'
    // Utilisation de SQL brut car Prisma 5.22.0 a un bug avec guestId dans les updates
    await this.prisma.$executeRaw`
      UPDATE "Debate"
      SET "status" = 'waiting',
          "guestId" = NULL,
          "guestView" = NULL,
          "reservedBy" = NULL,
          "reservedAt" = NULL,
          "currentTurnUserId" = NULL,
          "turnStartedAt" = NULL,
          "turnNumber" = 0
      WHERE "id" = ${debateId}
    `;

    const updatedDebate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: {
          select: { id: true, username: true, selectedAvatarId: true }
        }
      }
    });

    // Supprimer le timer de l'invité si existant
    await this.prisma.debateTimer.deleteMany({
      where: {
        debateId: debateId,
        userId: userId
      }
    });

    // 🚀 Notification Socket.IO : Le guest a libéré le débat
    console.log('🔔 [DebatesService] Envoi de la notification debate_join_released via Socket.IO');

    // Notifier l'hôte que le guest a quitté sans jouer
    this.socketGateway.emitToRoom(`user:${debate.hostId}`, 'debate_join_released', {
      debateId: debateId,
      guestUsername: guest?.username || 'Invité',
      timestamp: new Date().toISOString(),
      message: `${guest?.username || 'Un joueur'} a quitté le débat sans envoyer d'argument`
    });

    // Notifier la room du débat
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_join_released', {
      debateId: debateId,
      guestUsername: guest?.username || 'Invité',
      timestamp: new Date().toISOString()
    });

    console.log(`✅ [DebatesService] Débat ${debateId} libéré - repasse en 'waiting'`);

    return {
      success: true,
      message: 'Débat libéré avec succès',
      debate: updatedDebate
    };
  }

  /**
   * Nettoie automatiquement les réservations expirées (> 30 secondes pour LIVE)
   * ✅ ASYNC : Les débats async ont un timeout de 30 MINUTES géré par worker-async-timeout
   * Cette méthode devrait être appelée périodiquement ou avant chaque findAll
   */
  async cleanupExpiredReservations() {
    const thirtySecondsAgo = new Date(Date.now() - 30 * 1000);

    // ✅ ASYNC : Ne nettoyer QUE les réservations de débats LIVE
    // Les débats async ont un timeout de 30 min géré par worker-async-timeout
    await this.prisma.debate.updateMany({
      where: {
        status: 'reserved',
        isLive: true, // ✅ NOUVEAU : Seulement les débats live
        reservedAt: {
          lt: thirtySecondsAgo,
        },
      },
      data: {
        status: 'waiting',
        reservedBy: null,
        reservedAt: null,
      },
    });
  }

  /**
   * Nettoie automatiquement les débats en attente trop longtemps
   * - Débats LIVE de bots sans guest : hard delete (aucune donnée utile à conserver)
   * - Débats LIVE de vrais users : marqués 'cancelled'
   * ✅ ASYNC : Les débats async sont gérés par le worker-async-timeout qui utilise expiresAt (48h)
   */
  async cleanupAbandonedDebates() {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000); // 10 minutes

    try {
      // 1. Hard delete des débats LIVE de bots jamais rejoints (pas de guest, pas d'arguments)
      const botDebatesToDelete = await this.prisma.debate.findMany({
        where: {
          status: 'waiting',
          isLive: true,
          guestId: null,
          createdAt: { lt: tenMinutesAgo },
          host: { isBot: true },
        },
        select: { id: true },
      });

      if (botDebatesToDelete.length > 0) {
        const ids = botDebatesToDelete.map((d) => d.id);
        // Supprimer les timers associés (pas de onDelete Cascade sur DebateTimer)
        await this.prisma.debateTimer.deleteMany({ where: { debateId: { in: ids } } });
        const deleted = await this.prisma.debate.deleteMany({ where: { id: { in: ids } } });
        console.log(`🗑️ ${deleted.count} débats LIVE de bots supprimés (waiting > 10 min, jamais rejoints)`);
      }

      // 2. Débats LIVE de vrais users : marquer comme cancelled (comportement existant)
      const updatedCount = await this.prisma.debate.updateMany({
        where: {
          status: 'waiting',
          isLive: true,
          createdAt: { lt: tenMinutesAgo },
          host: { isBot: false },
        },
        data: {
          status: 'cancelled',
          endedAt: new Date(),
        },
      });

      if (updatedCount.count > 0) {
        console.log(`🚫 ${updatedCount.count} débats LIVE en attente marqués comme annulés (waiting > 10 min)`);
      }
    } catch (error) {
      console.error('Erreur lors du nettoyage des débats en attente:', error);
    }
  }

  /**
   * Quitte un débat en cours
   * @param debateId ID du débat à quitter
   * @param userId ID de l'utilisateur qui quitte
   */
  async quit(debateId: string, userId: string) {
    console.log('🚪 [DebatesService] Début de quit():', { debateId, userId });

    // Vérifier si le débat existe
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            elo: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            elo: true,
          },
        },
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    // Vérifier que l'utilisateur fait partie du débat
    if (debate.hostId !== userId && debate.guestId !== userId) {
      throw new BadRequestException('Vous ne faites pas partie de ce débat');
    }

    // Déterminer qui a quitté et qui reste
    const quitter = debate.hostId === userId ? debate.host : debate.guest;
    const opponent = debate.hostId === userId ? debate.guest : debate.host;
    const isHost = debate.hostId === userId;

    console.log('👋 [DebatesService] Joueur qui quitte:', {
      username: quitter?.username,
      isHost,
      opponent: opponent?.username
    });

    // 🛑 ÉTAPE 1 : Arrêter tous les timers du débat
    console.log('🛑 [DebatesService] Arrêt des timers pour le débat');

    try {
      // Arrêter le timer de l'hôte
      if (debate.hostId) {
        await this.timerService.deleteTimer(debateId, debate.hostId);
        console.log('✅ Timer hôte supprimé');
      }

      // Arrêter le timer de l'invité
      if (debate.guestId) {
        await this.timerService.deleteTimer(debateId, debate.guestId);
        console.log('✅ Timer invité supprimé');
      }
    } catch (error) {
      console.log('⚠️ [DebatesService] Erreur lors de l\'arrêt des timers (probablement déjà arrêtés):', error.message);
    }

    // ⚖️ ÉTAPE 2 : Appliquer les pénalités/gains ELO pour abandon
    console.log('⚖️ [DebatesService] Calcul des pénalités/gains ELO pour abandon');

    try {
      if (quitter && opponent) {
        // 📊 ÉTAPE 2.1 : Calculer les scores actuels des joueurs
        const debateArguments = await this.prisma.argument.findMany({
          where: { debateId },
          select: {
            userId: true,
            scoreTotal: true,
          },
        });

        const hostScore = debateArguments
          .filter(arg => arg.userId === debate.hostId)
          .reduce((sum, arg) => sum + arg.scoreTotal, 0);

        const guestScore = debateArguments
          .filter(arg => arg.userId === debate.guestId)
          .reduce((sum, arg) => sum + arg.scoreTotal, 0);

        console.log(`📊 Scores actuels: Host=${hostScore}, Guest=${guestScore}`);

        // 📊 ÉTAPE 2.2 : Déterminer qui était en train de gagner
        const quitterScore = isHost ? hostScore : guestScore;
        const opponentScore = isHost ? guestScore : hostScore;
        const opponentWasWinning = opponentScore > quitterScore;

        console.log(`🎯 Adversaire était en train de ${opponentWasWinning ? 'gagner' : 'perdre'} (${opponentScore} vs ${quitterScore})`);

        // ⚖️ ÉTAPE 2.3 : Appliquer les règles de forfait
        // Celui qui quitte perd toujours 10 points d'ELO
        const quitterEloChange = -10;
        const quitterNewElo = Math.max(0, quitter.elo + quitterEloChange);

        // ✅ NOUVELLE FORMULE : L'adversaire gagne de l'ELO proportionnellement aux points
        // Prend en compte : différence d'ELO, points du gagnant, écart de points
        const opponentEloChange = this.scoringService.calculateForfeitEloGain(
          opponent.elo,      // ELO du gagnant
          quitter.elo,       // ELO de celui qui quitte
          opponentScore,     // Points du gagnant
          quitterScore       // Points de celui qui quitte
        );

        // Calculer 30% de l'XP normal que l'adversaire aurait reçu
        const scoreGap = Math.abs(hostScore - guestScore);
        const personalFactor = Math.min(1, opponentScore / 150); // PLAYER_POINTS_FOR_MAX_XP = 150
        const gapBonusXP = Math.floor(scoreGap / 5);
        const rawXP = 30 + 25 + gapBonusXP; // Base winner XP + gap bonus
        const fullXP = Math.max(0, Math.round(rawXP * personalFactor));
        const opponentXPGain = Math.round(fullXP * 0.3); // 30% de l'XP normal

        console.log(`✅ Gains adversaire (forfait): ELO +${opponentEloChange}, XP +${opponentXPGain} (30% de ${fullXP})`);

        const opponentNewElo = opponent.elo + opponentEloChange;

        // ✅ ÉTAPE 2.4 : Appliquer les changements en base
        // Mettre à jour l'ELO du joueur qui quitte (pénalité)
        await this.prisma.user.update({
          where: { id: quitter.id },
          data: { elo: quitterNewElo }
        });

        // ✅ Mettre à jour l'ELO et XP de l'adversaire (toujours, dans tous les cas)
        // Mettre à jour l'utilisateur directement (similaire à updateUserProgress)
        const opponentUser = await this.prisma.user.findUnique({
          where: { id: opponent.id },
        });

        if (opponentUser) {
          const newElo = opponentUser.elo + opponentEloChange;

          // Récupérer la progression actuelle
          const currentProgress = opponentUser.topicsProgress as any || {
            generalXP: 0,
            level: 1,
            subTopics: {},
            mainTopics: {},
          };

          // Ajouter XP général (30% de l'XP normal)
          const oldGeneralXP = currentProgress.generalXP || 0;
          currentProgress.generalXP = oldGeneralXP + opponentXPGain;
          currentProgress.level = this.scoringService.calculateLevel(currentProgress.generalXP);

          // Ajouter XP au sujet spécifique si topicId fourni
          if (debate.topicId) {
            const topic = await this.prisma.topic.findUnique({
              where: { id: debate.topicId },
            });

            if (topic) {
              if (topic.isMainTopic) {
                // Topic principal
                if (!currentProgress.mainTopics[debate.topicId]) {
                  currentProgress.mainTopics[debate.topicId] = { xp: 0, lastUpdate: new Date().toISOString() };
                }
                currentProgress.mainTopics[debate.topicId].xp += opponentXPGain;
                currentProgress.mainTopics[debate.topicId].lastUpdate = new Date().toISOString();
              } else {
                // Sous-topic
                if (!currentProgress.subTopics[debate.topicId]) {
                  currentProgress.subTopics[debate.topicId] = { xp: 0, lastActivity: new Date().toISOString() };
                }
                currentProgress.subTopics[debate.topicId].xp += opponentXPGain;
                currentProgress.subTopics[debate.topicId].lastActivity = new Date().toISOString();

                // Ajouter XP au topic parent
                if (topic.parentId) {
                  if (!currentProgress.mainTopics[topic.parentId]) {
                    currentProgress.mainTopics[topic.parentId] = {
                      xp: 0,
                      lastUpdate: new Date().toISOString()
                    };
                  }
                  const parentXpGain = Math.floor(opponentXPGain * 0.5);
                  currentProgress.mainTopics[topic.parentId].xp += parentXpGain;
                  currentProgress.mainTopics[topic.parentId].lastUpdate = new Date().toISOString();
                }
              }
            }
          }

          // Sauvegarder en base avec incrémentation des compteurs
          await this.prisma.user.update({
            where: { id: opponent.id },
            data: {
              elo: newElo,
              topicsProgress: currentProgress,
              totalDebates: { increment: 1 },
              totalDuelDebates: { increment: 1 },
            },
          });
        }

        console.log(`📉 Pénalité appliquée: ${quitter.username} ${quitter.elo} → ${quitterNewElo} (${quitterEloChange})`);
        console.log(`✅ Adversaire ${opponent.username}: ${opponent.elo} → ${opponentNewElo} (ELO ${opponentEloChange > 0 ? '+' : ''}${opponentEloChange}, XP +${opponentXPGain})`);

        // ✅ ÉTAPE 2.5 : Sauvegarder dans le débat pour l'historique
        await this.prisma.debate.update({
          where: { id: debateId },
          data: {
            // @ts-ignore - Ces champs seront ajoutés par migration
            hostEloChange: isHost ? quitterEloChange : opponentEloChange,
            guestEloChange: isHost ? opponentEloChange : quitterEloChange,
            hostXPGain: isHost ? 0 : opponentXPGain, // Pas d'XP pour celui qui quitte
            guestXPGain: isHost ? opponentXPGain : 0,
            hostFinalScore: hostScore,
            guestFinalScore: guestScore,
            finalWinner: isHost ? 'guest' : 'host', // L'adversaire gagne toujours
            scoringTimestamp: new Date(),
          },
        });
      }
    } catch (eloError) {
      console.error('❌ [DebatesService] Erreur lors de l\'application des pénalités ELO:', eloError.message);
      // Ne pas bloquer la sortie du débat même si la pénalité échoue
    }

    // Mettre à jour le statut du débat
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'quit',
        endedAt: new Date(),
      },
    });

    // 🚨 Notification Socket.IO à l'adversaire
    if (opponent) {
      this.socketGateway.emitToRoom(`debate:${debateId}`, 'opponent_quit', {
        debateId: debateId,
        quitter: {
          username: quitter?.username,
          isHost: isHost,
        },
        message: `${quitter?.username} a quitté le débat`,
        timestamp: new Date().toISOString()
      });

      console.log('📢 [DebatesService] Notification envoyée à l\'adversaire via Socket.IO');
    }

    console.log('✅ [DebatesService] Quit terminé avec succès (avec pénalité ELO)');

    // 🎓 COACHING : Trigger post-debate coaching analysis
    this.n8nService.callCoachingAnalysis(debateId).catch((err) =>
      console.warn('⚠️ Coaching trigger failed after quit:', err.message),
    );
  }

  /**
   * ✅ ASYNC : Abandonne un débat asynchrone (forfait)
   * Logique identique à quit() : pénalité ELO pour celui qui abandonne
   * @param debateId ID du débat à abandonner
   * @param userId ID de l'utilisateur qui abandonne (pour vérification)
   */
  async forfeit(debateId: string, userId: string) {
    console.log('🏳️ [DebatesService] Début de forfeit():', { debateId, userId });

    // Vérifier si le débat existe
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            elo: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            elo: true,
          },
        },
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    // Vérifier que l'utilisateur fait partie du débat
    if (debate.hostId !== userId && debate.guestId !== userId) {
      throw new BadRequestException('Vous ne faites pas partie de ce débat');
    }

    // Déterminer qui a abandonné et qui reste
    const forfeiter = debate.hostId === userId ? debate.host : debate.guest;
    const opponent = debate.hostId === userId ? debate.guest : debate.host;
    const isHost = debate.hostId === userId;

    console.log('🏳️ [DebatesService] Joueur qui abandonne:', {
      username: forfeiter?.username,
      isHost,
      opponent: opponent?.username
    });

    // ⚖️ ÉTAPE 1 : Appliquer les pénalités/gains ELO pour forfait
    console.log('⚖️ [DebatesService] Calcul des pénalités/gains ELO pour forfait');

    try {
      if (forfeiter && opponent) {
        // 📊 ÉTAPE 1.1 : Calculer les scores actuels des joueurs
        const debateArguments = await this.prisma.argument.findMany({
          where: { debateId },
          select: {
            userId: true,
            scoreTotal: true,
          },
        });

        const hostScore = debateArguments
          .filter(arg => arg.userId === debate.hostId)
          .reduce((sum, arg) => sum + arg.scoreTotal, 0);

        const guestScore = debateArguments
          .filter(arg => arg.userId === debate.guestId)
          .reduce((sum, arg) => sum + arg.scoreTotal, 0);

        console.log(`📊 Scores actuels: Host=${hostScore}, Guest=${guestScore}`);

        // 📊 ÉTAPE 1.2 : Déterminer qui était en train de gagner
        const forfeiterScore = isHost ? hostScore : guestScore;
        const opponentScore = isHost ? guestScore : hostScore;
        const opponentWasWinning = opponentScore > forfeiterScore;

        console.log(`🎯 Adversaire était en train de ${opponentWasWinning ? 'gagner' : 'perdre'} (${opponentScore} vs ${forfeiterScore})`);

        // ⚖️ ÉTAPE 1.3 : Appliquer les règles de forfait
        // Celui qui abandonne perd toujours 10 points d'ELO
        const forfeiterEloChange = -10;
        const forfeiterNewElo = Math.max(0, forfeiter.elo + forfeiterEloChange);

        // ✅ NOUVELLE FORMULE : L'adversaire gagne de l'ELO proportionnellement aux points
        // Prend en compte : différence d'ELO, points du gagnant, écart de points
        const opponentEloChange = this.scoringService.calculateForfeitEloGain(
          opponent.elo,      // ELO du gagnant
          forfeiter.elo,     // ELO de celui qui abandonne
          opponentScore,     // Points du gagnant
          forfeiterScore     // Points de celui qui abandonne
        );

        // Calculer 30% de l'XP normal que l'adversaire aurait reçu
        const scoreGap = Math.abs(hostScore - guestScore);
        const personalFactor = Math.min(1, opponentScore / 150); // PLAYER_POINTS_FOR_MAX_XP = 150
        const gapBonusXP = Math.floor(scoreGap / 5);
        const rawXP = 30 + 25 + gapBonusXP; // Base winner XP + gap bonus
        const fullXP = Math.max(0, Math.round(rawXP * personalFactor));
        const opponentXPGain = Math.round(fullXP * 0.3); // 30% de l'XP normal

        console.log(`✅ Gains adversaire (forfait): ELO +${opponentEloChange}, XP +${opponentXPGain} (30% de ${fullXP})`);

        const opponentNewElo = opponent.elo + opponentEloChange;

        // ✅ ÉTAPE 1.4 : Appliquer les changements en base
        // Mettre à jour l'ELO du joueur qui abandonne (pénalité)
        await this.prisma.user.update({
          where: { id: forfeiter.id },
          data: { elo: forfeiterNewElo }
        });

        // ✅ Mettre à jour l'ELO et XP de l'adversaire (toujours, dans tous les cas)
        // Mettre à jour l'utilisateur directement (similaire à updateUserProgress)
        const opponentUser = await this.prisma.user.findUnique({
          where: { id: opponent.id },
        });

        if (opponentUser) {
          const newElo = opponentUser.elo + opponentEloChange;

          // Récupérer la progression actuelle
          const currentProgress = opponentUser.topicsProgress as any || {
            generalXP: 0,
            level: 1,
            subTopics: {},
            mainTopics: {},
          };

          // Ajouter XP général (30% de l'XP normal)
          const oldGeneralXP = currentProgress.generalXP || 0;
          currentProgress.generalXP = oldGeneralXP + opponentXPGain;
          currentProgress.level = this.scoringService.calculateLevel(currentProgress.generalXP);

          // Ajouter XP au sujet spécifique si topicId fourni
          if (debate.topicId) {
            const topic = await this.prisma.topic.findUnique({
              where: { id: debate.topicId },
            });

            if (topic) {
              if (topic.isMainTopic) {
                // Topic principal
                if (!currentProgress.mainTopics[debate.topicId]) {
                  currentProgress.mainTopics[debate.topicId] = { xp: 0, lastUpdate: new Date().toISOString() };
                }
                currentProgress.mainTopics[debate.topicId].xp += opponentXPGain;
                currentProgress.mainTopics[debate.topicId].lastUpdate = new Date().toISOString();
              } else {
                // Sous-topic
                if (!currentProgress.subTopics[debate.topicId]) {
                  currentProgress.subTopics[debate.topicId] = { xp: 0, lastActivity: new Date().toISOString() };
                }
                currentProgress.subTopics[debate.topicId].xp += opponentXPGain;
                currentProgress.subTopics[debate.topicId].lastActivity = new Date().toISOString();

                // Ajouter XP au topic parent
                if (topic.parentId) {
                  if (!currentProgress.mainTopics[topic.parentId]) {
                    currentProgress.mainTopics[topic.parentId] = {
                      xp: 0,
                      lastUpdate: new Date().toISOString()
                    };
                  }
                  const parentXpGain = Math.floor(opponentXPGain * 0.5);
                  currentProgress.mainTopics[topic.parentId].xp += parentXpGain;
                  currentProgress.mainTopics[topic.parentId].lastUpdate = new Date().toISOString();
                }
              }
            }
          }

          // Sauvegarder en base avec incrémentation des compteurs
          await this.prisma.user.update({
            where: { id: opponent.id },
            data: {
              elo: newElo,
              topicsProgress: currentProgress,
              totalDebates: { increment: 1 },
              totalDuelDebates: { increment: 1 },
            },
          });
        }

        console.log(`📉 Pénalité appliquée: ${forfeiter.username} ${forfeiter.elo} → ${forfeiterNewElo} (${forfeiterEloChange})`);
        console.log(`✅ Adversaire ${opponent.username}: ${opponent.elo} → ${opponentNewElo} (ELO ${opponentEloChange > 0 ? '+' : ''}${opponentEloChange}, XP +${opponentXPGain})`);

        // ✅ ÉTAPE 1.5 : Sauvegarder dans le débat pour l'historique
        await this.prisma.debate.update({
          where: { id: debateId },
          data: {
            // @ts-ignore - Ces champs seront ajoutés par migration
            hostEloChange: isHost ? forfeiterEloChange : opponentEloChange,
            guestEloChange: isHost ? opponentEloChange : forfeiterEloChange,
            hostXPGain: isHost ? 0 : opponentXPGain, // Pas d'XP pour celui qui abandonne
            guestXPGain: isHost ? opponentXPGain : 0,
            hostFinalScore: hostScore,
            guestFinalScore: guestScore,
            finalWinner: isHost ? 'guest' : 'host', // L'adversaire gagne toujours
            scoringTimestamp: new Date(),
          },
        });
      }
    } catch (eloError) {
      console.error('❌ [DebatesService] Erreur lors de l\'application des pénalités ELO:', eloError.message);
      // Ne pas bloquer le forfait même si la pénalité échoue
    }

    // Mettre à jour le statut du débat
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'quit', // ✅ ASYNC : Même statut que quit() pour cohérence
        endedAt: new Date(),
      },
    });

    // 🚨 Notification Socket.IO à l'adversaire
    if (opponent) {
      this.socketGateway.emitToRoom(`debate:${debateId}`, 'opponent_quit', {
        debateId: debateId,
        quitter: {
          username: forfeiter?.username,
          isHost: isHost,
        },
        message: `${forfeiter?.username} a abandonné le débat`,
        timestamp: new Date().toISOString()
      });

      console.log('📢 [DebatesService] Notification envoyée à l\'adversaire via Socket.IO');
    }

    // ✅ BOT SYSTEM: Notify bot player service that the debate ended
    try {
      this.botPlayerService.onDebateEnded(debateId);
    } catch (botError) {
      this.logger.warn(`Bot end notification failed for debate ${debateId}: ${botError.message}`);
    }

    console.log('✅ [DebatesService] Forfeit terminé avec succès (avec pénalité ELO)');

    // 🎓 COACHING : Trigger post-debate coaching analysis
    this.n8nService.callCoachingAnalysis(debateId).catch((err) =>
      console.warn('⚠️ Coaching trigger failed after forfeit:', err.message),
    );
  }

  /**
   * ✅ ASYNC : Marque le récap comme vu pour un utilisateur
   * Ajoute l'utilisateur à la liste recapViewedBy du débat
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui a vu le récap
   */
  async markRecapViewed(debateId: string, userId: string) {
    // Vérifier si le débat existe
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      select: {
        id: true,
        hostId: true,
        guestId: true,
        recapViewedBy: true,
        status: true,
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    // Vérifier que l'utilisateur fait partie du débat
    if (debate.hostId !== userId && debate.guestId !== userId) {
      throw new BadRequestException('Vous ne faites pas partie de ce débat');
    }

    // Vérifier si l'utilisateur a déjà vu le récap
    if (debate.recapViewedBy.includes(userId)) {
      return;
    }

    // Ajouter l'utilisateur à la liste
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        recapViewedBy: {
          push: userId,
        },
      },
    });

    console.log('✅ [DebatesService] Récap marqué comme vu avec succès');
  }

  /**
   * Annule un débat en attente (change l'état en 'cancelled')
   * @param debateId ID du débat à annuler
   * @param userId ID de l'utilisateur qui annule (pour vérification)
   */
  async delete(debateId: string, userId: string) {
    // Vérifier si le débat existe et appartient à l'utilisateur
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        _count: {
          select: { arguments: true }
        }
      }
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    if (debate.hostId !== userId) {
      throw new BadRequestException('Vous ne pouvez pas annuler ce débat');
    }

    // ✅ FIX: Permettre l'annulation si:
    // - Le débat est en attente (waiting)
    // - OU le débat est réservé (reserved) et n'a pas encore d'arguments soumis
    // Cela permet d'annuler même si un guest a rejoint un débat async mais qu'aucun argument n'a été envoyé
    const hasNoArguments = debate._count.arguments === 0;
    const canCancel = debate.status === 'waiting' ||
                     (debate.status === 'reserved' && hasNoArguments) ||
                     (debate.status === 'active' && hasNoArguments);

    if (!canCancel) {
      throw new BadRequestException('Impossible d\'annuler un débat qui a déjà commencé');
    }

    // Changer l'état du débat en 'cancelled' au lieu de le supprimer
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'cancelled',
        endedAt: new Date(), // Marquer la date d'annulation
        // Nettoyer les données de réservation si nécessaire
        reservedBy: null,
        reservedAt: null,
      },
    });

    // Émettre l'événement d'annulation via Socket.IO pour informer les autres utilisateurs
    try {
      this.socketGateway.server.to(`debate:${debateId}`).emit('debate_cancelled', {
        debateId: debateId,
        message: 'Le débat a été annulé par son créateur'
      });
    } catch (socketError) {
      console.warn('⚠️ Erreur lors de l\'émission de l\'événement debate_cancelled:', socketError);
    }

    console.log(`🚫 Débat ${debateId} annulé par l'utilisateur ${userId}`);
  }

  /**
   * ✅ NOUVEAU : Propose l'arrêt du débat à l'adversaire
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui propose
   * @param username Nom d'utilisateur de celui qui propose
   */
  async proposeDebateEnd(debateId: string, userId: string, username: string) {
    console.log('🤝 [DebatesService] Début de proposeDebateEnd():', { debateId, userId, username });

    // Vérifier si le débat existe et est actif
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: { select: { id: true, username: true } },
        guest: { select: { id: true, username: true } },
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    if (debate.status !== 'active') {
      throw new BadRequestException('Ce débat n\'est pas actif');
    }

    // Vérifier que l'utilisateur fait partie du débat
    if (debate.hostId !== userId && debate.guestId !== userId) {
      throw new BadRequestException('Vous ne faites pas partie de ce débat');
    }

    // ✅ NOUVEAU : Vérifier si une proposition est déjà en cours
    if (debate.stopProposedBy) {
      throw new BadRequestException('Une proposition d\'arrêt est déjà en cours');
    }

    // ✅ NOUVEAU : Persister la proposition dans la DB
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        stopProposedBy: userId,
        stopProposedAt: new Date(),
      },
    });

    console.log('🔔 [DebatesService] Proposition persistée et envoi via Socket.IO');

    // 🚨 Notification Socket.IO à l'adversaire
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_end_proposed', {
      debateId: debateId,
      proposerUserId: userId,
      proposerUsername: username,
      timestamp: new Date().toISOString()
    });

    // ✅ BOT SYSTEM: Notify bot player service about the end proposal (fire-and-forget)
    // Bot will automatically accept or refuse based on argument counts
    this.botPlayerService.onEndProposed(debateId, userId).catch((botError) => {
      this.logger.warn(`Bot end proposal notification failed for debate ${debateId}: ${botError.message}`);
    });

    console.log('✅ [DebatesService] Proposition d\'arrêt envoyée avec succès');
  }

  /**
   * ✅ NOUVEAU : Vérifie s'il y a des arguments en cours d'analyse dans un débat
   * Utilise le nouveau champ state pour identifier les arguments en cours
   * @param debateId ID du débat à vérifier
   * @returns Object avec le statut et les détails des arguments en cours
   */
  async checkPendingArguments(debateId: string) {
    console.log('🔍 [DebatesService] Vérification des arguments en cours d\'analyse pour débat:', debateId);
    
    // Récupérer tous les arguments du débat
    const debateArguments = await this.prisma.argument.findMany({
      where: { 
        debateId,
        isArgument: true, // Seulement les vrais arguments (pas les rejets)
        repetition: false // Pas les répétitions
      },
      select: {
        id: true,
        turnIndex: true,
        cleanText: true,
        justification: true,
        reliability: true,
        impact: true,
        scoreTotal: true,
        createdAt: true,
        // state: true, // ✅ Nouveau champ (TypeScript pas encore à jour)
        user: {
          select: { username: true }
        }
      },
      orderBy: { turnIndex: 'desc' } // Du plus récent au plus ancien
    });

    // Identifier les arguments en cours d'analyse
    const pendingArguments = debateArguments.filter(arg => {
      // ✅ NOUVEAU : Vérification basée sur le state (quand TypeScript sera à jour)
      // const stateBasedPending = ['submitted', 'processing_m1', 'processing_m2', 'processing_m3'].includes(arg.state);
      
      // ✅ FALLBACK : Vérification basée sur les anciens champs
      const m1Pending = arg.cleanText === "";
      const m3Pending = arg.justification === "Score calculé automatiquement.";
      
      return m1Pending || m3Pending;
    });

    const hasPendingArguments = pendingArguments.length > 0;
    
    if (hasPendingArguments) {
      console.log('⚠️ [DebatesService] Arguments en cours d\'analyse détectés:', {
        count: pendingArguments.length,
        argumentIds: pendingArguments.map(arg => arg.id),
        details: pendingArguments.map(arg => ({
          id: arg.id,
          turnIndex: arg.turnIndex,
          username: arg.user.username,
          m1Pending: arg.cleanText === "",
          m3Pending: arg.justification === "Score calculé automatiquement.",
          timeSinceCreation: Date.now() - arg.createdAt.getTime()
        }))
      });
    } else {
      console.log('✅ [DebatesService] Aucun argument en cours d\'analyse');
    }

    return {
      hasPendingArguments,
      pendingCount: pendingArguments.length,
      pendingArguments: pendingArguments.map(arg => ({
        id: arg.id,
        turnIndex: arg.turnIndex,
        username: arg.user.username,
        cleanTextPending: arg.cleanText === "",
        justificationPending: arg.justification === "Score calculé automatiquement.",
        createdAt: arg.createdAt
      })),
      lastArgument: debateArguments.length > 0 ? {
        id: debateArguments[0].id,
        turnIndex: debateArguments[0].turnIndex,
        username: debateArguments[0].user.username,
        isPending: pendingArguments.some(p => p.id === debateArguments[0].id)
      } : null
    };
  }

  /**
   * ✅ NOUVEAU : Accepter l'arrêt du débat avec vérification de sécurité
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui accepte
   * @param username Nom d'utilisateur de celui qui accepte
   */
  async acceptDebateEndWithSecurity(debateId: string, userId: string, username: string, attempt: number = 0) {
    const MAX_ATTEMPTS = 6;        // 30 secondes max de polling
    const MAX_WAIT_MS = 60000;     // 60s timeout absolu par argument

    console.log(`✅ [DebatesService] acceptDebateEndWithSecurity() attempt=${attempt}/${MAX_ATTEMPTS}:`, { debateId, userId, username });

    // ✅ NOUVEAU : Vérifier le statut du débat AVANT tout (évite spam post-forfait)
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      select: { status: true }
    });

    if (!debate || debate.status !== 'active') {
      console.log('🛑 [DebatesService] Débat non actif, arrêt du polling');
      return;
    }

    // ✅ NOUVEAU : Persister l'acceptation dans la DB (seulement au premier appel)
    if (attempt === 0) {
      await this.prisma.debate.update({
        where: { id: debateId },
        data: {
          stopAcceptedBy: userId,
          stopAcceptedAt: new Date(),
        },
      });
      console.log('✅ [DebatesService] Acceptation persistée dans la DB');
    }

    // ✅ NOUVEAU : Vérifier le nombre de tentatives
    if (attempt >= MAX_ATTEMPTS) {
      console.log('⚠️ [DebatesService] Max tentatives atteint, forcer la fin avec flag erreur');
      await this.forceDebateEndWithAnalysisError(debateId, userId, username);
      return;
    }

    // 1. Vérifier s'il y a des arguments en cours d'analyse
    const pendingCheck = await this.checkPendingArguments(debateId);

    if (pendingCheck.hasPendingArguments) {
      // ✅ NOUVEAU : Vérifier timeout absolu par argument
      const oldestPending = pendingCheck.pendingArguments[0];
      const waitTime = Date.now() - new Date(oldestPending.createdAt).getTime();

      if (waitTime > MAX_WAIT_MS) {
        console.log(`⚠️ [DebatesService] Timeout absolu atteint (${waitTime}ms > ${MAX_WAIT_MS}ms)`);
        await this.forceDebateEndWithAnalysisError(debateId, userId, username);
        return;
      }

      // ✅ NOUVEAU : Envoyer message progressif selon le temps d'attente
      const progressMessage = this.getProgressiveWaitMessage(waitTime, attempt);

      console.log(`⏳ [DebatesService] Arguments en cours d'analyse (attempt ${attempt}), severity: ${progressMessage.severity}`);

      this.socketGateway.emitToRoom(`debate:${debateId}`, 'argument_analysis_pending', {
        debateId: debateId,
        ...progressMessage,
        pendingArguments: pendingCheck.pendingArguments,
        attempt,
        maxAttempts: MAX_ATTEMPTS
      });

      // Programmer une nouvelle vérification dans 5 secondes avec compteur incrémenté
      setTimeout(async () => {
        try {
          await this.acceptDebateEndWithSecurity(debateId, userId, username, attempt + 1);
        } catch (error) {
          console.error('❌ [DebatesService] Erreur lors de la vérification différée:', error.message);
        }
      }, 5000);

      return;
    }

    // 2. Si aucun argument en cours, procéder à l'arrêt normal
    console.log('✅ [DebatesService] Aucun argument en cours, procéder à l\'arrêt du débat');
    await this.acceptDebateEnd(debateId, userId, username);
  }

  /**
   * ✅ NOUVEAU : Retourne un message progressif selon le temps d'attente
   */
  private getProgressiveWaitMessage(waitTimeMs: number, attempt: number): { message: string; submessage: string; severity: 'info' | 'warning' | 'error' } {
    if (waitTimeMs < 10000) {
      return {
        message: 'Notation en cours du dernier argument...',
        submessage: 'Résumé de fin de partie dans quelques secondes',
        severity: 'info'
      };
    } else if (waitTimeMs < 30000) {
      return {
        message: 'L\'analyse prend plus de temps que prévu...',
        submessage: 'Merci de patienter encore un peu',
        severity: 'warning'
      };
    } else {
      return {
        message: 'Problème détecté côté serveur',
        submessage: 'Le débat sera clôturé automatiquement',
        severity: 'error'
      };
    }
  }

  /**
   * ✅ NOUVEAU : Forcer la fin du débat avec flag d'erreur d'analyse
   * Le perdant ne sera pas pénalisé en ELO
   */
  async forceDebateEndWithAnalysisError(debateId: string, userId: string, username: string) {
    console.log(`⚠️ [DebatesService] Forçage fin de débat avec erreur d'analyse: ${debateId}`);

    // 1. Marquer le débat avec le flag d'erreur
    await this.prisma.debate.update({
      where: { id: debateId },
      data: { analysisErrorFlag: true }
    });

    // 2. Notifier les clients de l'erreur
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'analysis_error_detected', {
      debateId,
      message: 'Erreur d\'analyse détectée',
      submessage: 'Le score ELO du perdant ne sera pas impacté',
      timestamp: new Date().toISOString()
    });

    // 3. Procéder à la fin normale (le scoring prendra en compte le flag)
    await this.acceptDebateEnd(debateId, userId, username);
  }

  /**
   * ✅ NOUVEAU : Accepter l'arrêt du débat (fin du débat)
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui accepte
   * @param username Nom d'utilisateur de celui qui accepte
   */
  async acceptDebateEnd(debateId: string, userId: string, username: string) {
    console.log('✅ [DebatesService] Début de acceptDebateEnd():', { debateId, userId, username });

    // Vérifier si le débat existe et est actif
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: { select: { id: true, username: true, isBot: true } },
        guest: { select: { id: true, username: true, isBot: true } },
      },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    if (debate.status !== 'active') {
      // Idempotent: if already completed/ended, just return silently
      if (['completed', 'ended', 'scored', 'quit'].includes(debate.status)) {
        console.log(`ℹ️ [DebatesService] Débat déjà terminé (status=${debate.status}), ignoré`);
        return;
      }
      throw new BadRequestException('Ce débat n\'est pas actif');
    }

    // 🛑 ÉTAPE 1 : Arrêter tous les timers du débat
    console.log('🛑 [DebatesService] Arrêt des timers pour le débat');
    
    try {
      // Arrêter le timer de l'hôte
      if (debate.hostId) {
        await this.timerService.deleteTimer(debateId, debate.hostId);
        console.log('✅ Timer hôte supprimé');
      }
      
      // Arrêter le timer de l'invité
      if (debate.guestId) {
        await this.timerService.deleteTimer(debateId, debate.guestId);
        console.log('✅ Timer invité supprimé');
      }
    } catch (error) {
      console.log('⚠️ [DebatesService] Erreur lors de l\'arrêt des timers (probablement déjà arrêtés):', error.message);
    }

    // 🏁 ÉTAPE 2 : Mettre à jour le statut du débat (terminé par accord mutuel)
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'completed',
        endedAt: new Date(),
      },
    });

    // 📊 ÉTAPE 3 : Calculer immédiatement le scoring pour éviter les race conditions
    console.log('📊 [DebatesService] Calcul immédiat du scoring pour éviter race conditions');
    try {
      // Récupérer tous les arguments pour calculer les scores
      const debateArguments = await this.prisma.argument.findMany({
        where: { debateId },
        select: {
          userId: true,
          scoreTotal: true,
        },
      });

      // Calculer les scores totaux
      const hostScore = debateArguments
        .filter(arg => arg.userId === debate.hostId)
        .reduce((sum, arg) => sum + arg.scoreTotal, 0);

      const guestScore = debateArguments
        .filter(arg => arg.userId === debate.guestId)
        .reduce((sum, arg) => sum + arg.scoreTotal, 0);

      // Déterminer le gagnant
      let winner: 'host' | 'guest' | 'tie' = 'tie';
      if (hostScore > guestScore) {
        winner = 'host';
      } else if (guestScore > hostScore) {
        winner = 'guest';
      }

      // Appeler finalizeDebate pour calculer et persister ELO/XP
      const debateResult = {
        hostScore,
        guestScore,
        winner,
      };

      await this.scoringService.finalizeDebate(debateId, debateResult);
      console.log('✅ [DebatesService] Scoring calculé et persisté avec succès');

      // Track debate completed - use real user as distinctId, skip bot events
      const realUserId = debate.host?.isBot ? debate.guestId : debate.hostId;
      if (realUserId) {
        const debateType = debate.isLive ? 'live_duel' : 'async_duel';
        const totalArguments = debateArguments.length;
        const durationMinutes = debate.createdAt
          ? Math.round((new Date().getTime() - new Date(debate.createdAt).getTime()) / 60000)
          : 0;

        this.posthog.trackDebateCompleted(
          realUserId,
          debateId,
          debateType,
          totalArguments,
          durationMinutes,
          hostScore,
          guestScore,
        );
      }
    } catch (error) {
      console.error('❌ [DebatesService] Erreur lors du calcul du scoring:', error);
      // Ne pas bloquer la fin du débat si le scoring échoue
      // Les utilisateurs pourront toujours voir le récap avec un fallback
    }

    // 🚨 ÉTAPE 4 : Émettre événement Socket.IO global de fin de débat
    console.log('🔔 [DebatesService] Émission de l\'événement debate_ended');
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_ended', {
      debateId: debateId,
      reason: 'mutual_agreement',
      acceptedBy: username,
      message: 'Débat terminé par accord mutuel',
      timestamp: new Date().toISOString()
    });

    // ✅ BOT SYSTEM: Notify bot player service that the debate ended
    try {
      this.botPlayerService.onDebateEnded(debateId);
    } catch (botError) {
      this.logger.warn(`Bot end notification failed for debate ${debateId}: ${botError.message}`);
    }

    console.log('✅ [DebatesService] Débat terminé par accord mutuel - timers arrêtés, scoring calculé et événement émis');

    // 🎓 COACHING : Trigger post-debate coaching analysis
    this.n8nService.callCoachingAnalysis(debateId).catch((err) =>
      console.warn('⚠️ Coaching trigger failed after mutual agreement:', err.message),
    );
  }

  /**
   * ✅ NOUVEAU : Refuser l'arrêt du débat
   * @param debateId ID du débat
   * @param userId ID de l'utilisateur qui refuse
   * @param username Nom d'utilisateur de celui qui refuse
   */
  async refuseDebateEnd(debateId: string, userId: string, username: string) {
    console.log('❌ [DebatesService] Début de refuseDebateEnd():', { debateId, userId, username });

    // Vérifier si le débat existe et est actif
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
    });

    if (!debate) {
      throw new NotFoundException(`Débat #${debateId} non trouvé`);
    }

    if (debate.status !== 'active') {
      throw new BadRequestException('Ce débat n\'est pas actif');
    }

    // ✅ Clear the proposal so a new one can be made
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        stopProposedBy: null,
        stopProposedAt: null,
      },
    });

    console.log('🔔 [DebatesService] Envoi du refus via Socket.IO');

    // 🚨 Notification Socket.IO à l'expéditeur de la proposition
    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_end_refused', {
      debateId: debateId,
      refuserUsername: username,
      timestamp: new Date().toISOString()
    });

    console.log('✅ [DebatesService] Refus de proposition envoyé avec succès');
  }

  /**
   * ✅ ASYNC : Vérifie les limites de débats asynchrones pour un utilisateur
   */
  async checkAsyncDebateLimit(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    const userRole = (user.role || 'FREE') as SubscriptionRole;
    const limit = ASYNC_DEBATE_LIMITS[userRole] || ASYNC_DEBATE_LIMITS.FREE;

    // Compter les débats async actifs de l'utilisateur
    const activeAsyncCount = await this.prisma.debate.count({
      where: {
        OR: [
          { hostId: userId },
          { guestId: userId }
        ],
        isLive: false,
        status: {
          in: ['waiting', 'reserved', 'active']
        }
      }
    });

    if (activeAsyncCount >= limit) {
      throw new BadRequestException(
        `Vous avez atteint la limite de ${limit} débats asynchrones simultanés pour le plan ${userRole}`
      );
    }
  }

  /**
   * ✅ ASYNC : Récupère le nombre de débats asynchrones simultanés actifs pour un utilisateur
   * Utilisé par le frontend pour afficher la limite et bloquer si nécessaire
   */
  async getAsyncDebateCount(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true }
    });

    if (!user) {
      throw new BadRequestException('Utilisateur non trouvé');
    }

    const userRole = (user.role || 'FREE') as SubscriptionRole;
    const limit = ASYNC_DEBATE_LIMITS[userRole] || ASYNC_DEBATE_LIMITS.FREE;

    // Compter les débats async actifs de l'utilisateur
    const count = await this.prisma.debate.count({
      where: {
        OR: [
          { hostId: userId },
          { guestId: userId }
        ],
        isLive: false,
        status: {
          in: ['waiting', 'reserved', 'active']
        }
      }
    });

    return {
      count,
      limit,
      remaining: Math.max(0, limit - count),
      canCreate: count < limit,
      role: userRole
    };
  }

  /**
   * ✅ ASYNC : Récupère les débats asynchrones d'un utilisateur
   */
  async getMyAsyncDebates(userId: string) {
    // ✅ Auto-forfeit: traiter immédiatement les débats dont le tour a expiré (>24h)
    // Évite d'attendre le worker qui vérifie toutes les 5 minutes
    await this.autoForfeitExpiredTurns();

    // D'abord, vérifier tous les débats de l'utilisateur
    const allUserDebates = await this.prisma.debate.findMany({
      where: {
        OR: [
          { hostId: userId },
          { guestId: userId }
        ]
      },
      select: {
        id: true,
        title: true,
        isLive: true,
        status: true,
        hostId: true,
        guestId: true,
      }
    });

    // ✅ NOUVEAU : Calculer la date limite pour les débats 'quit' (7 jours)
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    // Récupérer les débats async actifs
    // ✅ ASYNC : Logique complexe pour filtrer correctement :
    //   - 'waiting' : débats créés par moi en attente d'adversaire
    //   - 'reserved' : seulement si je suis l'hôte (quelqu'un a rejoint mais n'a pas encore joué)
    //   - 'active' : débats en cours où au moins 1 argument a été envoyé
    //   - 'quit' : débats terminés par forfait (visibles pendant 7 jours pour voir le résultat)
    const allDebates = await this.prisma.debate.findMany({
      where: {
        AND: [
          // Condition 1 : Appartient à l'utilisateur
          {
            OR: [
              { hostId: userId },
              { guestId: userId }
            ]
          },
          // Condition 2 : Débat asynchrone
          { isLive: false },
          // Condition 3 : Statut valide
          {
            OR: [
              // Débats actifs
              {
                status: {
                  in: ['waiting', 'reserved', 'active']
                }
              },
              // Débats terminés récents (moins de 7 jours) - pour afficher "Voir le résultat"
              {
                status: { in: ['quit', 'completed', 'scored'] },
                endedAt: {
                  gte: sevenDaysAgo
                }
              }
            ]
          }
        ]
      },
      include: {
        host: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
            selectedAvatarId: true,
            elo: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc',
      },
    });

    // ✅ ASYNC : Filtrer pour exclure les débats 'reserved' où je suis l'invité
    // ✅ CORRIGÉ : On ne filtre PLUS par recapViewedBy ici - on laisse le frontend gérer l'affichage
    // Le débat restera visible avec une overlay "Voir le résultat" jusqu'à ce que l'utilisateur le consulte
    const debates = allDebates.filter(debate => {
      // Si le débat est 'reserved' et que je suis l'invité, ne pas montrer
      if (debate.status === 'reserved' && debate.guestId === userId) {
        return false;
      }

      // ✅ NOUVEAU COMPORTEMENT : Les débats 'quit' restent visibles même après avoir vu le récap
      // Ils seront filtrés côté frontend après que les 2 joueurs aient vu le récap
      // Pour l'instant, on ne filtre que si les DEUX joueurs ont vu le récap
      const isFinished = debate.status === 'quit' || debate.status === 'completed' || debate.status === 'scored';
      if (isFinished && debate.recapViewedBy && debate.recapViewedBy.length >= 2) {
        // Les deux joueurs ont vu le récap, on peut masquer le débat
        return false;
      }

      return true;
    });

    // ✅ OPTIMISÉ : Récupérer tous les compteurs d'arguments en une seule requête groupée
    const debateIds = debates.map(d => d.id);

    // Requête groupée pour tous les arguments de tous les débats
    const argumentCounts = await this.prisma.argument.groupBy({
      by: ['debateId', 'userId'],
      where: {
        debateId: { in: debateIds }
      },
      _count: {
        id: true
      }
    });

    // Créer un Map pour un accès rapide aux compteurs
    const countsMap = new Map<string, { host: number; guest: number }>();

    debates.forEach(debate => {
      countsMap.set(debate.id, { host: 0, guest: 0 });
    });

    argumentCounts.forEach(count => {
      const debateCounters = countsMap.get(count.debateId);
      if (debateCounters) {
        const debate = debates.find(d => d.id === count.debateId);
        if (debate) {
          if (count.userId === debate.hostId) {
            debateCounters.host = count._count.id;
          } else if (count.userId === debate.guestId) {
            debateCounters.guest = count._count.id;
          }
        }
      }
    });

    // Construire le résultat final avec les compteurs
    const debatesWithCounts = debates.map(debate => {
      const counts = countsMap.get(debate.id) || { host: 0, guest: 0 };
      return {
        ...debate,
        _count: {
          arguments: counts.host + counts.guest,
          hostArguments: counts.host,
          guestArguments: counts.guest,
        },
      };
    });

    // Trier par urgence : c'est le tour de l'utilisateur + temps restant
    const sortedDebates = debatesWithCounts.sort((a, b) => {
      const aIsMyTurn = a.currentTurnUserId === userId;
      const bIsMyTurn = b.currentTurnUserId === userId;

      // Priorité 1 : C'est mon tour
      if (aIsMyTurn && !bIsMyTurn) return -1;
      if (!aIsMyTurn && bIsMyTurn) return 1;

      // Priorité 2 : Temps restant (si turnStartedAt existe)
      if (a.turnStartedAt && b.turnStartedAt) {
        return new Date(a.turnStartedAt).getTime() - new Date(b.turnStartedAt).getTime();
      }

      // Par défaut : date de création
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    return sortedDebates;
  }

  /**
   * Auto-forfeit expired turns + cleanup zombie debates.
   * Called on list load for instant reaction.
   */
  private async autoForfeitExpiredTurns(): Promise<void> {
    try {
      // 1. Cleanup zombie debates: active/reserved with 0 arguments and older than 1 hour
      const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
      const zombieDebates = await this.prisma.debate.findMany({
        where: {
          isLive: false,
          status: { in: ['active', 'reserved'] },
          createdAt: { lte: oneHourAgo },
        },
        include: {
          _count: { select: { arguments: true } },
        },
      });

      for (const debate of zombieDebates) {
        if (debate._count.arguments === 0) {
          await this.prisma.debate.update({
            where: { id: debate.id },
            data: { status: 'cancelled', endedAt: new Date() },
          });
          this.logger.log(`🧹 Zombie debate cancelled: ${debate.id} (${debate.status}, 0 args, created ${debate.createdAt.toISOString()})`);
          try { this.botPlayerService.onDebateEnded(debate.id); } catch (_) {}
        }
      }

      // 2. Auto-forfeit: active debates with turn expired (>24h)
      const timeoutDate = new Date(Date.now() - 24 * 60 * 60 * 1000);

      const expiredDebates = await this.prisma.debate.findMany({
        where: {
          isLive: false,
          status: 'active',
          turnStartedAt: { lte: timeoutDate },
        },
        include: {
          host: { select: { id: true, username: true, elo: true } },
          guest: { select: { id: true, username: true, elo: true } },
        },
      });

      for (const debate of expiredDebates) {
        try {
          const timeoutUserId = debate.currentTurnUserId;
          const winnerId = timeoutUserId === debate.hostId ? debate.guestId : debate.hostId;
          const isHostTimeout = timeoutUserId === debate.hostId;

          // Calculer les scores
          const debateArguments = await this.prisma.argument.findMany({
            where: { debateId: debate.id },
            select: { userId: true, scoreTotal: true },
          });

          const hostScore = debateArguments
            .filter(a => a.userId === debate.hostId)
            .reduce((sum, a) => sum + a.scoreTotal, 0);
          const guestScore = debateArguments
            .filter(a => a.userId === debate.guestId)
            .reduce((sum, a) => sum + a.scoreTotal, 0);

          // ELO: timeout player loses 10, opponent gains calculated amount
          const timeoutUser = isHostTimeout ? debate.host : debate.guest;
          const opponentUser = isHostTimeout ? debate.guest : debate.host;
          const opponentScore = isHostTimeout ? guestScore : hostScore;
          const timeoutUserScore = isHostTimeout ? hostScore : guestScore;

          const timeoutEloChange = -10;
          const opponentEloChange = this.scoringService.calculateForfeitEloGain(
            opponentUser.elo, timeoutUser.elo, opponentScore, timeoutUserScore,
          );

          // Update ELOs
          await this.prisma.user.update({
            where: { id: timeoutUserId },
            data: { elo: Math.max(0, timeoutUser.elo + timeoutEloChange) },
          });
          await this.prisma.user.update({
            where: { id: winnerId },
            data: { elo: opponentUser.elo + opponentEloChange },
          });

          // Update debate
          const now = new Date();
          await this.prisma.debate.update({
            where: { id: debate.id },
            data: {
              status: 'completed',
              finalWinner: winnerId === debate.hostId ? 'host' : 'guest',
              endedAt: now,
              hostEloChange: isHostTimeout ? timeoutEloChange : opponentEloChange,
              guestEloChange: isHostTimeout ? opponentEloChange : timeoutEloChange,
              hostFinalScore: hostScore,
              guestFinalScore: guestScore,
              scoringTimestamp: now,
            },
          });

          // Notify bot system
          try {
            this.botPlayerService.onDebateEnded(debate.id);
          } catch (_) {}

          // 🎓 COACHING : Trigger post-debate coaching analysis
          this.n8nService.callCoachingAnalysis(debate.id).catch((err) =>
            this.logger.warn(`⚠️ Coaching trigger failed after auto-forfeit: ${err.message}`),
          );

          this.logger.log(`⏰ Auto-forfeit: debate ${debate.id} - ${isHostTimeout ? debate.host.username : debate.guest?.username} timed out`);
        } catch (error) {
          this.logger.error(`Auto-forfeit error for debate ${debate.id}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`Auto-forfeit check failed: ${error.message}`);
    }
  }

  /**
   * ✅ ASYNC : Propose l'arrêt d'un débat asynchrone
   */
  async proposeStop(userId: string, debateId: string) {
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: { select: { id: true, username: true, selectedAvatarId: true } },
        guest: { select: { id: true, username: true, selectedAvatarId: true } },
      },
    });

    if (!debate) {
      throw new NotFoundException('Débat non trouvé');
    }

    if (debate.hostId !== userId && debate.guestId !== userId) {
      throw new BadRequestException('Vous ne faites pas partie de ce débat');
    }

    if (debate.stopProposedBy) {
      throw new BadRequestException('Une proposition d\'arrêt est déjà en cours');
    }

    // Limite : une seule proposition par utilisateur par tour
    const existingEvents: any[] = (debate as any).stopEvents || [];
    const alreadyProposedThisTurn = existingEvents.some(
      (e: any) => e.type === 'proposed' && e.userId === userId && e.turnNumber === debate.turnNumber,
    );
    if (alreadyProposedThisTurn) {
      throw new BadRequestException('Vous ne pouvez proposer l\'arrêt qu\'une fois par tour');
    }

    const proposerUsername = userId === debate.hostId
      ? debate.host.username
      : debate.guest?.username;

    const newEvent = {
      type: 'proposed',
      userId,
      username: proposerUsername,
      at: new Date().toISOString(),
      turnNumber: debate.turnNumber,
    };

    const updatedDebate = await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        stopProposedBy: userId,
        stopProposedAt: new Date(),
        stopEvents: [...existingEvents, newEvent],
      },
      include: {
        host: { select: { id: true, username: true, selectedAvatarId: true } },
        guest: { select: { id: true, username: true, selectedAvatarId: true } },
      },
    });

    this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_end_proposed', {
      debateId,
      proposerUserId: userId,
      proposerUsername,
      timestamp: new Date().toISOString(),
    });

    // Push notification à l'adversaire
    const opponentId = userId === debate.hostId ? debate.guestId : debate.hostId;
    if (opponentId) {
      this.notificationService.sendStopProposedNotification(opponentId, debateId, proposerUsername)
        .catch(err => this.logger.warn(`Stop-proposed push failed: ${err.message}`));
    }

    // BOT SYSTEM: Notify bot player service about the end proposal (fire-and-forget)
    this.botPlayerService.onEndProposed(debateId, userId).catch((botError) => {
      console.warn(`Bot end proposal notification failed for debate ${debateId}: ${botError.message}`);
    });

    return updatedDebate;
  }

  /**
   * ✅ ASYNC : Répond à une proposition d'arrêt
   */
  async respondStop(userId: string, debateId: string, accept: boolean) {
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        host: {
          select: {
            id: true,
            username: true,
          },
        },
        guest: {
          select: {
            id: true,
            username: true,
          },
        },
      },
    });

    if (!debate) {
      throw new NotFoundException('Débat non trouvé');
    }

    if (!debate.stopProposedBy) {
      throw new BadRequestException('Aucune proposition d\'arrêt en cours');
    }

    if (debate.stopProposedBy === userId) {
      throw new BadRequestException('Vous ne pouvez pas répondre à votre propre proposition');
    }

    if (accept) {
      // Compter les arguments
      const hostArgsCount = await this.prisma.argument.count({
        where: {
          debateId,
          userId: debate.hostId,
          isArgument: true,
        },
      });

      const guestArgsCount = await this.prisma.argument.count({
        where: {
          debateId,
          userId: debate.guestId,
          isArgument: true,
        },
      });

      // ✅ CORRECTION : Calculer et persister le scoring AVANT de terminer le débat
      try {
        console.log('🎯 [respondStop] Calcul du scoring pour débat:', debateId);

        // Récupérer tous les arguments avec leurs scores
        const allArguments = await this.prisma.argument.findMany({
          where: {
            debateId,
            isArgument: true,
          },
          select: {
            id: true,
            userId: true,
            scoreTotal: true,
            reliability: true,
            impact: true,
          },
        });

        // Calculer les totaux par joueur
        let hostScore = 0;
        let guestScore = 0;

        for (const arg of allArguments) {
          if (arg.userId === debate.hostId) {
            hostScore += arg.scoreTotal || 0;
          } else if (arg.userId === debate.guestId) {
            guestScore += arg.scoreTotal || 0;
          }
        }

        // Déterminer le gagnant
        let winner: 'host' | 'guest' | 'tie';
        if (hostScore > guestScore) {
          winner = 'host';
        } else if (guestScore > hostScore) {
          winner = 'guest';
        } else {
          winner = 'tie';
        }

        const debateResult = {
          hostScore,
          guestScore,
          winner,
        };

        await this.scoringService.finalizeDebate(debateId, debateResult);
        console.log('✅ [respondStop] Scoring calculé et persisté avec succès');
      } catch (error) {
        console.error('❌ [respondStop] Erreur lors du calcul du scoring:', error);
        // Ne pas bloquer la fin du débat si le scoring échoue
      }

      // 🛑 Arrêter tous les timers du débat
      try {
        if (debate.hostId) {
          await this.timerService.deleteTimer(debateId, debate.hostId);
        }
        if (debate.guestId) {
          await this.timerService.deleteTimer(debateId, debate.guestId);
        }
      } catch (timerError) {
        this.logger.warn(`Timer cleanup failed in respondStop for debate ${debateId}: ${timerError.message}`);
      }

      // Terminer le débat
      // Si finalizeDebate a réussi, le status est déjà 'scored' → on met juste endedAt
      // Si finalizeDebate a échoué, le status est encore 'active' → on le passe à 'completed' en fallback
      const currentDebate = await this.prisma.debate.findUnique({
        where: { id: debateId },
        select: { status: true, stopEvents: true },
      });

      // Persister l'événement "accepted" dans stopEvents
      const existingEvents: any[] = (currentDebate as any)?.stopEvents || [];
      const acceptedByUsername = userId === debate.hostId
        ? debate.host.username
        : debate.guest.username;
      const acceptedEvent = {
        type: 'accepted',
        userId,
        username: acceptedByUsername,
        at: new Date().toISOString(),
        turnNumber: debate.turnNumber,
      };

      const updatedDebate = await this.prisma.debate.update({
        where: { id: debateId },
        data: {
          ...(currentDebate?.status !== 'scored' && { status: 'completed' }),
          endedAt: new Date(),
          stopEvents: [...existingEvents, acceptedEvent],
        },
      });

      this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_ended', {
        debateId,
        reason: 'mutual_agreement',
        acceptedBy: acceptedByUsername,
        message: 'Débat terminé par accord mutuel',
        timestamp: new Date().toISOString(),
      });

      // ✅ BOT SYSTEM: Notify bot player service that the debate ended
      try {
        this.botPlayerService.onDebateEnded(debateId);
      } catch (botError) {
        this.logger.warn(`Bot end notification failed for debate ${debateId}: ${botError.message}`);
      }

      // 🎓 COACHING : Trigger post-debate coaching analysis
      this.n8nService.callCoachingAnalysis(debateId).catch((err) =>
        console.warn('⚠️ Coaching trigger failed after async stop accept:', err.message),
      );

      return updatedDebate;
    } else {
      // Refuser la proposition
      const existingEvents: any[] = (debate as any).stopEvents || [];
      const refuserUsername = userId === debate.hostId
        ? debate.host.username
        : debate.guest.username;
      const refusedEvent = {
        type: 'refused',
        userId,
        username: refuserUsername,
        at: new Date().toISOString(),
        turnNumber: debate.turnNumber,
      };

      const updatedDebate = await this.prisma.debate.update({
        where: { id: debateId },
        data: {
          stopProposedBy: null,
          stopProposedAt: null,
          stopEvents: [...existingEvents, refusedEvent],
        },
      });

      this.socketGateway.emitToRoom(`debate:${debateId}`, 'debate_end_refused', {
        debateId,
        refuserUsername,
        timestamp: new Date().toISOString(),
      });

      // Push notification au proposeur
      if (debate.stopProposedBy) {
        this.notificationService.sendStopRefusedNotification(debate.stopProposedBy, debateId, refuserUsername)
          .catch(err => this.logger.warn(`Stop-refused push failed: ${err.message}`));
      }

      return updatedDebate;
    }
  }
} 