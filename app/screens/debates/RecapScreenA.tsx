import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Dimensions,
  TouchableWithoutFeedback,
  Animated,
  Linking,
  Pressable,
  Easing as RNEasing,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  Easing,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import type { RootStackScreenProps } from '../../types/navigation';
import { useAuth } from '../../hooks/useAuth';
import { useStreakData } from '../../hooks/useStreakData';
import { API_URL } from '../../constants/api';
import axios from 'axios';
// ✅ NOUVEAU : Import pour G3RawData
import ArgumentsService, { G3RawData, G3DataResponse } from '../../services/arguments.service';
import { usePreventRemove } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
// ✅ REDESIGN : Import des composants redesignés
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { IconButton } from '../../components/IconButton';
import { Ionicons } from '@expo/vector-icons';
import { useHaptics } from '../../hooks/useHaptics';
import { PremiumPaywall } from '../../components/PremiumPaywall';
import { usePremiumPrompt } from '../../hooks/usePremiumPrompt';
import { CoachingModal, CoachingData } from '../../components/CoachingModal';

type Props = RootStackScreenProps<'RecapA'>;

const { width } = Dimensions.get('window');

// Types pour les données de récap
type RecapData = {
  debate: {
    id: string;
    title: string;
    hostView: string;
    guestView: string;
    isPrivate?: boolean; // ✅ Flag pour débats privés (mode ami)
  };
  players: {
    host: {
      username: string;
      eloChange: number;
    };
    guest: {
      username: string;
      eloChange: number;
    };
  };
  stats: {
    host: {
      bestArgument: {
        text: string;
        score: number;
        justification: string;
      } | null;
      worstArgument: {
        text: string;
        score: number;
        justification: string;
      } | null;
      totalScore: number;
    };
    guest: {
      bestArgument: {
        text: string;
        score: number;
        justification: string;
      } | null;
      worstArgument: {
        text: string;
        score: number;
        justification: string;
      } | null;
      totalScore: number;
    };
  };
  result: {
    winner: 'host' | 'guest' | 'tie';
    hostScore: number;
    guestScore: number;
  };
  allArguments: any[];
  // ✅ PREMIUM GATING : Argument view limits
  argumentViewLimit?: number | null; // 3 pour FREE, null pour Premium+
  viewedArgumentIds?: string[];
};

// ✅ NOUVEAU : Données de test pour les cas particuliers
const MOCK_RECAP_DATA_NORMAL: RecapData = {
  debate: {
    id: 'test-123',
    title: 'Faut-il interdire les voitures en centre-ville ?',
    hostView: 'Pro-interdiction',
    guestView: 'Anti-interdiction',
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
  stats: {
    host: {
      bestArgument: {
        text: 'Les voitures représentent 40% de la pollution urbaine selon l\'ADEME, causant 48000 décès prématurés par an en France.',
        score: 9,
        justification: 'Excellente argumentation avec source officielle et données chiffrées précises.',
      },
      worstArgument: {
        text: 'De toute façon, c\'est évident que les voitures polluent, tout le monde le sait.',
        score: 3,
        justification: 'Argument trop général sans preuve ni développement approfondi.',
      },
      totalScore: 78,
    },
    guest: {
      bestArgument: {
        text: 'Interdire les voitures pénaliserait les personnes à mobilité réduite qui n\'ont pas d\'alternative viable pour se déplacer.',
        score: 8,
        justification: 'Argument empathique et réaliste qui soulève un vrai problème social.',
      },
      worstArgument: {
        text: 'Moi personnellement, je pense que c\'est une mauvaise idée point final.',
        score: 2,
        justification: 'Opinion personnelle sans justification ni argumentation construite.',
      },
      totalScore: 65,
    },
  },
  allArguments: [],
  result: {
    winner: 'host' as const,
    hostScore: 78,
    guestScore: 65,
  },
};

// ✅ NOUVEAU : Cas 1 - Aucun argument des 2 côtés
const MOCK_RECAP_DATA_ZERO_ARGS: RecapData = {
  debate: {
    id: 'test-zero',
    title: 'Le débat silencieux - Personne n\'a argumenté',
    hostView: 'Position A',
    guestView: 'Position B',
  },
  players: {
    host: { username: 'SilentHost', eloChange: 0 },
    guest: { username: 'SilentGuest', eloChange: 0 },
  },
  stats: {
    host: {
      bestArgument: null,
      worstArgument: null,
      totalScore: 0,
    },
    guest: {
      bestArgument: null,
      worstArgument: null,
      totalScore: 0,
    },
  },
  allArguments: [],
  result: { winner: 'tie' as const, hostScore: 0, guestScore: 0 },
};

// ✅ NOUVEAU : Cas 2 - Seul l'hôte a argumenté
const MOCK_RECAP_DATA_HOST_ONLY: RecapData = {
  debate: {
    id: 'test-host-only',
    title: 'Débat en monologue - Seul l\'hôte a argumenté',
    hostView: 'Position argumentée',
    guestView: 'Position muette',
  },
  players: {
    host: { username: 'ActiveHost', eloChange: 25 },
    guest: { username: 'SilentGuest', eloChange: -25 },
  },
  stats: {
    host: {
      bestArgument: {
        text: 'Voici mon seul et unique argument dans ce débat.',
        score: 7,
        justification: 'Argument correct par défaut.',
      },
      worstArgument: {
        text: 'Voici mon seul et unique argument dans ce débat.',
        score: 7,
        justification: 'Même argument, c\'est le seul.',
      },
      totalScore: 7,
    },
    guest: {
      bestArgument: null,
      worstArgument: null,
      totalScore: 0,
    },
  },
  allArguments: [],
  result: { winner: 'host' as const, hostScore: 7, guestScore: 0 },
};

// ✅ NOUVEAU : Cas 3 - Seul le guest a argumenté
const MOCK_RECAP_DATA_GUEST_ONLY: RecapData = {
  debate: {
    id: 'test-guest-only',
    title: 'Débat renversé - Seul l\'invité a argumenté',
    hostView: 'Position muette',
    guestView: 'Position argumentée',
  },
  players: {
    host: { username: 'SilentHost', eloChange: -25 },
    guest: { username: 'ActiveGuest', eloChange: 25 },
  },
  stats: {
    host: {
      bestArgument: null,
      worstArgument: null,
      totalScore: 0,
    },
    guest: {
      bestArgument: {
        text: 'Je suis le seul à avoir pris la parole dans ce débat.',
        score: 8,
        justification: 'Argument par défaut, le seul du débat.',
      },
      worstArgument: {
        text: 'Je suis le seul à avoir pris la parole dans ce débat.',
        score: 8,
        justification: 'Même argument, c\'est le seul.',
      },
      totalScore: 8,
    },
  },
  allArguments: [],
  result: { winner: 'guest' as const, hostScore: 0, guestScore: 8 },
};

// ✅ NOUVEAU : Cas 4 - Égalité parfaite
const MOCK_RECAP_DATA_TIE: RecapData = {
  debate: {
    id: 'test-tie',
    title: 'Le débat équilibré - Match nul parfait',
    hostView: 'Position équilibrée A',
    guestView: 'Position équilibrée B',
  },
  players: {
    host: { username: 'BalancedHost', eloChange: 0 },
    guest: { username: 'BalancedGuest', eloChange: 0 },
  },
  stats: {
    host: {
      bestArgument: {
        text: 'Mon meilleur argument équilibré avec des preuves solides.',
        score: 8,
        justification: 'Argument bien construit et équilibré.',
      },
      worstArgument: {
        text: 'Mon argument le plus faible mais acceptable.',
        score: 5,
        justification: 'Argument correct mais sans impact majeur.',
      },
      totalScore: 50,
    },
    guest: {
      bestArgument: {
        text: 'Mon contre-argument de qualité égale avec des sources.',
        score: 8,
        justification: 'Argument équivalent en qualité.',
      },
      worstArgument: {
        text: 'Mon point le plus discutable mais défendable.',
        score: 5,
        justification: 'Argument faible mais valide.',
      },
      totalScore: 50,
    },
  },
  allArguments: [],
  result: { winner: 'tie' as const, hostScore: 50, guestScore: 50 },
};

// ✅ NOUVEAU : Mapping des cas de test
const MOCK_TEST_CASES = {
  'test': MOCK_RECAP_DATA_NORMAL,      // Cas normal (par défaut)
  'test-zero': MOCK_RECAP_DATA_ZERO_ARGS,      // 0 arguments
  'test-host-only': MOCK_RECAP_DATA_HOST_ONLY, // Seul host
  'test-guest-only': MOCK_RECAP_DATA_GUEST_ONLY, // Seul guest  
  'test-tie': MOCK_RECAP_DATA_TIE,             // Égalité
};

// Garder l'ancienne variable pour compatibilité
const MOCK_RECAP_DATA = MOCK_RECAP_DATA_NORMAL;

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

// ✅ NOUVEAU : Fonction pour ouvrir les liens sources
const openSourceLink = async (url: string, title: string, t: (key: string, options?: any) => string) => {
  try {
    const supported = await Linking.canOpenURL(url);
    if (supported) {
      await Linking.openURL(url);
    } else {
      Alert.alert(t('common.error', { defaultValue: 'Error' }), t('debates.recapA.cannotOpenLink', { title, defaultValue: `Cannot open link to ${title}` }));
    }
  } catch (error) {
    console.error('Erreur ouverture lien source:', error);
    Alert.alert(t('common.error', { defaultValue: 'Error' }), t('debates.recapA.linkOpenError', { title, defaultValue: `Error opening link to ${title}` }));
  }
};

export const RecapScreenA: React.FC<Props> = ({ navigation, route }) => {
  const { user } = useAuth(); // ✅ Hook d'authentification
  const { updateStreak } = useStreakData(); // ✅ Hook pour la série de jours
  const { t } = useTranslation();
  const { trigger } = useHaptics();
  const [recapData, setRecapData] = useState<RecapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [showAllArguments, setShowAllArguments] = useState(false);
  
  // ✅ NOUVEAU : États pour G3RawData
  const [argumentsG3Data, setArgumentsG3Data] = useState<Record<string, G3RawData | null>>({});
  const [loadingG3Data, setLoadingG3Data] = useState<Record<string, boolean>>({});
  
  // ✅ PREMIUM GATING : Arguments view limit
  const [viewedArgumentIds, setViewedArgumentIds] = useState<string[]>([]);
  const [argumentViewLimit, setArgumentViewLimit] = useState<number | null>(null);
  const premium = usePremiumPrompt();

  // ✅ COACHING : États pour le coaching post-debate
  const [coachingData, setCoachingData] = useState<CoachingData | null>(null);
  const [coachingLoading, setCoachingLoading] = useState(false);
  const [showCoachingModal, setShowCoachingModal] = useState(false);
  const coachingPollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const coachingBreathScale = useSharedValue(1);
  const coachingExpandAnim = useRef(new Animated.Value(0)).current;
  const coachingTextOpacity = useRef(new Animated.Value(0)).current;

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

  // ✅ États pour l'animation séquentielle
  const [animationComplete, setAnimationComplete] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [canNavigate, setCanNavigate] = useState(false);
  
  // ✅ NOUVEAU : Références pour l'animation et le scroll
  const scrollViewRef = useRef<ScrollView>(null);
  const titleOpacity = useRef(new Animated.Value(0)).current;
  const bestTitleOpacity = useRef(new Animated.Value(0)).current;
  const bestOpponentOpacity = useRef(new Animated.Value(0)).current;
  const bestUserOpacity = useRef(new Animated.Value(0)).current;
  const worstTitleOpacity = useRef(new Animated.Value(0)).current;
  const worstOpponentOpacity = useRef(new Animated.Value(0)).current;
  const worstUserOpacity = useRef(new Animated.Value(0)).current;
  const instructionOpacity = useRef(new Animated.Value(0)).current;
  
  // Récupérer les paramètres de navigation (debateId pour l'API)
  const debateId = route.params?.debateId || 'test';

  // ✅ NOUVEAU : Empêcher le retour vers l'écran de débat par geste
  // Mais seulement quand on vient d'un débat, PAS quand on vient de l'historique
  const fromHistory = route.params?.fromProfile === true;
  usePreventRemove(!fromHistory, ({ data }) => {
    // Ne rien faire - on bloque simplement le retour vers l'écran de débat
    // L'utilisateur doit utiliser les boutons de navigation explicites
    // Si on vient de l'historique, on ne bloque pas la navigation
  });

  useEffect(() => {
    // ✅ CORRIGÉ : Plus besoin de réinitialiser car on utilise debateId comme clé
    // Chaque débat a son propre état d'animation
    loadRecapData();
  }, []);

  // ✅ SIMPLIFIÉ : Démarrer l'animation séquentielle après le chargement
  useEffect(() => {
    if (recapData && !loading) {
      // ✅ NOUVEAU : Vérifier la situation du débat
      const situation = getDebateSituation();
      const fromHistory = route.params?.fromProfile === true;
      const alreadySeenThisDebate = hasSeenAnimation(debateId, 'recapA');

      // ✅ Helper pour afficher tout sans animation
      const showDirectly = () => {
        showAllElements();
        setAnimationComplete(true);
        setCanNavigate(true);
        setCurrentStep(7);
      };

      // ✅ NOUVEAU : Si débat silencieux (NO_ARGUMENTS), afficher tout directement sans animation
      if (situation === 'NO_ARGUMENTS') {
        showDirectly();
        return;
      }

      // ✅ CORRIGÉ : Si on vient de l'historique, afficher directement sans animation
      if (fromHistory) {
        showDirectly();
        return;
      }

      // ✅ CORRIGÉ : Vérifier si c'est la première visite pour CE débat spécifique
      if (!alreadySeenThisDebate) {
        // Première fois pour CE débat : lancer l'animation
        setTimeout(() => {
          startSequentialAnimation();
          markAnimationSeen(debateId, 'recapA');
        }, 500);
      } else {
        // Déjà vu CE débat : afficher tout directement
        showDirectly();
      }
    }
  }, [recapData, loading]);

  const loadRecapData = async () => {
    try {
      setLoading(true);

      // ✅ PRIORITÉ 1 : Si on a déjà des données transmises par RecapB, les utiliser directement
      if (route.params?.recapData) {
        setRecapData(route.params.recapData);
        setLoading(false);
        return;
      }

      // ✅ PRIORITÉ 2 : Support de tous les cas de test
      if (debateId.startsWith('test')) {
        const testData = MOCK_TEST_CASES[debateId as keyof typeof MOCK_TEST_CASES] || MOCK_RECAP_DATA_NORMAL;

        setTimeout(() => {
          setRecapData(testData);
          setLoading(false);
        }, 1000);
        return;
      }

      // ✅ PRIORITÉ 3 : Chargement depuis l'API (support mode duel local vs en ligne)
      const isLocal = route.params?.isLocalDebate === true;
      const endpoint = isLocal
        ? `${API_URL}/local-debates/${debateId}/recap`
        : `${API_URL}/debates/${debateId}/recap`;

      const response = await axios.get(endpoint);
      const data = response.data;
      setRecapData(data);

      // ✅ PREMIUM GATING : Stocker les infos de gating
      if (data.viewedArgumentIds) {
        setViewedArgumentIds(data.viewedArgumentIds);
      }
      if (data.argumentViewLimit !== undefined) {
        setArgumentViewLimit(data.argumentViewLimit);
      }

      // ✅ STREAK : Mettre à jour la série si c'est la première visite (pas depuis l'historique)
      // Le backend gère la logique "une seule fois par jour" automatiquement
      if (!route.params?.fromProfile && !isLocal) {
        updateStreak().catch(() => {
          // Erreur non bloquante
        });
      }

    } catch (error) {
      console.error('Erreur chargement récap:', error);

      // ✅ NOUVEAU : Gestion d'erreurs améliorée avec détails
      let errorMessage = t('debates.recapA.errors.loadFailed');

      if (axios.isAxiosError(error)) {
        const status = error.response?.status;
        if (status === 401) {
          errorMessage = t('debates.recapA.errors.sessionExpired');
          // Note: AuthService gère déjà la déconnexion automatique en cas d'échec de refresh
        } else if (status === 403) {
          errorMessage = t('debates.recapA.errors.noAccess');
        } else if (status === 404) {
          errorMessage = t('debates.recapA.errors.notFound');
        } else if (status && status >= 500) {
          errorMessage = t('debates.recapA.errors.serverError');
        }
      } else if (error instanceof Error && error.message?.includes('Network Error')) {
        errorMessage = t('debates.recapA.errors.networkError');
      }

      Alert.alert(t('common.error'), errorMessage, [
        { text: t('common.ok'), onPress: () => navigation.goBack() }
      ]);
    } finally {
      setLoading(false);
    }
  };

  // ✅ COACHING : Charger les données de coaching
  const isLocalDebate = route.params?.isLocalDebate === true;

  const loadCoachingData = async () => {
    if (isLocalDebate) return; // Pas de coaching pour les débats locaux
    if (!debateId || debateId.startsWith('test')) return;

    try {
      setCoachingLoading(true);
      const response = await axios.get(`${API_URL}/debates/${debateId}/coaching`);
      const data: CoachingData = response.data;
      setCoachingData(data);

      if (data.status === 'not_available' || data.status === 'insufficient_arguments' || data.status === 'error') {
        // Ancien débat sans coaching ou pas assez d'arguments : pas de bulle, pas de polling
        return;
      }

      // Si le coaching est en pending, polling toutes les 5s
      if (data.status === 'pending') {
        coachingPollRef.current = setTimeout(loadCoachingData, 5000);
      } else if (data.status === 'ready') {
        // Animer la bulle quand le coaching est prêt
        startCoachingBubbleAnimation();
      }
    } catch (error) {
      // Silencieux : le coaching est optionnel
      console.warn('Coaching fetch failed:', error);
    } finally {
      setCoachingLoading(false);
    }
  };

  const startCoachingBubbleAnimation = () => {
    // Reset values for re-visits (e.g. coming from debate history)
    coachingExpandAnim.setValue(0);
    coachingTextOpacity.setValue(0);
    coachingBreathScale.value = 1;

    // Phase 1: After 800ms, expand bubble to pill with "Get better"
    setTimeout(() => {
      Animated.parallel([
        Animated.timing(coachingExpandAnim, {
          toValue: 1,
          duration: 450,
          useNativeDriver: false,
          easing: RNEasing.out(RNEasing.cubic),
        }),
        Animated.timing(coachingTextOpacity, {
          toValue: 1,
          duration: 300,
          delay: 180,
          useNativeDriver: false,
        }),
      ]).start(() => {
        // Phase 2: After 3s, collapse back to circle
        setTimeout(() => {
          Animated.parallel([
            Animated.timing(coachingTextOpacity, {
              toValue: 0,
              duration: 200,
              useNativeDriver: false,
            }),
            Animated.timing(coachingExpandAnim, {
              toValue: 0,
              duration: 450,
              delay: 80,
              useNativeDriver: false,
              easing: RNEasing.in(RNEasing.cubic),
            }),
          ]).start(() => {
            // Phase 3: Breathing with Reanimated withRepeat (same as DebateNowButton — no stutter)
            coachingBreathScale.value = withRepeat(
              withTiming(1.12, { duration: 1200, easing: Easing.inOut(Easing.ease) }),
              -1,
              true,
            );
          });
        }, 3000);
      });
    }, 800);
  };

  // Charger le coaching après le chargement du recap
  useEffect(() => {
    if (recapData && !loading && !isLocalDebate) {
      loadCoachingData();
    }
    return () => {
      if (coachingPollRef.current) clearTimeout(coachingPollRef.current);
    };
  }, [recapData, loading]);

  // ✅ NOUVEAU : Fonctions pour l'animation séquentielle
  const showAllElements = () => {
    titleOpacity.setValue(1);
    bestTitleOpacity.setValue(1);
    bestOpponentOpacity.setValue(1);
    bestUserOpacity.setValue(1);
    worstTitleOpacity.setValue(1);
    worstOpponentOpacity.setValue(1);
    worstUserOpacity.setValue(1);
    instructionOpacity.setValue(1);
  };

  const startSequentialAnimation = () => {
    const animationDuration = 336; // ✅ 50% plus rapide que l'original (600 * 0.56)
    const stepDelay = 448; // ✅ 50% plus rapide que l'original (800 * 0.56)

    // Étape 1: Titre du débat
    Animated.timing(titleOpacity, {
      toValue: 1,
      duration: animationDuration,
      useNativeDriver: true,
    }).start(() => {
      setCurrentStep(1);
      
      // Étape 2: Titre "MEILLEURS ARGUMENTS"
      setTimeout(() => {
        Animated.timing(bestTitleOpacity, {
          toValue: 1,
          duration: animationDuration,
          useNativeDriver: true,
        }).start(() => {
          setCurrentStep(2);
          
          // Étape 3: Argument adversaire (meilleur)
          setTimeout(() => {
            Animated.timing(bestOpponentOpacity, {
              toValue: 1,
              duration: animationDuration,
              useNativeDriver: true,
            }).start(() => {
              setCurrentStep(3);
              
              // Étape 4: Notre meilleur argument
              setTimeout(() => {
                Animated.timing(bestUserOpacity, {
                  toValue: 1,
                  duration: animationDuration,
                  useNativeDriver: true,
                }).start(() => {
                  setCurrentStep(4);
                  
                  // Étape 5: Titre "PIRES ARGUMENTS"
                  setTimeout(() => {
                    Animated.timing(worstTitleOpacity, {
                      toValue: 1,
                      duration: animationDuration,
                      useNativeDriver: true,
                    }).start(() => {
                      setCurrentStep(5);
                      
                      // Étape 6: Pire argument adversaire
                      setTimeout(() => {
                        Animated.timing(worstOpponentOpacity, {
                          toValue: 1,
                          duration: animationDuration,
                          useNativeDriver: true,
                        }).start(() => {
                          setCurrentStep(6);
                          
                          // Étape 7: Notre pire argument
                          setTimeout(() => {
                            Animated.timing(worstUserOpacity, {
                              toValue: 1,
                              duration: animationDuration,
                              useNativeDriver: true,
                            }).start(() => {
                              setCurrentStep(7);
                              
                              // Étape finale: Instruction + activation du tap
                              setTimeout(() => {
                                Animated.timing(instructionOpacity, {
                                  toValue: 1,
                                  duration: animationDuration,
                                  useNativeDriver: true,
                                }).start(() => {
                                  setAnimationComplete(true);
                                  setCanNavigate(true);
                                  scrollToEnd();
                                });
                              }, stepDelay);
                            });
                          }, stepDelay);
                        });
                      }, stepDelay);
                    });
                  }, stepDelay);
                });
              }, stepDelay);
            });
          }, stepDelay);
        });
      }, stepDelay);
    });
  };

  const scrollToPosition = (y: number) => {
    // ✅ SUPPRIMÉ : Fonction plus utilisée
  };

  const scrollToEnd = () => {
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 500);
  };

  // ✅ NOUVEAU : Navigation par bouton explicite
  const handleViewScores = () => {
    trigger('button-tap');
    navigation.navigate('RecapB', {
      debateId,
      recapData: recapData || undefined,
      firstVisit: true, // ✅ CORRIGÉ : Toujours true quand on va de RecapA vers RecapB
      fromProfile: route.params?.fromProfile || false, // ✅ NOUVEAU : Transmettre le paramètre fromProfile
      isLocalDebate: route.params?.isLocalDebate || false // ✅ CRITIQUE : Transmettre le flag mode local
    });
  };

  const handleShowAllArguments = () => {
    trigger('button-tap');
    setShowAllArguments(true);
  };

  // ✅ NOUVEAU : Fonction pour récupérer G3RawData d'un argument
  const loadG3DataForArgument = async (argumentId: string) => {
    if (argumentsG3Data[argumentId] !== undefined || loadingG3Data[argumentId]) {
      return; // Déjà chargé ou en cours de chargement
    }

    setLoadingG3Data(prev => ({ ...prev, [argumentId]: true }));
    
    try {
      const response = await ArgumentsService.getArgumentG3Data(argumentId);
      
      setArgumentsG3Data(prev => ({
        ...prev,
        [argumentId]: response.g3Data
      }));

    } catch (error) {
      console.error(`Erreur chargement G3RawData pour ${argumentId}:`, error);
      setArgumentsG3Data(prev => ({ 
        ...prev, 
        [argumentId]: null 
      }));
    } finally {
      setLoadingG3Data(prev => ({ ...prev, [argumentId]: false }));
    }
  };

  // ✅ PREMIUM GATING : Vérifie si un argument peut être consulté (FREE = 3 max par debate)
  const isArgumentUnlocked = (argumentId: string): boolean => {
    if (argumentViewLimit === null) return true; // Premium+ : illimité
    return viewedArgumentIds.includes(argumentId);
  };

  const tryViewArgument = async (argumentId: string, navigateCallback: () => void) => {
    // Premium+ ou déjà vu : naviguer directement
    if (argumentViewLimit === null || viewedArgumentIds.includes(argumentId)) {
      navigateCallback();
      return;
    }

    // FREE : vérifier la limite
    if (viewedArgumentIds.length >= argumentViewLimit) {
      premium.promptPremium({ type: 'premiumFeature', featureName: t('premium.argumentAnalysis.title'), featureDescription: t('premium.argumentAnalysis.description') });
      return;
    }

    // Appeler le backend pour enregistrer le view
    try {
      const isLocal = route.params?.isLocalDebate === true;
      if (!isLocal) {
        const response = await axios.post(`${API_URL}/debates/${debateId}/view-argument`, {
          argumentId,
        });

        if (!response.data.allowed) {
          premium.promptPremium({ type: 'premiumFeature', featureName: t('premium.argumentAnalysis.title'), featureDescription: t('premium.argumentAnalysis.description') });
          return;
        }
      }

      // Ajouter à la liste locale
      setViewedArgumentIds(prev => [...prev, argumentId]);
      navigateCallback();
    } catch (error) {
      // En cas d'erreur réseau, laisser passer (graceful degradation)
      console.warn('Erreur view-argument, passage en mode dégradé:', error);
      navigateCallback();
    }
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
          <Text style={styles.loadingText}>{t('debates.recapA.analyzing')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!recapData) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('debates.recapA.noData')}</Text>
        </View>
      </SafeAreaView>
    );
  }

  // ✅ NOUVEAU : Déterminer si l'utilisateur actuel est l'hôte
  // Note: Comparaison basée sur le username pour l'instant, l'API devra être adaptée pour retourner les IDs
  const isCurrentUserHost = recapData?.players?.host?.username === user?.username;
  
  // ✅ NOUVEAU : Fonction pour analyser la situation du débat
  const getDebateSituation = () => {
    const hostHasArgs = !!(recapData?.stats.host.bestArgument || recapData?.stats.host.worstArgument);
    const guestHasArgs = !!(recapData?.stats.guest.bestArgument || recapData?.stats.guest.worstArgument);
    
    if (!hostHasArgs && !guestHasArgs) {
      return 'NO_ARGUMENTS';
    } else if (hostHasArgs && !guestHasArgs) {
      return 'HOST_ONLY';
    } else if (!hostHasArgs && guestHasArgs) {
      return 'GUEST_ONLY';
    } else {
      return 'NORMAL';
    }
  };
  
  const debateSituation = getDebateSituation();

  // ✅ NOUVEAU : Composant carte d'argument avec animation 3D press
  const ArgumentCard = ({
    argument,
    index,
    isCurrentUserArgument,
    isLocalDebate,
    onPress,
    locked = false,
  }: any) => {
    const pressAnimation = useSharedValue(0);

    const handlePressIn = () => {
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

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 4;

      return {
        transform: [{ translateY }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 4 - pressAnimation.value * 2),
        },
      };
    });

    // ✅ CORRIGÉ : Calcul du numéro de tour correct
    // turnIndex commence à 0, et chaque tour = 2 arguments (host + guest)
    // Tour 1 : arguments 0-1 (turnIndex 0-1 → tour 1)
    // Tour 2 : arguments 2-3 (turnIndex 2-3 → tour 2)
    const turnNumber = Math.floor(index / 2) + 1;

    return (
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Reanimated.View
          style={[
            styles.modalArgumentContainer,
            isCurrentUserArgument && styles.modalArgumentContainerUser,
            animatedStyle,
          ]}
        >
          {/* Badge score autocollant */}
          <View style={styles.modalArgumentScoreContainer}>
            <Text style={styles.modalArgumentScore}>
              {argument.scoreTotal || 0}
            </Text>
          </View>

          <View style={styles.modalArgumentHeader}>
            <Text style={[
              styles.modalArgumentAuthor,
              isCurrentUserArgument && styles.modalArgumentAuthorUser
            ]}>
              {isCurrentUserArgument
                ? (isLocalDebate
                    ? recapData.players.host?.username
                    : t('debates.recapA.modal.you')
                  )
                : (isLocalDebate
                    ? recapData.players.guest?.username
                    : (isCurrentUserHost ? recapData.players.guest?.username : recapData.players.host.username)
                  )
              }
            </Text>
          </View>

          <Text style={[
            styles.modalArgumentText,
            isCurrentUserArgument && styles.modalArgumentTextUser
          ]}>
            {argument.cleanText || argument.rawText}
          </Text>

          {/* Sources */}
          {argument.sourcesdata && argument.sourcesdata.length > 0 && (
            <View style={styles.modalSourcesContainer}>
              <Text style={[
                styles.modalSourcesLabel,
                isCurrentUserArgument && styles.modalSourcesLabelUser
              ]}>
                📚 {t('debates.recapA.modal.sources')}
              </Text>
              {argument.sourcesdata.map((source: any, sourceIndex: number) => (
                <TouchableOpacity
                  key={sourceIndex}
                  onPress={() => openSourceLink(source.url, source.title, t)}
                  style={styles.modalSourceItem}
                  activeOpacity={0.7}
                >
                  <Text style={[
                    styles.modalSourceText,
                    isCurrentUserArgument && styles.modalSourceTextUser
                  ]}>
                    🔗 {source.title}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <View style={styles.modalArgumentFooter}>
            <Text style={styles.modalArgumentTime}>
              {t('debates.recapA.modal.turn', { index: turnNumber })}
            </Text>
            <Text style={styles.modalArgumentHint}>
              {t('debates.recapA.modal.tapForDetails')}
            </Text>
          </View>

          {/* ✅ PREMIUM GATING : Overlay cadenas si verrouillé */}
          {locked && (
            <View style={styles.modalLockedOverlay} pointerEvents="none">
              <Ionicons name="lock-closed" size={24} color={COLORS.PAPER_IVORY} />
            </View>
          )}
        </Reanimated.View>
      </Pressable>
    );
  };

  // ✅ NOUVEAU : Composant bulle d'argument pressable avec effet 3D
  const PressableArgumentBubble = ({
    argument,
    isUser,
    isHost,
    disabled = false,
  }: {
    argument: { text: string; score: number; justification: string };
    isUser: boolean;
    isHost: boolean;
    disabled?: boolean; // ✅ NOUVEAU : Désactiver le clic pendant l'animation
  }) => {
    const pressAnimation = useSharedValue(0);

    const handlePressIn = () => {
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

    const animatedStyle = useAnimatedStyle(() => {
      const translateY = pressAnimation.value * 4;

      return {
        transform: [{ translateY }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 4 - pressAnimation.value * 2),
        },
      };
    });

    // ✅ Trouver l'argument complet dans allArguments pour avoir l'ID
    const findFullArgument = () => {
      if (!recapData?.allArguments) return null;
      return recapData.allArguments.find(
        (arg: any) => arg.cleanText === argument.text || arg.rawText === argument.text
      );
    };

    const handlePress = () => {
      trigger('button-tap');
      const fullArgument = findFullArgument();

      if (fullArgument) {
        const isLocalDebate = route.params?.isLocalDebate === true;
        const isCurrentUserArgument = isUser;

        const navigateToDetail = () => {
          navigation.navigate('ArgumentDetailDuel', {
            argumentId: fullArgument.id,
            debateId: recapData?.debate?.id || '',
            isLocalDebate: isLocalDebate,
            argumentData: {
              ...fullArgument,
              author: {
                username: isCurrentUserArgument
                  ? t('debates.recapA.modal.you')
                  : (isLocalDebate
                      ? (isHost ? recapData?.players?.host?.username : recapData?.players?.guest?.username)
                      : (isCurrentUserHost
                          ? recapData?.players?.guest?.username
                          : recapData?.players?.host?.username)
                    ),
                isCurrentUser: isCurrentUserArgument
              },
              debate: {
                id: recapData?.debate?.id || '',
                title: recapData?.debate?.title || '',
                hostView: recapData?.debate?.hostView || '',
                guestView: recapData?.debate?.guestView || ''
              }
            }
          });
        };

        // ✅ PREMIUM GATING : Vérifier le droit de consulter
        tryViewArgument(fullArgument.id, navigateToDetail);
      }
    };

    // ✅ PREMIUM GATING : Déterminer si cet argument est verrouillé
    const fullArg = findFullArgument();
    const locked = fullArg ? !isArgumentUnlocked(fullArg.id) && argumentViewLimit !== null && viewedArgumentIds.length >= argumentViewLimit : false;

    return (
      <Pressable
        onPress={disabled ? undefined : handlePress}
        onPressIn={disabled ? undefined : handlePressIn}
        onPressOut={disabled ? undefined : handlePressOut}
        disabled={disabled}
        style={{ opacity: disabled ? 1 : 1 }}
      >
        <Reanimated.View
          style={[
            styles.argumentBubble,
            isUser ? styles.userBubble : styles.opponentBubble,
            animatedStyle,
          ]}
        >
          <Text style={[
            styles.argumentText,
            isUser ? styles.userArgumentText : styles.opponentArgumentText
          ]}>
            {argument.text}
          </Text>

          <View style={[styles.scoreContainer, isUser && styles.userScoreContainer]}>
            <Text style={[
              styles.scoreText,
              isUser ? styles.userScoreText : styles.opponentScoreText
            ]}>
              {argument.score}
            </Text>
          </View>

          {/* ✅ PREMIUM GATING : Overlay cadenas si verrouillé */}
          {locked && (
            <View style={styles.lockedOverlay} pointerEvents="none">
              <Ionicons name="lock-closed" size={20} color={COLORS.PAPER_IVORY} />
            </View>
          )}
        </Reanimated.View>
      </Pressable>
    );
  };

  const renderArgumentBubble = (
    argument: { text: string; score: number; justification: string },
    isUser: boolean,
    isHost: boolean
  ) => (
    <PressableArgumentBubble
      argument={argument}
      isUser={isUser}
      isHost={isHost}
      disabled={!animationComplete} // ✅ Désactiver le clic pendant l'animation
    />
  );

  // ✅ NOUVEAU : Composant pour les cas sans arguments
  const renderNoArgumentMessage = (isUser: boolean, playerName: string, argType: 'best' | 'worst') => (
    <View style={[
      styles.noArgumentContainer,
      isUser ? styles.noArgumentUser : styles.noArgumentOpponent
    ]}>
      <Text style={[
        styles.noArgumentText,
        isUser ? styles.noArgumentUserText : styles.noArgumentOpponentText
      ]}>
        {argType === 'best' ? '🤐' : '😶'} {t('debates.recapA.noArgBubble', { name: playerName })}
      </Text>
    </View>
  );

  // ✅ NOUVEAU : Composant pour les messages globaux selon la situation
  const renderSituationMessage = () => {
    switch (debateSituation) {
      case 'NO_ARGUMENTS':
        return (
          <View style={styles.situationMessageContainer}>
            <Text style={styles.situationMessageTitle}>🤐 {t('debates.recapA.situation.silentTitle')}</Text>
            <Text style={styles.situationMessageText}>{t('debates.recapA.situation.silentText')}</Text>
          </View>
        );
      case 'HOST_ONLY':
        return (
          <View style={styles.situationMessageContainer}>
            <Text style={styles.situationMessageTitle}>🎤 {t('debates.recapA.situation.monologueTitle')}</Text>
            <Text style={styles.situationMessageText}>{t('debates.recapA.situation.monologueHost', { username: recapData?.players?.host?.username })}</Text>
          </View>
        );
      case 'GUEST_ONLY':
        return (
          <View style={styles.situationMessageContainer}>
            <Text style={styles.situationMessageTitle}>🎤 {t('debates.recapA.situation.monologueTitle')}</Text>
            <Text style={styles.situationMessageText}>{t('debates.recapA.situation.monologueGuest', { username: recapData?.players?.guest?.username })}</Text>
          </View>
        );
      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      {/* ✅ REDESIGN : AnimatedBackground */}
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={animationComplete} // ✅ Scroll désactivé pendant l'animation
        >
        {/* Titre du débat */}
        <Animated.View style={[styles.titleContainer, { opacity: titleOpacity }]}>
          <Text style={styles.debateTitle} numberOfLines={5}>
            {recapData.debate.title}
          </Text>
        </Animated.View>

        {/* ✅ NOUVEAU : Message de situation (si cas particulier) */}
        {renderSituationMessage()}

        {/* ✅ NOUVEAU : Section conditionnelle - Afficher seulement si il y a des arguments */}
        {debateSituation !== 'NO_ARGUMENTS' && (
          <>
            {/* Meilleurs arguments */}
            <View style={styles.sectionContainer}>
              <Animated.Text style={[styles.sectionTitle, { opacity: bestTitleOpacity }]}>✅ {t('debates.recapA.bestTitle')}</Animated.Text>
              
              {/* Meilleur argument de l'adversaire (gauche) */}
              <Animated.View style={{ opacity: bestOpponentOpacity }}>
                {isCurrentUserHost ? (
                  // Je suis host, donc adversaire = guest
                  recapData.stats.guest.bestArgument ? 
                    renderArgumentBubble(recapData.stats.guest.bestArgument, false, false) :
                    renderNoArgumentMessage(false, recapData.players.guest.username, 'best')
                ) : (
                  // Je suis guest, donc adversaire = host  
                  recapData.stats.host.bestArgument ?
                    renderArgumentBubble(recapData.stats.host.bestArgument, false, true) :
                    renderNoArgumentMessage(false, recapData.players.host.username, 'best')
                )}
              </Animated.View>
              
              {/* Meilleur argument utilisateur (droite) */}
              <Animated.View style={{ opacity: bestUserOpacity }}>
                {isCurrentUserHost ? (
                  // Je suis host
                  recapData.stats.host.bestArgument ?
                    renderArgumentBubble(recapData.stats.host.bestArgument, true, true) :
                    renderNoArgumentMessage(true, t('debates.recapA.modal.you'), 'best')
                ) : (
                  // Je suis guest
                  recapData.stats.guest.bestArgument ?
                    renderArgumentBubble(recapData.stats.guest.bestArgument, true, false) :
                    renderNoArgumentMessage(true, t('debates.recapA.modal.you'), 'best')
                )}
              </Animated.View>
            </View>

            {/* Pires arguments */}
            <View style={styles.sectionContainer}>
              <Animated.Text style={[styles.sectionTitle, { opacity: worstTitleOpacity }]}>❌ {t('debates.recapA.worstTitle')}</Animated.Text>
              
              {/* Pire argument de l'adversaire (gauche) */}
              <Animated.View style={{ opacity: worstOpponentOpacity }}>
                {isCurrentUserHost ? (
                  // Je suis host, donc adversaire = guest
                  recapData.stats.guest.worstArgument ? 
                    renderArgumentBubble(recapData.stats.guest.worstArgument, false, false) :
                    renderNoArgumentMessage(false, recapData.players.guest.username, 'worst')
                ) : (
                  // Je suis guest, donc adversaire = host  
                  recapData.stats.host.worstArgument ?
                    renderArgumentBubble(recapData.stats.host.worstArgument, false, true) :
                    renderNoArgumentMessage(false, recapData.players.host.username, 'worst')
                )}
              </Animated.View>
              
              {/* Pire argument utilisateur (droite) */}
              <Animated.View style={{ opacity: worstUserOpacity }}>
                {isCurrentUserHost ? (
                  // Je suis host
                  recapData.stats.host.worstArgument ?
                    renderArgumentBubble(recapData.stats.host.worstArgument, true, true) :
                    renderNoArgumentMessage(true, t('debates.recapA.modal.you'), 'worst')
                ) : (
                  // Je suis guest
                  recapData.stats.guest.worstArgument ?
                    renderArgumentBubble(recapData.stats.guest.worstArgument, true, false) :
                    renderNoArgumentMessage(true, t('debates.recapA.modal.you'), 'worst')
                )}
              </Animated.View>
            </View>
          </>
        )}

        {/* ✅ REDESIGN : Boutons avec composants redesignés */}
        <Animated.View style={{ opacity: instructionOpacity }}>
          <View style={styles.buttonContainer}>
            <SecondaryButton onPress={handleShowAllArguments}>
              <View style={styles.seeAllButtonContent}>
                <Text style={styles.seeAllButtonText}>{t('debates.recapA.seeAll')}</Text>
                {argumentViewLimit !== null && (
                  <Text style={[styles.seeAllButtonCounter, viewedArgumentIds.length >= argumentViewLimit && styles.seeAllButtonCounterExhausted]}>
                    {t('debates.recapA.analysesUsed', { used: viewedArgumentIds.length, total: argumentViewLimit })}
                  </Text>
                )}
              </View>
            </SecondaryButton>

            <PrimaryButton
              onPress={handleViewScores}
              disabled={!canNavigate}
              style={styles.primaryButtonCustom}
            >
              🏆 {t('debates.recapA.viewFinalScore')}
            </PrimaryButton>
          </View>
        </Animated.View>
        </ScrollView>
      </SafeAreaView>

      {/* ✅ REDESIGN : Modal tous les arguments */}
      <Modal
        visible={showAllArguments}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowAllArguments(false)}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSafeArea} edges={['top']}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>{t('debates.recapA.modal.title')}</Text>
                <IconButton
                  type="action"
                  icon={<Ionicons name="close" size={28} />}
                  onPress={() => {
                    trigger('button-tap');
                    setShowAllArguments(false);
                  }}
                  size={50}
                  backgroundColor={COLORS.surface}
                />
              </View>
            
            <ScrollView style={styles.modalScroll}>
              {recapData.allArguments && recapData.allArguments.length > 0 ? (
                recapData.allArguments.map((argument, index) => {
                  // Déterminer si c'est l'argument de l'utilisateur actuel
                  const isLocalDebate = route.params?.isLocalDebate === true;
                  const isCurrentUserArgument = isLocalDebate
                    ? argument.userId === 'player1'
                    : (isCurrentUserHost && argument.userId === user?.id) || (!isCurrentUserHost && argument.userId === user?.id);

                  const isLocked = !isArgumentUnlocked(argument.id) && argumentViewLimit !== null && viewedArgumentIds.length >= argumentViewLimit;

                  return (
                    <ArgumentCard
                      key={argument.id || index}
                      argument={argument}
                      index={index}
                      isCurrentUserArgument={isCurrentUserArgument}
                      isLocalDebate={isLocalDebate}
                      locked={isLocked}
                      onPress={() => {
                        // ✅ PREMIUM GATING : Si verrouillé, fermer la modal puis afficher le paywall
                        if (isLocked) {
                          setShowAllArguments(false);
                          setTimeout(() => premium.promptPremium({ type: 'premiumFeature', featureName: t('premium.argumentAnalysis.title'), featureDescription: t('premium.argumentAnalysis.description') }), 300);
                          return;
                        }
                        const navigateToDetail = () => {
                          setShowAllArguments(false);
                          navigation.navigate('ArgumentDetailDuel', {
                            argumentId: argument.id,
                            debateId: recapData.debate.id,
                            isLocalDebate: isLocalDebate,
                            argumentData: {
                              ...argument,
                              author: {
                                username: isCurrentUserArgument
                                  ? t('debates.recapA.modal.you')
                                  : (isLocalDebate
                                      ? recapData.players.guest?.username
                                      : (isCurrentUserHost ? recapData.players.guest?.username : recapData.players.host.username)
                                    ),
                                isCurrentUser: isCurrentUserArgument
                              },
                              debate: {
                                id: recapData.debate.id,
                                title: recapData.debate.title,
                                hostView: recapData.debate.hostView,
                                guestView: recapData.debate.guestView
                              }
                            }
                          });
                        };
                        // ✅ PREMIUM GATING
                        tryViewArgument(argument.id, navigateToDetail);
                      }}
                    />
                  );
                })
              ) : (
                <Text style={styles.modalPlaceholder}>
                  {t('debates.recapA.modal.noArguments')}
                </Text>
              )}
              </ScrollView>
            </View>
          </SafeAreaView>
        </View>
      </Modal>

      {/* Premium paywall */}
      <PremiumPaywall
        visible={premium.showPaywall}
        onClose={premium.closePaywall}
        onPurchaseSuccess={premium.closePaywall}
        trigger={premium.paywallTrigger}
      />

      {/* ✅ COACHING : Bulle flottante coach */}
      {!isLocalDebate && coachingData && coachingData.status === 'ready' && animationComplete && (
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
              <Animated.View
                style={[
                  styles.coachingBubbleInner,
                  {
                    width: coachingExpandAnim.interpolate({
                      inputRange: [0, 1],
                      outputRange: [56, 175],
                    }),
                  },
                ]}
              >
                {/* Texte positionné en absolu pour ne pas affecter le centrage de l'icône */}
                <Animated.View
                  style={[
                    styles.coachingTextWrapper,
                    { opacity: coachingTextOpacity },
                  ]}
                >
                  <Text style={styles.coachingBubbleText}>{t('coaching.bubble')}</Text>
                </Animated.View>
                {/* Icône toujours centrée dans les 50px droits */}
                <View style={styles.coachingIconWrapper}>
                  <Ionicons name="school" size={26} color={COLORS.white} />
                </View>
              </Animated.View>
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

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20, // Fullscreen sans AppHeader
    paddingBottom: 20,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    marginTop: 12,
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
  },

  titleContainer: {
    alignItems: 'center',
    marginBottom: 30,
    paddingTop: 10,
    paddingBottom: 15,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.PAPER_IVORY + '30',
  },

  debateTitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    textAlign: 'center',
    lineHeight: 28,
  },

  sectionContainer: {
    marginBottom: 30,
  },

  sectionTitle: {
    color: COLORS.YELLOW_CORE,
    fontSize: 20,
    fontFamily: 'Raleway-Black',
    textAlign: 'center',
    marginBottom: 8,
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  argumentBubble: {
    maxWidth: width * 0.75,
    marginVertical: 10,
    padding: 14,
    borderRadius: 16,
    position: 'relative',
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  opponentBubble: {
    backgroundColor: COLORS.surface,
    alignSelf: 'flex-start',
    marginLeft: 10,
  },

  userBubble: {
    backgroundColor: COLORS.YELLOW_CORE,
    alignSelf: 'flex-end',
    marginRight: 10,
  },

  argumentText: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    // ✅ Réduit de 700 à 600
    lineHeight: 18,
    marginBottom: 0, // ✅ Réduit de 8 à 0
  },

  opponentArgumentText: {
    color: COLORS.PAPER_IVORY,
  },

  userArgumentText: {
    color: COLORS.NIGHT_BLUE,
    fontWeight: '700', // ✅ Réduit de 900 à 700
  },

  scoreContainer: {
    position: 'absolute',
    top: -12,
    right: -30,
    backgroundColor: COLORS.ROYAL_BLUE,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 5,
    zIndex: 2,
  },

  userScoreContainer: {
    left: -30,
    right: 'auto',
    top: -12,
  },

  scoreText: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },

  opponentScoreText: {
    color: COLORS.PAPER_IVORY,
  },

  userScoreText: {
    color: COLORS.PAPER_IVORY,
  },
  // ✅ REDESIGN : Nouveau container pour les boutons
  buttonContainer: {
    gap: 12,
    alignItems: 'center',
    paddingTop: 16, // ✅ Réduit de 30 à 16 pour moins d'espace
    paddingBottom: 20,
  },

  primaryButtonCustom: {
    width: '90%',
  },


  // ✅ REDESIGN : Modal styles
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  modalSafeArea: {
    flex: 1,
    justifyContent: 'center',
  },
  modalContent: {
    backgroundColor: COLORS.NIGHT_BLUE,
    borderRadius: 16,
    maxHeight: '80%',
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 8,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.PAPER_IVORY + '30',
  },
  modalTitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    flex: 1,
  },
  modalScroll: {
    paddingHorizontal: 12,
    paddingVertical: 16,
  },
  modalPlaceholder: {
    color: COLORS.PAPER_IVORY,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    textAlign: 'center',
    opacity: 0.7,
  },

  // ✅ REDESIGN : Styles pour les cas sans arguments
  noArgumentContainer: {
    maxWidth: width * 0.75,
    marginVertical: 10,
    padding: 14,
    borderRadius: 16,
    borderStyle: 'dashed',
    borderWidth: 3,
    borderColor: COLORS.INK,
  },

  noArgumentOpponent: {
    backgroundColor: COLORS.surface + '40',
    alignSelf: 'flex-start',
    marginLeft: 10,
  },

  noArgumentUser: {
    backgroundColor: COLORS.YELLOW_CORE + '40',
    alignSelf: 'flex-end',
    marginRight: 10,
  },

  noArgumentText: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    fontStyle: 'italic',
    textAlign: 'center',
  },

  noArgumentOpponentText: {
    color: COLORS.GREY_MEDIUM,
  },

  noArgumentUserText: {
    color: COLORS.NIGHT_BLUE,
    fontWeight: '900',
  },

  // ✅ REDESIGN : Styles pour les messages de situation
  situationMessageContainer: {
    backgroundColor: COLORS.surface,
    padding: 20,
    borderRadius: 16,
    marginVertical: 15,
    marginHorizontal: 10,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },

  situationMessageTitle: {
    color: COLORS.YELLOW_CORE,
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    textAlign: 'center',
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  situationMessageText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    textAlign: 'center',
    lineHeight: 20,
  },

  // ✅ REDESIGN : Styles pour les cartes d'arguments dans la modal
  modalArgumentContainer: {
    backgroundColor: COLORS.surface,
    padding: 16,
    borderRadius: 16,
    marginBottom: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
    position: 'relative',
    overflow: 'visible',
  },
  modalArgumentContainerUser: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },
  modalArgumentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  modalArgumentAuthor: {
    color: COLORS.YELLOW_CORE,
    fontSize: 12,
    fontFamily: 'Raleway-ExtraBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    flex: 1,
  },
  modalArgumentAuthorUser: {
    color: COLORS.NIGHT_BLUE,
  },
  modalArgumentScoreContainer: {
    position: 'absolute',
    top: -12,
    right: -12,
    zIndex: 10,
  },
  modalArgumentScore: {
    color: COLORS.PAPER_IVORY,
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    backgroundColor: COLORS.ROYAL_BLUE,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 6,
    transform: [{ rotate: '8deg' }],
  },

  modalArgumentText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    lineHeight: 20,
    marginBottom: 10,
  },
  modalArgumentTextUser: {
    color: COLORS.NIGHT_BLUE,
    fontWeight: '700',
  },
  modalJustificationContainer: {
    backgroundColor: COLORS.NIGHT_BLUE + '60',
    padding: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  modalJustificationLabel: {
    color: COLORS.YELLOW_CORE,
    fontSize: 12,
    fontFamily: 'Raleway-ExtraBold',
    marginBottom: 5,
  },
  modalJustificationText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    lineHeight: 18,
    opacity: 0.9,
  },
  modalArgumentFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 4,
  },
  modalArgumentTime: {
    color: COLORS.GREY_MEDIUM,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
  },
  modalArgumentDetails: {
    color: COLORS.GREY_MEDIUM,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
  },
  modalArgumentHint: {
    color: COLORS.GREY_MEDIUM,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    textAlign: 'right',
  },

  // ✅ REDESIGN : Styles pour les sources dans la modal
  modalSourcesContainer: {
    marginTop: 12,
    marginBottom: 8,
    paddingTop: 12,
    borderTopWidth: 2,
    borderTopColor: COLORS.INK + '20',
  },
  modalSourcesLabel: {
    color: COLORS.YELLOW_CORE,
    fontSize: 12,
    fontFamily: 'Raleway-ExtraBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  modalSourcesLabelUser: {
    color: COLORS.NIGHT_BLUE,
  },
  modalSourceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 6,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  modalSourceText: {
    color: COLORS.ROYAL_BLUE,
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    textDecorationLine: 'underline',
    flex: 1,
  },
  modalSourceTextUser: {
    color: COLORS.NIGHT_BLUE,
    fontWeight: '800',
  },

  // ✅ PREMIUM GATING : Overlay cadenas sur les bulles verrouillées
  lockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  modalLockedOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderRadius: 13,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 5,
  },

  // ✅ PREMIUM GATING : Compteur dans le bouton "Voir tous les arguments"
  seeAllButtonContent: {
    alignItems: 'center',
  },
  seeAllButtonText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    textAlign: 'center',
  },
  seeAllButtonCounter: {
    color: COLORS.NIGHT_BLUE,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    textAlign: 'center',
    marginTop: 2,
    opacity: 0.6,
  },
  seeAllButtonCounterExhausted: {
    color: COLORS.error,
    opacity: 1,
  },

  // ✅ COACHING : Bulle flottante
  coachingBubble: {
    position: 'absolute',
    bottom: 90,
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
  coachingIconWrapper: {
    position: 'absolute',
    right: 0,
    top: 0,
    bottom: 0,
    width: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  coachingTextWrapper: {
    position: 'absolute',
    left: 16,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  coachingBubbleText: {
    color: COLORS.white,
    fontFamily: 'Raleway-Bold',
    fontSize: 16,
  },
}); 