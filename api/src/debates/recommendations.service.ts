import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

interface RecommendationScore {
  debateId: string;
  totalScore: number;
  subjectScore: number;
  bridgingScore: number;
  ageScore: number;
  eloScore: number;
  matchReason: string;
}

export interface RecommendedDebate {
  id: string;
  title: string;
  hostView: string;
  hostUsername: string;
  hostElo: number;
  createdAt: Date;
  isLive: boolean;
  language: string;
  matchScore: number;
  matchReason: string;
}

@Injectable()
export class RecommendationsService {
  constructor(private prisma: PrismaService) {}

  // Poids des critères de scoring
  private readonly WEIGHTS = {
    SUBJECT: 0.25,    // 25% - Sujet déjà débattu
    BRIDGING: 0.35,   // 35% - Opposition politique
    AGE: 0.15,        // 15% - Diversité d'âge
    ELO: 0.25,        // 25% - Compatibilité de niveau
  };

  // Seuil de confiance minimum pour utiliser les spectres
  private readonly MIN_SPECTRUM_CONFIDENCE = 0.2;

  // Différence ELO maximale acceptable
  private readonly MAX_ELO_DIFF = 400;

  /**
   * Récupère les débats recommandés pour un utilisateur
   */
  async getRecommendations(
    userId: string,
    options: {
      languages?: string[];
      isLive?: boolean;
      limit?: number;
    } = {},
  ): Promise<RecommendedDebate[]> {
    const { languages = ['fr'], isLive, limit = 20 } = options;

    // 1. Récupérer le profil de l'utilisateur
    const userProfile = await this.getUserProfile(userId);

    // 2. Récupérer les débats en attente (status = waiting, sans guest)
    const waitingDebates = await this.getWaitingDebates(userId, languages, isLive);

    if (waitingDebates.length === 0) {
      return [];
    }

    // 3. Calculer les scores pour chaque débat
    const scoredDebates = await Promise.all(
      waitingDebates.map(async (debate) => {
        const score = await this.calculateRecommendationScore(userProfile, debate);
        return { debate, score };
      }),
    );

    // 4. Trier par score décroissant et limiter
    const sortedDebates = scoredDebates
      .sort((a, b) => b.score.totalScore - a.score.totalScore)
      .slice(0, limit);

    // 5. Formater la réponse
    return sortedDebates.map(({ debate, score }) => ({
      id: debate.id,
      title: debate.title,
      hostView: debate.hostView,
      hostUsername: debate.host.username,
      hostElo: debate.host.elo,
      createdAt: debate.createdAt,
      isLive: debate.isLive,
      language: debate.language,
      matchScore: Math.round(score.totalScore * 100),
      matchReason: score.matchReason,
    }));
  }

  /**
   * Récupère le profil utilisateur avec ses préférences
   */
  private async getUserProfile(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        elo: true,
        preferences: {
          select: {
            ageRange: true,
            politicalSpectrum: true,
            economicSpectrum: true,
            socialSpectrum: true,
            spectrumConfidence: true,
            debatedSubjects: true,
          },
        },
      },
    });

    return {
      id: userId,
      elo: user?.elo || 1000,
      ageRange: user?.preferences?.ageRange || null,
      politicalSpectrum: user?.preferences?.politicalSpectrum ?? null,
      economicSpectrum: user?.preferences?.economicSpectrum ?? null,
      socialSpectrum: user?.preferences?.socialSpectrum ?? null,
      spectrumConfidence: user?.preferences?.spectrumConfidence || 0,
      debatedSubjects: (user?.preferences?.debatedSubjects as Record<string, number>) || {},
    };
  }

  /**
   * Récupère les débats en attente
   */
  private async getWaitingDebates(
    userId: string,
    languages: string[],
    isLive?: boolean,
  ) {
    const where: any = {
      status: 'waiting',
      guestId: null,
      hostId: { not: userId }, // Exclure ses propres débats
      isPrivate: false, // Exclure les débats privés
      language: { in: languages },
    };

    if (isLive !== undefined) {
      where.isLive = isLive;
    }

    return this.prisma.debate.findMany({
      where,
      select: {
        id: true,
        title: true,
        hostView: true,
        hostId: true,
        createdAt: true,
        isLive: true,
        language: true,
        // Signaux politiques du débat (M0)
        n8nSubjectTag: true,
        n8nHostPoliticalSignal: true,
        n8nHostEconomicSignal: true,
        n8nHostSocialSignal: true,
        n8nSignalConfidence: true,
        // Host info
        host: {
          select: {
            id: true,
            username: true,
            elo: true,
            preferences: {
              select: {
                ageRange: true,
                politicalSpectrum: true,
                economicSpectrum: true,
                socialSpectrum: true,
                spectrumConfidence: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100, // Limiter pour la perf
    });
  }

  /**
   * Calcule le score de recommandation pour un débat
   */
  private async calculateRecommendationScore(
    userProfile: Awaited<ReturnType<typeof this.getUserProfile>>,
    debate: Awaited<ReturnType<typeof this.getWaitingDebates>>[0],
  ): Promise<RecommendationScore> {
    // Initialiser les scores individuels
    let subjectScore = 0;
    let bridgingScore = 0;
    let ageScore = 0;
    let eloScore = 0;

    // Flags pour savoir quels critères sont utilisables
    let useBridging = true;
    let useAge = true;

    // 1. Score sujet (matching mots-clés)
    subjectScore = this.calculateSubjectScore(userProfile.debatedSubjects, debate);

    // 2. Score bridging politique
    const hostPrefs = debate.host.preferences;

    const canUseBridging =
      userProfile.spectrumConfidence >= this.MIN_SPECTRUM_CONFIDENCE &&
      (hostPrefs?.spectrumConfidence || 0) >= this.MIN_SPECTRUM_CONFIDENCE;

    if (canUseBridging) {
      bridgingScore = this.calculateBridgingScore(userProfile, debate);
    } else {
      useBridging = false;
    }

    // 3. Score diversité d'âge
    if (userProfile.ageRange && hostPrefs?.ageRange) {
      ageScore = this.calculateAgeScore(userProfile.ageRange, hostPrefs.ageRange);
    } else {
      useAge = false;
    }

    // 4. Score compatibilité ELO
    eloScore = this.calculateEloScore(userProfile.elo, debate.host.elo);

    // Redistribuer les poids si certains critères ne sont pas utilisables
    let weights = { ...this.WEIGHTS };
    if (!useBridging && !useAge) {
      // Redistribuer bridging et age sur subject et elo
      weights = {
        SUBJECT: 0.45,
        BRIDGING: 0,
        AGE: 0,
        ELO: 0.55,
      };
    } else if (!useBridging) {
      // Redistribuer bridging sur subject et elo
      weights = {
        SUBJECT: 0.35,
        BRIDGING: 0,
        AGE: 0.20,
        ELO: 0.45,
      };
    } else if (!useAge) {
      // Redistribuer age sur bridging et elo
      weights = {
        SUBJECT: 0.25,
        BRIDGING: 0.45,
        AGE: 0,
        ELO: 0.30,
      };
    }

    // Calculer le score total pondéré
    const totalScore =
      subjectScore * weights.SUBJECT +
      bridgingScore * weights.BRIDGING +
      ageScore * weights.AGE +
      eloScore * weights.ELO;

    // Déterminer la raison principale du match
    const matchReason = this.determineMatchReason(
      subjectScore,
      bridgingScore,
      ageScore,
      eloScore,
      useBridging,
      useAge,
    );

    return {
      debateId: debate.id,
      totalScore,
      subjectScore,
      bridgingScore,
      ageScore,
      eloScore,
      matchReason,
    };
  }

  /**
   * Calcule le score basé sur les sujets déjà débattus
   */
  private calculateSubjectScore(
    debatedSubjects: Record<string, number>,
    debate: { title: string; n8nSubjectTag: string | null },
  ): number {
    const titleLower = debate.title.toLowerCase();

    // Si le débat a un subjectTag, vérifier s'il matche
    if (debate.n8nSubjectTag && debatedSubjects[debate.n8nSubjectTag]) {
      const count = debatedSubjects[debate.n8nSubjectTag];
      return Math.min(count * 0.2, 1.0); // Max 1.0 après 5 débats sur le sujet
    }

    // Sinon, chercher par mots-clés dans le titre
    for (const [subject, count] of Object.entries(debatedSubjects)) {
      const keywords = subject.split('-');
      const allMatch = keywords.every((kw) => titleLower.includes(kw.toLowerCase()));
      if (allMatch) {
        return Math.min(count * 0.2, 1.0);
      }
    }

    return 0;
  }

  /**
   * Calcule le score de bridging politique
   * Plus les spectres sont opposés, plus le score est élevé
   */
  private calculateBridgingScore(
    userProfile: { politicalSpectrum: number | null; economicSpectrum: number | null; socialSpectrum: number | null },
    debate: {
      n8nHostPoliticalSignal: number | null;
      n8nHostEconomicSignal: number | null;
      n8nHostSocialSignal: number | null;
      n8nSignalConfidence: number | null;
      host: {
        preferences: {
          politicalSpectrum: number | null;
          economicSpectrum: number | null;
          socialSpectrum: number | null;
        } | null;
      };
    },
  ): number {
    // Utiliser les signaux M0 du débat si disponibles, sinon le profil du host
    const hostPolitical = debate.n8nHostPoliticalSignal ?? debate.host.preferences?.politicalSpectrum ?? 0;
    const hostEconomic = debate.n8nHostEconomicSignal ?? debate.host.preferences?.economicSpectrum ?? 0;
    const hostSocial = debate.n8nHostSocialSignal ?? debate.host.preferences?.socialSpectrum ?? 0;

    const userPolitical = userProfile.politicalSpectrum ?? 0;
    const userEconomic = userProfile.economicSpectrum ?? 0;
    const userSocial = userProfile.socialSpectrum ?? 0;

    // Calculer les différences sur chaque axe (valeurs entre 0 et 2)
    const politicalDiff = Math.abs(userPolitical - hostPolitical);
    const economicDiff = Math.abs(userEconomic - hostEconomic);
    const socialDiff = Math.abs(userSocial - hostSocial);

    // Moyenne des différences, normalisée entre 0 et 1
    const avgDiff = (politicalDiff + economicDiff + socialDiff) / 3 / 2;

    // Bonus pour les extrêmes qui se rencontrent
    if (avgDiff > 0.75) {
      return 1.0;
    }

    return avgDiff;
  }

  /**
   * Calcule le score de diversité d'âge
   */
  private calculateAgeScore(userAge: string, hostAge: string): number {
    if (userAge === hostAge) {
      return 0.2; // Même tranche = score faible
    }

    // Mapper les tranches d'âge à des indices
    const ageOrder = [
      'AGE_18_24',
      'AGE_25_34',
      'AGE_35_44',
      'AGE_45_54',
      'AGE_55_64',
      'AGE_65_PLUS',
    ];

    const userIndex = ageOrder.indexOf(userAge);
    const hostIndex = ageOrder.indexOf(hostAge);

    if (userIndex === -1 || hostIndex === -1) {
      return 0.5; // Si non trouvé, score neutre
    }

    // Plus la différence est grande, plus le score est élevé
    const diff = Math.abs(userIndex - hostIndex);
    return Math.min(diff * 0.25, 1.0); // Max 1.0 pour 4+ tranches de différence
  }

  /**
   * Calcule le score de compatibilité ELO
   */
  private calculateEloScore(userElo: number, hostElo: number): number {
    const diff = Math.abs(userElo - hostElo);

    if (diff <= 100) {
      return 1.0; // Parfait
    } else if (diff <= 200) {
      return 0.8; // Très bon
    } else if (diff <= 300) {
      return 0.5; // Acceptable
    } else if (diff <= this.MAX_ELO_DIFF) {
      return 0.3; // Limite
    } else {
      return 0.1; // Trop différent
    }
  }

  /**
   * Détermine la raison principale du match pour l'affichage
   * Priorise les raisons "intéressantes" (bridging, sujet, âge) sur l'ELO
   * car l'ELO est souvent à 100% et n'est pas une raison très informative
   */
  private determineMatchReason(
    subjectScore: number,
    bridgingScore: number,
    ageScore: number,
    eloScore: number,
    useBridging: boolean,
    useAge: boolean,
  ): string {
    // Prioriser les raisons les plus intéressantes (pas l'ELO qui est souvent 100%)

    // 1. Sujet familier - très pertinent si l'utilisateur a déjà débattu dessus
    if (subjectScore >= 0.4) {
      return 'Sujet familier';
    }

    // 2. Bridging politique - le plus intéressant pour la diversité
    if (useBridging && bridgingScore >= 0.5) {
      return 'Profil complémentaire';
    }

    // 3. Diversité générationnelle
    if (useAge && ageScore >= 0.5) {
      return 'Génération différente';
    }

    // 4. Bridging modéré (même si < 0.5, c'est plus intéressant que l'ELO)
    if (useBridging && bridgingScore >= 0.3) {
      return 'Profil complémentaire';
    }

    // 5. Diversité d'âge modérée
    if (useAge && ageScore >= 0.3) {
      return 'Génération différente';
    }

    // 6. Bon niveau ELO seulement si c'est vraiment le seul critère
    if (eloScore >= 0.8) {
      return 'Niveau similaire';
    }

    // 7. Fallback
    return 'Débat suggéré';
  }
}
