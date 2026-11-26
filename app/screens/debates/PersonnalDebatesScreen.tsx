import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS } from '../../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../../constants/fonts';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../hooks/useAuth';
import { useAsyncDebates } from '../../hooks/useAsyncDebates';
import { AsyncDebateList } from '../../components/AsyncDebateList';
import { DebateHistory } from '../profile/components/DebateHistory';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import type { RootStackScreenProps } from '../../types/navigation';
import type { DebateHistoryItem } from '../../services/profile.service';

type Props = RootStackScreenProps<'Home'>;

export const PersonnalDebatesScreen: React.FC<Props> = ({ navigation }) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { width: screenWidth } = useWindowDimensions();
  const isTablet = screenWidth >= 768;
  const { debates, isLoading, error } = useAsyncDebates();
  const [sortByUrgency, setSortByUrgency] = React.useState(true);

  // Animation 3D pour le bouton de tri
  const buttonPressAnimation = useSharedValue(0);

  // Calculate active debates count
  const activeDebatesCount = React.useMemo(() => {
    return debates.filter(debate =>
      ['myturn', 'waiting', 'urgent', 'searching'].includes(debate.status)
    ).length;
  }, [debates]);

  const handleDebatePress = (debate: DebateHistoryItem) => {
    if (debate.type === 'group') {
      navigation.navigate('GDebateParticipation', {
        debateId: debate.id,
        fromProfile: true,
      });
    } else if (debate.type === 'local') {
      navigation.navigate('RecapA', {
        debateId: debate.id,
        fromProfile: true,
        isLocalDebate: true,
      });
    } else {
      navigation.navigate('RecapA', {
        debateId: debate.id,
        fromProfile: true,
      });
    }
  };

  // Gestion animation 3D du bouton
  const handleButtonPressIn = () => {
    buttonPressAnimation.value = withTiming(1, { duration: 100 });
  };

  const handleButtonPressOut = () => {
    buttonPressAnimation.value = withTiming(0, { duration: 150 });
  };

  const animatedButtonStyle = useAnimatedStyle(() => {
    const translateY = buttonPressAnimation.value * 4;
    const scale = 1 - buttonPressAnimation.value * 0.05;

    return {
      transform: [{ translateY }, { scale }],
      shadowOffset: {
        width: 0,
        height: Math.max(0, 4 - buttonPressAnimation.value * 2),
      },
    };
  });

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />
      <SafeAreaView style={styles.safeArea} edges={[]}>
        {/* Content Area */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={[styles.scrollContent, isTablet && { paddingTop: 160 }]}
          showsVerticalScrollIndicator={false}
        >
          {/* Débats asynchrones - TOUS */}
          <View style={styles.asyncSection}>
            {/* Titre avec bouton de tri */}
            <View style={styles.titleRow}>
              <Text style={[styles.sectionTitle, isTablet && { fontSize: 34 }]}>{t('debates.async.list.title')}</Text>
              {/* Bouton de tri par urgence avec animation 3D */}
              <TouchableOpacity
                onPress={() => setSortByUrgency(!sortByUrgency)}
                onPressIn={handleButtonPressIn}
                onPressOut={handleButtonPressOut}
                activeOpacity={1}
              >
                <Animated.View
                  style={[
                    styles.sortButton,
                    sortByUrgency && styles.sortButtonActive,
                    animatedButtonStyle,
                  ]}
                >
                  <View style={styles.filterIcon}>
                    <View style={[styles.filterBar, sortByUrgency && styles.filterBarActive, styles.filterBarShort]} />
                    <View style={[styles.filterBar, sortByUrgency && styles.filterBarActive, styles.filterBarMedium]} />
                    <View style={[styles.filterBar, sortByUrgency && styles.filterBarActive, styles.filterBarLong]} />
                  </View>
                </Animated.View>
              </TouchableOpacity>
            </View>

            {/* État de chargement */}
            {isLoading && (
              <View style={styles.loadingContainer}>
                <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
                <Text style={styles.loadingText}>{t('common.loading', { defaultValue: 'Chargement...' })}</Text>
              </View>
            )}

            {/* Gestion d'erreur avec message convivial */}
            {error && !isLoading && (
              <View style={styles.errorContainer}>
                <Text style={styles.errorText}>
                  {t('debates.async.error', { defaultValue: 'Impossible de charger les débats. Veuillez réessayer.' })}
                </Text>
              </View>
            )}

            {/* Liste des débats */}
            {!isLoading && !error && (
              <AsyncDebateList
                filter="all"
                navigation={navigation}
                showHeader={false}
                sortByUrgency={sortByUrgency}
              />
            )}
          </View>

          {/* Historique complet des débats */}
          {user?.id && (
            <View style={styles.historySection}>
              <DebateHistory
                userId={user.id}
                onDebatePress={handleDebatePress}
              />
            </View>
          )}
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
  },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.PAPER_IVORY + '20',
    position: 'relative',
  },

  headerTitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.TITLE.MEDIUM,
    fontFamily: getFontFamily(FONTS.TITLE.REGULAR, FONTS.TITLE.FALLBACK),
    fontWeight: 'bold',
  },

  badge: {
    position: 'absolute',
    right: 20,
    backgroundColor: COLORS.YELLOW_CORE,
    borderRadius: 12,
    minWidth: 24,
    height: 24,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 8,
    borderWidth: 2,
    borderColor: COLORS.INK,
  },

  badgeText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },

  scrollView: {
    flex: 1,
  },

  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 120,
    paddingBottom: 10,
  },

  asyncSection: {
    marginBottom: 20,
    overflow: 'visible',
  },

  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 0,
  },

  sectionTitle: {
    fontSize: 28,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },

  sortButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surface,
    borderWidth: 3,
    borderColor: COLORS.INK,
    justifyContent: 'center',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },

  sortButtonActive: {
    backgroundColor: COLORS.YELLOW_CORE,
  },

  filterIcon: {
    width: 20,
    height: 16,
    justifyContent: 'space-between',
    alignItems: 'center',
    transform: [{ rotate: '180deg' }],
  },

  filterBar: {
    height: 3,
    backgroundColor: COLORS.PAPER_IVORY,
    borderRadius: 1.5,
  },

  filterBarActive: {
    backgroundColor: COLORS.INK,
  },

  filterBarShort: {
    width: 10,
  },

  filterBarMedium: {
    width: 14,
  },

  filterBarLong: {
    width: 18,
  },

  historySection: {
    marginTop: 0,
    marginHorizontal: -20,
  },

  loadingContainer: {
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingText: {
    marginTop: 12,
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
  },

  errorContainer: {
    paddingVertical: 20,
    paddingHorizontal: 16,
    backgroundColor: COLORS.INK + '20',
    borderRadius: 12,
    borderWidth: 2,
    borderColor: COLORS.INK,
    marginTop: 16,
  },

  errorText: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    textAlign: 'center',
  },
});
