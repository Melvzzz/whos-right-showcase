import axios from 'axios';
import { API_URL } from '../constants/api';
import logger from '../utils/logger';

// Types pour les débats
export type GameMode = 'COMPETITIVE' | 'EXPLORATORY';

export type Debate = {
  id: string;
  title: string;
  hostId: string;
  guestId?: string;
  hostView: string;
  guestView?: string;
  mode: number; // 5 ou 15 minutes
  gameMode?: GameMode; // Mode de jeu (COMPETITIVE ou EXPLORATORY)
  status: 'waiting' | 'reserved' | 'active' | 'ended' | 'quit' | 'completed';
  extended: boolean;
  createdAt: string;
  endedAt?: string;
  // Nouveaux champs pour la réservation
  reservedBy?: string;
  reservedAt?: string;
  // ✅ ASYNC : Nouveaux champs pour débats asynchrones
  isLive?: boolean; // true = live, false = async
  maxMessagesPerUser?: number; // 10, 20 ou 30 pour débats async
  turnTimeout?: number; // Timeout par tour en heures (24h par défaut)
  currentTurnUserId?: string; // ID du joueur dont c'est le tour
  turnStartedAt?: string; // Timestamp du début du tour actuel
  turnNumber?: number; // Numéro du tour en cours
  stopProposedBy?: string; // ID du joueur qui propose l'arrêt
  stopProposedAt?: string; // Timestamp de la proposition
  expiresAt?: string; // Expiration pour débats non rejoints (2 jours)
  // ✅ NOUVEAU : Tracker qui a vu le récap pour masquer la carte
  recapViewedBy?: string[]; // IDs des utilisateurs qui ont vu le récap
  // ✅ NOUVEAU : Débat privé (friend duel)
  isPrivate?: boolean; // true = débat entre amis
  // Relations avec les utilisateurs
  host: {
    id: string;
    username: string;
    selectedAvatarId?: string;
    elo: number; // Backend utilise 'elo', pas 'eloScore'
    isBot?: boolean;
  };
  guest?: {
    id: string;
    username: string;
    selectedAvatarId?: string;
    elo: number; // Backend utilise 'elo', pas 'eloScore'
  };
  // Métadonnées pour les filtres
  themes?: string[];
  _count?: {
    arguments: number; // Total pour compatibilité
    hostArguments?: number; // ✅ NOUVEAU : Arguments de l'hôte
    guestArguments?: number; // ✅ NOUVEAU : Arguments de l'invité
  };
};

export type CreateDebateData = {
  title: string;
  hostView: string;
  mode: number; // 5 ou 15 minutes
  themes: string[]; // 1 à 3 thèmes maximum
  // ✅ ASYNC : Nouveaux champs optionnels
  isLive?: boolean; // true = live (défaut), false = async
  maxMessagesPerUser?: number; // 10, 20 ou 30 (pour débats async uniquement)
  // ✅ n8n : Mode de jeu
  gameMode?: GameMode; // COMPETITIVE (défaut) ou EXPLORATORY
  // ✅ NOUVEAU : Langue du débat
  language?: 'fr' | 'en'; // Langue du débat (héritée du créateur si non spécifiée)
  // ✅ NOUVEAU : Tracking de la suggestion utilisée
  suggestionId?: string; // ID de la suggestion (evergreen ou trending)
  suggestionType?: 'evergreen' | 'trending'; // Type de suggestion
};

export type JoinDebateData = {
  guestView: string;
};

export type CreatePrivateDebateData = {
  title: string;
  hostView: string;
  mode: number;
  privateContext?: string;
  themes?: string[];
  gameMode?: GameMode; // Mode de jeu (COMPETITIVE ou EXPLORATORY)
  // ✅ NOUVEAU : Support async pour friend duels
  isLive?: boolean; // true = live (défaut), false = async
  maxMessagesPerUser?: number; // 10, 20 ou 30 pour async
};

export type PrivateDebateResponse = {
  debate: Debate;
  invitation: {
    id: string;
    inviteCode: string;
    inviteUrl: string;
  };
};

// Les 10 thèmes disponibles
export const DEBATE_THEMES = [
  'Politique & Société',
  'Science & Tech', 
  'Planète & Climat',
  'Santé & Bien-être',
  'Argent & Travail',
  'Éthique & Valeurs',
  'Histoire & Mémoire',
  'Culture & Loisirs',
  'École & Apprentissage',
  'Sport & Lifestyle'
] as const;

export type DebateTheme = typeof DEBATE_THEMES[number];

class DebatesService {
  private static instance: DebatesService;
  private authToken?: string; // Token JWT pour l'authentification

  private constructor() {}

  static getInstance(): DebatesService {
    if (!DebatesService.instance) {
      DebatesService.instance = new DebatesService();
    }
    return DebatesService.instance;
  }

  /**
   * Configure le token d'authentification
   */
  setAuthToken(token: string) {
    this.authToken = token;
    // Configurer aussi le token pour ArgumentsService
    const ArgumentsService = require('./arguments.service').default;
    ArgumentsService.setAuthToken(token);
  }

  /**
   * Récupère les headers d'authentification pour axios
   */
  private getAuthHeaders() {
    return this.authToken ? {
      'Authorization': `Bearer ${this.authToken}`,
      'Content-Type': 'application/json'
    } : {
      'Content-Type': 'application/json'
    };
  }

  /**
   * Options de filtrage pour les débats
   */
  public static FilterOptions: {
    themes?: string[];
    languages?: string[];
    isLive?: boolean;
  } = {};

  /**
   * Récupère la liste des débats en attente d'adversaire
   * Avec filtres optionnels par thème, langues et mode
   */
  async getWaitingDebates(options?: { themes?: string[]; languages?: string[]; isLive?: boolean }): Promise<Debate[]> {
    try {
      logger.info('🌐 [DebatesService] Appel API getWaitingDebates...');
      logger.debug('🔑 [DebatesService] Token configuré:', !!this.authToken);

      const params = new URLSearchParams();
      params.append('status', 'waiting');

      // Filtres par thème
      if (options?.themes && options.themes.length > 0) {
        options.themes.forEach(theme => params.append('themes', theme));
      }

      // ✅ NOUVEAU : Filtres par langues (comma-separated)
      if (options?.languages && options.languages.length > 0) {
        params.append('languages', options.languages.join(','));
      }

      // ✅ NOUVEAU : Filtre par mode live/async
      if (options?.isLive !== undefined) {
        params.append('live', options.isLive.toString());
      }

      const url = `${API_URL}/debates?${params.toString()}`;
      logger.debug('📡 [DebatesService] URL appelée:', url);

      const response = await axios.get<Debate[]>(url, {
        headers: this.getAuthHeaders(),
        timeout: 15000 // 15 secondes timeout
      });
      
      logger.debug('✅ [DebatesService] Réponse reçue:', {
        status: response.status,
        count: response.data?.length || 0
      });

      // Filtrage côté frontend pour s'assurer qu'on n'a que des débats en attente
      const waitingDebates = response.data.filter(debate => {
        const isValid = debate.status === 'waiting' && !debate.guestId;
        if (!isValid) {
          logger.debug('🚫 [DebatesService] Débat filtré:', {
            id: debate.id,
            status: debate.status,
            guestId: debate.guestId,
            reason: debate.status !== 'waiting' ? 'status non-waiting' : 'déjà rejoint'
          });
        }
        return isValid;
      });

      logger.info('🎯 [DebatesService] Débats valides après filtrage:', waitingDebates.length);
      
      return waitingDebates;
    } catch (error) {
      logger.error('❌ [DebatesService] Erreur lors de la récupération des débats:', error);
      if (axios.isAxiosError(error) && error.response) {
        logger.error('📋 [DebatesService] Détails de l\'erreur:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data
        });
        throw new Error(error.response.data.message || 'Erreur lors de la récupération des débats');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Créer un nouveau débat
   */
  async createDebate(data: CreateDebateData): Promise<Debate> {
    try {
      const response = await axios.post<Debate>(`${API_URL}/debates`, data, {
        headers: this.getAuthHeaders(),
        timeout: 15000 // 15 secondes timeout
      });
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la création du débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la création du débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Rejoindre un débat existant
   */
  async joinDebate(debateId: string, data: JoinDebateData): Promise<Debate> {
    try {
      console.log('🔄 Tentative de rejoindre le débat:', {
        debateId,
        guestView: data.guestView,
        authToken: this.authToken ? '✅ Présent' : '❌ Manquant'
      });

      // D'abord, vérifier l'état actuel du débat
      const currentDebate = await this.getDebateById(debateId);

      const response = await axios.patch<Debate>(`${API_URL}/debates/${debateId}/join`, data, {
        headers: this.getAuthHeaders()
      });

      console.log('✅ Débat rejoint avec succès:', response.data);
      return response.data;
    } catch (error) {
      console.error('❌ Erreur lors de la tentative de rejoindre le débat:', error);
      
      if (axios.isAxiosError(error) && error.response) {
        console.error('📋 Détails de l\'erreur:', {
          status: error.response.status,
          statusText: error.response.statusText,
          data: error.response.data,
          headers: error.response.headers
        });
        
        // Messages d'erreur spécifiques selon le code
        if (error.response.status === 400) {
          const message = error.response.data.message || 'Erreur de validation';
          console.error('🔍 Erreur 400 - Cause probable:', message);
          throw new Error(message);
        }
        
        throw new Error(error.response.data.message || 'Impossible de rejoindre ce débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Récupérer les détails d'un débat spécifique
   */
  async getDebateById(debateId: string): Promise<Debate> {
    try {
      const response = await axios.get<Debate>(`${API_URL}/debates/${debateId}`, {
        headers: this.getAuthHeaders(),
        timeout: 15000 // 15 secondes timeout
      });
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la récupération du débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Débat introuvable');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Rejoindre un débat en tant qu'invité
   */
  async join(debateId: string, data: { guestView: string }): Promise<Debate> {
    try {
      console.log('🎯 Rejoindre le débat:', debateId, 'avec position:', data.guestView);
      const response = await axios.patch<Debate>(`${API_URL}/debates/${debateId}/join`, data, {
        headers: this.getAuthHeaders()
      });
      console.log('✅ Débat rejoint avec succès:', response.data.id);
      return response.data;
    } catch (error) {
      console.error('Erreur lors de rejoindre le débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Impossible de rejoindre ce débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Réserver un débat pour prévisualisation (30 secondes max)
   */
  async reserveDebate(debateId: string): Promise<Debate> {
    try {
      const response = await axios.patch<Debate>(`${API_URL}/debates/${debateId}/reserve`, {}, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la réservation du débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Impossible de réserver ce débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Libérer la réservation d'un débat
   */
  async unreserveDebate(debateId: string): Promise<Debate> {
    try {
      const response = await axios.patch<Debate>(`${API_URL}/debates/${debateId}/unreserve`, {}, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la libération de la réservation:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Impossible de libérer la réservation');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Annule un débat en attente
   * @param debateId ID du débat à annuler
   */
  async cancelDebate(debateId: string): Promise<void> {
    try {
      await axios.delete(`${API_URL}/debates/${debateId}`, {
        headers: this.getAuthHeaders()
      });
    } catch (error) {
      console.error('Erreur lors de l\'annulation du débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de l\'annulation du débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * ✅ NOUVEAU : Crée un débat privé avec invitation (mode ami)
   * @param data Données du débat privé
   * @returns Le débat créé et l'invitation générée
   */
  async createPrivateDebate(data: CreatePrivateDebateData): Promise<PrivateDebateResponse> {
    try {
      const response = await axios.post(`${API_URL}/debates/private`, data, {
        headers: this.getAuthHeaders()
      });
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la création du débat privé:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la création du débat privé');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  // ============================================================
  // ✅ ASYNC : NOUVELLES MÉTHODES POUR DÉBATS ASYNCHRONES
  // ============================================================

  /**
   * Récupère les débats asynchrones en cours de l'utilisateur
   * Triés par urgence (tour + temps restant)
   */
  async getMyAsyncDebates(): Promise<Debate[]> {
    try {
      const response = await axios.get<Debate[]>(`${API_URL}/debates/my-async`, {
        headers: this.getAuthHeaders(),
        timeout: 15000
      });
      return response.data;
    } catch (error) {
      console.error('❌ [DebatesService] Erreur lors de la récupération des débats async:', error);
      if (axios.isAxiosError(error) && error.response) {
        console.error('📊 [DebatesService] Détails de l\'erreur:', {
          status: error.response.status,
          data: error.response.data
        });
        throw new Error(error.response.data.message || 'Erreur lors de la récupération des débats async');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Propose l'arrêt d'un débat asynchrone
   * @param debateId ID du débat
   */
  async proposeStop(debateId: string): Promise<Debate> {
    try {
      const response = await axios.post<Debate>(
        `${API_URL}/debates/${debateId}/propose-stop`,
        {},
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la proposition d\'arrêt:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la proposition d\'arrêt');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Accepte une proposition d'arrêt de débat asynchrone
   * @param debateId ID du débat
   */
  async acceptStop(debateId: string): Promise<Debate> {
    try {
      const response = await axios.post<Debate>(
        `${API_URL}/debates/${debateId}/accept-stop`,
        {},
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Erreur lors de l\'acceptation:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de l\'acceptation');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Refuse une proposition d'arrêt de débat asynchrone
   * @param debateId ID du débat
   */
  async refuseStop(debateId: string): Promise<Debate> {
    try {
      const response = await axios.post<Debate>(
        `${API_URL}/debates/${debateId}/refuse-stop`,
        {},
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Erreur lors du refus:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors du refus');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Répond à une proposition d'arrêt de débat asynchrone
   * @param debateId ID du débat
   * @param accept true pour accepter, false pour refuser
   */
  async respondStop(debateId: string, accept: boolean): Promise<Debate> {
    try {
      const response = await axios.post<Debate>(
        `${API_URL}/debates/${debateId}/respond-stop`,
        { accept },
        { headers: this.getAuthHeaders() }
      );
      return response.data;
    } catch (error) {
      console.error('Erreur lors de la réponse à la proposition d\'arrêt:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la réponse à la proposition d\'arrêt');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Propose l'arrêt d'un débat live
   * @param debateId ID du débat
   * @param username Nom de l'utilisateur qui propose
   */
  async proposeEnd(debateId: string, username: string): Promise<void> {
    try {
      await axios.post(
        `${API_URL}/debates/${debateId}/propose-end`,
        { username },
        { headers: this.getAuthHeaders() }
      );
    } catch (error) {
      console.error('Erreur lors de la proposition d\'arrêt (live):', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la proposition d\'arrêt');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Accepte l'arrêt d'un débat live (avec vérification de sécurité)
   * @param debateId ID du débat
   * @param username Nom de l'utilisateur qui accepte
   */
  async acceptEnd(debateId: string, username: string): Promise<void> {
    try {
      await axios.post(
        `${API_URL}/debates/${debateId}/accept-end`,
        { username },
        { headers: this.getAuthHeaders() }
      );
    } catch (error) {
      console.error('Erreur lors de l\'acceptation (live):', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de l\'acceptation');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Refuse l'arrêt d'un débat live
   * @param debateId ID du débat
   * @param username Nom de l'utilisateur qui refuse
   */
  async refuseEnd(debateId: string, username: string): Promise<void> {
    try {
      await axios.post(
        `${API_URL}/debates/${debateId}/refuse-end`,
        { username },
        { headers: this.getAuthHeaders() }
      );
    } catch (error) {
      console.error('Erreur lors du refus (live):', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors du refus');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Abandonne un débat asynchrone (forfait)
   * @param debateId ID du débat
   */
  async forfeit(debateId: string): Promise<void> {
    try {
      await axios.post(
        `${API_URL}/debates/${debateId}/forfeit`,
        {},
        { headers: this.getAuthHeaders() }
      );
    } catch (error) {
      console.error('Erreur lors de l\'abandon du débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de l\'abandon du débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * ✅ ASYNC : Libère un débat rejoint sans avoir envoyé d'argument
   * Utilisé quand le guest quitte l'écran de débat async avant d'envoyer son premier argument
   * @param debateId ID du débat à libérer
   */
  async releaseJoin(debateId: string): Promise<void> {
    try {
      await axios.post(
        `${API_URL}/debates/${debateId}/release-join`,
        {},
        { headers: this.getAuthHeaders() }
      );
      console.log('✅ [DebatesService] Débat libéré avec succès');
    } catch (error) {
      console.error('❌ [DebatesService] Erreur lors de la libération du débat:', error);
      // On ne throw pas d'erreur car c'est un appel de nettoyage qui ne doit pas bloquer
    }
  }

  /**
   * Supprime un débat (en attente ou en cours)
   * @param debateId ID du débat à supprimer
   */
  async deleteDebate(debateId: string): Promise<void> {
    try {
      await axios.delete(`${API_URL}/debates/${debateId}`, {
        headers: this.getAuthHeaders(),
        timeout: 15000
      });
    } catch (error) {
      console.error('Erreur lors de la suppression du débat:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la suppression du débat');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * ✅ ASYNC : Récupère le nombre de débats asynchrones simultanés actifs
   * Retourne { count, limit, remaining, canCreate, role }
   */
  async getAsyncDebateCount(): Promise<{
    count: number;
    limit: number;
    remaining: number;
    canCreate: boolean;
    role: string;
  }> {
    try {
      const response = await axios.get(`${API_URL}/debates/async-count`, {
        headers: this.getAuthHeaders(),
        timeout: 15000
      });
      return response.data;
    } catch (error) {
      console.error('❌ [DebatesService] Erreur lors de la récupération du compteur async:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la récupération du compteur');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  /**
   * Récupère les débats disponibles avec filtre optionnel live/async
   * @param isLive undefined = tous, true = live uniquement, false = async uniquement
   */
  async getAvailableDebates(isLive?: boolean): Promise<Debate[]> {
    try {
      const params = new URLSearchParams();
      params.append('status', 'waiting');

      if (isLive !== undefined) {
        params.append('live', isLive.toString());
      }

      const response = await axios.get<Debate[]>(`${API_URL}/debates?${params.toString()}`, {
        headers: this.getAuthHeaders(),
        timeout: 15000
      });

      return response.data;
    } catch (error) {
      console.error('Erreur lors de la récupération des débats disponibles:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la récupération des débats');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }

  // ============================================================
  // Sprint 3: RECOMMANDATIONS
  // ============================================================

  /**
   * Récupère les débats recommandés pour l'utilisateur
   * Utilise le profil évolutif pour recommander des débats avec:
   * - Sujets familiers (25%)
   * - Bridging politique (35%) - profils opposés
   * - Diversité d'âge (15%)
   * - Compatibilité ELO (25%)
   */
  async getRecommendations(options?: {
    languages?: string[];
    isLive?: boolean;
    limit?: number;
  }): Promise<RecommendedDebate[]> {
    try {
      const params = new URLSearchParams();

      if (options?.languages && options.languages.length > 0) {
        params.append('languages', options.languages.join(','));
      }

      if (options?.isLive !== undefined) {
        params.append('live', options.isLive.toString());
      }

      if (options?.limit) {
        params.append('limit', options.limit.toString());
      }

      const url = `${API_URL}/debates/recommendations?${params.toString()}`;
      const response = await axios.get<RecommendedDebate[]>(url, {
        headers: this.getAuthHeaders(),
        timeout: 15000,
      });

      return response.data;
    } catch (error) {
      console.error('❌ [DebatesService] Erreur lors de la récupération des recommandations:', error);
      if (axios.isAxiosError(error) && error.response) {
        throw new Error(error.response.data.message || 'Erreur lors de la récupération des recommandations');
      }
      throw new Error('Erreur de connexion au serveur');
    }
  }
}

// Type pour les débats recommandés
export type RecommendedDebate = {
  id: string;
  title: string;
  hostView: string;
  hostUsername: string;
  hostElo: number;
  createdAt: string;
  isLive: boolean;
  language: string;
  matchScore: number;
  matchReason: string;
};

export default DebatesService.getInstance(); 