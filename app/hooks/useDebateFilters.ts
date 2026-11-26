import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './useAuth';

// Types pour les filtres de débats
export type DebateMode = 'all' | 'live' | 'async';
export type DebateLanguage = 'fr' | 'en';

export interface DebateFilters {
  mode: DebateMode;
  languages: DebateLanguage[];
}

interface UseDebateFiltersReturn {
  filters: DebateFilters;
  isLoading: boolean;
  setMode: (mode: DebateMode) => Promise<void>;
  toggleLanguage: (language: DebateLanguage) => Promise<void>;
  setLanguages: (languages: DebateLanguage[]) => Promise<void>;
  hasActiveFilters: boolean;
  resetFilters: () => Promise<void>;
  // Pour l'API
  getApiParams: () => { languages?: string[]; isLive?: boolean };
}

const FILTERS_STORAGE_KEY = '@debate_filters';

// Valeur par défaut : mode "all" et langue de l'utilisateur
const getDefaultFilters = (userLanguage?: string): DebateFilters => ({
  mode: 'all',
  languages: [(userLanguage as DebateLanguage) || 'fr'],
});

/**
 * Hook pour gérer les filtres de débats avec persistance AsyncStorage
 */
export const useDebateFilters = (): UseDebateFiltersReturn => {
  const { user } = useAuth();
  const [filters, setFilters] = useState<DebateFilters>(getDefaultFilters(user?.preferredLanguage));
  const [isLoading, setIsLoading] = useState(true);
  const [initialized, setInitialized] = useState(false);

  // Charger les filtres depuis AsyncStorage au montage
  useEffect(() => {
    loadFilters();
  }, []);

  // Mettre à jour la langue par défaut quand l'utilisateur change
  useEffect(() => {
    if (!initialized && user?.preferredLanguage) {
      // Si on n'a pas encore initialisé et qu'on a la langue utilisateur,
      // on vérifie si on doit utiliser les valeurs par défaut
      loadFilters();
    }
  }, [user?.preferredLanguage, initialized]);

  const loadFilters = async () => {
    try {
      const savedFilters = await AsyncStorage.getItem(FILTERS_STORAGE_KEY);

      if (savedFilters) {
        const parsed = JSON.parse(savedFilters) as DebateFilters;
        // Valider les données
        if (parsed.mode && parsed.languages && parsed.languages.length > 0) {
          setFilters(parsed);
          setInitialized(true);
        } else {
          // Données invalides, utiliser les valeurs par défaut
          const defaults = getDefaultFilters(user?.preferredLanguage);
          setFilters(defaults);
          await saveFilters(defaults);
        }
      } else {
        // Pas de filtres sauvegardés, utiliser les valeurs par défaut avec la langue utilisateur
        const defaults = getDefaultFilters(user?.preferredLanguage);
        setFilters(defaults);
        // Ne pas sauvegarder tout de suite pour permettre à l'utilisateur de changer
      }
      setInitialized(true);
    } catch (error) {
      console.error('❌ [useDebateFilters] Error loading filters:', error);
      setFilters(getDefaultFilters(user?.preferredLanguage));
    } finally {
      setIsLoading(false);
    }
  };

  const saveFilters = async (newFilters: DebateFilters) => {
    try {
      await AsyncStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(newFilters));
      console.log('✅ [useDebateFilters] Filters saved:', newFilters);
    } catch (error) {
      console.error('❌ [useDebateFilters] Error saving filters:', error);
    }
  };

  const setMode = useCallback(async (mode: DebateMode) => {
    const newFilters = { ...filters, mode };
    setFilters(newFilters);
    await saveFilters(newFilters);
  }, [filters]);

  const toggleLanguage = useCallback(async (language: DebateLanguage) => {
    const currentLanguages = filters.languages;
    let newLanguages: DebateLanguage[];

    if (currentLanguages.includes(language)) {
      // Ne pas permettre de désélectionner toutes les langues
      if (currentLanguages.length === 1) {
        console.log('⚠️ [useDebateFilters] Cannot deselect all languages');
        return;
      }
      newLanguages = currentLanguages.filter(l => l !== language);
    } else {
      newLanguages = [...currentLanguages, language];
    }

    const newFilters = { ...filters, languages: newLanguages };
    setFilters(newFilters);
    await saveFilters(newFilters);
  }, [filters]);

  const setLanguages = useCallback(async (languages: DebateLanguage[]) => {
    if (languages.length === 0) {
      console.log('⚠️ [useDebateFilters] Cannot set empty languages');
      return;
    }
    const newFilters = { ...filters, languages };
    setFilters(newFilters);
    await saveFilters(newFilters);
  }, [filters]);

  const resetFilters = useCallback(async () => {
    const defaults = getDefaultFilters(user?.preferredLanguage);
    setFilters(defaults);
    await saveFilters(defaults);
  }, [user?.preferredLanguage]);

  // Vérifie si des filtres non-par-défaut sont actifs
  const hasActiveFilters =
    filters.mode !== 'all' ||
    filters.languages.length !== 1 ||
    (user?.preferredLanguage && filters.languages[0] !== user.preferredLanguage);

  // Convertit les filtres pour l'API
  const getApiParams = useCallback(() => {
    const params: { languages?: string[]; isLive?: boolean } = {};

    // Langues
    if (filters.languages.length > 0) {
      params.languages = filters.languages;
    }

    // Mode
    if (filters.mode === 'live') {
      params.isLive = true;
    } else if (filters.mode === 'async') {
      params.isLive = false;
    }
    // Si mode === 'all', on ne passe pas isLive pour récupérer tous les débats

    return params;
  }, [filters]);

  return {
    filters,
    isLoading,
    setMode,
    toggleLanguage,
    setLanguages,
    hasActiveFilters,
    resetFilters,
    getApiParams,
  };
};
