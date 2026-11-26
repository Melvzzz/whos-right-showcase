import AsyncStorage from '@react-native-async-storage/async-storage';
import ArgumentsService from './arguments.service';
import { API_URL } from '../constants/api';

// Types pour le débat local
export interface LocalDebate {
  id: string;
  title: string;
  player1: {
    name: string;
    viewpoint: string;
    timer: number;
  };
  player2: {
    name: string;
    viewpoint: string;
    timer: number;
  };
  privateContext?: string;
  currentTurn: 'player1' | 'player2';
  arguments: LocalArgument[];
  status: 'active' | 'completed';
  maxArgumentTime: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface LocalArgument {
  id: string;
  playerId: 'player1' | 'player2';
  playerName: string;
  content: string;
  timestamp: Date;
  duration: number; // temps d'enregistrement en secondes
  analysisData?: {
    reformulated?: string;
    score?: number;
    feedback?: string;
    sources?: Array<{
      title: string;
      url: string;
      relevance: number;
    }>;
  };
  isProcessing?: boolean;
}

class LocalDuelService {
  private static readonly STORAGE_KEY = 'local_debates';
  private static readonly CURRENT_DEBATE_KEY = 'current_local_debate';

  /**
   * Créer un nouveau débat local
   */
  async createLocalDebate(
    setup: {
      title: string;
      player1: { name: string; viewpoint: string; timer: number };
      player2: { name: string; viewpoint: string; timer: number };
      privateContext?: string;
      gameMode?: 'COMPETITIVE' | 'EXPLORATORY';
      maxArgumentTime: number;
    },
    userToken: string
  ): Promise<LocalDebate> {
    try {
      // 1. Créer le débat en base de données via l'API
      const response = await fetch(`${API_URL}/local-debates`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          title: setup.title,
          player1Name: setup.player1.name,
          player1Viewpoint: setup.player1.viewpoint,
          player2Name: setup.player2.name,
          player2Viewpoint: setup.player2.viewpoint,
          privateContext: setup.privateContext,
          gameMode: setup.gameMode || 'COMPETITIVE',
          maxArgumentTime: setup.maxArgumentTime,
          player1Timer: setup.player1.timer,
          player2Timer: setup.player2.timer,
        }),
      });

      if (!response.ok) {
        throw new Error(`Échec création débat backend: ${response.status}`);
      }

      const data = await response.json();
      const backendDebate = data.localDebate;

      // 2. Créer la structure locale pour AsyncStorage
      const now = new Date();
      const debate: LocalDebate = {
        id: backendDebate.id, // Utiliser l'ID du backend
        title: setup.title,
        player1: setup.player1,
        player2: setup.player2,
        privateContext: setup.privateContext,
        currentTurn: 'player1',
        arguments: [],
        status: 'active',
        maxArgumentTime: setup.maxArgumentTime,
        createdAt: now,
        updatedAt: now,
      };

      // 3. Sauvegarder le débat comme débat actuel
      await this.saveCurrentDebate(debate);

      // 4. Ajouter à l'historique des débats locaux
      await this.addToHistory(debate);

      return debate;

    } catch (error) {
      console.error('❌ Erreur création débat local:', error);
      throw error;
    }
  }

  /**
   * Récupérer le débat local actuel
   */
  async getCurrentDebate(): Promise<LocalDebate | null> {
    try {
      const debateJson = await AsyncStorage.getItem(LocalDuelService.CURRENT_DEBATE_KEY);
      if (!debateJson) return null;

      const debate = JSON.parse(debateJson);
      // Convertir les dates
      debate.createdAt = new Date(debate.createdAt);
      debate.updatedAt = new Date(debate.updatedAt);
      debate.arguments.forEach((arg: any) => {
        arg.timestamp = new Date(arg.timestamp);
      });

      return debate;
    } catch (error) {
      console.error('❌ Erreur récupération débat actuel:', error);
      return null;
    }
  }

  /**
   * Sauvegarder le débat actuel
   */
  async saveCurrentDebate(debate: LocalDebate): Promise<void> {
    try {
      debate.updatedAt = new Date();
      const debateJson = JSON.stringify(debate);
      await AsyncStorage.setItem(LocalDuelService.CURRENT_DEBATE_KEY, debateJson);
    } catch (error) {
      console.error('❌ Erreur sauvegarde débat:', error);
      throw error;
    }
  }

  /**
   * Ajouter un argument au débat local
   */
  async addArgument(
    debate: LocalDebate,
    argumentData: {
      playerId: 'player1' | 'player2';
      playerName: string;
      content: string;
      duration: number;
    },
    userToken: string
  ): Promise<LocalDebate> {
    try {
      // 1. Créer l'argument côté backend
      const response = await fetch(`${API_URL}/local-debates/${debate.id}/arguments`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify({
          playerId: argumentData.playerId,
          playerName: argumentData.playerName,
          rawText: argumentData.content,
          duration: argumentData.duration,
        }),
      });

      if (!response.ok) {
        throw new Error(`Échec ajout argument backend: ${response.status}`);
      }

      const data = await response.json();
      const backendArgument = data.argument;

      // 2. Créer la structure locale
      const newArgument: LocalArgument = {
        id: backendArgument.id, // Utiliser l'ID du backend
        playerId: argumentData.playerId,
        playerName: argumentData.playerName,
        content: argumentData.content,
        timestamp: new Date(),
        duration: argumentData.duration,
        isProcessing: true,
      };

      // 3. Ajouter l'argument au débat local
      const updatedDebate = {
        ...debate,
        arguments: [...debate.arguments, newArgument],
        updatedAt: new Date(),
      };

      // 4. Sauvegarder immédiatement
      await this.saveCurrentDebate(updatedDebate);

      return updatedDebate;

    } catch (error) {
      console.error('❌ Erreur ajout argument:', error);
      throw error;
    }
  }

  /**
   * ⚠️ OBSOLÈTE : Cette fonction n'est plus utilisée
   * L'analyse est maintenant gérée automatiquement côté backend
   * via le pipeline M1→M23 lorsqu'on crée l'argument
   */
  // private async processArgumentAnalysis(...) { ... }

  /**
   * Changer de joueur actif
   */
  async switchPlayer(debate: LocalDebate): Promise<LocalDebate> {
    const newTurn = debate.currentTurn === 'player1' ? 'player2' : 'player1';

    const updatedDebate = {
      ...debate,
      currentTurn: newTurn,
      updatedAt: new Date(),
    };

    await this.saveCurrentDebate(updatedDebate);

    return updatedDebate;
  }

  /**
   * Vérifier les conditions de fin de débat
   */
  shouldEndDebate(debate: LocalDebate): boolean {
    // Fin si un joueur n'a plus de temps
    if (debate.player1.timer <= 0 || debate.player2.timer <= 0) {
      return true;
    }

    // Fin si trop d'arguments (limite arbitraire)
    if (debate.arguments.length >= 20) {
      return true;
    }

    return false;
  }

  /**
   * Terminer le débat et calculer les scores
   */
  async endDebate(debate: LocalDebate): Promise<LocalDebate> {
    const finalDebate = {
      ...debate,
      status: 'completed' as const,
      updatedAt: new Date(),
    };

    await this.saveCurrentDebate(finalDebate);
    await AsyncStorage.removeItem(LocalDuelService.CURRENT_DEBATE_KEY);

    return finalDebate;
  }

  /**
   * Calculer les statistiques du débat pour le récap
   */
  calculateDebateStats(debate: LocalDebate) {
    const player1Args = debate.arguments.filter(arg => arg.playerId === 'player1');
    const player2Args = debate.arguments.filter(arg => arg.playerId === 'player2');

    const calculatePlayerStats = (args: LocalArgument[]) => {
      const scores = args
        .filter(arg => arg.analysisData?.score)
        .map(arg => arg.analysisData!.score!);

      const totalScore = scores.reduce((sum, score) => sum + score, 0);
      const avgScore = scores.length > 0 ? totalScore / scores.length : 0;

      const bestArg = args.reduce((best, current) => {
        const currentScore = current.analysisData?.score || 0;
        const bestScore = best?.analysisData?.score || 0;
        return currentScore > bestScore ? current : best;
      }, args[0]);

      const worstArg = args.reduce((worst, current) => {
        const currentScore = current.analysisData?.score || 100;
        const worstScore = worst?.analysisData?.score || 100;
        return currentScore < worstScore ? current : worst;
      }, args[0]);

      return {
        totalArguments: args.length,
        totalScore: Math.round(totalScore),
        averageScore: Math.round(avgScore),
        bestArgument: bestArg,
        worstArgument: worstArg,
        timeUsed: Math.round((args.reduce((sum, arg) => sum + arg.duration, 0) / 60) * 10) / 10, // en minutes
      };
    };

    const player1Stats = calculatePlayerStats(player1Args);
    const player2Stats = calculatePlayerStats(player2Args);

    // Déterminer le gagnant
    let winner: 'player1' | 'player2' | 'tie';
    if (player1Stats.averageScore > player2Stats.averageScore) {
      winner = 'player1';
    } else if (player2Stats.averageScore > player1Stats.averageScore) {
      winner = 'player2';
    } else {
      winner = 'tie';
    }

    return {
      player1: player1Stats,
      player2: player2Stats,
      winner,
      totalArguments: debate.arguments.length,
      debateDuration: Math.round((new Date().getTime() - debate.createdAt.getTime()) / (1000 * 60)), // en minutes
    };
  }

  /**
   * Ajouter le débat à l'historique
   */
  private async addToHistory(debate: LocalDebate): Promise<void> {
    try {
      const historyJson = await AsyncStorage.getItem(LocalDuelService.STORAGE_KEY);
      const history: LocalDebate[] = historyJson ? JSON.parse(historyJson) : [];

      // Limiter l'historique à 50 débats max
      if (history.length >= 50) {
        history.shift(); // Supprimer le plus ancien
      }

      history.push(debate);

      await AsyncStorage.setItem(LocalDuelService.STORAGE_KEY, JSON.stringify(history));
    } catch (error) {
      console.error('❌ Erreur sauvegarde historique:', error);
    }
  }

  /**
   * Récupérer l'historique des débats locaux
   */
  async getLocalDebatesHistory(): Promise<LocalDebate[]> {
    try {
      const historyJson = await AsyncStorage.getItem(LocalDuelService.STORAGE_KEY);
      if (!historyJson) return [];

      const history = JSON.parse(historyJson);

      // Convertir les dates
      return history.map((debate: any) => ({
        ...debate,
        createdAt: new Date(debate.createdAt),
        updatedAt: new Date(debate.updatedAt),
        arguments: debate.arguments.map((arg: any) => ({
          ...arg,
          timestamp: new Date(arg.timestamp)
        }))
      }));
    } catch (error) {
      console.error('❌ Erreur récupération historique:', error);
      return [];
    }
  }

  /**
   * Nettoyer le débat actuel (en cas d'abandon)
   */
  async clearCurrentDebate(): Promise<void> {
    try {
      await AsyncStorage.removeItem(LocalDuelService.CURRENT_DEBATE_KEY);
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Vérifier si des arguments sont encore en cours de traitement
   */
  async checkProcessingStatus(debateId: string, userToken: string): Promise<{
    hasProcessingArguments: boolean;
    processingCount: number;
    totalArguments: number;
    completedCount: number;
    failedCount: number;
    processingArgs: Array<{id: string; state: string; turnIndex: number; playerId: string; playerName: string}>;
  }> {
    try {
      const response = await fetch(`${API_URL}/local-debates/${debateId}/processing-status`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Échec vérification statut: ${response.status}`);
      }

      const data = await response.json();

      return data;

    } catch (error) {
      throw error;
    }
  }

  /**
   * Terminer le débat côté backend (fermeture en base)
   */
  async endDebateOnBackend(debateId: string, userToken: string): Promise<void> {
    try {
      const response = await fetch(`${API_URL}/local-debates/${debateId}/end`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Échec fermeture débat: ${response.status}`);
      }

    } catch (error) {
      throw error;
    }
  }

  /**
   * Récupérer le récapitulatif d'un débat local depuis le backend
   * Format compatible avec RecapA/RecapB
   */
  async getLocalDebateRecap(debateId: string, userToken: string): Promise<any> {
    try {
      const response = await fetch(`${API_URL}/local-debates/${debateId}/recap`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
      });

      if (!response.ok) {
        throw new Error(`Échec récupération récap: ${response.status}`);
      }

      const recapData = await response.json();

      return recapData;

    } catch (error) {
      throw error;
    }
  }
}

export default new LocalDuelService();