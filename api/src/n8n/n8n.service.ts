import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../gateways/redis.service';
import { ConfigService } from '@nestjs/config';
import { TimerService } from '../gateways/timer.service';
import { ReportsService } from '../reports/reports.service';
import { BotPlayerService } from '../bots/bot-player.service';
import axios, { AxiosResponse } from 'axios';
import { M0ResultDto } from './dto/m0-result.dto';
import { M1ResultDto } from './dto/m1-result.dto';
import { M3ResultDto } from './dto/m3-result.dto';
import { BotArgumentRequestDto, BotArgumentResponseDto } from './dto/bot-argument.dto';
import { CoachingResultDto } from './dto/coaching-result.dto';

@Injectable()
export class N8nService {
  private readonly logger = new Logger(N8nService.name);
  private readonly webhookBaseUrl: string;
  private readonly isEnabled: boolean;
  private readonly percentage: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly timerService: TimerService,
    private readonly reportsService: ReportsService,
    @Inject(forwardRef(() => BotPlayerService))
    private readonly botPlayerService: BotPlayerService,
  ) {
    this.webhookBaseUrl = this.configService.get('N8N_WEBHOOK_BASE_URL') || 'http://localhost:5678/webhook';
    // n8n is now the default - always enabled at 100%
    this.isEnabled = true;
    this.percentage = 100;

    // Subscribe to coaching:trigger channel (published by async-timeout worker)
    this.subscribeToCoachingTrigger();
  }

  /**
   * Listen for coaching:trigger Redis messages from the async-timeout worker.
   * When a debate ends via timeout, the worker publishes here and we trigger coaching.
   */
  private async subscribeToCoachingTrigger(): Promise<void> {
    try {
      // Use a dedicated subscriber (subClient is already used by gateway)
      // We piggyback on the existing subClient by listening in the gateway's message handler
      // Instead, we subscribe on a separate connection via Redis duplicate
      const Redis = require('ioredis');
      const redisUrl = this.configService.get('REDIS_URL');
      const redisHost = this.configService.get('REDIS_HOST') || 'localhost';
      const redisPort = parseInt(this.configService.get('REDIS_PORT') || '6379');

      const sub = redisUrl
        ? new Redis(redisUrl)
        : new Redis({ host: redisHost, port: redisPort, password: this.configService.get('REDIS_PASSWORD') || undefined });

      await sub.subscribe('coaching:trigger');

      sub.on('message', (channel: string, message: string) => {
        if (channel === 'coaching:trigger') {
          try {
            const { debateId } = JSON.parse(message);
            this.logger.log(`📥 Received coaching:trigger for debate ${debateId}`);
            this.callCoachingAnalysis(debateId).catch((err) =>
              this.logger.warn(`⚠️ Coaching from Redis trigger failed: ${err.message}`),
            );
          } catch (err) {
            this.logger.error(`❌ Error parsing coaching:trigger message: ${err.message}`);
          }
        }
      });

      this.logger.log('🎓 Subscribed to coaching:trigger Redis channel');
    } catch (error) {
      this.logger.warn(`⚠️ Could not subscribe to coaching:trigger: ${error.message}`);
    }
  }

  /**
   * Extract domain name from URL for display
   * e.g., "https://www.lemonde.fr/article/123" -> "lemonde.fr"
   */
  private extractDomainFromUrl(url: string): string {
    try {
      const urlObj = new URL(url);
      // Remove 'www.' prefix if present
      return urlObj.hostname.replace(/^www\./, '');
    } catch {
      return 'Source';
    }
  }

  /**
   * Check if a source should be filtered out (Google's internal context lookups)
   * Filters out sources like "Current time information in...", "Weather in...", etc.
   */
  private shouldFilterSource(source: { title?: string; name?: string; url?: string }): boolean {
    const title = (source.title || source.name || '').toLowerCase();

    // Patterns to filter out (Google's grounding API context lookups)
    const filterPatterns = [
      /^current time/i,           // "Current time information in..."
      /^time in/i,                // "Time in Paris, FR"
      /^weather in/i,             // "Weather in..."
      /^location of/i,            // "Location of..."
      /^timezone/i,               // "Timezone information..."
      /^date and time/i,          // "Date and time in..."
      /information in .+, [a-z]{2}$/i,  // "... information in City, XX" (country code)
    ];

    return filterPatterns.some(pattern => pattern.test(title));
  }

  /**
   * Determine if we should use n8n for this processing
   */
  shouldUseN8n(debate: any): boolean {
    if (!this.isEnabled) return false;
    if (!debate.n8nM0Completed) return false; // M0 must be done
    if (!debate.n8nBranchCode) return false;

    // Progressive percentage
    return Math.random() * 100 < this.percentage;
  }

  /**
   * Call the StartDebate webhook (M0)
   */
  async callStartDebate(
    debateId: string,
    title: string,
    hostPosition: string,
    guestPosition: string,
    mode: string,
  ): Promise<void> {
    const url = `${this.webhookBaseUrl}/start-debate`;

    this.logger.log(`📤 Calling n8n StartDebate for debate ${debateId}`);

    try {
      const response: AxiosResponse = await axios.post(
        url,
        {
          debateId,
          title,
          hostPosition,
          guestPosition,
          mode,
        },
        {
          timeout: 30000, // 30s timeout
        },
      );

      this.logger.log(`✅ n8n StartDebate response received for ${debateId}`);

      // n8n may respond synchronously with M0 results, or send them via callback
      // Only save if the response contains actual data (branchCode is required)
      const branchCode = response.data?.branchCode || response.data?.branch_code;
      if (response.data && branchCode) {
        const m0Result = {
          ...response.data,
          debateId,
          branchCode, // Normalize field name
        };
        await this.saveM0Result(m0Result);
      } else {
        this.logger.log(`⏳ n8n sync response has no M0 data, waiting for callback for ${debateId}`);
      }
    } catch (error) {
      this.logger.error(`❌ n8n StartDebate failed for ${debateId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Call the MessageAnalysis webhook (M1-M2-M3)
   * Returns immediately after M1, continues M2-M3 async
   */
  async callMessageAnalysis(
    argumentId: string,
    debate: any,
    rawText: string,
    userId: string,
    argumentsHistory: string,
    last3Messages: string,
  ): Promise<M1ResultDto> {
    const branchCode = debate.n8nBranchCode;
    const url = `${this.webhookBaseUrl}/${branchCode}`;

    // Determine author role and get dimension tracking data
    const isHost = debate.hostId === userId;
    const author = isHost ? 'HOST' : 'GUEST';
    const dimensionsCoveredByAuthor = isHost
      ? (debate.n8nDimensionsCoveredHost || [])
      : (debate.n8nDimensionsCoveredGuest || []);
    const coverageBonusAwarded = isHost
      ? (debate.n8nCoverageBonusAwardedHost || false)
      : (debate.n8nCoverageBonusAwardedGuest || false);

    this.logger.log(`📤 Calling n8n MessageAnalysis (${branchCode}) for argument ${argumentId}`);

    try {
      const response: AxiosResponse = await axios.post(
        url,
        {
          argumentId,
          debateId: debate.id,
          userId,
          author,
          rawText,
          title: debate.title,
          hostPosition: debate.hostView,
          guestPosition: debate.guestView,
          nature: debate.n8nNature,
          burden: debate.n8nBurden,
          complexity: debate.n8nComplexity,
          factualPart: debate.n8nFactualPart,
          axiologicalPart: debate.n8nAxiologicalPart,
          dimensions: debate.n8nDimensions,
          mode: debate.gameMode || 'COMPETITIVE',
          language: debate.language,
          argumentsHistory,
          last3Messages,
          // Dimension tracking for bonus calculation
          allDimensions: debate.n8nDimensions || [],
          dimensionsCoveredByAuthor,
          host_dimensions_covered: debate.n8nDimensionsCoveredHost || [],
          guest_dimensions_covered: debate.n8nDimensionsCoveredGuest || [],
          coverageBonusAwarded,
        },
        {
          timeout: 15000, // 15s timeout for M1
        },
      );

      this.logger.log(`✅ n8n M1 response received for argument ${argumentId}`);

      return response.data as M1ResultDto;
    } catch (error) {
      this.logger.error(`❌ n8n MessageAnalysis failed for ${argumentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save M0 results to DB
   */
  async saveM0Result(dto: M0ResultDto): Promise<void> {
    // Debug: log les champs reçus pour diagnostiquer les champs manquants
    this.logger.log(`💾 Saving M0 result for debate ${dto.debateId} (branchCode: ${dto.branchCode || 'MISSING'}, nature: ${dto.nature || 'MISSING'})`);

    // Tenter de récupérer branchCode depuis des noms alternatifs
    if (!dto.branchCode && (dto as any).branch_code) {
      dto.branchCode = (dto as any).branch_code;
      this.logger.log(`🔧 Used alternate field 'branch_code' → ${dto.branchCode}`);
    }

    // ✅ Idempotence : skip seulement si M0 ET branchCode sont déjà sauvegardés
    const existing = await this.prisma.debate.findUnique({
      where: { id: dto.debateId },
      select: { n8nM0Completed: true, n8nBranchCode: true },
    });
    if (existing?.n8nM0Completed && existing?.n8nBranchCode) {
      this.logger.log(`⏭️ M0 already saved for debate ${dto.debateId}, skipping duplicate`);
      return;
    }

    // ✅ NOUVEAU : Gérer le rejet M0 si moderation === 'REJECT'
    if (dto.moderation === 'REJECT') {
      this.logger.warn(`🚫 M0 REJECT for debate ${dto.debateId}, source: ${dto.moderationSource}`);
      await this.handleM0Rejection(dto.debateId, dto.moderationSource || 'TITLE');
      return; // Ne pas mettre à jour les champs n8n si rejet
    }

    // Préparer les données de mise à jour
    const updateData: any = {
      n8nNature: dto.nature,
      n8nBurden: dto.burden,
      n8nComplexity: dto.complexity,
      n8nFactualPart: dto.factualPart,
      n8nAxiologicalPart: dto.axiologicalPart,
      n8nDimensions: dto.dimensions || [],
      n8nBranchCode: dto.branchCode,
      n8nWeightsM2: dto.weightsM2,
      n8nWeightsM3: dto.weightsM3,
      n8nM0Completed: true,
      n8nM0CompletedAt: new Date(),
      // Sprint 2: Political signals
      n8nSubjectTag: dto.subjectTag || null,
      n8nHostPoliticalSignal: dto.hostPoliticalSignal ?? null,
      n8nHostEconomicSignal: dto.hostEconomicSignal ?? null,
      n8nHostSocialSignal: dto.hostSocialSignal ?? null,
      n8nGuestPoliticalSignal: dto.guestPoliticalSignal ?? null,
      n8nGuestEconomicSignal: dto.guestEconomicSignal ?? null,
      n8nGuestSocialSignal: dto.guestSocialSignal ?? null,
      n8nSignalConfidence: dto.signalConfidence ?? null,
    };

    // Ajouter le topicId si fourni par n8n (par id ou par label)
    if (dto.topicId || dto.topicLabel) {
      let topic = null;

      // Chercher par ID si fourni
      if (dto.topicId) {
        topic = await this.prisma.topic.findUnique({
          where: { id: dto.topicId },
          select: { id: true, label: true },
        });
      }

      // Sinon chercher par label
      if (!topic && dto.topicLabel) {
        topic = await this.prisma.topic.findUnique({
          where: { label: dto.topicLabel },
          select: { id: true, label: true },
        });
      }

      if (topic) {
        updateData.topicId = topic.id;
      }
    }

    // Sauvegarder le débat
    const debate = await this.prisma.debate.update({
      where: { id: dto.debateId },
      data: updateData,
      select: { id: true, hostId: true, guestId: true },
    });

    // Sprint 2: Mettre à jour les profils utilisateurs avec les signaux politiques
    if (dto.signalConfidence && dto.signalConfidence >= 0.3) {
      await this.updateUserProfilesFromM0(debate, dto);
    }

    // Sprint 2: Ajouter le subjectTag aux debatedSubjects des utilisateurs
    if (dto.subjectTag) {
      await this.updateDebatedSubjects(debate.hostId, dto.subjectTag);
      if (debate.guestId) {
        await this.updateDebatedSubjects(debate.guestId, dto.subjectTag);
      }
    }
  }

  /**
   * Sprint 2: Met à jour les profils utilisateurs avec les signaux politiques du débat
   */
  private async updateUserProfilesFromM0(
    debate: { id: string; hostId: string; guestId: string | null },
    dto: M0ResultDto,
  ): Promise<void> {
    const signalConfidence = dto.signalConfidence || 0;

    // Mettre à jour le profil de l'hôte
    if (dto.hostPoliticalSignal !== undefined) {
      await this.updateUserSpectrum(
        debate.hostId,
        dto.hostPoliticalSignal,
        dto.hostEconomicSignal || 0,
        dto.hostSocialSignal || 0,
        signalConfidence,
      );
    }

    // Mettre à jour le profil de l'invité (s'il existe)
    if (debate.guestId && dto.guestPoliticalSignal !== undefined) {
      await this.updateUserSpectrum(
        debate.guestId,
        dto.guestPoliticalSignal,
        dto.guestEconomicSignal || 0,
        dto.guestSocialSignal || 0,
        signalConfidence,
      );
    }
  }

  /**
   * Sprint 2: Met à jour le spectre politique d'un utilisateur
   * Formule: learning_rate = max(0.05, 0.3 - (nb_debates * 0.02))
   */
  private async updateUserSpectrum(
    userId: string,
    politicalSignal: number,
    economicSignal: number,
    socialSignal: number,
    signalConfidence: number,
  ): Promise<void> {
    // Récupérer les préférences actuelles
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
    });

    if (!prefs) {
      // Créer les préférences si elles n'existent pas
      await this.prisma.userPreferences.create({
        data: {
          userId,
          politicalSpectrum: politicalSignal * signalConfidence,
          economicSpectrum: economicSignal * signalConfidence,
          socialSpectrum: socialSignal * signalConfidence,
          spectrumConfidence: Math.min(0.3, signalConfidence),
        },
      });
      return;
    }

    // Calculer le learning rate basé sur la confiance actuelle
    // Plus la confiance est haute, moins on bouge
    const currentConfidence = prefs.spectrumConfidence || 0;
    const learningRate = Math.max(0.05, 0.3 - currentConfidence * 0.25);

    // Appliquer les mises à jour avec pondération
    const newPolitical = prefs.politicalSpectrum !== null
      ? prefs.politicalSpectrum * (1 - learningRate) + politicalSignal * learningRate
      : politicalSignal * signalConfidence;

    const newEconomic = prefs.economicSpectrum !== null
      ? prefs.economicSpectrum * (1 - learningRate) + economicSignal * learningRate
      : economicSignal * signalConfidence;

    const newSocial = prefs.socialSpectrum !== null
      ? prefs.socialSpectrum * (1 - learningRate) + socialSignal * learningRate
      : socialSignal * signalConfidence;

    // Augmenter la confiance (max 1.0)
    const newConfidence = Math.min(1.0, currentConfidence + 0.1 * signalConfidence);

    await this.prisma.userPreferences.update({
      where: { userId },
      data: {
        politicalSpectrum: Number(newPolitical.toFixed(3)),
        economicSpectrum: Number(newEconomic.toFixed(3)),
        socialSpectrum: Number(newSocial.toFixed(3)),
        spectrumConfidence: Number(newConfidence.toFixed(3)),
        lastUpdated: new Date(),
      },
    });
  }

  /**
   * Sprint 2: Ajoute un subjectTag aux debatedSubjects de l'utilisateur
   */
  private async updateDebatedSubjects(userId: string, subjectTag: string): Promise<void> {
    const prefs = await this.prisma.userPreferences.findUnique({
      where: { userId },
      select: { debatedSubjects: true },
    });

    const currentSubjects = (prefs?.debatedSubjects as Record<string, number>) || {};
    currentSubjects[subjectTag] = (currentSubjects[subjectTag] || 0) + 1;

    await this.prisma.userPreferences.upsert({
      where: { userId },
      create: {
        userId,
        debatedSubjects: currentSubjects,
      },
      update: {
        debatedSubjects: currentSubjects,
        lastUpdated: new Date(),
      },
    });
  }

  // =====================================================
  // M0 REJECTION HANDLING
  // =====================================================

  /**
   * Gérer le rejet M0 en identifiant le coupable
   */
  async handleM0Rejection(
    debateId: string,
    source: 'TITLE' | 'HOST_VIEW' | 'GUEST_VIEW',
  ): Promise<void> {
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: { host: true, guest: true },
    });

    if (!debate) {
      this.logger.error(`❌ Debate ${debateId} not found for M0 rejection handling`);
      return;
    }

    if (source === 'TITLE' || source === 'HOST_VIEW') {
      // Punir l'hôte
      await this.punishUserForM0Rejection(debate.hostId);
      // Supprimer le débat complètement
      await this.deleteDebateCompletely(debateId);
      // Notifier les 2 joueurs
      await this.emitDebateCancelled(debateId, debate.hostId, debate.guestId);
      this.logger.log(`🚫 Debate ${debateId} cancelled due to HOST content (${source})`);
    } else {
      // source === 'GUEST_VIEW'
      if (!debate.guestId) {
        this.logger.error(`❌ No guest to punish for debate ${debateId}`);
        return;
      }
      // Punir le guest
      await this.punishUserForM0Rejection(debate.guestId);
      // Remettre le débat en attente
      await this.resetDebateToWaiting(debateId, debate);
      // Notifier host (retour waiting) et guest (kicked)
      await this.emitDebateResetToWaiting(debateId, debate.hostId, debate.guestId, debate.guest?.username);
      this.logger.log(`🚫 Debate ${debateId} reset to waiting due to GUEST content`);
    }
  }

  /**
   * Punir un utilisateur pour rejet M0 (incrémenter compteurs et ban si nécessaire)
   */
  private async punishUserForM0Rejection(userId: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });

    if (!user) {
      this.logger.error(`❌ User ${userId} not found for M0 punishment`);
      return;
    }

    // Vérifier si on doit reset le compteur mensuel
    const now = new Date();
    const resetAt = user.m0RejectionsResetAt;
    const needsReset = !resetAt || (now.getTime() - resetAt.getTime() > 30 * 24 * 60 * 60 * 1000);

    const newCount = needsReset ? 1 : user.m0RejectionsThisMonth + 1;

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        monthlyDebateCount: { increment: 1 }, // Compter comme un débat utilisé
        m0RejectionsThisMonth: newCount,
        m0RejectionsResetAt: needsReset ? now : undefined,
      },
    });

    this.logger.log(`⚠️ User ${userId} M0 rejection count: ${newCount} (reset: ${needsReset})`);

    // Ban automatique si >= 2 rejets ce mois
    if (newCount >= 2) {
      this.logger.warn(`🔨 User ${userId} auto-banned for repeated M0 rejections`);
      await this.reportsService.banUser(userId, 'Contenus inappropriés répétés');
    }
  }

  /**
   * Remettre un débat en attente (après rejet du guest)
   * Gère les débats live ET async
   */
  private async resetDebateToWaiting(debateId: string, debate: any): Promise<void> {
    const isAsyncDebate = debate.isLive === false;

    // Supprimer tous les timers (pour les débats live)
    await this.prisma.debateTimer.deleteMany({ where: { debateId } });

    // Reset le débat - champs communs + spécifiques async
    await this.prisma.debate.update({
      where: { id: debateId },
      data: {
        status: 'waiting',
        guestId: null,
        guestView: null,
        // Reset n8n fields
        n8nM0Completed: false,
        n8nBranchCode: null,
        n8nNature: null,
        n8nBurden: null,
        n8nComplexity: null,
        n8nFactualPart: null,
        n8nAxiologicalPart: null,
        n8nDimensions: [],
        n8nWeightsM2: null,
        n8nWeightsM3: null,
        n8nM0CompletedAt: null,
        // Reset reservation
        reservedAt: null,
        reservedBy: null,
        // Reset turn tracking (utilisé par live ET async)
        turnNumber: 0,
        turnStartedAt: null,
        // ✅ ASYNC : Pour les débats async, remettre le currentTurnUserId sur l'host
        // Pour les débats live, le mettre à null
        currentTurnUserId: isAsyncDebate ? debate.hostId : null,
        // ✅ ASYNC : Remettre l'expiration à 2 jours pour les débats async
        expiresAt: isAsyncDebate ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000) : null,
      },
    });

    // ✅ LIVE ONLY : Recréer le timer de l'hôte (pausé) pour les débats live
    if (!isAsyncDebate) {
      await this.prisma.debateTimer.create({
        data: {
          debateId,
          userId: debate.hostId,
          remainingSec: debate.mode * 60, // mode est en minutes
        },
      });
    }

    this.logger.log(`♻️ Debate ${debateId} reset to waiting status (isAsync: ${isAsyncDebate})`);
  }

  /**
   * Supprimer complètement un débat
   */
  private async deleteDebateCompletely(debateId: string): Promise<void> {
    // Supprimer dans l'ordre pour respecter les contraintes FK
    await this.prisma.debateTimer.deleteMany({ where: { debateId } });
    await this.prisma.argument.deleteMany({ where: { debateId } });
    await this.prisma.debateReport.deleteMany({ where: { debateId } });
    await this.prisma.debate.delete({ where: { id: debateId } });

    this.logger.log(`🗑️ Debate ${debateId} completely deleted`);
  }

  /**
   * Émettre l'événement debate_cancelled (les 2 joueurs retournent Home)
   */
  private async emitDebateCancelled(
    debateId: string,
    hostId: string,
    guestId: string | null,
  ): Promise<void> {
    const data = {
      debateId,
      reason: 'moderation',
      message: 'Le débat a été annulé pour cause de contenu inapproprié.',
    };

    // Notifier via la room du débat
    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room: `debate:${debateId}`,
        event: 'debate_cancelled',
        data,
      }),
    );

    this.logger.log(`📡 Emitted debate_cancelled for debate ${debateId}`);
  }

  /**
   * Émettre les événements quand le guest est rejeté
   * - debate_reset_to_waiting pour l'hôte
   * - debate_kicked_moderation pour le guest
   */
  private async emitDebateResetToWaiting(
    debateId: string,
    hostId: string,
    guestId: string,
    guestUsername?: string,
  ): Promise<void> {
    // Notifier l'hôte (retour à l'écran d'attente) - via room user ET room debate
    const hostEventData = {
      debateId,
      reason: 'guest_moderation',
      guestUsername: guestUsername || 'L\'invité',
      message: 'L\'invité a été rejeté pour contenu inapproprié. La recherche a redémarré.',
    };

    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room: `user:${hostId}`,
        event: 'debate_reset_to_waiting',
        data: hostEventData,
      }),
    );

    // Aussi envoyer à la room debate pour s'assurer que le frontend reçoive
    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room: `debate:${debateId}`,
        event: 'debate_reset_to_waiting',
        data: hostEventData,
      }),
    );

    // Notifier le guest (retour Home) - UNIQUEMENT via room user pour éviter double notification
    // (le guest est aussi dans la room debate:${debateId})
    const guestEventData = {
      debateId,
      reason: 'moderation',
      message: 'Votre participation a été rejetée pour contenu inapproprié.',
    };

    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room: `user:${guestId}`,
        event: 'debate_kicked_moderation',
        data: guestEventData,
      }),
    );

    this.logger.log(`📡 Emitted debate_reset_to_waiting (host) and debate_kicked_moderation (guest) for debate ${debateId}`);
  }

  /**
   * Save M1 results to DB and publish argument_ready
   */
  async saveM1Result(dto: M1ResultDto): Promise<void> {
    this.logger.log(`💾 Saving M1 result for argument ${dto.argumentId}`);

    // Check if argument was rejected (moderation REJECT or gaming STOP)
    const isRejected = dto.moderation === 'REJECT' || dto.gamingStatus === 'STOP';
    const finalState = isRejected ? 'n8n_rejected' : 'n8n_processing_m2m3';

    if (isRejected) {
      this.logger.warn(`⚠️ Argument ${dto.argumentId} rejected: moderation=${dto.moderation}, gaming=${dto.gamingStatus}`);
    }

    // Récupérer l'argument existant pour avoir le rawText si cleanText n'est pas fourni
    const existingArgument = await this.prisma.argument.findUnique({
      where: { id: dto.argumentId },
      select: { rawText: true }
    });

    // Si pas de cleanText fourni par n8n, utiliser le rawText original (pas de reformulation)
    const finalCleanText = dto.cleanText || existingArgument?.rawText || '';

    const argument = await this.prisma.argument.update({
      where: { id: dto.argumentId },
      data: {
        cleanText: finalCleanText,
        n8nModeration: dto.moderation,
        n8nModerationReason: dto.moderationReason,
        n8nGamingStatus: dto.gamingStatus,
        n8nGamingFlags: dto.gamingFlags || [],
        n8nPrimaryType: dto.primaryType,
        n8nTags: dto.tags || [],
        n8nNeedsFactcheck: dto.needsFactcheck ?? false,
        n8nFactcheckClaims: dto.factcheckClaims || [],
        n8nEngagement: dto.engagement,
        n8nUnansweredPoints: dto.unansweredPoints || [],
        n8nDimension: dto.dimension,
        n8nArgumentSummary: dto.argumentSummary,
        n8nMaxScore: dto.maxScore,
        n8nJudgeType: dto.judgeType,
        n8nM1CompletedAt: new Date(),
        n8nProcessed: isRejected, // Mark as processed if rejected (no M3 coming)
        state: finalState,
        // Set score to 0 for rejected arguments
        ...(isRejected && {
          n8nFinalScore: 0,
          scoreTotal: 0,
          justification: dto.moderationReason || 'Message rejeté par la modération.',
        }),
      },
      include: { user: true, debate: true },
    });

    // Publish argument_ready (with isArgument=false for rejected)
    await this.publishArgumentReady(argument);

    // For rejected arguments, also publish argument_scored immediately with score 0
    if (isRejected) {
      await this.publishArgumentRejected(argument, dto);
    }

    // ========================================
    // LIVE DEBATE: Switch turns after M1
    // ========================================
    // Turn switch happens after M1 (moderation OK), not after M3
    const debate = argument.debate;
    if (debate && debate.isLive) {
      await this.handleLiveDebateTurnSwitch(argument, debate, isRejected);
    }
  }

  /**
   * Handle turn switch for live debates after M1 completes
   * This switches turns immediately after moderation check (M1), not after scoring (M3)
   */
  private async handleLiveDebateTurnSwitch(
    argument: any,
    debate: any,
    isRejected: boolean,
  ): Promise<void> {
    const senderId = argument.userId;
    const opponentId = senderId === debate.hostId ? debate.guestId : debate.hostId;

    if (!opponentId) {
      this.logger.warn(`⚠️ No opponent found for debate ${debate.id}, skipping turn switch`);
      return;
    }

    this.logger.log(`🔄 Live debate ${debate.id}: switching turn from ${senderId} to ${opponentId}`);

    try {
      // 1. Pause sender's timer (they just submitted)
      await this.timerService.pauseTimer(debate.id, senderId);
      this.logger.log(`⏸️ Paused timer for sender ${senderId}`);

      // 2. Start/resume opponent's timer
      const timerSeconds = debate.mode * 60; // mode is in minutes
      const existingTime = await this.timerService.getRemainingTime(debate.id, opponentId);

      if (existingTime && existingTime > 0) {
        // Resume existing timer
        await this.timerService.resetTimer(debate.id, opponentId, existingTime, true);
        this.logger.log(`▶️ Resumed opponent's timer: ${existingTime}s remaining`);
      } else {
        // Start new timer
        await this.timerService.startTimer(debate.id, opponentId, timerSeconds);
        this.logger.log(`🆕 Started new timer for opponent ${opponentId}: ${timerSeconds}s`);
      }

      // 3. Update debate's currentTurnUserId in database
      await this.prisma.debate.update({
        where: { id: debate.id },
        data: {
          currentTurnUserId: opponentId,
          turnStartedAt: new Date(),
          turnNumber: { increment: 1 },
        },
      });

      // 4. Emit turn_changed event via Redis (for WebSocket relay)
      const turnChangedData = {
        debateId: debate.id,
        currentTurnUserId: opponentId,
        previousUserId: senderId,
        turnNumber: (debate.turnNumber || 0) + 1,
        turnStartedAt: new Date().toISOString(),
        timestamp: new Date().toISOString(),
        reason: isRejected ? 'argument_rejected' : 'argument_submitted',
      };

      await this.redisService.pubClient.publish(
        'websocket:notification',
        JSON.stringify({
          room: `debate:${debate.id}`,
          event: 'turn_changed',
          data: turnChangedData,
        }),
      );

      this.logger.log(`✅ Turn switched: ${senderId} → ${opponentId} for debate ${debate.id}`);
    } catch (error) {
      this.logger.error(`❌ Error switching turns: ${error.message}`);
      // Don't throw - turn switch failure shouldn't break M1 processing
    }
  }

  /**
   * Save M3 results to DB and publish argument_scored
   */
  async saveM3Result(dto: M3ResultDto): Promise<void> {
    this.logger.log(`💾 Saving M3 result for argument ${dto.argumentId}`);

    // Use finalScoreWithBonus if available, otherwise fallback to finalScore
    const finalScoreToSave = dto.finalScoreWithBonus ?? dto.finalScore ?? 0;

    const argument = await this.prisma.argument.update({
      where: { id: dto.argumentId },
      data: {
        // M2 (if applicable)
        n8nFactcheckScore: dto.factcheckScore,
        n8nClaimsAnalysis: dto.claimsAnalysis,
        n8nOverallSourceQuality: dto.overallSourceQuality,
        n8nFactcheckSummary: dto.factcheckSummary,
        n8nSourcesSummary: dto.sourcesSummary,
        n8nM2CompletedAt: dto.factcheckScore !== undefined ? new Date() : undefined,

        // M3
        n8nCriteriaBreakdown: dto.criteriaBreakdown,
        n8nFallacies: dto.fallacies,
        n8nBiases: dto.biases,
        // Normalize engagementIssues: n8n may send string instead of array
        n8nEngagementIssues: Array.isArray(dto.engagementIssues)
          ? dto.engagementIssues
          : dto.engagementIssues
            ? [dto.engagementIssues as unknown as string]
            : [],
        n8nBurdenViolation: dto.burdenViolation,
        // Normalize strengths/weaknesses: n8n may send objects instead of strings
        n8nStrengths: Array.isArray(dto.strengths)
          ? dto.strengths.map((s: any) => typeof s === 'string' ? s : (s.explanation || JSON.stringify(s)))
          : dto.strengths,
        n8nWeaknesses: Array.isArray(dto.weaknesses)
          ? dto.weaknesses.map((w: any) => typeof w === 'string' ? w : (w.explanation || JSON.stringify(w)))
          : dto.weaknesses,
        n8nBriefJustification: dto.briefJustification,
        n8nDimensionAddressed: dto.dimensionAddressed,

        // Scores (without bonus)
        n8nJudgeScore: dto.judgeScore,
        n8nWeightedScore: dto.weightedScore,
        n8nTotalPenalty: dto.totalPenalty,
        n8nAppliedPenalty: dto.appliedPenalty,
        n8nFinalScore: dto.finalScore,

        // Bonus dimensions
        n8nDimensionBonus: dto.dimensionBonus,
        n8nCoverageBonus: dto.coverageBonus,
        n8nTotalBonus: dto.totalBonus,
        n8nFinalScoreWithBonus: dto.finalScoreWithBonus,

        // Metadata
        n8nProcessed: true,
        n8nM3CompletedAt: new Date(),
        state: 'n8n_completed',

        // Copy to existing fields for compatibility (use score WITH bonus)
        scoreTotal: finalScoreToSave,
        justification: dto.briefJustification || 'Score calculé par n8n.',

        // Sources - convert from n8n format to sourcesData format
        // n8n sends 'title' with the domain name already formatted
        // Filter out Google's internal context lookups (time, weather, etc.)
        sourcesData: (dto.sources || dto.sourcesForDisplay || [])
          .filter((s: any) => !this.shouldFilterSource(s))
          .map((s: any) => ({
            title: s.title || s.name || this.extractDomainFromUrl(s.url),
            url: s.url,
            tier: s.tier,
            quality_score: s.quality_score,
            description: s.description,
          })) || undefined,
      },
      include: { user: true, debate: true },
    });

    // Update dimensions covered on debate if new dimension was addressed
    if (dto.isNewDimension && dto.newCoveredDimensions) {
      await this.updateDimensionsCovered(argument.debateId, argument.userId, dto);
    }

    // Publish argument_scored
    await this.publishArgumentScored(argument, dto);

    // ✅ BOT SYSTEM : Notify bot player service that an argument was scored
    // This triggers the bot's response if the debate involves a bot
    try {
      await this.botPlayerService.onArgumentScored(
        argument.debateId,
        argument.id,
        argument.userId,
      );
    } catch (botError) {
      this.logger.warn(`Bot notification failed for argument ${argument.id}: ${botError.message}`);
    }

    // ✅ Recalculer les totaux du débat si celui-ci est déjà terminé
    // (filet de sécurité : si acceptEnd() a calculé les scores avant ce M3)
    await this.recalculateDebateTotalsIfEnded(argument.debateId);

    // ✅ NOUVEAU : Vérifier si le débat attend la fin de l'analyse pour se terminer
    await this.checkAndTriggerDebateEnd(argument.debateId);
  }

  /**
   * ✅ Recalcule hostFinalScore/guestFinalScore si le débat est déjà terminé.
   * Corrige le cas où acceptEnd() a figé les totaux avant que le dernier M3 n'arrive.
   */
  private async recalculateDebateTotalsIfEnded(debateId: string): Promise<void> {
    try {
      const debate = await this.prisma.debate.findUnique({
        where: { id: debateId },
        select: { status: true, hostId: true, guestId: true, hostFinalScore: true, guestFinalScore: true },
      });

      if (!debate || !['completed', 'scored'].includes(debate.status)) {
        return; // Débat pas encore terminé, rien à recalculer
      }

      // Sommer les scoreTotal de tous les arguments
      const allArguments = await this.prisma.argument.findMany({
        where: { debateId, isArgument: true },
        select: { userId: true, scoreTotal: true },
      });

      let hostScore = 0;
      let guestScore = 0;
      for (const arg of allArguments) {
        if (arg.userId === debate.hostId) {
          hostScore += arg.scoreTotal || 0;
        } else if (arg.userId === debate.guestId) {
          guestScore += arg.scoreTotal || 0;
        }
      }

      // Vérifier si les totaux ont changé
      if (hostScore === debate.hostFinalScore && guestScore === debate.guestFinalScore) {
        return; // Pas de changement
      }

      let winner: 'host' | 'guest' | 'tie' = 'tie';
      if (hostScore > guestScore) {
        winner = 'host';
      } else if (guestScore > hostScore) {
        winner = 'guest';
      }

      await this.prisma.debate.update({
        where: { id: debateId },
        data: {
          hostFinalScore: hostScore,
          guestFinalScore: guestScore,
          finalWinner: winner,
        },
      });

      this.logger.log(
        `🔄 [N8nService] Totaux recalculés pour débat ${debateId}: ` +
        `host ${debate.hostFinalScore}→${hostScore}, guest ${debate.guestFinalScore}→${guestScore}, winner=${winner}`,
      );
    } catch (error) {
      this.logger.error(`❌ [N8nService] Erreur recalculateDebateTotalsIfEnded: ${error.message}`);
    }
  }

  /**
   * ✅ NOUVEAU : Vérifie si le débat attend la fin de l'analyse et notifie pour finalisation
   * Appelé après chaque M3 terminé pour déclencher la fin automatiquement si conditions remplies
   */
  private async checkAndTriggerDebateEnd(debateId: string): Promise<void> {
    try {
      // 1. Vérifier si stopAcceptedBy est défini (quelqu'un a accepté l'arrêt)
      const debate = await this.prisma.debate.findUnique({
        where: { id: debateId },
        select: { status: true, stopAcceptedBy: true, stopAcceptedAt: true }
      });

      if (!debate || debate.status !== 'active' || !debate.stopAcceptedBy) {
        return; // Pas d'arrêt en attente
      }

      // 2. Vérifier s'il reste des arguments en cours d'analyse
      const pendingCount = await this.prisma.argument.count({
        where: {
          debateId,
          isArgument: true,
          repetition: false,
          OR: [
            { cleanText: "" },
            { justification: "Score calculé automatiquement." }
          ]
        }
      });

      if (pendingCount === 0) {
        this.logger.log(`✅ [N8nService] Analyse terminée pour débat ${debateId}, notification pour finalisation`);

        // Émettre un événement pour notifier que l'analyse est terminée
        await this.redisService.pubClient.publish(
          'websocket:notification',
          JSON.stringify({
            room: `debate:${debateId}`,
            event: 'analysis_complete_ready_to_end',
            data: {
              debateId,
              timestamp: new Date().toISOString(),
              message: 'Toutes les analyses sont terminées'
            }
          })
        );
      } else {
        this.logger.log(`⏳ [N8nService] Débat ${debateId} attend encore ${pendingCount} analyse(s)`);
      }
    } catch (error) {
      this.logger.error(`❌ [N8nService] Erreur checkAndTriggerDebateEnd: ${error.message}`);
    }
  }

  /**
   * Update dimensions covered for the author on this debate
   */
  private async updateDimensionsCovered(
    debateId: string,
    userId: string,
    dto: M3ResultDto,
  ): Promise<void> {
    // Get current debate to check author role
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
    });

    if (!debate) return;

    const isHost = debate.hostId === userId;
    const fieldToUpdate = isHost ? 'n8nDimensionsCoveredHost' : 'n8nDimensionsCoveredGuest';
    const coverageBonusField = isHost ? 'n8nCoverageBonusAwardedHost' : 'n8nCoverageBonusAwardedGuest';

    const updateData: any = {
      [fieldToUpdate]: dto.newCoveredDimensions || [],
    };

    // Mark coverage bonus as awarded if just completed
    if (dto.justCompletedCoverage) {
      updateData[coverageBonusField] = true;
      this.logger.log(`🎯 Coverage bonus awarded to ${isHost ? 'HOST' : 'GUEST'} on debate ${debateId}`);
    }

    await this.prisma.debate.update({
      where: { id: debateId },
      data: updateData,
    });

    this.logger.log(`📊 Updated dimensions covered for ${isHost ? 'HOST' : 'GUEST'}: ${dto.newCoveredDimensions?.join(', ')}`);
  }

  /**
   * Publish argument_ready via Redis
   */
  private async publishArgumentReady(argument: any): Promise<void> {
    const room = `debate:${argument.debateId}`;
    const event = 'argument_ready';
    const isArgumentValid = argument.n8nModeration === 'OK' && argument.n8nGamingStatus !== 'STOP';
    const data = {
      debateId: argument.debateId,
      argumentId: argument.id,
      cleanText: argument.cleanText,
      isArgument: isArgumentValid,
      needsFactcheck: argument.n8nNeedsFactcheck ?? false,
      argument: {
        id: argument.id,
        debateId: argument.debateId,
        userId: argument.userId,
        turnIndex: argument.turnIndex,
        rawText: argument.rawText,
        cleanText: argument.cleanText,
        isArgument: isArgumentValid,
        insultFlag: argument.insultFlag || false,
        createdAt: argument.createdAt,
        user: argument.user,
      },
    };

    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room,
        event,
        data,
      }),
    );

    this.logger.log(`📡 Published ${event} for argument ${argument.id}`);
  }

  /**
   * Publish argument_scored via Redis
   */
  private async publishArgumentScored(argument: any, dto: M3ResultDto): Promise<void> {
    const room = `debate:${argument.debateId}`;
    const event = 'argument_scored';
    const data = {
      debateId: argument.debateId,
      argumentId: argument.id,
      scores: {
        reliability: dto.factcheckScore || 0,
        impact: dto.judgeScore,
        total: dto.finalScore,
        gifCategory: this.calculateGifCategory(dto.finalScore),
      },
      justification: {
        strengths: dto.strengths,
        weaknesses: dto.weaknesses,
        brief: dto.briefJustification,
      },
      tags: [
        // M3 fallacies (négatifs) — le vrai feedback utile
        ...(dto.fallacies || []).map((f: any) => `-${f.fallacy_type || f.fallacy_name || f.fallacy || f.name || f.type || ''}`).filter((t: string) => t !== '-'),
        // M3 biases (négatifs)
        ...(dto.biases || []).map((b: any) => `-${b.bias_type || b.bias_name || b.name || b.type || ''}`).filter((t: string) => t !== '-'),
        // Burden of proof violation
        ...(dto.burdenViolation === true ? ['-burden_violation'] : []),
        // Engagement issues — tag générique (le détail est dans n8nEngagementIssues)
        ...((Array.isArray(dto.engagementIssues) && dto.engagementIssues.length > 0) ||
            (typeof dto.engagementIssues === 'string' && dto.engagementIssues)
          ? ['-engagement_issue']
          : []),
        // M1 gaming flags WARNING (STOP = rejeté, n'arrive pas ici)
        ...(dto.gamingStatus === 'WARNING' && Array.isArray(dto.gamingFlags) && dto.gamingFlags.length > 0
          ? dto.gamingFlags.map((f: string) => `-${f}`)
          : []),
        // Bonus dimension (+5 nouvelle dimension, +20 couverture complète)
        ...(dto.dimensionBonus ? ['+new_dimension'] : []),
        ...(dto.coverageBonus ? ['+full_coverage'] : []),
        // M1 tags positifs uniquement (filtrer les tags de classification)
        // Préférer argument.n8nTags (source fiable M1) ; dto.tags peut être [] vide depuis n8n M3
        ...((argument.n8nTags?.length ? argument.n8nTags : dto.tags) || []).filter((t: string) =>
          typeof t === 'string' && t.startsWith('+') &&
          !(['+RHETORICAL', '+ARGUMENT', '+QUESTION', '+OPINION', '+FACTUAL'].includes(t.toUpperCase()))
        ),
      ],
      timestamp: new Date().toISOString(),
    };

    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room,
        event,
        data,
      }),
    );

    this.logger.log(`📡 Published ${event} for argument ${argument.id} with score ${dto.finalScore}`);
  }

  private calculateGifCategory(score: number): number {
    if (score <= 5) return 0;
    if (score <= 12) return 1;
    if (score <= 16) return 2;
    return 3;
  }

  // =====================================================
  // LOCAL DEBATE METHODS (no WebSocket, just DB updates)
  // =====================================================

  /**
   * Determine if we should use n8n for local debate processing
   */
  shouldUseN8nForLocal(localDebate: any): boolean {
    if (!this.isEnabled) return false;
    if (!localDebate.n8nM0Completed) return false;
    if (!localDebate.n8nBranchCode) return false;

    // Progressive percentage (same as regular debates)
    return Math.random() * 100 < this.percentage;
  }

  /**
   * Call the StartDebate webhook (M0) for a local debate
   * Returns the result synchronously (webhook responds with data)
   */
  async callStartLocalDebate(
    localDebateId: string,
    title: string,
    player1Position: string,
    player2Position: string,
    gameMode: 'COMPETITIVE' | 'EXPLORATORY' = 'COMPETITIVE',
    language: string = 'en',
  ): Promise<void> {
    const url = `${this.webhookBaseUrl}/start-debate`;

    this.logger.log(`📤 Calling n8n StartDebate for LOCAL debate ${localDebateId} with gameMode ${gameMode}, language ${language}`);

    try {
      const response: AxiosResponse = await axios.post(
        url,
        {
          debateId: localDebateId, // n8n uses debateId generically
          title,
          hostPosition: player1Position,
          guestPosition: player2Position,
          mode: gameMode, // Use the actual game mode (COMPETITIVE/EXPLORATORY)
          language,
        },
        {
          timeout: 30000, // 30s timeout
        },
      );

      this.logger.log(`✅ n8n StartDebate response received for LOCAL debate ${localDebateId}`);

      // Only save if the response contains actual M0 data
      const branchCode = response.data?.branchCode || response.data?.branch_code;
      if (response.data && branchCode) {
        const m0Result = {
          ...response.data,
          debateId: localDebateId,
          branchCode,
        };
        await this.saveLocalM0Result(m0Result);
      } else {
        this.logger.log(`⏳ n8n sync response has no M0 data, waiting for callback for LOCAL ${localDebateId}`);
      }
    } catch (error) {
      this.logger.error(`❌ n8n StartDebate failed for LOCAL debate ${localDebateId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save M0 results to LocalDebate table
   */
  async saveLocalM0Result(dto: M0ResultDto): Promise<void> {
    this.logger.log(`💾 Saving M0 result for LOCAL debate ${dto.debateId}`);

    // Tenter de récupérer branchCode depuis des noms alternatifs
    if (!dto.branchCode && (dto as any).branch_code) {
      dto.branchCode = (dto as any).branch_code;
    }

    // ✅ Idempotence : skip seulement si M0 ET branchCode sont déjà sauvegardés
    const existing = await this.prisma.localDebate.findUnique({
      where: { id: dto.debateId },
      select: { n8nM0Completed: true, n8nBranchCode: true },
    });
    if (existing?.n8nM0Completed && existing?.n8nBranchCode) {
      this.logger.log(`⏭️ M0 already saved for LOCAL debate ${dto.debateId}, skipping duplicate`);
      return;
    }

    await this.prisma.localDebate.update({
      where: { id: dto.debateId },
      data: {
        n8nNature: dto.nature,
        n8nBurden: dto.burden,
        n8nComplexity: dto.complexity,
        n8nFactualPart: dto.factualPart,
        n8nAxiologicalPart: dto.axiologicalPart,
        n8nDimensions: dto.dimensions || [],
        n8nBranchCode: dto.branchCode,
        n8nWeightsM2: dto.weightsM2,
        n8nWeightsM3: dto.weightsM3,
        n8nM0Completed: true,
        n8nM0CompletedAt: new Date(),
      },
    });
  }

  /**
   * Call the MessageAnalysis webhook (M1-M2-M3) for a local argument
   */
  async callLocalMessageAnalysis(
    localArgumentId: string,
    localDebate: any,
    rawText: string,
    playerId: string,
    argumentsHistory: string,
    last3Messages: string,
  ): Promise<M1ResultDto> {
    const branchCode = localDebate.n8nBranchCode;
    const url = `${this.webhookBaseUrl}/${branchCode}`;

    // Determine author role for local debate (player1 = HOST, player2 = GUEST in n8n terms)
    const isPlayer1 = playerId === 'player1';
    const author = isPlayer1 ? 'HOST' : 'GUEST';
    const dimensionsCoveredByAuthor = isPlayer1
      ? (localDebate.n8nDimensionsCoveredPlayer1 || [])
      : (localDebate.n8nDimensionsCoveredPlayer2 || []);
    const coverageBonusAwarded = isPlayer1
      ? (localDebate.n8nCoverageBonusAwardedPlayer1 || false)
      : (localDebate.n8nCoverageBonusAwardedPlayer2 || false);

    this.logger.log(`📤 Calling n8n MessageAnalysis (${branchCode}) for LOCAL argument ${localArgumentId}`);

    try {
      const response: AxiosResponse = await axios.post(
        url,
        {
          argumentId: localArgumentId,
          debateId: localDebate.id,
          userId: playerId, // Use playerId as userId
          author,
          rawText,
          title: localDebate.title,
          hostPosition: localDebate.player1Viewpoint,
          guestPosition: localDebate.player2Viewpoint,
          nature: localDebate.n8nNature,
          burden: localDebate.n8nBurden,
          complexity: localDebate.n8nComplexity,
          factualPart: localDebate.n8nFactualPart,
          axiologicalPart: localDebate.n8nAxiologicalPart,
          dimensions: localDebate.n8nDimensions,
          mode: 'LOCAL',
          language: localDebate.hostUser?.preferredLanguage || 'en',
          argumentsHistory,
          last3Messages,
          // Dimension tracking for bonus calculation
          allDimensions: localDebate.n8nDimensions || [],
          dimensionsCoveredByAuthor,
          host_dimensions_covered: localDebate.n8nDimensionsCoveredPlayer1 || [],
          guest_dimensions_covered: localDebate.n8nDimensionsCoveredPlayer2 || [],
          coverageBonusAwarded,
        },
        {
          timeout: 15000, // 15s timeout for M1
        },
      );

      this.logger.log(`✅ n8n M1 response received for LOCAL argument ${localArgumentId}`);

      return response.data as M1ResultDto;
    } catch (error) {
      this.logger.error(`❌ n8n MessageAnalysis failed for LOCAL argument ${localArgumentId}: ${error.message}`);
      throw error;
    }
  }

  /**
   * Save M1 results to LocalArgument table
   * Note: No WebSocket publishing for local debates (frontend polls for completion)
   */
  async saveLocalM1Result(dto: M1ResultDto): Promise<void> {
    this.logger.log(`💾 Saving M1 result for LOCAL argument ${dto.argumentId}`);

    // Check if argument was rejected (moderation REJECT or gaming STOP)
    const isRejected = dto.moderation === 'REJECT' || dto.gamingStatus === 'STOP';
    const finalState = isRejected ? 'n8n_rejected' : 'n8n_processing_m2m3';

    if (isRejected) {
      this.logger.warn(`⚠️ LOCAL Argument ${dto.argumentId} rejected: moderation=${dto.moderation}, gaming=${dto.gamingStatus}`);
    }

    // Get existing argument for rawText fallback
    const existingArgument = await this.prisma.localArgument.findUnique({
      where: { id: dto.argumentId },
      select: { rawText: true },
    });

    const finalCleanText = dto.cleanText || existingArgument?.rawText || '';

    await this.prisma.localArgument.update({
      where: { id: dto.argumentId },
      data: {
        cleanText: finalCleanText,
        n8nModeration: dto.moderation,
        n8nModerationReason: dto.moderationReason,
        n8nGamingStatus: dto.gamingStatus,
        n8nGamingFlags: dto.gamingFlags || [],
        n8nPrimaryType: dto.primaryType,
        n8nTags: dto.tags || [],
        n8nNeedsFactcheck: dto.needsFactcheck ?? false,
        n8nFactcheckClaims: dto.factcheckClaims || [],
        n8nEngagement: dto.engagement,
        n8nUnansweredPoints: dto.unansweredPoints || [],
        n8nDimension: dto.dimension,
        n8nArgumentSummary: dto.argumentSummary,
        n8nMaxScore: dto.maxScore,
        n8nJudgeType: dto.judgeType,
        n8nM1CompletedAt: new Date(),
        n8nProcessed: isRejected,
        state: finalState,
        isArgument: dto.moderation === 'OK' && dto.gamingStatus !== 'STOP',
        // Set score to 0 for rejected arguments
        ...(isRejected && {
          n8nFinalScore: 0,
          scoreTotal: 0,
          justification: dto.moderationReason || 'Message rejeté par la modération.',
        }),
      },
    });
  }

  /**
   * Save M3 results to LocalArgument table
   * Note: No WebSocket publishing for local debates (frontend polls for completion)
   */
  async saveLocalM3Result(dto: M3ResultDto): Promise<void> {
    this.logger.log(`💾 Saving M3 result for LOCAL argument ${dto.argumentId}`);

    // Use finalScoreWithBonus if available, otherwise fallback to finalScore
    const finalScoreToSave = dto.finalScoreWithBonus ?? dto.finalScore ?? 0;

    const localArgument = await this.prisma.localArgument.update({
      where: { id: dto.argumentId },
      data: {
        // M2 (if applicable)
        n8nFactcheckScore: dto.factcheckScore,
        n8nClaimsAnalysis: dto.claimsAnalysis,
        n8nOverallSourceQuality: dto.overallSourceQuality,
        n8nFactcheckSummary: dto.factcheckSummary,
        n8nSourcesSummary: dto.sourcesSummary,
        n8nM2CompletedAt: dto.factcheckScore !== undefined ? new Date() : undefined,

        // M3
        n8nCriteriaBreakdown: dto.criteriaBreakdown,
        n8nFallacies: dto.fallacies,
        n8nBiases: dto.biases,
        // Normalize engagementIssues
        n8nEngagementIssues: Array.isArray(dto.engagementIssues)
          ? dto.engagementIssues
          : dto.engagementIssues
            ? [dto.engagementIssues as unknown as string]
            : [],
        n8nBurdenViolation: dto.burdenViolation,
        // Normalize strengths/weaknesses: n8n may send objects instead of strings
        n8nStrengths: Array.isArray(dto.strengths)
          ? dto.strengths.map((s: any) => typeof s === 'string' ? s : (s.explanation || JSON.stringify(s)))
          : dto.strengths,
        n8nWeaknesses: Array.isArray(dto.weaknesses)
          ? dto.weaknesses.map((w: any) => typeof w === 'string' ? w : (w.explanation || JSON.stringify(w)))
          : dto.weaknesses,
        n8nBriefJustification: dto.briefJustification,
        n8nDimensionAddressed: dto.dimensionAddressed,

        // Scores (without bonus)
        n8nJudgeScore: dto.judgeScore,
        n8nWeightedScore: dto.weightedScore,
        n8nTotalPenalty: dto.totalPenalty,
        n8nAppliedPenalty: dto.appliedPenalty,
        n8nFinalScore: dto.finalScore,

        // Bonus dimensions
        n8nDimensionBonus: dto.dimensionBonus,
        n8nCoverageBonus: dto.coverageBonus,
        n8nTotalBonus: dto.totalBonus,
        n8nFinalScoreWithBonus: dto.finalScoreWithBonus,

        // Metadata
        n8nProcessed: true,
        n8nM3CompletedAt: new Date(),
        state: 'completed', // Use 'completed' for local (no 'n8n_completed' distinction needed)

        // Copy to existing fields for compatibility (use score WITH bonus)
        scoreTotal: finalScoreToSave,
        reliability: dto.factcheckScore || 0,
        impact: dto.judgeScore || 0,
        justification: dto.briefJustification || 'Score calculé par n8n.',
        gifCategory: this.calculateGifCategory(finalScoreToSave),

        // Sources - convert from n8n format to sourcesData format
        // n8n sends 'title' with the domain name already formatted
        // Filter out Google's internal context lookups (time, weather, etc.)
        sourcesData: (dto.sources || dto.sourcesForDisplay || [])
          .filter((s: any) => !this.shouldFilterSource(s))
          .map((s: any) => ({
            title: s.title || s.name || this.extractDomainFromUrl(s.url),
            url: s.url,
            tier: s.tier,
            quality_score: s.quality_score,
            description: s.description,
          })),
      },
      include: { localDebate: true },
    });

    // Update dimensions covered on local debate if new dimension was addressed
    if (dto.isNewDimension && dto.newCoveredDimensions) {
      await this.updateLocalDimensionsCovered(localArgument.localDebateId, localArgument.playerId, dto);
    }
  }

  /**
   * Update dimensions covered for the player on this local debate
   */
  private async updateLocalDimensionsCovered(
    localDebateId: string,
    playerId: string,
    dto: M3ResultDto,
  ): Promise<void> {
    const isPlayer1 = playerId === 'player1';
    const fieldToUpdate = isPlayer1 ? 'n8nDimensionsCoveredPlayer1' : 'n8nDimensionsCoveredPlayer2';
    const coverageBonusField = isPlayer1 ? 'n8nCoverageBonusAwardedPlayer1' : 'n8nCoverageBonusAwardedPlayer2';

    const updateData: any = {
      [fieldToUpdate]: dto.newCoveredDimensions || [],
    };

    // Mark coverage bonus as awarded if just completed
    if (dto.justCompletedCoverage) {
      updateData[coverageBonusField] = true;
      this.logger.log(`🎯 Coverage bonus awarded to ${playerId} on LOCAL debate ${localDebateId}`);
    }

    await this.prisma.localDebate.update({
      where: { id: localDebateId },
      data: updateData,
    });

    this.logger.log(`📊 Updated dimensions covered for ${playerId}: ${dto.newCoveredDimensions?.join(', ')}`);
  }

  /**
   * Publish argument_rejected for moderation failures
   * This notifies the frontend that the argument was rejected and won't be scored
   */
  private async publishArgumentRejected(argument: any, dto: M1ResultDto): Promise<void> {
    const room = `debate:${argument.debateId}`;
    const event = 'argument_scored'; // Use same event for frontend compatibility
    const data = {
      debateId: argument.debateId,
      argumentId: argument.id,
      rejected: true,
      rejectionReason: dto.moderationReason || 'Message non conforme aux règles du débat.',
      rejectionType: dto.moderation === 'REJECT' ? 'moderation' : 'gaming',
      gamingFlags: dto.gamingFlags || [],
      scores: {
        reliability: 0,
        impact: 0,
        total: 0,
        gifCategory: 0,
      },
      justification: {
        strengths: [],
        weaknesses: [dto.moderationReason || 'Message rejeté'],
        brief: dto.moderationReason || 'Ce message a été rejeté par la modération.',
      },
      timestamp: new Date().toISOString(),
    };

    await this.redisService.pubClient.publish(
      'websocket:notification',
      JSON.stringify({
        room,
        event,
        data,
      }),
    );

    this.logger.log(`📡 Published ${event} (REJECTED) for argument ${argument.id}`);
  }

  // =====================================================
  // BOT ARGUMENT GENERATION
  // =====================================================

  /**
   * Call the n8n webhook to generate a bot argument
   * This is used by BotPlayerService to generate responses for AI bots
   *
   * @param request The request payload with all context for argument generation
   * @returns The generated argument and metadata
   */
  async callBotArgumentGeneration(request: BotArgumentRequestDto): Promise<BotArgumentResponseDto> {
    const url = `${this.webhookBaseUrl}/bot-argument`;

    this.logger.log(
      `🤖 Calling n8n BotArgument for debate ${request.debateId} ` +
      `(bot=${request.botUsername}, skill=${request.botSkillLevel}, turn=${request.turnNumber})`,
    );

    try {
      const response: AxiosResponse<BotArgumentResponseDto> = await axios.post(
        url,
        request,
        {
          timeout: 60000, // 60s timeout (generation can take time)
        },
      );

      this.logger.log(
        `✅ n8n BotArgument response received for debate ${request.debateId}: ` +
        `"${response.data.generatedArgument.substring(0, 50)}..."`,
      );

      return response.data;
    } catch (error) {
      this.logger.error(`❌ n8n BotArgument failed for debate ${request.debateId}: ${error.message}`);

      // Return a fallback response in case of error
      return this.generateFallbackBotArgument(request);
    }
  }

  /**
   * Generate a fallback bot argument if n8n fails
   * This ensures the game continues even if the webhook is down
   */
  private generateFallbackBotArgument(request: BotArgumentRequestDto): BotArgumentResponseDto {
    this.logger.warn(`⚠️ Using fallback bot argument for debate ${request.debateId}`);

    // Simple fallback responses based on language
    const fallbackResponses = {
      fr: [
        "C'est un point intéressant, mais je pense qu'il faut aussi considérer d'autres aspects de la question.",
        "Je comprends ton point de vue, cependant je reste convaincu que ma position est plus solide.",
        "Tu soulèves un argument valide, mais cela ne change pas fondamentalement ma position sur ce sujet.",
        "Je vois ce que tu veux dire, mais les faits montrent une réalité différente.",
      ],
      en: [
        "That's an interesting point, but I think we also need to consider other aspects of the issue.",
        "I understand your perspective, however I remain convinced that my position is stronger.",
        "You raise a valid argument, but it doesn't fundamentally change my position on this topic.",
        "I see what you mean, but the facts show a different reality.",
      ],
    };

    const responses = fallbackResponses[request.language] || fallbackResponses.en;
    const randomResponse = responses[Math.floor(Math.random() * responses.length)];

    return {
      generatedArgument: randomResponse,
      estimatedQuality: 5,
      usedStrategy: 'fallback',
      intentionalMistakes: [],
      processingTimeMs: 0,
    };
  }

  // =====================================================
  // COACHING (M4 - Post-debate performance analysis)
  // =====================================================

  private readonly MIN_ARGUMENTS_FOR_COACHING = 3;

  /**
   * Build the compact payload sent to n8n M4 for coaching analysis.
   * Uses rawText (not cleanText) so clarity assessment reflects what the player actually wrote.
   */
  private async buildCoachingPayload(debateId: string, userId: string, playerRole: 'host' | 'guest') {
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      include: {
        arguments: {
          orderBy: { turnIndex: 'asc' },
        },
        host: { select: { id: true } },
        guest: { select: { id: true } },
      },
    });

    if (!debate || !debate.guest) return null;

    const context = {
      debateId: debate.id,
      title: debate.title,
      hostView: debate.hostView,
      guestView: debate.guestView || '',
      nature: debate.n8nNature || 'MIXED',
      language: debate.language || 'en',
      playerRole,
    };

    const args = debate.arguments.map((arg) => {
      const isHost = arg.userId === debate.hostId;
      // Simplify fallacies: only name + severity (M4 has the text to find quotes)
      let fallacies: Array<{ name: string; severity: string }> = [];
      if ((arg as any).n8nFallacies) {
        try {
          const raw = (arg as any).n8nFallacies;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            fallacies = parsed.map((f: any) => ({ name: f.fallacy_type || f.fallacy_name || f.fallacy || f.name || f.type || 'unknown', severity: f.severity || 'MEDIUM' }));
          }
        } catch { /* ignore parse errors */ }
      }

      // Simplify biases: only name
      let biases: Array<{ name: string }> = [];
      if ((arg as any).n8nBiases) {
        try {
          const raw = (arg as any).n8nBiases;
          const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
          if (Array.isArray(parsed)) {
            biases = parsed.map((b: any) => ({ name: b.bias_type || b.bias_name || b.name || b.type || 'unknown' }));
          }
        } catch { /* ignore parse errors */ }
      }

      return {
        turnIndex: arg.turnIndex,
        author: isHost ? 'host' : 'guest',
        text: arg.rawText,
        score: (arg as any).n8nFinalScore ?? arg.scoreTotal ?? 0,
        engagement: (arg as any).n8nEngagement || null,
        unansweredPoints: (arg as any).n8nUnansweredPoints || [],
        fallacies,
        biases,
        burdenViolation: (arg as any).n8nBurdenViolation || false,
        strengths: (arg as any).n8nStrengths || [],
        weaknesses: (arg as any).n8nWeaknesses || [],
        engagementIssues: (arg as any).n8nEngagementIssues || [],
        factcheckScore: (arg as any).n8nFactcheckScore ?? null,
      };
    });

    return { ...context, arguments: args };
  }

  /**
   * Check if a debate has enough arguments for coaching (>= 3 per player).
   * Returns { canCoach, hostArgCount, guestArgCount }.
   */
  async canGenerateCoaching(debateId: string): Promise<{ canCoach: boolean; hostArgCount: number; guestArgCount: number }> {
    const debate = await this.prisma.debate.findUnique({
      where: { id: debateId },
      select: { hostId: true, guestId: true },
    });

    if (!debate || !debate.guestId) return { canCoach: false, hostArgCount: 0, guestArgCount: 0 };

    const [hostArgCount, guestArgCount] = await Promise.all([
      this.prisma.argument.count({ where: { debateId, userId: debate.hostId } }),
      this.prisma.argument.count({ where: { debateId, userId: debate.guestId } }),
    ]);

    return {
      canCoach: hostArgCount >= this.MIN_ARGUMENTS_FOR_COACHING && guestArgCount >= this.MIN_ARGUMENTS_FOR_COACHING,
      hostArgCount,
      guestArgCount,
    };
  }

  /**
   * Trigger coaching analysis for both players of a debate.
   * Creates CoachingResult records in 'pending' status, then calls n8n M4.
   * Fire-and-forget: does not wait for n8n response.
   */
  async callCoachingAnalysis(debateId: string): Promise<void> {
    try {
      const { canCoach, hostArgCount, guestArgCount } = await this.canGenerateCoaching(debateId);

      if (!canCoach) {
        this.logger.log(
          `⏭️ Coaching skipped for debate ${debateId}: insufficient arguments ` +
          `(host=${hostArgCount}, guest=${guestArgCount}, min=${this.MIN_ARGUMENTS_FOR_COACHING})`,
        );
        return;
      }

      const debate = await this.prisma.debate.findUnique({
        where: { id: debateId },
        select: {
          hostId: true,
          guestId: true,
          host: { select: { isBot: true } },
          guest: { select: { isBot: true } },
        },
      });

      if (!debate || !debate.guestId) return;

      const isHostBot = debate.host?.isBot === true;
      const isGuestBot = debate.guest?.isBot === true;

      // If both are bots, skip entirely
      if (isHostBot && isGuestBot) {
        this.logger.log(`⏭️ Coaching skipped for debate ${debateId}: both players are bots`);
        return;
      }

      // Create coaching for human players only (skip bots)
      const players = [
        { userId: debate.hostId, role: 'host' as const, isBot: isHostBot },
        { userId: debate.guestId, role: 'guest' as const, isBot: isGuestBot },
      ].filter(p => !p.isBot);

      for (const { userId, role } of players) {
        try {
          // Upsert to handle potential duplicate calls
          const coachingResult = await this.prisma.coachingResult.upsert({
            where: { debateId_userId: { debateId, userId } },
            create: { debateId, userId, status: 'pending' },
            update: { status: 'pending' },
          });

          const payload = await this.buildCoachingPayload(debateId, userId, role);
          if (!payload) continue;

          const url = `${this.webhookBaseUrl}/coaching`;

          // Fire-and-forget: n8n returns coaching JSON directly (responseMode: lastNode)
          axios.post(url, payload, { timeout: 120000 })
            .then(async (response) => {
              const result = response.data;
              this.logger.log(`✅ n8n Coaching M4 response received for ${role} in debate ${debateId}`);

              await this.saveCoachingResult({
                coachingResultId: coachingResult.id,
                debateId,
                userId,
                indicators: result.indicators,
                coachingItems: result.coachingItems,
                learning: result.learning,
              });
            })
            .catch((error) => {
              this.logger.error(`❌ n8n Coaching M4 failed for ${role} in debate ${debateId}: ${error.message}`);
              // Mark as error so frontend doesn't wait forever
              this.prisma.coachingResult.update({
                where: { id: coachingResult.id },
                data: { status: 'error' },
              }).catch(() => {});
            });

        } catch (error) {
          this.logger.error(`❌ Failed to create coaching for ${role} in debate ${debateId}: ${error.message}`);
        }
      }
    } catch (error) {
      this.logger.error(`❌ Coaching analysis failed for debate ${debateId}: ${error.message}`);
    }
  }

  /**
   * Save coaching result from n8n M4 callback.
   * Updates the CoachingResult record with indicators, coaching items, and learnings.
   * Emits 'coaching_ready' WebSocket event to the user.
   */
  async saveCoachingResult(dto: CoachingResultDto): Promise<void> {
    this.logger.log(`📥 Saving coaching result ${dto.coachingResultId} for user ${dto.userId}`);

    try {
      await this.prisma.coachingResult.update({
        where: { id: dto.coachingResultId },
        data: {
          status: 'ready',
          indicators: dto.indicators as any,
          coachingItems: dto.coachingItems as any,
          learnings: dto.learning as any,
        },
      });

      // Emit WebSocket event to notify frontend
      const room = `user:${dto.userId}`;
      const event = 'coaching_ready';
      const data = {
        debateId: dto.debateId,
        userId: dto.userId,
        timestamp: new Date().toISOString(),
      };

      await this.redisService.pubClient.publish(
        'websocket:notification',
        JSON.stringify({ room, event, data }),
      );

      this.logger.log(`📡 Published coaching_ready for user ${dto.userId} (debate ${dto.debateId})`);
    } catch (error) {
      this.logger.error(`❌ Failed to save coaching result: ${error.message}`);
      throw error;
    }
  }
}
