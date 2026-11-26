import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  FlatList,
  Alert,
  ActivityIndicator,
  RefreshControl,
  TextInput,
  Modal,
  Keyboard,
  TouchableWithoutFeedback,
  Platform,
  KeyboardAvoidingView
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolateColor
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { IconButton } from '../../components/IconButton';
import type { RootStackScreenProps } from '../../types/navigation';
import DebatesService, { Debate, RecommendedDebate } from '../../services/debates.service';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { useDebateLimits } from '../../hooks/useDebateLimits';
import { useAsyncDebateLimits } from '../../hooks/useAsyncDebateLimits';
import { useDebateFilters, DebateMode, DebateLanguage } from '../../hooks/useDebateFilters';
import { PremiumPaywall } from '../../components/PremiumPaywall';
import { usePremiumPrompt } from '../../hooks/usePremiumPrompt';
import { useHaptics } from '../../hooks/useHaptics';
import { ReportDebateModal } from '../../components/ReportDebateModal';
import ReportsService from '../../services/reports.service';
import { containsProfanity, containsEmoji } from '../../utils/profanityFilter';

type Props = RootStackScreenProps<'DebateSelection'>;

export const DebateSelectionScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { trigger } = useHaptics();
  const premium = usePremiumPrompt();
  const [allDebates, setAllDebates] = useState<Debate[]>([]);
  const [debates, setDebates] = useState<Debate[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [searchQuery, setSearchQuery] = useState(route.params?.searchQuery || '');

  // Sprint 3: Recommandations
  const [recommendations, setRecommendations] = useState<RecommendedDebate[]>([]);
  const [loadingRecommendations, setLoadingRecommendations] = useState(false);

  // Hook pour gérer les filtres de débats (mode + langues) avec persistance
  const {
    filters,
    isLoading: filtersLoading,
    setMode,
    toggleLanguage,
    hasActiveFilters,
    getApiParams,
  } = useDebateFilters();

  // État pour la modal de filtres
  const [showFilterModal, setShowFilterModal] = useState(false);

  // Hook pour gérer les limites de débats mensuels
  const { checkDebateLimit, getDaysUntilReset } = useDebateLimits();

  // Hook pour gérer les limites de débats asynchrones simultanés
  const {
    checkAsyncDebateLimit,
  } = useAsyncDebateLimits();

  // États pour la modal de prévisualisation
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [selectedDebate, setSelectedDebate] = useState<Debate | null>(null);
  const [guestView, setGuestView] = useState('');
  const [timeLeft, setTimeLeft] = useState(30);
  const [joiningDebate, setJoiningDebate] = useState(false);

  // États pour le système de signalement
  const [reportedDebateIds, setReportedDebateIds] = useState<string[]>([]);
  const [showReportModal, setShowReportModal] = useState(false);
  const [debateToReport, setDebateToReport] = useState<Debate | null>(null);

  // Référence pour le timer
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Référence pour éviter les appels concurrents à loadDebates
  const isLoadingDebatesRef = useRef(false);

  // Ref pour le ScrollView de la modal
  const scrollViewRef = useRef<ScrollView>(null);

  // Animation pour le timer clignotant
  const timerBlinkAnim = useSharedValue(1);

  // Animation pour les badges LIVE
  const liveIndicatorAnim = useSharedValue(0.3);

  // Configuration du token d'authentification
  useEffect(() => {
    if (user?.token) {
      console.log('🔧 Configuration du token pour DebatesService et ReportsService');
      DebatesService.setAuthToken(user.token);
      ReportsService.setAuthToken(user.token);
      loadReportedDebates();
    }
  }, [user?.token]);

  // Charger les débats signalés par l'utilisateur
  const loadReportedDebates = async () => {
    try {
      const ids = await ReportsService.getMyReportedDebates();
      setReportedDebateIds(ids);
      console.log(`📋 ${ids.length} débats déjà signalés chargés`);
    } catch (error) {
      console.error('❌ Erreur chargement débats signalés:', error);
    }
  };

  // Chargement initial des débats et recommandations
  // IMPORTANT: Attendre que les filtres soient chargés depuis AsyncStorage
  useEffect(() => {
    if (user?.token && !filtersLoading) {
      loadDebates();
      loadRecommendations();
    }
  }, [user?.token, filtersLoading]);

  // Rafraîchir quand on revient sur cet écran
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      // Ne charger que si les filtres sont prêts
      if (!filtersLoading) {
        loadDebates();
        loadRecommendations();
      }
    });

    return unsubscribe;
  }, [navigation, filtersLoading]);

  // Nettoyage du timer au démontage du composant
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
        console.log('🧹 [DebateSelection] Timer nettoyé au démontage du composant');
      }
    };
  }, []);

  // Utiliser le searchQuery initial si présent
  useEffect(() => {
    if (route.params?.searchQuery) {
      setSearchQuery(route.params.searchQuery);
    }
  }, [route.params?.searchQuery]);

  // Animation pour les badges LIVE
  useEffect(() => {
    liveIndicatorAnim.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000 }),
        withTiming(0.3, { duration: 1000 })
      ),
      -1,
      false
    );
  }, []);

  // Animation du timer clignotant pour les 10 dernières secondes
  useEffect(() => {
    if (timeLeft <= 10 && timeLeft > 0) {
      timerBlinkAnim.value = withRepeat(
        withSequence(
          withTiming(0.3, { duration: 500 }),
          withTiming(1, { duration: 500 })
        ),
        -1,
        false
      );
    } else {
      timerBlinkAnim.value = 1;
    }
  }, [timeLeft]);

  // Recharger les débats quand les filtres changent (par l'utilisateur)
  // Note: Le chargement initial est géré par l'autre useEffect
  useEffect(() => {
    // Ne pas exécuter si les filtres sont en cours de chargement (initial load)
    // ou si on n'est pas encore initialisé
    if (filtersLoading || !user?.token) {
      return;
    }
    // Cet effet ne se déclenche que quand mode ou languages changent
    // (pas quand filtersLoading change, car il n'est plus dans les deps)
    loadDebates();
  }, [filters.mode, filters.languages.join(',')]);

  // Filtrer et trier les débats
  // - Filtrage par recherche locale
  // - Tri par score de recommandation (les plus pertinents en haut)
  useEffect(() => {
    let filteredDebates = [...allDebates];

    // Filtrer par recherche (principalement dans le hostView, puis dans le titre)
    if (searchQuery.trim()) {
      const searchLower = searchQuery.toLowerCase();
      filteredDebates = filteredDebates.filter(debate => {
        const hostViewMatch = (debate.hostView || '').toLowerCase().includes(searchLower);
        const titleMatch = (debate.title || '').toLowerCase().includes(searchLower);
        return hostViewMatch || titleMatch;
      });
    }

    // Créer un map des scores de recommandation
    const recScores = new Map<string, number>();
    if (recommendations.length > 0 && !searchQuery.trim()) {
      recommendations.forEach(rec => {
        recScores.set(rec.id, rec.matchScore);
      });
    }

    // Tri: vrais utilisateurs d'abord, puis par score de reco, puis par date
    filteredDebates.sort((a, b) => {
      const aIsBot = a.host.isBot ? 1 : 0;
      const bIsBot = b.host.isBot ? 1 : 0;

      // Priorité 1: vrais utilisateurs avant bots
      if (aIsBot !== bIsBot) return aIsBot - bIsBot;

      // Priorité 2: score de recommandation (si disponible)
      const scoreA = recScores.get(a.id) ?? 0;
      const scoreB = recScores.get(b.id) ?? 0;
      if (scoreA > 0 && scoreB > 0) return scoreB - scoreA;
      if (scoreA > 0) return -1;
      if (scoreB > 0) return 1;

      // Priorité 3: date (plus récent en premier)
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });

    setDebates(filteredDebates);
  }, [searchQuery, allDebates, recommendations]);

  /**
   * Charge la liste des débats en attente avec les filtres actuels
   */
  const loadDebates = async (skipLoadingState = false) => {
    if (!user?.token) {
      console.log('⚠️ Pas de token utilisateur, chargement annulé');
      return;
    }

    // Éviter les appels concurrents
    if (isLoadingDebatesRef.current) {
      console.log('⚠️ loadDebates déjà en cours, appel ignoré');
      return;
    }

    try {
      isLoadingDebatesRef.current = true;
      if (!skipLoadingState) {
        setLoading(true);
      }
      const apiParams = getApiParams();
      console.log('📥 Chargement des débats disponibles avec filtres:', apiParams);

      const debatesData = await DebatesService.getWaitingDebates(apiParams);

      // Filtrer les débats pour exclure ceux créés par l'utilisateur actuel
      const availableDebates = debatesData.filter(debate => {
        const isOwnDebate = debate.hostId === user.id;
        if (isOwnDebate) {
          console.log(`🚫 Débat filtré (créé par vous): ${debate.title}`);
        }
        return !isOwnDebate;
      });

      console.log(`✅ ${availableDebates.length} débats disponibles chargés`);
      setAllDebates(availableDebates);
    } catch (error) {
      console.error('❌ Erreur de chargement des débats:', error);
      // Ne pas vider la liste en cas d'erreur pendant un refresh
      if (!skipLoadingState) {
        setAllDebates([]);
      }
    } finally {
      isLoadingDebatesRef.current = false;
      if (!skipLoadingState) {
        setLoading(false);
      }
    }
  };

  /**
   * Sprint 3: Charge les recommandations personnalisées
   * Utilisées pour trier les débats (les plus pertinents en haut)
   */
  const loadRecommendations = async () => {
    if (!user?.token) return;

    try {
      setLoadingRecommendations(true);
      const apiParams = getApiParams();
      const recs = await DebatesService.getRecommendations({
        languages: apiParams.languages,
        isLive: apiParams.isLive,
        limit: 15, // Récupérer 15 recommandations pour le tri
      });
      console.log('🎯 [Recommendations] Reçues:', recs.map(r => ({
        title: r.title.substring(0, 30) + '...',
        score: r.matchScore,
        reason: r.matchReason,
      })));
      setRecommendations(recs);
    } catch (error) {
      console.error('❌ Erreur chargement recommandations:', error);
      setRecommendations([]);
    } finally {
      setLoadingRecommendations(false);
    }
  };

  /**
   * Rafraîchir la liste en tirant vers le bas
   */
  const onRefresh = async () => {
    setRefreshing(true);
    // skipLoadingState=true pour éviter de vider la liste pendant le refresh
    await Promise.all([loadDebates(true), loadRecommendations()]);
    setRefreshing(false);
  };

  /**
   * Navigation vers la création de débat
   */
  const handleCreateDebate = () => {
    trigger('button-tap');
    navigation.navigate('CreateDebate');
  };

  /**
   * Ouvre la modal de signalement
   */
  const handleOpenReportModal = (debate: Debate) => {
    trigger('selection');
    setDebateToReport(debate);
    setShowReportModal(true);
  };

  /**
   * Callback quand un débat a été signalé
   */
  const handleDebateReported = () => {
    if (debateToReport) {
      setReportedDebateIds(prev => [...prev, debateToReport.id]);
    }
  };

  /**
   * Ouvre la modal de prévisualisation du débat
   */
  const handleJoinDebate = async (debate: Debate) => {
    trigger('selection');
    // Vérifier si c'est notre propre débat
    if (user && debate.hostId === user.id) {
      trigger('button-error');
      Alert.alert(
        'Information',
        'Vous ne pouvez pas rejoindre votre propre débat.',
        [{ text: 'OK' }]
      );
      return;
    }

    // Vérifier si le débat est encore disponible
    if (debate.status !== 'waiting') {
      Alert.alert(
        'Information',
        'Ce débat n\'est plus disponible.',
        [{ text: 'OK', onPress: () => loadDebates() }]
      );
      return;
    }

    console.log('🎯 Tentative de rejoindre le débat:', {
      debateId: debate.id,
      currentUserId: user?.id,
      hostId: debate.hostId,
      status: debate.status,
      title: debate.title
    });

    // Vérifier la limite de débats mensuels avant de réserver
    const limitCheck = checkDebateLimit();
    if (!limitCheck.canDebate) {
      console.log('📊 Limite mensuelle atteinte - affichage premium prompt');
      premium.promptPremium({ type: 'monthlyLimit', currentCount: limitCheck.currentCount, limit: limitCheck.limit, daysUntilReset: getDaysUntilReset() });
      return;
    }

    // Vérifier si c'est un débat fictif (IDs numériques simples)
    const isMockDebate = /^\d+$/.test(debate.id);

    try {
      // Réserver uniquement pour les débats LIVE (pas pour async)
      if (!isMockDebate && debate.isLive) {
        await DebatesService.reserveDebate(debate.id);
      }

      // Ouvrir la modal immédiatement (la vérification async se fait au join)
      setSelectedDebate(debate);
      setShowPreviewModal(true);
      setTimeLeft(30);
      setGuestView('');

      // Démarrer le timer de 30 secondes SEULEMENT pour les débats live
      if (debate.isLive) {
        timerRef.current = setInterval(() => {
          setTimeLeft(prev => {
            if (prev <= 1) {
              if (timerRef.current) {
                clearInterval(timerRef.current);
                timerRef.current = null;
              }
              console.log('⏰ [DebateSelection] Timer expiré - fermeture automatique de la modal');
              handleClosePreviewModal();
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
      } else {
        console.log('📝 [DebateSelection] Débat async - pas de timer');
      }

    } catch (error: any) {
      console.log('❌ Erreur lors de la réservation:', error);
      Alert.alert(t('debates.selection.info'), t('debates.selection.notAvailable'));
    }
  };

  /**
   * Ferme la modal de prévisualisation et libère la réservation
   */
  const handleClosePreviewModal = async () => {
    trigger('button-tap');
    console.log('🔄 [DebateSelection] Fermeture de la modal de prévisualisation...', {
      hasSelectedDebate: !!selectedDebate,
      debateId: selectedDebate?.id
    });

    if (selectedDebate) {
      const isMockDebate = /^\d+$/.test(selectedDebate.id);

      // Libérer uniquement pour les débats LIVE (pas pour async)
      if (!isMockDebate && selectedDebate.isLive) {
        try {
          console.log('🔄 [DebateSelection] Libération de la réservation...');
          await DebatesService.unreserveDebate(selectedDebate.id);
          console.log('✅ [DebateSelection] Réservation libérée avec succès');
        } catch (error) {
          console.error('❌ [DebateSelection] Erreur lors de la libération de la réservation:', error);
        }
      } else if (isMockDebate) {
        console.log('🎭 [DebateSelection] Débat fictif - pas de libération API nécessaire');
      } else {
        console.log('📝 [DebateSelection] Débat async - pas de réservation à libérer');
      }
    }

    // Nettoyer le timer
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
      console.log('🧹 [DebateSelection] Timer nettoyé');
    }

    setShowPreviewModal(false);
    setSelectedDebate(null);
    setGuestView('');
    setTimeLeft(30);
  };

  /**
   * Rejoint définitivement le débat
   */
  const handleJoinDebateConfirm = async () => {
    trigger('button-tap');
    if (!selectedDebate || !guestView.trim()) {
      trigger('button-error');
      Alert.alert(t('debates.selection.info'), t('debates.selection.enterViewpoint', { defaultValue: 'Please enter your viewpoint' }));
      return;
    }

    if (guestView.trim().length > 120) {
      trigger('button-error');
      Alert.alert(t('debates.selection.info'), t('debates.selection.viewpointTooLong', { defaultValue: 'Your viewpoint cannot exceed 120 characters' }));
      return;
    }

    // Vérifier d'abord les emojis
    if (containsEmoji(guestView)) {
      trigger('button-error');
      Alert.alert(
        t('moderation.emojiDetected'),
        t('moderation.pleaseRemoveEmoji')
      );
      return;
    }

    // Puis vérifier le contenu inapproprié
    if (containsProfanity(guestView)) {
      trigger('button-error');
      Alert.alert(
        t('moderation.profanityDetected'),
        t('moderation.pleaseRemoveInappropriate')
      );
      return;
    }

    // Vérifier la limite de débats mensuels AVANT de rejoindre
    const debateCheck = checkDebateLimit();
    if (!debateCheck.canDebate) {
      handleClosePreviewModal();
      premium.promptPremium({ type: 'monthlyLimit', currentCount: debateCheck.currentCount, limit: debateCheck.limit, daysUntilReset: getDaysUntilReset() });
      return;
    }

    // Vérifier la limite de débats asynchrones simultanés
    if (selectedDebate.isLive === false) {
      const asyncCheck = await checkAsyncDebateLimit();
      if (!asyncCheck.canCreate) {
        console.log('📊 Limite async atteinte - premium prompt affiché');
        handleClosePreviewModal();
        premium.promptPremium({ type: 'asyncLimit', currentCount: asyncCheck.currentCount, limit: asyncCheck.limit });
        return;
      }
    }

    const isMockDebate = /^\d+$/.test(selectedDebate.id);

    setJoiningDebate(true);
    try {
      if (!isMockDebate) {
        const updatedDebate = await DebatesService.joinDebate(selectedDebate.id, { guestView: guestView.trim() });

        trigger('button-success');
        setShowPreviewModal(false);
        setSelectedDebate(null);
        setGuestView('');

        const targetScreen = selectedDebate.isLive ? 'DebateScreen' : 'AsyncDebateScreen';
        console.log(`🚀 Navigation vers ${targetScreen} après join réussi`, {
          debateId: updatedDebate.id,
          status: updatedDebate.status,
          currentTurnUserId: updatedDebate.currentTurnUserId,
          isMyTurn: updatedDebate.currentTurnUserId === user?.id
        });

        navigation.navigate(targetScreen as any, {
          debate: updatedDebate
        });
      } else {
        await new Promise(resolve => setTimeout(resolve, 1000));

        setShowPreviewModal(false);
        setSelectedDebate(null);
        setGuestView('');

        Alert.alert(t('debates.selection.info'), t('debates.selection.successTest'), [
          { text: t('common.ok'), onPress: () => navigation.navigate('Home') }
        ]);
      }

    } catch (error: any) {
      trigger('button-error');
      const errorMsg = error?.response?.data?.message || error?.message || '';
      console.log('❌ Erreur lors du join:', errorMsg);

      if (errorMsg.toLowerCase().includes('limite') && errorMsg.toLowerCase().includes('débat')) {
        console.log('📊 Limite atteinte lors du join - affichage premium prompt');
        handleClosePreviewModal();
        const limitCheck = checkDebateLimit();
        premium.promptPremium({ type: 'monthlyLimit', currentCount: limitCheck.currentCount, limit: limitCheck.limit, daysUntilReset: getDaysUntilReset() });
      } else {
        const errorMessage = isMockDebate
          ? 'Erreur de simulation'
          : t('debates.selection.errorJoin');
        Alert.alert(t('debates.selection.info'), errorMessage);
      }
    } finally {
      setJoiningDebate(false);
    }
  };

  /**
   * Gère le focus sur l'input de saisie - fait défiler vers le bas
   */
  const handleInputFocus = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 300);
  };

  /**
   * Calcule le nombre de lignes en fonction du contenu
   */
  const getInputHeight = () => {
    if (!guestView) return 50;

    const estimatedLines = Math.ceil(guestView.length / 40);
    const lines = Math.max(1, Math.min(estimatedLines, 3));

    return 50 + (lines - 1) * 22;
  };

  // Liste des langues disponibles
  const AVAILABLE_LANGUAGES: { code: DebateLanguage; flag: string; labelKey: string }[] = [
    { code: 'fr', flag: '🇫🇷', labelKey: 'debates.selection.filters.french' },
    { code: 'en', flag: '🇬🇧', labelKey: 'debates.selection.filters.english' },
  ];

  /**
   * Chip de langue sélectionnée avec bouton X pour supprimer
   */
  const LanguageChip = ({
    code,
    flag,
    label,
    onRemove,
    canRemove,
  }: {
    code: DebateLanguage;
    flag: string;
    label: string;
    onRemove: () => void;
    canRemove: boolean;
  }) => {
    const pressAnimation = useSharedValue(0);

    const handlePressIn = () => {
      if (!canRemove) return;
      pressAnimation.value = withTiming(1, {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    };

    const handlePressOut = () => {
      pressAnimation.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
    };

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 2;
      const scale = 1 - pressAnimation.value * 0.02;

      return {
        transform: [{ translateY }, { scale }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 3 - pressAnimation.value * 3),
        },
      };
    });

    return (
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={canRemove ? onRemove : undefined}
        activeOpacity={canRemove ? 1 : 0.7}
        disabled={!canRemove}
      >
        <Animated.View style={[styles.languageChip, animatedStyle]}>
          <Text style={styles.languageChipFlag}>{flag}</Text>
          <Text style={styles.languageChipText}>{label}</Text>
          {canRemove && (
            <View style={styles.languageChipRemove}>
              <Ionicons name="close" size={14} color={COLORS.NIGHT_BLUE} />
            </View>
          )}
        </Animated.View>
      </TouchableOpacity>
    );
  };

  /**
   * Item de la liste déroulante pour ajouter une langue
   */
  const LanguageDropdownItem = ({
    flag,
    label,
    onAdd,
  }: {
    flag: string;
    label: string;
    onAdd: () => void;
  }) => {
    const pressAnimation = useSharedValue(0);

    const handlePressIn = () => {
      pressAnimation.value = withTiming(1, {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    };

    const handlePressOut = () => {
      pressAnimation.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
    };

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 2;
      const scale = 1 - pressAnimation.value * 0.02;

      return {
        transform: [{ translateY }, { scale }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 3 - pressAnimation.value * 3),
        },
      };
    });

    return (
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onAdd}
        activeOpacity={1}
      >
        <Animated.View style={[styles.languageDropdownItem, animatedStyle]}>
          <Text style={styles.languageDropdownFlag}>{flag}</Text>
          <Text style={styles.languageDropdownText}>{label}</Text>
          <Ionicons name="add-circle-outline" size={20} color={COLORS.YELLOW_CORE} />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  /**
   * Bouton filtre principal avec animation 3D (dans la barre de recherche)
   */
  const FilterButtonAnimated = ({
    onPress,
    isActive,
  }: {
    onPress: () => void;
    isActive: boolean;
  }) => {
    const pressAnimation = useSharedValue(0);

    const handlePressIn = () => {
      pressAnimation.value = withTiming(1, {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    };

    const handlePressOut = () => {
      pressAnimation.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
    };

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 3;
      const scale = 1 - pressAnimation.value * 0.03;

      return {
        transform: [{ translateY }, { scale }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 4 - pressAnimation.value * 4),
        },
      };
    });

    return (
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        activeOpacity={1}
      >
        <Animated.View
          style={[
            styles.filterButton,
            isActive && styles.filterButtonActive,
            animatedStyle,
          ]}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={isActive ? COLORS.NIGHT_BLUE : COLORS.PAPER_IVORY}
          />
        </Animated.View>
      </TouchableOpacity>
    );
  };

  /**
   * Bouton de filtre avec animation 3D
   */
  const AnimatedFilterButton = ({
    onPress,
    isActive,
    icon,
    label,
  }: {
    onPress: () => void;
    isActive: boolean;
    icon?: string;
    label: string;
  }) => {
    const pressAnimation = useSharedValue(0);

    const handlePressIn = () => {
      pressAnimation.value = withTiming(1, {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    };

    const handlePressOut = () => {
      pressAnimation.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
    };

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 3;
      const scale = 1 - pressAnimation.value * 0.03;

      return {
        transform: [{ translateY }, { scale }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 4 - pressAnimation.value * 4),
        },
      };
    });

    return (
      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={onPress}
        activeOpacity={1}
      >
        <Animated.View
          style={[
            styles.filterOption,
            isActive && styles.filterOptionActive,
            animatedStyle,
          ]}
        >
          {icon && <Text style={styles.filterOptionIcon}>{icon}</Text>}
          <Text
            style={[
              styles.filterOptionText,
              isActive && styles.filterOptionTextActive,
            ]}
          >
            {label}
          </Text>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  /**
   * Rendu d'un débat dans la liste avec animation 3D
   */
  const DebateCard = ({ debate }: { debate: Debate }) => {
    const pressAnimation = useSharedValue(0);
    const reportButtonAnimation = useSharedValue(0);
    const isReported = reportedDebateIds.includes(debate.id);

    const handlePressIn = () => {
      if (isReported) return;
      pressAnimation.value = withTiming(1, {
        duration: 100,
        easing: Easing.out(Easing.quad),
      });
    };

    const handlePressOut = () => {
      pressAnimation.value = withTiming(0, {
        duration: 150,
        easing: Easing.out(Easing.cubic),
      });
    };

    const handleReportPressIn = () => {
      if (isReported) return;
      reportButtonAnimation.value = withTiming(1, {
        duration: 80,
        easing: Easing.out(Easing.quad),
      });
    };

    const handleReportPressOut = () => {
      reportButtonAnimation.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
    };

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 4;
      const scale = 1 - pressAnimation.value * 0.02;

      return {
        transform: [{ translateY }, { scale }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 4 - pressAnimation.value * 2),
        },
      };
    });

    const reportButtonAnimatedStyle = useAnimatedStyle(() => {
      const translateY = reportButtonAnimation.value * 3;
      const backgroundColor = interpolateColor(
        reportButtonAnimation.value,
        [0, 1],
        [COLORS.surface, COLORS.YELLOW_CORE]
      );

      return {
        transform: [{ translateY }],
        backgroundColor,
        shadowOffset: {
          width: 0,
          height: Math.max(0, 3 - reportButtonAnimation.value * 3),
        },
      };
    });

    const liveAnimatedStyle = useAnimatedStyle(() => ({
      opacity: liveIndicatorAnim.value,
    }));

    return (
      <View style={styles.debateCardWrapper}>
        {/* Bouton de signalement en haut à droite */}
        {isReported ? (
          <View style={[styles.reportButtonWrapper, styles.reportButtonReported]}>
            <Text style={styles.reportedText}>{t('reports.reported')}</Text>
          </View>
        ) : (
          <TouchableOpacity
            style={styles.reportButtonWrapper}
            onPressIn={handleReportPressIn}
            onPressOut={handleReportPressOut}
            onPress={() => handleOpenReportModal(debate)}
            activeOpacity={1}
            hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
          >
            <Animated.View style={[styles.reportButton, reportButtonAnimatedStyle]}>
              <Ionicons name="flag-outline" size={16} color={COLORS.GREY_MEDIUM} />
            </Animated.View>
          </TouchableOpacity>
        )}

        <TouchableOpacity
          onPressIn={handlePressIn}
          onPressOut={handlePressOut}
          onPress={() => !isReported && handleJoinDebate(debate)}
          activeOpacity={isReported ? 1 : 0.9}
          disabled={isReported}
        >
          <Animated.View style={[
            styles.debateCard,
            animatedStyle,
            isReported && styles.debateCardReported,
          ]}>
            {/* Header avec username, score elo et badge LIVE */}
            <View style={styles.debateHeader}>
              <View style={styles.userInfo}>
                <Text style={[styles.hostName, isReported && styles.textReported]}>
                  @{debate.host.username}
                </Text>
                <Text style={[styles.eloScore, isReported && styles.textReported]}>
                  {debate.host.elo}
                </Text>
              </View>
              {/* Badge LIVE : s'affiche si isLive === true OU isLive === undefined (anciens débats) */}
              {debate.isLive !== false && (
                <View style={[styles.liveBadge, isReported && styles.liveBadgeReported]}>
                  <Animated.View
                    style={[styles.liveBadgeDot, liveAnimatedStyle, isReported && styles.liveDotReported]}
                  />
                  <Text style={[styles.liveBadgeText, isReported && styles.textReported]}>LIVE</Text>
                </View>
              )}
            </View>

            {/* Titre du débat */}
            <Text style={[styles.debateCardTitle, isReported && styles.textReported]} numberOfLines={2}>
              {debate.title}
            </Text>

            {/* Point de vue avec flèche */}
            <View style={styles.hostViewWithArrow}>
              <Text style={[styles.arrowIcon, isReported && styles.textReported]}>→</Text>
              <Text style={[styles.hostViewStyled, isReported && styles.textReported]} numberOfLines={3}>
                {debate.hostView}
              </Text>
            </View>
          </Animated.View>
        </TouchableOpacity>
      </View>
    );
  };

  const timerAnimatedStyle = useAnimatedStyle(() => ({
    opacity: timerBlinkAnim.value,
  }));

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <View style={styles.content}>
          {/* Ligne avec bouton retour + titre centré */}
          <View style={styles.topBar}>
            <View style={styles.backButtonWrapper}>
              <IconButton
                type="action"
                icon={<Ionicons name="arrow-back" size={30} />}
                onPress={() => navigation.navigate('Home')}
                size={50}
              />
            </View>

            <Text style={styles.sectionTitle}>{t('debates.selection.title')}</Text>

            {/* Spacer pour équilibrer le centrage */}
            <View style={styles.backButtonWrapper} />
          </View>

          {/* Barre de recherche avec bouton filtre */}
          <View style={styles.searchContainer}>
            <View style={styles.searchInputContainer}>
              <Text style={styles.searchIcon}>🔍</Text>
              <TextInput
                style={styles.searchInput}
                placeholder={`${t('debates.selection.searchPlaceholder')} (${allDebates.length})`}
                placeholderTextColor={COLORS.GREY_MEDIUM}
                value={searchQuery}
                onChangeText={setSearchQuery}
              />
            </View>
            <FilterButtonAnimated
              onPress={() => setShowFilterModal(true)}
              isActive={hasActiveFilters}
            />
          </View>

          {/* Liste des débats */}
          {loading && !refreshing ? (
            <View style={styles.loadingContainer}>
              <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
              <Text style={styles.loadingText}>{t('debates.selection.loading')}</Text>
            </View>
          ) : debates.length === 0 ? (
            <ScrollView
              contentContainerStyle={styles.emptyScrollContent}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  colors={[COLORS.YELLOW_CORE]}
                />
              }
            >
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>{t('debates.selection.empty')}</Text>
              </View>
            </ScrollView>
          ) : (
            <FlatList
              data={debates}
              renderItem={({ item }) => <DebateCard debate={item} />}
              keyExtractor={(item) => item.id}
              contentContainerStyle={styles.debatesList}
              showsVerticalScrollIndicator={false}
              refreshControl={
                <RefreshControl
                  refreshing={refreshing}
                  onRefresh={onRefresh}
                  colors={[COLORS.YELLOW_CORE]}
                />
              }
            />
          )}
        </View>
      </SafeAreaView>

      {/* Bouton créer débat fixe en bas avec fond dégradé */}
      <View style={styles.createButtonFixed}>
        <LinearGradient
          colors={[
            'rgba(11, 15, 19, 0)',    // Transparent en haut
            'rgba(11, 15, 19, 0.4)',  // 40% opacité
            'rgba(11, 15, 19, 0.8)',  // 80% opacité
            'rgba(11, 15, 19, 0.95)', // 95% opacité en bas
          ]}
          locations={[0, 0.2, 0.5, 1]}
          style={styles.createButtonBlur}
          pointerEvents="none"
        />
        <View style={styles.createButtonContent}>
          <PrimaryButton
            onPress={handleCreateDebate}
            style={styles.createButton}
            textStyle={styles.createButtonText}
          >
            {t('debates.selection.create')}
          </PrimaryButton>
        </View>
      </View>

      {/* Modal de prévisualisation du débat */}
      <Modal
        visible={showPreviewModal}
        transparent={true}
        animationType="fade"
        onRequestClose={handleClosePreviewModal}
      >
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.previewModalOverlay}>
              <ScrollView
                ref={scrollViewRef}
                contentContainerStyle={styles.previewScrollContainer}
                showsVerticalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
              >
                <TouchableWithoutFeedback onPress={() => {}}>
                  <View style={styles.previewModalContent}>
                    {selectedDebate && (
                      <>
                      {/* Titre du débat */}
                      <Text style={styles.debateTitle}>{selectedDebate.title}</Text>

                      {/* Mode avec icône */}
                      <View style={styles.modeContainer}>
                        <Text style={styles.modeIcon}>
                          {selectedDebate.isLive ? '⚡' : '💬'}
                        </Text>
                        <Text style={styles.modeText}>
                          {selectedDebate.isLive
                            ? t('debates.waiting.modeText', { minutes: selectedDebate.mode })
                            : t('debates.waiting.modeTextAsync', { messages: selectedDebate.maxMessagesPerUser || 10 })
                          }
                        </Text>
                      </View>

                      {/* Point de vue de l'adversaire */}
                      <View style={styles.hostViewContainer}>
                        <Text style={styles.hostViewLabel}>
                          <Text style={styles.hostNameHighlight}>@{selectedDebate.host.username}</Text>
                          <Text style={styles.hostEloHighlight}> ({selectedDebate.host.elo})</Text>
                          <Text> {t('debates.selection.hostThinks')}</Text>
                        </Text>
                        <Text style={styles.hostViewText}>{selectedDebate.hostView}</Text>
                      </View>

                      {/* Input pour notre point de vue */}
                      <View style={styles.guestViewContainer}>
                        <View style={styles.guestViewHeader}>
                          <Text style={styles.guestViewLabel}>{t('debates.selection.yourView')}</Text>
                          <Text style={styles.characterCount}>
                            {guestView.length}/120 {guestView.trim().length > 0 ? '✓' : ''}
                          </Text>
                        </View>
                        <TextInput
                          style={[
                            styles.guestViewInput,
                            { minHeight: getInputHeight() }
                          ]}
                          placeholder={t('debates.selection.yourViewPlaceholder', { username: selectedDebate?.host.username })}
                          placeholderTextColor={COLORS.GREY_MEDIUM}
                          value={guestView}
                          onChangeText={setGuestView}
                          multiline={true}
                          maxLength={120}
                          textAlignVertical="top"
                          onFocus={handleInputFocus}
                          onSubmitEditing={Keyboard.dismiss}
                          returnKeyType="done"
                          blurOnSubmit={true}
                        />
                      </View>

                      {/* Boutons */}
                      <View style={styles.previewButtons}>
                        <SecondaryButton
                          onPress={handleClosePreviewModal}
                          style={styles.cancelButton}
                        >
                          {t('debates.selection.cancel')}
                        </SecondaryButton>

                        <PrimaryButton
                          onPress={handleJoinDebateConfirm}
                          disabled={guestView.trim().length === 0 || joiningDebate}
                          style={[
                            styles.joinButton,
                            (guestView.trim().length === 0 || joiningDebate) && styles.joinButtonDisabled
                          ]}
                        >
                          {joiningDebate ? (
                            <ActivityIndicator size="small" color={COLORS.NIGHT_BLUE} />
                          ) : (
                            <Animated.Text
                              style={[
                                styles.joinButtonText,
                                timeLeft <= 10 && selectedDebate?.isLive ? timerAnimatedStyle : {}
                              ]}
                            >
                              {selectedDebate?.isLive
                                ? t('debates.selection.join', { seconds: timeLeft < 10 ? `0${timeLeft}` : timeLeft })
                                : t('debates.selection.joinAsync')}
                            </Animated.Text>
                          )}
                        </PrimaryButton>
                      </View>
                    </>
                  )}
                </View>
              </TouchableWithoutFeedback>
            </ScrollView>
          </View>
        </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </Modal>

      {/* Modal de filtres */}
      <Modal
        visible={showFilterModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowFilterModal(false)}
      >
        <TouchableWithoutFeedback onPress={() => setShowFilterModal(false)}>
          <View style={styles.filterModalOverlay}>
            <TouchableWithoutFeedback onPress={() => {}}>
              <View style={styles.filterModalContent}>
                {/* Titre */}
                <Text style={styles.filterModalTitle}>{t('debates.selection.filters.title')}</Text>

                {/* Section Mode */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterSectionTitle}>{t('debates.selection.filters.mode')}</Text>
                  <View style={styles.filterOptionsRow}>
                    <AnimatedFilterButton
                      onPress={() => setMode('all')}
                      isActive={filters.mode === 'all'}
                      label={t('debates.selection.filters.all')}
                    />
                    <AnimatedFilterButton
                      onPress={() => setMode('live')}
                      isActive={filters.mode === 'live'}
                      icon="⚡"
                      label="Live"
                    />
                    <AnimatedFilterButton
                      onPress={() => setMode('async')}
                      isActive={filters.mode === 'async'}
                      icon="💬"
                      label="Async"
                    />
                  </View>
                </View>

                {/* Section Langues */}
                <View style={styles.filterSection}>
                  <Text style={styles.filterSectionTitle}>{t('debates.selection.filters.languages')}</Text>

                  {/* Langues sélectionnées (chips) */}
                  {filters.languages.length > 0 && (
                    <View style={styles.selectedLanguagesRow}>
                      {filters.languages.map((langCode) => {
                        const lang = AVAILABLE_LANGUAGES.find(l => l.code === langCode);
                        if (!lang) return null;
                        return (
                          <LanguageChip
                            key={lang.code}
                            code={lang.code}
                            flag={lang.flag}
                            label={t(lang.labelKey)}
                            onRemove={() => toggleLanguage(lang.code)}
                            canRemove={filters.languages.length > 1}
                          />
                        );
                      })}
                    </View>
                  )}

                  {/* Liste déroulante des langues disponibles */}
                  {AVAILABLE_LANGUAGES.filter(l => !filters.languages.includes(l.code)).length > 0 && (
                    <View style={styles.languageDropdown}>
                      <Text style={styles.languageDropdownLabel}>{t('debates.selection.filters.addLanguage')}</Text>
                      {AVAILABLE_LANGUAGES.filter(l => !filters.languages.includes(l.code)).map((lang) => (
                        <LanguageDropdownItem
                          key={lang.code}
                          flag={lang.flag}
                          label={t(lang.labelKey)}
                          onAdd={() => toggleLanguage(lang.code)}
                        />
                      ))}
                    </View>
                  )}
                </View>

                {/* Bouton Fermer */}
                <PrimaryButton
                  onPress={() => setShowFilterModal(false)}
                  style={styles.filterCloseButton}
                >
                  {t('debates.selection.filters.apply')}
                </PrimaryButton>
              </View>
            </TouchableWithoutFeedback>
          </View>
        </TouchableWithoutFeedback>
      </Modal>

      {/* Premium paywall */}
      <PremiumPaywall
        visible={premium.showPaywall}
        onClose={premium.closePaywall}
        onPurchaseSuccess={premium.closePaywall}
        trigger={premium.paywallTrigger}
      />

      {/* Modal de signalement */}
      <ReportDebateModal
        visible={showReportModal}
        debateId={debateToReport?.id || ''}
        debateTitle={debateToReport?.title || ''}
        debateView={debateToReport?.hostView}
        onClose={() => {
          setShowReportModal(false);
          setDebateToReport(null);
        }}
        onReported={handleDebateReported}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.NIGHT_BLUE,
  },
  safeArea: {
    flex: 1,
    zIndex: 1,
  },
  content: {
    flex: 1,
  },

  // Top bar avec bouton retour + titre centré
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 20,
  },

  backButtonWrapper: {
    width: 44, // Même largeur que IconButton pour équilibrer
  },

  // Titre des débats disponibles centré
  sectionTitle: {
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    flex: 1,
  },

  // Barre de recherche
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 8,
    paddingHorizontal: 20,
  },
  searchInputContainer: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  searchIcon: {
    fontSize: 16,
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    minHeight: 20,
  },
  // Bouton filtre
  filterButton: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 3,
    borderColor: COLORS.INK,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  filterButtonActive: {
    backgroundColor: COLORS.YELLOW_CORE,
  },

  // États de chargement et vide
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 40,
  },
  loadingText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    marginTop: 12,
  },
  emptyScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
  },
  emptyContainer: {
    alignItems: 'center',
    paddingVertical: 40,
  },
  emptyText: {
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
  },

  // Wrapper pour la carte de débat (pour positionner le bouton report)
  debateCardWrapper: {
    position: 'relative',
    marginBottom: 12,
  },

  // Bouton de signalement - wrapper pour le positionnement
  reportButtonWrapper: {
    position: 'absolute',
    top: -6,
    right: 14,
    zIndex: 10,
    elevation: 10,
  },
  // Bouton de signalement - style visuel
  reportButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  reportButtonReported: {
    backgroundColor: COLORS.DANGER,
    borderColor: COLORS.DANGER,
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 3,
  },
  reportedText: {
    fontSize: 10,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
    textTransform: 'uppercase',
  },

  // Cartes de débat
  debateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    marginHorizontal: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  debateCardReported: {
    opacity: 0.5,
    backgroundColor: COLORS.surfaceDark,
  },
  textReported: {
    color: COLORS.GREY_MEDIUM,
  },
  liveBadgeReported: {
    backgroundColor: COLORS.surfaceDark,
    borderColor: COLORS.GREY_MEDIUM,
  },
  liveDotReported: {
    backgroundColor: COLORS.GREY_MEDIUM,
  },
  debateHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  hostName: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
  },
  eloScore: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
  },

  // Badge LIVE
  liveBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
    marginVertical: -4,
    marginRight: 10,
  },
  liveBadgeDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#FF4444',
  },
  liveBadgeText: {
    fontSize: 10,
    fontFamily: 'Raleway-ExtraBold',
    color: '#FF4444',
    letterSpacing: 0.5,
  },

  // Titre du débat dans la carte
  debateCardTitle: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.textPrimary,
    lineHeight: 20,
    marginBottom: 10,
  },

  // Point de vue avec flèche
  hostViewWithArrow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  arrowIcon: {
    fontSize: 16,
    color: COLORS.YELLOW_CORE,
    fontWeight: 'bold',
    lineHeight: 18,
  },
  hostViewStyled: {
    flex: 1,
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    lineHeight: 18,
    fontStyle: 'italic',
  },

  debatesList: {
    paddingTop: 12,
    paddingBottom: 120, // Espace pour le bouton fixe en bas
  },

  // Bouton créer débat fixe en bas
  createButtonFixed: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  createButtonBlur: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    height: 150,
  },
  createButtonContent: {
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 20,
  },
  createButton: {
    paddingVertical: 18,
    paddingHorizontal: 40,
    width: '100%',
  },
  createButtonText: {
    fontSize: 24,
    letterSpacing: 1,
  },

  // Modal de prévisualisation
  keyboardAvoidingView: {
    flex: 1,
  },
  previewModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
  },
  previewScrollContainer: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 12,
  },
  previewModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: COLORS.YELLOW_CORE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 8,
  },
  debateTitle: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    marginBottom: 16,
    marginTop: 8,
    lineHeight: 24,
    textAlign: 'center',
  },
  modeContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    marginBottom: 20,
    alignSelf: 'center',
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  modeIcon: {
    fontSize: 16,
  },
  modeText: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },
  hostViewContainer: {
    marginBottom: 20,
  },
  hostViewLabel: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.textSecondary,
    marginBottom: 10,
  },
  hostViewText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    lineHeight: 20,
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 12,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.YELLOW_CORE,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  guestViewContainer: {
    marginBottom: 10,
  },
  guestViewHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  guestViewLabel: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },
  guestViewInput: {
    borderWidth: 3,
    borderColor: COLORS.INK,
    backgroundColor: COLORS.PAPER_IVORY,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 16,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.INK,
    minHeight: 50,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  characterCount: {
    fontSize: 11,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
  },
  previewButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  cancelButton: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  joinButton: {
    flex: 1.4,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  joinButtonDisabled: {
    opacity: 0.5,
  },
  joinButtonText: {
    fontSize: 14,
    fontFamily: 'Raleway-Black',
    color: COLORS.NIGHT_BLUE,
  },
  hostNameHighlight: {
    color: COLORS.YELLOW_CORE,
    fontWeight: '900',
  },
  hostEloHighlight: {
    color: COLORS.YELLOW_CORE,
    fontWeight: '700',
  },

  // Modal de filtres
  filterModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  filterModalContent: {
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 340,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: COLORS.YELLOW_CORE,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 8,
  },
  filterModalTitle: {
    fontSize: 20,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 24,
  },
  filterSection: {
    marginBottom: 20,
  },
  filterSectionTitle: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.textSecondary,
    marginBottom: 12,
  },
  filterOptionsRow: {
    flexDirection: 'row',
    gap: 10,
    flexWrap: 'wrap',
  },
  filterOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  filterOptionActive: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
    borderWidth: 3,
  },
  filterOptionIcon: {
    fontSize: 14,
  },
  filterOptionText: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },
  filterOptionTextActive: {
    color: COLORS.NIGHT_BLUE,
  },
  filterCloseButton: {
    marginTop: 8,
    paddingVertical: 14,
  },

  // Langues sélectionnées (chips)
  selectedLanguagesRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 16,
  },
  languageChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.YELLOW_CORE,
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 3,
  },
  languageChipFlag: {
    fontSize: 16,
  },
  languageChipText: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    color: COLORS.NIGHT_BLUE,
  },
  languageChipRemove: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Liste déroulante des langues disponibles
  languageDropdown: {
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
    overflow: 'hidden',
  },
  languageDropdownLabel: {
    fontSize: 11,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 6,
  },
  languageDropdownItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255, 255, 255, 0.1)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 2,
  },
  languageDropdownFlag: {
    fontSize: 18,
  },
  languageDropdownText: {
    flex: 1,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
  },

});
