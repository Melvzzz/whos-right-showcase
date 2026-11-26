import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  interpolateColor
} from 'react-native-reanimated';
import { COLORS } from '../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../constants/fonts';
import { Debate } from '../services/debates.service';
import { useAuth } from '../hooks/useAuth';
import { useAsyncDebates } from '../hooks/useAsyncDebates';
import { Avatar } from './Avatar';

interface AsyncDebateCardProps {
  debate: Debate;
  onPress: () => void;
  onDelete?: () => void;
  hideBadge?: boolean; // ✅ Cacher le badge car maintenant géré par AsyncDebateList
  onShowInvitation?: (debate: Debate) => void; // ✅ NOUVEAU : Callback pour afficher l'invitation (débats privés en attente)
}

// Composant pour un point animé dans le loader de recherche
const AnimatedDot: React.FC<{ delay: number }> = ({ delay }) => {
  const translateY = useSharedValue(0);
  const opacity = useSharedValue(0.4);

  useEffect(() => {
    // Animation avec délai pour créer l'effet de vague
    const animate = () => {
      translateY.value = withRepeat(
        withSequence(
          withTiming(0, { duration: 0 }), // Point de départ
          withTiming(-8, { duration: 420, easing: Easing.inOut(Easing.ease) }), // Monte
          withTiming(0, { duration: 420, easing: Easing.inOut(Easing.ease) }), // Descend
          withTiming(0, { duration: 560 }) // Pause
        ),
        -1,
        false
      );

      opacity.value = withRepeat(
        withSequence(
          withTiming(0.4, { duration: 0 }),
          withTiming(1, { duration: 420, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 420, easing: Easing.inOut(Easing.ease) }),
          withTiming(0.4, { duration: 560 })
        ),
        -1,
        false
      );
    };

    // Appliquer le délai puis démarrer l'animation
    const timer = setTimeout(animate, delay);
    return () => clearTimeout(timer);
  }, [delay]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
    opacity: opacity.value,
  }));

  return <Animated.View style={[styles.dot, animatedStyle]} />;
};

// Composant AnimatedMetaBox pour animer la case timer/messages
const AnimatedMetaBox: React.FC<{
  isUrgent: boolean;
  isWaiting: boolean;
  timeLeft: string;
  myMessagesCount: number;
  maxMessages: number;
}> = ({ isUrgent, isWaiting, timeLeft, myMessagesCount, maxMessages }) => {
  const backgroundOpacity = useSharedValue(1);

  useEffect(() => {
    if (isUrgent) {
      // 🎚️ ANIMATION METABOX URGENT : pulsation du background
      // ⏱️ Durée (en millisecondes) :
      const METABOX_PULSE_DURATION = 1800;  // 👈 Change cette valeur (ex: 2500 = plus lent)

      backgroundOpacity.value = withRepeat(
        withSequence(
          withTiming(0.5, { duration: METABOX_PULSE_DURATION, easing: Easing.inOut(Easing.ease) }),
          withTiming(1, { duration: METABOX_PULSE_DURATION, easing: Easing.inOut(Easing.ease) })
        ),
        -1,
        false
      );
    } else {
      backgroundOpacity.value = 1;
    }
  }, [isUrgent]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      backgroundColor: isUrgent
        ? interpolateColor(
            backgroundOpacity.value,
            [0.5, 1],
            ['rgba(255, 59, 48, 0.05)', 'rgba(255, 59, 48, 0.15)']
          )
        : COLORS.surfaceDark,
    };
  });

  return (
    <Animated.View style={[styles.metaBox, isUrgent && styles.metaBoxUrgent, animatedStyle]}>
      <View style={styles.metaItem}>
        <Text style={styles.metaIcon}>{isUrgent ? '⚠️' : '⏱️'}</Text>
        <Text style={[styles.metaValue, isUrgent && styles.metaValueUrgent]}>
          {timeLeft}
        </Text>
      </View>
      <View style={styles.metaItem}>
        <Text style={styles.metaIcon}>💬</Text>
        <Text style={styles.metaValue}>{`${myMessagesCount}/${maxMessages}`}</Text>
      </View>
    </Animated.View>
  );
};

export const AsyncDebateCard: React.FC<AsyncDebateCardProps> = ({ debate, onPress, onDelete, hideBadge = false, onShowInvitation }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { getTimeRemaining, formatTimeRemaining } = useAsyncDebates();

  const [timeLeft, setTimeLeft] = useState<string>('');
  const [waitingTimeLeft, setWaitingTimeLeft] = useState<string>('');
  const [isUrgent, setIsUrgent] = useState(false);

  // Déterminer l'adversaire
  const isHost = debate.hostId === user?.id;
  const opponent = isHost ? debate.guest : debate.host;

  // Déterminer si c'est mon tour
  const isMyTurn = debate.currentTurnUserId === user?.id;

  // Déterminer si le débat est en attente d'adversaire
  // ✅ ASYNC : Les débats en 'waiting' ou 'reserved' sont considérés en attente
  // 'reserved' = réservation temporaire (peut être une réservation fantôme)
  // Seuls les débats 'active' (avec au moins 1 argument) affichent le contour jaune
  const isWaiting = debate.status === 'waiting' || debate.status === 'reserved';

  // Déterminer si le débat est terminé (quit ou completed) - DOIT être défini AVANT les useEffect
  const isDebateQuit = debate.status === 'quit' || debate.status === 'completed' || debate.status === 'scored';

  // Fonction pour formater le temps de manière lisible
  // < 24h : "23h34" / >= 24h : "1j12h" (FR) ou "1d12h" (EN)
  const formatTimeReadable = (milliseconds: number): string => {
    const totalHours = Math.floor(milliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((milliseconds % (1000 * 60 * 60)) / (1000 * 60));

    if (totalHours < 24) {
      // Moins de 24h : afficher "23h34"
      return `${totalHours}h${minutes.toString().padStart(2, '0')}`;
    } else {
      // Plus de 24h : afficher "1j12h" (FR) ou "1d12h" (EN)
      const days = Math.floor(totalHours / 24);
      const remainingHours = totalHours % 24;
      const dayLabel = t('common.dayShort', { defaultValue: 'j' }); // 'j' pour FR, 'd' pour EN
      return `${days}${dayLabel}${remainingHours}h`;
    }
  };

  // Timer pour le temps restant avant suppression auto (48h = 2 jours)
  useEffect(() => {
    // ✅ CORRECTION : Arrêter le timer si le débat est terminé
    if (!isWaiting || isDebateQuit) return;

    const updateWaitingTimer = () => {
      // ✅ Utiliser expiresAt au lieu de calculer depuis createdAt
      if (debate.expiresAt) {
        const expiresAt = new Date(debate.expiresAt).getTime();
        const now = Date.now();
        const remaining = expiresAt - now;

        if (remaining > 0) {
          setWaitingTimeLeft(formatTimeReadable(remaining));
        } else {
          setWaitingTimeLeft('00:00');
        }
      } else {
        // Fallback si expiresAt n'existe pas (ne devrait pas arriver)
        setWaitingTimeLeft('--:--');
      }
    };

    updateWaitingTimer();
    const interval = setInterval(updateWaitingTimer, 10000); // Toutes les 10s

    return () => clearInterval(interval);
  }, [debate, isWaiting, isDebateQuit]);

  // Mettre à jour le timer de tour toutes les 10 secondes
  useEffect(() => {
    // ✅ CORRECTION : Arrêter le timer si le débat est terminé ou en attente
    if (isWaiting || isDebateQuit) return;

    const updateTimer = () => {
      const remaining = getTimeRemaining(debate);
      if (remaining !== null) {
        setTimeLeft(formatTimeReadable(remaining));
        // ✅ Marquer comme urgent si moins de 6h restantes ET c'est notre tour (et non 24h)
        setIsUrgent(remaining < 6 * 60 * 60 * 1000 && isMyTurn);
      } else {
        setTimeLeft('');
      }
    };

    updateTimer();
    const interval = setInterval(updateTimer, 10000); // Toutes les 10s

    return () => clearInterval(interval);
  }, [debate, getTimeRemaining, isWaiting, isMyTurn, isDebateQuit]);

  // ✅ CORRIGÉ : Nombre de messages utilisés par l'utilisateur (selon son rôle)
  const myMessagesCount = isHost
    ? (debate._count?.hostArguments || 0)
    : (debate._count?.guestArguments || 0);
  const maxMessages = debate.maxMessagesPerUser || 0;

  // ✅ NOUVEAU : Vérifier si l'utilisateur a déjà vu le récap
  const hasViewedRecap = debate.recapViewedBy?.includes(user?.id || '') || false;

  // Animation de pression 3D
  const pressAnimation = useSharedValue(0);

  const handlePressIn = () => {
    pressAnimation.value = withTiming(1, { duration: 100 });
  };

  const handlePressOut = () => {
    pressAnimation.value = withTiming(0, { duration: 150 });
  };

  // Gérer le clic : bloquer si en attente (sauf privé), rediriger vers RecapA si quit
  const handlePress = () => {
    if (isWaiting) {
      // ✅ Si débat privé en attente, afficher le modal d'invitation
      if (debate.isPrivate && onShowInvitation) {
        onShowInvitation(debate);
        return;
      }
      // Sinon, ne rien faire si le débat public est en attente
      return;
    }

    // ✅ Si le débat est quit, appeler onPress pour naviguer vers RecapA
    // Que ce soit le débat actif ou quit, on appelle toujours onPress
    onPress();
  };

  // Animation de la bordure
  const borderAnimation = useSharedValue(0);

  useEffect(() => {
    // ✅ Ne pas animer si le débat est en attente (même si currentTurnUserId est défini)
    if (isWaiting) {
      borderAnimation.value = 0;
      return;
    }

    if (isUrgent && isMyTurn) {
      // 🎚️ ANIMATION BORDURE URGENT : rouge <-> jaune avec 2e bordure qui pulse
      // ⏱️ Durée (en millisecondes) :
      const BORDER_URGENT_DURATION = 600;  // 👈 Change cette valeur (ex: 1000 = plus lent)

      borderAnimation.value = withRepeat(
        withTiming(1, { duration: BORDER_URGENT_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true  // reverse = aller-retour automatique
      );
    } else if (isMyTurn && !isUrgent) {
      // 🎚️ ANIMATION BORDURE MY TURN : clignotement jaune <-> noir (plus intense)
      // ⏱️ Durée (en millisecondes) :
      const BORDER_MY_TURN_DURATION = 500;  // 👈 Change cette valeur (ex: 800 = plus lent) - Réduit pour plus d'intensité

      borderAnimation.value = withRepeat(
        withTiming(1, { duration: BORDER_MY_TURN_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true  // reverse = aller-retour automatique
      );
    } else {
      borderAnimation.value = 0;
    }
  }, [isMyTurn, isUrgent, isWaiting]);

  const animatedCardStyle = useAnimatedStyle(() => {
    // Effet de pression 3D (déplacement vers le bas)
    const translateY = pressAnimation.value * 4; // Se déplace de 4px vers le bas
    const scale = 1 - pressAnimation.value * 0.02; // Légère réduction de taille (98%)

    if (isUrgent && isMyTurn) {
      // Bordure principale qui alterne rouge <-> jaune
      const borderColor = interpolateColor(
        borderAnimation.value,
        [0, 1],
        [COLORS.RED_ERROR, COLORS.YELLOW_CORE]
      );

      // Deuxième bordure (shadowOffset) qui s'épaissit et s'amincit (3 → 6 → 3)
      // Reste toujours rouge avec opacité
      // ✅ INVERSÉ : épaisse quand bordure rouge (0), mince quand bordure jaune (1)
      const secondBorderWidth = 3 + (1 - borderAnimation.value) * 3; // 6px quand rouge, 3px quand jaune
      const secondBorderOpacity = 0.3 + (1 - borderAnimation.value) * 0.3; // 0.6 quand rouge, 0.3 quand jaune

      return {
        transform: [{ translateY }, { scale }],
        borderColor,
        shadowColor: COLORS.RED_ERROR,
        shadowOffset: { width: 0, height: 0 },
        shadowRadius: secondBorderWidth,
        shadowOpacity: secondBorderOpacity,
      };
    } else if (isMyTurn && !isUrgent) {
      // Bordure qui clignote entre jaune moyen et jaune foncé
      const borderColor = interpolateColor(
        borderAnimation.value,
        [0, 1],
        ['#f5e156', '#c4a63d'] // Jaune moyen (plus foncé que BRIGHT_YELLOW) → Jaune foncé
      );

      return {
        transform: [{ translateY }, { scale }],
        borderColor,
      };
    }

    return {
      transform: [{ translateY }, { scale }],
    };
  });

  // ✅ Animation 3D pour le bouton "Voir le résultat"
  const buttonPressAnimation = useSharedValue(0);

  const handleButtonPressIn = () => {
    buttonPressAnimation.value = withTiming(4, { duration: 100 }); // Descendre de 4px
  };

  const handleButtonPressOut = () => {
    buttonPressAnimation.value = withTiming(0, { duration: 150 }); // Remonter
  };

  const animatedButtonStyle = useAnimatedStyle(() => {
    return {
      transform: [{ translateY: buttonPressAnimation.value }],
      // Réduire l'ombre proportionnellement à la descente
      shadowOffset: {
        width: 0,
        height: Math.max(0, 4 - buttonPressAnimation.value),
      },
    };
  });

  return (
    <TouchableOpacity
      onPress={handlePress}
      onPressIn={handlePressIn}
      onPressOut={handlePressOut}
      activeOpacity={1}
      disabled={isWaiting && !debate.isPrivate} // ✅ Désactiver seulement pour débats publics en attente
    >
      <Animated.View
        style={[
          styles.card,
          isWaiting && styles.searchingCard,
          !isWaiting && !isUrgent && styles.waitingCard,
          // ✅ Ne pas appliquer myTurnCard/urgentCard si en attente (même si currentTurnUserId est défini)
          isMyTurn && !isUrgent && !isWaiting && styles.myTurnCard,
          isUrgent && isMyTurn && !isWaiting && styles.urgentCard,
          animatedCardStyle,
        ]}
      >
          {/* Icône décorative translucide - Épées ou Drapeau selon status */}
          <Text style={styles.cardDecoration}>
            {isDebateQuit ? '🏁' : '⚔️'}
          </Text>

          {/* Badge "À votre tour" / "URGENT" - DÉSACTIVÉ car géré par AsyncDebateList */}
          {!hideBadge && isMyTurn && !isWaiting && (
            <View style={[styles.stickerBadge, isUrgent && styles.stickerBadgeUrgent]}>
              <Text style={styles.stickerBadgeText}>
                {isUrgent ? '⚠️ URGENT !' : t('debates.async.card.yourTurn')}
              </Text>
            </View>
          )}

          {/* Titre du débat */}
          <Text style={styles.debateTopic} numberOfLines={2}>
            {debate.title}
          </Text>

          {/* Container pour les 2 cases côte à côte */}
          <View style={styles.infoRow}>
            {/* ✅ Si débat terminé : afficher le bouton "Voir le résultat" */}
            {isDebateQuit && !hasViewedRecap ? (
              <View style={styles.finishedButtonContainer}>
                <TouchableOpacity
                  onPress={onPress}
                  onPressIn={handleButtonPressIn}
                  onPressOut={handleButtonPressOut}
                  activeOpacity={1}
                >
                  <Animated.View style={[styles.finishedButton, animatedButtonStyle]}>
                    <Text style={styles.finishedButtonText}>{t('debates.async.card.seeResults')}</Text>
                    <Text style={styles.finishedButtonIcon}>→</Text>
                  </Animated.View>
                </TouchableOpacity>
              </View>
            ) : !isDebateQuit ? (
              /* CASE 1 : Informations adversaire - Visible si débat actif */
              <View style={[styles.opponentInfo, isWaiting && styles.opponentSearching]}>
                {isWaiting ? (
                <>
                  <View style={styles.searchingLoader}>
                    <View style={styles.searchingDots}>
                      <AnimatedDot delay={0} />
                      <AnimatedDot delay={200} />
                      <AnimatedDot delay={400} />
                    </View>
                  </View>
                  <View style={styles.opponentDetails}>
                    <Text style={styles.searchingText}>
                      {debate.isPrivate
                        ? t('debates.async.card.waitingForFriend')
                        : t('debates.async.card.searchingOpponent')
                      }
                    </Text>
                    <View style={styles.opponentLevel}>
                      <Text style={styles.levelIcon}>⏱️</Text>
                      <Text style={styles.levelText}>{t('debates.async.card.deletionIn', { time: waitingTimeLeft })}</Text>
                    </View>
                  </View>
                </>
              ) : (
                <>
                  <View style={styles.opponentAvatarContainer}>
                    <Avatar
                      avatarId={opponent?.selectedAvatarId}
                      username={opponent?.username}
                      mode="bust"
                      size={36}
                    />
                  </View>
                  <View style={styles.opponentDetails}>
                    <View style={styles.opponentNameRow}>
                      <Text style={styles.vsText}>vs</Text>
                      <Text style={styles.opponentName}>{opponent?.username || '?'}</Text>
                    </View>
                    <View style={styles.opponentLevel}>
                      <Text style={styles.levelText}>{`${opponent?.elo || 1000} ELO`}</Text>
                    </View>
                  </View>
                </>
              )}
              </View>
            ) : null}

            {/* CASE 2 : Timer + Messages - Visible seulement si débat actif */}
            {!isDebateQuit && (
              <AnimatedMetaBox
                isUrgent={isUrgent}
                isWaiting={isWaiting}
                timeLeft={isWaiting ? waitingTimeLeft : timeLeft}
                myMessagesCount={myMessagesCount}
                maxMessages={maxMessages}
              />
            )}
          </View>
        </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  // 🎴 CARD BASE - Style Playground (COMPACT)
  card: {
    backgroundColor: COLORS.surface, // #1a1f26
    borderRadius: 16, // Moins arrondi pour gagner de la place
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderWidth: 3, // Border épais
    borderColor: COLORS.INK, // Noir
    position: 'relative',
    overflow: 'visible', // ✅ IMPORTANT : Permet au badge de dépasser sans être coupé
    // Shadow 3D comme le playground
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 }, // Réduit de 6 → 4
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },

  // 🔍 ÉTAT SEARCHING (en attente d'adversaire)
  searchingCard: {
    // Pas de style spécial, juste la base
  },

  // ⏳ ÉTAT WAITING (tour adversaire) - Border jaune simple
  waitingCard: {
    borderColor: COLORS.YELLOW_CORE,
    borderWidth: 4,
  },

  // ✅ ÉTAT MY TURN (notre tour) - Border jaune (glow géré par animation)
  myTurnCard: {
    borderColor: COLORS.YELLOW_CORE,
    borderWidth: 4,
    elevation: 0, // Pas d'elevation Android par défaut
    // Shadow géré par l'animation
  },

  // ⚠️ ÉTAT URGENT (notre tour + <24h) - Border rouge (2e bordure gérée par animation)
  urgentCard: {
    borderColor: COLORS.RED_ERROR,
    borderWidth: 5,
    elevation: 0, // Pas d'elevation Android par défaut
    // Shadow et 2e bordure gérés par l'animation
  },

  // 🎨 DÉCORATION - Icône translucide (PLUS PETITE)
  cardDecoration: {
    position: 'absolute',
    right: 12,
    top: 12,
    fontSize: 64, // Réduit de 88 → 64
    opacity: 0.06, // Encore plus discrète
    zIndex: 0,
  },

  // 🎯 BADGE AUTOCOLLANT PENCHÉ (Coin supérieur droit)
  stickerBadge: {
    position: 'absolute',
    top: -10,
    right: -10,
    backgroundColor: COLORS.success,
    paddingVertical: 3,
    paddingHorizontal: 6,
    borderRadius: 5,
    borderWidth: 2,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 1, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 4,
    zIndex: 10,
    transform: [{ rotate: '8deg' }],
  },

  stickerBadgeUrgent: {
    backgroundColor: COLORS.RED_ERROR,
    transform: [{ rotate: '12deg' }], // Encore plus penché quand urgent
  },

  stickerBadgeText: {
    fontSize: 9,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
  },

  // 📝 TITRE DU DÉBAT (COMPACT)
  debateTopic: {
    fontSize: 16, // Réduit de 20 → 16
    fontFamily: 'Raleway-Black',
    color: COLORS.textPrimary,
    marginBottom: 7, // Réduit de 16 → 10
    position: 'relative',
    zIndex: 1,
    lineHeight: 20, // Réduit de 26 → 20
  },

  // 📦 Container pour les 2 cases côte à côte
  infoRow: {
    flexDirection: 'row',
    gap: 8, // Espace entre les 2 cases
    alignItems: 'stretch', // ✅ Étire les enfants pour qu'ils aient la même hauteur
  },

  // 👤 CASE 1 : OPPONENT INFO (COMPACT)
  opponentInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 8,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.INK,
    position: 'relative',
    zIndex: 1,
    flex: 1, // ✅ Prend l'espace disponible
  },

  opponentSearching: {
    justifyContent: 'flex-start',
  },

  // 🔍 LOADER RECHERCHE (COMPACT)
  searchingLoader: {
    width: 36, // Réduit de 48 → 36
    height: 36, // Réduit de 48 → 36
    borderRadius: 18,
    backgroundColor: COLORS.surfaceDark,
    borderWidth: 2, // Réduit de 3 → 2
    borderColor: COLORS.INK,
    justifyContent: 'center',
    alignItems: 'center',
  },

  searchingDots: {
    flexDirection: 'row',
    gap: 3,
  },

  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: COLORS.ROYAL_BLUE,
  },

  searchingText: {
    fontSize: 13, // Réduit de 15 → 13
    fontFamily: 'Raleway-Bold',
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },

  // 👤 AVATAR ADVERSAIRE (COMPACT) - Container pour Avatar bust
  opponentAvatarContainer: {
    width: 36,
    height: 45, // Hauteur adaptée au mode bust (size * 1.3)
    overflow: 'hidden',
    justifyContent: 'flex-start',
    alignItems: 'center',
    marginTop: -8,
  },

  // 👤 DÉTAILS ADVERSAIRE (COMPACT)
  opponentDetails: {
    flex: 1,
    gap: 2, // Réduit de 4 → 2
  },

  opponentNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5, // Réduit de 6 → 5
  },

  vsText: {
    fontSize: 12, // Réduit de 14 → 12
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
  },

  opponentName: {
    fontSize: 14, // Réduit de 16 → 14
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.textPrimary,
  },

  opponentLevel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3, // Réduit de 4 → 3
  },

  levelIcon: {
    fontSize: 10, // Réduit de 12 → 10
  },

  levelText: {
    fontSize: 11, // Réduit de 13 → 11
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
  },

  // 📊 CASE 2 : META BOX (Timer + Messages)
  metaBox: {
    flexDirection: 'column',
    gap: 6,
    padding: 8,
    backgroundColor: COLORS.surfaceDark,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: COLORS.INK,
    minWidth: 70, // ✅ Compact mais lisible
    justifyContent: 'center',
    alignSelf: 'stretch', // ✅ S'étire pour avoir la même hauteur que opponentInfo
  },

  metaBoxUrgent: {
    borderColor: COLORS.RED_ERROR,
    backgroundColor: 'rgba(255, 59, 48, 0.1)',
  },

  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    justifyContent: 'center',
  },

  metaIcon: {
    fontSize: 12,
  },

  metaValue: {
    fontSize: 13,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.textPrimary,
  },

  metaValueUrgent: {
    color: COLORS.YELLOW_CORE,
  },

  // ❌ QUIT CARD (débats terminés) - COMPACT
  quitCard: {
    borderWidth: 2,
    borderColor: COLORS.GREY_MEDIUM,
    opacity: 0.9,
  },

  header: {
    marginBottom: 8, // Réduit de 12 → 8
  },

  title: {
    fontSize: 15, // Réduit de 18 → 15
    fontFamily: 'Raleway-Black',
    color: COLORS.textPrimary,
  },

  quitButtonContainer: {
    backgroundColor: COLORS.ROYAL_BLUE,
    paddingVertical: 10, // Réduit de 14 → 10
    paddingHorizontal: 12, // Réduit de 16 → 12
    borderRadius: 10, // Réduit de 12 → 10
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.INK,
  },

  quitButtonText: {
    fontSize: 13, // Réduit
    fontFamily: 'Raleway-Bold',
    color: COLORS.white,
  },

  // ✅ NOUVEAU : Container pour le bouton "Voir le résultat" (dans infoRow)
  finishedButtonContainer: {
    flex: 1, // Prend toute la largeur de infoRow
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 0,
  },

  finishedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: COLORS.ROYAL_BLUE,
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    // ✅ Drop shadow avec 0 blur sur l'axe Y
    shadowColor: COLORS.INK,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0, // 0 blur
    elevation: 4, // Pour Android
  },

  finishedButtonText: {
    fontSize: 15,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.white,
  },

  finishedButtonIcon: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
  },
});
