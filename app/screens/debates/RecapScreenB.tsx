import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  Animated,
  Dimensions,
  Modal,
  TextInput,
  ScrollView,
  Easing as RNEasing,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../../constants/fonts';
import type { RootStackScreenProps } from '../../types/navigation';
import { useAuth } from '../../hooks/useAuth';
import { usePreventRemove } from '@react-navigation/native';
import { ScoringService, DebateResult, DebateScoringResult } from '../../services/scoring.service';
import { useTranslation } from 'react-i18next';
import axios from 'axios';
import { API_URL } from '../../constants/api';
// ✅ REDESIGN : Import des composants redesignés
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { IconButton } from '../../components/IconButton';
// ✅ FEEDBACK : Import du modal et du hook
import { FeedbackModal } from '../../components/FeedbackModal';
import { useFeedbackPrompt } from '../../hooks/useFeedbackPrompt';
// ✅ RATING : Import du modal et du hook
import { RatingPromptModal } from '../../components/RatingPromptModal';
import { useAppRating } from '../../hooks/useAppRating';
// ✅ NOTIFICATIONS : Import du modal et du hook
import { NotificationPermissionModal } from '../../components/NotificationPermissionModal';
import { useNotifications } from '../../contexts/NotificationContext';
import { usePostHog, PostHogEvents } from '../../hooks/usePostHog';
// ✅ SHARE : Import pour le partage
import ViewShot from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { ShareableRecapCard } from '../../components/ShareableRecapCard';
import { useHaptics } from '../../hooks/useHaptics';
import { CoachingModal, CoachingData } from '../../components/CoachingModal';

type Props = RootStackScreenProps<'RecapB'>;

const { width, height } = Dimensions.get('window');

// Types pour les données de récap
type RecapData = {
  debate: {
    title: string;
    isPrivate?: boolean; // ✅ Flag pour débats privés (mode ami)
    hostView?: string; // ✅ NOUVEAU : Opinion de l'hôte
    guestView?: string; // ✅ NOUVEAU : Opinion de l'invité
    forfeitedBy?: 'host' | 'guest' | null;
    topic?: {
      id: string;
      label: string;
      parentId?: string;
    } | null; // ✅ NOUVEAU : Topic pour affichage XP
  };
  players: {
    host: {
      username: string;
      eloChange: number;
      xpGain?: number; // ✅ NOUVEAU : XP gagnés par l'hôte
      topicXpGain?: number | null; // ✅ NOUVEAU : XP gagnés pour le thème spécifique
    };
    guest: {
      username: string;
      eloChange: number;
      xpGain?: number; // ✅ NOUVEAU : XP gagnés par l'invité
      topicXpGain?: number | null; // ✅ NOUVEAU : XP gagnés pour le thème spécifique
    };
  };
  result: {
    winner: 'host' | 'guest' | 'tie';
    hostScore: number;
    guestScore: number;
  };
};

// Données de test par défaut
const MOCK_RECAP_DATA: RecapData = {
  debate: {
    title: 'Faut-il interdire les voitures en centre-ville ?',
    hostView: 'Oui, pour protéger l\'environnement',
    guestView: 'Non, c\'est une question de liberté',
  },
  players: {
    host: {
      username: 'EcoWarrior',
      eloChange: 15,
    },
    guest: {
      username: 'CarLover',
      eloChange: -15,
    },
  },
  result: {
    winner: 'host',
    hostScore: 78,
    guestScore: 65,
  },
};

// ✅ CORRIGÉ : Variable globale pour mémoriser les débats dont les animations ont été vues
// On utilise le debateId comme clé pour permettre les animations sur de nouveaux débats
let viewedDebateAnimations: { [debateId: string]: { recapA: boolean; recapB: boolean } } = {};

// ✅ Fonction utilitaire pour réinitialiser (pour les tests)
export const resetAnimationStates = () => {
  viewedDebateAnimations = {};
};

// ✅ Helper pour vérifier si l'animation d'un débat a été vue
const hasSeenAnimation = (debateId: string | undefined, screen: 'recapA' | 'recapB'): boolean => {
  if (!debateId) return false;
  return viewedDebateAnimations[debateId]?.[screen] === true;
};

// ✅ Helper pour marquer l'animation d'un débat comme vue
const markAnimationSeen = (debateId: string | undefined, screen: 'recapA' | 'recapB'): void => {
  if (!debateId) return;
  if (!viewedDebateAnimations[debateId]) {
    viewedDebateAnimations[debateId] = { recapA: false, recapB: false };
  }
  viewedDebateAnimations[debateId][screen] = true;
};

export const RecapScreenB: React.FC<Props> = ({ navigation, route }) => {
  const { user, refreshUser } = useAuth(); // ✅ Hook d'authentification
  const { t } = useTranslation();
  const { trigger, loopFor } = useHaptics();
  const posthog = usePostHog(); // ✅ PostHog pour les surveys
  const [recapData, setRecapData] = useState<RecapData>(
    route.params?.recapData || MOCK_RECAP_DATA
  );
  const [showCommentModal, setShowCommentModal] = useState(false);
  const [comment, setComment] = useState('');
  const [submittingComment, setSubmittingComment] = useState(false);

  // ✅ FEEDBACK : Hook et état pour le feedback
  const { shouldShowFeedback, markFeedbackAsked, markFeedbackSubmitted } = useFeedbackPrompt();
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const feedbackShownRef = useRef(false); // Pour éviter d'afficher plusieurs fois

  // ✅ NOTIFICATIONS : Hook et état pour les notifications
  const { requestNotificationPermission, notificationsEnabled } = useNotifications();
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const notificationModalShownRef = useRef(false); // Pour éviter d'afficher plusieurs fois

  // ✅ RATING : Hook et état pour la notation App Store / Google Play
  const { shouldShowRating, markRatingAsked, markRatingSubmitted } = useAppRating();
  const [showRatingModal, setShowRatingModal] = useState(false);
  const ratingShownRef = useRef(false);
  
  // ✅ NOUVEAU : États pour le scoring réel
  const [scoringResult, setScoringResult] = useState<DebateScoringResult | null>(null);
  const [scoringCalculated, setScoringCalculated] = useState(false);
  const [scoringError, setScoringError] = useState<string | null>(null);

  // ✅ SHARE : Ref et état pour le partage
  const shareCardRef = useRef<View>(null);
  const [isSharing, setIsSharing] = useState(false);

  // ✅ FEEDBACK DÉBAT : État pour savoir si le feedback a déjà été donné pour ce débat
  const [debateFeedbackGiven, setDebateFeedbackGiven] = useState(false);

  // ✅ Rafraîchir les données utilisateur pour avoir totalDuelDebates à jour
  useEffect(() => {
    refreshUser();
  }, []);

  // ✅ FEEDBACK DÉBAT : Vérifier si le feedback a déjà été donné pour ce débat
  useEffect(() => {
    const checkDebateFeedback = async () => {
      const debateId = route.params?.debateId;
      if (!debateId) return;

      try {
        const feedbackGivenDebates = await AsyncStorage.getItem('@debate_feedback_given');
        if (feedbackGivenDebates) {
          const debates = JSON.parse(feedbackGivenDebates) as string[];
          setDebateFeedbackGiven(debates.includes(debateId));
        }
      } catch (error) {
        console.error('Error checking debate feedback:', error);
      }
    };

    checkDebateFeedback();
  }, [route.params?.debateId]);

  // ✅ NOUVEAU : Animation pour le message de victoire
  const messageOpacity = useRef(new Animated.Value(0)).current;
  const messageScale = useRef(new Animated.Value(0.8)).current;

  // Animation refs
  const hostBarHeight = useRef(new Animated.Value(0)).current;
  const guestBarHeight = useRef(new Animated.Value(0)).current;
  const [hostDisplayScore, setHostDisplayScore] = useState(0);
  const [guestDisplayScore, setGuestDisplayScore] = useState(0);
  const scoreIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ✅ NOUVEAU : État pour gérer les animations
  const [showWinnerColors, setShowWinnerColors] = useState(false);
  const [showMessage, setShowMessage] = useState(false);

  // ✅ NOUVEAU : État pour contrôler la navigation
  const [allowNavigation, setAllowNavigation] = useState(false);

  // ✅ COACHING : États pour le coaching post-debate
  const [coachingData, setCoachingData] = useState<CoachingData | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [showCoachingModal, setShowCoachingModal] = useState(false);
  const coachingPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachingBreathScale = useSharedValue(1);

  const coachingBreathStyle = useAnimatedStyle(() => ({
    transform: [{ scale: coachingBreathScale.value }],
  }));
  const coachingPress = useSharedValue(0);
  const coachingPressStyle = useAnimatedStyle(() => {
    const translateY = coachingPress.value * 4;
    const scale = 1 - coachingPress.value * 0.04;
    const shadowHeight = 4 - coachingPress.value * 3;
    return {
      transform: [{ translateY }, { scale }],
      shadowOffset: { width: 0, height: Math.max(1, shadowHeight) },
    };
  });

  // ✅ CARROUSEL XP/THÈME : État et animation pour le carrousel vertical
  const [xpCarouselIndex, setXpCarouselIndex] = useState(0); // 0 = XP, 1 = Thème
  const xpCarouselTranslateY = useRef(new Animated.Value(0)).current;

  // ✅ CORRIGÉ : Bloquer la navigation seulement quand on vient d'un débat, PAS de l'historique
  const fromHistory = route.params?.fromProfile === true;
  usePreventRemove(!fromHistory, ({ data }) => {
    // Ne rien faire - on bloque simplement le retour par geste vers l'écran de débat
    // Si on vient de l'historique, on ne bloque pas la navigation
  });

  // ✅ CORRIGÉ : Calcule et applique le scoring réel
  const calculateRealScoring = async () => {
    // ✅ CORRECTION : Permettre le calcul même si déjà fait, seulement vérifier le token/debateId
    if (!user?.token || !route.params?.debateId) {
      return;
    }

    // ✅ NOUVEAU : Si déjà calculé, ne pas refaire l'API mais permettre l'exécution
    if (scoringCalculated) {
      return;
    }

    // ✅ PRIORITÉ : Si on a déjà des données valides de RecapA, les utiliser directement
    if (route.params?.recapData && route.params.recapData.players) {
      const data = route.params.recapData;
      setRecapData(data);

      // Extraire les données de scoring depuis les données transmises
      const players = data.players;
      const host = players?.host;
      const guest = players?.guest;

      if (host && guest) {
        const scoringData = {
          hostEloChange: host.eloChange || 0,
          guestEloChange: guest.eloChange || 0,
          hostXPGain: host.xpGain || 0,
          guestXPGain: guest.xpGain || 0,
          hostNewElo: host.currentElo || host.elo || 0,
          guestNewElo: guest.currentElo || guest.elo || 0,
        };

        setScoringResult(scoringData);
        setScoringCalculated(true);
        return;
      }
    }

    try {
      setScoringError(null);

      // ✅ CORRECTION : Utiliser /recap comme RecapA pour éviter les erreurs de double scoring
      const response = await axios.get(`${API_URL}/debates/${route.params.debateId}/recap`, {
        headers: {
          'Authorization': `Bearer ${user.token}`,
        }
      });

      if (response.data) {
        const data = response.data;

        // ✅ IMPORTANT : Sauvegarder aussi les données complètes de récap comme RecapA
        setRecapData(data);
        
        // ✅ NOUVELLE LOGIQUE : Extraction améliorée des données de scoring
        const players = data.players;
        const host = players?.host;
        const guest = players?.guest;
        
        if (host && guest) {
          const scoringData = {
            hostEloChange: host.eloChange || 0,
            guestEloChange: guest.eloChange || 0,
            hostXPGain: host.xpGain || 0,
            guestXPGain: guest.xpGain || 0,
            hostNewElo: host.currentElo || host.elo || 0,
            guestNewElo: guest.currentElo || guest.elo || 0,
          };
          
          // ✅ VALIDATION : Vérifier la cohérence des données
          const isValidScoring = (
            typeof scoringData.hostEloChange === 'number' &&
            typeof scoringData.guestEloChange === 'number' &&
            typeof scoringData.hostXPGain === 'number' &&
            typeof scoringData.guestXPGain === 'number'
          );
          
          if (isValidScoring) {
            setScoringResult(scoringData);
            setScoringCalculated(true);
          } else {
            throw new Error('Données de scoring invalides ou incomplètes');
          }
        } else {
          throw new Error('Données de joueurs manquantes dans la réponse /recap');
        }
      } else {
        throw new Error('Données de récap manquantes dans la réponse');
      }

    } catch (error) {
      setScoringError(error instanceof Error ? error.message : 'Erreur inconnue');

      // ✅ AMÉLIORATION : Fallback plus robuste avec données de recapData existantes
      if (recapData?.players) {
        const fallbackScoring = {
          hostEloChange: recapData.players.host?.eloChange || 0,
          guestEloChange: recapData.players.guest?.eloChange || 0,
          hostXPGain: recapData.players.host?.xpGain || 0,
          guestXPGain: recapData.players.guest?.xpGain || 0,
          hostNewElo: 0,
          guestNewElo: 0,
        };
        setScoringResult(fallbackScoring);
      }
      
      setScoringCalculated(true);
    }
  };

  useEffect(() => {
    // ✅ CORRIGÉ : Calculer le scoring d'abord, puis gérer les animations
    const initializeRecap = async () => {
      // 1. ✅ CORRECTION : Toujours calculer le scoring pour chaque utilisateur
      await calculateRealScoring();

      // 2. ✅ CORRIGÉ : Gérer les animations selon le paramètre firstVisit, fromProfile et debateId
      const firstVisit = route.params?.firstVisit !== false; // Par défaut true
      const fromHistory = route.params?.fromProfile === true; // Vient de l'historique
      const debateId = route.params?.debateId;
      const alreadySeenThisDebate = hasSeenAnimation(debateId, 'recapB');

      // ✅ Helper pour afficher les valeurs finales sans animation
      const showFinalValuesDirectly = () => {
        const hostScore = recapData?.result?.hostScore || 0;
        const guestScore = recapData?.result?.guestScore || 0;
        const maxHeight = 200;
        const maxScore = Math.max(hostScore, guestScore);
        const hostHeight = maxScore > 0 ? (hostScore / maxScore) * maxHeight : 0;
        const guestHeight = maxScore > 0 ? (guestScore / maxScore) * maxHeight : 0;

        // Définir les valeurs finales directement
        hostBarHeight.setValue(hostHeight);
        guestBarHeight.setValue(guestHeight);
        setHostDisplayScore(hostScore);
        setGuestDisplayScore(guestScore);

        // Afficher message et couleurs immédiatement
        setShowWinnerColors(true);
        setShowMessage(true);
        messageOpacity.setValue(1);
        messageScale.setValue(1);
      };

      // ✅ PRIORITÉ : Si on vient de l'historique, afficher directement sans animation
      if (fromHistory) {
        showFinalValuesDirectly();
        return;
      }

      // ✅ CORRIGÉ : Vérifier si c'est la première visite pour CE débat spécifique
      if (firstVisit && !alreadySeenThisDebate) {
        // Première fois pour CE débat : démarrer les animations après un délai
        setTimeout(() => {
          startAnimations();
          markAnimationSeen(debateId, 'recapB');
        }, 500);
      } else {
        // Déjà vu CE débat ou retour : afficher les valeurs finales directement
        showFinalValuesDirectly();
      }
    };

    initializeRecap();
  }, []);

  // Cleanup score interval on unmount
  useEffect(() => {
    return () => {
      if (scoreIntervalRef.current) clearInterval(scoreIntervalRef.current);
    };
  }, []);

  // ✅ NOTIFICATIONS : Afficher le modal de notifications après l'animation (si pas encore demandé)
  useEffect(() => {
    // Ne pas afficher si:
    // - On vient de l'historique (fromProfile)
    // - Déjà affiché dans cette session
    // - C'est un débat local
    // - Les notifications sont déjà activées
    const fromHistory = route.params?.fromProfile === true;
    const isLocalDebate = route.params?.isLocalDebate === true;

    if (fromHistory || isLocalDebate || notificationModalShownRef.current || notificationsEnabled) {
      return;
    }

    // Vérifier si on a déjà demandé la permission
    const checkNotificationPermission = async () => {
      try {
        const alreadyAsked = await AsyncStorage.getItem('notifications_permission_asked');
        if (alreadyAsked) {
          return; // Déjà demandé, ne pas réafficher
        }

        // Afficher le modal 2 secondes après que le message de victoire soit affiché
        if (showMessage && !notificationModalShownRef.current) {
          const timer = setTimeout(() => {
            if (!notificationModalShownRef.current) {
              notificationModalShownRef.current = true;
              setShowNotificationModal(true);
            }
          }, 2000);

          return () => clearTimeout(timer);
        }
      } catch (error) {
        console.warn('Erreur vérification permission notifications:', error);
      }
    };

    checkNotificationPermission();
  }, [showMessage, notificationsEnabled, route.params?.fromProfile, route.params?.isLocalDebate]);

  // ✅ FEEDBACK : Afficher le modal de feedback après l'animation (si éligible)
  useEffect(() => {
    // Ne pas afficher si:
    // - On vient de l'historique (fromProfile)
    // - Déjà affiché dans cette session
    // - Pas éligible au feedback
    // - C'est un débat local
    // - Le modal de notifications est affiché
    const fromHistory = route.params?.fromProfile === true;
    const isLocalDebate = route.params?.isLocalDebate === true;

    if (fromHistory || isLocalDebate || feedbackShownRef.current || !shouldShowFeedback || showNotificationModal) {
      return;
    }

    // Afficher le feedback 3 secondes après que le message de victoire soit affiché
    if (showMessage) {
      const timer = setTimeout(() => {
        if (!feedbackShownRef.current && shouldShowFeedback && !showNotificationModal) {
          feedbackShownRef.current = true;
          setShowFeedbackModal(true);
        }
      }, 3000);

      return () => clearTimeout(timer);
    }
  }, [showMessage, shouldShowFeedback, showNotificationModal, route.params?.fromProfile, route.params?.isLocalDebate]);

  // ✅ RATING : Afficher le modal de notation après victoire (si éligible)
  useEffect(() => {
    const fromHistory = route.params?.fromProfile === true;
    const isLocalDebate = route.params?.isLocalDebate === true;

    if (fromHistory || isLocalDebate || ratingShownRef.current || !shouldShowRating || showNotificationModal || showFeedbackModal) {
      return;
    }

    if (showMessage) {
      const timer = setTimeout(() => {
        if (!ratingShownRef.current && shouldShowRating && !showNotificationModal && !showFeedbackModal) {
          // Vérifier la victoire ici (isUserWinner est calculé plus bas dans le render)
          const winner = recapData?.result?.winner;
          const isHost = recapData?.players?.host?.username === user?.username;
          const isWinner = (isHost && winner === 'host') || (!isHost && winner === 'guest');

          if (isWinner) {
            ratingShownRef.current = true;
            setShowRatingModal(true);
          }
        }
      }, 4000);

      return () => clearTimeout(timer);
    }
  }, [showMessage, shouldShowRating, showNotificationModal, showFeedbackModal, route.params?.fromProfile, route.params?.isLocalDebate, recapData, user?.username]);

  // ✅ CARROUSEL XP/THÈME : Animation automatique toutes les 3 secondes
  const CAROUSEL_ITEM_HEIGHT = 46; // Hauteur d'un item du carrousel
  useEffect(() => {
    // Ne pas activer le carrousel si pas de topic ou si débat local
    const hasTopic = !!recapData?.debate?.topic?.label;
    const isLocalDebate = route.params?.isLocalDebate;

    if (!hasTopic || isLocalDebate) {
      return;
    }

    const interval = setInterval(() => {
      setXpCarouselIndex((prevIndex) => {
        const newIndex = prevIndex === 0 ? 1 : 0;

        // Animation verticale vers le haut
        Animated.timing(xpCarouselTranslateY, {
          toValue: -newIndex * CAROUSEL_ITEM_HEIGHT,
          duration: 400,
          useNativeDriver: true,
        }).start();

        return newIndex;
      });
    }, 3000);

    return () => clearInterval(interval);
  }, [recapData?.debate?.topic?.label, route.params?.isLocalDebate]);

  // ✅ COACHING : Charger les données de coaching
  const isLocalDebate = route.params?.isLocalDebate === true;

  const loadCoachingData = async () => {
    if (isLocalDebate) return;
    const debateId = route.params?.debateId;
    if (!debateId || debateId.startsWith('test')) return;

    try {
      setCoachingLoading(true);
      const response = await axios.get(`${API_URL}/debates/${debateId}/coaching`);
      const data: CoachingData = response.data;
      setCoachingData(data);

      if (data.status === 'not_available' || data.status === 'insufficient_arguments' || data.status === 'error') {
        return;
      }

      if (data.status === 'pending') {
        coachingPollRef.current = setTimeout(loadCoachingData, 5000);
      } else if (data.status === 'ready') {
        startCoachingBubbleAnimation();
      }
    } catch (error) {
      console.warn('Coaching fetch failed:', error);
    } finally {
      setCoachingLoading(false);
    }
  };

  const startCoachingBubbleAnimation = () => {
    coachingBreathScale.value = 1;
    coachingBreathScale.value = withRepeat(
      withTiming(1.12, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
      -1,
      true,
    );
  };

  useEffect(() => {
    if (showMessage) {
      loadCoachingData();
    }
    return () => {
      if (coachingPollRef.current) clearTimeout(coachingPollRef.current);
    };
  }, [showMessage]);

  const startAnimations = () => {
    const hostScore = recapData?.result?.hostScore || 0;
    const guestScore = recapData?.result?.guestScore || 0;

    // Calculer les hauteurs proportionnelles (max 200px)
    const maxHeight = 200;
    const maxScore = Math.max(hostScore, guestScore);
    const hostHeight = maxScore > 0 ? (hostScore / maxScore) * maxHeight : 0;
    const guestHeight = maxScore > 0 ? (guestScore / maxScore) * maxHeight : 0;

    // ✅ HAPTIC : Démarrer les haptics continus pendant l'animation des barres (2s, tick toutes les 100ms)
    // Seulement si au moins un score est > 0 (pas de haptic pour les débats sans arguments)
    if (hostScore > 0 || guestScore > 0) {
      loopFor('score-tick', 2000, 100, 'score-complete');
    }

    // Score counting via lightweight setInterval (10fps au lieu de 60fps pour libérer le JS thread)
    const animStartTime = Date.now();
    const animDuration = 2000;
    if (scoreIntervalRef.current) clearInterval(scoreIntervalRef.current);
    scoreIntervalRef.current = setInterval(() => {
      const progress = Math.min((Date.now() - animStartTime) / animDuration, 1);
      setHostDisplayScore(Math.round(hostScore * progress));
      setGuestDisplayScore(Math.round(guestScore * progress));
      if (progress >= 1 && scoreIntervalRef.current) {
        clearInterval(scoreIntervalRef.current);
        scoreIntervalRef.current = null;
      }
    }, 100);

    // Barres qui montent (seules animations JS-thread restantes)
    Animated.parallel([
      Animated.timing(hostBarHeight, {
        toValue: hostHeight,
        duration: 2000,
        useNativeDriver: false,
      }),
      Animated.timing(guestBarHeight, {
        toValue: guestHeight,
        duration: 2000,
        useNativeDriver: false,
      }),
    ]).start(() => {
      // ✅ NOUVEAU : À la fin de l'animation, révélation dramatique
      setTimeout(() => {
        setShowWinnerColors(true);
        setShowMessage(true);

        // ✅ HAPTIC : Déclencher le feedback de victoire ou défaite
        trigger(isUserWinner ? 'victory' : 'defeat');

        // ✅ NOUVEAU : Animation jolie pour le message de victoire
        Animated.parallel([
          Animated.timing(messageOpacity, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.spring(messageScale, {
            toValue: 1,
            tension: 100,
            friction: 8,
            useNativeDriver: true,
          }),
        ]).start();
      }, 300);
    });
  };

  // ✅ SHARE : Fonction de partage avec capture d'écran
  const handleShare = async () => {
    if (isSharing) return;
    trigger('button-tap');

    try {
      setIsSharing(true);

      // Vérifier si le partage est disponible
      const isAvailable = await Sharing.isAvailableAsync();
      if (!isAvailable) {
        Alert.alert(
          t('debates.recapB.shareUnavailableTitle'),
          t('debates.recapB.shareUnavailableText'),
          [{ text: t('common.ok') }]
        );
        return;
      }

      // Capturer la carte de partage
      if (shareCardRef.current) {
        const uri = await ViewShot.captureRef(shareCardRef, {
          format: 'png',
          quality: 1,
          result: 'tmpfile',
        });

        // Partager l'image
        await Sharing.shareAsync(uri, {
          mimeType: 'image/png',
          dialogTitle: 'Who\'s Right - Debate Result',
        });
        trigger('button-success');
      }
    } catch (error) {
      console.error('❌ Erreur lors du partage:', error);
      trigger('button-error');
      Alert.alert(
        t('debates.recapB.share.error'),
        '',
        [{ text: t('common.ok') }]
      );
    } finally {
      setIsSharing(false);
    }
  };

  // ✅ NOUVEAU : Navigation intelligente selon l'origine (profil/historique ou accueil)
  const handleHomeSimple = async () => {
    trigger('button-tap');
    const fromHistory = route.params?.fromProfile || false;

    // ✅ NOUVEAU : Si on vient de l'historique, retourner à l'onglet DebatesTab
    if (fromHistory) {
      // ✅ ASYNC : Marquer le récap comme vu avant de quitter (sauf pour les débats locaux)
      if (user?.token && route.params?.debateId && !route.params?.isLocalDebate) {
        try {
          await axios.post(
            `${API_URL}/debates/${route.params.debateId}/mark-recap-viewed`,
            {},
            {
              headers: {
                'Authorization': `Bearer ${user.token}`,
              },
            }
          );
        } catch (error) {
          // Ne pas bloquer la navigation en cas d'erreur
        }
      }

      // ✅ CORRIGÉ : Naviguer vers Home (qui contient le Tab Navigator) puis vers l'onglet DebatesTab
      // @ts-ignore - navigation vers un onglet imbriqué
      navigation.navigate('Home', { screen: 'DebatesTab' });
      return;
    }

    // ✅ ASYNC : Marquer le récap comme vu avant de quitter (sauf pour les débats locaux)
    if (user?.token && route.params?.debateId && !route.params?.isLocalDebate) {
      try {
        await axios.post(
          `${API_URL}/debates/${route.params.debateId}/mark-recap-viewed`,
          {},
          {
            headers: {
              'Authorization': `Bearer ${user.token}`,
            },
          }
        );
      } catch (error) {
        // Ne pas bloquer la navigation en cas d'erreur
      }
    }

    // ✅ Vérifier les conditions pour afficher le modal premium au retour au menu
    let showPremiumOffer = false;
    if (user?.role === 'FREE' && (user?.totalDuelDebates ?? 0) >= 2) {
      try {
        const alreadyShown = await AsyncStorage.getItem('premium_modal_shown_after_debate');
        if (!alreadyShown) {
          showPremiumOffer = true;
        }
      } catch (e) {
        // Ignore
      }
    }

    try {
      navigation.navigate('Home', showPremiumOffer ? { showPremiumOffer: true } : undefined);
    } catch (error) {
      try {
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home', params: showPremiumOffer ? { showPremiumOffer: true } : undefined }],
        });
      } catch (resetError) {
        try {
          navigation.goBack();
          setTimeout(() => {
            navigation.navigate('Home', showPremiumOffer ? { showPremiumOffer: true } : undefined);
          }, 100);
        } catch (finalError) {
          // Navigation échouée
        }
      }
    }
  };

  const handleHome = () => {
    // ✅ CORRIGÉ : Permettre la navigation pour ce bouton explicite
    setAllowNavigation(true);

    // ✅ Test alternatif : Essayer navigate au lieu de reset
    setTimeout(() => {
      try {
        // Essayer d'abord avec reset (recommandé pour retour à l'accueil)
        navigation.reset({
          index: 0,
          routes: [{ name: 'Home' }],
        });
      } catch (error) {
        // Fallback avec navigate simple
        navigation.navigate('Home');
      }
    }, 100); // Petit délai pour s'assurer que l'état est mis à jour
  };



  const handleComment = () => {
    trigger('button-tap');
    setShowCommentModal(true);
  };

  // ✅ POSTHOG : Déclenche un survey de feedback via PostHog
  const handleFeedbackSurvey = async () => {
    trigger('button-tap');
    const debateId = route.params?.debateId;

    // Vérifier si le feedback a déjà été donné pour ce débat (seulement si on a un debateId)
    if (debateId && debateFeedbackGiven) {
      return;
    }

    // Capturer l'event qui déclenche le survey PostHog
    posthog.capture(PostHogEvents.DEBATE_FEEDBACK_REQUESTED, {
      source: 'recapB',
      debateId: debateId || 'unknown',
      isLocalDebate: route.params?.isLocalDebate || false,
      winner: recapData?.result?.winner,
      isUserWinner: isUserWinner,
      fromHistory: route.params?.fromProfile || false,
      userId: user?.id,
      username: user?.username,
      email: user?.email,
    });

    // Marquer ce débat comme ayant reçu un feedback (seulement si on a un debateId)
    if (debateId) {
      try {
        const feedbackGivenDebates = await AsyncStorage.getItem('@debate_feedback_given');
        const debates = feedbackGivenDebates ? JSON.parse(feedbackGivenDebates) as string[] : [];
        if (!debates.includes(debateId)) {
          debates.push(debateId);
          await AsyncStorage.setItem('@debate_feedback_given', JSON.stringify(debates));
        }
        setDebateFeedbackGiven(true);
      } catch (error) {
        console.error('Error saving debate feedback status:', error);
      }
    }
  };

  const submitComment = async () => {
    trigger('button-tap');
    if (comment.trim().length < 10) {
      trigger('button-error');
      Alert.alert('Commentaire trop court', 'Veuillez écrire au moins 10 caractères.');
      return;
    }

    try {
      setSubmittingComment(true);

      // TODO: Envoi du commentaire vers l'API
      // await fetch('/api/feedback', { method: 'POST', body: { comment, debateId } });

      trigger('button-success');
      Alert.alert(
        'Merci !',
        'Votre commentaire nous aidera à améliorer l\'application.',
        [{ text: 'OK', onPress: () => setShowCommentModal(false) }]
      );
      setComment('');
    } catch (error) {
      trigger('button-error');
      Alert.alert(t('common.error', { defaultValue: 'Error' }), t('debates.recapB.commentError', { defaultValue: 'Unable to send comment.' }));
    } finally {
      setSubmittingComment(false);
    }
  };

  // ✅ NOUVEAU : Fonctions pour obtenir les vraies données ELO avec validation
  const getRealEloChange = (isHost: boolean): number => {
    if (scoringResult) {
      // ✅ PRIORITÉ : Utiliser les données de scoring réel validées
      const eloChange = isHost ? scoringResult.hostEloChange : scoringResult.guestEloChange;
      return typeof eloChange === 'number' ? eloChange : 0;
    }
    
    // ✅ FALLBACK : Utiliser les données de recapData si disponibles
    if (recapData?.players) {
      const playerData = isHost ? recapData.players.host : recapData.players.guest;
      const eloChange = playerData?.eloChange || 0;
      return typeof eloChange === 'number' ? eloChange : 0;
    }
    
    return 0; // Aucune donnée ELO disponible
  };

  const getRealXPGain = (isHost: boolean): number => {
    if (scoringResult) {
      // ✅ PRIORITÉ : Utiliser les données de scoring réel validées
      const xpGain = isHost ? scoringResult.hostXPGain : scoringResult.guestXPGain;
      return typeof xpGain === 'number' ? xpGain : 0;
    }
    
    // ✅ FALLBACK : Utiliser les données XP de recapData si disponibles
    if (recapData?.players) {
      const playerData = isHost ? recapData.players.host : recapData.players.guest;
      const xpGain = playerData?.xpGain || 0;
      return typeof xpGain === 'number' ? xpGain : 0;
    }
    
    return 0; // Aucune donnée XP disponible
  };

  // ✅ NOUVEAU : Fonction pour obtenir le score ELO actuel
  const getRealElo = (isHost: boolean): number => {
    if (scoringResult) {
      const elo = isHost ? scoringResult.hostNewElo : scoringResult.guestNewElo;
      return typeof elo === 'number' ? elo : 0;
    }
    return 0;
  };

  // ✅ NOUVEAU : Fonction pour vérifier la fiabilité des données
  const getDataReliability = () => {
    if (scoringError) return 'error';
    // ✅ CORRIGÉ : Considérer comme fiable si on a des données ELO/XP valides
    if (scoringResult && scoringCalculated) return 'reliable';
    // ✅ AMÉLIORATION : Vérifier si recapData contient des données ELO/XP valides
    if (recapData?.players?.host?.eloChange !== undefined && 
        recapData?.players?.guest?.eloChange !== undefined &&
        (recapData?.players?.host?.xpGain !== undefined || 
         recapData?.players?.guest?.xpGain !== undefined)) {
      return 'reliable'; // Les données de l'API contiennent du scoring valide
    }
    if (recapData?.players) return 'fallback';
    return 'unknown';
  };

  // ✅ NOUVEAU : Déterminer si l'utilisateur actuel est l'hôte et le gagnant
  const isCurrentUserHost = recapData?.players?.host?.username === user?.username;
  const winner = recapData?.result?.winner || 'tie';
  const hostScore = recapData?.result?.hostScore || 0;
  const guestScore = recapData?.result?.guestScore || 0;
  
  // ✅ NOUVEAU : Analyser la situation du débat
  const getDebateSituation = () => {
    if (hostScore === 0 && guestScore === 0) return 'NO_ARGUMENTS';
    if (hostScore > 0 && guestScore === 0) return 'HOST_ONLY';
    if (hostScore === 0 && guestScore > 0) return 'GUEST_ONLY';
    return 'NORMAL';
  };
  
  const debateSituation = getDebateSituation();
  
  // ✅ NOUVEAU : Logique de victoire adaptée selon qui est l'utilisateur et la situation
  const isUserWinner = (isCurrentUserHost && winner === 'host') || (!isCurrentUserHost && winner === 'guest');
  
  const getResultMessage = () => {
    const forfeitedBy = recapData?.debate?.forfeitedBy;
    if (forfeitedBy) {
      const didCurrentUserForfeit =
        (isCurrentUserHost && forfeitedBy === 'host') ||
        (!isCurrentUserHost && forfeitedBy === 'guest');
      return didCurrentUserForfeit
        ? t('debates.recapB.result.youForfeited')
        : t('debates.recapB.result.opponentForfeited');
    }
    if (debateSituation === 'NO_ARGUMENTS') {
      return t('debates.recapB.result.silentDebate');
    }
    if (winner === 'tie') {
      return t('debates.recapB.result.perfectTie');
    }
    return isUserWinner
      ? t('debates.recapB.result.victory')
      : t('debates.recapB.result.defeat');
  };
  
  const resultMessage = getResultMessage();

  // ✅ NOUVEAU : Fonction pour retourner aux détails
  const handleBackToDetails = () => {
    trigger('button-tap');
    // ✅ CORRIGÉ : Permettre la navigation pour ce bouton explicite
    setAllowNavigation(true);

    setTimeout(() => {
      navigation.navigate('RecapA', {
        debateId: route.params?.debateId || 'test',
        fromProfile: route.params?.fromProfile || false,
        firstVisit: false, // ✅ CORRIGÉ : Indiquer que c'est un retour, pas une première visite
        isLocalDebate: route.params?.isLocalDebate || false, // ✅ CRITIQUE : Transmettre le flag mode local
        recapData: recapData || undefined // ✅ CRITIQUE : Transmettre les données déjà chargées pour éviter un rechargement API
      });
    }, 100); // Petit délai pour s'assurer que l'état est mis à jour
  };

  // ✅ NOUVEAU : Déterminer les couleurs selon le gagnant, la situation et l'état d'animation
  const getUserBarColor = () => {
    if (!showWinnerColors) return COLORS.GREY_MEDIUM; // Pendant animation : gris
    if (debateSituation === 'NO_ARGUMENTS') return COLORS.GREY_MEDIUM + '80'; // Débat silencieux : gris transparent
    return isUserWinner ? COLORS.YELLOW_CORE : COLORS.GREY_MEDIUM; // Après animation : jaune si gagne, gris si perd
  };

  const getOpponentBarColor = () => {
    if (!showWinnerColors) return COLORS.GREY_MEDIUM; // Pendant animation : gris
    if (debateSituation === 'NO_ARGUMENTS') return COLORS.GREY_MEDIUM + '80'; // Débat silencieux : gris transparent
    return !isUserWinner && winner !== 'tie' ? COLORS.YELLOW_CORE : COLORS.GREY_MEDIUM; // Après animation : jaune si adversaire gagne
  };

  const getUserEloColor = () => {
    if (!showWinnerColors) return COLORS.GREY_MEDIUM;
    if (debateSituation === 'NO_ARGUMENTS') return COLORS.GREY_MEDIUM; // Débat silencieux : pas de gain/perte
    return isUserWinner ? COLORS.YELLOW_CORE : COLORS.GREY_MEDIUM;
  };

  const getOpponentEloColor = () => {
    if (!showWinnerColors) return COLORS.GREY_MEDIUM;
    if (debateSituation === 'NO_ARGUMENTS') return COLORS.GREY_MEDIUM; // Débat silencieux : pas de gain/perte
    return !isUserWinner && winner !== 'tie' ? COLORS.YELLOW_CORE : COLORS.GREY_MEDIUM;
  };

  const getMessageColor = () => {
    if (!showWinnerColors) return COLORS.PAPER_IVORY;
    const forfeitedBy = recapData?.debate?.forfeitedBy;
    if (forfeitedBy) {
      const didCurrentUserForfeit =
        (isCurrentUserHost && forfeitedBy === 'host') ||
        (!isCurrentUserHost && forfeitedBy === 'guest');
      return didCurrentUserForfeit ? COLORS.GREY_MEDIUM : COLORS.YELLOW_CORE;
    }
    if (debateSituation === 'NO_ARGUMENTS') return COLORS.GREY_MEDIUM; // Débat silencieux : gris
    if (winner === 'tie') return COLORS.ROYAL_BLUE; // Égalité : bleu
    return isUserWinner ? COLORS.YELLOW_CORE : COLORS.GREY_MEDIUM; // Victoire : jaune, Défaite : gris
  };

  return (
    <View style={styles.container}>
      {/* ✅ REDESIGN : AnimatedBackground */}
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* ✅ MODIFIÉ : Message de victoire/défaite affiché seulement après l'animation */}
                 {showMessage && (
           <View style={styles.victoryContainer}>
             <Animated.Text
               style={[
                 styles.victoryText,
                 {
                   color: getMessageColor(),
                   opacity: messageOpacity,
                   transform: [
                     { scale: messageScale },
                   ],
                 }
               ]}>
               {resultMessage}
             </Animated.Text>
           </View>
         )}

        {/* Conteneur des barres et scores */}
        <View style={[
          styles.barsContainer,
          // ✅ NOUVEAU : Ajuster la marge du haut si pas de message
          !showMessage && { marginTop: 60 }
        ]}>
          {/* ✅ UTILISATEUR toujours à GAUCHE */}
          <View style={styles.playerContainer}>
            <View style={styles.barContainer}>
              <Animated.View 
                style={[
                  styles.scoreBar,
                  { 
                    height: isCurrentUserHost ? hostBarHeight : guestBarHeight,
                    backgroundColor: getUserBarColor() // ✅ NOUVEAU : Couleur dynamique
                  }
                ]} 
              />
              <Text style={styles.scoreNumber}>
                {isCurrentUserHost ? hostDisplayScore : guestDisplayScore}
              </Text>
            </View>
            
            {/* ✅ Nom et ELO seulement */}
            <Text style={styles.playerName}>
              {isCurrentUserHost ? (recapData?.players?.host?.username || t('debates.live.you')) : (recapData?.players?.guest?.username || t('debates.live.you'))}
            </Text>
            {/* ✅ MASQUER ELO si débat privé ou mode local */}
            {!recapData?.debate?.isPrivate && !route.params?.isLocalDebate && (
              <Text style={[
                styles.eloChange,
                { color: getUserEloColor() } // ✅ NOUVEAU : Couleur dynamique ELO
              ]}>
                {(() => {
                  const eloChange = getRealEloChange(isCurrentUserHost);
                  return `${eloChange > 0 ? '+' : ''}${eloChange} ELO`;
                })()}
              </Text>
            )}
          </View>

          {/* ✅ ADVERSAIRE toujours à DROITE */}
          <View style={styles.playerContainer}>
            <View style={styles.barContainer}>
              <Animated.View 
                style={[
                  styles.scoreBar,
                  { 
                    height: isCurrentUserHost ? guestBarHeight : hostBarHeight,
                    backgroundColor: getOpponentBarColor() // ✅ NOUVEAU : Couleur dynamique
                  }
                ]} 
              />
              <Text style={styles.scoreNumber}>
                {isCurrentUserHost ? guestDisplayScore : hostDisplayScore}
              </Text>
            </View>
            
            {/* ✅ Nom et ELO seulement */}
            <Text style={styles.playerName}>
              {isCurrentUserHost ? (recapData?.players?.guest?.username || t('debates.live.opponent')) : (recapData?.players?.host?.username || t('debates.live.opponent'))}
            </Text>
            {/* ✅ MASQUER ELO si débat privé ou mode local */}
            {!recapData?.debate?.isPrivate && !route.params?.isLocalDebate && (
              <Text style={[
                styles.eloChange,
                { color: getOpponentEloColor() } // ✅ NOUVEAU : Couleur dynamique ELO
              ]}>
                {(() => {
                  const eloChange = getRealEloChange(!isCurrentUserHost);
                  return `${eloChange > 0 ? '+' : ''}${eloChange} ELO`;
                })()}
              </Text>
            )}
          </View>
        </View>

        {/* ✅ CARROUSEL XP/THÈME : Section avec animation verticale */}
        <View style={styles.topicXpSection}>
          {/* ✅ MASQUER section uniquement si mode local (les débats privés affichent l'XP) */}
          {!route.params?.isLocalDebate && (
            <View style={styles.xpCarouselContainer}>
              <Animated.View
                style={[
                  styles.xpCarouselContent,
                  { transform: [{ translateY: xpCarouselTranslateY }] }
                ]}
              >
                {/* Slide 1 : XP des deux joueurs */}
                <View style={styles.xpCarouselSlide}>
                  <View style={styles.xpContainer}>
                    {/* XP Joueur */}
                    <View style={styles.xpPlayer}>
                      <Text style={[styles.xpAmount, { color: getUserEloColor() }]}>
                        +{getRealXPGain(isCurrentUserHost)} XP
                      </Text>
                    </View>

                    {/* XP Adversaire */}
                    <View style={styles.xpPlayer}>
                      <Text style={[styles.xpAmount, { color: getOpponentEloColor() }]}>
                        +{getRealXPGain(!isCurrentUserHost)} XP
                      </Text>
                    </View>
                  </View>
                </View>

                {/* Slide 2 : Nom du thème (seulement si topic existe) */}
                {recapData?.debate?.topic?.label && (
                  <View style={styles.xpCarouselSlide}>
                    <View style={styles.topicSlideContainer}>
                      <Text style={styles.topicSlideText} numberOfLines={2}>
                        {t(`topics.${recapData.debate.topic.label}`)}
                      </Text>
                    </View>
                  </View>
                )}
              </Animated.View>

              {/* ✅ Indicateur de fiabilité des données (toujours visible en bas) */}
              {(() => {
                const reliability = getDataReliability();

                if (reliability === 'error') {
                  return (
                    <View style={styles.reliabilityIndicator}>
                      <Text style={styles.reliabilityTextError}>
                        ⚠️ Données temporaires - Erreur de synchronisation
                      </Text>
                    </View>
                  );
                } else if (reliability === 'fallback') {
                  return (
                    <View style={styles.reliabilityIndicator}>
                      <Text style={styles.reliabilityTextFallback}>
                        🔄 Données de secours utilisées
                      </Text>
                    </View>
                  );
                }
                return null;
              })()}
            </View>
          )}
        </View>

        {/* ✅ NOUVEAU : Disclaimer - nuance sur le résultat */}
        <View style={styles.disclaimerContainer}>
          <Text style={styles.disclaimerLine1}>{t('debates.recapB.disclaimer.line1')}</Text>
          <Text style={styles.disclaimerLine2}>{t('debates.recapB.disclaimer.line2')}</Text>
        </View>

        {/* ✅ REDESIGN : Boutons d'actions avec IconButton */}
        <View style={styles.actionsContainer}>
          <View style={styles.iconRowWrapper}>
            {!(route.params?.debateId && debateFeedbackGiven) && showMessage && (
              <View style={styles.feedbackTooltip}>
                <View style={styles.feedbackTooltipBubble}>
                  <Text style={styles.feedbackTooltipText}>{t('debates.recapB.feedbackTooltip')}</Text>
                  <View style={styles.feedbackTooltipArrowBorder} />
                  <View style={styles.feedbackTooltipArrow} />
                </View>
              </View>
            )}
            <View style={styles.iconRow}>
              <IconButton
                type="action"
                icon={<Ionicons name={(route.params?.debateId && debateFeedbackGiven) ? "checkmark-circle" : "chatbubble-outline"} size={24} />}
                onPress={handleFeedbackSurvey}
                disabled={!!(route.params?.debateId && debateFeedbackGiven)}
                size={50}
                backgroundColor={COLORS.surface}
                iconColor={(route.params?.debateId && debateFeedbackGiven) ? COLORS.GREY_MEDIUM : COLORS.YELLOW_CORE}
              />

              <IconButton
                type="action"
                icon={<Ionicons name={isSharing ? "hourglass-outline" : "share-outline"} size={24} />}
                onPress={handleShare}
                disabled={isSharing}
                size={50}
                backgroundColor={COLORS.surface}
                iconColor={isSharing ? COLORS.GREY_MEDIUM : COLORS.YELLOW_CORE}
              />
            </View>
          </View>
        </View>

        {/* ✅ REDESIGN : Boutons en bas - IconButton pour retour + PrimaryButton large */}
        <View style={styles.bottomContainer}>
          <IconButton
            type="action"
            icon={<Ionicons name="arrow-back" size={24} />}
            onPress={handleBackToDetails}
            size={50}
            backgroundColor={COLORS.surface} // ✅ Fond gris foncé de base
            iconColor={COLORS.YELLOW_CORE} // ✅ Icône jaune
            iconPressedColor={COLORS.INK} // ✅ Icône devient noire au press (car fond devient jaune)
          />

          <PrimaryButton
            onPress={handleHomeSimple}
            style={styles.exitButtonLarge}
            textStyle={styles.exitButtonText}
          >
            {fromHistory ? t('debates.recapB.back') : t('debates.recapB.exit')}
          </PrimaryButton>
        </View>

        {/* ✅ NOTIFICATIONS : Modal de demande de notifications */}
        <NotificationPermissionModal
          visible={showNotificationModal}
          onClose={() => setShowNotificationModal(false)}
          onEnable={async () => {
            try {
              // Marquer comme demandé
              await AsyncStorage.setItem('notifications_permission_asked', 'true');
              // Déclencher la vraie demande de permission système
              const granted = await requestNotificationPermission();
              console.log('🔔 Permission notifications:', granted ? 'accordée' : 'refusée');
            } catch (error) {
              console.warn('Erreur activation notifications:', error);
            }
          }}
          onLater={async () => {
            // Marquer comme demandé pour ne pas redemander
            await AsyncStorage.setItem('notifications_permission_asked', 'true');
          }}
        />

        {/* ✅ FEEDBACK : Modal de feedback */}
        <FeedbackModal
          visible={showFeedbackModal}
          onClose={() => setShowFeedbackModal(false)}
          onSubmitSuccess={async () => {
            await markFeedbackSubmitted();
          }}
          onAskLater={async () => {
            await markFeedbackAsked();
          }}
        />

        {/* ✅ RATING : Modal de notation App Store / Google Play */}
        <RatingPromptModal
          visible={showRatingModal}
          onClose={() => setShowRatingModal(false)}
          onRateNow={async () => {
            await markRatingSubmitted();
          }}
          onAskLater={async () => {
            await markRatingAsked();
          }}
          onNeverAsk={async () => {
            await markRatingSubmitted();
          }}
        />

        {/* Modal de commentaire */}
        <Modal
          visible={showCommentModal}
          transparent={true}
          animationType="slide"
          onRequestClose={() => setShowCommentModal(false)}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <Text style={styles.modalTitle}>{t('debates.recapB.commentTitle')}</Text>
              
              <TextInput
                style={styles.commentInput}
                multiline
                numberOfLines={4}
                placeholder={t('debates.recapB.commentPlaceholder')}
                placeholderTextColor={COLORS.GREY_MEDIUM}
                value={comment}
                onChangeText={setComment}
                maxLength={500}
              />
              
              <Text style={styles.characterCount}>{comment.length}/500</Text>
              
              <View style={styles.modalButtons}>
                <TouchableOpacity 
                  style={styles.cancelButton}
                  onPress={() => setShowCommentModal(false)}
                >
                  <Text style={styles.cancelButtonText}>{t('debates.recapB.cancel')}</Text>
                </TouchableOpacity>
                
                <TouchableOpacity 
                  style={[styles.submitButton, submittingComment && styles.submitButtonDisabled]}
                  onPress={submitComment}
                  disabled={submittingComment}
                >
                  <Text style={styles.submitButtonText}>{submittingComment ? t('debates.recapB.sending') : t('debates.recapB.send')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>

      {/* ✅ COACHING : Bulle flottante coach */}
      {!isLocalDebate && coachingData && coachingData.status === 'ready' && showMessage && (
        <Reanimated.View
          style={[
            styles.coachingBubble,
            coachingBreathStyle,
          ]}
        >
          <TouchableOpacity
            onPress={() => {
              setTimeout(() => {
                trigger('button-tap');
                setShowCoachingModal(true);
              }, 80);
            }}
            onPressIn={() => {
              coachingPress.value = withTiming(1, { duration: 60, easing: Easing.out(Easing.quad) });
            }}
            onPressOut={() => {
              coachingPress.value = withTiming(0, { duration: 120, easing: Easing.out(Easing.cubic) });
            }}
            activeOpacity={1}
          >
            <Reanimated.View style={coachingPressStyle}>
              <View style={[styles.coachingBubbleInner, { width: 56, alignItems: 'center', justifyContent: 'center' }]}>
                <Ionicons name="school" size={26} color={COLORS.white} />
              </View>
            </Reanimated.View>
          </TouchableOpacity>
        </Reanimated.View>
      )}

      {/* ✅ COACHING : Modal coaching */}
      <CoachingModal
        visible={showCoachingModal}
        onClose={() => setShowCoachingModal(false)}
        onUpgrade={() => {
          setShowCoachingModal(false);
          navigation.navigate('Home', { screen: 'ShopTab' });
        }}
        data={coachingData}
        loading={coachingLoading}
      />

      {/* ✅ SHARE : Carte de partage hors écran */}
      <View style={styles.offscreenContainer} pointerEvents="none">
        <View ref={shareCardRef} collapsable={false}>
          <ShareableRecapCard
            debateTitle={recapData?.debate?.title || ''}
            hostUsername={recapData?.players?.host?.username || 'Host'}
            guestUsername={recapData?.players?.guest?.username || 'Guest'}
            hostScore={recapData?.result?.hostScore || 0}
            guestScore={recapData?.result?.guestScore || 0}
            hostEloChange={getRealEloChange(true)}
            guestEloChange={getRealEloChange(false)}
            hostElo={getRealElo(true)}
            guestElo={getRealElo(false)}
            hostView={recapData?.debate?.hostView}
            guestView={recapData?.debate?.guestView}
            winner={recapData?.result?.winner || 'tie'}
            isCurrentUserHost={isCurrentUserHost}
            isLocalDebate={route.params?.isLocalDebate}
            isPrivateDebate={recapData?.debate?.isPrivate}
            translations={{
              victory: t('debates.recapB.share.victory'),
              defeat: t('debates.recapB.share.defeat'),
              tie: t('debates.recapB.share.tie'),
              tryText: t('debates.recapB.share.try'),
              you: t('debates.recapB.share.you'),
            }}
          />
        </View>
      </View>
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
    padding: 20,
    zIndex: 1,
  },

  victoryContainer: {
    alignItems: 'center',
    marginBottom: 40,
    marginTop: 10,
  },

  victoryText: {
    fontSize: 42,
    fontFamily: 'Raleway-Black',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  barsContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-end',
    flex: 1,
    paddingBottom: 10,
  },
  playerContainer: {
    alignItems: 'center',
  },
  playerName: {
    color: COLORS.PAPER_IVORY,
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    marginBottom: 5,
    marginTop: 15,
  },

  eloChange: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    marginBottom: 0,
  },
  barContainer: {
    alignItems: 'center',
    height: 300,
    justifyContent: 'flex-end',
  },
  scoreBar: {
    width: 70,
    borderRadius: 35,
    marginBottom: 10,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },

  scoreNumber: {
    color: COLORS.PAPER_IVORY,
    fontSize: 28,
    fontFamily: 'Raleway-Black',
  },
  actionsContainer: {
    marginTop: 12,
  },

  iconRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
    gap: 50,
  },
  iconRowWrapper: {
    position: 'relative',
  },
  feedbackTooltip: {
    position: 'absolute',
    top: 0,
    left: -4,
    zIndex: 50,
  },
  feedbackTooltipBubble: {
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: COLORS.YELLOW_CORE + '40',
    paddingVertical: 4,
    paddingHorizontal: 10,
    justifyContent: 'center',
  },
  feedbackTooltipText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 10,
    fontFamily: 'Raleway-SemiBold',
    lineHeight: 14,
    textAlign: 'center',
  },
  feedbackTooltipArrowBorder: {
    position: 'absolute',
    right: -8,
    top: '50%',
    marginTop: -6,
    width: 0,
    height: 0,
    borderTopWidth: 6,
    borderBottomWidth: 6,
    borderLeftWidth: 7,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: COLORS.YELLOW_CORE + '40',
  },
  feedbackTooltipArrow: {
    position: 'absolute',
    right: -6,
    top: '50%',
    marginTop: -5,
    width: 0,
    height: 0,
    borderTopWidth: 5,
    borderBottomWidth: 5,
    borderLeftWidth: 6,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: COLORS.surface,
  },

  bottomContainer: {
    marginTop: 20,
    marginBottom: 20,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 0,
  },

  exitButtonLarge: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 12,
    minHeight: 50, // ✅ Hauteur minimale pour match IconButton
  },

  exitButtonText: {
    fontSize: 16, // ✅ Texte plus petit pour éviter le wrapping
    fontWeight: '800',
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.NIGHT_BLUE,
    borderRadius: 20,
    padding: 25,
    width: '90%',
    maxWidth: 400,
    borderWidth: 2,
    borderColor: COLORS.YELLOW_CORE,
  },
  modalTitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.TITLE.SMALL,
    fontFamily: getFontFamily(FONTS.TITLE.REGULAR, FONTS.TITLE.FALLBACK),
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  commentInput: {
    backgroundColor: COLORS.GREY_MEDIUM + '20',
    borderRadius: 12,
    padding: 15,
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    textAlignVertical: 'top',
    minHeight: 100,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: COLORS.GREY_MEDIUM + '40',
  },
  characterCount: {
    color: COLORS.GREY_MEDIUM,
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    textAlign: 'right',
    marginBottom: 20,
  },
  modalButtons: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    marginRight: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.GREY_MEDIUM,
  },
  submitButton: {
    flex: 1,
    paddingVertical: 15,
    alignItems: 'center',
    marginLeft: 10,
    borderRadius: 12,
    backgroundColor: COLORS.YELLOW_CORE,
  },
  submitButtonDisabled: {
    backgroundColor: COLORS.GREY_MEDIUM + '40',
  },
  cancelButtonText: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
  },
  submitButtonText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },
  
  // ✅ REDESIGN : Section sujet et XP
  topicXpSection: {
    marginTop: 12,
    marginBottom: 8,
    paddingHorizontal: 10,
  },

  // ✅ CARROUSEL XP/THÈME : Conteneur avec overflow hidden
  xpCarouselContainer: {
    height: 46, // Hauteur fixe = CAROUSEL_ITEM_HEIGHT
    overflow: 'hidden',
    borderRadius: 12,
  },

  xpCarouselContent: {
    // Contient les slides empilés verticalement
  },

  xpCarouselSlide: {
    height: 46, // Hauteur fixe = CAROUSEL_ITEM_HEIGHT
    justifyContent: 'center',
  },

  topicSlideContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  topicSlideText: {
    fontSize: 15,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
  },

  topicContainer: {
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  topicTitle: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
  },

  xpContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },

  xpPlayer: {
    flex: 1,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  xpAmount: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
  },
  
  // ✅ REDESIGN : Styles pour l'indicateur de fiabilité des données
  reliabilityIndicator: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },

  reliabilityTextError: {
    fontSize: 11,
    fontFamily: 'Raleway-Bold',
    color: COLORS.RED_ERROR,
    textAlign: 'center',
  },

  reliabilityTextFallback: {
    fontSize: 11,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
  },

  // ✅ NOUVEAU : Styles pour le disclaimer
  disclaimerContainer: {
    alignItems: 'center',
    paddingHorizontal: 8,
    marginBottom: 6,
  },

  disclaimerLine1: {
    fontSize: 15,
    fontFamily: 'Raleway-SemiBold',
    fontStyle: 'italic',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
    marginBottom: 4,
  },

  disclaimerLine2: {
    fontSize: 15,
    fontFamily: 'Raleway-Bold',
    fontStyle: 'italic',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
  },

  // ✅ COACHING : Bulle flottante
  coachingBubble: {
    position: 'absolute',
    bottom: 118,
    right: 20,
    zIndex: 100,
  },
  coachingBubbleInner: {
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.ROYAL_BLUE,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 8,
    overflow: 'hidden',
  },

  // ✅ SHARE : Conteneur hors écran pour la carte de partage
  offscreenContainer: {
    position: 'absolute',
    left: -9999,
    top: 0,
  },
}); 