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
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { RootStackScreenProps } from '../../types/navigation';
import { COLORS } from '../../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../../constants/fonts';
import { useAuth } from '../../hooks/useAuth';
import ArgumentsService, { Argument as ArgumentType } from '../../services/arguments.service';
import { API_URL } from '../../constants/api';
import { usePreventRemove } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import { VoiceInputButton } from '../../components/VoiceInputButton';
import { useAudioRecording } from '../../hooks/useAudioRecording';
import { TranscriptionService } from '../../services/transcription.service';
import { Ionicons } from '@expo/vector-icons';
import DebatesService from '../../services/debates.service';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { IconButton } from '../../components/IconButton';
import { useHaptics } from '../../hooks/useHaptics';
import { getAvatarSource } from '../../constants/avatars';
import { FloatingTagsOverlay } from '../../components/FloatingTagsOverlay';
import { FloatingDirection } from '../../components/FloatingTag';
import { mapRawTagsToDisplayTags, DisplayTag } from '../../constants/argumentTags';
import { AnimatedBubble } from '../../components/AnimatedBubble';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotepadModal, getNotepadKey } from '../../components/NotepadModal';


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
  timer: number;
  isActive: boolean;
};

type Props = RootStackScreenProps<'DebateScreen'>;

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

export const DebateScreen: React.FC<Props> = ({ navigation, route }) => {
  const { debate } = route.params;
  const { user } = useAuth();
  const { t, i18n } = useTranslation();
  const { trigger } = useHaptics();

  // États locaux
  const [currentUser, setCurrentUser] = useState<DebateUser>({
    id: 'user1',
    username: t('debates.live.you'),
    opinion: debate.hostView,
    timer: 300,
    isActive: true,
  });

  // 🎯 CALCUL DYNAMIQUE de l'adversaire selon qui je suis
  const opponentData = useMemo(() => {
    const isCurrentUserGuest = user?.id === debate.guestId;

    console.log('🔍 DEBUG ADVERSAIRE:', {
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
      console.log('✅ Je suis INVITÉ → adversaire = HÔTE');
      return {
        id: debate.hostId || 'host-id',
        username: debate.host?.username || t('debates.live.hostFallback'),
        selectedAvatarId: debate.host?.selectedAvatarId,
        opinion: debate.hostView || t('debates.live.hostOpinionFallback'),
        timer: debate.mode * 60,
        isActive: false,
      };
    } else {
      console.log('✅ Je suis HÔTE → adversaire = INVITÉ');
      return {
        id: debate.guestId || 'guest-id',
        username: debate.guest?.username || t('debates.live.guestFallback'),
        selectedAvatarId: debate.guest?.selectedAvatarId,
        opinion: debate.guestView || t('debates.live.guestOpinionFallback'),
        timer: debate.mode * 60,
        isActive: false,
      };
    }
  }, [user?.id, debate]);

  const [opponent, setOpponent] = useState<DebateUser>(opponentData);

  // ✅ SYNC : Mettre à jour opponent quand opponentData change
  useEffect(() => {
    console.log('🔄 Mise à jour de l\'adversaire:', opponentData);
    setOpponent(opponentData);
  }, [opponentData]);

  const [argumentsList, setArgumentsList] = useState<Argument[]>([]);

  const [inputText, setInputText] = useState('');
  const inputRef = useRef<TextInput>(null);
  const textRef = useRef('');
  const [showMenu, setShowMenu] = useState(false);
  const [isTyping, setIsTyping] = useState(false);
  const [hasJustSentMessage, setHasJustSentMessage] = useState(false);

  // Indicateur d'activité adversaire (typing/speaking)
  const [opponentActivity, setOpponentActivity] = useState<'typing' | 'speaking' | null>(null);
  const opponentActivityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // États pour la transcription audio
  const [voiceState, setVoiceState] = useState<'idle' | 'recording' | 'transcribing'>('idle');
  const { startRecording, stopRecording, cancelRecording } = useAudioRecording();

  // États pour la gestion des phases du débat
  const [debatePhase, setDebatePhase] = useState<'introduction' | 'active'>('introduction');
  const [introTimer, setIntroTimer] = useState(10);
  const [isGuestTurn, setIsGuestTurn] = useState(true);
  const [hasGuestStarted, setHasGuestStarted] = useState(false);

  // Déterminer si l'utilisateur actuel est l'invité
  const isCurrentUserGuest = user?.id === debate.guestId;

  // États pour les timers
  const [guestTimer, setGuestTimer] = useState(debate.mode * 60);
  const [hostTimer, setHostTimer] = useState(debate.mode * 60);
  const [activeUserId, setActiveUserId] = useState<string | null>(null);

  // États pour la règle des 3 arguments restants
  const [isInFinalPhase, setIsInFinalPhase] = useState(false);
  const [remainingArguments, setRemainingArguments] = useState(3);
  const [expiredUserId, setExpiredUserId] = useState<string | null>(null);

  // Refs miroirs pour accéder aux valeurs à jour dans les callbacks socket (évite les closures stale)
  const isInFinalPhaseRef = useRef(false);
  const isDebateEndedRef = useRef(false);
  const remainingArgumentsRef = useRef(3);
  const expiredUserIdRef = useRef<string | null>(null);

  // États pour les propositions d'arrêt
  const [propositionsSent, setPropositionsSent] = useState(0);
  const [showNotification, setShowNotification] = useState(false);
  const [notificationMessage, setNotificationMessage] = useState('');
  const [showProposalBubble, setShowProposalBubble] = useState(false);
  const [currentProposal, setCurrentProposal] = useState<{proposerUsername: string} | null>(null);

  // Protection contre le redémarrage de timers après la fin du débat
  const [isDebateEnded, setIsDebateEnded] = useState(false);
  const [hasNavigatedToRecap, setHasNavigatedToRecap] = useState(false);

  // ✅ FLOATING TAGS : Bulles flottantes après scoring
  const [floatingTags, setFloatingTags] = useState<DisplayTag[]>([]);
  const [showFloatingTags, setShowFloatingTags] = useState(false);
  const [floatingDirection, setFloatingDirection] = useState<FloatingDirection>('up');
  const pendingFloatingTagsRef = useRef<Map<string, { tags: DisplayTag[]; direction: FloatingDirection }>>(new Map());

  // ✅ NOUVEAU : État pour l'overlay d'attente d'analyse
  const [analysisWaitState, setAnalysisWaitState] = useState<{
    isWaiting: boolean;
    message: string;
    submessage: string;
    severity: 'info' | 'warning' | 'error';
    attempt: number;
    maxAttempts: number;
  } | null>(null);

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

  // Synchroniser les refs miroirs avec les states (pour les callbacks socket)
  useEffect(() => { isInFinalPhaseRef.current = isInFinalPhase; }, [isInFinalPhase]);
  useEffect(() => { isDebateEndedRef.current = isDebateEnded; }, [isDebateEnded]);
  useEffect(() => { remainingArgumentsRef.current = remainingArguments; }, [remainingArguments]);
  useEffect(() => { expiredUserIdRef.current = expiredUserId; }, [expiredUserId]);

  // Fonction centralisée pour naviguer vers récap
  // Vérifie d'abord si des arguments sont en cours d'analyse et attend si nécessaire
  const navigateToRecap = async (reason: string, firstVisit: boolean = true) => {
    if (hasNavigatedToRecap) {
      return;
    }

    isDebateEndedRef.current = true;
    setIsDebateEnded(true);

    // Vérifier s'il y a des arguments non scorés
    const pendingArgs = argumentsList.filter(arg =>
      !arg.isSystemMessage &&
      arg.id &&
      !arg.id.startsWith('log-') &&
      !arg.id.startsWith('processing-') &&
      !arg.isScored &&
      arg.scoreTotal === undefined || arg.scoreTotal === null || arg.scoreTotal === 0
    );

    if (pendingArgs.length > 0) {
      console.log(`⏳ ${pendingArgs.length} argument(s) en attente d'analyse avant récap...`);

      setAnalysisWaitState({
        isWaiting: true,
        message: t('debates.live.analysis.scoringInProgress'),
        submessage: t('debates.live.analysis.recapSoon'),
        severity: 'info',
        attempt: 0,
        maxAttempts: 6,
      });

      // Polling : attendre que les arguments soient scorés (max 30s)
      const MAX_WAIT_ATTEMPTS = 6;
      for (let attempt = 1; attempt <= MAX_WAIT_ATTEMPTS; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 5000));

        try {
          const response = await ArgumentsService.getDebateArguments(debate.id);
          const allArgs = Array.isArray(response) ? response : (response as any)?.arguments || [];
          const stillPending = allArgs.filter((a: any) => a.scoreTotal === 0 || a.scoreTotal === null);

          setAnalysisWaitState({
            isWaiting: true,
            message: stillPending.length > 0
              ? t('debates.live.analysis.scoringInProgress')
              : t('debates.live.analysis.finalizing'),
            submessage: stillPending.length > 0
              ? t('debates.live.analysis.argumentsPending', { count: stillPending.length })
              : t('debates.live.analysis.recapReady'),
            severity: attempt >= 4 ? 'warning' : 'info',
            attempt,
            maxAttempts: MAX_WAIT_ATTEMPTS,
          });

          if (stillPending.length === 0) {
            console.log('✅ Tous les arguments sont scorés, navigation vers récap');
            break;
          }
        } catch (error) {
          console.warn('⚠️ Erreur polling analyses:', error);
        }
      }

      setAnalysisWaitState(null);
    }

    if (hasNavigatedToRecap) return; // Double-check après l'attente
    setHasNavigatedToRecap(true);

    // Finaliser le débat côté backend (status → completed, calcul scoring, ELO)
    try {
      await DebatesService.acceptEnd(debate.id, user?.username || '');
      console.log('✅ Débat finalisé côté backend avant récap');
    } catch (error) {
      console.warn('⚠️ Erreur finalisation débat (non bloquant):', error);
    }

    // Clean up notepad
    AsyncStorage.removeItem(getNotepadKey(debate.id));

    navigation.navigate('RecapA', {
      debateId: debate.id,
      firstVisit
    });
  };

  const scrollViewRef = useRef<ScrollView>(null);

  // Animations pour le clignotement des timers
  const guestTimerBlink = useRef(new Animated.Value(1)).current;
  const hostTimerBlink = useRef(new Animated.Value(1)).current;

  // Animation 3 petits points
  const dotsAnimation = useRef(new Animated.Value(0)).current;

  // États pour le polling de fallback
  const [lastPollingTime, setLastPollingTime] = useState<number>(Date.now());
  const pollingIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Timer pour la phase d'introduction
  useEffect(() => {
    if (debatePhase === 'introduction') {
      const interval = setInterval(() => {
        setIntroTimer((prev) => {
          if (prev <= 1) {
            setDebatePhase('active');
            console.log('🕒 Phase active : démarrage du timer invité côté backend');
            if (!isDebateEnded) {
              startGuestTimer();
            } else {
              console.log('🚫 Débat terminé, pas de démarrage de timer');
            }
            return 0;
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [debatePhase]);

  // Animation de clignotement des timers
  useEffect(() => {
    if (debatePhase === 'active' && activeUserId) {
      const isGuestActive = activeUserId === debate.guestId;
      const activeAnimation = isGuestActive ? guestTimerBlink : hostTimerBlink;
      const inactiveAnimation = isGuestActive ? hostTimerBlink : guestTimerBlink;

      inactiveAnimation.stopAnimation();
      inactiveAnimation.setValue(1);

      const blinkAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(activeAnimation, {
            toValue: 0.3,
            duration: 500,
            useNativeDriver: false,
          }),
          Animated.timing(activeAnimation, {
            toValue: 1,
            duration: 500,
            useNativeDriver: false,
          }),
        ])
      );

      blinkAnimation.start();

      return () => {
        blinkAnimation.stop();
        activeAnimation.setValue(1);
      };
    } else {
      guestTimerBlink.stopAnimation();
      hostTimerBlink.stopAnimation();
      guestTimerBlink.setValue(1);
      hostTimerBlink.setValue(1);
    }
  }, [debatePhase, activeUserId, guestTimerBlink, hostTimerBlink, debate.guestId]);

  // Animation des 3 petits points
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

  // Initialisation d'ArgumentsService et Socket.IO
  useEffect(() => {
    if (!user?.token) return;

    console.log('🔌 Initialisation ArgumentsService pour le débat:', debate.id);

    ArgumentsService.setAuthToken(user.token);
    ArgumentsService.initializeSocket(user.token);
    ArgumentsService.joinDebateRoom(debate.id);

    ArgumentsService.setupSocketListeners(debate.id, {
      onArgumentReady: (data) => {
        console.log('📝 Argument traité par M1:', data);

        if (!data.argument) {
          console.warn('⚠️ Événement argument_ready reçu sans données complètes');
          return;
        }

        if (data.argument.userId === user?.id) {
          console.log('✏️ Mise à jour de MON message (brut → reformulé)');
          setHasJustSentMessage(false);

          setArgumentsList(prev => prev.map(arg => {
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
        } else {
          console.log('📨 Nouveau message reçu de l\'adversaire (déjà reformulé)');
          trigger('message-received');

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

          setArgumentsList(prev => [...prev, newArgument]);

          if (isCurrentUserGuest === false && data.argument.turnIndex === 0) {
            setHasGuestStarted(true);
          }

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
        if (data.tags && data.tags.length > 0) {
          const displayTags = mapRawTagsToDisplayTags(data.tags, i18n.language);
          if (displayTags.length > 0) {
            setArgumentsList(prev => {
              const scoredArg = prev.find(a => a.id === data.argumentId);
              const isMine = scoredArg?.userId === user?.id;
              const direction: FloatingDirection = isMine ? 'up' : 'down';

              if (!isDebateEndedRef.current) {
                pendingFloatingTagsRef.current.set(data.argumentId, { tags: displayTags, direction });
              }
              return prev;
            });
          }
        }
      },

      onArgumentRejected: (data) => {
        console.log('🚫 Argument rejeté:', data);

        if (data.userId === user?.id) {
          console.log('✅ Mon argument rejeté, réactivation de la saisie');
          setHasJustSentMessage(false);

          Alert.alert(
            'Argument rejeté',
            data.message,
            [{ text: 'OK', style: 'default' }]
          );

          setArgumentsList(prev => prev.filter(arg =>
            !(arg.isProcessing && arg.userId === data.userId)
          ));
        }
      },

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

      onTimerTick: (data) => {
        console.log('⏰ Timer tick:', data);

        if (isDebateEndedRef.current) {
          console.log('🚫 Timer tick reçu mais débat terminé, ignore');
          return;
        }

        if (data.userId === debate.guestId) {
          setGuestTimer(data.remainingSeconds);
          setActiveUserId(data.userId);
        } else if (data.userId === debate.hostId) {
          setHostTimer(data.remainingSeconds);
          setActiveUserId(data.userId);
        }
      },

      onTimerExpired: async (data) => {
        console.log('⏰ Timer expiré:', data);

        // Utiliser les refs pour éviter les closures stale
        if (isDebateEndedRef.current) {
          console.log('🚫 Timer expiré mais débat déjà terminé, ignore');
          return;
        }

        if (data.userId === debate.guestId) {
          setGuestTimer(0);
        } else if (data.userId === debate.hostId) {
          setHostTimer(0);
        }

        if (!isInFinalPhaseRef.current) {
          isInFinalPhaseRef.current = true; // Immédiat pour les callbacks
          setIsInFinalPhase(true);
          expiredUserIdRef.current = data.userId;
          setExpiredUserId(data.userId);
          setRemainingArguments(3);

          const otherUserId = data.userId === debate.guestId ? debate.hostId : debate.guestId;
          if (otherUserId) {
            setActiveUserId(otherUserId);

            const realRemainingTime = await getRemainingTime(otherUserId);
            const remainingSeconds = realRemainingTime && realRemainingTime > 0
              ? realRemainingTime
              : debate.mode * 60;

            // Pass expiration info to notify bot if needed
            const timerResumed = await resumeUserTimer(
              otherUserId,
              remainingSeconds,
              true, // afterOpponentExpiration
              data.userId // expiredUserId - the user whose timer expired
            );

            if (timerResumed) {
              console.log(`✅ Timer de l'adversaire repris avec ${remainingSeconds}s (après expiration de ${data.userId})`);
            }
          }

          const expiredUserName = data.userId === debate.guestId ? t('debates.live.guest', { defaultValue: 'invité' }) : t('debates.live.host', { defaultValue: 'hôte' });
          const activeUserName = data.userId === debate.guestId ? t('debates.live.host', { defaultValue: 'hôte' }) : t('debates.live.guest', { defaultValue: 'invité' });

          Alert.alert(
            t('debates.live.timeExpiredTitle'),
            t('debates.live.timeExpiredBody', { who: expiredUserName, other: activeUserName }),
            [{ text: t('debates.live.continue') }]
          );
        } else if (data.userId !== expiredUserIdRef.current) {
          // A DIFFERENT player's timer has now expired - both are done, debate is over
          setActiveUserId(null);
          isDebateEndedRef.current = true; // Immédiat pour les callbacks
          setIsDebateEnded(true);
          Alert.alert(
            t('debates.live.debateEndedTitle'),
            t('debates.live.debateEndedBody'),
            [{ text: t('debates.live.seeResults'), onPress: () => navigateToRecap('Timer expiré') }]
          );
        } else {
          // Same user's timer fired again (e.g. turn changed back with 0s left after bot responded)
          // Resume the other player's timer so they can continue playing
          console.log(`🔄 Timer re-expiré pour le même utilisateur ${data.userId}, reprise du timer adverse`);

          const otherUserId = data.userId === debate.guestId ? debate.hostId : debate.guestId;
          if (otherUserId) {
            setActiveUserId(otherUserId);
            const realRemainingTime = await getRemainingTime(otherUserId);
            if (realRemainingTime && realRemainingTime > 0) {
              await resumeUserTimer(
                otherUserId,
                realRemainingTime,
                true,
                data.userId
              );
              console.log(`✅ Timer adverse repris avec ${realRemainingTime}s (re-expiration)`);
            } else {
              // Other player also has 0 time - both are truly expired
              console.log('⏰ Les deux joueurs ont épuisé leur temps');
              setActiveUserId(null);
              isDebateEndedRef.current = true;
              setIsDebateEnded(true);
              Alert.alert(
                t('debates.live.debateEndedTitle'),
                t('debates.live.debateEndedBody'),
                [{ text: t('debates.live.seeResults'), onPress: () => navigateToRecap('Timer expiré') }]
              );
            }
          }
        }
      },

      onLlmDebug: (data) => {
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

      onDebateEndProposed: (data) => {
        console.log('🤝 Proposition d\'arrêt reçue:', data);

        if (data.proposerUserId === user?.id) {
          console.log('🚫 Ignore ma propre proposition');
          return;
        }

        trigger('selection');
        setCurrentProposal({ proposerUsername: data.proposerUsername });
        setShowProposalBubble(true);
        addChatLogMessage(t('debates.live.chatLog.proposalReceived', { username: data.proposerUsername }));
      },

      onDebateEndRefused: (data) => {
        console.log('❌ Proposition refusée par l\'adversaire:', data);
        showTemporaryNotification(t('debates.live.proposal.refused'));
        addChatLogMessage(t('debates.live.chatLog.proposalRefused', { username: data.refuserUsername }));
      },

      onDebateEnded: (data) => {
        console.log('🏁 Débat terminé par accord mutuel reçu par utilisateur:', user?.username, data);
        trigger('button-success');

        // ✅ NOUVEAU : Fermer l'overlay d'attente d'analyse
        setAnalysisWaitState(null);

        showTemporaryNotification(t('debates.live.proposal.accepted'));
        addChatLogMessage(t('debates.live.chatLog.debateEnded', { username: data.acceptedBy }));

        setTimeout(() => {
          navigateToRecap('Accord mutuel', true);
        }, 1500);
      },

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

      // ✅ NEW: Handle turn changes for live debates (triggered after M1)
      onTurnChanged: (data) => {
        console.log('🔄 Turn changed:', data);

        if (isDebateEndedRef.current) {
          console.log('🚫 Turn changed but debate ended, ignoring');
          return;
        }

        // Update activeUserId to reflect whose turn it is
        setActiveUserId(data.currentTurnUserId);
        console.log(`✅ Active user switched to: ${data.currentTurnUserId}`);
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
      onDebateResetToWaiting: (data) => {
        console.log('♻️ Débat remis en attente:', data);
        trigger('selection');

        Alert.alert(
          t('debates.moderation.guestRejectedTitle', { defaultValue: 'Invité rejeté' }),
          data.message || t('debates.moderation.guestRejectedBody', { defaultValue: 'L\'invité a été rejeté pour contenu inapproprié. La recherche a redémarré.' }),
          [
            {
              text: t('common.ok', { defaultValue: 'OK' }),
              onPress: () => navigation.replace('WaitingScreen', { debateId: data.debateId })
            }
          ]
        );
      },

      // ✅ M0 MODERATION : Guest viré pour modération
      onDebateKickedModeration: (data) => {
        console.log('🚪 Viré pour modération M0:', data);
        trigger('button-error');
        setIsDebateEnded(true);

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

      // Indicateur adversaire (typing/speaking)
      onOpponentActivity: (data) => {
        if (data.userId === user?.id) return;
        if (data.status === 'stop') {
          setOpponentActivity(null);
          if (opponentActivityTimerRef.current) clearTimeout(opponentActivityTimerRef.current);
        } else {
          setOpponentActivity(data.type);
          if (opponentActivityTimerRef.current) clearTimeout(opponentActivityTimerRef.current);
          opponentActivityTimerRef.current = setTimeout(() => {
            setOpponentActivity(null);
          }, 10000);
        }
      },
    });

    loadExistingArguments();
    startStatusPolling();

    return () => {
      console.log('🔌 Nettoyage ArgumentsService');
      ArgumentsService.removeSocketListeners();
      ArgumentsService.leaveDebateRoom(debate.id);
      stopStatusPolling();
      if (opponentActivityTimerRef.current) clearTimeout(opponentActivityTimerRef.current);
    };
  }, [debate.id, user?.token]);

  // Système de polling de fallback pour les statuts d'arguments
  const startStatusPolling = () => {
    stopStatusPolling();

    pollingIntervalRef.current = setInterval(async () => {
      await checkArgumentsStatus();
    }, 3000);

    console.log('🔄 Polling de statuts démarré');
  };

  const stopStatusPolling = () => {
    if (pollingIntervalRef.current) {
      clearInterval(pollingIntervalRef.current);
      pollingIntervalRef.current = null;
      console.log('🛑 Polling de statuts arrêté');
    }
  };

  const checkArgumentsStatus = async () => {
    try {
      const incompleteArgs = argumentsList.filter(arg =>
        arg.userId === user?.id &&
        !arg.isCompleted &&
        !arg.isSystemMessage &&
        arg.id &&
        !arg.id.startsWith('log-') &&
        !arg.id.startsWith('processing-')
      );

      if (incompleteArgs.length === 0) {
        return;
      }

      for (const arg of incompleteArgs) {
        try {
          const updatedArg = await ArgumentsService.getArgumentById(arg.id);

          setArgumentsList(prev => prev.map(prevArg => {
            if (prevArg.id === arg.id) {
              const needsUpdate = (
                prevArg.isCompleted !== (updatedArg.scoreTotal > 0) ||
                prevArg.isScored !== (updatedArg.scoreTotal > 0) ||
                prevArg.reliability !== updatedArg.reliability ||
                prevArg.impact !== updatedArg.impact
              );

              if (needsUpdate) {
                console.log(`🔄 Mise à jour argument ${arg.id} via polling: scoreTotal=${updatedArg.scoreTotal}`);
                return {
                  ...prevArg,
                  ...updatedArg,
                  userName: prevArg.userName,
                  timestamp: prevArg.timestamp,
                  isCompleted: updatedArg.scoreTotal > 0,
                  isScored: updatedArg.scoreTotal > 0,
                  isProcessingM2: false,
                  isProcessingM3: false,
                  isReformulated: true,
                };
              }
            }
            return prevArg;
          }));
        } catch (error) {
          console.warn(`⚠️ Erreur lors de la vérification de l'argument ${arg.id}:`, error);
        }
      }
    } catch (error) {
      console.warn('⚠️ Erreur lors du polling des statuts:', error);
    }
  };

  // Charger les arguments existants du débat
  const loadExistingArguments = async () => {
    try {
      const response = await ArgumentsService.getDebateArguments(debate.id);

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
      setArgumentsList(formattedArgs);
    } catch (error) {
      console.error('Erreur lors du chargement des arguments:', error);
      setArgumentsList([]);
    }
  };

  // Formatage du timer
  const formatTimer = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getPlayerTimer = (isGuest: boolean): number => {
    return isGuest ? guestTimer : hostTimer;
  };

  const shouldTimerBlink = (isGuest: boolean): boolean => {
    if (debatePhase !== 'active' || !activeUserId) return false;
    const playerUserId = isGuest ? debate.guestId : debate.hostId;
    return playerUserId === activeUserId;
  };

  // Récupérer le temps restant réel côté backend
  const getRemainingTime = async (userId: string): Promise<number | null> => {
    try {
      const response = await fetch(`${API_URL}/timer/${debate.id}/${userId}`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${user?.token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        return data.success ? data.remainingSeconds : null;
      }
      return null;
    } catch (error) {
      console.error('❌ Erreur réseau lors de la récupération du timer:', error);
      return null;
    }
  };

  // Fonction pour démarrer un timer
  const startUserTimer = async (userId: string, seconds: number) => {
    if (isDebateEnded) {
      console.log('🚫 Débat terminé, refus de démarrer un timer');
      return false;
    }

    try {
      const response = await fetch(`${API_URL}/timer/start`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.token}`,
        },
        body: JSON.stringify({
          debateId: debate.id,
          userId: userId,
          seconds: seconds,
        }),
      });

      if (response.ok) {
        console.log(`✅ Timer démarré pour userId: ${userId}, ${seconds}s`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Erreur réseau lors du démarrage du timer:', error);
      return false;
    }
  };

  // Fonction pour reprendre un timer
  // afterOpponentExpiration: true si le timer est repris après expiration du timer adverse
  // expiredUserId: l'ID de l'utilisateur dont le timer a expiré (pour notifier le bot)
  const resumeUserTimer = async (
    userId: string,
    seconds: number,
    afterOpponentExpiration?: boolean,
    expiredUserId?: string
  ) => {
    if (isDebateEnded) {
      console.log('🚫 Débat terminé, refus de reprendre un timer');
      return false;
    }

    try {
      const response = await fetch(`${API_URL}/timer/reset`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user?.token}`,
        },
        body: JSON.stringify({
          debateId: debate.id,
          userId: userId,
          seconds: seconds,
          autoStart: true,
          afterOpponentExpiration,
          expiredUserId,
        }),
      });

      if (response.ok) {
        console.log(`✅ Timer repris pour userId: ${userId}, ${seconds}s`);
        return true;
      }
      return false;
    } catch (error) {
      console.error('❌ Erreur réseau lors de la reprise du timer:', error);
      return false;
    }
  };

  // Démarrer le timer de l'invité
  const startGuestTimer = async () => {
    if (!debate.guestId) {
      console.error('❌ Impossible de démarrer le timer : guestId manquant');
      return false;
    }
    const timerSeconds = debate.mode * 60;
    return await startUserTimer(debate.guestId, timerSeconds);
  };

  // Déterminer si c'est le tour du joueur actuel
  const isCurrentUserTurn = (): boolean => {
    return activeUserId === user?.id;
  };

  // Envoi d'un argument
  const sendArgument = async () => {
    const currentText = textRef.current;
    if (!currentText.trim() || !user) return;
    trigger('message-sent');

    setHasJustSentMessage(true);

    try {
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

      setArgumentsList(prev => [...prev, tempArgument]);
      inputRef.current?.setNativeProps({ text: '' });
      textRef.current = '';
      setInputText('');
      setIsTyping(false);

      setTimeout(() => {
        scrollViewRef.current?.scrollToEnd({ animated: true });
      }, 100);

      const sentArgument = await ArgumentsService.sendArgument({
        debateId: debate.id,
        userId: user.id,
        rawText: currentText,
        factCheckEnabled: true,
      });

      console.log('✅ Argument envoyé avec succès:', sentArgument.id);

      // IMPORTANT : argument_ready (WS) peut arriver AVANT cette réponse API car M1 est synchrone.
      // Si argument_ready a déjà mis à jour l'argument, on ne doit PAS écraser cet état.
      setArgumentsList(prev => {
        const alreadyProcessed = prev.some(a => a.id === sentArgument.id && a.isReformulated);
        if (alreadyProcessed) return prev;

        return prev.map(arg =>
          arg.id === tempId
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
              }
            : arg
        );
      });

      if (isInFinalPhase && user.id !== expiredUserId) {
        const newRemaining = remainingArguments - 1;
        setRemainingArguments(newRemaining);

        if (newRemaining <= 0) {
          setTimeout(() => {
            Alert.alert(
              t('debates.live.debateEndedTitle'),
              t('debates.live.debateEndedBody'),
              [{ text: t('debates.live.seeResults'), onPress: () => navigateToRecap('3 arguments atteints') }]
            );
          }, 1000);
        }
      }

    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de l\'argument:', error);
      setHasJustSentMessage(false);
      setArgumentsList(prev => prev.filter(arg => !arg.isProcessing));

      Alert.alert(
        t('debates.live.sendErrorTitle'),
        t('debates.live.sendErrorBody'),
        [{ text: t('common.ok') }]
      );
    }
  };

  // Fonction pour compter les arguments par joueur
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

  // Fonctions utilitaires pour les notifications
  const showTemporaryNotification = (message: string) => {
    setNotificationMessage(message);
    setShowNotification(true);
    setTimeout(() => {
      setShowNotification(false);
    }, 2000);
  };

  const addChatLogMessage = (message: string) => {
    const logMessage: Argument = {
      id: `log-${Date.now()}`,
      debateId: debate.id,
      userId: 'system',
      turnIndex: -1,
      userName: t('debates.live.system'),
      rawText: message,
      cleanText: message,
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
      timestamp: new Date().toLocaleTimeString('fr-FR', {
        hour: '2-digit',
        minute: '2-digit'
      }),
      isProcessing: false,
      isScored: false,
      isSystemMessage: true,
    };

    setArgumentsList(prev => [...prev, logMessage]);
    setTimeout(() => {
      scrollViewRef.current?.scrollToEnd({ animated: true });
    }, 100);
  };

  // Proposer l'arrêt du débat
  const handleProposeDebateEnd = async () => {
    trigger('button-tap');
    if (propositionsSent >= 3) {
      trigger('button-error');
      showTemporaryNotification(t('debates.live.proposal.limit'));
      return;
    }

    // Feedback immédiat avant d'attendre la réponse API
    setPropositionsSent(prev => prev + 1);
    showTemporaryNotification(t('debates.live.proposal.sent'));
    addChatLogMessage(t('debates.live.chatLog.proposalSent', { username: user?.username }));

    try {
      await DebatesService.proposeEnd(debate.id, user?.username || '');
      console.log('🤝 Proposition d\'arrêt envoyée à l\'adversaire');
    } catch (error) {
      console.error('❌ Erreur lors de l\'envoi de la proposition:', error);
      setPropositionsSent(prev => Math.max(0, prev - 1));
      showTemporaryNotification(t('debates.live.proposal.sendError'));
    }
  };

  // Accepter une proposition d'arrêt
  const handleAcceptProposal = async () => {
    trigger('button-tap');
    try {
      await DebatesService.acceptEnd(debate.id, user?.username || '');
      console.log('✅ Proposition acceptée - fin du débat');
      trigger('button-success');
      setIsDebateEnded(true);
      setShowProposalBubble(false);
      addChatLogMessage(t('debates.live.chatLog.proposalAccepted', { username: user?.username }));
      showTemporaryNotification(t('debates.live.proposal.accepted'));
    } catch (error) {
      console.error('❌ Erreur lors de l\'acceptation:', error);
      trigger('button-error');
      showTemporaryNotification(t('debates.live.proposal.acceptError'));
    }
  };

  // Refuser une proposition d'arrêt
  const handleRefuseProposal = async () => {
    trigger('button-tap');
    try {
      await DebatesService.refuseEnd(debate.id, user?.username || '');
      console.log('❌ Proposition refusée');
      setShowProposalBubble(false);
      setCurrentProposal(null);
      showTemporaryNotification(t('debates.live.proposal.refused'));
    } catch (error) {
      console.error('❌ Erreur lors du refus:', error);
      showTemporaryNotification(t('debates.live.proposal.refuseError'));
    }
  };

  // Quitter la partie
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

  // Détermine si l'utilisateur peut écrire
  const canUserWrite = (): boolean => {
    if (debatePhase !== 'active') return false;
    if (hasJustSentMessage) return false;

    if (isInFinalPhase && user?.id === expiredUserId) {
      return false;
    }

    if (isInFinalPhase && user?.id !== expiredUserId && remainingArguments <= 0) {
      return false;
    }

    if (activeUserId === user?.id) {
      return true;
    }

    if (!activeUserId && isCurrentUserGuest) {
      return true;
    }

    return false;
  };

  // Fonctions pour les couleurs de la barre de progression
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

  // Animation de chargement rotatif
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

  // Animation de pulsation pour l'enregistrement
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

      return () => {
        pulseAnimation.stop();
        recordingPulse.setValue(1);
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

  // Déterminer si le bouton micro doit être visible
  const isMicroButtonVisible = inputText.length === 0 && canUserWrite() && voiceState === 'idle';

  const getInputPlaceholder = (): string => {
    if (voiceState === 'recording' || voiceState === 'transcribing') {
      return '';
    }

    if (debatePhase === 'introduction') {
      return t('debates.live.preparingDebate');
    }

    if (isInFinalPhase) {
      if (user?.id === expiredUserId) {
        return t('debates.live.yourTimeExpired');
      } else if (remainingArguments <= 0) {
        return t('debates.live.noArgumentsLeft');
      } else if (canUserWrite()) {
        return t('debates.live.remainingArguments', { count: remainingArguments });
      } else {
        return t('debates.live.waitingForYourTurn');
      }
    }

    if (canUserWrite()) {
      if (!activeUserId && isCurrentUserGuest) {
        return t('debates.live.yourTurnToStart');
      }
      return t('debates.live.typeYourArgument');
    } else {
      if (!activeUserId && !isCurrentUserGuest) {
        return t('debates.live.waitingForOpponentStart');
      }
      return t('debates.live.waitingForYourTurn');
    }
  };

  // Rendu d'un argument
  const renderArgument = (argument: Argument, index: number) => {
    const isCurrentUser = argument.userId === user?.id;
    const isSystemMessage = argument.isSystemMessage;

    // Messages système
    if (isSystemMessage) {
      return (
        <View key={argument.id || `system-${index}`} style={styles.systemMessageContainer}>
          <Text style={styles.systemMessageText}>{argument.cleanText}</Text>
        </View>
      );
    }

    // Affichage spécial pour les arguments en cours de traitement initial
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

  // Empêcher la navigation de retour par geste
  usePreventRemove(true, ({ data }) => {
    setShowMenu(true);
  });

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
            {/* Timer adversaire */}
            <Animated.Text style={[
              styles.timerText,
              shouldTimerBlink(!isCurrentUserGuest) && styles.activeTimer,
              {
                opacity: shouldTimerBlink(!isCurrentUserGuest)
                  ? (isCurrentUserGuest ? hostTimerBlink : guestTimerBlink)
                  : 1
              }
            ]}>
              {formatTimer(getPlayerTimer(!isCurrentUserGuest))}
            </Animated.Text>
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
            {/* Timer joueur */}
            <Animated.Text style={[
              styles.timerText,
              shouldTimerBlink(isCurrentUserGuest) && styles.activeTimer,
              {
                opacity: shouldTimerBlink(isCurrentUserGuest)
                  ? (isCurrentUserGuest ? guestTimerBlink : hostTimerBlink)
                  : 1
              }
            ]}>
              {formatTimer(getPlayerTimer(isCurrentUserGuest))}
            </Animated.Text>
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
          {/* Header avec statut */}
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
              style={styles.messagesContainer}
              contentContainerStyle={styles.messagesContent}
              showsVerticalScrollIndicator={false}
            >
              {argumentsList.map((argument, index) => renderArgument(argument, index))}

              {/* Indicateur adversaire typing/speaking */}
              {opponentActivity && (
                <View style={styles.opponentActivityContainer}>
                  <Text style={styles.opponentActivityText}>
                    {opponentActivity === 'typing'
                      ? `${opponent.username} ${t('debates.live.isTyping')}`
                      : `${opponent.username} ${t('debates.live.isSpeaking')}`}
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
              }}
              multiline
              maxLength={650}
              editable={canUserWrite() && voiceState === 'idle'}
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
                  const success = await startRecording();
                  if (success) {
                    trigger('transcription-start');
                    setVoiceState('recording');
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
                      trigger('transcription-complete');
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
            backgroundColor={(!inputText.trim() || !canUserWrite()) ? COLORS.GREY_MEDIUM + '40' : COLORS.YELLOW_CORE}
            iconColor={COLORS.NIGHT_BLUE}
            iconPressedColor={COLORS.INK}
            disabled={!inputText.trim() || !canUserWrite()}
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
              return (
                <AnimatedMenuButton
                  style={[styles.menuButton, styles.proposeEndButton, propositionsSent >= 3 && styles.menuButtonDisabled]}
                  onPress={() => {
                    if (propositionsSent >= 3) return;
                    setShowMenu(false);
                    handleProposeDebateEnd();
                  }}
                >
                  <Text style={styles.menuButtonIcon}>🤝</Text>
                  <View style={styles.menuButtonTextContainer}>
                    <Text style={[styles.menuButtonText, styles.proposeEndButtonText, propositionsSent >= 3 && styles.menuButtonTextDisabled]}>
                      {t('debates.async.screen.menuProposeStop')} ({propositionsSent}/3)
                    </Text>
                    <Text style={styles.menuButtonSubtext}>
                      {t('debates.async.screen.messagesCount', { user: userCount, opponent: opponentCount })}
                    </Text>
                  </View>
                </AnimatedMenuButton>
              );
            })()}

            {/* Bouton Quitter */}
            <AnimatedMenuButton
              style={[styles.menuButton, styles.quitButton]}
              onPress={() => {
                setShowMenu(false);
                handleQuitDebate();
              }}
            >
              <Text style={styles.menuButtonIcon}>🏳️</Text>
              <View style={styles.menuButtonTextContainer}>
                <Text style={[styles.menuButtonText, styles.quitButtonText]}>
                  {t('debates.live.quit')}
                </Text>
              </View>
            </AnimatedMenuButton>
          </View>
        </View>
      </Modal>

      {/* Notification temporaire */}
      {showNotification && (
        <View style={styles.temporaryNotification}>
          <Text style={styles.notificationText}>{notificationMessage}</Text>
        </View>
      )}

      {/* Bulle de proposition d'arrêt */}
      {showProposalBubble && currentProposal && (() => {
        const { userCount, opponentCount } = getArgumentsCount();
        return (
          <View style={styles.proposalBubbleOverlay}>
            <View style={styles.proposalBubble}>
              <Text style={styles.proposalTitle}>{t('debates.async.screen.proposalTitle')}</Text>
              <Text style={styles.proposalMessage}>
                {t('debates.async.screen.proposalMessage', { username: currentProposal.proposerUsername })}
              </Text>
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
            {/* Spinner animé */}
            <View style={styles.analysisSpinnerContainer}>
              <Animated.View style={[styles.analysisSpinner, {
                transform: [{
                  rotate: '0deg' // Animation simple, on pourrait ajouter une vraie animation
                }]
              }]}>
                <Ionicons
                  name={analysisWaitState.severity === 'error' ? 'alert-circle' : 'hourglass-outline'}
                  size={40}
                  color={analysisWaitState.severity === 'error' ? COLORS.ERROR : COLORS.YELLOW_CORE}
                />
              </Animated.View>
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

      {/* Overlay pour la phase d'introduction avec compte à rebours */}
      {debatePhase !== 'active' && (
        <View style={styles.phaseOverlay}>
          <View style={styles.phaseContainer}>
            <Text style={styles.phaseTitle}>
              {isCurrentUserGuest ? t('debates.live.yourTurnToStart') : t('debates.live.opponentStartsTitle')}
            </Text>
            <Text style={styles.countdownSubtext}>
              {t('debates.live.debateStartsIn')}
            </Text>
            <Text style={styles.countdownNumber}>{introTimer}</Text>

            <View style={styles.debateInfoOverlay}>
              <Text style={styles.debateTitleOverlay}>{debate.title}</Text>

              <View style={styles.opponentsInfo}>
                <View style={styles.opponentInfoCard}>
                  <Text style={styles.opponentRole}>{t('debates.live.yourOpponent')}</Text>
                  <Text style={styles.opponentNameOverlay}>
                    {isCurrentUserGuest ? debate.host?.username : debate.guest?.username}
                  </Text>
                  <Text style={styles.opponentViewOverlay}>
                    "{isCurrentUserGuest ? debate.hostView : debate.guestView}"
                  </Text>
                </View>

                <View style={styles.yourInfoCard}>
                  <Text style={styles.yourRole}>{t('debates.live.yourPosition')}</Text>
                  <Text style={styles.yourViewOverlay}>
                    "{isCurrentUserGuest ? debate.guestView : debate.hostView}"
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      )}
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
    paddingHorizontal: 16,
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
  timerText: {
    fontSize: 18,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
    marginVertical: 6,
    backgroundColor: COLORS.surface,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.INK,
    overflow: 'hidden',
  },
  activeTimer: {
    color: COLORS.YELLOW_CORE,
  },
  messagesContainer: {
    flex: 1,
    paddingHorizontal: 8,
  },
  messagesContent: {
    paddingVertical: 10,
    paddingBottom: 20,
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
  statusText: {
    fontSize: 9,
    fontFamily: 'Raleway-ExtraBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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
    marginTop: -18,
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
    paddingVertical: 30,
    paddingHorizontal: 24,
    width: '92%',
    maxWidth: 400,
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
    marginVertical: 10,
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

  // Notification temporaire
  temporaryNotification: {
    position: 'absolute',
    top: 100,
    left: 20,
    right: 20,
    backgroundColor: COLORS.YELLOW_CORE,
    borderRadius: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 6,
    zIndex: 1000,
  },
  notificationText: {
    fontSize: 14,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.NIGHT_BLUE,
    textAlign: 'center',
  },

  // Bulle de proposition d'arrêt
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

  // Overlay pour la phase d'introduction
  phaseOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(11, 15, 19, 0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1000,
  },
  phaseContainer: {
    width: '90%',
    alignItems: 'center',
    paddingVertical: 40,
  },
  phaseTitle: {
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 20,
  },
  countdownNumber: {
    fontSize: 72,
    fontFamily: 'Raleway-Black',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
    marginBottom: 30,
  },
  countdownSubtext: {
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  debateInfoOverlay: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 20,
    padding: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    marginTop: 20,
  },
  debateTitleOverlay: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 20,
  },
  opponentsInfo: {
    gap: 15,
  },
  opponentInfoCard: {
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  yourInfoCard: {
    backgroundColor: COLORS.YELLOW_CORE + '15',
    borderRadius: 16,
    padding: 16,
    borderWidth: 2,
    borderColor: COLORS.YELLOW_CORE + '40',
  },
  opponentRole: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.GREY_MEDIUM,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  yourRole: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  opponentNameOverlay: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    marginBottom: 8,
  },
  opponentViewOverlay: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    lineHeight: 20,
    fontStyle: 'italic',
  },
  yourViewOverlay: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    lineHeight: 20,
    fontStyle: 'italic',
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
  analysisSpinner: {
    width: 60,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
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
