import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  FadeIn,
  FadeOut,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { RootStackScreenProps } from '../../types/navigation';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import LocalDuelService from '../../services/local-duel.service';
import ArgumentsService from '../../services/arguments.service';
import { useDebateLimits } from '../../hooks/useDebateLimits';
import { PremiumPaywall } from '../../components/PremiumPaywall';
import { usePremiumPrompt } from '../../hooks/usePremiumPrompt';
import { DebateRejectionModal } from '../../components/DebateRejectionModal';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { IconButton } from '../../components/IconButton';
import { usePostHog, PostHogEvents } from '../../hooks/usePostHog';
import { useHaptics } from '../../hooks/useHaptics';
import { checkMultipleFields } from '../../utils/profanityFilter';

type Props = RootStackScreenProps<'LocalDuelSetup'>;

type GameMode = 'COMPETITIVE' | 'EXPLORATORY';

// Composant animé pour un bouton de sélection de mode
const AnimatedTypeButton: React.FC<{
  selected: boolean;
  onPress: () => void;
  icon: string;
  title: string;
}> = ({ selected, onPress, icon, title }) => {
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
    const translateY = pressAnimation.value * 3;
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
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={onPress}
      activeOpacity={1}
      style={{ flex: 1 }}
    >
      <Animated.View
        style={[
          styles.typeButton,
          selected && styles.typeButtonSelected,
          animatedStyle,
        ]}
      >
        <Text style={styles.typeButtonIcon}>{icon}</Text>
        <Text style={[
          styles.typeButtonTitle,
          selected && styles.typeButtonTitleSelected
        ]}>
          {title}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

interface LocalDebateSetup {
  title: string;
  userViewpoint: string;
  guestName: string;
  guestViewpoint: string;
  privateContext: string;
  gameMode: GameMode;
  duration: 2 | 5 | 10;
  maxArgumentTime: 30 | 60 | 90;
}

export const LocalDuelSetupScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { checkDebateLimit, getDaysUntilReset } = useDebateLimits();
  const posthog = usePostHog();
  const { trigger } = useHaptics();
  const premium = usePremiumPrompt();

  // Track debate creation started
  useEffect(() => {
    posthog.capture('debate_creation_started', {
      debate_type: 'local',
    });
  }, []);

  const [setup, setSetup] = useState<LocalDebateSetup>({
    title: '',
    userViewpoint: '',
    guestName: '',
    guestViewpoint: '',
    privateContext: '',
    gameMode: 'COMPETITIVE',
    duration: 5,
    maxArgumentTime: 30,
  });

  const [showAdvancedSettings, setShowAdvancedSettings] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  // États pour l'overlay de préparation
  const [showPreparationOverlay, setShowPreparationOverlay] = useState(false);
  const [preparationCountdown, setPreparationCountdown] = useState(5);
  const [framingStatus, setFramingStatus] = useState<'idle' | 'analyzing' | 'accepted' | 'rejected'>('idle');
  const [framingResult, setFramingResult] = useState<any>(null);

  // États pour le modal de rejet
  const [showRejectionModal, setShowRejectionModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');
  const [rejectionMessage, setRejectionMessage] = useState('');

  // Refs pour le scroll automatique
  const scrollViewRef = useRef<ScrollView>(null);
  const titleInputRef = useRef<TextInput>(null);
  const userViewpointInputRef = useRef<TextInput>(null);
  const guestNameInputRef = useRef<TextInput>(null);
  const guestViewpointInputRef = useRef<TextInput>(null);

  // Validation functions
  const isTitleValid = (): boolean => {
    return setup.title.trim().length >= 15;
  };

  const isUserViewpointValid = (): boolean => {
    return setup.userViewpoint.trim().length > 0 && setup.userViewpoint.trim().length <= 100;
  };

  const isGuestNameValid = (): boolean => {
    return setup.guestName.trim().length > 0 && setup.guestName.trim().length <= 30;
  };

  const isGuestViewpointValid = (): boolean => {
    return setup.guestViewpoint.trim().length > 0 && setup.guestViewpoint.trim().length <= 100;
  };

  const isFormValid = (): boolean => {
    return isTitleValid() &&
           isUserViewpointValid() &&
           isGuestNameValid() &&
           isGuestViewpointValid();
  };

  const handleCreateLocalDebate = async () => {
    trigger('button-tap');
    if (!isFormValid()) {
      trigger('button-error');
      Alert.alert(t('debates.local.incompleteForm'), t('debates.local.fillAllFields'));
      return;
    }

    // Vérifier le contenu pour insultes/contenu inapproprié et emojis
    const contentCheck = checkMultipleFields({
      title: setup.title,
      userViewpoint: setup.userViewpoint,
      guestViewpoint: setup.guestViewpoint,
    });

    // Vérifier d'abord les emojis
    if (contentCheck.hasEmoji) {
      trigger('button-error');
      Alert.alert(
        t('moderation.emojiDetected'),
        t('moderation.pleaseRemoveEmoji')
      );
      return;
    }

    // Puis vérifier le contenu inapproprié
    if (!contentCheck.isClean) {
      trigger('button-error');
      Alert.alert(
        t('moderation.profanityDetected'),
        t('moderation.pleaseRemoveInappropriate')
      );
      return;
    }

    // Vérifier la limite de débats AVANT la création
    const debateCheck = checkDebateLimit();
    if (!debateCheck.canDebate) {
      premium.promptPremium({ type: 'monthlyLimit', currentCount: debateCheck.currentCount, limit: debateCheck.limit, daysUntilReset: getDaysUntilReset() });
      return;
    }

    try {
      setIsLoading(true);

      // Vérifier le token avant de créer
      if (!user?.token) {
        throw new Error(t('debates.local.mustBeLoggedIn'));
      }

      // Créer le débat via LocalDuelService (avec appel backend)
      const localDebate = await LocalDuelService.createLocalDebate({
        title: setup.title.trim(),
        player1: {
          name: user?.username || 'Joueur 1',
          viewpoint: setup.userViewpoint.trim(),
          timer: setup.duration * 60
        },
        player2: {
          name: setup.guestName.trim(),
          viewpoint: setup.guestViewpoint.trim(),
          timer: setup.duration * 60
        },
        privateContext: setup.privateContext.trim() || undefined,
        gameMode: setup.gameMode,
        maxArgumentTime: setup.maxArgumentTime,
      }, user.token);

      console.log('Débat local créé:', localDebate.id);

      // Track local debate creation
      posthog.capture(PostHogEvents.DEBATE_CREATED, {
        debate_id: localDebate.id,
        debate_type: 'local',
        game_mode: setup.gameMode,
        duration: setup.duration,
      });

      // Préparer les données sérialisables pour la navigation
      const serializableDebate = {
        ...localDebate,
        createdAt: localDebate.createdAt.toISOString(),
        updatedAt: localDebate.updatedAt.toISOString(),
        arguments: localDebate.arguments.map(arg => ({
          ...arg,
          timestamp: arg.timestamp.toISOString()
        }))
      };

      // Stocker le débat dans un état local pour la navigation ultérieure
      const debateRef = { current: serializableDebate };

      // Masquer le loader et afficher l'overlay de préparation
      trigger('button-success');
      setIsLoading(false);
      setShowPreparationOverlay(true);
      setPreparationCountdown(5);
      setFramingStatus('analyzing');

      // n8n M0 est déjà lancé par le backend lors de createLocalDebate()
      // Pas besoin d'appeler createLocalDebateFraming() - c'est une duplication
      // La modération se fait maintenant au niveau M1 (par argument)
      const framingPromise = Promise.resolve({
        success: true,
        message: 'n8n M0 analysis started by backend',
        moderationStatus: 'ACCEPTED' // Moderation will happen at M1 level per argument
      });

      // Démarrer le compte à rebours
      startPreparationCountdown(framingPromise, debateRef);

    } catch (error) {
      console.error('Erreur création débat local:', error);
      Alert.alert(t('common.error') || 'Error', t('debates.local.cannotCreateDebate'));
      setIsLoading(false);
    }
  };

  const updateSetup = (field: keyof LocalDebateSetup, value: string | number) => {
    setSetup(prev => ({ ...prev, [field]: value }));
  };

  /**
   * Fonction pour gérer le compte à rebours et l'analyse en parallèle
   */
  const startPreparationCountdown = async (
    framingPromise: Promise<any>,
    debateRef: { current: any }
  ) => {
    let countdown = 5;
    const countdownInterval = setInterval(() => {
      countdown--;
      setPreparationCountdown(countdown);

      if (countdown <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    try {
      // Attendre le résultat de l'analyse
      const framingResultData = await framingPromise;
      console.log('Résultat du cadrage:', framingResultData);

      setFramingResult(framingResultData);

      // Vérifier si le débat est rejeté
      if (!framingResultData.success || framingResultData.moderationStatus === 'REJECTED' ||
          framingResultData.moderationStatus === 'SPAM_DETECTED' ||
          framingResultData.moderationStatus === 'INSULT_DETECTED') {

        console.log('Débat rejeté:', framingResultData.moderationStatus);

        // Arrêter le countdown
        clearInterval(countdownInterval);

        // Masquer l'overlay de préparation
        setShowPreparationOverlay(false);
        setFramingStatus('rejected');

        // Définir les messages de rejet
        const reason = framingResultData.moderationStatus === 'SPAM_DETECTED'
          ? 'Débat détecté comme spam ou non sérieux'
          : framingResultData.moderationStatus === 'INSULT_DETECTED'
          ? 'Contenu inapproprié ou insultant détecté'
          : 'Débat rejeté par la modération';

        setRejectionReason(reason);
        setRejectionMessage(
          framingResultData.rejectionReason ||
          framingResultData.message ||
          'Le débat ne respecte pas les critères de qualité requis.'
        );

        // Afficher le modal de rejet
        setShowRejectionModal(true);
        return;
      }

      // Le débat est accepté, attendre la fin du countdown
      console.log('Débat accepté, attente fin du countdown...');
      setFramingStatus('accepted');

      // Attendre que le countdown atteigne 0
      while (countdown > 0) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Masquer l'overlay
      setShowPreparationOverlay(false);

      // Naviguer vers l'écran de jeu
      console.log('Navigation vers LocalDuelGame');
      navigation.navigate('LocalDuelGame', { localDebate: debateRef.current });

    } catch (error) {
      console.error('Erreur pendant le countdown:', error);
      clearInterval(countdownInterval);
      setShowPreparationOverlay(false);
      Alert.alert(t('common.error'), t('debates.local.analysisError'));
    }
  };

  // Fonction pour scroller automatiquement vers l'input actif
  const scrollToInput = (inputRef: React.RefObject<TextInput>) => {
    if (scrollViewRef.current && inputRef.current) {
      setTimeout(() => {
        inputRef.current?.measure((x, y, width, height, pageX, pageY) => {
          const scrollOffset = pageY - 100;
          scrollViewRef.current?.scrollTo({
            y: Math.max(0, scrollOffset),
            animated: true,
          });
        });
      }, 100);
    }
  };

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Close button */}
        <View style={styles.closeButtonContainer}>
          <IconButton
            type="action"
            icon={<Ionicons name="close" size={24} />}
            onPress={() => {
              trigger('button-tap');
              navigation.goBack();
            }}
            size={44}
            backgroundColor={COLORS.surface}
          />
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={styles.keyboardAvoidingView}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <ScrollView
              ref={scrollViewRef}
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.scrollContent}
            >
              {/* Header */}
              <View style={styles.header}>
                <Text style={styles.screenTitle}>{t('debates.local.title')}</Text>
              </View>

              {/* Titre du débat */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('debates.local.debateTitle')}</Text>
                <TextInput
                  ref={titleInputRef}
                  style={[
                    styles.input,
                    styles.titleInput,
                    setup.title.length > 0 && !isTitleValid() && styles.inputError
                  ]}
                  placeholder={t('debates.local.debateTitlePlaceholder2')}
                  placeholderTextColor={COLORS.GREY_MEDIUM}
                  value={setup.title}
                  onChangeText={(text) => updateSetup('title', text)}
                  onFocus={() => scrollToInput(titleInputRef)}
                  maxLength={200}
                  multiline
                  blurOnSubmit={true}
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
                <View style={styles.charCountRow}>
                  <Text style={styles.charCount}>
                    {t('debates.local.characterCount', { count: setup.title.length, max: 200 })}
                  </Text>
                  {setup.title.length > 0 && !isTitleValid() && (
                    <Text style={styles.errorText}>{t('debates.local.minCharacters')}</Text>
                  )}
                </View>
              </View>

              {/* Votre position - Affichée si titre valide */}
              {isTitleValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  exiting={FadeOut.duration(300)}
                  style={[styles.section, styles.hostSection]}
                >
                  <Text style={[styles.sectionTitle, styles.hostTitle]}>
                    {t('debates.local.yourPosition', { username: user?.username || 'Vous' })}
                  </Text>
                  <TextInput
                    ref={userViewpointInputRef}
                    style={[
                      styles.input,
                      styles.viewpointInput,
                      styles.hostInput,
                      setup.userViewpoint.length > 0 && !isUserViewpointValid() && styles.inputError
                    ]}
                    placeholder={t('debates.local.userViewpointPlaceholder2')}
                    placeholderTextColor={COLORS.GREY_MEDIUM}
                    value={setup.userViewpoint}
                    onChangeText={(text) => updateSetup('userViewpoint', text)}
                    onFocus={() => scrollToInput(userViewpointInputRef)}
                    maxLength={100}
                    multiline
                    numberOfLines={3}
                    blurOnSubmit={true}
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                  {setup.userViewpoint.length > 100 && (
                    <Text style={styles.errorText}>{t('debates.local.maxCharacters')}</Text>
                  )}
                </Animated.View>
              )}

              {/* Position de l'adversaire - Affichée si position utilisateur valide */}
              {isTitleValid() && isUserViewpointValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  exiting={FadeOut.duration(300)}
                  style={[styles.section, styles.guestSection]}
                >
                  <Text style={[styles.sectionTitle, styles.guestTitle]}>
                    {t('debates.local.guestPlayer')}
                  </Text>
                  <TextInput
                    ref={guestNameInputRef}
                    style={[
                      styles.input,
                      styles.nameInput,
                      styles.guestInput,
                      setup.guestName.length > 0 && !isGuestNameValid() && styles.inputError
                    ]}
                    placeholder={t('debates.local.guestNamePlaceholder2')}
                    placeholderTextColor={COLORS.GREY_MEDIUM}
                    value={setup.guestName}
                    onChangeText={(text) => updateSetup('guestName', text)}
                    onFocus={() => scrollToInput(guestNameInputRef)}
                    maxLength={30}
                  />

                  {isGuestNameValid() && (
                    <Animated.View entering={FadeIn.duration(300)}>
                      <Text style={[styles.sectionTitle, styles.guestTitle, styles.viewpointMargin]}>
                        {t('debates.local.viewpoint')}
                      </Text>
                      <TextInput
                        ref={guestViewpointInputRef}
                        style={[
                          styles.input,
                          styles.viewpointInput,
                          styles.guestInput,
                          setup.guestViewpoint.length > 0 && !isGuestViewpointValid() && styles.inputError
                        ]}
                        placeholder={t('debates.local.guestViewpointPlaceholder2')}
                        placeholderTextColor={COLORS.GREY_MEDIUM}
                        value={setup.guestViewpoint}
                        onChangeText={(text) => updateSetup('guestViewpoint', text)}
                        onFocus={() => scrollToInput(guestViewpointInputRef)}
                        maxLength={100}
                        multiline
                        numberOfLines={3}
                        blurOnSubmit={true}
                        onSubmitEditing={() => Keyboard.dismiss()}
                      />
                      {setup.guestViewpoint.length > 100 && (
                        <Text style={styles.errorText}>{t('debates.local.maxCharacters')}</Text>
                      )}
                    </Animated.View>
                  )}
                </Animated.View>
              )}

              {/* Mode de jeu - Affiché si formulaire valide */}
              {isFormValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  exiting={FadeOut.duration(300)}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{t('debates.create.gameMode')}</Text>
                  <View style={styles.typeButtonsContainer}>
                    <AnimatedTypeButton
                      selected={setup.gameMode === 'COMPETITIVE'}
                      onPress={() => {
                        trigger('selection');
                        updateSetup('gameMode', 'COMPETITIVE');
                      }}
                      icon="⚔️"
                      title={t('debates.create.gameModeCompetitive')}
                    />
                    <AnimatedTypeButton
                      selected={setup.gameMode === 'EXPLORATORY'}
                      onPress={() => {
                        trigger('selection');
                        updateSetup('gameMode', 'EXPLORATORY');
                      }}
                      icon="🔍"
                      title={t('debates.create.gameModeExploratory')}
                    />
                  </View>
                  <Text style={styles.gameModeHint}>
                    {setup.gameMode === 'COMPETITIVE'
                      ? t('debates.create.gameModeHintCompetitive')
                      : t('debates.create.gameModeHintExploratory')
                    }
                  </Text>
                </Animated.View>
              )}

              {/* Configuration du temps - Affichée si formulaire valide */}
              {isFormValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{t('debates.local.durationPerPlayer')}</Text>
                  <View style={styles.durationContainer}>
                    {[2, 5, 10].map((duration) => (
                      <TouchableOpacity
                        key={duration}
                        style={[
                          styles.durationChip,
                          setup.duration === duration && styles.durationChipSelected
                        ]}
                        onPress={() => {
                          trigger('selection');
                          updateSetup('duration', duration as 2 | 5 | 10);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[
                          styles.durationText,
                          setup.duration === duration && styles.durationTextSelected
                        ]}>
                          {duration === 2 ? '🔥' : duration === 5 ? '⚡' : '🕐'} {duration} min
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {/* Options avancées */}
                  <TouchableOpacity
                    style={styles.advancedOptionsToggle}
                    onPress={() => {
                      trigger('button-tap');
                      setShowAdvancedSettings(!showAdvancedSettings);
                    }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.advancedOptionsText}>{t('debates.local.moreOptions')}</Text>
                    <Ionicons
                      name={showAdvancedSettings ? 'chevron-up' : 'chevron-down'}
                      size={20}
                      color={COLORS.YELLOW_CORE}
                    />
                  </TouchableOpacity>

                  {showAdvancedSettings && (
                    <Animated.View
                      entering={FadeIn.duration(300)}
                      style={styles.advancedOptionsContent}
                    >
                      <Text style={styles.advancedOptionsLabel}>
                        {t('debates.local.maxArgumentTimeLabel')}
                      </Text>
                      <View style={styles.argumentTimeContainer}>
                        {[30, 60, 90].map((time) => (
                          <TouchableOpacity
                            key={time}
                            style={[
                              styles.argumentTimeChip,
                              setup.maxArgumentTime === time && styles.argumentTimeChipSelected
                            ]}
                            onPress={() => {
                              trigger('selection');
                              updateSetup('maxArgumentTime', time as 30 | 60 | 90);
                            }}
                            activeOpacity={0.7}
                          >
                            <Text style={[
                              styles.argumentTimeText,
                              setup.maxArgumentTime === time && styles.argumentTimeTextSelected
                            ]}>
                              {`${time}s`}
                            </Text>
                          </TouchableOpacity>
                        ))}
                      </View>
                    </Animated.View>
                  )}
                </Animated.View>
              )}

              {/* Bouton de création */}
              {isFormValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.ctaSection}
                >
                  <PrimaryButton
                    onPress={handleCreateLocalDebate}
                    disabled={isLoading}
                    style={styles.createButton}
                    textStyle={styles.createButtonText}
                  >
                    {isLoading ? (
                      <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={COLORS.NIGHT_BLUE} />
                        <Text style={styles.createButtonText}>{t('debates.local.preparing')}</Text>
                      </View>
                    ) : (
                      t('debates.local.startDebate')
                    )}
                  </PrimaryButton>
                </Animated.View>
              )}

              <View style={styles.bottomSpacer} />
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Premium paywall */}
      <PremiumPaywall
        visible={premium.showPaywall}
        onClose={premium.closePaywall}
        onPurchaseSuccess={premium.closePaywall}
        trigger={premium.paywallTrigger}
      />

      {/* Overlay de préparation avec compte à rebours */}
      {showPreparationOverlay && (
        <View style={styles.phaseOverlay}>
          <View style={styles.phaseContainer}>
            <Text style={styles.phaseTitle}>
              {t('debates.local.preparation')}
            </Text>
            <Text style={styles.countdownSubtext}>
              {framingStatus === 'analyzing'
                ? t('debates.local.analyzingDebate')
                : t('debates.live.debateStartsIn')}
            </Text>
            <Text style={styles.countdownNumber}>{preparationCountdown}</Text>

            <View style={styles.debateInfoOverlay}>
              <Text style={styles.debateTitleOverlay}>{setup.title}</Text>

              <View style={styles.opponentsInfo}>
                <View style={styles.opponentInfoCard}>
                  <Text style={styles.opponentRole}>{t('debates.local.player1')}</Text>
                  <Text style={styles.opponentNameOverlay}>
                    {user?.username || t('debates.local.you')}
                  </Text>
                  <Text style={styles.opponentViewOverlay}>
                    "{setup.userViewpoint}"
                  </Text>
                </View>

                <View style={styles.yourInfoCard}>
                  <Text style={styles.yourRole}>{t('debates.local.player2')}</Text>
                  <Text style={styles.yourNameOverlay}>
                    {setup.guestName}
                  </Text>
                  <Text style={styles.yourViewOverlay}>
                    "{setup.guestViewpoint}"
                  </Text>
                </View>
              </View>
            </View>
          </View>
        </View>
      )}

      {/* Modal de rejet du débat */}
      <DebateRejectionModal
        visible={showRejectionModal}
        reason={rejectionReason}
        message={rejectionMessage}
        onGoBack={() => {
          setShowRejectionModal(false);
          // Reset des états pour permettre une nouvelle tentative
          setFramingStatus('idle');
          setFramingResult(null);
        }}
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
  keyboardAvoidingView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 25,
    paddingBottom: 40,
  },

  // Close button
  closeButtonContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 100,
  },

  // Header
  header: {
    marginBottom: 30,
  },
  screenTitle: {
    fontSize: 32,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },

  // Sections
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
    marginBottom: 10,
  },

  // Sections colorées
  hostSection: {
    backgroundColor: COLORS.YELLOW_CORE + '15',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.YELLOW_CORE,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  guestSection: {
    backgroundColor: COLORS.ROYAL_BLUE + '15',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.ROYAL_BLUE,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  hostTitle: {
    color: COLORS.YELLOW_CORE,
  },
  guestTitle: {
    color: COLORS.ROYAL_BLUE,
  },
  viewpointMargin: {
    marginTop: 16,
  },

  // Inputs
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  titleInput: {
    minHeight: 70,
    textAlignVertical: 'top',
  },
  nameInput: {
    minHeight: 50,
  },
  viewpointInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  hostInput: {
    borderColor: COLORS.YELLOW_CORE + '80',
  },
  guestInput: {
    borderColor: COLORS.ROYAL_BLUE + '80',
  },
  inputError: {
    borderColor: COLORS.RED_ERROR,
  },

  // Validation
  charCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 8,
  },
  charCount: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
  },
  errorText: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.RED_ERROR,
  },

  // Durée
  durationContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  durationChip: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  durationChipSelected: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },
  durationText: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },
  durationTextSelected: {
    color: COLORS.NIGHT_BLUE,
  },

  // Mode de jeu (type buttons)
  typeButtonsContainer: {
    flexDirection: 'row',
    gap: 10,
  },
  typeButton: {
    backgroundColor: COLORS.surface,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  typeButtonSelected: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },
  typeButtonIcon: {
    fontSize: 24,
    marginBottom: 6,
  },
  typeButtonTitle: {
    fontSize: 14,
    fontFamily: 'Raleway-Black',
    color: COLORS.textPrimary,
  },
  typeButtonTitleSelected: {
    color: COLORS.NIGHT_BLUE,
  },
  gameModeHint: {
    fontSize: 12,
    fontFamily: 'Raleway-Regular',
    color: COLORS.GREY_MEDIUM,
    marginTop: 8,
    textAlign: 'center',
  },

  // Options avancées
  advancedOptionsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
  },
  advancedOptionsText: {
    color: COLORS.YELLOW_CORE,
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
  },
  advancedOptionsContent: {
    marginTop: 12,
  },
  advancedOptionsLabel: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
    marginBottom: 10,
  },
  argumentTimeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  argumentTimeChip: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  argumentTimeChipSelected: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },
  argumentTimeText: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },
  argumentTimeTextSelected: {
    color: COLORS.NIGHT_BLUE,
  },

  // CTA Section
  ctaSection: {
    alignItems: 'center',
    paddingTop: 20,
  },
  createButton: {
    width: '100%',
    paddingVertical: 18,
  },
  createButtonText: {
    fontSize: 18,
  },
  loadingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  bottomSpacer: {
    height: 40,
  },

  // Overlay de préparation (matching DebateScreen intro overlay)
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
  countdownSubtext: {
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  countdownNumber: {
    fontSize: 72,
    fontFamily: 'Raleway-Black',
    color: COLORS.YELLOW_CORE,
    textAlign: 'center',
    marginBottom: 30,
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
  yourNameOverlay: {
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
});
