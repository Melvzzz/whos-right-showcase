import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Alert,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  withSequence,
  Easing,
  interpolateColor,
} from 'react-native-reanimated';
import { COLORS } from '../../constants/colors';
import type { RootStackScreenProps } from '../../types/navigation';
import DebatesService, { Debate } from '../../services/debates.service';
import ArgumentsService from '../../services/arguments.service';
import { useAuth } from '../../hooks/useAuth';
import { useTranslation } from 'react-i18next';
import { Ionicons } from '@expo/vector-icons';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { SecondaryButton } from '../../components/SecondaryButton';
import { useHaptics } from '../../hooks/useHaptics';

type Props = RootStackScreenProps<'WaitingScreen'>;

// Composant pour les dots animés du loader
const AnimatedDot: React.FC<{ delay: number }> = ({ delay }) => {
  const translateY = useSharedValue(0);

  useEffect(() => {
    const timeout = setTimeout(() => {
      translateY.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }),
          withTiming(-8, { duration: 420, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 420, easing: Easing.inOut(Easing.ease) }),
          withTiming(0, { duration: 560 })
        ),
        -1,
        false
      );
    }, delay);

    return () => clearTimeout(timeout);
  }, [delay, translateY]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return <Animated.View style={[styles.dot, animatedStyle]} />;
};

export const WaitingScreen: React.FC<Props> = ({ navigation, route }) => {
  const debate = route.params?.debate as Debate;
  const { user } = useAuth();
  const { t } = useTranslation();
  const { trigger } = useHaptics();

  const [waitingTime, setWaitingTime] = useState(0);
  const [cancelling, setCancelling] = useState(false);

  const hasExplicitlyCancelledRef = useRef(false);
  const hasBeenCleanedRef = useRef(false);

  const [reservations, setReservations] = useState<Array<{
    username: string;
    timestamp: Date;
    isActive: boolean;
  }>>([]);

  // Animation pulse pour le badge "En attente"
  const pulseAnimation = useSharedValue(0);

  useEffect(() => {
    pulseAnimation.value = withRepeat(
      withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.ease) }),
      -1,
      true
    );
  }, [pulseAnimation]);

  const pulseStyle = useAnimatedStyle(() => {
    const borderColor = interpolateColor(
      pulseAnimation.value,
      [0, 1],
      [COLORS.YELLOW_CORE, COLORS.ROYAL_BLUE]
    );
    return { borderColor };
  });

  // Configuration Socket.IO pour détecter quand un invité rejoint
  useEffect(() => {
    if (!user?.token || !debate?.id) return;

    console.log('🔌 [WaitingScreen] Configuration Socket.IO pour l\'hôte');

    ArgumentsService.setAuthToken(user.token);
    ArgumentsService.initializeSocket(user.token);
    ArgumentsService.joinDebateRoom(debate.id);

    ArgumentsService.setupSocketListeners(debate.id, {
      onLlmDebug: (data) => {
        console.log('🤖 LLM Debug:', data);
      }
    });

    const socket = (ArgumentsService as any).socket;
    if (socket) {
      // ✅ Rejoindre la waiting room pour tracking côté serveur
      // Permet d'annuler automatiquement le débat si le host disconnect
      if (user?.id) {
        socket.emit('join_waiting_room', { debateId: debate.id, userId: user.id });
        console.log('👀 [WaitingScreen] Joined waiting room for tracking');
      }
      const handleGuestJoined = (data: any) => {
        console.log('🎉 [WaitingScreen] Un invité a rejoint le débat !', data);

        if (data.debateId === debate.id) {
          trigger('button-success');
          hasExplicitlyCancelledRef.current = true;
          hasBeenCleanedRef.current = true;

          // ✅ Quitter la waiting room car le débat démarre
          socket.emit('leave_waiting_room', { debateId: debate.id });

          console.log('🚀 [WaitingScreen] Navigation vers DebateScreen');
          navigation.navigate('DebateScreen', {
            debate: {
              ...debate,
              ...data.debate,
              status: 'active'
            }
          });
        }
      };

      const handleDebateStarted = (data: any) => {
        console.log('🏁 [WaitingScreen] Débat démarré !', data);

        if (data.debateId === debate.id) {
          trigger('button-success');
          hasExplicitlyCancelledRef.current = true;
          hasBeenCleanedRef.current = true;

          // ✅ Quitter la waiting room car le débat démarre
          socket.emit('leave_waiting_room', { debateId: debate.id });

          console.log('🚀 [WaitingScreen] Navigation automatique vers DebateScreen');
          navigation.navigate('DebateScreen', {
            debate: {
              ...debate,
              ...data.debate,
              status: 'active'
            }
          });
        }
      };

      const handleDebateReserved = (data: any) => {
        console.log('📋 [WaitingScreen] Quelqu\'un a réservé le débat !', data);

        if (data.debateId === debate.id) {
          trigger('selection');
          setReservations(prev => {
            const username = data.username || t('debates.waiting.anonymousUser');
            const existingIndex = prev.findIndex(r => r.username === username && r.isActive);

            if (existingIndex !== -1) {
              return prev;
            }

            return [...prev, {
              username: username,
              timestamp: new Date(data.timestamp || new Date()),
              isActive: true
            }];
          });
        }
      };

      const handleDebateUnreserved = (data: any) => {
        console.log('📋❌ [WaitingScreen] Quelqu\'un a libéré sa réservation', data);

        if (data.debateId === debate.id) {
          setReservations(prev =>
            prev.map(reservation =>
              reservation.username === (data.username || t('debates.waiting.anonymousUser')) && reservation.isActive
                ? { ...reservation, isActive: false }
                : reservation
            )
          );
        }
      };

      const handleDebateCancelled = (data: any) => {
        console.log('❌ [WaitingScreen] Le débat a été annulé', data);

        if (data.debateId === debate.id) {
          if (debate.hostId !== user?.id) {
            trigger('button-error');
            Alert.alert(
              t('debates.waiting.cancelled'),
              data.message || t('debates.waiting.cancelledMessage'),
              [
                {
                  text: 'OK',
                  onPress: () => {
                    // Utiliser reset pour empêcher le swipe back vers cet écran
                    navigation.reset({
                      index: 0,
                      routes: [{ name: 'DebateSelection' }],
                    });
                  }
                }
              ]
            );
          }
        }
      };

      socket.on('guest_joined_debate', handleGuestJoined);
      socket.on('debate_started', handleDebateStarted);
      socket.on('debate_reserved', handleDebateReserved);
      socket.on('debate_unreserved', handleDebateUnreserved);
      socket.on('debate_cancelled', handleDebateCancelled);

      return () => {
        console.log('🔌 [WaitingScreen] Nettoyage Socket.IO');
        // ✅ Quitter la waiting room pour arrêter le tracking
        socket.emit('leave_waiting_room', { debateId: debate.id });
        socket.off('guest_joined_debate', handleGuestJoined);
        socket.off('debate_started', handleDebateStarted);
        socket.off('debate_reserved', handleDebateReserved);
        socket.off('debate_unreserved', handleDebateUnreserved);
        socket.off('debate_cancelled', handleDebateCancelled);
        ArgumentsService.removeSocketListeners();
        ArgumentsService.leaveDebateRoom(debate.id);
      };
    }
  }, [user?.token, debate?.id, navigation]);

  // Timer d'attente
  useEffect(() => {
    const interval = setInterval(() => {
      setWaitingTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  // Mise à jour des temps de réservation
  useEffect(() => {
    if (reservations.length === 0) return;

    const interval = setInterval(() => {
      setReservations(prev => [...prev]);
    }, 10000);

    return () => clearInterval(interval);
  }, [reservations.length]);

  // Nettoyage automatique
  useFocusEffect(
    React.useCallback(() => {
      hasExplicitlyCancelledRef.current = false;
      hasBeenCleanedRef.current = false;

      return () => {
        if (!hasExplicitlyCancelledRef.current && !hasBeenCleanedRef.current && debate?.status === 'waiting') {
          console.log('🧹 [WaitingScreen] Nettoyage automatique - utilisateur a quitté sans annuler');

          hasBeenCleanedRef.current = true;

          DebatesService.cancelDebate(debate.id).catch(error => {
            const isAlreadyCancelled = error && typeof error === 'object' && 'response' in error &&
              (error as any).response?.status === 400;

            if (isAlreadyCancelled) {
              console.log('ℹ️ [WaitingScreen] Débat déjà annulé lors du nettoyage automatique - normal');
            } else {
              console.warn('⚠️ [WaitingScreen] Erreur lors du nettoyage automatique:', error);
            }
          });
        } else if (hasExplicitlyCancelledRef.current) {
          console.log('ℹ️ [WaitingScreen] Pas de nettoyage automatique - utilisateur a explicitement annulé');
        } else if (hasBeenCleanedRef.current) {
          console.log('ℹ️ [WaitingScreen] Pas de nettoyage automatique - déjà nettoyé');
        }
      };
    }, [debate?.id, debate?.status])
  );

  const formatWaitingTime = () => {
    const minutes = Math.floor(waitingTime / 60);
    const seconds = waitingTime % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  };

  const formatTimeSince = (timestamp: Date) => {
    const now = new Date();
    const diffInSeconds = Math.floor((now.getTime() - timestamp.getTime()) / 1000);

    if (diffInSeconds < 60) {
      return t('debates.waiting.agoSeconds', { seconds: diffInSeconds });
    } else {
      const minutes = Math.floor(diffInSeconds / 60);
      return t('debates.waiting.agoMinutes', { minutes });
    }
  };

  const handleCancel = async () => {
    trigger('button-tap');
    try {
      setCancelling(true);
      hasExplicitlyCancelledRef.current = true;
      hasBeenCleanedRef.current = true;

      console.log('🔄 [WaitingScreen] Annulation explicite du débat par l\'utilisateur');
      await DebatesService.cancelDebate(debate.id);
      console.log('✅ [WaitingScreen] Débat annulé avec succès');

      // Utiliser reset pour empêcher le swipe back vers cet écran
      navigation.reset({
        index: 0,
        routes: [{ name: 'DebateSelection' }],
      });

    } catch (error) {
      console.error('❌ [WaitingScreen] Erreur lors de l\'annulation explicite:', error);

      const isAlreadyCancelled = error && typeof error === 'object' && 'response' in error &&
        (error as any).response?.status === 400;

      if (!isAlreadyCancelled) {
        hasExplicitlyCancelledRef.current = false;
        hasBeenCleanedRef.current = false;
      }

      let errorMessage = t('debates.waiting.cancelError');
      if (error && typeof error === 'object' && 'response' in error) {
        const axiosError = error as any;
        if (axiosError.response?.data?.message) {
          errorMessage = axiosError.response.data.message;
        }
      }

      if (!isAlreadyCancelled) {
        Alert.alert(t('common.error'), errorMessage);
      } else {
        console.log('ℹ️ [WaitingScreen] Débat déjà annulé - navigation sans erreur');
        // Utiliser reset pour empêcher le swipe back vers cet écran
        navigation.reset({
          index: 0,
          routes: [{ name: 'DebateSelection' }],
        });
      }
    } finally {
      setCancelling(false);
    }
  };

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          {/* Header avec titre et loader */}
          <View style={styles.header}>
            <Text style={styles.title}>{t('debates.waiting.title')}</Text>

            {/* Dots animés */}
            <View style={styles.dotsContainer}>
              <AnimatedDot delay={0} />
              <AnimatedDot delay={140} />
              <AnimatedDot delay={280} />
            </View>

            {/* Timer */}
            <View style={styles.timerBadge}>
              <Ionicons name="time-outline" size={16} color={COLORS.YELLOW_CORE} />
              <Text style={styles.timerText}>
                {t('debates.waiting.waitingSince', { time: formatWaitingTime() })}
              </Text>
            </View>
          </View>

          {/* Carte du débat */}
          <Animated.View style={[styles.debateCard, pulseStyle]}>
            <Text style={styles.cardDecoration}>⚔️</Text>

            <Text style={styles.debateTitle}>{debate.title}</Text>

            {/* Mode badge */}
            <View style={styles.modeBadge}>
              <Text style={styles.modeIcon}>
                {debate.mode <= 5 ? '⚡' : '🕐'}
              </Text>
              <Text style={styles.modeText}>
                {t('debates.waiting.modeText', { minutes: debate.mode })}
              </Text>
            </View>

            {/* Point de vue */}
            <View style={styles.viewSection}>
              <Text style={styles.viewLabel}>{t('debates.waiting.hostViewLabel')}</Text>
              <View style={styles.viewBox}>
                <Text style={styles.viewText}>{debate.hostView}</Text>
              </View>
            </View>

            {/* Thèmes */}
            {debate.themes && debate.themes.length > 0 && (
              <View style={styles.themesContainer}>
                {debate.themes.map((theme, index) => (
                  <View key={index} style={styles.themeChip}>
                    <Text style={styles.themeText}>{theme}</Text>
                  </View>
                ))}
              </View>
            )}
          </Animated.View>

          {/* Section des réservations */}
          {reservations.length > 0 && (
            <View style={styles.reservationsSection}>
              <Text style={styles.reservationsTitle}>
                {t('debates.waiting.activityTitle')}
              </Text>

              {reservations.slice(-3).reverse().map((reservation, index) => (
                <View
                  key={`${reservation.username}-${reservation.timestamp.getTime()}-${index}`}
                  style={[
                    styles.reservationCard,
                    reservation.isActive && styles.reservationCardActive
                  ]}
                >
                  <View style={styles.reservationHeader}>
                    <View style={styles.reservationUser}>
                      <View style={[
                        styles.reservationAvatar,
                        reservation.isActive && styles.reservationAvatarActive
                      ]}>
                        <Text style={styles.reservationAvatarText}>
                          {reservation.username.charAt(0).toUpperCase()}
                        </Text>
                      </View>
                      <Text style={[
                        styles.reservationUsername,
                        reservation.isActive && styles.reservationUsernameActive
                      ]}>
                        @{reservation.username}
                      </Text>
                    </View>
                    <Text style={styles.reservationTime}>
                      {formatTimeSince(reservation.timestamp)}
                    </Text>
                  </View>
                  <Text style={[
                    styles.reservationStatus,
                    reservation.isActive && styles.reservationStatusActive
                  ]}>
                    {reservation.isActive
                      ? `📝 ${t('debates.waiting.reserved')}`
                      : `❌ ${t('debates.waiting.unreserved')}`
                    }
                  </Text>
                </View>
              ))}
            </View>
          )}

          {/* Bouton d'annulation */}
          <View style={styles.buttonContainer}>
            {cancelling ? (
              <View style={styles.loadingButton}>
                <ActivityIndicator size="small" color={COLORS.NIGHT_BLUE} />
                <Text style={styles.loadingText}>{t('debates.waiting.cancelling')}</Text>
              </View>
            ) : (
              <SecondaryButton onPress={handleCancel}>
                {t('debates.waiting.cancel')}
              </SecondaryButton>
            )}
          </View>
        </ScrollView>
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

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 40,
    paddingBottom: 40,
    alignItems: 'center',
  },

  // Header
  header: {
    alignItems: 'center',
    marginBottom: 30,
  },

  title: {
    fontSize: 32,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 20,
  },

  dotsContainer: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 20,
  },

  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: COLORS.YELLOW_CORE,
  },

  timerBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.surface,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },

  timerText: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.YELLOW_CORE,
  },

  // Carte du débat
  debateCard: {
    width: '100%',
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 6,
    marginBottom: 20,
    position: 'relative',
    overflow: 'visible',
  },

  cardDecoration: {
    position: 'absolute',
    right: 16,
    top: 16,
    fontSize: 48,
    opacity: 0.08,
    zIndex: 0,
  },

  debateTitle: {
    fontSize: 20,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 26,
    zIndex: 1,
  },

  modeBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.surfaceDark,
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: COLORS.INK,
    alignSelf: 'center',
    marginBottom: 16,
  },

  modeIcon: {
    fontSize: 16,
  },

  modeText: {
    fontSize: 13,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },

  viewSection: {
    marginBottom: 16,
  },

  viewLabel: {
    fontSize: 12,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  viewBox: {
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 12,
    padding: 14,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },

  viewText: {
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.PAPER_IVORY,
    lineHeight: 20,
  },

  themesContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    justifyContent: 'center',
  },

  themeChip: {
    backgroundColor: COLORS.ROYAL_BLUE + '30',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.ROYAL_BLUE,
  },

  themeText: {
    fontSize: 12,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },

  // Réservations
  reservationsSection: {
    width: '100%',
    marginBottom: 30,
  },

  reservationsTitle: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    marginBottom: 12,
    textAlign: 'center',
  },

  reservationCard: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 12,
    marginBottom: 10,
    borderWidth: 3,
    borderLeftWidth: 5,
    borderColor: COLORS.INK,
    borderLeftColor: COLORS.GREY_MEDIUM,
  },

  reservationCardActive: {
    borderLeftColor: COLORS.YELLOW_CORE,
    backgroundColor: COLORS.YELLOW_CORE + '10',
  },

  reservationHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },

  reservationUser: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },

  reservationAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 2,
    borderColor: COLORS.INK,
    justifyContent: 'center',
    alignItems: 'center',
  },

  reservationAvatarActive: {
    backgroundColor: COLORS.YELLOW_CORE,
  },

  reservationAvatarText: {
    fontSize: 12,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.PAPER_IVORY,
  },

  reservationUsername: {
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    color: COLORS.PAPER_IVORY,
  },

  reservationUsernameActive: {
    color: COLORS.YELLOW_CORE,
  },

  reservationTime: {
    fontSize: 11,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
  },

  reservationStatus: {
    fontSize: 13,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.GREY_MEDIUM,
  },

  reservationStatusActive: {
    color: COLORS.PAPER_IVORY,
    fontWeight: '700',
  },

  // Bouton
  buttonContainer: {
    width: '100%',
    alignItems: 'center',
  },

  loadingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: COLORS.PAPER_IVORY,
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 16,
    borderWidth: 3,
    borderColor: COLORS.INK,
  },

  loadingText: {
    fontSize: 16,
    fontFamily: 'Raleway-Bold',
    color: COLORS.NIGHT_BLUE,
  },
});
