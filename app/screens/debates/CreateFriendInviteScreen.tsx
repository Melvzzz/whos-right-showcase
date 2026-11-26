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
  Share,
  Platform,
  Clipboard,
  KeyboardAvoidingView,
  TouchableWithoutFeedback,
  Keyboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withRepeat,
  withSequence,
  Easing,
  FadeIn,
  FadeOut,
} from 'react-native-reanimated';

// Composant animé pour les boutons avec effet 3D (Copier, Partager)
const Animated3DButton: React.FC<{
  onPress: () => void;
  style?: any;
  children: React.ReactNode;
  disabled?: boolean;
}> = ({ onPress, style, children, disabled = false }) => {
  const pressAnimation = useSharedValue(0);

  const handlePressIn = () => {
    if (!disabled) {
      pressAnimation.value = withTiming(1, {
        duration: 60,
        easing: Easing.out(Easing.quad),
      });
    }
  };

  const handlePressOut = () => {
    if (!disabled) {
      pressAnimation.value = withTiming(0, {
        duration: 120,
        easing: Easing.out(Easing.cubic),
      });
    }
  };

  const handlePress = () => {
    if (!disabled) {
      setTimeout(() => {
        onPress();
      }, 80);
    }
  };

  const animatedStyle = useAnimatedStyle(() => {
    const translateY = pressAnimation.value * 4;
    const shadowHeight = 4 - pressAnimation.value * 3;

    return {
      transform: [{ translateY }],
      shadowOffset: {
        width: 0,
        height: Math.max(1, shadowHeight),
      },
    };
  });

  return (
    <TouchableOpacity
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      onPress={handlePress}
      activeOpacity={1}
      disabled={disabled}
    >
      <Animated.View style={[style, animatedStyle]}>
        {children}
      </Animated.View>
    </TouchableOpacity>
  );
};

// Composant animé pour un bouton de sélection de type
const AnimatedTypeButton: React.FC<{
  selected: boolean;
  disabled?: boolean;
  comingSoon?: boolean;
  onPress: () => void;
  icon: string;
  title: string;
}> = ({ selected, disabled = false, comingSoon = false, onPress, icon, title }) => {
  const pressAnimation = useSharedValue(0);

  const handlePressIn = () => {
    if (!disabled) {
      pressAnimation.value = withTiming(1, {
        duration: 100,
        easing: Easing.out(Easing.quad),
      });
    }
  };

  const handlePressOut = () => {
    if (!disabled) {
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
      disabled={disabled}
    >
      <Animated.View
        style={[
          typeButtonStyles.typeButton,
          selected && typeButtonStyles.typeButtonSelected,
          disabled && typeButtonStyles.typeButtonDisabled,
          animatedStyle,
        ]}
      >
        {/* Badge sticker "Bientôt" */}
        {comingSoon && (
          <View style={typeButtonStyles.stickerBadge}>
            <Text style={typeButtonStyles.stickerBadgeText}>Bientôt</Text>
          </View>
        )}

        <Text style={typeButtonStyles.typeButtonIcon}>{icon}</Text>
        <Text style={[
          typeButtonStyles.typeButtonTitle,
          selected && typeButtonStyles.typeButtonTitleSelected,
          disabled && typeButtonStyles.typeButtonTitleDisabled,
        ]}>
          {title}
        </Text>
      </Animated.View>
    </TouchableOpacity>
  );
};

const typeButtonStyles = StyleSheet.create({
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
    overflow: 'visible',
    position: 'relative',
  },
  typeButtonSelected: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },
  typeButtonDisabled: {
    opacity: 0.6,
    backgroundColor: COLORS.surfaceDark,
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
  typeButtonTitleDisabled: {
    color: COLORS.GREY_MEDIUM,
  },
  // Badge sticker style
  stickerBadge: {
    position: 'absolute',
    top: -8,
    right: -8,
    paddingVertical: 4,
    paddingHorizontal: 8,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.INK,
    backgroundColor: COLORS.GREY_MEDIUM,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 6,
    zIndex: 10,
    transform: [{ rotate: '8deg' }],
  },
  stickerBadgeText: {
    fontSize: 9,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
});
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { RootStackScreenProps } from '../../types/navigation';
import DebatesService, { CreatePrivateDebateData, PrivateDebateResponse, GameMode } from '../../services/debates.service';
import InvitationsService from '../../services/invitations.service';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useDebateLimits } from '../../hooks/useDebateLimits';
import { useAsyncDebateLimits } from '../../hooks/useAsyncDebateLimits';
import { PremiumPaywall } from '../../components/PremiumPaywall';
import { usePremiumPrompt } from '../../hooks/usePremiumPrompt';
import { InvitationCodeModal } from '../../components/InvitationCodeModal';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { IconButton } from '../../components/IconButton';
import { usePostHog, PostHogEvents } from '../../hooks/usePostHog';
import { useHaptics } from '../../hooks/useHaptics';
import { checkMultipleFields } from '../../utils/profanityFilter';

type Props = RootStackScreenProps<'CreateFriendInvite'>;

export const CreateFriendInviteScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const posthog = usePostHog();
  const { trigger } = useHaptics();
  const premium = usePremiumPrompt();

  // Track debate creation started
  useEffect(() => {
    posthog.capture('debate_creation_started', {
      debate_type: 'friend_duel',
    });
  }, []);

  const [title, setTitle] = useState('');
  const [hostView, setHostView] = useState('');
  const [privateContext, setPrivateContext] = useState('');
  const [selectedMode, setSelectedMode] = useState<2 | 5 | 10>(5);
  const [isLive, setIsLive] = useState<boolean>(true); // true = Live, false = Async
  const [maxMessages, setMaxMessages] = useState<10 | 20 | 30>(10); // ✅ NOUVEAU : Nombre de messages pour async
  const [gameMode, setGameMode] = useState<GameMode>('COMPETITIVE'); // Mode de jeu (n8n)
  const [isLoading, setIsLoading] = useState(false);
  const [invitation, setInvitation] = useState<PrivateDebateResponse | null>(null);
  const [debateStatus, setDebateStatus] = useState<'waiting' | 'viewing' | 'active'>('waiting');
  const [viewingGuestUsername, setViewingGuestUsername] = useState<string | null>(null);

  // ✅ NOUVEAU : État pour le modal d'invitation async
  const [showAsyncInviteModal, setShowAsyncInviteModal] = useState(false);
  const [asyncInviteCode, setAsyncInviteCode] = useState<string>('');

  // Hook pour gérer les limites de débats (mensuels)
  const { checkDebateLimit, getDaysUntilReset } = useDebateLimits();

  // Hook pour gérer les limites de débats async (simultanés)
  const { checkAsyncDebateLimit } = useAsyncDebateLimits();

  // Animation du point clignotant
  const pulseAnim = useSharedValue(0.3);

  // Refs
  const scrollViewRef = useRef<ScrollView>(null);
  const titleInputRef = useRef<TextInput>(null);
  const hostViewInputRef = useRef<TextInput>(null);
  const contextInputRef = useRef<TextInput>(null);

  /**
   * Initialisation du token d'authentification
   */
  useEffect(() => {
    if (user?.token) {
      DebatesService.setAuthToken(user.token);
      InvitationsService.setAuthToken(user.token);
    }
  }, [user]);

  /**
   * Animation du point clignotant (quand en attente)
   */
  useEffect(() => {
    if (debateStatus !== 'waiting') return;

    pulseAnim.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1000, easing: Easing.inOut(Easing.ease) }),
        withTiming(0.3, { duration: 1000, easing: Easing.inOut(Easing.ease) })
      ),
      -1,
      false
    );

    return () => {
      pulseAnim.value = 0.3;
    };
  }, [debateStatus]);

  const pulseStyle = useAnimatedStyle(() => ({
    opacity: pulseAnim.value,
  }));

  /**
   * Validation
   */
  const isTitleValid = (): boolean => title.trim().length >= 15;
  const isHostViewValid = (): boolean => {
    const length = hostView.trim().length;
    return length > 0 && length <= 100;
  };
  const isFormValid = (): boolean => isTitleValid() && isHostViewValid();

  /**
   * Scroll automatique
   */
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

  /**
   * Crée l'invitation
   */
  const handleCreateInvite = async () => {
    trigger('button-tap');
    if (!isFormValid()) return;

    // Vérifier le contenu pour insultes/contenu inapproprié et emojis
    const contentCheck = checkMultipleFields({ title, hostView });

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

    // Si async, vérifier aussi la limite de débats simultanés
    if (!isLive) {
      const asyncCheck = await checkAsyncDebateLimit();
      if (!asyncCheck.canCreate) {
        premium.promptPremium({ type: 'asyncLimit', currentCount: asyncCheck.currentCount, limit: asyncCheck.limit });
        return;
      }
    }

    setIsLoading(true);
    try {
      const data: CreatePrivateDebateData = {
        title: title.trim(),
        hostView: hostView.trim(),
        mode: selectedMode,
        privateContext: privateContext.trim() || undefined,
        gameMode, // Mode de jeu (COMPETITIVE ou EXPLORATORY)
        // ✅ NOUVEAU : Champs async pour friend duels
        isLive,
        maxMessagesPerUser: !isLive ? maxMessages : undefined,
      };

      console.log('Création invitation avec données:', data);
      const response = await DebatesService.createPrivateDebate(data);
      console.log('Invitation créée:', {
        debateId: response.debate.id,
        inviteCode: response.invitation.inviteCode,
        inviteUrl: response.invitation.inviteUrl,
      });

      // Track friend debate creation
      posthog.capture(PostHogEvents.DEBATE_CREATED, {
        debate_id: response.debate.id,
        debate_type: 'friend_duel',
        game_mode: gameMode,
        duration: selectedMode,
        is_live: isLive,
        max_messages: !isLive ? maxMessages : undefined,
      });

      trigger('button-success');

      // ✅ NOUVEAU : Comportement différent selon le mode
      if (!isLive) {
        // ASYNC : Afficher le modal avec le code d'invitation
        setAsyncInviteCode(response.invitation.inviteCode);
        setShowAsyncInviteModal(true);
      } else {
        // LIVE : Écran d'attente avec code invitation (comportement existant)
        setInvitation(response);
      }
    } catch (error: any) {
      console.error('Erreur lors de la création du débat privé:', error);
      trigger('button-error');
      const errorMessage = error.message || t('debates.invite.cannotCreate');
      Alert.alert(t('common.error'), errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Partage l'invitation (sans le lien pour le moment)
   */
  const handleShare = async () => {
    trigger('button-tap');
    if (!invitation) return;

    const message = t('debates.invite.shareMessageCodeOnly', {
      title,
      code: invitation.invitation.inviteCode,
    });

    try {
      await Share.share({ message });
    } catch (error) {
      console.error('Error sharing invitation:', error);
    }
  };

  /**
   * Copie le code
   */
  const handleCopyCode = () => {
    trigger('button-tap');
    if (!invitation) return;
    Clipboard.setString(invitation.invitation.inviteCode);
    trigger('button-success');
    Alert.alert(t('debates.invite.copied'), t('debates.invite.codeCopied'));
  };

  /**
   * Copie le lien
   */
  const handleCopyLink = () => {
    trigger('button-tap');
    if (!invitation) return;
    Clipboard.setString(invitation.invitation.inviteUrl);
    trigger('button-success');
    Alert.alert(t('debates.invite.copied'), t('debates.invite.linkCopied'));
  };

  /**
   * Ferme l'écran et annule le débat si une invitation existe
   */
  const handleClose = async () => {
    trigger('button-tap');
    if (invitation) {
      try {
        await DebatesService.cancelDebate(invitation.debate.id);
        console.log('Débat privé annulé:', invitation.debate.id);
      } catch (error) {
        console.error('Erreur lors de l\'annulation du débat:', error);
      }
    }
    navigation.goBack();
  };

  /**
   * Vérifie périodiquement le statut du débat et de l'invitation
   */
  useEffect(() => {
    if (!invitation) return;

    const checkStatus = async () => {
      try {
        // Récupérer le débat pour voir s'il est lancé
        const debate = await DebatesService.getDebateById(invitation.debate.id);

        // Récupérer l'invitation pour voir le statut de présence
        const invitations = await InvitationsService.getUserInvitations();
        const currentInvitation = invitations.find((inv: any) => inv.id === invitation.invitation.id);

        // @ts-ignore - Champs temporaires
        if (currentInvitation?.viewingGuestUsername && !debate.guestId) {
          // L'invité est en train de consulter l'invitation
          setDebateStatus('viewing');
          setViewingGuestUsername(currentInvitation.viewingGuestUsername);
        } else if (debate.status === 'active' && debate.guestId) {
          // Le débat a commencé
          console.log('Debate started! Redirecting...');
          setDebateStatus('active');
          setTimeout(() => {
            navigation.replace('DebateScreen', { debate });
          }, 1000);
        } else {
          setDebateStatus('waiting');
          setViewingGuestUsername(null);
        }
      } catch (error) {
        console.error('Erreur lors de la vérification du statut:', error);
      }
    };

    checkStatus();
    const interval = setInterval(checkStatus, 3000);

    return () => clearInterval(interval);
  }, [invitation, navigation]);

  // Écran de partage après création
  if (invitation) {
    return (
      <View style={styles.container}>
        <AnimatedBackground enabled={true} theme="dark" opacity={1} />

        <SafeAreaView style={styles.safeArea} edges={['top']}>
          {/* Close button */}
          <View style={styles.closeButtonContainer}>
            <IconButton
              type="action"
              icon={<Ionicons name="close" size={24} />}
              onPress={handleClose}
              size={44}
              backgroundColor={COLORS.surface}
            />
          </View>

          <ScrollView
            style={styles.scrollView}
            contentContainerStyle={styles.scrollContentShare}
            showsVerticalScrollIndicator={false}
          >
            {/* Header */}
            <View style={styles.shareHeader}>
              <View style={styles.successBadge}>
                <Ionicons name="checkmark-circle" size={24} color={COLORS.success} />
                <Text style={styles.successText}>{t('debates.invite.gameCreated')}</Text>
              </View>
            </View>

            {/* Code Card */}
            <View style={styles.invitationCard}>
              <Text style={styles.cardLabel}>{t('debates.invite.shareCode')}</Text>

              <View style={styles.codeContainer}>
                <Text style={styles.codeText}>{invitation.invitation.inviteCode}</Text>
                <Animated3DButton onPress={handleCopyCode} style={styles.copyButton}>
                  <Ionicons name="copy-outline" size={18} color={COLORS.NIGHT_BLUE} />
                  <Text style={styles.copyButtonText}>{t('debates.invite.copy')}</Text>
                </Animated3DButton>
              </View>

              {/* Section lien - Désactivée pour le moment */}
              <View style={styles.linkSectionDisabled}>
                <View style={styles.linkSectionHeader}>
                  <Text style={styles.cardSubLabelDisabled}>{t('debates.invite.orLink')}</Text>
                  <View style={styles.comingSoonBadge}>
                    <Text style={styles.comingSoonBadgeText}>Bientôt</Text>
                  </View>
                </View>

                <View style={styles.linkContainerDisabled}>
                  <Text style={styles.linkTextDisabled} numberOfLines={1} ellipsizeMode="middle">
                    whosright.app/invite/XXXXXX
                  </Text>
                  <View style={styles.copyButtonDisabled}>
                    <Ionicons name="copy-outline" size={18} color={COLORS.GREY_MEDIUM} />
                    <Text style={styles.copyButtonTextDisabled}>{t('debates.invite.copy')}</Text>
                  </View>
                </View>
              </View>

              {/* Share Button */}
              <Animated3DButton onPress={handleShare} style={styles.shareButton}>
                <Ionicons name="share-social" size={20} color={COLORS.PAPER_IVORY} />
                <Text style={styles.shareButtonText}>{t('debates.invite.share')}</Text>
              </Animated3DButton>
            </View>

            {/* Debate Info Card */}
            <View style={styles.debateInfoCard}>
              <Text style={styles.infoCardTitle}>{t('debates.invite.debateSubject')}</Text>
              <Text style={styles.infoCardText}>{title}</Text>

              <Text style={styles.infoCardTitle}>{t('debates.invite.yourPosition')}</Text>
              <Text style={styles.infoCardTextQuote}>"{hostView}"</Text>

              {privateContext && (
                <>
                  <Text style={styles.infoCardTitle}>{t('debates.invite.privateContext')}</Text>
                  <Text style={styles.infoCardText}>{privateContext}</Text>
                </>
              )}

              <Text style={styles.infoCardTitle}>{t('debates.invite.duration')}</Text>
              <Text style={styles.infoCardText}>
                {t('debates.invite.minutesPerPlayer', { minutes: selectedMode })}
              </Text>

              <Text style={styles.infoCardTitle}>{t('debates.create.gameMode')}</Text>
              <Text style={styles.infoCardText}>
                {gameMode === 'COMPETITIVE' ? `⚔️ ${t('debates.create.gameModeCompetitive')}` : `🔍 ${t('debates.create.gameModeExploratory')}`}
              </Text>
            </View>

            {/* Status Card */}
            <View style={[
              styles.statusCard,
              debateStatus === 'viewing' && styles.statusCardViewing,
              debateStatus === 'active' && styles.statusCardActive
            ]}>
              {debateStatus === 'waiting' ? (
                <>
                  <View style={styles.statusTitleContainer}>
                    <Text style={styles.statusTitleText}>{t('debates.invite.waitingOpponent')}</Text>
                    <Animated.View style={[styles.statusDot, pulseStyle]} />
                  </View>
                  <Text style={styles.statusSubtext}>{t('debates.invite.friendMustEnter')}</Text>
                </>
              ) : debateStatus === 'viewing' ? (
                <View style={styles.statusViewingContainer}>
                  <View style={styles.statusViewingBadge}>
                    <Text style={styles.statusViewingEmoji}>👀</Text>
                    <Text style={styles.statusViewingUsername}>@{viewingGuestUsername}</Text>
                  </View>
                  <Text style={styles.statusViewingText}>{t('debates.invite.viewingInvitation')}</Text>
                </View>
              ) : (
                <View style={styles.statusActiveContainer}>
                  <View style={styles.statusActiveIcon}>
                    <Ionicons name="checkmark-circle" size={48} color={COLORS.success} />
                  </View>
                  <Text style={styles.statusActiveText}>{t('debates.invite.debateStarting')}</Text>
                  <Text style={styles.statusActiveSubtext}>{t('debates.invite.redirecting')}</Text>
                </View>
              )}
            </View>

            <View style={styles.bottomSpacer} />
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  // Formulaire de création
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
                <Text style={styles.screenTitle}>{t('debates.invite.title') || 'Inviter un ami'}</Text>
              </View>

              {/* Titre du débat */}
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>{t('debates.invite.debateTitle')}</Text>
                <TextInput
                  ref={titleInputRef}
                  style={[
                    styles.input,
                    styles.titleInput,
                    title.length > 0 && !isTitleValid() && styles.inputError
                  ]}
                  placeholder={t('debates.invite.debateTitlePlaceholder')}
                  placeholderTextColor={COLORS.GREY_MEDIUM}
                  value={title}
                  onChangeText={setTitle}
                  onFocus={() => scrollToInput(titleInputRef)}
                  maxLength={200}
                  multiline
                  blurOnSubmit={true}
                  onSubmitEditing={() => Keyboard.dismiss()}
                />
                <View style={styles.charCountRow}>
                  <Text style={styles.charCount}>
                    {t('debates.invite.characterCount', { count: title.length, max: 200 })}
                  </Text>
                  {title.length > 0 && !isTitleValid() && (
                    <Text style={styles.errorText}>
                      {t('debates.invite.minCharacters', { min: 15 })}
                    </Text>
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
                    {t('debates.invite.yourPositionTitle')}
                  </Text>
                  <TextInput
                    ref={hostViewInputRef}
                    style={[
                      styles.input,
                      styles.viewpointInput,
                      styles.hostInput,
                      hostView.length > 0 && !isHostViewValid() && styles.inputError
                    ]}
                    placeholder={t('debates.invite.yourViewpointPlaceholder')}
                    placeholderTextColor={COLORS.GREY_MEDIUM}
                    value={hostView}
                    onChangeText={setHostView}
                    onFocus={() => scrollToInput(hostViewInputRef)}
                    maxLength={100}
                    multiline
                    numberOfLines={3}
                    blurOnSubmit={true}
                    onSubmitEditing={() => Keyboard.dismiss()}
                  />
                  <View style={styles.charCountRow}>
                    <Text style={styles.charCount}>
                      {t('debates.invite.characterCount', { count: hostView.length, max: 100 })}
                    </Text>
                    {hostView.length > 100 && (
                      <Text style={styles.errorText}>
                        {t('debates.invite.maxCharacters', { max: 100 })}
                      </Text>
                    )}
                  </View>
                </Animated.View>
              )}

              {/* Contexte privé - Désactivé pour l'instant */}

              {/* Type de débat - Affiché si point de vue valide */}
              {isHostViewValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{t('debates.create.debateType')}</Text>
                  <View style={styles.typeButtonsContainer}>
                    <AnimatedTypeButton
                      selected={isLive === true}
                      onPress={() => {
                        trigger('selection');
                        setIsLive(true);
                      }}
                      icon="⚡"
                      title={t('debates.create.typeLive')}
                    />
                    <AnimatedTypeButton
                      selected={isLive === false}
                      disabled={false}
                      onPress={() => {
                        trigger('selection');
                        setIsLive(false);
                      }}
                      icon="💬"
                      title={t('debates.create.typeAsync')}
                    />
                  </View>
                </Animated.View>
              )}

              {/* Mode de jeu (n8n) - Affiché si type sélectionné */}
              {isHostViewValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{t('debates.create.gameMode')}</Text>
                  <View style={styles.typeButtonsContainer}>
                    <AnimatedTypeButton
                      selected={gameMode === 'COMPETITIVE'}
                      onPress={() => {
                        trigger('selection');
                        setGameMode('COMPETITIVE');
                      }}
                      icon="⚔️"
                      title={t('debates.create.gameModeCompetitive')}
                    />
                    <AnimatedTypeButton
                      selected={gameMode === 'EXPLORATORY'}
                      onPress={() => {
                        trigger('selection');
                        setGameMode('EXPLORATORY');
                      }}
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
                </Animated.View>
              )}

              {/* ✅ NOUVEAU : Nombre de messages - Affiché si async */}
              {isFormValid() && !isLive && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{t('debates.invite.messageCountTitle')}</Text>
                  <View style={styles.durationContainer}>
                    {([10, 20, 30] as const).map((count) => {
                      const isPremiumLocked = count === 30 && (!user?.role || user.role === 'FREE');
                      return (
                        <TouchableOpacity
                          key={count}
                          style={[
                            styles.durationChip,
                            maxMessages === count && styles.durationChipSelected,
                            isPremiumLocked && styles.durationChipDisabled
                          ]}
                          onPress={() => {
                            if (isPremiumLocked) {
                              premium.promptPremium({ type: 'premiumFeature', featureName: t('debates.create.premiumFeatureTitle'), featureDescription: t('debates.create.premiumFeatureMessage') });
                              return;
                            }
                            trigger('selection');
                            setMaxMessages(count);
                          }}
                          activeOpacity={0.7}
                        >
                          <Text style={[
                            styles.durationText,
                            maxMessages === count && styles.durationTextSelected,
                            isPremiumLocked && styles.durationTextDisabled
                          ]}>
                            {isPremiumLocked ? '🔒 ' : ''}💬 {count}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </Animated.View>
              )}

              {/* Durée - Affiché si formulaire valide ET mode Live */}
              {isFormValid() && isLive && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.section}
                >
                  <Text style={styles.sectionTitle}>{t('debates.invite.durationPerPlayer')}</Text>
                  <View style={styles.durationContainer}>
                    {[2, 5, 10].map((duration) => (
                      <TouchableOpacity
                        key={duration}
                        style={[
                          styles.durationChip,
                          selectedMode === duration && styles.durationChipSelected
                        ]}
                        onPress={() => {
                          trigger('selection');
                          setSelectedMode(duration as 2 | 5 | 10);
                        }}
                        activeOpacity={0.7}
                      >
                        <Text style={[
                          styles.durationText,
                          selectedMode === duration && styles.durationTextSelected
                        ]}>
                          {duration === 2 ? '🔥' : duration === 5 ? '⚡' : '🕐'} {duration} min
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                </Animated.View>
              )}

              {/* Bouton de création */}
              {isFormValid() && (
                <Animated.View
                  entering={FadeIn.duration(400)}
                  style={styles.ctaSection}
                >
                  <PrimaryButton
                    onPress={handleCreateInvite}
                    disabled={isLoading}
                    style={styles.createButton}
                    textStyle={styles.createButtonText}
                  >
                    {isLoading ? (
                      <View style={styles.loadingContainer}>
                        <ActivityIndicator size="small" color={COLORS.NIGHT_BLUE} />
                        <Text style={styles.createButtonText}>{t('debates.invite.creating')}</Text>
                      </View>
                    ) : (
                      t('debates.invite.createInvitation')
                    )}
                  </PrimaryButton>
                </Animated.View>
              )}

              <View style={styles.bottomSpacer} />
            </ScrollView>
          </TouchableWithoutFeedback>
        </KeyboardAvoidingView>

        {/* Premium paywall */}
        <PremiumPaywall
          visible={premium.showPaywall}
          onClose={premium.closePaywall}
          onPurchaseSuccess={premium.closePaywall}
          trigger={premium.paywallTrigger}
        />

        {/* ✅ NOUVEAU : Modal d'invitation async avec code */}
        <InvitationCodeModal
          visible={showAsyncInviteModal}
          onClose={() => {
            setShowAsyncInviteModal(false);
            navigation.navigate('Home');
          }}
          inviteCode={asyncInviteCode}
          debateTitle={title}
          hostView={hostView}
          maxMessages={maxMessages}
          isAsync={true}
        />
      </SafeAreaView>
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
  scrollContentShare: {
    paddingHorizontal: 20,
    paddingTop: 80,
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

  // Section hôte
  hostSection: {
    backgroundColor: COLORS.YELLOW_CORE + '15',
    borderLeftWidth: 4,
    borderLeftColor: COLORS.YELLOW_CORE,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  hostTitle: {
    color: COLORS.YELLOW_CORE,
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
  viewpointInput: {
    minHeight: 80,
    textAlignVertical: 'top',
  },
  contextInput: {
    minHeight: 100,
    textAlignVertical: 'top',
  },
  hostInput: {
    borderColor: COLORS.YELLOW_CORE + '80',
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

  // Type de débat
  typeButtonsContainer: {
    flexDirection: 'row',
    gap: 10,
  },

  // Hint pour le mode de jeu
  gameModeHint: {
    fontSize: 12,
    fontFamily: 'Raleway-Regular',
    color: COLORS.GREY_MEDIUM,
    marginTop: 8,
    textAlign: 'center',
  },

  // Durée
  durationContainer: {
    flexDirection: 'row',
    gap: 12,
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
  // ✅ NOUVEAU : Styles pour chips désactivés (Premium locked)
  durationChipDisabled: {
    opacity: 0.5,
    borderColor: COLORS.INK + '50',
  },
  durationTextDisabled: {
    color: COLORS.PAPER_IVORY + '80',
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

  // ===================
  // SHARE SCREEN STYLES
  // ===================

  shareHeader: {
    alignItems: 'center',
    marginBottom: 24,
  },
  successBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.success + '20',
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.success,
  },
  successText: {
    fontSize: 18,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.success,
  },

  // Invitation Card
  invitationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 3,
    borderColor: COLORS.YELLOW_CORE,
    shadowColor: COLORS.YELLOW_CORE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 6,
  },
  cardLabel: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    marginBottom: 12,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  cardSubLabel: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    marginTop: 16,
    marginBottom: 12,
  },

  codeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  codeText: {
    flex: 1,
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    letterSpacing: 4,
    textAlign: 'center',
    backgroundColor: COLORS.surfaceDark,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.INK,
    overflow: 'hidden',
  },

  linkContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  linkText: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surfaceDark,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.INK,
    overflow: 'hidden',
  },

  // Section lien désactivée
  linkSectionDisabled: {
    opacity: 0.5,
    marginTop: 16,
  },
  linkSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  cardSubLabelDisabled: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
  },
  comingSoonBadge: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: COLORS.INK,
    backgroundColor: COLORS.GREY_MEDIUM,
    transform: [{ rotate: '4deg' }],
  },
  comingSoonBadgeText: {
    fontSize: 9,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  linkContainerDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  linkTextDisabled: {
    flex: 1,
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    backgroundColor: COLORS.surfaceDark,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.GREY_MEDIUM,
    overflow: 'hidden',
  },
  copyButtonDisabled: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.surfaceDark,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.GREY_MEDIUM,
  },
  copyButtonTextDisabled: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    color: COLORS.GREY_MEDIUM,
  },

  copyButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.YELLOW_CORE,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },
  copyButtonText: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    color: COLORS.NIGHT_BLUE,
  },

  shareButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: COLORS.ROYAL_BLUE,
    paddingVertical: 14,
    borderRadius: 12,
    marginTop: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  shareButtonText: {
    fontSize: 16,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
  },

  // Debate Info Card
  debateInfoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 18,
    marginBottom: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  infoCardTitle: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  infoCardText: {
    fontSize: 15,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    marginBottom: 8,
  },
  infoCardTextQuote: {
    fontSize: 15,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    fontStyle: 'italic',
    marginBottom: 8,
  },

  // Status Card
  statusCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    marginTop: 10,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  statusCardViewing: {
    borderColor: COLORS.YELLOW_CORE,
    shadowColor: COLORS.YELLOW_CORE,
    shadowOpacity: 0.2,
  },
  statusCardActive: {
    borderColor: COLORS.success,
    shadowColor: COLORS.success,
    shadowOpacity: 0.2,
  },

  // Status waiting
  statusTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginBottom: 8,
  },
  statusTitleText: {
    fontSize: 16,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.YELLOW_CORE,
  },
  statusSubtext: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    textAlign: 'center',
  },

  // Status viewing
  statusViewingContainer: {
    alignItems: 'center',
  },
  statusViewingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.YELLOW_CORE + '20',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.YELLOW_CORE,
    marginBottom: 10,
  },
  statusViewingEmoji: {
    fontSize: 20,
  },
  statusViewingUsername: {
    fontSize: 16,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.YELLOW_CORE,
  },
  statusViewingText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },

  // Status active
  statusActiveContainer: {
    alignItems: 'center',
  },
  statusActiveIcon: {
    marginBottom: 12,
  },
  statusActiveText: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.success,
    marginBottom: 6,
  },
  statusActiveSubtext: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
});
