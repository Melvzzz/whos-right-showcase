import { useState, useEffect, useCallback } from 'react';
import DebatesService, { Debate } from '../services/debates.service';

/**
 * Hook pour gérer les débats asynchrones
 * Fournit les méthodes pour récupérer, proposer l'arrêt, et répondre aux propositions
 */
export const useAsyncDebates = () => {
  const [debates, setDebates] = useState<Debate[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isProposingStop, setIsProposingStop] = useState(false);
  const [isRespondingStop, setIsRespondingStop] = useState(false);

  /**
   * Récupère les débats asynchrones avec système de retry en cas d'erreur temporaire
   */
  const fetchDebates = useCallback(async (retryCount = 0) => {
    const MAX_RETRIES = 3;
    const RETRY_DELAY_MS = [1000, 2000, 4000]; // Backoff exponentiel: 1s, 2s, 4s

    try {
      setIsLoading(true);
      setError(null);
      const data = await DebatesService.getMyAsyncDebates();
      setDebates(data);
    } catch (err: any) {
      console.error(`❌ [useAsyncDebates] Erreur lors du chargement des débats (tentative ${retryCount + 1}/${MAX_RETRIES + 1}):`, err);

      // Si c'est une erreur 500 et qu'on a encore des retries disponibles
      if (err.message?.includes('500') && retryCount < MAX_RETRIES) {
        const delay = RETRY_DELAY_MS[retryCount] || 4000;
        console.log(`⏱️ [useAsyncDebates] Nouvelle tentative dans ${delay}ms...`);

        // Attendre avant de réessayer
        await new Promise(resolve => setTimeout(resolve, delay));

        // Réessayer
        return fetchDebates(retryCount + 1);
      }

      // Si on a épuisé les retries ou si c'est une autre erreur, on affiche l'erreur
      setError(err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Propose l'arrêt d'un débat
   */
  const proposeStop = useCallback(
    async (debateId: string) => {
      try {
        setIsProposingStop(true);
        await DebatesService.proposeStop(debateId);
        // Rafraîchir la liste après proposition
        await fetchDebates();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        setIsProposingStop(false);
      }
    },
    [fetchDebates]
  );

  /**
   * Répond à une proposition d'arrêt
   */
  const respondStop = useCallback(
    async (debateId: string, accept: boolean) => {
      try {
        setIsRespondingStop(true);
        await DebatesService.respondStop(debateId, accept);
        // Rafraîchir la liste après réponse
        await fetchDebates();
        return { success: true };
      } catch (error: any) {
        return { success: false, error: error.message };
      } finally {
        setIsRespondingStop(false);
      }
    },
    [fetchDebates]
  );

  /**
   * Calcule le temps restant pour un débat
   */
  const getTimeRemaining = useCallback((debate: Debate): number | null => {
    // ✅ Pour les débats en attente d'adversaire (waiting), utiliser expiresAt
    if (debate.status === 'waiting' && debate.expiresAt) {
      const expiresAt = new Date(debate.expiresAt).getTime();
      const now = Date.now();
      const remaining = expiresAt - now;
      return remaining > 0 ? remaining : 0;
    }

    // Pour les débats actifs, utiliser turnStartedAt
    if (!debate.turnStartedAt || !debate.turnTimeout) {
      return null;
    }

    const turnStart = new Date(debate.turnStartedAt).getTime();
    const timeoutMs = debate.turnTimeout * 60 * 60 * 1000; // Heures en ms
    const deadline = turnStart + timeoutMs;
    const now = Date.now();
    const remaining = deadline - now;

    return remaining > 0 ? remaining : 0;
  }, []);

  /**
   * Formate le temps restant en chaîne lisible
   */
  const formatTimeRemaining = useCallback((remainingMs: number): string => {
    if (remainingMs === 0) return 'Expiré';

    const hours = Math.floor(remainingMs / (60 * 60 * 1000));
    const minutes = Math.floor((remainingMs % (60 * 60 * 1000)) / (60 * 1000));

    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    return `${minutes}m`;
  }, []);

  // Charger les débats au montage du composant
  useEffect(() => {
    fetchDebates();
  }, [fetchDebates]);

  return {
    debates,
    isLoading,
    error,
    refetch: fetchDebates,
    proposeStop,
    respondStop,
    getTimeRemaining,
    formatTimeRemaining,
    isProposingStop,
    isRespondingStop,
  };
};
