import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Modal,
  KeyboardAvoidingView,
  Platform,
  Animated,
  ScrollView,
  Image,
  TextInput,
  Dimensions,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { RootStackScreenProps } from '../../types/navigation';
import { COLORS } from '../../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../../constants/fonts';
import { useAuth } from '../../hooks/useAuth';
import { useStreakData } from '../../hooks/useStreakData';
import ArgumentsService, { Argument as ArgumentType } from '../../services/arguments.service';
import { usePreventRemove, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { VoiceInputButton } from '../../components/VoiceInputButton';
import { useAudioRecording } from '../../hooks/useAudioRecording';
import { TranscriptionService } from '../../services/transcription.service';
import { Ionicons } from '@expo/vector-icons';
import DebatesService from '../../services/debates.service';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { IconButton } from '../../components/IconButton';
import { useNotifications } from '../../contexts/NotificationContext';
import { NotificationPermissionModal } from '../../components/NotificationPermissionModal';
import { useHaptics } from '../../hooks/useHaptics';
import { getAvatarSource } from '../../constants/avatars';
import { FloatingTagsOverlay } from '../../components/FloatingTagsOverlay';
import { FloatingDirection } from '../../components/FloatingTag';
import { mapRawTagsToDisplayTags, buildRawTagsFromArgument, DisplayTag } from '../../constants/argumentTags';
import { NotepadModal, getNotepadKey } from '../../components/NotepadModal';
import { AnimatedBubble } from '../../components/AnimatedBubble';


// Types pour les arguments - Étendre le type du service avec les données UI
type Argument = ArgumentType & {
  userName: string;
  userAvatar?: string;
  timestamp: string;
  isReformulated?: boolean;
  isSystemMessage?: boolean;
  isProcessingM2?: boolean;
  isProcessingM3?: boolean;
  isCompleted?: boolean;
  isRejected?: boolean;
  rejectionReason?: string;
};

type DebateUser = {
  id: string;
  username: string;
  selectedAvatarId?: string;
  opinion: string;
};

type Props = RootStackScreenProps<'AsyncDebateScreen'>;

// Composant de bouton animé pour le modal
const AnimatedMenuButton: React.FC<{
  onPress: () => void;
  style?: any;
  children: React.ReactNode;
}> = ({ onPress, style, children }) => {
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
    const scale = 1 - pressAnimation.value * 0.02;

    return {
      transform: [{ translateY }, { scale }],
      shadowOffset: {
        width: 0,
        height: Math.max(0, 4 - pressAnimation.value * 2),
      },
    };
  });

  return (
    <TouchableOpacity
      onPress={onPress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
    >
      <Reanimated.View style={[style, animatedStyle]}>
        {children}
      </Reanimated.View>
    </TouchableOpacity>
  );
};

// Clé AsyncStorage pour savoir si on a déjà demandé la permission
const NOTIFICATION_PERMISSION_ASKED_KEY = 'notifications_permission_asked';

export const AsyncDebateScreen: React.FC<Props> = ({ navigation, route }) => {
  const { debate } = route.params;
  const { user } = useAuth();
  const { updateStreak } = useStreakData(); // ✅ Hook pour la série de jours
  const { t, i18n } = useTranslation();
  const { requestNotificationPermission, notificationsEnabled } = useNotifications();
  const { trigger } = useHaptics();

  // 🎯 CALCUL DYNAMIQUE de l'adversaire selon qui je suis
  const opponentData = useMemo(() => {
    const isCurrentUserGuest = user?.id === debate.guestId;

    console.log('🔍 DEBUG ADVERSAIRE (ASYNC):', {
      myUserId: user?.id,
      debateHostId: debate.hostId,
      debateGuestId: debate.guestId,
      isCurrentUserGuest,
      hostUsername: debate.host?.username,
      guestUsername: debate.guest?.username,
      hostView: debate.hostView,
      guestView: debate.guestView
    });

    if (isCurrentUserGuest) {
      // Si je suis l'invité, mon adversaire est l'hôte
      console.log('✅ Je suis INVITÉ → adversaire = HÔTE');
      return {
        id: debate.hostId || 'host-id',
        username: debate.host?.username || t('debates.live.hostFallback'),
        selectedAvatarId: debate.host?.selectedAvatarId,
        opinion: debate.hostView || t('debates.live.hostOpinionFallback'),
      };
    } else {
      // Si je suis l'hôte, mon adversaire est l'invité
      console.log('✅ Je suis HÔTE → adversaire = INVITÉ');
      return {
        id: debate.guestId || 'guest-id',
        username: debate.guest?.username || t('debates.live.guestFallback'),
        selectedAvatarId: debate.guest?.selectedAvatarId,
        opinion: debate.guestView || t('debates.live.guestOpinionFallback'),
      };
    }
  }, [user?.id, debate]);

  const [opponent, setOpponent] = useState<DebateUser>(opponentData);

  // ✅ SYNC : Mettre à jour opponent quand opponentData change
  useEffect(() => {
    console.log('🔄 Mise à jour de l\'adversaire:', opponentData);
    setOpponent(opponentData);
  }, [opponentData]);

  // ✅ NOUVEAU : État local pour gérer le tour courant (mis à jour par WebSocket)
  const [currentTurnUserId, setCurrentTurnUserId] = useState(debate.currentTurnUserId);
  const [turnStartedAt, setTurnStartedAt] = useState(debate.turnStartedAt);

  const [argumentsList, setArgumentsList] = useState<Argument[]>([]);
  const [isScrollReady, setIsScrollReady] = useState(false);
  const needsInitialScrollRef = useRef(true);

  const [inputText, setInputText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const textRef = useRef('');
  const [showMenu, setShowMenu] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [hasJustSentMessage, setHasJustSentMessage] = useState(false);

  // États pour la transcription audio
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const { startRecording, stopRecording, cancelRecording } = useAudioRecording();

  // Déterminer si l'utilisateur actuel est l'invité
  const isCurrentUserGuest = user?.id === debate.guestId;

  // ✅ ASYNC : NOUVEAUX ÉTATS pour gestion des tours
  const [timeRemaining, setTimeRemaining] = useState<number | null>(null);
  const [messagesUsed, setMessagesUsed] = useState(0);
  const maxMessages = debate.maxMessagesPerUser || 10;
  // ✅ CORRECTION : Utiliser l'état local currentTurnUserId au lieu de debate.currentTurnUserId
  const isMyTurn = currentTurnUserId === user?.id;

  // ✅ NOUVEAU : États pour les propositions d'arrêt
  const [showProposalBubble, setShowProposalBubble] = useState(false);
  const [currentProposal, setCurrentProposal] = useState<{proposerUsername: string} | null>(null);

  // ✅ NOUVEAU : Protection contre navigation multiple vers récap
  const [isDebateEnded, setIsDebateEnded] = useState(false);
  const [hasNavigatedToRecap, setHasNavigatedToRecap] = useState(false);

  // ✅ NOUVEAU : État pour l'overlay d'attente d'analyse
  const [analysisWaitState, setAnalysisWaitState] = useState<{
    isWaiting: boolean;
    message: string;
    submessage: string;
    severity: 'info' | 'warning' | 'error';
    attempt: number;
    maxAttempts: number;
  } | null>(null);

  // ✅ NOUVEAU : Protection contre clics multiples pour la proposition d'arrêt
  const [isProposingStop, setIsProposingStop] = useState(false);

  // Limite : une seule proposition d'arrêt par tour
  const [hasProposedThisTurn, setHasProposedThisTurn] = useState(false);

  // ✅ NOTIFICATIONS : Modal après envoi d'argument async
  const [showNotificationModal, setShowNotificationModal] = useState(false);

  // ✅ FLOATING TAGS : Bulles flottantes après scoring
  const [floatingTags, setFloatingTags] = useState<DisplayTag[]>([]);
  const [showFloatingTags, setShowFloatingTags] = useState(false);
  const [floatingDirection, setFloatingDirection] = useState<FloatingDirection>('up');
  const shownFloatingTagIdsRef = useRef<Set<string>>(new Set());

  // ✅ ANIMATED BUBBLE : Tags en attente de la fin de l'animation de révélation
  const pendingFloatingTagsRef = useRef<Map<string, { tags: DisplayTag[]; direction: FloatingDirection }>>(new Map());

  // Opponent activity indicator (typing/speaking)
  const [opponentActivity, setOpponentActivity] = useState<'typing' | 'speaking' | null>(null);
  const opponentActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const typingEmitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Notepad state
  const [showNotepad, setShowNotepad] = useState(false);
  const [hasNoteContent, setHasNoteContent] = useState(false);

  // Keyboard visibility — réduit le padding bas quand le clavier est ouvert
  const [keyboardVisible, setKeyboardVisible] = useState(false);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subShow = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const subHide = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => { subShow.remove(); subHide.remove(); };
  }, []);

  // Check if notepad has content on mount
  useEffect(() => {
    AsyncStorage.getItem(getNotepadKey(debate.id)).then((saved) => {
      if (saved && saved.length > 0) setHasNoteContent(true);
    });
  }, [debate.id]);

  // ✅ ASYNC : Ref pour tracker si le guest a envoyé au moins un argument
  const hasGuestSentArgumentRef = useRef(false);
  // ✅ ASYNC : Ref pour éviter le double appel de releaseJoin
  const hasReleasedJoinRef = useRef(false);
  // ✅ ASYNC : Ref pour tracker le status actuel du débat (évite problème de stale closure)
  const debateStatusRef = useRef(debate.status);
  // ✅ ASYNC : Ref pour stocker isCurrentUserGuest (évite stale closure)
  const isCurrentUserGuestRef = useRef(isCurrentUserGuest);
  // ✅ ASYNC : Ref pour stocker debate.id
  const debateIdRef = useRef(debate.id);

  // Mettre à jour les refs quand les valeurs changent
  useEffect(() => {
    isCurrentUserGuestRef.current = isCurrentUserGuest;
    debateIdRef.current = debate.id;
  }, [isCurrentUserGuest, debate.id]);

  // ✅ ASYNC : Release cleanup UNIQUEMENT au démontage du composant (pas sur blur/focus)
  useEffect(() => {
    // Vérifier si des arguments existent déjà au chargement
    const checkExistingArguments = async () => {
      try {
        const response = await ArgumentsService.getDebateArguments(debate.id);
        const args = Array.isArray(response) ? response : (response as any)?.arguments || [];
        if (args.some((arg: any) => arg.userId === user?.id)) {
          hasGuestSentArgumentRef.current = true;
          debateStatusRef.current = 'active';
          console.log('✅ [AsyncDebateScreen] Arguments existants détectés, pas de release nécessaire');
        }
      } catch (error) {
        console.warn('⚠️ [AsyncDebateScreen] Erreur lors de la vérification des arguments:', error);
      }
    };

    checkExistingArguments();

    // Cleanup UNIQUEMENT au démontage réel du composant
    return () => {
      // Vérifier les conditions pour le release
      const shouldRelease =
        isCurrentUserGuestRef.current &&
        !hasGuestSentArgumentRef.current &&
        !hasReleasedJoinRef.current &&
        debateStatusRef.current === 'reserved';

      if (shouldRelease) {
        console.log('🔓 [AsyncDebateScreen] Démontage - libération du débat');
        hasReleasedJoinRef.current = true;
        DebatesService.releaseJoin(debateIdRef.current).catch(error => {
          console.warn('⚠️ [AsyncDebateScreen] Erreur lors de la libération du débat:', error);
        });
      } else {
        console.log('ℹ️ [AsyncDebateScreen] Démontage - pas de libération nécessaire:', {
          isCurrentUserGuest: isCurrentUserGuestRef.current,
          hasGuestSentArgument: hasGuestSentArgumentRef.current,
          hasReleasedJoin: hasReleasedJoinRef.current,
          debateStatus: debateStatusRef.current
        });
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Volontairement vide - on veut UNIQUEMENT le cleanup au démontage

  // ✅ NOTIFICATIONS : Désactivé - La demande est maintenant gérée via un modal personnalisé
  // dans RecapScreenB après la fin du premier débat async
  // useEffect(() => {
  //   const askNotificationPermission = async () => {
  //     try {
  //       const alreadyAsked = await AsyncStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY);
  //       if (!alreadyAsked) {
  //         await AsyncStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
  //         setTimeout(async () => {
  //           await requestNotificationPermission();
  //         }, 1500);
  //       }
  //     } catch (error) {
  //       console.warn('⚠️ Erreur lors de la demande de permission notifications:', error);
  //     }
  //   };
  //   askNotificationPermission();
  // }, [requestNotificationPermission]);

  // ✅ ASYNC : Charger l'état du débat au montage pour vérifier les propositions en attente
  useEffect(() => {
    const checkPendingProposal = async () => {
      try {
        console.log('🔍 Vérification des propositions d\'arrêt en attente...');
        const currentDebate = await DebatesService.getDebateById(debate.id);

        // Vérifier s'il y a une proposition d'arrêt en cours
        if (currentDebate.stopProposedBy && currentDebate.stopProposedBy !== user?.id) {
          console.log('✅ Proposition d\'arrêt en attente détectée !', {
            stopProposedBy: currentDebate.stopProposedBy,
            myId: user?.id
          });

          const proposerUsername = currentDebate.stopProposedBy === currentDebate.hostId
            ? (currentDebate.host?.username || t('debates.live.opponent'))
            : (currentDebate.guest?.username || t('debates.live.opponent'));

          setCurrentProposal({ proposerUsername });
          setShowProposalBubble(true);
        } else {
          console.log('ℹ️ Aucune proposition d\'arrêt en attente');
        }

        // Vérifier si on a déjà proposé l'arrêt ce tour
        const stopEvents: any[] = currentDebate.stopEvents || [];
        const alreadyProposed = stopEvents.some(
          (e: any) => e.type === 'proposed' && e.userId === user?.id && e.turnNumber === currentDebate.turnNumber,
        );
        if (alreadyProposed) {
          setHasProposedThisTurn(true);
        }
      } catch (error) {
        console.error('❌ Erreur lors de la vérification des propositions:', error);
      }
    };

    checkPendingProposal();
  }, [debate.id, user?.id]);

  // ✅ NOUVEAU : Fonction centralisée pour naviguer vers récap (évite les doublons)
  const navigateToRecap = (reason: string, firstVisit: boolean = true) => {
    if (hasNavigatedToRecap) {
      return;
    }

    setHasNavigatedToRecap(true);
    setIsDebateEnded(true);

    // Clean up notepad
    AsyncStorage.removeItem(getNotepadKey(debate.id));

    navigation.navigate('RecapA', {
      debateId: debate.id,
      firstVisit
    });
  };

  const scrollViewRef = useRef<ScrollView>(null);

  // ✅ ANIMATION 3 PETITS POINTS pour le chargement
  const dotsAnimation = useRef(new Animated.Value(0)).current;

  // ✅ ANIMATION des 3 petits points (chargement)
  useEffect(() => {
    const dotsAnimationLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(dotsAnimation, {
          toValue: 1,
          duration: 600,
          useNativeDriver: false,
        }),
        Animated.timing(dotsAnimation, {
          toValue: 0,
          duration: 600,
          useNativeDriver: false,
        }),
      ])
    );

    dotsAnimationLoop.start();

    return () => {
      dotsAnimationLoop.stop();
    };
  }, [dotsAnimation]);

  // ✅ ASYNC : Timer compte à rebours du tour actuel
  useEffect(() => {
    // ✅ CORRECTION : Utiliser turnStartedAt de l'état local au lieu de debate.turnStartedAt
    if (!turnStartedAt || !isMyTurn) {
      setTimeRemaining(null);
      return;
    }

    const updateTimeRemaining = () => {
      const turnStarted = new Date(turnStartedAt).getTime();
      const turnTimeout = (debate.turnTimeout || 24) * 60 * 60 * 1000;
      const deadline = turnStarted + turnTimeout;
      const remaining = deadline - Date.now();
      setTimeRemaining(remaining > 0 ? remaining : 0);
    };

    updateTimeRemaining();
    const interval = setInterval(updateTimeRemaining, 10000);
    return () => clearInterval(interval);
  }, [turnStartedAt, debate.turnTimeout, isMyTurn]);

  // ✅ ASYNC : Compter les messages utilisés
  useEffect(() => {
    const userMessages = argumentsList.filter(arg => arg.userId === user?.id);
    setMessagesUsed(userMessages.length);
  }, [argumentsList, user?.id]);

  // ✅ FONCTION pour compter les arguments par joueur
  const getArgumentsCount = () => {
    const userCount = argumentsList.filter(arg =>
      arg.userId === user?.id &&
      !arg.isSystemMessage &&
      arg.isArgument !== false
    ).length;

    const opponentCount = argumentsList.filter(arg =>
      arg.userId !== user?.id &&
      arg.userId !== 'system' &&
      !arg.isSystemMessage &&
      arg.isArgument !== false
    ).length;

    return { userCount, opponentCount };
  };

  // Initialisation d'ArgumentsService et Socket.IO
  useEffect(() => {
    if (!user?.token) return;

    console.log('🔌 Initialisation ArgumentsService pour le débat asynchrone:', debate.id);

    // Configurer le token d'authentification
    ArgumentsService.setAuthToken(user.token);

    // Initialiser Socket.IO
    ArgumentsService.initializeSocket(user.token);

    // Rejoindre la room du débat
    ArgumentsService.joinDebateRoom(debate.id);

    // Configurer les listeners
    ArgumentsService.setupSocketListeners(debate.id, {
      onArgumentReady: (data) => {
        console.log('📝 Argument traité par M1:', data);

        // Vérifier que l'argument complet est disponible
        if (!data.argument) {
          console.warn('⚠️ Événement argument_ready reçu sans données complètes');
          return;
        }

        // 1️⃣ Si c'est MON argument (je suis l'envoyeur) → Mettre à jour le message existant
        if (data.argument.userId === user?.id) {
          console.log('✏️ Mise à jour de MON message (brut → reformulé)');

          // ✅ ASYNC : Ne PAS réactiver la saisie ici - ce sera géré par l'événement turn_changed
          // La saisie doit rester bloquée jusqu'à ce que ce soit de nouveau notre tour

          setArgumentsList(prev => prev.map(arg => {
            // 🔍 Matching intelligent : par ID exact OU par contenu + userId (race condition fix)
            const isMatchById = arg.id === data.argumentId;
            const isMatchByContent = arg.userId === data.argument!.userId &&
                                   arg.rawText === data.argument!.rawText &&
                                   arg.isProcessing === true;

            if (isMatchById || isMatchByContent) {
              console.log('✅ DEBUG - Match trouvé, mise à jour de l\'argument');
              return {
                ...arg,
                id: data.argumentId,
                cleanText: data.cleanText,
                isProcessing: false,
                isArgument: data.isArgument,
                isReformulated: true,
                needsFactcheck: data.needsFactcheck ?? false,
              };
            }
            return arg;
          }));
        }
        // 2️⃣ Si c'est l'argument de mon ADVERSAIRE → Créer un nouveau message
        else {
          console.log('📨 Nouveau message reçu de l\'adversaire (déjà reformulé)');

          const newArgument: Argument = {
            id: data.argument.id,
            debateId: data.argument.debateId,
            userId: data.argument.userId,
            turnIndex: data.argument.turnIndex,
            rawText: data.argument.rawText,
            cleanText: data.argument.cleanText,
            repetition: false,
            factChecked: false,
            reliability: 0,
            impact: 0,
            scoreTotal: 0,
            gifCategory: 1,
            searchQuery: undefined,
            isArgument: data.argument.isArgument,
            insultFlag: data.argument.insultFlag,
            justification: '',
            createdAt: data.argument.createdAt,
            // UI fields
            userName: data.argument.user?.username || t('debates.live.opponent'),
            timestamp: new Date(data.argument.createdAt).toLocaleTimeString('fr-FR', {
              hour: '2-digit',
              minute: '2-digit'
            }),
            isProcessing: false,
            isReformulated: true,
            isScored: false,
            needsFactcheck: data.needsFactcheck ?? false,
          };

          // Ajouter le message à la liste
          setArgumentsList(prev => [...prev, newArgument]);

          // Haptic feedback quand on reçoit un argument adverse
          trigger('message-received');

          // Scroll vers le bas pour voir le nouveau message
          setTimeout(() => {
            scrollViewRef.current?.scrollToEnd({ animated: true });
          }, 100);
        }
      },

      onArgumentScored: (data) => {
        console.log('🎯 Argument scoré par M3:', data);
        const isRejected = !!(data as any).rejected;

        setArgumentsList(prev => prev.map(arg => {
          if (arg.id === data.argumentId) {
            if (isRejected) {
              console.log('🚫 Argument rejeté par modération:', data.argumentId);
              return {
                ...arg,
                isScored: true,
                isCompleted: true,
                isRejected: true,
                rejectionReason: (data as any).rejectionReason || '',
                isProcessingM2: false,
                isProcessingM3: false,
                isReformulated: true,
                isProcessing: false,
                scoreTotal: 0,
              };
            }
            console.log('✅ Mise à jour statut vers SCORÉ/VÉRIFIÉ pour argument:', data.argumentId);
            return {
              ...arg,
              id: data.argumentId,
              isScored: true,
              isCompleted: true,
              isProcessingM2: false,
              isProcessingM3: false,
              isReformulated: true,
              isProcessing: false,
              reliability: data.scores.reliability,
              impact: data.scores.impact,
              scoreTotal: data.scores.total,
              gifCategory: data.scores.gifCategory,
              justification: data.scores.justification || arg.justification
            };
          }
          return arg;
        }));

        // ✅ FLOATING TAGS : Stocker les tags pour déclenchement après l'animation de révélation
        if (data.tags && data.tags.length > 0 && !shownFloatingTagIdsRef.current.has(data.argumentId)) {
          shownFloatingTagIdsRef.current.add(data.argumentId);
          const displayTags = mapRawTagsToDisplayTags(data.tags, i18n.language);
          if (displayTags.length > 0) {
            // Utiliser setArgumentsList pour accéder à la liste à jour (évite stale closure)
            setArgumentsList(prev => {
              const scoredArg = prev.find(a => a.id === data.argumentId);
              const isMine = scoredArg?.userId === user?.id;
              const direction: FloatingDirection = isMine ? 'up' : 'down';

              if (!isDebateEnded) {
                pendingFloatingTagsRef.current.set(data.argumentId, { tags: displayTags, direction });
              }
              return prev;
            });
          }
        }
      },

      // ✅ NOUVEAU : Gérer les rejets d'arguments
      onArgumentRejected: (data) => {
        console.log('🚫 Argument rejeté:', data);

        // Si c'est mon argument qui a été rejeté, réactiver la saisie
        if (data.userId === user?.id) {
          console.log('✅ Mon argument rejeté, réactivation de la saisie');
          setHasJustSentMessage(false);

          // Afficher un message d'erreur à l'utilisateur
          Alert.alert(
            'Argument rejeté',
            data.message,
            [{ text: 'OK', style: 'default' }]
          );

          // Supprimer l'argument temporaire de la liste s'il existe
          setArgumentsList(prev => prev.filter(arg =>
            !(arg.isProcessing && arg.userId === data.userId)
          ));
        }
      },

      // ✅ NOUVEAU : Écouter les changements de statut des arguments (M2, M3, etc.)
      onArgumentStatusUpdate: (data) => {
        console.log('🔄 Changement de statut argument:', data);

        setArgumentsList(prev => prev.map(arg => {
          if (arg.id === data.argumentId) {
            console.log(`✅ Mise à jour statut argument ${data.argumentId}: ${data.status}`);
            const updates: Partial<Argument> = {};

            switch (data.status) {
              case 'processing_m2':
                updates.isProcessingM2 = true;
                updates.isProcessingM3 = false;
                updates.isCompleted = false;
                updates.isScored = false;
                break;
              case 'processing_m3':
                updates.isProcessingM2 = false;
                updates.isProcessingM3 = true;
                updates.isCompleted = false;
                updates.isScored = false;
                break;
              case 'completed':
              case 'COMPLETED':
                updates.isProcessingM2 = false;
                updates.isProcessingM3 = false;
                updates.isCompleted = true;
                updates.isScored = true;
                break;
            }

            return { ...arg, ...updates };
          }
          return arg;
        }));
      },

      onLlmDebug: (data) => {
        // ✅ LOGS SIMPLIFIÉS : Seulement les réponses des modules
        if (data.action === 'Réponse') {
          console.log(`🤖 ${data.module} →`, data.response);
        }
      },

      onOpponentQuit: (data) => {
        console.log('🚪 Adversaire a quitté le débat:', data);
        trigger('button-error');

        setIsDebateEnded(true);

        Alert.alert(
          t('debates.live.opponentQuitTitle'),
          t('debates.live.opponentQuitBody', { username: data.quitter.username }),
          [
            {
              text: t('debates.live.ok'),
              onPress: () => navigateToRecap('Adversaire a quitté')
            }
          ]
        );
      },

      // ✅ ASYNC : Fin de débat
      onDebateEnded: (data) => {
        console.log('🏁 Débat asynchrone terminé:', data);
        trigger('button-success');

        // Fermer l'overlay d'attente d'analyse
        setAnalysisWaitState(null);

        if (hasNavigatedToRecap) {
          console.log('🚫 Navigation déjà en cours, événement ignoré');
          return;
        }

        setIsDebateEnded(true);

        // Afficher une alerte avant de naviguer vers RecapA
        Alert.alert(
          t('debates.async.screen.debateEndedTitle', { defaultValue: 'Débat terminé' }),
          t('debates.async.screen.debateEndedBody', {
            defaultValue: 'L\'adversaire a accepté la proposition d\'arrêt. Le débat est terminé.',
            username: data.acceptedBy || '',
          }),
          [{
            text: t('debates.live.seeResults', { defaultValue: 'Voir les résultats' }),
            onPress: () => navigateToRecap('Débat terminé par accord mutuel', true),
          }],
          { cancelable: false }
        );
      },

      // ✅ ASYNC : Réception du message d'attente pour arguments en cours d'analyse
      onArgumentAnalysisPending: (data) => {
        console.log('⏳ Arguments en cours d\'analyse:', data);

        // ✅ NOUVEAU : Afficher l'overlay d'attente avec messages progressifs
        setAnalysisWaitState({
          isWaiting: true,
          message: data.message || t('debates.live.analysis.scoringInProgress'),
          submessage: data.submessage || t('debates.live.analysis.recapSoon'),
          severity: data.severity || 'info',
          attempt: data.attempt || 0,
          maxAttempts: data.maxAttempts || 6
        });
      },

      // ✅ NOUVEAU : Erreur d'analyse détectée
      onAnalysisErrorDetected: (data) => {
        console.log('⚠️ Erreur d\'analyse détectée:', data);

        setAnalysisWaitState({
          isWaiting: true,
          message: data.message || t('debates.live.analysis.errorDetected'),
          submessage: data.submessage || t('debates.live.analysis.eloNotImpacted'),
          severity: 'error',
          attempt: 6,
          maxAttempts: 6
        });
      },

      // ✅ NOUVEAU : Analyse terminée, prêt à finaliser
      onAnalysisCompleteReadyToEnd: (data) => {
        console.log('✅ Analyse terminée, finalisation:', data);
        setAnalysisWaitState(null); // Fermer l'overlay
      },

      // Indicateur adversaire (typing/speaking)
      onOpponentActivity: (data) => {
        console.log('👀 opponent_activity reçu:', data.type, data.status, 'from', data.userId);
        if (data.userId === user?.id) return; // Ignorer mes propres events
        if (data.status === 'stop') {
          setOpponentActivity(null);
          if (opponentActivityTimerRef.current) clearTimeout(opponentActivityTimerRef.current);
        } else {
          setOpponentActivity(data.type);
          // Auto-reset après 10s sans nouvel event
          if (opponentActivityTimerRef.current) clearTimeout(opponentActivityTimerRef.current);
          opponentActivityTimerRef.current = setTimeout(() => {
            setOpponentActivity(null);
          }, 10000);
        }
      },

      // ✅ NOUVEAU : Écouter les changements de tour
      onTurnChanged: (data) => {
        console.log('🔄 Changement de tour reçu:', data);

        setCurrentTurnUserId(data.currentTurnUserId);
        setTurnStartedAt(data.turnStartedAt);
        setHasProposedThisTurn(false);

        if (data.currentTurnUserId === user?.id) {
          console.log('✅ C\'est maintenant votre tour !');
          setHasJustSentMessage(false);
        } else {
          console.log('⏳ En attente de la réponse de l\'adversaire...');
        }
      },

      // ✅ LIVE : Utiliser les événements LIVE (réutilisation architecture LIVE)
      onDebateEndProposed: (data) => {
        console.log('🤝 Proposition d\'arrêt reçue via WebSocket');

        const proposerUsername = data.proposerUsername || t('debates.live.opponent');

        // Ajouter un message système persistant dans le chat
        const sysMsg: Argument = {
          id: `system-stop-proposed-${Date.now()}`,
          debateId: debate.id,
          userId: 'system',
          turnIndex: -1,
          userName: t('debates.live.system'),
          rawText: t('debates.async.screen.proposalSentSystem', { username: proposerUsername }),
          cleanText: t('debates.async.screen.proposalSentSystem', { username: proposerUsername }),
          repetition: false,
          factChecked: false,
          reliability: 0,
          impact: 0,
          scoreTotal: 0,
          gifCategory: 1,
          isArgument: false,
          insultFlag: false,
          justification: '',
          createdAt: new Date().toISOString(),
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          isProcessing: false,
          isScored: false,
          isSystemMessage: true,
        };
        setArgumentsList(prev => [...prev, sysMsg]);

        if (data.proposerUserId === user?.id) {
          console.log('🚫 Ignore ma propre proposition (pas de modal)');
          return;
        }

        trigger('selection');

        setCurrentProposal({ proposerUsername });
        setShowProposalBubble(true);
      },

      onDebateEndRefused: (data) => {
        console.log('❌ Proposition refusée par l\'adversaire:', data);

        const refuserUsername = data.refuserUsername || t('debates.live.opponent');
        const sysMsg: Argument = {
          id: `system-stop-refused-${Date.now()}`,
          debateId: debate.id,
          userId: 'system',
          turnIndex: -1,
          userName: t('debates.live.system'),
          rawText: t('debates.async.screen.proposalRefusedSystem', { username: refuserUsername }),
          cleanText: t('debates.async.screen.proposalRefusedSystem', { username: refuserUsername }),
          repetition: false,
          factChecked: false,
          reliability: 0,
          impact: 0,
          scoreTotal: 0,
          gifCategory: 1,
          isArgument: false,
          insultFlag: false,
          justification: '',
          createdAt: new Date().toISOString(),
          timestamp: new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
          isProcessing: false,
          isScored: false,
          isSystemMessage: true,
        };
        setArgumentsList(prev => [...prev, sysMsg]);

        Alert.alert(
          t('debates.async.screen.proposalRefusedTitle'),
          t('debates.async.screen.proposalRefusedBody'),
          [{ text: t('common.ok') }]
        );
      },

      // ✅ M0 MODERATION : Débat annulé (host coupable)
      onDebateCancelled: (data) => {
        console.log('🚫 Débat annulé par modération M0:', data);
        trigger('button-error');
        setIsDebateEnded(true);

        Alert.alert(
          t('debates.moderation.debateCancelledTitle', { defaultValue: 'Débat annulé' }),
          data.message || t('debates.moderation.debateCancelledBody', { defaultValue: 'Le débat a été annulé pour cause de contenu inapproprié.' }),
          [
            {
              text: t('common.ok', { defaultValue: 'OK' }),
              onPress: () => navigation.replace('Home')
            }
          ]
        );
      },

      // ✅ M0 MODERATION : Débat remis en attente (guest coupable, host notifié)
      // Pour les débats async, on ne va pas sur WaitingScreen (l'host est sur Home)
      // On retourne simplement sur Home avec un message
      onDebateResetToWaiting: (data) => {
        console.log('♻️ Débat async remis en attente:', data);
        trigger('selection');

        Alert.alert(
          t('debates.moderation.guestRejectedTitle', { defaultValue: 'Invité rejeté' }),
          t('debates.moderation.guestRejectedBodyAsync', {
            defaultValue: 'L\'invité a été rejeté pour contenu inapproprié. Le débat est de nouveau disponible pour d\'autres joueurs.'
          }),
          [
            {
              text: t('common.ok', { defaultValue: 'OK' }),
              onPress: () => navigation.replace('Home')
            }
          ]
        );
      },

      // ✅ M0 MODERATION : Guest viré pour modération
      onDebateKickedModeration: (data) => {
        console.log('🚪 Viré pour modération M0:', data);
        trigger('button-error');
        setIsDebateEnded(true);

        // ✅ Marquer comme déjà "released" pour éviter le double appel à releaseJoin au démontage
        hasReleasedJoinRef.current = true;
        debateStatusRef.current = 'kicked';

        Alert.alert(
          t('debates.moderation.kickedTitle', { defaultValue: 'Participation rejetée' }),
          data.message || t('debates.moderation.kickedBody', { defaultValue: 'Votre participation a été rejetée pour contenu inapproprié.' }),
          [
            {
              text: t('common.ok', { defaultValue: 'OK' }),
              onPress: () => navigation.replace('Home')
            }
          ]
        );
      },
    });

    // Charger les arguments existants
    loadExistingArguments();

    return () => {
      console.log('🔌 Nettoyage ArgumentsService');
      ArgumentsService.removeSocketListeners();
      ArgumentsService.leaveDebateRoom(debate.id);
      if (opponentActivityTimerRef.current) clearTimeout(opponentActivityTimerRef.current);
      if (typingEmitTimerRef.current) clearTimeout(typingEmitTimerRef.current);
    };
  }, [debate.id, user?.token]);

  // Charger les arguments existants du débat
  const loadExistingArguments = async () => {
    try {
      const response = await ArgumentsService.getDebateArguments(debate.id);

      // L'API retourne un objet avec une propriété "arguments"
      let existingArgs: any[] = [];
      if (Array.isArray(response)) {
        existingArgs = response;
      } else if (response && typeof response === 'object' && 'arguments' in response && Array.isArray((response as any).arguments)) {
        existingArgs = (response as any).arguments;
      } else {
        console.warn('Format inattendu pour les arguments:', response);
        setArgumentsList([]);
        return;
      }

      const formattedArgs: Argument[] = existingArgs.map((arg: any) => {
        const hasScores = arg.scoreTotal > 0 || arg.reliability > 0 || arg.impact > 0;
        const isRejected = arg.state === 'n8n_rejected' || arg.n8nModeration === 'REJECT' || arg.n8nGamingStatus === 'STOP';
        const isCompleted = isRejected || hasScores || arg.state === 'n8n_completed' || arg.state === 'completed';

        return {
          ...arg,
          userName: arg.userId === user?.id ? t('debates.live.you') : t('debates.live.opponent'),
          timestamp: new Date(arg.createdAt).toLocaleTimeString('fr-FR', {
            hour: '2-digit',
            minute: '2-digit'
          }),
          isProcessing: false,
          isScored: isCompleted,
          isCompleted: isCompleted,
          isReformulated: true,
          isProcessingM2: false,
          isProcessingM3: false,
          isRejected,
          rejectionReason: isRejected ? (arg.n8nModerationReason || arg.justification || '') : undefined,
        };
      });
      // Fusionner les stopEvents comme messages système
      try {
        const currentDebate = await DebatesService.getDebateById(debate.id);
        const stopEvents: any[] = currentDebate.stopEvents || [];
        const systemMessages: Argument[] = stopEvents.map((evt: any) => {
          let rawText = '';
          if (evt.type === 'proposed') {
            rawText = t('debates.async.screen.proposalSentSystem', { username: evt.username });
          } else if (evt.type === 'refused') {
            rawText = t('debates.async.screen.proposalRefusedSystem', { username: evt.username });
          } else if (evt.type === 'accepted') {
            rawText = t('debates.async.screen.proposalAcceptedSystem', { username: evt.username });
          }
          return {
            id: `system-stop-${evt.type}-${evt.at}`,
            debateId: debate.id,
            userId: 'system',
            turnIndex: -1,
            userName: t('debates.live.system'),
            rawText,
            cleanText: rawText,
            repetition: false,
            factChecked: false,
            reliability: 0,
            impact: 0,
            scoreTotal: 0,
            gifCategory: 1,
            isArgument: false,
            insultFlag: false,
            justification: '',
            createdAt: evt.at,
            timestamp: new Date(evt.at).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
            isProcessing: false,
            isScored: false,
            isSystemMessage: true,
          } as Argument;
        });
        const merged = [...formattedArgs, ...systemMessages].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
        );
        setArgumentsList(merged);
      } catch {
        // Fallback : juste les arguments sans les stop events
        setArgumentsList(formattedArgs);
      }

      // Le scroll sera positionné en bas via onContentSizeChange
      needsInitialScrollRef.current = true;

      // ✅ FLOATING TAGS : Afficher les bulles pour le dernier argument scoré non encore vu
      // Reconstruire les tags depuis les champs M3 (pas n8nTags qui ne contient que les tags M1)
      // DEBUG: log all scored args and their tags
      const scoredWithTags = existingArgs
        .filter((arg: any) => {
          if (shownFloatingTagIdsRef.current.has(arg.id)) return false;
          if (arg.scoreTotal <= 0 && arg.status !== 'COMPLETED') return false;
          const rawTags = buildRawTagsFromArgument(arg);
          return rawTags.length > 0;
        });

      if (scoredWithTags.length > 0) {
        // Prendre le dernier argument scoré (le plus récent)
        const lastScored = scoredWithTags[scoredWithTags.length - 1];
        const rawTags = buildRawTagsFromArgument(lastScored);
        const displayTags = mapRawTagsToDisplayTags(rawTags, i18n.language);
        if (displayTags.length > 0) {
          shownFloatingTagIdsRef.current.add(lastScored.id);
          const isMine = lastScored.userId === user?.id;
          // Petit délai pour laisser le temps au rendu de la liste
          setTimeout(() => {
            setFloatingDirection(isMine ? 'up' : 'down');
            setFloatingTags(displayTags);
            setShowFloatingTags(true);
            setTimeout(() => setShowFloatingTags(false), 5000);
          }, 800);
        }
      }
    } catch (error) {
      console.error('Erreur lors du chargement des arguments:', error);
      setArgumentsList([]);
    }
  };

  // ✅ ASYNC : Formater le temps restant (HH:MM)
  const formatTimeRemaining = (milliseconds: number): string => {
    const hours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
  };

  // Envoi d'un argument
  const sendArgument = async () => {
    const currentText = textRef.current;
    if (!currentText.trim() || !user) return;
    trigger('message-sent');

    // ✅ ASYNC : Vérifier que c'est notre tour
    if (!isMyTurn) {
      Alert.alert(t('debates.async.screen.notYourTurnTitle'), t('debates.async.screen.notYourTurnBody'));
      return;
    }

    // ✅ ASYNC : Vérifier la limite de messages
    if (messagesUsed >= maxMessages) {
      Alert.alert(t('debates.async.screen.limitReachedTitle'), t('debates.async.screen.limitReachedBody', { max: maxMessages }));
      return;
    }

    // ✅ CORRECTION : Bloquer immédiatement l'envoi après avoir appuyé sur le bouton
    setHasJustSentMessage(true);
    // Stop typing indicator on send
    ArgumentsService.emitOpponentActivity(debate.id, user.id, 'typing', 'stop');

    try {
      // Créer l'argument temporaire pour l'affichage immédiat
      const tempId = Date.now().toString();
      const tempArgument: Argument = {
        id: tempId,
        debateId: debate.id,
        userId: user.id,
        turnIndex: argumentsList.length + 1,
        userName: user.username || t('debates.live.you'),
        rawText: currentText,
        cleanText: currentText,
        repetition: false,
        factChecked: false,
        reliability: 0,
        impact: 0,
        scoreTotal: 0,
        gifCategory: 1,
        isArgument: true,
        insultFlag: false,
        justification: '',
        createdAt: new Date().toISOString(),
        timestamp: new Date().toLocaleTimeString('fr-FR', {
          hour: '2-digit',
          minute: '2-digit'
        }),
        isProcessing: true,
        isScored: false,
      };

      // Afficher immédiatement dans l'UI
      setArgumentsList(prev => [...prev, tempArgument]);
      inputRef.current?.setNativeProps({ text: '' });
      textRef.current = '';
      setInputText('');
      setIsTyping(false);

      // Scroll vers le bas
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

      // Envoyer à l'API
      const sentArgument = await ArgumentsService.sendArgument({
        debateId: debate.id,
        userId: user.id,
        rawText: currentText,
        factCheckEnabled: true,
      });

      console.log('✅ Argument envoyé avec succès:', sentArgument.id);

      // ✅ NOTIFICATIONS : Afficher le modal 1s après l'envoi si pas encore activées
      if (!notificationsEnabled) {
        AsyncStorage.getItem(NOTIFICATION_PERMISSION_ASKED_KEY).then((alreadyAsked) => {
          if (!alreadyAsked) {
            setTimeout(() => {
              setShowNotificationModal(true);
            }, 1000);
          }
        });
      }

      // ✅ STREAK : Mettre à jour la série (le backend gère la logique "une seule fois par jour")
      updateStreak().then((newStreak) => {
        if (newStreak !== null) {
          console.log('🔥 Streak mis à jour:', newStreak);
        }
      }).catch((err) => {
        console.warn('⚠️ Erreur mise à jour streak (non bloquant):', err);
      });

      // ✅ ASYNC : Marquer que le guest a envoyé un argument (pour éviter releaseJoin)
      if (isCurrentUserGuest) {
        hasGuestSentArgumentRef.current = true;
        // ✅ Le débat passe à 'active' après le premier argument
        debateStatusRef.current = 'active';
        console.log('✅ [AsyncDebateScreen] Débat passé à active après premier argument');
      }

      // Remplacer l'argument temporaire par l'argument réel de l'API
      // Le backend retourne les données M1 si elles ont été traitées de manière synchrone.
      // Si argument_ready (WS) a déjà mis à jour l'argument, on ne touche à rien.
      const m1Done = sentArgument.isProcessing === false;
      setArgumentsList(prev => {
        const alreadyProcessed = prev.some(a => a.id === sentArgument.id && a.isReformulated);
        if (alreadyProcessed) return prev; // argument_ready a déjà fait le travail

        return prev.map(arg =>
          (arg.id === tempId || arg.id === sentArgument.id)
            ? {
                ...arg,
                id: sentArgument.id,
                debateId: sentArgument.debateId,
                turnIndex: sentArgument.turnIndex,
                createdAt: sentArgument.createdAt,
                timestamp: new Date(sentArgument.createdAt).toLocaleTimeString('fr-FR', {
                  hour: '2-digit',
                  minute: '2-digit'
                }),
                // ✅ FIX: Utiliser les données M1 de la réponse HTTP si disponibles
                ...(m1Done && sentArgument.cleanText ? {
                  cleanText: sentArgument.cleanText,
                  isProcessing: false,
                  isReformulated: true,
                  needsFactcheck: sentArgument.n8nNeedsFactcheck ?? sentArgument.needsFactcheck ?? false,
                } : {}),
              }
            : arg
        );
      });

    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de l\'argument:', error);

      // ✅ CORRECTION : Réactiver la saisie en cas d'erreur d'envoi
      setHasJustSentMessage(false);

      // Retirer l'argument temporaire en cas d'erreur
      setArgumentsList(prev => prev.filter(arg => !arg.isProcessing));

      Alert.alert(
        t('debates.live.sendErrorTitle'),
        t('debates.live.sendErrorBody'),
        [{ text: t('common.ok') }]
      );
    }
  };

  // ✅ ASYNC : Proposer l'arrêt du débat
  const handleProposeStop = async () => {
    trigger('button-tap');
    if (isProposingStop) {
      console.log('🚫 Proposition déjà en cours, ignorée');
      return;
    }

    setIsProposingStop(true);
    trigger('button-confirm');

    try {
      await DebatesService.proposeStop(debate.id);
      console.log('🤝 Proposition d\'arrêt envoyée avec succès');
      setHasProposedThisTurn(true);
      // Le message système sera ajouté par le handler WebSocket onDebateEndProposed
      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 200);
    } catch (error) {
      console.error('❌ Erreur lors de la proposition d\'arrêt:', error);
      trigger('button-error');
      Alert.alert(t('debates.async.screen.proposalErrorTitle'), t('debates.async.screen.proposalErrorBody'));
    } finally {
      setIsProposingStop(false);
    }
  };

  // ✅ ASYNC : Abandonner (forfait)
  const handleForfeit = async () => {
    trigger('button-tap');
    Alert.alert(
      t('debates.async.screen.forfeitTitle'),
      t('debates.async.screen.forfeitBody'),
      [
        { text: t('debates.async.screen.forfeitCancel'), style: 'cancel' },
        {
          text: t('debates.async.screen.forfeitConfirm'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDebateEnded(true);

              await DebatesService.forfeit(debate.id);
              console.log('✅ Débat abandonné avec succès');

              // ✅ CORRIGÉ : Naviguer vers RecapA au lieu de goBack()
              navigateToRecap('Utilisateur a abandonné');
            } catch (error) {
              console.error('❌ Erreur lors de l\'abandon du débat:', error);

              // En cas d'erreur, quand même rediriger vers RecapA
              navigateToRecap('Utilisateur a abandonné (erreur)');
            }
          },
        },
      ]
    );
  };

  // Retour au menu principal
  const handleBackToMenu = () => {
    trigger('button-tap');
    console.log('🏠 handleBackToMenu appelé');

    // ✅ Si le guest n'a pas encore envoyé d'argument, libérer le débat (fire and forget)
    // IMPORTANT: Utiliser les refs pour éviter les stale closures
    const shouldRelease =
      isCurrentUserGuestRef.current &&
      !hasGuestSentArgumentRef.current &&
      !hasReleasedJoinRef.current &&
      debateStatusRef.current === 'reserved';

    console.log('🔍 [handleBackToMenu] État:', {
      isCurrentUserGuest: isCurrentUserGuestRef.current,
      hasGuestSentArgument: hasGuestSentArgumentRef.current,
      hasReleasedJoin: hasReleasedJoinRef.current,
      debateStatus: debateStatusRef.current,
      shouldRelease
    });

    if (shouldRelease) {
      console.log('🔓 Libération du débat (guest n\'a pas encore joué)');
      hasReleasedJoinRef.current = true; // Éviter double appel au démontage
      // Fire and forget - on n'attend pas la réponse
      DebatesService.releaseJoin(debateIdRef.current)
        .then(() => console.log('✅ Débat libéré avec succès'))
        .catch((error) => console.error('❌ Erreur libération:', error));
    }

    // Navigation immédiate - ne pas attendre releaseJoin
    console.log('🚀 Navigation vers Home');
    navigation.reset({
      index: 0,
      routes: [{ name: 'Home' }],
    });
  };

  // Quitter la partie (abandonner définitivement)
  const handleQuitDebate = () => {
    trigger('button-tap');
    Alert.alert(
      t('debates.live.endConfirmTitle'),
      t('debates.live.endConfirmBody'),
      [
        { text: t('debates.live.cancel'), style: 'cancel' },
        {
          text: t('debates.live.quit'),
          style: 'destructive',
          onPress: async () => {
            try {
              setIsDebateEnded(true);

              await ArgumentsService.quitDebate(debate.id, user?.id);
              console.log('✅ Débat quitté avec succès');

              navigateToRecap('Utilisateur a quitté');
            } catch (error) {
              console.error('❌ Erreur lors de la sortie du débat:', error);

              navigateToRecap('Utilisateur a quitté (erreur)');
            }
          }
        },
      ]
    );
  };

  // ✅ NOUVEAU : Accepter une proposition d'arrêt
  const handleAcceptProposal = async () => {
    trigger('button-tap');
    try {
      await DebatesService.acceptStop(debate.id);
      console.log('✅ Proposition acceptée - fin du débat');
      trigger('button-success');
      setIsDebateEnded(true);
      setShowProposalBubble(false);

      // ✅ CORRECTION : Celui qui accepte va DIRECTEMENT vers RecapA
      // L'événement Socket.IO 'debate_ended' sera géré différemment pour l'adversaire
      navigateToRecap('Proposition acceptée', true);
    } catch (error) {
      console.error('❌ Erreur lors de l\'acceptation:', error);
      trigger('button-error');
      Alert.alert(
        t('debates.async.screen.proposalErrorTitle'),
        t('debates.async.screen.proposalAcceptError'),
        [{ text: t('common.ok') }]
      );
    }
  };

  // ✅ NOUVEAU : Refuser une proposition d'arrêt
  const handleRefuseProposal = async () => {
    trigger('button-tap');
    try {
      await DebatesService.refuseStop(debate.id);
      console.log('❌ Proposition refusée');
      setShowProposalBubble(false);
      setCurrentProposal(null);
    } catch (error) {
      console.error('❌ Erreur lors du refus:', error);
      trigger('button-error');
      Alert.alert(
        t('debates.async.screen.proposalErrorTitle'),
        t('debates.async.screen.proposalRefuseError'),
        [{ text: t('common.ok') }]
      );
    }
  };

  // ✅ FONCTIONS pour les couleurs de la barre de progression et du compteur
  const getProgressBarColor = (length: number): string => {
    if (length < 390) return COLORS.GREY_MEDIUM + '40';
    if (length < 520) return COLORS.YELLOW_CORE + '60';
    if (length < 585) return '#ff9800';
    return '#f44336';
  };

  const getCharacterCounterColor = (length: number): string => {
    if (length < 520) return COLORS.GREY_MEDIUM;
    if (length < 585) return '#ff9800';
    return '#f44336';
  };

  // ✅ NOUVEAU : Animation de chargement rotatif (roulette)
  const LoadingSpinner = ({ isCurrentUser, size = 14, color }: { isCurrentUser: boolean; size?: number; color?: string }) => {
    const spinAnimation = useRef(new Animated.Value(0)).current;

    React.useEffect(() => {
      const spinLoop = Animated.loop(
        Animated.timing(spinAnimation, {
          toValue: 1,
          duration: 1000,
          useNativeDriver: true,
        })
      );

      spinLoop.start();

      return () => {
        spinLoop.stop();
      };
    }, []);

    const spin = spinAnimation.interpolate({
      inputRange: [0, 1],
      outputRange: ['0deg', '360deg'],
    });

    return (
      <Animated.View
        style={[
          styles.loadingSpinner,
          {
            width: size,
            height: size,
            transform: [{ rotate: spin }],
          },
        ]}
      >
        <Text style={[
          styles.spinnerIcon,
          {
            fontSize: size,
            color: color || (isCurrentUser ? COLORS.INK : COLORS.PAPER_IVORY + '80')
          }
        ]}>
          ⟳
        </Text>
      </Animated.View>
    );
  };

  // ✅ NOUVEAU : Animation de pulsation pour l'enregistrement
  const recordingPulse = useRef(new Animated.Value(1)).current;
  const [recordingElapsed, setRecordingElapsed] = useState(0);
  const warningOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (voiceState === 'recording') {
      const pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(recordingPulse, {
            toValue: 1.15,
            duration: 800,
            useNativeDriver: true,
          }),
          Animated.timing(recordingPulse, {
            toValue: 1,
            duration: 800,
            useNativeDriver: true,
          }),
        ])
      );
      pulseAnimation.start();

      // Timer: track recording elapsed seconds
      setRecordingElapsed(0);
      const timer = setInterval(() => {
        setRecordingElapsed(prev => prev + 1);
      }, 1000);

      // Heartbeat: ré-émettre speaking:start toutes les 5s pour maintenir l'indicateur
      const heartbeat = setInterval(() => {
        ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'speaking', 'start');
      }, 5000);

      return () => {
        pulseAnimation.stop();
        recordingPulse.setValue(1);
        clearInterval(heartbeat);
        clearInterval(timer);
        setRecordingElapsed(0);
      };
    } else {
      recordingPulse.setValue(1);
    }
  }, [voiceState, recordingPulse]);

  // Warning blink animation when recording exceeds 20s
  useEffect(() => {
    if (voiceState === 'recording' && recordingElapsed >= 20) {
      const blinkAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(warningOpacity, { toValue: 0.3, duration: 600, useNativeDriver: true }),
          Animated.timing(warningOpacity, { toValue: 1, duration: 600, useNativeDriver: true }),
        ])
      );
      blinkAnimation.start();
      return () => {
        blinkAnimation.stop();
        warningOpacity.setValue(1);
      };
    } else {
      warningOpacity.setValue(1);
    }
  }, [voiceState, recordingElapsed >= 20]);

  // ✅ Déterminer si le bouton micro doit être visible
  const isMicroButtonVisible = inputText.length === 0 && isMyTurn && voiceState === 'idle';

  const getInputPlaceholder = (): string => {
    // États de transcription - Affichage vide pour laisser place à l'animation visuelle
    if (voiceState === 'recording' || voiceState === 'transcribing') {
      return '';
    }

    // ✅ ASYNC : Placeholder basé sur le tour
    if (isMyTurn) {
      if (messagesUsed >= maxMessages) {
        return t('debates.async.screen.placeholderLimit');
      }
      return t('debates.async.screen.placeholderType');
    } else {
      return t('debates.async.screen.placeholderWait');
    }
  };

  // Rendu d'un argument
  const renderArgument = (argument: Argument, index: number) => {
    const isCurrentUser = argument.userId === user?.id;
    const isSystemMessage = argument.isSystemMessage;

    // ✅ MESSAGES SYSTÈME (logs) avec style différent
    if (isSystemMessage) {
      return (
        <View key={argument.id || `system-${index}`} style={styles.systemMessageContainer}>
          <Text style={styles.systemMessageText}>{argument.cleanText}</Text>
        </View>
      );
    }

    // ✅ NOUVEAU : Affichage spécial pour les arguments en cours de traitement initial
    if (argument.isProcessing && !argument.isReformulated && (!argument.cleanText || argument.cleanText === argument.rawText)) {
      return (
        <View key={argument.id || `processing-${index}`} style={[
          styles.argumentContainer,
          isCurrentUser ? styles.argumentRight : styles.argumentLeft
        ]}>
          <View style={styles.loadingMessageContainer}>
            <View style={styles.loadingIconContainer}>
              <LoadingSpinner isCurrentUser={isCurrentUser} size={24} color={COLORS.PAPER_IVORY} />
            </View>
            <Text style={[
              styles.loadingStatusText,
              styles.loadingStatusTextOpponent
            ]}>
              {t('debates.async.screen.statusSending')}
            </Text>
            <Text style={[
              styles.timestampNew,
              styles.timestampOpponentNew
            ]}>
              {argument.timestamp}
            </Text>
          </View>
        </View>
      );
    }

    // Callback quand l'animation de révélation est terminée → déclencher les floating tags
    const handleRevealComplete = () => {
      const pending = pendingFloatingTagsRef.current.get(argument.id);
      if (pending) {
        pendingFloatingTagsRef.current.delete(argument.id);
        setFloatingDirection(pending.direction);
        setFloatingTags(pending.tags);
        setShowFloatingTags(true);
        setTimeout(() => setShowFloatingTags(false), 5000);
      }
    };

    // Déterminer si la bulle est en cours d'analyse (M1 terminé mais pas M3)
    const isBubbleAnalyzing = !!(argument.isReformulated && !argument.isCompleted);

    return (
      <View key={argument.id || `argument-${index}`} style={[
        styles.argumentContainer,
        isCurrentUser ? styles.argumentRight : styles.argumentLeft
      ]}>
        <AnimatedBubble
          isCurrentUser={isCurrentUser}
          isAnalyzing={isBubbleAnalyzing}
          isCompleted={!!(argument.isCompleted && argument.isScored)}
          isRejected={!!argument.isRejected}
          isDebateEnded={isDebateEnded}
          scoreTotal={argument.scoreTotal || 0}
          needsFactcheck={argument.needsFactcheck ?? false}
          onRevealComplete={handleRevealComplete}
          onFlash={() => trigger('score-reveal')}
        >
          {(analysisStatus) => (
            <>
              {/* Texte principal — rejeté : sender voit son texte barré, adversaire voit juste le rejet */}
              {argument.isRejected ? (
                isCurrentUser ? (
                  <>
                    <Text style={[
                      styles.messageTextNew,
                      isCurrentUser ? styles.currentUserTextNew : styles.opponentTextNew,
                      { textDecorationLine: 'line-through', opacity: 0.5 },
                    ]}>
                      {argument.cleanText || argument.rawText}
                    </Text>
                    <Text style={[
                      styles.messageTextNew,
                      { color: '#EF4444', fontSize: 12, fontStyle: 'italic', marginTop: 4 },
                    ]}>
                      {argument.rejectionReason || t('debates.async.screen.rejectedByModeration')}
                    </Text>
                  </>
                ) : (
                  <>
                    <Text style={[
                      styles.messageTextNew,
                      { color: '#EF4444', fontStyle: 'italic' },
                    ]}>
                      {t('debates.async.screen.rejectedByModeration')}
                    </Text>
                    {argument.rejectionReason ? (
                      <Text style={[
                        styles.messageTextNew,
                        { color: '#EF4444', fontSize: 12, fontStyle: 'italic', marginTop: 4, opacity: 0.8 },
                      ]}>
                        {argument.rejectionReason}
                      </Text>
                    ) : null}
                  </>
                )
              ) : (
                <Text style={[
                  styles.messageTextNew,
                  isCurrentUser ? styles.currentUserTextNew : styles.opponentTextNew
                ]}>
                  {argument.cleanText}
                </Text>
              )}

              {/* Footer avec timestamp + statut d'analyse */}
              <View style={styles.messageFooterNew}>
                <Text style={[
                  styles.timestampNew,
                  isCurrentUser ? styles.timestampCurrentUserNew : styles.timestampOpponentNew
                ]}>
                  {argument.timestamp}
                </Text>
                {analysisStatus && (
                  <Text style={[
                    styles.analysisStatusInline,
                    isCurrentUser ? styles.analysisStatusInlineUser : styles.analysisStatusInlineOpponent,
                  ]}>
                    {analysisStatus.emoji} {analysisStatus.text}
                  </Text>
                )}
              </View>
            </>
          )}
        </AnimatedBubble>
      </View>
    );
  };

  // ✅ NOUVEAU : Composant pour les points animés (clignotement jaune → transparent)
  // Pattern : points à droite = jaune statique, point courant = clignote, points à gauche = disparus
  const AnimatedDot: React.FC<{
    index: number;
    currentAttempt: number;
    isError: boolean;
  }> = ({ index, currentAttempt, isError }) => {
    const opacityAnim = useRef(new Animated.Value(1)).current;

    const isDisappeared = index < currentAttempt;  // Points déjà passés (à gauche)
    const isCurrent = index === currentAttempt;     // Point qui clignote

    useEffect(() => {
      if (isCurrent && !isError) {
        // Animation de clignotement (opacité 1 → 0 → 1)
        const blink = Animated.loop(
          Animated.sequence([
            Animated.timing(opacityAnim, {
              toValue: 0,
              duration: 500,
              useNativeDriver: true,
            }),
            Animated.timing(opacityAnim, {
              toValue: 1,
              duration: 500,
              useNativeDriver: true,
            }),
          ])
        );
        blink.start();
        return () => blink.stop();
      } else {
        opacityAnim.setValue(1);
      }
    }, [isCurrent, isError]);

    // Points disparus = invisible
    if (isDisappeared) {
      return (
        <View
          style={{
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: 'transparent',
          }}
        />
      );
    }

    // Point courant ou en attente = jaune (avec animation pour le courant)
    return (
      <Animated.View
        style={[
          {
            width: 10,
            height: 10,
            borderRadius: 5,
            backgroundColor: isError ? '#FF6B6B' : COLORS.YELLOW_CORE,
          },
          { opacity: isCurrent ? opacityAnim : 1 },
        ]}
      />
    );
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: COLORS.NIGHT_BLUE }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      enabled={!showNotepad}
    >
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* AnimatedBackground */}
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      {/* Layout global avec sidebar sur toute la hauteur */}
      <View style={styles.globalLayout}>
        {/* Sidebar gauche sur toute la hauteur */}
        <View style={styles.fullHeightSidebar}>
          {/* Adversaire en haut */}
          <View style={styles.opponentSection}>
            <View style={styles.opponentAvatarContainer}>
              <Image
                source={getAvatarSource(opponent.selectedAvatarId)}
                style={styles.opponentAvatar}
              />
            </View>
          </View>

          {/* Notepad button */}
          <IconButton
            type="action"
            icon={<Ionicons name="document-text-outline" size={22} />}
            onPress={() => {
              setShowNotepad(true);
              setHasNoteContent(true);
            }}
            size={43}
            backgroundColor={COLORS.surface}
          />

          {/* Joueur actuel en bas */}
          <View style={styles.playerSection}>
            <View style={styles.playerAvatarContainer}>
              <Image
                source={getAvatarSource(user?.selectedAvatarId)}
                style={styles.playerAvatar}
              />
            </View>
          </View>
        </View>

        {/* Partie droite avec header et chat */}
        <View style={styles.rightSection}>
          {/* Header avec statut du tour */}
          <View style={styles.headerWithGradient}>
            <View style={styles.header}>
              <View style={styles.opponentHeader}>
                <View style={styles.opponentInfo}>
                  <Text style={styles.opponentName}>{opponent.username}</Text>
                  <Text style={styles.opponentOpinion} numberOfLines={2}>
                    {opponent.opinion}
                  </Text>
                </View>
              </View>
            </View>
          </View>

          {/* Zone de chat + overlay floating tags */}
          <View style={{ flex: 1 }}>
            <ScrollView
              ref={scrollViewRef}
              style={[styles.messagesContainer, !isScrollReady && { opacity: 0 }]}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={() => {
                if (needsInitialScrollRef.current && argumentsList.length > 0) {
                  needsInitialScrollRef.current = false;
                  scrollViewRef.current?.scrollToEnd({ animated: false });
                  // Deuxième scroll après layout complet, puis révéler
                  setTimeout(() => {
                    scrollViewRef.current?.scrollToEnd({ animated: false });
                    requestAnimationFrame(() => setIsScrollReady(true));
                  }, 50);
                }
              }}
            >
              {/* ✅ ASYNC : Avertissement 5 min pour le guest qui n'a pas encore envoyé d'argument */}
              {isCurrentUserGuest && debate.status === 'reserved' && messagesUsed === 0 && (
                <View style={styles.fiveMinWarningContainer}>
                  <Ionicons name="time-outline" size={14} color={COLORS.GREY_MEDIUM} />
                  <Text style={styles.fiveMinWarningText}>
                    {t('debates.async.screen.fiveMinWarning')}
                  </Text>
                </View>
              )}
              {argumentsList.map((argument, index) => renderArgument(argument, index))}

              {/* Indicateur adversaire typing/speaking */}
              {opponentActivity && (
                <View style={styles.opponentActivityContainer}>
                  <Text style={styles.opponentActivityText}>
                    {opponentActivity === 'typing'
                      ? `${opponent.username} ${t('debates.async.screen.isTyping')}`
                      : `${opponent.username} ${t('debates.async.screen.isSpeaking')}`}
                  </Text>
                  <View style={styles.opponentActivityDots}>
                    {opponentActivity === 'typing' ? (
                      <>
                        <Text style={styles.opponentActivityDot}>.</Text>
                        <Text style={styles.opponentActivityDot}>.</Text>
                        <Text style={styles.opponentActivityDot}>.</Text>
                      </>
                    ) : (
                      <Ionicons name="mic" size={14} color={COLORS.GREY_MEDIUM} />
                    )}
                  </View>
                </View>
              )}
            </ScrollView>

            {/* ✅ FLOATING TAGS OVERLAY */}
            <FloatingTagsOverlay tags={floatingTags} visible={showFloatingTags} direction={floatingDirection} />
          </View>
        </View>
      </View>

      {/* Barre de progression */}
      {inputText.length > 0 && (
        <View style={styles.characterIndicatorContainer}>
          <View style={styles.progressBarContainer}>
            <View
              style={[
                styles.progressBar,
                {
                  width: `${Math.min((inputText.length / 650) * 100, 100)}%`,
                  backgroundColor: getProgressBarColor(inputText.length),
                }
              ]}
            />
          </View>
        </View>
      )}

      {/* Zone de saisie */}
      <View style={[styles.fullWidthInputContainer, keyboardVisible && { paddingBottom: 12 }]}>
          {/* Menu déroulant */}
          <IconButton
            type="action"
            icon={<Ionicons name="ellipsis-horizontal" size={22} />}
            onPress={() => setShowMenu(true)}
            size={43}
            backgroundColor={COLORS.surface}
          />

          {/* Conteneur input avec bouton micro intégré */}
          <View style={styles.inputWithMicroContainer}>
            <TextInput
              ref={inputRef}
              style={[
                styles.textInput,
                isMicroButtonVisible && styles.textInputWithMicroPadding
              ]}
              placeholder={getInputPlaceholder()}
              placeholderTextColor={COLORS.GREY_MEDIUM}
              onChangeText={(text) => {
                // Anti-paste: reject if too many characters added at once (allow autocomplete up to 15)
                if (text.length - textRef.current.length > 15) {
                  inputRef.current?.setNativeProps({ text: textRef.current });
                  return;
                }
                textRef.current = text;
                setInputText(text);
                setIsTyping(text.length > 0);

                // Emit typing indicator (debounced — only emit start every 2s)
                if (text.length > 0 && !typingEmitTimerRef.current) {
                  ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'typing', 'start');
                  typingEmitTimerRef.current = setTimeout(() => {
                    typingEmitTimerRef.current = null;
                  }, 2000);
                }
                if (text.length === 0) {
                  ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'typing', 'stop');
                }
              }}
              multiline
              maxLength={650}
              editable={isMyTurn && voiceState === 'idle' && !hasJustSentMessage}
              contextMenuHidden={true}
            />

            {/* Affichage animé pendant l'enregistrement */}
            {voiceState === 'recording' && (
              <View style={styles.recordingAnimationOverlay}>
                {recordingElapsed < 20 ? (
                  <>
                    <Animated.View style={[
                      styles.recordingIconContainer,
                      { transform: [{ scale: recordingPulse }] }
                    ]}>
                      <View style={styles.recordingDot} />
                    </Animated.View>
                    <Text style={styles.recordingText}>{t('debates.async.screen.recordingLabel')}</Text>
                  </>
                ) : (
                  <Animated.Text style={[styles.recordingWarningText, { opacity: warningOpacity, color: recordingElapsed >= 30 ? '#f44336' : '#ff9800' }]}>
                    {t('debates.async.screen.recordingCharLimit')}
                  </Animated.Text>
                )}
              </View>
            )}

            {/* Affichage animé pendant la transcription */}
            {voiceState === 'transcribing' && (
              <View style={styles.recordingAnimationOverlay}>
                <LoadingSpinner isCurrentUser={true} size={20} color={COLORS.YELLOW_CORE} />
                <Text style={styles.recordingText}>{t('debates.async.screen.transcribingLabel')}</Text>
              </View>
            )}

            {/* Bouton micro */}
            {isMicroButtonVisible && (
              <TouchableOpacity
                style={styles.microButtonContainer}
                onPress={async () => {
                  trigger('button-tap');
                  console.log('🎤 Début enregistrement débat');
                  // Émettre speaking:start AVANT le await (permission micro peut bloquer)
                  ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'speaking', 'start');
                  console.log('🎤 Émission opponent_activity speaking:start');
                  const success = await startRecording();
                  if (success) {
                    trigger('transcription-start');
                    setVoiceState('recording');
                  } else {
                    // Si l'enregistrement échoue, annuler l'indicateur
                    ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'speaking', 'stop');
                  }
                }}
              >
                <Ionicons
                  name="mic-outline"
                  size={24}
                  color={COLORS.YELLOW_CORE}
                />
              </TouchableOpacity>
            )}

            {/* Boutons pendant l'enregistrement */}
            {voiceState === 'recording' && (
              <View style={styles.recordingButtonsContainer}>
                <TouchableOpacity
                  style={[styles.recordingButton, styles.cancelButton]}
                  onPress={async () => {
                    trigger('button-tap');
                    console.log('❌ Annulation enregistrement débat');
                    await cancelRecording();
                    setVoiceState('idle');
                    ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'speaking', 'stop');
                  }}
                >
                  <Ionicons name="close" size={16} color={COLORS.PAPER_IVORY} />
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.recordingButton, styles.validateButton]}
                  onPress={async () => {
                    trigger('button-tap');
                    console.log('✅ Validation enregistrement débat - début transcription');
                    setVoiceState('transcribing');
                    ArgumentsService.emitOpponentActivity(debate.id, user?.id || '', 'speaking', 'stop');

                    try {
                      const audioUri = await stopRecording();

                      if (!audioUri) {
                        trigger('button-error');
                        Alert.alert(t('debates.async.screen.proposalErrorTitle'), t('debates.async.screen.recordingError'));
                        setVoiceState('idle');
                        return;
                      }

                      const result = await TranscriptionService.transcribeAudio(
                        audioUri,
                        user?.token || '',
                        `recording_${Date.now()}.m4a`
                      );

                      const truncated = result.text.slice(0, 650);
                      console.log('✅ Transcription débat réussie:', truncated.length, '/', result.text.length, 'chars');
                      trigger('transcription-received');
                      inputRef.current?.setNativeProps({ text: truncated });
                      textRef.current = truncated;
                      setInputText(truncated);

                    } catch (error) {
                      console.error('❌ Erreur de transcription débat:', error);
                      trigger('button-error');
                      Alert.alert(t('debates.async.screen.transcriptionError'), error instanceof Error ? error.message : t('debates.async.screen.transcriptionError'));
                    } finally {
                      setVoiceState('idle');
                    }
                  }}
                >
                  <Ionicons name="checkmark" size={16} color={COLORS.PAPER_IVORY} />
                </TouchableOpacity>
              </View>
            )}

          </View>

          {/* Bouton d'envoi */}
          <IconButton
            type="action"
            icon={<Ionicons name="arrow-forward" size={24} />}
            onPress={sendArgument}
            size={43}
            backgroundColor={(!inputText.trim() || !isMyTurn || messagesUsed >= maxMessages) ? COLORS.GREY_MEDIUM + '40' : COLORS.YELLOW_CORE}
            iconColor={COLORS.NIGHT_BLUE}
            iconPressedColor={COLORS.INK}
            disabled={!inputText.trim() || !isMyTurn || messagesUsed >= maxMessages}
          />
      </View>

      {/* Modal du menu */}
      <Modal
        visible={showMenu}
        transparent
        animationType="fade"
        onRequestClose={() => setShowMenu(false)}
      >
        <View style={styles.menuOverlay}>
          <TouchableOpacity
            style={styles.menuOverlayTouchable}
            activeOpacity={1}
            onPress={() => setShowMenu(false)}
          />

          <View style={styles.menuPopup}>
            <Text style={styles.menuTitle}>{t('debates.async.screen.menuOptions')}</Text>
            <Text style={styles.menuDebateTitle} numberOfLines={4}>
              {debate.title}
            </Text>
            <View style={styles.menuUserOpinionContainer}>
              <Text style={styles.menuUserOpinionLabel}>{t('debates.screen.yourOpinion')}</Text>
              <Text style={styles.menuUserOpinion} numberOfLines={2}>
                {isCurrentUserGuest ? debate.guestView : debate.hostView}
              </Text>
            </View>

            {/* Bouton Proposer l'arrêt */}
            {(() => {
              const { userCount, opponentCount } = getArgumentsCount();
              const isDebateNotStarted = isCurrentUserGuest && debate.status === 'reserved';
              const isProposalDisabled = isDebateNotStarted || hasProposedThisTurn;
              return (
                <TouchableOpacity
                  style={[
                    styles.menuButton,
                    styles.proposeEndButton,
                    isProposalDisabled && styles.menuButtonDisabled
                  ]}
                  onPress={() => {
                    if (isProposalDisabled) return;
                    setShowMenu(false);
                    handleProposeStop();
                  }}
                  activeOpacity={isProposalDisabled ? 1 : 0.7}
                >
                  <Text style={[styles.menuButtonIcon, isProposalDisabled && { opacity: 0.4 }]}>🤝</Text>
                  <View style={styles.menuButtonTextContainer}>
                    <Text style={[
                      styles.menuButtonText,
                      styles.proposeEndButtonText,
                      isProposalDisabled && styles.menuButtonTextDisabled
                    ]}>
                      {t('debates.async.screen.menuProposeStop')}
                    </Text>
                    <Text style={[styles.menuButtonSubtext, isProposalDisabled && { opacity: 0.4 }]}>
                      {isDebateNotStarted
                        ? t('debates.async.screen.sendFirstMessage')
                        : hasProposedThisTurn
                          ? t('debates.async.screen.proposalOncePerTurn')
                          : t('debates.async.screen.messagesCount', { user: userCount, opponent: opponentCount })}
                    </Text>
                  </View>
                </TouchableOpacity>
              );
            })()}

            {/* Bouton Abandonner */}
            {(() => {
              // ✅ Désactivé si le guest n'a pas encore envoyé son premier argument
              const isDebateNotStarted = isCurrentUserGuest && debate.status === 'reserved';
              return (
                <TouchableOpacity
                  style={[
                    styles.menuButton,
                    styles.quitButton,
                    isDebateNotStarted && styles.menuButtonDisabled
                  ]}
                  onPress={() => {
                    if (isDebateNotStarted) return;
                    setShowMenu(false);
                    handleForfeit();
                  }}
                  activeOpacity={isDebateNotStarted ? 1 : 0.7}
                >
                  <Text style={[styles.menuButtonIcon, isDebateNotStarted && { opacity: 0.4 }]}>🏳️</Text>
                  <View style={styles.menuButtonTextContainer}>
                    <Text style={[
                      styles.menuButtonText,
                      styles.quitButtonText,
                      isDebateNotStarted && styles.menuButtonTextDisabled
                    ]}>
                      {t('debates.async.screen.menuForfeit')}
                    </Text>
                    {isDebateNotStarted && (
                      <Text style={[styles.menuButtonSubtext, { opacity: 0.4 }]}>
                        {t('debates.async.screen.sendFirstMessage')}
                      </Text>
                    )}
                  </View>
                </TouchableOpacity>
              );
            })()}

            {/* Bouton Menu principal */}
            <TouchableOpacity
              style={[styles.menuButton, styles.mainMenuButton]}
              onPress={() => {
                setShowMenu(false);
                // Délai pour laisser le Modal se fermer avant de naviguer
                setTimeout(() => handleBackToMenu(), 300);
              }}
              activeOpacity={0.7}
            >
              <Text style={styles.menuButtonIcon}>🏠</Text>
              <View style={styles.menuButtonTextContainer}>
                <Text style={[styles.menuButtonText, styles.mainMenuButtonText]}>
                  {t('debates.async.screen.menuHome')}
                </Text>
              </View>
            </TouchableOpacity>

          </View>
        </View>
      </Modal>

      {/* ✅ NOUVEAU : BULLE DE PROPOSITION D'ARRÊT */}
      {showProposalBubble && currentProposal && (() => {
        const { userCount, opponentCount } = getArgumentsCount();
        return (
          <View style={styles.proposalBubbleOverlay}>
            <View style={styles.proposalBubble}>
              <Text style={styles.proposalTitle}>{t('debates.async.screen.proposalTitle')}</Text>
              <Text style={styles.proposalMessage}>
                {t('debates.async.screen.proposalMessage', { username: currentProposal.proposerUsername })}
              </Text>
              {/* Affichage du décompte d'arguments */}
              <Text style={styles.argumentsCountText}>
                {t('debates.async.screen.argumentsCount', { userCount, opponentCount })}
              </Text>
              <View style={styles.proposalButtons}>
                <AnimatedMenuButton
                  style={[styles.proposalButton, styles.refuseButton]}
                  onPress={handleRefuseProposal}
                >
                  <Text style={styles.refuseButtonText}>{t('debates.async.screen.proposalContinue')}</Text>
                </AnimatedMenuButton>
                <AnimatedMenuButton
                  style={[styles.proposalButton, styles.acceptButton]}
                  onPress={handleAcceptProposal}
                >
                  <Text style={styles.acceptButtonText}>{t('debates.async.screen.proposalStop')}</Text>
                </AnimatedMenuButton>
              </View>
            </View>
          </View>
        );
      })()}

      {/* ✅ NOUVEAU : Overlay d'attente d'analyse */}
      {analysisWaitState?.isWaiting && (
        <View style={styles.analysisWaitOverlay}>
          <View style={[
            styles.analysisWaitCard,
            analysisWaitState.severity === 'error' && styles.analysisWaitCardError
          ]}>
            {/* Icône */}
            <View style={styles.analysisSpinnerContainer}>
              <Ionicons
                name={analysisWaitState.severity === 'error' ? 'alert-circle' : 'hourglass-outline'}
                size={40}
                color={analysisWaitState.severity === 'error' ? COLORS.ERROR : COLORS.YELLOW_CORE}
              />
            </View>

            {/* Message principal */}
            <Text style={[
              styles.analysisWaitMessage,
              analysisWaitState.severity === 'error' && styles.analysisWaitMessageError
            ]}>
              {analysisWaitState.message}
            </Text>

            {/* Sous-message */}
            <Text style={styles.analysisWaitSubmessage}>
              {analysisWaitState.submessage}
            </Text>

            {/* Indicateur de progression animé */}
            <View style={styles.attemptIndicator}>
              {[...Array(analysisWaitState.maxAttempts)].map((_, i) => (
                <AnimatedDot
                  key={i}
                  index={i}
                  currentAttempt={analysisWaitState.attempt}
                  isError={analysisWaitState.severity === 'error'}
                />
              ))}
            </View>
          </View>
        </View>
      )}
      {/* ✅ NOTIFICATIONS : Modal de demande après envoi d'argument async */}
      <NotificationPermissionModal
        visible={showNotificationModal}
        onClose={() => setShowNotificationModal(false)}
        onEnable={async () => {
          await AsyncStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
          await requestNotificationPermission();
          setShowNotificationModal(false);
        }}
        onLater={async () => {
          await AsyncStorage.setItem(NOTIFICATION_PERMISSION_ASKED_KEY, 'true');
          setShowNotificationModal(false);
        }}
      />
      <NotepadModal
        visible={showNotepad}
        onClose={() => setShowNotepad(false)}
        debateId={debate.id}
      />
    </SafeAreaView>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.NIGHT_BLUE,
  },
  globalLayout: {
    flex: 1,
    flexDirection: 'row',
    zIndex: 1,
  },
  fullHeightSidebar: {
    width: 70,
    backgroundColor: 'transparent',
    paddingBottom: 10,
    paddingLeft: 8,
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  rightSection: {
    flex: 1,
  },
  headerWithGradient: {
    position: 'relative',
  },
  header: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginHorizontal: 8,
    marginTop: 8,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  opponentHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  opponentInfo: {
    alignItems: 'flex-start',
    flex: 1,
  },
  opponentName: {
    fontSize: 14,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },
  opponentOpinion: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    marginTop: 4,
    textAlign: 'left',
  },
  // ✅ ASYNC : Styles pour les bannières de tour
  turnBanner: {
    backgroundColor: COLORS.YELLOW_CORE + '20',
    paddingVertical: 8,
    paddingHorizontal: 15,
    marginTop: 10,
    borderRadius: 8,
  },
  turnText: {
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.YELLOW_CORE,
    fontWeight: '600',
    textAlign: 'center',
  },
  turnSubtext: {
    fontSize: FONT_SIZES.BODY.SMALL - 2,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.YELLOW_CORE + 'CC',
    marginTop: 2,
    textAlign: 'center',
  },
  waitingBanner: {
    backgroundColor: COLORS.GREY_MEDIUM + '20',
    paddingVertical: 8,
    paddingHorizontal: 15,
    marginTop: 10,
    borderRadius: 8,
  },
  waitingText: {
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.GREY_MEDIUM,
    fontWeight: '600',
    textAlign: 'center',
  },
  waitingSubtext: {
    fontSize: FONT_SIZES.BODY.SMALL - 2,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.GREY_MEDIUM + 'CC',
    marginTop: 2,
    textAlign: 'center',
  },
  playerSection: {
    alignItems: 'center',
  },
  playerAvatarContainer: {
    width: 80,
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
  },
  playerAvatar: {
    width: 85,
    height: 145,
    resizeMode: 'contain',
  },
  opponentSection: {
    alignItems: 'center',
    paddingTop: 10,
  },
  opponentAvatarContainer: {
    width: 80,
    height: 130,
    justifyContent: 'center',
    alignItems: 'center',
  },
  opponentAvatar: {
    width: 85,
    height: 145,
    resizeMode: 'contain',
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 8,
  },
  messagesContent: {
    paddingVertical: 10,
    paddingBottom: 20,
  },
  // ✅ ASYNC : Style pour l'avertissement 5 min
  fiveMinWarningContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    marginHorizontal: 4,
    marginBottom: 8,
    backgroundColor: COLORS.GREY_MEDIUM + '15',
    borderRadius: 6,
    alignSelf: 'center',
    maxWidth: '90%',
  },
  fiveMinWarningText: {
    fontSize: 11,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
    flexShrink: 1,
  },
  argumentContainer: {
    marginVertical: 6,
    maxWidth: '90%',
  },
  argumentRight: {
    alignSelf: 'flex-end',
    alignItems: 'flex-end',
  },
  argumentLeft: {
    alignSelf: 'flex-start',
    alignItems: 'flex-start',
  },
  messageBubbleNew: {
    borderRadius: 20,
    paddingHorizontal: 16,
    paddingVertical: 12,
    maxWidth: '100%',
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  currentUserBubbleNew: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderBottomRightRadius: 4,
  },
  opponentBubbleNew: {
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: 4,
  },
  messageTextNew: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    lineHeight: 19.6,
  },
  currentUserTextNew: {
    color: COLORS.NIGHT_BLUE,
  },
  opponentTextNew: {
    color: COLORS.PAPER_IVORY,
  },
  messageFooterNew: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 6,
    gap: 8,
  },
  timestampNew: {
    fontSize: 10,
    fontFamily: 'Raleway-SemiBold',
  },
  timestampCurrentUserNew: {
    color: COLORS.NIGHT_BLUE + '80',
  },
  timestampOpponentNew: {
    color: COLORS.PAPER_IVORY + '80',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
    gap: 4,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  // Styles pour l'utilisateur (fond jaune)
  statusProcessingUser: {
    backgroundColor: COLORS.YELLOW_CORE + '40',
  },
  statusCompletedUser: {
    backgroundColor: COLORS.YELLOW_CORE + '60',
  },
  statusTextUser: {
    fontSize: 9,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.NIGHT_BLUE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  // Styles pour l'adversaire (fond gris avec texte blanc)
  statusProcessingOpponent: {
    backgroundColor: COLORS.GREY_MEDIUM + '40',
  },
  statusCompletedOpponent: {
    backgroundColor: COLORS.GREY_MEDIUM + '50',
  },
  statusTextOpponent: {
    fontSize: 9,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  loadingMessageContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  loadingIconContainer: {
    width: 24,
    height: 24,
  },
  loadingStatusText: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    flex: 1,
  },
  loadingStatusTextUser: {
    color: COLORS.PAPER_IVORY,
  },
  loadingStatusTextOpponent: {
    color: COLORS.PAPER_IVORY,
  },
  loadingSpinner: {
    justifyContent: 'center',
    alignItems: 'center',
  },
  spinnerIcon: {
    fontWeight: 'bold',
  },
  systemMessageContainer: {
    alignSelf: 'center',
    backgroundColor: COLORS.surface,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    marginVertical: 8,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  systemMessageText: {
    fontSize: 11,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
  },
  characterIndicatorContainer: {
    paddingHorizontal: 16,
    paddingBottom: 4,
  },
  progressBarContainer: {
    height: 3,
    backgroundColor: COLORS.GREY_MEDIUM + '20',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBar: {
    height: '100%',
    borderRadius: 2,
  },
  fullWidthInputContainer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    paddingHorizontal: 15,
    paddingTop: 15,
    paddingBottom: 40,
    backgroundColor: COLORS.NIGHT_BLUE,
    gap: 10,
  },
  threeDotsMenuButton: {
    width: 40,
    height: 40,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  menuIcon: {
    fontSize: 20,
    color: COLORS.YELLOW_CORE,
    fontFamily: 'Raleway-Black',
  },
  inputWithMicroContainer: {
    flex: 1,
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'flex-end',
  },
  textInput: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    paddingHorizontal: 15,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  textInputWithMicroPadding: {
    paddingRight: 55,
  },
  microButtonContainer: {
    position: 'absolute',
    right: 12,
    top: '50%',
    marginTop: -18, // Moitié de la hauteur (36px / 2) pour centrer
    width: 36,
    height: 36,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'transparent',
  },
  recordingAnimationOverlay: {
    position: 'absolute',
    left: 15,
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  recordingIconContainer: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#dc3545',
    justifyContent: 'center',
    alignItems: 'center',
  },
  recordingDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.PAPER_IVORY,
  },
  recordingText: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
  },
  recordingWarningText: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    color: '#ff9800',
  },
  recordingButtonsContainer: {
    position: 'absolute',
    right: 12,
    bottom: 6,
    flexDirection: 'row',
    gap: 8,
  },
  recordingButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 2,
  },
  cancelButton: {
    backgroundColor: COLORS.RED_ERROR,
  },
  validateButton: {
    backgroundColor: COLORS.success,
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.YELLOW_CORE,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  sendButtonDisabled: {
    backgroundColor: COLORS.GREY_MEDIUM + '40',
  },
  sendButtonText: {
    fontSize: 24,
    color: COLORS.NIGHT_BLUE,
    fontFamily: 'Raleway-Black',
  },
  menuOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  menuOverlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  menuPopup: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.INK,
    borderWidth: 3,
    borderRadius: 20,
    paddingVertical: 24,
    paddingHorizontal: 20,
    minWidth: 280,
    maxWidth: '90%',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 10,
    },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 10,
  },
  menuTitle: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 8,
  },
  menuDebateTitle: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    marginBottom: 4,
    textAlign: 'center',
    paddingHorizontal: 8,
  },
  menuUserOpinionContainer: {
    marginTop: 12,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  menuUserOpinionLabel: {
    fontSize: 11,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  menuUserOpinion: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    fontStyle: 'italic',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
  },
  menuButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 15,
    paddingHorizontal: 15,
    borderRadius: 16,
    marginVertical: 6,
    gap: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  menuButtonIcon: {
    fontSize: 24,
  },
  menuButtonTextContainer: {
    flex: 1,
  },
  menuButtonText: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
  },
  menuButtonSubtext: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    marginTop: 2,
  },
  menuButtonDisabled: {
    opacity: 0.5,
  },
  menuButtonTextDisabled: {
    color: COLORS.GREY_MEDIUM,
  },
  proposeEndButton: {
    backgroundColor: COLORS.success + '20',
  },
  proposeEndButtonText: {
    color: COLORS.success,
  },
  quitButton: {
    backgroundColor: COLORS.RED_ERROR + '20',
  },
  quitButtonText: {
    color: COLORS.RED_ERROR,
  },
  mainMenuButton: {
    backgroundColor: COLORS.ROYAL_BLUE + '20',
  },
  mainMenuButtonText: {
    color: COLORS.ROYAL_BLUE,
  },

  // ✅ NOUVEAU : Styles pour la bulle de proposition d'arrêt
  proposalBubbleOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  proposalBubble: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.INK,
    borderWidth: 3,
    borderRadius: 20,
    padding: 24,
    width: '85%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 10,
  },
  proposalTitle: {
    fontSize: 20,
    fontFamily: 'Raleway-Black',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
    marginBottom: 12,
  },
  proposalMessage: {
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 22,
  },
  argumentsCountText: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
    marginBottom: 20,
  },
  proposalButtons: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'space-between',
  },
  proposalButton: {
    flex: 1,
    minHeight: 60,
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginBottom: 20,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  refuseButton: {
    backgroundColor: COLORS.ROYAL_BLUE + '30',
  },
  refuseButtonText: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.ROYAL_BLUE,
  },
  acceptButton: {
    backgroundColor: COLORS.RED_ERROR,
  },
  acceptButtonText: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
  },

  // ✅ NOUVEAU : Styles pour l'overlay d'attente d'analyse
  analysisWaitOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 100,
  },
  analysisWaitCard: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.YELLOW_CORE,
    borderWidth: 3,
    borderRadius: 20,
    padding: 24,
    alignItems: 'center',
    minWidth: 280,
    maxWidth: '85%',
    height: 280,
    justifyContent: 'space-between',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 10,
  },
  analysisWaitCardError: {
    borderColor: COLORS.ERROR || '#FF6B6B',
  },
  analysisSpinnerContainer: {
    marginBottom: 16,
  },
  analysisWaitMessage: {
    fontSize: 18,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 8,
  },
  analysisWaitMessageError: {
    color: COLORS.ERROR || '#FF6B6B',
  },
  analysisWaitSubmessage: {
    fontSize: 14,
    fontFamily: 'Raleway-Regular',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    opacity: 0.8,
    marginBottom: 16,
  },
  attemptIndicator: {
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
    alignSelf: 'center',
  },
  analysisStatusInline: {
    fontSize: 10,
    fontFamily: 'Raleway-SemiBold',
  },
  analysisStatusInlineUser: {
    color: COLORS.NIGHT_BLUE + 'A0',
  },
  analysisStatusInlineOpponent: {
    color: COLORS.PAPER_IVORY + 'A0',
  },
  opponentActivityContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 8,
    marginVertical: 4,
    gap: 4,
  },
  opponentActivityText: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    fontStyle: 'italic',
  },
  opponentActivityDots: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 1,
  },
  opponentActivityDot: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.GREY_MEDIUM,
    lineHeight: 16,
  },
});
