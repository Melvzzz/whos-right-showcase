import { API_URL } from '../constants/api';

/**
 * Interface pour les résultats d'un débat
 */
export interface DebateResult {
  hostScore: number;
  guestScore: number;
  winner: 'host' | 'guest' | 'tie';
}

/**
 * Interface pour les résultats du scoring
 */
export interface DebateScoringResult {
  hostEloChange: number;
  guestEloChange: number;
  hostXPGain: number;
  guestXPGain: number;
  hostNewElo: number;
  guestNewElo: number;
}

/**
 * Réponse de l'API de finalisation
 */
export interface FinalizeDebateResponse {
  success: boolean;
  result?: DebateScoringResult;
  message?: string;
  error?: string;
}

/**
 * Service pour gérer les calculs de scoring ELO et XP
 */
export class ScoringService {
  
  /**
   * Finalise un débat en calculant et appliquant les scores ELO et XP
   */
  static async finalizeDebate(
    debateId: string, 
    debateResult: DebateResult,
    token: string
  ): Promise<FinalizeDebateResponse> {
    try {
      const response = await fetch(`${API_URL}/debates/${debateId}/finalize`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(debateResult),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();
      return data;

    } catch (error) {
      console.error('Erreur lors de la finalisation du débat:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Erreur inconnue'
      };
    }
  }

  /**
   * Calcule localement les gains d'XP pour affichage preview
   * (sans persister en base - juste pour preview UI)
   */
  static calculateXPPreview(
    isWinner: boolean,
    scoreGap: number,
    mode: 'duel' | 'group' = 'duel'
  ): number {
    if (mode === 'group') {
      return 30; // XP général pour mode groupe
    }
    
    // Mode duel - même formule que le backend
    const baseXP = 30;
    const gapBonus = Math.floor(scoreGap / 5);
    
    if (isWinner) {
      return baseXP + 25 + gapBonus; // Gagnant : 30 + 25 + bonus
    } else {
      return Math.max(baseXP - gapBonus, 5); // Perdant : 30 - bonus (minimum 5 XP)
    }
  }

  /**
   * Calcule localement le changement d'ELO pour affichage preview
   * (sans persister en base - juste pour preview UI)
   */
  static calculateEloPreview(
    playerElo: number,
    opponentElo: number,
    result: number, // 1 = victoire, 0.5 = égalité, 0 = défaite
    scoreGap: number
  ): number {
    // Formule ELO classique
    const eloDifference = opponentElo - playerElo;
    const expectedScore = 1 / (1 + Math.pow(10, eloDifference / 400));
    
    // Facteur K de base
    let kFactor = 32;
    
    // Bonus basé sur l'écart de scores (max +100% du K factor)
    const gapBonus = Math.min(scoreGap / 100, 1.0);
    kFactor = kFactor * (1 + gapBonus);
    
    return Math.round(kFactor * (result - expectedScore));
  }

  /**
   * Calcule le niveau basé sur l'XP général
   * Formule: Niveau N nécessite 100 + (N-1) * 75 + (N-1)² * 25 XP
   */
  static calculateLevel(totalXP: number): number {
    let level = 1;
    let xpRequired = 0;
    
    while (true) {
      const nextLevelXP = 100 + (level - 1) * 75 + Math.pow(level - 1, 2) * 25;
      if (xpRequired + nextLevelXP > totalXP) {
        break;
      }
      xpRequired += nextLevelXP;
      level++;
    }
    
    return level;
  }

  /**
   * Calcule l'XP requis pour le prochain niveau
   */
  static calculateXPForNextLevel(currentLevel: number): number {
    return 100 + (currentLevel) * 75 + Math.pow(currentLevel, 2) * 25;
  }

  /**
   * Calcule la progression vers le prochain niveau
   * @param totalXP XP total de l'utilisateur
   * @returns { currentLevel, xpInCurrentLevel, xpNeededForNext, progressPercent }
   */
  static calculateLevelProgress(totalXP: number): {
    currentLevel: number;
    xpInCurrentLevel: number;
    xpNeededForNext: number;
    progressPercent: number;
  } {
    const currentLevel = this.calculateLevel(totalXP);
    
    // Calculer l'XP total requis pour atteindre le niveau actuel
    let xpForCurrentLevel = 0;
    for (let i = 1; i < currentLevel; i++) {
      xpForCurrentLevel += 100 + (i - 1) * 75 + Math.pow(i - 1, 2) * 25;
    }
    
    // XP dans le niveau actuel
    const xpInCurrentLevel = totalXP - xpForCurrentLevel;
    
    // XP nécessaire pour le prochain niveau
    const xpNeededForNext = this.calculateXPForNextLevel(currentLevel);
    
    // Pourcentage de progression
    const progressPercent = Math.min((xpInCurrentLevel / xpNeededForNext) * 100, 100);
    
    return {
      currentLevel,
      xpInCurrentLevel,
      xpNeededForNext,
      progressPercent: Math.round(progressPercent)
    };
  }
} 