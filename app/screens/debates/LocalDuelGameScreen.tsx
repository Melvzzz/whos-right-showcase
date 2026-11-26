import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  Animated,
  ActivityIndicator,
  TextInput,
  TouchableWithoutFeedback,
  Keyboard,
  ScrollView,
  Modal,
  Switch,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { RootStackScreenProps } from '../../types/navigation';
import { COLORS } from '../../constants/colors';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { useAudioRecording } from '../../hooks/useAudioRecording';
import { TranscriptionService } from '../../services/transcription.service';
import LocalDuelService from '../../services/local-duel.service';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { IconButton } from '../../components/IconButton';
import { PrimaryButton } from '../../components/PrimaryButton';
import { useHaptics } from '../../hooks/useHaptics';
import AsyncStorage from '@react-native-async-storage/async-storage';

const AUTO_SEND_STORAGE_KEY = 'local-duel-auto-send';

// Composant pour les boutons de menu avec effet 3D
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

// Composant dot animé pour l'indicateur de progression
const AnimatedDot: React.FC<{
  index: number;
  currentAttempt: number;
  isError: boolean;
}> = ({ index, currentAttempt, isError }) => {
  const opacityAnim = useRef(new Animated.Value(1)).current;

  const isDisappeared = index < currentAttempt;
  const isCurrent = index === currentAttempt;

  useEffect(() => {
    if (isCurrent && !isError) {
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

  if (isDisappeared) {
    return (
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: 'transparent' }} />
    );
  }

  return (
    <Animated.View
      style={[
        { width: 10, height: 10, borderRadius: 5, backgroundColor: isError ? '#FF6B6B' : COLORS.YELLOW_CORE },
        { opacity: isCurrent ? opacityAnim : 1 },
      ]}
    />
  );
};

// Composant bouton d'enregistrement avec effet sablier
const RecordingButton: React.FC<{
  onPress: () => void;
  recordingTime: number;
  maxRecordingTime: number;
}> = ({ onPress, recordingTime, maxRecordingTime }) => {
  const timeRemaining = maxRecordingTime - recordingTime;
  const progress = recordingTime / maxRecordingTime; // 0 → 1
  const fillHeight = (1 - progress) * 100; // 100% → 0%

  // Seuils pour les couleurs
  const isWarning = timeRemaining <= 10 && timeRemaining > 5;
  const isCritical = timeRemaining <= 5;

  // Animation de clignotement pour les dernières secondes
  const blinkOpacity = useSharedValue(1);

  React.useEffect(() => {
    if (isCritical) {
      // Clignotement rapide dans les 5 dernières secondes
      blinkOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: 200 }),
          withTiming(1, { duration: 200 })
        ),
        -1, // Répéter indéfiniment
        false
      );
    } else if (isWarning) {
      // Clignotement lent entre 5-10 secondes
      blinkOpacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 400 }),
          withTiming(1, { duration: 400 })
        ),
        -1,
        false
      );
    } else {
      blinkOpacity.value = withTiming(1, { duration: 100 });
    }
  }, [isCritical, isWarning]);

  // Couleur dynamique selon le temps restant
  const getButtonColor = () => {
    if (isCritical) return COLORS.RED_ERROR;
    if (isWarning) return '#FF9500'; // Orange
    return COLORS.YELLOW_CORE;
  };

  const getBorderColor = () => {
    if (isCritical) return '#8B0000'; // Dark red
    if (isWarning) return '#CC7000'; // Dark orange
    return COLORS.INK;
  };

  const animatedStyle = useAnimatedStyle(() => {
    return {
      opacity: blinkOpacity.value,
    };
  });

  const buttonColor = getButtonColor();
  const borderColor = getBorderColor();

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.9}>
      <Reanimated.View style={[styles.recordingButtonOuter, animatedStyle]}>
        {/* Conteneur du bouton avec overflow hidden pour l'effet sablier */}
        <View style={[
          styles.recordingButtonContainer,
          { borderColor: borderColor }
        ]}>
          {/* Fond vide (partie vidée du sablier) */}
          <View style={styles.recordingButtonEmpty} />

          {/* Remplissage coloré (partie pleine du sablier) */}
          <View
            style={[
              styles.recordingButtonFill,
              {
                height: `${fillHeight}%`,
                backgroundColor: buttonColor,
              }
            ]}
          />

          {/* Icône par-dessus - blanc si moins de 50% du temps restant */}
          <View style={styles.recordingButtonIconContainer}>
            <Ionicons
              name="checkmark"
              size={40}
              color={progress >= 0.47 ? COLORS.white : COLORS.NIGHT_BLUE}
            />
          </View>
        </View>

        {/* Badge compte à rebours */}
        <View style={[
          styles.countdownBadge,
          isCritical && styles.countdownBadgeCritical,
          isWarning && !isCritical && styles.countdownBadgeWarning,
        ]}>
          <Text style={[
            styles.countdownText,
            isCritical && styles.countdownTextCritical,
          ]}>
            {timeRemaining}s
          </Text>
        </View>
      </Reanimated.View>
    </TouchableOpacity>
  );
};

type Props = RootStackScreenProps<'LocalDuelGame'>;

// Types pour le débat local
type LocalDuelState = 'idle' | 'recording' | 'transcribing' | 'editing' | 'switchingPlayer';

type LocalPlayer = {
  id: 'player1' | 'player2';
  name: string;
  viewpoint: string;
  timer: number; // secondes restantes
  isActive: boolean;
};

export const LocalDuelGameScreen: React.FC<Props> = ({ navigation, route }) => {
  const { localDebate: rawDebate } = route.params;
  const { user } = useAuth();
  const { t } = useTranslation();
  const { trigger } = useHaptics();

  // Reconvertir les dates depuis les strings sérialisées
  const localDebate = {
    ...rawDebate,
    createdAt: new Date(rawDebate.createdAt),
    updatedAt: new Date(rawDebate.updatedAt),
    arguments: rawDebate.arguments.map((arg: any) => ({
      ...arg,
      timestamp: new Date(arg.timestamp)
    }))
  };

  // États principaux
  const [currentState, setCurrentState] = useState<LocalDuelState>('idle');
  const [currentPlayerTurn, setCurrentPlayerTurn] = useState<'player1' | 'player2'>('player1');
  const [currentDebate, setCurrentDebate] = useState(localDebate);

  // États des joueurs
  const [player1, setPlayer1] = useState<LocalPlayer>({
    id: 'player1',
    name: localDebate.player1.name,
    viewpoint: localDebate.player1.viewpoint,
    timer: localDebate.player1.timer,
    isActive: true,
  });

  const [player2, setPlayer2] = useState<LocalPlayer>({
    id: 'player2',
    name: localDebate.player2.name,
    viewpoint: localDebate.player2.viewpoint,
    timer: localDebate.player2.timer,
    isActive: false,
  });

  // États pour l'enregistrement et transcription
  const [transcriptionText, setTranscriptionText] = useState('');
  const [editedText, setEditedText] = useState('');
  const [recordingTime, setRecordingTime] = useState(0);
  const [maxRecordingTime] = useState(localDebate.maxArgumentTime || 30);

  // AutoSend : skip editing, send transcription directly
  const [autoSend, setAutoSend] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(AUTO_SEND_STORAGE_KEY).then((value) => {
      if (value !== null) setAutoSend(value === 'true');
    });
  }, []);

  const toggleAutoSend = () => {
    const next = !autoSend;
    setAutoSend(next);
    AsyncStorage.setItem(AUTO_SEND_STORAGE_KEY, String(next));
    trigger('button-tap');
  };

  // États pour les modales
  const [showDebateInfo, setShowDebateInfo] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [analysisWaitState, setAnalysisWaitState] = useState<{
    isWaiting: boolean;
    message: string;
    submessage: string;
    severity: 'info' | 'warning' | 'error';
    attempt: number;
    maxAttempts: number;
  } | null>(null);

  // Animations pour les avatars
  const player1Scale = useRef(new Animated.Value(1.0)).current;
  const player1Opacity = useRef(new Animated.Value(1.0)).current;
  const player2Scale = useRef(new Animated.Value(0.6)).current;
  const player2Opacity = useRef(new Animated.Value(0.4)).current;

  // Animation pour la zone d'édition
  const editingContainerTranslateY = useRef(new Animated.Value(0)).current;

  // Références pour les timers
  const timerInterval = useRef<NodeJS.Timeout | null>(null);
  const recordingInterval = useRef<NodeJS.Timeout | null>(null);

  // Guard contre double soumission (ref pour être synchrone)
  const isSubmittingRef = useRef(false);

  // Hook pour l'enregistrement audio
  const {
    isRecording,
    startRecording,
    stopRecording,
    recordingUri,
    isProcessing,
  } = useAudioRecording();

  // Fonctions utilitaires
  const formatTime = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  const getCurrentPlayer = (): LocalPlayer => {
    return currentPlayerTurn === 'player1' ? player1 : player2;
  };

  const getInactivePlayer = (): LocalPlayer => {
    return currentPlayerTurn === 'player1' ? player2 : player1;
  };

  // Gestion du timer unifié
  const startUnifiedTimer = () => {
    if (timerInterval.current) clearInterval(timerInterval.current);

    timerInterval.current = setInterval(() => {
      const updatePlayer = currentPlayerTurn === 'player1' ? setPlayer1 : setPlayer2;

      updatePlayer(prev => {
        const newTimer = Math.max(0, prev.timer - 1);

        // Si le timer atteint 0, forcer la fin
        if (newTimer === 0) {
          handleTimerExpired();
        }

        return { ...prev, timer: newTimer };
      });
    }, 1000);
  };

  const stopUnifiedTimer = () => {
    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }
  };

  const handleTimerExpired = () => {
    stopUnifiedTimer();
    if (currentState === 'recording') {
      handleStopRecording();
    } else if (currentState === 'editing') {
      handleSubmitArgument();
    }
  };

  // Gestion des états de la machine d'état
  const handleStartRecording = async () => {
    try {
      trigger('button-tap');
      setCurrentState('recording');
      setRecordingTime(0);

      // Démarrer l'enregistrement
      const success = await startRecording();
      if (success) {
        trigger('transcription-start');
      }

      // Démarrer les timers
      startUnifiedTimer();
      startRecordingTimer();

    } catch (error) {
      console.error('Erreur démarrage enregistrement:', error);
      Alert.alert(t('debates.game.error'), t('debates.game.cannotStartRecording'));
      setCurrentState('idle');
    }
  };

  const startRecordingTimer = () => {
    if (recordingInterval.current) clearInterval(recordingInterval.current);

    recordingInterval.current = setInterval(() => {
      setRecordingTime(prev => {
        const newTime = prev + 1;

        // Auto-stop à 30 secondes
        if (newTime >= maxRecordingTime) {
          handleStopRecording();
        }

        return newTime;
      });
    }, 1000);
  };

  const handleStopRecording = async () => {
    if (isSubmittingRef.current) return;
    try {
      trigger('button-tap');
      // Arrêter les timers
      stopUnifiedTimer();
      if (recordingInterval.current) {
        clearInterval(recordingInterval.current);
        recordingInterval.current = null;
      }

      setCurrentState('transcribing');

      // Arrêter l'enregistrement
      console.log('🎤 Arrêt de l\'enregistrement...');
      const audioUri = await stopRecording();
      console.log('📱 URI audio reçu:', audioUri);

      if (!audioUri) {
        throw new Error('Aucun fichier audio créé');
      }

      if (!user?.token) {
        throw new Error('Token d\'authentification manquant');
      }

      console.log('🔄 Début transcription...');
      // Transcription
      const transcription = await TranscriptionService.transcribeAudio(audioUri, user.token);
      console.log('✅ Transcription reçue:', transcription);

      const transcribedText = transcription.text || '';
      const isTooShort = transcribedText.trim().length < 5;

      if (autoSend && isTooShort) {
        // AutoSend + texte insuffisant : vérifier si le joueur a encore du temps
        const currentPlayer = getCurrentPlayer();
        if (currentPlayer.timer > 0) {
          // Temps restant → relancer l'enregistrement (le recordingTime est conservé)
          console.log('⚠️ AutoSend: texte trop court, relance enregistrement');
          setCurrentState('idle');
          startUnifiedTimer();
          return;
        } else {
          // Plus de temps → passer au joueur suivant sans argument
          console.log('⚠️ AutoSend: texte trop court + temps écoulé, skip du tour');
          setCurrentState('switchingPlayer');
          await switchPlayerWithAnimation();
          return;
        }
      }

      if (!transcribedText.trim()) {
        console.warn('⚠️ Texte transcrit vide');
        setTranscriptionText(t('debates.game.noTextDetected'));
        setEditedText(t('debates.game.noTextDetected'));
        setCurrentState('editing');
      } else {
        const truncated = transcribedText.slice(0, 650);
        trigger('transcription-complete');
        setTranscriptionText(truncated);
        setEditedText(truncated);

        if (autoSend) {
          // Skip editing, submit directly
          console.log('⚡ AutoSend activé, soumission directe');
          await handleSubmitArgument(transcribedText);
        } else {
          setCurrentState('editing');
        }
      }

    } catch (error) {
      console.error('❌ Erreur transcription:', error);
      trigger('button-error');

      if (autoSend) {
        // AutoSend : pas d'alerte bloquante, on revient à idle pour réessayer
        console.warn('⚠️ AutoSend: erreur transcription, retour à idle');
        setCurrentState('idle');
        startUnifiedTimer();
        return;
      }

      // Messages d'erreur plus détaillés
      let errorMessage = t('debates.game.cannotTranscribe');
      if (error instanceof Error) {
        if (error.message.includes('Token')) {
          errorMessage = t('debates.game.authProblem');
        } else if (error.message.includes('fichier')) {
          errorMessage = t('debates.game.audioProblem');
        } else if (error.message.includes('réseau') || error.message.includes('connexion')) {
          errorMessage = t('debates.game.networkProblem');
        } else {
          errorMessage = error.message;
        }
      }

      Alert.alert(t('debates.game.transcriptionError'), errorMessage);
      setCurrentState('idle');
      // Remettre le timer comme il était
      startUnifiedTimer();
    }
  };

  const handleSubmitArgument = async (overrideText?: string) => {
    if (isSubmittingRef.current) return;
    isSubmittingRef.current = true;
    try {
      trigger('button-tap');
      const finalText = (overrideText ?? editedText).trim();

      if (!finalText) {
        trigger('button-error');
        Alert.alert(t('debates.game.warning'), t('debates.game.enterArgument'));
        return;
      }

      if (!user?.token) {
        Alert.alert(t('debates.game.error'), t('debates.game.authTokenMissing'));
        return;
      }

      console.log('📝 Soumission argument local...');

      // Calculer la durée d'enregistrement
      const recordingDuration = maxRecordingTime - recordingTime;
      const currentPlayer = getCurrentPlayer();

      // Ajouter l'argument au débat local
      console.log('🔄 Ajout argument au service...');
      const updatedDebate = await LocalDuelService.addArgument(
        currentDebate,
        {
          playerId: currentPlayerTurn,
          playerName: currentPlayer.name,
          content: finalText,
          duration: recordingDuration,
        },
        user.token
      );
      console.log('✅ Argument ajouté avec succès');

      // Mettre à jour l'état du débat
      trigger('chat-send');
      setCurrentDebate(updatedDebate);
      console.log('🔄 État débat mis à jour');

      // Vérifier si le débat doit se terminer
      const shouldEnd = LocalDuelService.shouldEndDebate(updatedDebate);
      console.log('🔍 Vérification fin débat:', shouldEnd);

      if (shouldEnd) {
        console.log('🏁 Fin de débat détectée');
        await handleDebateEnd(updatedDebate);
        return;
      }

      // Passer au joueur suivant
      console.log('🔄 Changement de joueur...');
      setCurrentState('switchingPlayer');
      await switchPlayerWithAnimation();
      console.log('✅ Changement de joueur terminé');

    } catch (error) {
      console.error('❌ Erreur soumission argument:', error);
      trigger('button-error');
      Alert.alert(t('debates.game.error'), t('debates.game.cannotSubmitArgument'));
    } finally {
      isSubmittingRef.current = false;
    }
  };

  const switchPlayerWithAnimation = async (): Promise<void> => {
    return new Promise((resolve) => {
      const isCurrentPlayer1 = currentPlayerTurn === 'player1';

      // Animations parallèles
      Animated.parallel([
        // Joueur actuel vers arrière-plan
        Animated.timing(isCurrentPlayer1 ? player1Scale : player2Scale, {
          toValue: 0.6,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(isCurrentPlayer1 ? player1Opacity : player2Opacity, {
          toValue: 0.4,
          duration: 300,
          useNativeDriver: true,
        }),
        // Joueur suivant vers premier plan
        Animated.timing(isCurrentPlayer1 ? player2Scale : player1Scale, {
          toValue: 1.0,
          duration: 300,
          useNativeDriver: true,
        }),
        Animated.timing(isCurrentPlayer1 ? player2Opacity : player1Opacity, {
          toValue: 1.0,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start(() => {
        // Vibration et feedback (optionnel)
        // Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
        console.log('🎮 Changement de joueur avec animation');

        // Changement de joueur actif
        const newPlayerTurn = currentPlayerTurn === 'player1' ? 'player2' : 'player1';
        setCurrentPlayerTurn(newPlayerTurn);

        // Mise à jour des états des joueurs
        setPlayer1(prev => ({
          ...prev,
          isActive: newPlayerTurn === 'player1',
          timer: newPlayerTurn === 'player1' ? Math.max(prev.timer, 0) : prev.timer
        }));
        setPlayer2(prev => ({
          ...prev,
          isActive: newPlayerTurn === 'player2',
          timer: newPlayerTurn === 'player2' ? Math.max(prev.timer, 0) : prev.timer
        }));

        // Reset des textes
        setTranscriptionText('');
        setEditedText('');
        setRecordingTime(0);

        // Retour à l'état idle
        setCurrentState('idle');

        resolve();
      });
    });
  };

  /**
   * Attendre que tous les arguments soient scorés avant de terminer
   */
  const waitForScoringCompletion = async (): Promise<void> => {
    if (!user?.token) {
      throw new Error('Token d\'authentification manquant');
    }

    const MAX_ATTEMPTS = 6;
    const POLL_INTERVAL = 5000;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL));

      try {
        const status = await LocalDuelService.checkProcessingStatus(currentDebate.id, user.token);

        setAnalysisWaitState(prev => prev ? {
          ...prev,
          message: status.processingCount > 0
            ? t('debates.live.analysis.scoringInProgress')
            : t('debates.live.analysis.finalizing'),
          submessage: status.processingCount > 0
            ? t('debates.live.analysis.argumentsPending', { count: status.processingCount })
            : t('debates.live.analysis.recapReady'),
          severity: attempt >= 4 ? 'warning' : 'info',
          attempt,
        } : prev);

        if (!status.hasProcessingArguments) {
          console.log('✅ Tous les arguments sont analysés');
          return;
        }
      } catch (error) {
        console.warn('⚠️ Erreur polling analyses:', error);
      }
    }

    console.warn('⏰ Timeout atteint, on continue quand même');
  };

  /**
   * Gère la fin du débat (fin naturelle ou timer écoulé)
   * Attend que tous les arguments soient analysés avant de naviguer vers le récap
   */
  const handleDebateEnd = async (debate: typeof currentDebate) => {
    try {
      stopUnifiedTimer();
      if (recordingInterval.current) clearInterval(recordingInterval.current);

      console.log('🏁 Fin du débat local');

      if (!user?.token) {
        throw new Error(t('debates.game.authTokenMissing'));
      }

      // 1. Vérifier s'il y a des arguments en cours de traitement
      const initialStatus = await LocalDuelService.checkProcessingStatus(debate.id, user.token);

      if (initialStatus.hasProcessingArguments) {
        setAnalysisWaitState({
          isWaiting: true,
          message: t('debates.live.analysis.scoringInProgress'),
          submessage: t('debates.live.analysis.recapSoon'),
          severity: 'info',
          attempt: 0,
          maxAttempts: 6,
        });

        await waitForScoringCompletion();

        setAnalysisWaitState(null);
      }

      // 2. Fermer le débat côté backend
      await LocalDuelService.endDebateOnBackend(debate.id, user.token);

      // 3. Terminer le débat localement
      const finalDebate = await LocalDuelService.endDebate(debate);

      // 4. Naviguer vers RecapA avec flag isLocalDebate
      navigation.replace('RecapA', {
        debateId: finalDebate.id,
        isLocalDebate: true,
      });

    } catch (error) {
      setAnalysisWaitState(null);
      console.error('❌ Erreur fin débat:', error);
      Alert.alert(t('debates.game.error'), t('debates.game.cannotEndDebate') + (error as Error).message);
    }
  };

  const handleQuit = () => {
    trigger('button-tap');
    handleDebateEnd(currentDebate);
  };


  // Vérifier périodiquement les conditions de fin
  useEffect(() => {
    if (currentState === 'idle' && currentDebate.status === 'active') {
      const currentPlayer = getCurrentPlayer();

      // Vérifier si le timer est écoulé
      if (currentPlayer.timer <= 0) {
        console.log('⏰ Timer écoulé, fin du débat');
        handleDebateEnd(currentDebate);
      }
    }
  }, [player1.timer, player2.timer, currentState]);

  // Animation pour montée/descente de la zone d'édition
  const animateEditingZone = (toValue: number) => {
    Animated.timing(editingContainerTranslateY, {
      toValue,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  // Gestion des événements clavier pour animation progressive
  useEffect(() => {
    const keyboardDidShowListener = Keyboard.addListener('keyboardDidShow', (event) => {
      if (currentState === 'editing') {
        // Utilise la hauteur du clavier pour calculer la montée
        const keyboardHeight = event.endCoordinates.height;
        animateEditingZone(-keyboardHeight * 0.7); // Monte de 40% de la hauteur du clavier
      }
    });

    const keyboardDidHideListener = Keyboard.addListener('keyboardDidHide', () => {
      animateEditingZone(0); // Redescend quand le clavier disparaît
    });

    return () => {
      keyboardDidShowListener?.remove();
      keyboardDidHideListener?.remove();
    };
  }, [currentState]);

  // Réinitialiser la position quand on quitte l'édition
  useEffect(() => {
    if (currentState !== 'editing') {
      animateEditingZone(0);
    }
  }, [currentState]);

  // Nettoyage des timers
  useEffect(() => {
    return () => {
      stopUnifiedTimer();
      if (recordingInterval.current) clearInterval(recordingInterval.current);
    };
  }, []);

  // Rendu des composants UI
  const renderTopBar = () => (
    <View style={styles.topBar}>
      <IconButton
        type="action"
        icon={<Ionicons name="ellipsis-horizontal" size={20} />}
        onPress={() => {
          trigger('button-tap');
          setShowSettings(true);
        }}
        size={44}
        backgroundColor={COLORS.surface}
      />

      <IconButton
        type="action"
        icon={<Ionicons name="information-circle-outline" size={20} />}
        onPress={() => {
          trigger('button-tap');
          setShowDebateInfo(true);
        }}
        size={44}
        backgroundColor={COLORS.surface}
      />
    </View>
  );

  const renderPlayerAvatar = (player: LocalPlayer, scale: Animated.Value, opacity: Animated.Value) => {
    const isCurrentPlayer = player.id === currentPlayerTurn;
    const isTimerCritical = player.timer <= 10;
    const timerColor = isTimerCritical ? COLORS.RED_ERROR : COLORS.PAPER_IVORY;

    return (
      <Animated.View
        style={[
          styles.playerContainer,
          isCurrentPlayer ? styles.activePlayerContainer : styles.inactivePlayerContainer,
          {
            transform: [{ scale }],
            opacity,
            zIndex: isCurrentPlayer ? 2 : 1
          }
        ]}
      >
        {/* Avatar avec bordure neomorphic */}
        <View style={[
          styles.avatar,
          isCurrentPlayer ? styles.activeAvatar : styles.inactiveAvatar,
          isTimerCritical && isCurrentPlayer && styles.criticalAvatar
        ]}>
          <Text style={[
            styles.avatarText,
            !isCurrentPlayer && styles.inactiveAvatarText
          ]}>
            {player.name.charAt(0).toUpperCase()}
          </Text>
        </View>

        {/* Nom du joueur */}
        <Text style={[
          styles.playerName,
          isCurrentPlayer ? styles.activePlayerName : styles.inactivePlayerName
        ]}>
          {player.name}
        </Text>

        {/* Timer avec style card */}
        <View style={[
          styles.timerContainer,
          isCurrentPlayer && styles.activeTimerContainer,
          isTimerCritical && isCurrentPlayer && styles.criticalTimerContainer
        ]}>
          <Text style={[styles.timer, { color: timerColor }]}>
            {formatTime(player.timer)}
          </Text>
        </View>

        {/* Compteur d'arguments */}
        <Text style={styles.argCount}>
          {currentDebate.arguments.filter((a: any) => a.playerId === player.id).length} arg.
        </Text>

        {/* Badge d'alerte critique */}
        {isCurrentPlayer && isTimerCritical && (
          <View style={styles.criticalTimerWarning}>
            <Text style={styles.criticalTimerText}>{t('debates.game.criticalTime')}</Text>
          </View>
        )}
      </Animated.View>
    );
  };

  const renderActionZone = () => {
    switch (currentState) {
      case 'idle':
        return (
          <View style={styles.idleContainer}>
            <Text style={styles.idleHint}>{t('debates.game.tapToSpeak')}</Text>
            <TouchableOpacity
              style={styles.micButton}
              onPress={handleStartRecording}
              activeOpacity={0.9}
            >
              <View style={styles.micButtonInner}>
                <Ionicons name="mic" size={48} color={COLORS.NIGHT_BLUE} />
              </View>
            </TouchableOpacity>
          </View>
        );

      case 'recording':
        return (
          <View style={styles.recordingContainer}>
            <Text style={styles.recordingText}>{t('debates.game.listening')}</Text>

            {/* Bouton avec effet sablier */}
            <RecordingButton
              onPress={handleStopRecording}
              recordingTime={recordingTime}
              maxRecordingTime={maxRecordingTime}
            />
          </View>
        );

      case 'transcribing':
        return (
          <View style={styles.transcribingContainer}>
            <View style={styles.transcribingCard}>
              <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
              <Text style={styles.transcribingText}>{t('debates.game.transcribing')}</Text>
            </View>
          </View>
        );

      case 'editing':
        return (
          <Animated.View
            style={[
              styles.editingContainer,
              {
                transform: [{ translateY: editingContainerTranslateY }]
              }
            ]}
          >
            <View style={styles.editingCard}>
              <TextInput
                style={styles.editingInput}
                value={editedText}
                onChangeText={setEditedText}
                multiline
                placeholder={t('debates.game.editPlaceholder')}
                placeholderTextColor={COLORS.GREY_MEDIUM}
                textAlignVertical="top"
                autoFocus={true}
                blurOnSubmit={false}
                maxLength={650}
                numberOfLines={6}
                scrollEnabled={true}
              />
            </View>
            <PrimaryButton
              onPress={handleSubmitArgument}
              style={styles.submitButton}
            >
              {t('debates.game.passToOpponent')}
            </PrimaryButton>
          </Animated.View>
        );

      case 'switchingPlayer':
        return (
          <View style={styles.switchingContainer}>
            <View style={styles.switchingCard}>
              <Text style={styles.switchingEmoji}>🎯</Text>
              <Text style={styles.switchingText}>{t('debates.game.yourTurn')}</Text>
              <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} style={{ marginTop: 16 }} />
            </View>
          </View>
        );

      default:
        return null;
    }
  };

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <View style={styles.mainContent}>
            {renderTopBar()}

            <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
              <View style={styles.playersSection}>
                {renderPlayerAvatar(player1, player1Scale, player1Opacity)}

                {/* AutoSend toggle */}
                <View style={styles.autoSendContainer}>
                  <Switch
                    value={autoSend}
                    onValueChange={toggleAutoSend}
                    trackColor={{ false: COLORS.surfaceDark, true: COLORS.YELLOW_CORE + '80' }}
                    thumbColor={autoSend ? COLORS.YELLOW_CORE : COLORS.GREY_MEDIUM}
                  />
                  <Text style={[styles.autoSendLabel, autoSend && styles.autoSendLabelActive]}>
                    {t('debates.game.autoSend')}
                  </Text>
                </View>

                {renderPlayerAvatar(player2, player2Scale, player2Opacity)}
              </View>
            </TouchableWithoutFeedback>

            <View style={styles.actionSection}>
              {renderActionZone()}
            </View>
          </View>
        </TouchableWithoutFeedback>
      </SafeAreaView>

      {/* Modal Informations du débat */}
      <Modal
        visible={showDebateInfo}
        transparent
        animationType="fade"
        onRequestClose={() => setShowDebateInfo(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalOverlayTouchable}
            activeOpacity={1}
            onPress={() => setShowDebateInfo(false)}
          />

          <View style={styles.modalCard}>
            {/* Header avec close button */}
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>{t('debates.game.debateInfo')}</Text>
              <IconButton
                type="action"
                icon={<Ionicons name="close" size={18} />}
                onPress={() => {
                  trigger('button-tap');
                  setShowDebateInfo(false);
                }}
                size={36}
                backgroundColor={COLORS.surfaceDark}
              />
            </View>

            <ScrollView style={styles.modalContent} showsVerticalScrollIndicator={false}>
              {/* Titre du débat en gros */}
              <Text style={styles.debateTitleBig}>{localDebate.title}</Text>

              {/* Joueur 1 */}
              <View style={styles.playerInfoSection}>
                <View style={styles.playerInfoHeader}>
                  <View style={styles.miniAvatar}>
                    <Text style={styles.miniAvatarText}>{player1.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.playerInfoName}>{player1.name}</Text>
                </View>
                <Text style={styles.viewpointText}>"{player1.viewpoint}"</Text>
              </View>

              {/* Joueur 2 */}
              <View style={styles.playerInfoSection}>
                <View style={styles.playerInfoHeader}>
                  <View style={[styles.miniAvatar, styles.miniAvatarSecondary]}>
                    <Text style={styles.miniAvatarText}>{player2.name.charAt(0).toUpperCase()}</Text>
                  </View>
                  <Text style={styles.playerInfoName}>{player2.name}</Text>
                </View>
                <Text style={styles.viewpointText}>"{player2.viewpoint}"</Text>
              </View>

              {/* Contexte privé */}
              {localDebate.privateContext && (
                <View style={styles.infoSection}>
                  <Text style={styles.infoLabel}>{t('debates.game.context')}</Text>
                  <Text style={styles.infoValue}>{localDebate.privateContext}</Text>
                </View>
              )}

              {/* Temps par argument */}
              <View style={styles.infoSection}>
                <Text style={styles.infoLabel}>{t('debates.game.timePerArgument')}</Text>
                <View style={styles.timeBadge}>
                  <Ionicons name="time-outline" size={16} color={COLORS.YELLOW_CORE} />
                  <Text style={styles.timeBadgeText}>{localDebate.maxArgumentTime}s</Text>
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* Modal Paramètres */}
      <Modal
        visible={showSettings}
        transparent
        animationType="fade"
        onRequestClose={() => setShowSettings(false)}
      >
        <View style={styles.modalOverlay}>
          <TouchableOpacity
            style={styles.modalOverlayTouchable}
            activeOpacity={1}
            onPress={() => setShowSettings(false)}
          />

          <View style={styles.menuPopup}>
            <Text style={styles.menuTitle}>{t('debates.async.screen.menuOptions')}</Text>

            {/* Bouton Arrêter le débat */}
            <AnimatedMenuButton
              style={[styles.menuButton, styles.menuButtonQuit]}
              onPress={() => {
                trigger('button-tap');
                setShowSettings(false);
                handleQuit();
              }}
            >
              <Text style={styles.menuButtonIcon}>🛑</Text>
              <View style={styles.menuButtonTextContainer}>
                <Text style={[styles.menuButtonText, styles.menuButtonQuitText]}>
                  {t('debates.game.stopDebateButton')}
                </Text>
              </View>
            </AnimatedMenuButton>
          </View>
        </View>
      </Modal>

      {/* Overlay d'attente pour le scoring */}
      {analysisWaitState?.isWaiting && (
        <View style={styles.analysisWaitOverlay}>
          <View style={styles.analysisWaitCard}>
            {/* Icône */}
            <View style={styles.analysisSpinnerContainer}>
              <Ionicons
                name="hourglass-outline"
                size={40}
                color={COLORS.YELLOW_CORE}
              />
            </View>

            {/* Message principal */}
            <Text style={styles.analysisWaitMessage}>
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
    </View>
  );
};

const styles = StyleSheet.create({
  // ========== CONTAINER PRINCIPAL ==========
  container: {
    flex: 1,
    backgroundColor: COLORS.NIGHT_BLUE,
  },
  safeArea: {
    flex: 1,
    zIndex: 1,
  },
  mainContent: {
    flex: 1,
  },

  // ========== TOP BAR ==========
  topBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 12,
  },

  // ========== PLAYERS SECTION ==========
  playersSection: {
    flex: 1,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  autoSendContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 24,
    gap: 4,
  },
  autoSendLabel: {
    fontSize: 10,
    fontFamily: 'Raleway-Bold',
    color: COLORS.GREY_MEDIUM,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  autoSendLabelActive: {
    color: COLORS.YELLOW_CORE,
  },
  playerContainer: {
    alignItems: 'center',
    padding: 16,
  },
  activePlayerContainer: {
    // Le joueur actif a plus de visibilité
  },
  inactivePlayerContainer: {
    // Le joueur inactif est atténué via opacity/scale
  },

  // Avatar avec bordure neomorphic
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  activeAvatar: {
    backgroundColor: COLORS.YELLOW_CORE,
  },
  inactiveAvatar: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.GREY_MEDIUM,
  },
  criticalAvatar: {
    borderColor: COLORS.RED_ERROR,
    borderWidth: 4,
  },
  avatarText: {
    fontSize: 32,
    fontFamily: 'Raleway-Black',
    color: COLORS.NIGHT_BLUE,
  },
  inactiveAvatarText: {
    color: COLORS.GREY_MEDIUM,
  },

  // Nom du joueur
  playerName: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    marginBottom: 8,
  },
  activePlayerName: {
    color: COLORS.YELLOW_CORE,
  },
  inactivePlayerName: {
    color: COLORS.GREY_MEDIUM,
  },

  // Timer container avec style card
  timerContainer: {
    backgroundColor: COLORS.surfaceDark,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  activeTimerContainer: {
    backgroundColor: COLORS.surface,
    borderColor: COLORS.YELLOW_CORE,
  },
  criticalTimerContainer: {
    backgroundColor: COLORS.RED_ERROR + '20',
    borderColor: COLORS.RED_ERROR,
  },
  timer: {
    fontSize: 20,
    fontFamily: 'Raleway-ExtraBold',
  },

  // Badge d'alerte critique
  argCount: {
    fontSize: 18,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
    opacity: 0.7,
    marginTop: 6,
  },
  criticalTimerWarning: {
    marginTop: 8,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: COLORS.RED_ERROR,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  criticalTimerText: {
    color: COLORS.white,
    fontSize: 10,
    fontFamily: 'Raleway-ExtraBold',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ========== ACTION SECTION ==========
  actionSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingBottom: 40,
  },

  // État Idle
  idleContainer: {
    alignItems: 'center',
    gap: 20,
  },
  idleHint: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    marginBottom: 8,
  },
  micButton: {
    width: 120,
    height: 120,
    borderRadius: 60,
    backgroundColor: COLORS.YELLOW_CORE,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 4,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 6,
  },
  micButtonInner: {
    justifyContent: 'center',
    alignItems: 'center',
  },

  // État Recording
  recordingContainer: {
    alignItems: 'center',
    gap: 20,
  },
  recordingText: {
    fontSize: 18,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
    marginBottom: 8,
  },

  // Bouton d'enregistrement avec effet sablier
  recordingButtonOuter: {
    alignItems: 'center',
    gap: 16,
  },
  recordingButtonContainer: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: COLORS.INK,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceDark,
    position: 'relative',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 6,
  },
  recordingButtonEmpty: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: COLORS.surfaceDark,
  },
  recordingButtonFill: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.YELLOW_CORE,
  },
  recordingButtonIconContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
  },

  // Badge compte à rebours
  countdownBadge: {
    backgroundColor: COLORS.surface,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 3,
  },
  countdownBadgeWarning: {
    borderColor: '#FF9500',
    backgroundColor: '#FF950020',
  },
  countdownBadgeCritical: {
    borderColor: COLORS.RED_ERROR,
    backgroundColor: COLORS.RED_ERROR + '20',
  },
  countdownText: {
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },
  countdownTextCritical: {
    color: COLORS.RED_ERROR,
  },

  // État Transcribing
  transcribingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  transcribingCard: {
    backgroundColor: COLORS.surface,
    padding: 32,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  transcribingText: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },

  // État Editing
  editingContainer: {
    flex: 1,
    width: '100%',
    paddingHorizontal: 16,
    paddingBottom: 20,
    justifyContent: 'flex-end',
  },
  editingCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    padding: 4,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  editingInput: {
    backgroundColor: 'transparent',
    borderRadius: 12,
    padding: 16,
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    height: 150,
    textAlignVertical: 'top',
  },
  submitButton: {
    width: '100%',
  },

  // État Switching
  switchingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchingCard: {
    backgroundColor: COLORS.surface,
    padding: 40,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.YELLOW_CORE,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  switchingEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  switchingText: {
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    color: COLORS.YELLOW_CORE,
  },

  // ========== MODALS ==========
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalOverlayTouchable: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },
  modalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    width: '100%',
    maxWidth: 360,
    maxHeight: '80%',
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
    padding: 16,
    borderBottomWidth: 2,
    borderBottomColor: COLORS.surfaceDark,
  },
  modalTitle: {
    fontSize: 20,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },
  modalContent: {
    padding: 16,
  },

  // Info Modal - Titre du débat en gros
  debateTitleBig: {
    fontSize: 22,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 28,
  },

  // Info Modal
  infoSection: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  infoLabel: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 6,
  },
  infoValue: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    lineHeight: 20,
  },
  playerInfoSection: {
    marginBottom: 16,
    padding: 12,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  playerInfoHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 10,
  },
  miniAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.YELLOW_CORE,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  miniAvatarSecondary: {
    backgroundColor: COLORS.ROYAL_BLUE,
  },
  miniAvatarText: {
    fontSize: 14,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.NIGHT_BLUE,
  },
  playerInfoName: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },
  viewpointText: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  timeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surface,
    alignSelf: 'flex-start',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: COLORS.YELLOW_CORE,
  },
  timeBadgeText: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
  },

  // Settings Modal - Menu style (matching AsyncDebateScreen)
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
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 10,
  },
  menuTitle: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 16,
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
  menuButtonQuit: {
    backgroundColor: COLORS.RED_ERROR + '20',
  },
  menuButtonQuitText: {
    color: COLORS.RED_ERROR,
  },
  aboutSection: {
    padding: 12,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  aboutLabel: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  aboutText: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    lineHeight: 18,
  },

  // Waiting Modal
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
});