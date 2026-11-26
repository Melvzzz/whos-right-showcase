import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
  Easing
} from 'react-native-reanimated';
import { COLORS } from '../constants/colors';
import { FONTS, FONT_SIZES } from '../constants/fonts';
import { useAsyncDebates } from '../hooks/useAsyncDebates';
import { useAuth } from '../hooks/useAuth';
import { AsyncDebateCard } from './AsyncDebateCard';
import { InvitationCodeModal } from './InvitationCodeModal';
import InvitationsService from '../services/invitations.service';
import type { NavigationProp } from '../types/navigation';
import type { Debate } from '../services/debates.service';

// Hauteur estimée d'une carte de débat (ajuster selon le design réel)
const CARD_HEIGHT = 120;
const MAX_VISIBLE_ITEMS = 3;
const SCROLL_CONTAINER_HEIGHT = CARD_HEIGHT * MAX_VISIBLE_ITEMS + 48; // 48px pour les paddings

interface AsyncDebateListProps {
  filter?: 'ongoing' | 'invitations' | 'completed' | 'all';
  navigation?: any;
  showHeader?: boolean;
  sortByUrgency?: boolean;
  maxItems?: number; // Nombre max d'items avant scroll/expand
}

// Composant Badge Animé
const AnimatedStickerBadge: React.FC<{ isUrgent: boolean; text: string }> = ({ isUrgent, text }) => {
  const rotation = useSharedValue(0);
  const scale = useSharedValue(1);

  useEffect(() => {
    if (isUrgent) {
      // 🎚️ ANIMATION URGENT SIMPLE
      const WIGGLE_DURATION = 800;  // 👈 Durée rotation (ex: 1200 = plus lent)

      // Simple aller-retour : -12 ↔ +12 (angle prononcé)
      rotation.value = withRepeat(
        withTiming(12, { duration: WIGGLE_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true  // reverse = aller-retour automatique
      );

      const SCALE_DURATION = 1200;  // 👈 Durée scale (ex: 1600 = plus lent)

      // Simple pulse : 1 ↔ 1.15 (scale prononcé)
      scale.value = withRepeat(
        withTiming(1.15, { duration: SCALE_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true  // reverse = aller-retour automatique
      );
    } else {
      // 🎚️ ANIMATION MY TURN SIMPLE
      const PULSE_DURATION = 1600;  // 👈 Durée pulse (ex: 2200 = plus lent)

      // Simple pulse : 1 ↔ 1.1 (scale prononcé)
      scale.value = withRepeat(
        withTiming(1.1, { duration: PULSE_DURATION, easing: Easing.inOut(Easing.ease) }),
        -1,
        true  // reverse = aller-retour automatique
      );
    }
  }, [isUrgent]);

  const animatedStyle = useAnimatedStyle(() => {
    return {
      transform: [
        { rotate: `${rotation.value}deg` },
        { scale: scale.value }
      ]
    };
  });

  return (
    <Animated.View style={[styles.stickerBadge, isUrgent && styles.stickerBadgeUrgent, animatedStyle]}>
      <Text style={styles.stickerBadgeText}>{text}</Text>
    </Animated.View>
  );
};

export const AsyncDebateList: React.FC<AsyncDebateListProps> = ({
  filter = 'all',
  navigation: propNavigation,
  showHeader = true,
  sortByUrgency: externalSortByUrgency,
  maxItems = MAX_VISIBLE_ITEMS,
}) => {
  const { t } = useTranslation();
  const navHook = useNavigation<NavigationProp>();
  const navigation = propNavigation || navHook;
  const { debates, isLoading, error, refetch, getTimeRemaining } = useAsyncDebates();
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [internalSortByUrgency, setInternalSortByUrgency] = useState(true);

  // ✅ NOUVEAU : État pour le modal d'invitation
  const [showInvitationModal, setShowInvitationModal] = useState(false);
  const [selectedDebateForInvite, setSelectedDebateForInvite] = useState<Debate | null>(null);
  const [inviteCode, setInviteCode] = useState<string>('');

  // Utiliser le tri externe si fourni, sinon utiliser le tri interne
  const sortByUrgency = externalSortByUrgency !== undefined ? externalSortByUrgency : internalSortByUrgency;

  // Rafraîchir les débats quand l'écran devient actif
  useFocusEffect(
    React.useCallback(() => {
      refetch();
    }, [refetch])
  );

  // Filtrer et trier les débats
  const filteredDebates = React.useMemo(() => {
    // Ne pas trier si l'utilisateur n'est pas encore chargé (évite le tri incorrect au premier rendu)
    if (!user?.id) {
      return debates;
    }

    // 0. Pré-filtrage : Exclure les débats terminés déjà vus OU vieux de plus de 3 jours
    const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
    let preFiltered = debates.filter(debate => {
      const isFinished = debate.status === 'quit' || debate.status === 'completed' || debate.status === 'scored';
      if (!isFinished) return true;

      // Récap déjà vu → masquer
      if (debate.recapViewedBy?.includes(user.id)) return false;

      // Terminé depuis plus de 3 jours sans avoir vu le récap → masquer aussi
      if (debate.endedAt) {
        const endedAgo = Date.now() - new Date(debate.endedAt).getTime();
        if (endedAgo > threeDaysMs) return false;
      }

      return true;
    });

    // 1. Filtrage par catégorie
    let filtered = filter === 'all' ? preFiltered : preFiltered.filter(debate => {
      switch (filter) {
        case 'ongoing':
          return ['myturn', 'waiting', 'urgent'].includes(debate.status);
        case 'invitations':
          return debate.status === 'searching' || debate.invitation;
        case 'completed':
          return ['quit', 'completed', 'scored'].includes(debate.status);
        default:
          return true;
      }
    });

    // 2. Tri
    if (sortByUrgency) {
      filtered = [...filtered].sort((a, b) => {
        // Débats terminés toujours en dernier
        const isQuitA = a.status === 'quit' || a.status === 'completed' || a.status === 'scored';
        const isQuitB = b.status === 'quit' || b.status === 'completed' || b.status === 'scored';
        if (isQuitA !== isQuitB) return isQuitA ? 1 : -1;

        // Vérifier si c'est le tour de l'utilisateur
        const isMyTurnA = a.currentTurnUserId === user.id && a.status !== 'waiting';
        const isMyTurnB = b.currentTurnUserId === user.id && b.status !== 'waiting';

        // Prioriser les débats où c'est mon tour
        if (isMyTurnA !== isMyTurnB) return isMyTurnA ? -1 : 1;

        // Pour les débats où c'est mon tour, trier par temps restant (urgent en premier)
        if (isMyTurnA && isMyTurnB) {
          const remainingA = getTimeRemaining(a);
          const remainingB = getTimeRemaining(b);

          if (remainingA !== null && remainingB !== null) {
            return remainingA - remainingB;
          }
          if (remainingA !== null) return -1;
          if (remainingB !== null) return 1;
        }

        // Par défaut, trier par date
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return dateB - dateA;
      });
    } else {
      // Tri par date la plus récente (updatedAt décroissant)
      filtered = [...filtered].sort((a, b) => {
        const dateA = new Date(a.updatedAt || a.createdAt).getTime();
        const dateB = new Date(b.updatedAt || b.createdAt).getTime();
        return dateB - dateA; // Plus récent en premier
      });
    }

    return filtered;
  }, [debates, filter, sortByUrgency, getTimeRemaining, user?.id]);

  // Limiter l'affichage selon maxItems (par défaut 3)
  const displayedDebates = expanded ? filteredDebates : filteredDebates.slice(0, maxItems);
  const hasMore = filteredDebates.length > maxItems;

  // Calculer la hauteur du conteneur scroll
  const scrollHeight = Math.min(displayedDebates.length, maxItems) * CARD_HEIGHT + 48;

  const handleDebatePress = (debate: any) => {
    if (debate.status === 'quit' || debate.status === 'completed' || debate.status === 'scored') {
      navigation.navigate('RecapA', {
        debateId: debate.id,
        firstVisit: true,
      });
    } else {
      // Sinon navigation vers l'écran de débat asynchrone
      navigation.navigate('AsyncDebateScreen', { debate });
    }
  };

  // ✅ NOUVEAU : Handler pour afficher le modal d'invitation (débats privés en attente)
  const handleShowInvitation = useCallback(async (debate: Debate) => {
    try {
      // Configurer le token pour InvitationsService
      if (user?.token) {
        InvitationsService.setAuthToken(user.token);
      }

      // Récupérer les invitations de l'utilisateur
      const invitations = await InvitationsService.getUserInvitations();

      // Trouver l'invitation correspondant à ce débat
      const invitation = invitations.find((inv: any) => inv.debateId === debate.id);

      if (invitation?.inviteCode) {
        setInviteCode(invitation.inviteCode);
        setSelectedDebateForInvite(debate);
        setShowInvitationModal(true);
      } else {
        console.warn('Aucun code d\'invitation trouvé pour ce débat');
      }
    } catch (error) {
      console.error('Erreur lors de la récupération de l\'invitation:', error);
    }
  }, [user?.token]);

  // Fonction de rendu pour chaque item de débat
  const renderDebateItem = useCallback((debate: any) => {
    // Calculer les états du badge
    const isMyTurn = debate.currentTurnUserId === user?.id;
    const isWaiting = debate.status === 'waiting';
    const remaining = getTimeRemaining(debate);
    // ✅ URGENT seulement si moins de 6h restantes (et non 24h)
    const isUrgent = remaining !== null && remaining < 6 * 60 * 60 * 1000 && isMyTurn;

    // ✅ NOUVEAU : Vérifier si l'utilisateur a déjà vu le récap
    const hasViewedRecap = debate.recapViewedBy?.includes(user?.id || '') || false;
    const isDebateQuit = debate.status === 'quit' || debate.status === 'completed' || debate.status === 'scored';

    return (
      <View key={debate.id} style={styles.cardWrapper}>
        {/* Badge "À votre tour" / "URGENT" / "TERMINÉ" ANIMÉ */}
        {isDebateQuit && !hasViewedRecap ? (
          // Badge "TERMINÉ" pour débats quit non encore vus
          <View style={styles.stickerBadgeFinished}>
            <Text style={styles.stickerBadgeText}>{t('debates.async.card.finished')}</Text>
          </View>
        ) : isMyTurn && !isWaiting && !isDebateQuit ? (
          // Badge "À votre tour" / "URGENT" pour débats en cours
          <AnimatedStickerBadge
            isUrgent={isUrgent}
            text={isUrgent ? '⚠️ URGENT !' : t('debates.async.card.yourTurn')}
          />
        ) : null}

        <AsyncDebateCard
          debate={debate}
          onPress={() => handleDebatePress(debate)}
          onDelete={refetch}
          hideBadge={true}
          onShowInvitation={handleShowInvitation}
        />
      </View>
    );
  }, [user?.id, getTimeRemaining, t, refetch, handleDebatePress, handleShowInvitation]);

  return (
    <View style={styles.container}>
      {/* En-tête avec bouton de tri - conditionnel selon showHeader */}
      {showHeader && (
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{t('debates.async.list.title')}</Text>
          <View style={styles.headerRight}>
            {/* Bouton de tri par urgence (seulement si pas de contrôle externe) */}
            {externalSortByUrgency === undefined && (
              <TouchableOpacity
                style={[styles.sortButton, sortByUrgency && styles.sortButtonActive]}
                onPress={() => setInternalSortByUrgency(!internalSortByUrgency)}
                activeOpacity={0.7}
              >
                <Text style={styles.sortIcon}>⚡</Text>
              </TouchableOpacity>
            )}
            {/* Badge compteur */}
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{filteredDebates.length}</Text>
            </View>
          </View>
        </View>
      )}

      {/* Afficher un loader pendant le chargement initial */}
      {isLoading && filteredDebates.length === 0 ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.loadingText}>{t('debates.async.list.loading')}</Text>
        </View>
      ) : error ? (
        /* Afficher une erreur si nécessaire */
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{t('debates.async.list.error')}</Text>
        </View>
      ) : filteredDebates.length === 0 ? (
        /* État vide - toujours visible quand pas de débats */
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>{t('debates.async.list.empty')}</Text>
        </View>
      ) : (
        /* Liste des débats */
        <>
          <View style={styles.list}>
            {displayedDebates.map((debate) => renderDebateItem(debate))}
          </View>

          {/* Bouton "Voir plus/moins" */}
          {hasMore && (
            <TouchableOpacity
              style={styles.expandButton}
              onPress={() => setExpanded(!expanded)}
              activeOpacity={0.7}
            >
              <Text style={styles.expandButtonText}>
                {expanded
                  ? t('debates.async.list.reduce')
                  : t(filteredDebates.length - maxItems > 1 ? 'debates.async.list.seeMorePlural' : 'debates.async.list.seeMore', { count: filteredDebates.length - maxItems })}
              </Text>
            </TouchableOpacity>
          )}
        </>
      )}

      {/* ✅ NOUVEAU : Modal d'invitation pour les débats privés en attente */}
      <InvitationCodeModal
        visible={showInvitationModal}
        onClose={() => {
          setShowInvitationModal(false);
          setSelectedDebateForInvite(null);
          setInviteCode('');
        }}
        inviteCode={inviteCode}
        debateTitle={selectedDebateForInvite?.title || ''}
        hostView={selectedDebateForInvite?.hostView}
        maxMessages={selectedDebateForInvite?.maxMessagesPerUser}
        isAsync={selectedDebateForInvite?.isLive === false}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginBottom: 10,
  },
  cardWrapper: {
    paddingTop: 20, // ✅ Espace en haut pour le badge
    paddingHorizontal: 0, // ✅ Réduit pour que les cartes soient plus larges
    marginBottom: 0, // Espace entre les wrappers
    position: 'relative', // ✅ Pour que le badge absolute se positionne par rapport au wrapper
  },
  // 🎯 BADGE AUTOCOLLANT PENCHÉ (Maintenant HORS du Swipeable)
  stickerBadge: {
    position: 'absolute',
    top: 4, // Position dans le wrapper (padding de 16 - 12 = 4)
    right: 0, // Position dans le wrapper (padding de 8 - 8 = 0)
    backgroundColor: COLORS.success,
    paddingVertical: 5, // ✅ Légèrement augmenté pour "pousser" le contenu
    paddingHorizontal: 8, // ✅ Légèrement augmenté pour "pousser" le contenu
    borderRadius: 8,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 6,
    zIndex: 10,
    transform: [{ rotate: '8deg' }],
  },
  stickerBadgeUrgent: {
    backgroundColor: COLORS.RED_ERROR,
    transform: [{ rotate: '12deg' }],
  },
  stickerBadgeFinished: {
    position: 'absolute',
    top: 4,
    right: 0,
    backgroundColor: COLORS.GREY_MEDIUM,
    paddingVertical: 7, // ✅ Légèrement augmenté pour "pousser" le contenu
    paddingHorizontal: 13, // ✅ Légèrement augmenté pour "pousser" le contenu
    borderRadius: 8,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 2, height: 3 },
    shadowOpacity: 0.3,
    shadowRadius: 0,
    elevation: 6,
    zIndex: 10,
    transform: [{ rotate: '8deg' }],
  },
  stickerBadgeText: {
    fontSize: 10,
    fontFamily: 'Raleway-Black',
    color: COLORS.white,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  headerTitle: {
    fontSize: FONT_SIZES.SUBTITLE.MEDIUM,
    fontFamily: FONTS.bold,
    color: COLORS.textPrimary,
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  sortButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    justifyContent: 'center',
    alignItems: 'center',
  },
  sortButtonActive: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
    borderWidth: 3,
  },
  sortIcon: {
    fontSize: 16,
  },
  badge: {
    backgroundColor: COLORS.primary,
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    fontSize: FONT_SIZES.sm,
    fontFamily: FONTS.bold,
    color: COLORS.white,
  },
  list: {
    gap: 0, // Les cartes ont déjà leur marginBottom
    overflow: 'visible', // ✅ CRUCIAL : Permet aux badges et glows de dépasser
  },
  scrollContainer: {
    overflow: 'visible',
  },
  scrollContent: {
    paddingBottom: 8,
    overflow: 'visible',
  },
  flatListContent: {
    paddingBottom: 8,
    overflow: 'visible',
  },
  expandButton: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 25,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 0,
    alignSelf: 'center',
    borderWidth: 3,
    borderColor: '#000000',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  expandButtonText: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY?.MEDIUM || 14,
    fontFamily: 'Raleway-ExtraBold',
  },
  loadingContainer: {
    paddingVertical: 24,
    alignItems: 'center',
    gap: 12,
  },
  loadingText: {
    fontSize: FONT_SIZES.sm,
    fontFamily: FONTS.regular,
    color: COLORS.textSecondary,
  },
  errorContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  errorText: {
    fontSize: FONT_SIZES.sm,
    fontFamily: FONTS.regular,
    color: COLORS.error,
  },
  emptyContainer: {
    paddingVertical: 24,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: FONT_SIZES.sm,
    fontFamily: 'Raleway-SemiBold',
    color: COLORS.textSecondary,
  },
});
