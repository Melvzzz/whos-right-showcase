import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  ScrollView,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import type { RootStackScreenProps } from '../../types/navigation';
import InvitationsService, { DebateInvitation } from '../../services/invitations.service';
import DebatesService from '../../services/debates.service';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { PrimaryButton } from '../../components/PrimaryButton';
import { SecondaryButton } from '../../components/SecondaryButton';
import { IconButton } from '../../components/IconButton';
import { useHaptics } from '../../hooks/useHaptics';
import { containsProfanity, containsEmoji } from '../../utils/profanityFilter';

type Props = RootStackScreenProps<'InviteValidation'>;

export const InviteValidationScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { trigger } = useHaptics();
  const { inviteCode } = route.params;

  const [invitation, setInvitation] = useState<DebateInvitation | null>(null);
  const [loading, setLoading] = useState(true);
  const [guestView, setGuestView] = useState('');
  const [privateContext, setPrivateContext] = useState('');
  const [isEditingContext, setIsEditingContext] = useState(false);
  const [isJoining, setIsJoining] = useState(false);

  useEffect(() => {
    const initAndValidate = async () => {
      // Attendre que le token soit disponible
      if (!user?.token) {
        console.log('En attente du token utilisateur...');
        return;
      }

      console.log('Configuration du token pour InvitationsService et DebatesService');
      console.log('User:', user.username, 'Token:', user.token.substring(0, 20) + '...');
      InvitationsService.setAuthToken(user.token);
      DebatesService.setAuthToken(user.token);

      await validateCode();
    };

    initAndValidate();

    // Cleanup : quitter la session quand on unmount le composant
    return () => {
      if (invitation && user?.token) {
        console.log('Quitter la session de validation');
        InvitationsService.setAuthToken(user.token);
        InvitationsService.leaveValidationSession(invitation.id).catch(err => {
          console.error('Erreur lors de quitter la session:', err);
        });
      }
    };
  }, [user?.token, invitation?.id]);

  /**
   * Valide le code d'invitation
   */
  const validateCode = async () => {
    try {
      setLoading(true);
      console.log('Validation du code d\'invitation:', inviteCode);
      const inv = await InvitationsService.validateInviteCode(inviteCode);
      console.log('Invitation validee:', inv);
      setInvitation(inv);
      setPrivateContext(inv.privateContext || '');
    } catch (error: any) {
      console.error('Erreur validation code:', error);
      Alert.alert(t('common.error', { defaultValue: 'Error' }), error.message || t('debates.inviteValidation.invalidCode'), [
        { text: t('common.ok'), onPress: () => navigation.goBack() },
      ]);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Rejoint le débat
   */
  const handleJoin = async () => {
    trigger('button-tap');
    console.log('handleJoin appele !');
    console.log('Etat:', {
      hasInvitation: !!invitation,
      guestViewLength: guestView.trim().length,
      hasToken: !!user?.token,
    });

    if (!invitation) {
      console.log('Pas d\'invitation');
      return;
    }

    if (guestView.trim().length === 0) {
      console.log('Position vide');
      trigger('button-error');
      Alert.alert(t('common.error', { defaultValue: 'Error' }), t('debates.inviteValidation.positionRequired'));
      return;
    }

    if (guestView.trim().length > 100) {
      console.log('Position trop longue');
      trigger('button-error');
      Alert.alert(t('common.error', { defaultValue: 'Error' }), t('debates.inviteValidation.positionTooLong'));
      return;
    }

    // Vérifier d'abord les emojis
    if (containsEmoji(guestView)) {
      console.log('Emoji détecté');
      trigger('button-error');
      Alert.alert(
        t('moderation.emojiDetected'),
        t('moderation.pleaseRemoveEmoji')
      );
      return;
    }

    // Puis vérifier le contenu inapproprié
    if (containsProfanity(guestView)) {
      console.log('Contenu inapproprié détecté');
      trigger('button-error');
      Alert.alert(
        t('moderation.profanityDetected'),
        t('moderation.pleaseRemoveInappropriate')
      );
      return;
    }

    // Vérifier que le token est bien configuré
    if (!user?.token) {
      console.log('Pas de token');
      trigger('button-error');
      Alert.alert(t('common.error', { defaultValue: 'Error' }), t('debates.inviteValidation.authRequired'));
      return;
    }

    console.log('Toutes les validations passees');
    setIsJoining(true);
    try {
      // S'assurer que les tokens sont bien configurés
      console.log('Reconfiguration des tokens avant acceptation');
      InvitationsService.setAuthToken(user.token);
      DebatesService.setAuthToken(user.token);

      console.log('Acceptation invitation:', invitation.id);

      // Accepter l'invitation
      await InvitationsService.acceptInvitation(invitation.id, {
        guestView: guestView.trim(),
        privateContext: isEditingContext ? privateContext.trim() : invitation.privateContext,
      });
      console.log('Invitation acceptee');

      // Rejoindre le débat
      const joinedDebate = await DebatesService.join(invitation.debateId, { guestView: guestView.trim() });
      console.log('Debat rejoint, isLive:', joinedDebate.isLive);

      trigger('button-success');

      // Naviguer vers le bon écran selon le type de débat
      if (joinedDebate.isLive === false) {
        // Débat asynchrone : naviguer vers AsyncDebateScreen
        console.log('Navigation vers AsyncDebateScreen');
        navigation.navigate('AsyncDebateScreen', { debate: joinedDebate });
      } else {
        // Débat live : naviguer vers DebateScreen avec timestamp serveur pour sync countdown
        console.log('Navigation vers DebateScreen');
        const startTimestamp = new Date().toISOString();
        navigation.navigate('DebateScreen', { debate: joinedDebate, startTimestamp });
      }
    } catch (error: any) {
      console.error('Erreur lors de rejoindre le debat:', error);
      trigger('button-error');
      Alert.alert(t('common.error', { defaultValue: 'Error' }), error.message || t('debates.inviteValidation.cannotJoinDebate'));
      setIsJoining(false);
    }
  };

  if (loading) {
    return (
      <View style={styles.container}>
        <AnimatedBackground enabled={true} theme="dark" opacity={1} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.centerContent}>
            <View style={styles.loaderCard}>
              <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
              <Text style={styles.loadingText}>{t('debates.inviteValidation.validatingCode')}</Text>
            </View>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  if (!invitation) {
    return null; // L'alert a déjà été affichée
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Bouton retour en haut à gauche */}
        <View style={styles.backButtonContainer}>
          <IconButton
            type="action"
            icon={<Ionicons name="arrow-back" size={28} />}
            onPress={() => {
              trigger('button-tap');
              navigation.goBack();
            }}
            size={52}
            backgroundColor={COLORS.surface}
          />
        </View>

        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* Header */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('debates.inviteValidation.invitationTitle')}</Text>
          </View>

          {/* Badge inviteur */}
          <View style={styles.inviterBadge}>
            <View style={styles.inviterAvatarContainer}>
              <View style={styles.inviterAvatar}>
                <Text style={styles.inviterInitial}>
                  {(invitation.inviter?.username || 'A')[0].toUpperCase()}
                </Text>
              </View>
            </View>
            <View style={styles.inviterInfo}>
              <Text style={styles.inviterLabel}>{t('debates.inviteValidation.invitationFrom')}</Text>
              <Text style={styles.inviterName}>{invitation.inviter?.username || t('debates.inviteValidation.unknownFriend')}</Text>
            </View>
          </View>

          {/* Carte details du debat */}
          <View style={styles.debateCard}>
            <View style={styles.cardSection}>
              <Text style={styles.cardIcon}>📝</Text>
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t('debates.inviteValidation.debateSubject')}</Text>
                <Text style={styles.cardText}>{invitation.debate?.title}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.cardSection}>
              <Text style={styles.cardIcon}>💬</Text>
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t('debates.inviteValidation.positionOf', { username: invitation.inviter?.username })}</Text>
                <Text style={styles.cardText}>{invitation.debate?.hostView}</Text>
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.cardSection}>
              <Text style={styles.cardIcon}>🔒</Text>
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t('debates.inviteValidation.privateContext')}</Text>
                {invitation.privateContext ? (
                  <>
                    {isEditingContext ? (
                      <TextInput
                        style={styles.contextInput}
                        value={privateContext}
                        onChangeText={setPrivateContext}
                        multiline
                        numberOfLines={4}
                        maxLength={500}
                        placeholderTextColor={COLORS.GREY_MEDIUM}
                      />
                    ) : (
                      <Text style={styles.cardText}>{invitation.privateContext}</Text>
                    )}
                    <SecondaryButton
                      onPress={() => {
                        trigger('button-tap');
                        setIsEditingContext(!isEditingContext);
                      }}
                      style={styles.editContextButton}
                      textStyle={styles.editContextButtonText}
                    >
                      {isEditingContext ? t('debates.inviteValidation.validate') : t('debates.inviteValidation.editContext')}
                    </SecondaryButton>
                  </>
                ) : (
                  <Text style={styles.noContextText}>{t('debates.inviteValidation.noContextAdded')}</Text>
                )}
              </View>
            </View>

            <View style={styles.divider} />

            <View style={styles.cardSection}>
              <Text style={styles.cardIcon}>⏱️</Text>
              <View style={styles.cardContent}>
                <Text style={styles.cardLabel}>{t('debates.inviteValidation.duration')}</Text>
                <Text style={styles.cardText}>{t('debates.inviteValidation.minutesPerPlayer', { minutes: invitation.debate?.mode })}</Text>
              </View>
            </View>
          </View>

          {/* Formulaire position */}
          <View style={styles.formCard}>
            <Text style={styles.formLabel}>{t('debates.inviteValidation.yourPosition')}</Text>
            <TextInput
              style={styles.input}
              placeholder="Ex: Non, il faut des alternatives d'abord"
              placeholderTextColor={COLORS.GREY_MEDIUM}
              value={guestView}
              onChangeText={setGuestView}
              maxLength={100}
              multiline
              blurOnSubmit={true}
              returnKeyType="done"
            />
            <Text style={styles.hint}>{t('debates.inviteValidation.characterCount', { count: guestView.length })}</Text>
          </View>

          {/* Bouton */}
          {isJoining ? (
            <View style={styles.loaderContainer}>
              <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
              <Text style={styles.joiningText}>{t('debates.inviteValidation.connectingToDebate')}</Text>
            </View>
          ) : (
            <PrimaryButton
              onPress={handleJoin}
              disabled={guestView.trim().length === 0}
              style={styles.joinButton}
            >
              {t('debates.inviteValidation.joinDebate')}
            </PrimaryButton>
          )}
        </ScrollView>
      </SafeAreaView>
    </KeyboardAvoidingView>
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

  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },

  loaderCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  loadingText: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },

  backButtonContainer: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 100,
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 60,
    paddingBottom: 40,
  },

  header: {
    alignItems: 'center',
    marginBottom: 24,
  },

  title: {
    fontSize: 28,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
  },

  inviterBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    marginBottom: 20,
    paddingVertical: 8,
  },

  inviterAvatarContainer: {
    position: 'relative',
  },

  inviterAvatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: COLORS.ROYAL_BLUE,
    borderWidth: 3,
    borderColor: COLORS.INK,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },

  inviterInitial: {
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
  },

  inviterInfo: {
    gap: 2,
  },

  inviterLabel: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  inviterName: {
    fontSize: 20,
    fontFamily: 'Raleway-Black',
    color: COLORS.YELLOW_CORE,
  },

  debateCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  cardSection: {
    flexDirection: 'row',
    gap: 12,
    paddingVertical: 8,
  },

  cardIcon: {
    fontSize: 24,
    marginTop: 2,
  },

  cardContent: {
    flex: 1,
    gap: 6,
  },

  cardLabel: {
    fontSize: 12,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.YELLOW_CORE,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  cardText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    lineHeight: 20,
  },

  noContextText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    fontStyle: 'italic',
  },

  divider: {
    height: 2,
    backgroundColor: COLORS.border,
    marginVertical: 8,
    borderRadius: 1,
  },

  contextInput: {
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 2,
    borderColor: COLORS.border,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 12,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
  },

  editContextButton: {
    alignSelf: 'flex-start',
    marginTop: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },

  editContextButtonText: {
    fontSize: 13,
  },

  formCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 16,
    marginBottom: 24,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  formLabel: {
    fontSize: 16,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
    marginBottom: 12,
  },

  input: {
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textPrimary,
    minHeight: 80,
    textAlignVertical: 'top',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  hint: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    marginTop: 8,
    fontStyle: 'italic',
  },

  joinButton: {
    paddingVertical: 18,
  },

  loaderContainer: {
    alignItems: 'center',
    gap: 12,
    paddingVertical: 20,
  },

  joiningText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
  },
});
