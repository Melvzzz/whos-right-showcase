import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
  KeyboardAvoidingView,
  Modal,
  Dimensions
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing
} from 'react-native-reanimated';
import { COLORS } from '../../constants/colors';
import type { RootStackScreenProps } from '../../types/navigation';
import DebatesService, { CreateDebateData, GameMode } from '../../services/debates.service';
import { useTranslation } from 'react-i18next';
import { useDebateLimits } from '../../hooks/useDebateLimits';
import { useAsyncDebateLimits } from '../../hooks/useAsyncDebateLimits';
import { useAuth } from '../../hooks/useAuth';
import { PremiumPaywall } from '../../components/PremiumPaywall';
import { usePremiumPrompt } from '../../hooks/usePremiumPrompt';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { IconButton } from '../../components/IconButton';
import { Ionicons } from '@expo/vector-icons';
import { usePostHog, PostHogEvents } from '../../hooks/usePostHog';
import { useHaptics } from '../../hooks/useHaptics';
import { checkMultipleFields, SupportedLanguage } from '../../utils/profanityFilter';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NotificationPermissionModal } from '../../components/NotificationPermissionModal';
import { useNotifications } from '../../contexts/NotificationContext';

type Props = RootStackScreenProps<'CreateDebate'>;

// Composant animé pour un bouton de sélection de type
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

// Composant animé pour les chips d'options
const AnimatedChip: React.FC<{
  selected: boolean;
  locked?: boolean;
  onPress: () => void;
  children: React.ReactNode;
}> = ({ selected, locked = false, onPress, children }) => {
  const pressAnimation = useSharedValue(0);

  const handlePressIn = () => {
    if (!locked) {
      pressAnimation.value = withTiming(1, {
        duration: 100,
        easing: Easing.out(Easing.quad),
      });
    }
  };

  const handlePressOut = () => {
    if (!locked) {
      pressAnimation.value = withTiming(0, {
        duration: 150,
        easing: Easing.out(Easing.cubic),
      });
    }
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
          styles.optionChip,
          selected && styles.optionChipSelected,
          locked && styles.optionChipLocked,
          animatedStyle,
        ]}
      >
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

// Composant dropdown pour la langue du débat
const LanguageDropdown: React.FC<{
  selectedLanguage: 'fr' | 'en';
  onLanguageChange: (lang: 'fr' | 'en') => void;
}> = ({ selectedLanguage, onLanguageChange }) => {
  const { t } = useTranslation();
  const [menuVisible, setMenuVisible] = useState(false);
  const pressAnimation = useSharedValue(0);

  const languages = [
    { code: 'fr' as const, flag: '🇫🇷', nameKey: 'debates.create.languageFrench' },
    { code: 'en' as const, flag: '🇬🇧', nameKey: 'debates.create.languageEnglish' },
  ];

  const selectedOption = languages.find(l => l.code === selectedLanguage) || languages[0];

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

  const animatedButtonStyle = useAnimatedStyle(() => {
    const translateY = pressAnimation.value * 3;
    return {
      transform: [{ translateY }],
      shadowOffset: {
        width: 0,
        height: Math.max(0, 4 - pressAnimation.value * 2),
      },
    };
  });

  const handleSelectLanguage = (langCode: 'fr' | 'en') => {
    onLanguageChange(langCode);
    setMenuVisible(false);
  };

  return (
    <View style={styles.inputSection}>
      <Text style={styles.label}>{t('debates.create.languageLabel')}</Text>

      <TouchableOpacity
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        onPress={() => setMenuVisible(true)}
        activeOpacity={1}
      >
        <Animated.View style={[styles.dropdownButton, animatedButtonStyle]}>
          <Text style={styles.dropdownFlag}>{selectedOption.flag}</Text>
          <Text style={styles.dropdownText}>{t(selectedOption.nameKey)}</Text>
          <Ionicons
            name={menuVisible ? 'chevron-up' : 'chevron-down'}
            size={20}
            color={COLORS.textPrimary}
          />
        </Animated.View>
      </TouchableOpacity>

      <Modal
        visible={menuVisible}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setMenuVisible(false)}
      >
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={() => setMenuVisible(false)}
        >
          <View style={styles.modalContainer}>
            <TouchableOpacity activeOpacity={1}>
              <View style={styles.menuContainer}>
                {languages.map((language) => (
                  <TouchableOpacity
                    key={language.code}
                    onPress={() => handleSelectLanguage(language.code)}
                    activeOpacity={0.7}
                  >
                    <View
                      style={[
                        styles.menuItem,
                        language.code === languages[languages.length - 1].code && styles.menuItemLast,
                      ]}
                    >
                      <Text style={styles.menuItemFlag}>{language.flag}</Text>
                      <Text style={styles.menuItemText}>{t(language.nameKey)}</Text>
                      {language.code === selectedLanguage && (
                        <Ionicons name="checkmark" size={20} color={COLORS.YELLOW_CORE} />
                      )}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </Modal>
    </View>
  );
};

export const CreateDebateScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const posthog = usePostHog();
  const { trigger } = useHaptics();
  const premium = usePremiumPrompt();
  const { requestNotificationPermission, notificationsEnabled } = useNotifications();
  const [showNotificationModal, setShowNotificationModal] = useState(false);
  const [pendingAsyncDebate, setPendingAsyncDebate] = useState<any>(null);

  // Track debate creation started
  useEffect(() => {
    posthog.capture('debate_creation_started', {
      source: route.params?.suggestedTitle ? 'suggestion' : 'manual',
    });
  }, []);

  // Récupérer les suggestions depuis les paramètres de route
  const suggestedTitle = route.params?.suggestedTitle || '';
  const suggestedDescription = route.params?.suggestedDescription || '';
  const suggestionId = route.params?.suggestionId;
  const suggestionType = route.params?.suggestionType;

  const [title, setTitle] = useState(suggestedTitle);
  const [hostView, setHostView] = useState('');
  const [selectedMode, setSelectedMode] = useState<2 | 5 | 10>(5);
  const [isLoading, setIsLoading] = useState(false);

  // États pour débats asynchrones
  const [isLive, setIsLive] = useState<boolean | null>(null); // null = aucun type sélectionné
  const [maxMessages, setMaxMessages] = useState<10 | 20 | 30>(10);

  // État pour le mode de jeu (n8n)
  const [gameMode, setGameMode] = useState<GameMode>('COMPETITIVE');

  // État pour la langue du débat (par défaut: langue de l'application)
  const [debateLanguage, setDebateLanguage] = useState<'fr' | 'en'>(
    (i18n.language as 'fr' | 'en') || 'fr'
  );

  // Hook pour gérer les limites de débats mensuels
  const { checkDebateLimit, getDaysUntilReset } = useDebateLimits();

  // Hook pour gérer les limites de débats asynchrones simultanés
  const {
    checkAsyncDebateLimit,
  } = useAsyncDebateLimits();

  /**
   * Validation du titre
   */
  const isTitleValid = (): boolean => {
    return title.trim().length >= 15;
  };

  /**
   * Message d'erreur pour le titre
   */
  const getTitleError = (): string | null => {
    if (title.length === 0) return null;
    if (title.trim().length < 15) {
      return `min. 15 caractères (${title.trim().length}/15)`;
    }
    return null;
  };

  /**
   * Validation du point de vue
   */
  const isHostViewValid = (): boolean => {
    return hostView.trim().length > 0 && hostView.trim().length <= 100;
  };

  /**
   * Message d'erreur pour le point de vue
   */
  const getHostViewError = (): string | null => {
    if (hostView.length === 0) return null;
    if (hostView.trim().length > 100) {
      return `max. 100 (${hostView.trim().length}/100)`;
    }
    return null;
  };

  /**
   * Validation du formulaire complet
   */
  const validateForm = (): boolean => {
    if (!title.trim()) {
      Alert.alert(t('debates.game.error'), t('debates.create.errors.titleRequired'));
      return false;
    }
    if (title.length < 15) {
      Alert.alert(t('debates.game.error'), t('debates.create.errors.titleMin'));
      return false;
    }
    if (!hostView.trim()) {
      Alert.alert(t('debates.game.error'), t('debates.create.errors.viewRequired'));
      return false;
    }
    if (hostView.length > 100) {
      Alert.alert(t('debates.game.error'), t('debates.create.errors.viewMax'));
      return false;
    }
    return true;
  };

  /**
   * Vérifier si l'utilisateur peut sélectionner 30 messages
   */
  const canSelect30Messages = (): boolean => {
    const allowedRoles = ['PREMIUM', 'CREATOR', 'BUSINESS'];
    return user?.role ? allowedRoles.includes(user.role) : false;
  };

  /**
   * Vérification si le formulaire est valide (pour l'état du bouton)
   */
  const isFormValid = (): boolean => {
    return isTitleValid() && isHostViewValid() && isLive !== null;
  };

  /**
   * Création du débat
   */
  const handleCreateDebate = async () => {
    trigger('button-tap');
    if (!validateForm()) {
      trigger('button-error');
      return;
    }

    // Vérifier qu'un type de débat est sélectionné
    if (isLive === null) {
      trigger('button-error');
      Alert.alert(t('debates.game.error'), t('debates.create.selectDebateTypeError'));
      return;
    }

    // Vérifier le contenu pour insultes/contenu inapproprié et emojis
    const contentCheck = checkMultipleFields(
      { title, hostView },
      debateLanguage as SupportedLanguage
    );

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

    // Vérifier la limite de débats mensuels AVANT la création
    const debateCheck = checkDebateLimit();
    if (!debateCheck.canDebate) {
      premium.promptPremium({ type: 'monthlyLimit', currentCount: debateCheck.currentCount, limit: debateCheck.limit, daysUntilReset: getDaysUntilReset() });
      return;
    }

    // Vérifier la limite de débats asynchrones simultanés
    if (!isLive) {
      const asyncCheck = await checkAsyncDebateLimit();
      if (!asyncCheck.canCreate) {
        premium.promptPremium({ type: 'asyncLimit', currentCount: asyncCheck.currentCount, limit: asyncCheck.limit });
        return;
      }
    }

    try {
      setIsLoading(true);

      const debateData: CreateDebateData = {
        title: title.trim(),
        hostView: hostView.trim(),
        mode: selectedMode,
        themes: [],
        isLive,
        maxMessagesPerUser: !isLive ? maxMessages : undefined,
        gameMode, // Mode de jeu (COMPETITIVE ou EXPLORATORY)
        language: debateLanguage, // Langue du débat
        suggestionId, // ID de la suggestion si utilisée
        suggestionType, // Type de suggestion (evergreen/trending)
      };

      const newDebate = await DebatesService.createDebate(debateData);
      trigger('button-success');

      // Track debate creation
      posthog.capture(PostHogEvents.DEBATE_CREATED, {
        debate_id: newDebate.id,
        debate_type: isLive ? 'live_duel' : 'async_duel',
        game_mode: gameMode,
        duration: isLive ? selectedMode : undefined,
        max_messages: !isLive ? maxMessages : undefined,
      });

      // Comportement différent selon le type de débat
      if (!isLive) {
        // Débat asynchrone : vérifier les notifications d'abord
        const alreadyAsked = await AsyncStorage.getItem('notifications_permission_asked');
        if (!notificationsEnabled && !alreadyAsked) {
          // Stocker le débat créé et afficher le modal notifications
          setPendingAsyncDebate(newDebate);
          setShowNotificationModal(true);
        } else {
          // Notifications activées : Alert directe
          Alert.alert(
            t('debates.create.asyncCreatedTitle'),
            t('debates.create.asyncCreatedMessage'),
            [{
              text: t('common.ok'),
              onPress: () => navigation.navigate('Home')
            }]
          );
        }
      } else {
        // Débat live : écran d'attente de matchmaking
        navigation.replace('WaitingScreen', { debate: newDebate });
      }

    } catch (error) {
      trigger('button-error');
      console.error('Erreur création débat:', error);
      Alert.alert(
        t('debates.game.error'),
        error instanceof Error ? error.message : t('debates.create.errors.generic')
      );
    } finally {
      setIsLoading(false);
    }
  };

  // Handler pour la fermeture du modal de notifications (création async)
  const handleNotificationModalClose = () => {
    setShowNotificationModal(false);
    if (pendingAsyncDebate) {
      Alert.alert(
        t('debates.create.asyncCreatedTitle'),
        t('debates.create.asyncCreatedMessage'),
        [{
          text: t('common.ok'),
          onPress: () => {
            setPendingAsyncDebate(null);
            navigation.navigate('Home');
          }
        }]
      );
    }
  };

  const titleError = getTitleError();
  const hostViewError = getHostViewError();

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Bouton close en haut à droite */}
        <View style={styles.closeButtonContainer}>
          <IconButton
            type="action"
            icon={<Ionicons name="close" size={30} />}
            onPress={() => {
              trigger('button-tap');
              navigation.goBack();
            }}
            size={50}
          />
        </View>

        <KeyboardAvoidingView
          style={styles.keyboardAvoid}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContent}
            showsVerticalScrollIndicator={false}
          >
            {/* En-tête */}
            <View style={styles.header}>
              <Text style={styles.title}>{t('debates.create.title')}</Text>
            </View>

            {/* Titre du débat */}
            <View style={styles.inputSection}>
              <Text style={styles.label}>{t('debates.create.titleLabel')}</Text>
              <TextInput
                style={[
                  styles.input,
                  titleError && styles.inputError
                ]}
                placeholder={t('debates.create.titlePlaceholder')}
                placeholderTextColor={COLORS.GREY_MEDIUM}
                value={title}
                onChangeText={setTitle}
                maxLength={200}
                multiline
              />
              <View style={styles.charCountRow}>
                <Text style={styles.charCount}>{title.length}/200</Text>
                {titleError && (
                  <Text style={styles.errorText}>{titleError}</Text>
                )}
              </View>
            </View>

            {/* Point de vue */}
            {isTitleValid() && (
              <View style={styles.inputSection}>
                <Text style={styles.label}>{t('debates.create.viewLabel')}</Text>
                <TextInput
                  style={[
                    styles.input,
                    styles.inputMultiline,
                    hostViewError && styles.inputError
                  ]}
                  placeholder={t('debates.create.viewPlaceholder')}
                  placeholderTextColor={COLORS.GREY_MEDIUM}
                  value={hostView}
                  onChangeText={setHostView}
                  maxLength={100}
                  multiline
                  numberOfLines={3}
                />
                <View style={styles.charCountRow}>
                  <Text style={styles.charCount}>{hostView.length}/100</Text>
                  {hostViewError && (
                    <Text style={styles.errorText}>{hostViewError}</Text>
                  )}
                </View>
              </View>
            )}

            {/* Sélection du type de débat */}
            {isTitleValid() && isHostViewValid() && (
              <View style={styles.inputSection}>
                <Text style={styles.label}>{t('debates.create.debateType')}</Text>
                <View style={styles.typeButtonsContainer}>
                  <AnimatedTypeButton
                    selected={isLive === true}
                    onPress={() => setIsLive(true)}
                    icon="⚡"
                    title={t('debates.create.typeLive')}
                  />
                  <AnimatedTypeButton
                    selected={isLive === false}
                    onPress={() => setIsLive(false)}
                    icon="💬"
                    title={t('debates.create.typeAsync')}
                  />
                </View>
                {isLive !== null && (
                  <Text style={styles.gameModeHint}>
                    {isLive
                      ? t('debates.create.debateTypeHintLive')
                      : t('debates.create.debateTypeHintAsync')
                    }
                  </Text>
                )}
                {isLive === true && (
                  <Text style={styles.liveWarningText}>
                    {t('debates.create.debateTypeLiveWarning')}
                  </Text>
                )}
              </View>
            )}

            {/* Mode de jeu (n8n) */}
            {isTitleValid() && isHostViewValid() && isLive !== null && (
              <View style={styles.inputSection}>
                <Text style={styles.label}>{t('debates.create.gameMode')}</Text>
                <View style={styles.typeButtonsContainer}>
                  <AnimatedTypeButton
                    selected={gameMode === 'COMPETITIVE'}
                    onPress={() => setGameMode('COMPETITIVE')}
                    icon="⚔️"
                    title={t('debates.create.gameModeCompetitive')}
                  />
                  <AnimatedTypeButton
                    selected={gameMode === 'EXPLORATORY'}
                    onPress={() => setGameMode('EXPLORATORY')}
                    icon="🔍"
                    title={t('debates.create.gameModeExploratory')}
                  />
                </View>
                <Text style={styles.gameModeHint}>
                  {gameMode === 'COMPETITIVE'
                    ? t('debates.create.gameModeHintCompetitive')
                    : t('debates.create.gameModeHintExploratory')
                  }
                </Text>
              </View>
            )}

            {/* Langue du débat - Dropdown */}
            {isTitleValid() && isHostViewValid() && isLive !== null && (
              <LanguageDropdown
                selectedLanguage={debateLanguage}
                onLanguageChange={setDebateLanguage}
              />
            )}

            {/* Durée (Live) ou Nombre de messages (Async) */}
            {isTitleValid() && isHostViewValid() && isLive !== null && (
              <View style={styles.inputSection}>
                {isLive ? (
                  <>
                    <Text style={styles.label}>{t('debates.create.durationLabel')}</Text>
                    <View style={styles.optionsContainer}>
                      {[2, 5, 10].map((duration) => (
                        <AnimatedChip
                          key={duration}
                          selected={selectedMode === duration}
                          onPress={() => setSelectedMode(duration as 2 | 5 | 10)}
                        >
                          <Text style={[
                            styles.optionText,
                            selectedMode === duration && styles.optionTextSelected
                          ]}>
                            {duration === 2 ? '🔥' : duration === 5 ? '⚡' : '🕐'} {duration} min
                          </Text>
                        </AnimatedChip>
                      ))}
                    </View>
                  </>
                ) : (
                  <>
                    <Text style={styles.label}>{t('debates.create.messageCount')}</Text>
                    <View style={styles.optionsContainer}>
                      {[10, 20, 30].map((msgCount) => {
                        const isLocked = msgCount === 30 && !canSelect30Messages();
                        return (
                          <AnimatedChip
                            key={msgCount}
                            selected={maxMessages === msgCount}
                            locked={isLocked}
                            onPress={() => {
                              if (isLocked) {
                                premium.promptPremium({ type: 'premiumFeature', featureName: t('debates.create.premiumFeatureTitle'), featureDescription: t('debates.create.premiumFeatureMessage') });
                              } else {
                                setMaxMessages(msgCount as 10 | 20 | 30);
                              }
                            }}
                          >
                            <Text style={[
                              styles.optionText,
                              maxMessages === msgCount && styles.optionTextSelected,
                              isLocked && styles.optionTextLocked
                            ]}>
                              {isLocked ? '🔒 ' : ''}💬 {msgCount}
                            </Text>
                          </AnimatedChip>
                        );
                      })}
                    </View>
                  </>
                )}
              </View>
            )}

            {/* Espace pour le bouton */}
            <View style={styles.buttonSpacer} />
          </ScrollView>

          {/* Bouton de création en bas avec dégradé */}
          {isFormValid() && (
            <View style={styles.createButtonFixed}>
              <LinearGradient
                colors={[
                  'rgba(11, 15, 19, 0)',
                  'rgba(11, 15, 19, 0.4)',
                  'rgba(11, 15, 19, 0.8)',
                  'rgba(11, 15, 19, 0.95)',
                  COLORS.NIGHT_BLUE,
                ]}
                style={styles.gradientBackground}
              />
              <View style={styles.buttonContainer}>
                <PrimaryButton
                  onPress={handleCreateDebate}
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <ActivityIndicator size="small" color={COLORS.NIGHT_BLUE} />
                  ) : (
                    t('debates.create.findOpponent')
                  )}
                </PrimaryButton>
              </View>
            </View>
          )}
        </KeyboardAvoidingView>
      </SafeAreaView>

      {/* Premium paywall */}
      <PremiumPaywall
        visible={premium.showPaywall}
        onClose={premium.closePaywall}
        onPurchaseSuccess={premium.closePaywall}
        trigger={premium.paywallTrigger}
      />

      {/* Modal de notification pour les débats async */}
      <NotificationPermissionModal
        visible={showNotificationModal}
        onClose={handleNotificationModalClose}
        onEnable={async () => {
          await AsyncStorage.setItem('notifications_permission_asked', 'true');
          await requestNotificationPermission();
          handleNotificationModalClose();
        }}
        onLater={async () => {
          await AsyncStorage.setItem('notifications_permission_asked', 'true');
          handleNotificationModalClose();
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

  closeButtonContainer: {
    position: 'absolute',
    top: 60,
    right: 20,
    zIndex: 100,
  },

  keyboardAvoid: {
    flex: 1,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  // En-tête
  header: {
    alignItems: 'flex-start',
    marginBottom: 30,
  },

  title: {
    fontSize: 36,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 8,
  },

  subtitle: {
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textAlign: 'center',
  },

  // Sections
  inputSection: {
    marginBottom: 20,
  },

  label: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
    marginBottom: 8,
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

  inputMultiline: {
    minHeight: 80,
    textAlignVertical: 'top',
  },

  inputError: {
    borderColor: COLORS.RED_ERROR,
  },

  charCountRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 5,
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

  // Boutons de type de débat
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

  // Hint pour le mode de jeu
  gameModeHint: {
    fontSize: 12,
    fontFamily: 'Raleway-Regular',
    color: COLORS.GREY_MEDIUM,
    marginTop: 8,
    textAlign: 'center',
  },

  liveWarningText: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.RED_ERROR,
    marginTop: 6,
    textAlign: 'center',
  },

  // Options (durée/messages)
  optionsContainer: {
    flexDirection: 'row',
    gap: 10,
  },

  optionChip: {
    flex: 1,
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    paddingHorizontal: 8,
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

  optionChipSelected: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },

  optionChipLocked: {
    opacity: 0.5,
    backgroundColor: COLORS.surfaceDark,
  },

  optionText: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.textPrimary,
  },

  optionTextSelected: {
    color: COLORS.NIGHT_BLUE,
  },

  optionTextLocked: {
    color: COLORS.GREY_MEDIUM,
  },

  // Bouton fixe en bas avec dégradé
  buttonSpacer: {
    height: 120,
  },

  createButtonFixed: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    paddingTop: 60,
    paddingBottom: 30,
  },

  gradientBackground: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  },

  buttonContainer: {
    paddingHorizontal: 20,
    zIndex: 1,
  },

  // Styles pour le dropdown de langue
  dropdownButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
    gap: 12,
  },

  dropdownFlag: {
    fontSize: 24,
  },

  dropdownText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.textPrimary,
  },

  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    justifyContent: 'center',
    alignItems: 'center',
  },

  modalContainer: {
    width: '80%',
    maxWidth: 400,
  },

  menuContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    maxHeight: Dimensions.get('window').height * 0.6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 12,
    elevation: 10,
  },

  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    gap: 12,
  },

  menuItemLast: {
    borderBottomWidth: 0,
  },

  menuItemFlag: {
    fontSize: 24,
  },

  menuItemText: {
    flex: 1,
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.textPrimary,
  },
});
