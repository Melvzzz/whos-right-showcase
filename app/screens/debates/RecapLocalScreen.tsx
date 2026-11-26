import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  SafeAreaView,
  Pressable,
} from 'react-native';
import Reanimated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../../constants/fonts';
import type { RootStackScreenProps } from '../../types/navigation';
import { Ionicons } from '@expo/vector-icons';
import LocalDuelService from '../../services/local-duel.service';
import { useHaptics } from '../../hooks/useHaptics';
import { useTranslation } from 'react-i18next';

type Props = RootStackScreenProps<'RecapLocal'>;

type LocalDebateStats = {
  totalArguments: number;
  player1Arguments: number;
  player2Arguments: number;
  totalDuration: number;
  averageArgumentLength: number;
  bestArgument?: {
    playerName: string;
    content: string;
    score?: number;
    justification?: string;
  };
  longestArgument?: {
    playerName: string;
    content: string;
    duration: number;
  };
};

export const RecapLocalScreen: React.FC<Props> = ({ navigation, route }) => {
  const { debateId } = route.params;
  const { trigger } = useHaptics();
  const { t } = useTranslation();

  const [loading, setLoading] = useState(true);
  const [debate, setDebate] = useState<any>(null);
  const [stats, setStats] = useState<LocalDebateStats | null>(null);

  // ✅ NOUVEAU : Composant carte d'argument pressable avec effet 3D
  const PressableArgumentCard = ({
    argument,
    type,
    extraInfo,
  }: {
    argument: { playerName: string; content: string; score?: number; justification?: string; duration?: number };
    type: 'best' | 'longest';
    extraInfo?: string;
  }) => {
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

      return {
        transform: [{ translateY }],
        shadowOffset: {
          width: 0,
          height: Math.max(0, 4 - pressAnimation.value * 2),
        },
      };
    });

    // ✅ Trouver l'argument complet dans debate.arguments pour avoir l'ID
    const findFullArgument = () => {
      if (!debate?.arguments) return null;
      return debate.arguments.find(
        (arg: any) => arg.cleanText === argument.content || arg.rawText === argument.content || arg.content === argument.content
      );
    };

    const handlePress = () => {
      trigger('button-tap');
      const fullArgument = findFullArgument();

      if (fullArgument) {
        navigation.navigate('ArgumentDetailDuel', {
          argumentId: fullArgument.id,
          debateId: debate.id,
          isLocalDebate: true,
          argumentData: {
            ...fullArgument,
            author: {
              username: argument.playerName,
              isCurrentUser: argument.playerName === debate.player1?.name
            },
            debate: {
              id: debate.id,
              title: debate.title,
              hostView: debate.player1?.viewpoint || '',
              guestView: debate.player2?.viewpoint || ''
            }
          }
        });
      } else {
        console.warn('⚠️ Argument non trouvé dans debate.arguments, navigation impossible');
      }
    };

    return (
      <Pressable
        onPress={handlePress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
      >
        <Reanimated.View style={[styles.sectionContent, styles.pressableCard, animatedStyle]}>
          <Text style={styles.argumentAuthor}>{t('debates.recapLocal.byPlayer', { name: argument.playerName })}</Text>
          <Text style={styles.argumentText}>"{argument.content}"</Text>
          {type === 'best' && argument.score && (
            <Text style={styles.argumentScore}>{t('debates.recapLocal.scoreOutOf10', { score: argument.score })}</Text>
          )}
          {type === 'best' && argument.justification && (
            <Text style={styles.argumentJustification}>{argument.justification}</Text>
          )}
          {type === 'longest' && extraInfo && (
            <Text style={styles.argumentDuration}>{extraInfo}</Text>
          )}
        </Reanimated.View>
      </Pressable>
    );
  };

  useEffect(() => {
    loadLocalDebateRecap();
  }, []);

  const loadLocalDebateRecap = async () => {
    try {
      setLoading(true);

      // Charger les données du débat terminé depuis le storage local
      const savedDebates = await LocalDuelService.getLocalDebatesHistory();
      const targetDebate = savedDebates.find(d => d.id === debateId);

      if (!targetDebate) {
        Alert.alert(t('common.error'), t('debates.recapLocal.errors.notFound'));
        navigation.goBack();
        return;
      }

      console.log('📊 Chargement récap débat local:', targetDebate.title);

      // Calculer les statistiques
      const debateStats = LocalDuelService.calculateDebateStats(targetDebate);

      setDebate(targetDebate);
      setStats(debateStats);

    } catch (error) {
      console.error('❌ Erreur chargement récap local:', error);
      Alert.alert(t('common.error'), t('debates.recapLocal.errors.loadFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleBackToMenu = () => {
    trigger('button-tap');
    // Retourner au menu principal
    navigation.navigate('Home');
  };

  const handleNewDebate = () => {
    trigger('button-tap');
    // Lancer un nouveau débat local
    navigation.navigate('LocalDuelSetup');
  };

  const formatDuration = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  if (loading) {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient colors={[COLORS.NIGHT_BLUE, COLORS.NIGHT_BLUE + 'DD']} style={styles.gradient}>
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>{t('debates.recapLocal.preparing')}</Text>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  if (!debate || !stats) {
    return (
      <SafeAreaView style={styles.container}>
        <LinearGradient colors={[COLORS.NIGHT_BLUE, COLORS.NIGHT_BLUE + 'DD']} style={styles.gradient}>
          <View style={styles.errorContainer}>
            <Text style={styles.errorText}>{t('debates.recapLocal.loadError')}</Text>
            <TouchableOpacity style={styles.backButton} onPress={() => {
              trigger('button-tap');
              navigation.goBack();
            }}>
              <Text style={styles.backButtonText}>{t('common.back')}</Text>
            </TouchableOpacity>
          </View>
        </LinearGradient>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <LinearGradient colors={[COLORS.NIGHT_BLUE, COLORS.NIGHT_BLUE + 'DD']} style={styles.gradient}>

        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>🏆 {t('debates.recapLocal.title')}</Text>
          <Text style={styles.subtitle}>{t('debates.recapLocal.subtitle')}</Text>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>

          {/* Informations du débat */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 {t('debates.recapLocal.debateSection')}</Text>
            <View style={styles.sectionContent}>
              <Text style={styles.debateTitle}>{debate.title}</Text>

              <View style={styles.playersInfo}>
                <View style={styles.playerInfo}>
                  <Text style={styles.playerName}>👤 {debate.player1.name}</Text>
                  <Text style={styles.playerViewpoint}>"{debate.player1.viewpoint}"</Text>
                </View>

                <Text style={styles.vs}>VS</Text>

                <View style={styles.playerInfo}>
                  <Text style={styles.playerName}>👤 {debate.player2.name}</Text>
                  <Text style={styles.playerViewpoint}>"{debate.player2.viewpoint}"</Text>
                </View>
              </View>
            </View>
          </View>

          {/* Statistiques */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📊 {t('debates.recapLocal.statsSection')}</Text>
            <View style={styles.sectionContent}>
              <View style={styles.statRow}>
                <Text style={styles.statLabel}>{t('debates.recapLocal.stats.totalArguments')}</Text>
                <Text style={styles.statValue}>{stats.totalArguments}</Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>{t('debates.recapLocal.stats.playerArguments', { name: debate.player1.name })}</Text>
                <Text style={styles.statValue}>{stats.player1Arguments}</Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>{t('debates.recapLocal.stats.playerArguments', { name: debate.player2.name })}</Text>
                <Text style={styles.statValue}>{stats.player2Arguments}</Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>{t('debates.recapLocal.stats.totalDuration')}</Text>
                <Text style={styles.statValue}>{formatDuration(stats.totalDuration)}</Text>
              </View>

              <View style={styles.statRow}>
                <Text style={styles.statLabel}>{t('debates.recapLocal.stats.averageLength')}</Text>
                <Text style={styles.statValue}>{stats.averageArgumentLength} {t('debates.recapLocal.stats.characters')}</Text>
              </View>
            </View>
          </View>

          {/* Meilleur argument (si disponible) - Cliquable avec effet 3D */}
          {stats.bestArgument && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>⭐ {t('debates.recapLocal.bestArgument')}</Text>
              <PressableArgumentCard
                argument={stats.bestArgument}
                type="best"
              />
            </View>
          )}

          {/* Argument le plus long - Cliquable avec effet 3D */}
          {stats.longestArgument && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>📝 {t('debates.recapLocal.longestArgument')}</Text>
              <PressableArgumentCard
                argument={stats.longestArgument}
                type="longest"
                extraInfo={t('debates.recapLocal.duration', { time: formatDuration(stats.longestArgument.duration) })}
              />
            </View>
          )}
        </ScrollView>

        {/* Actions */}
        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.actionButton, styles.secondaryButton]}
            onPress={handleBackToMenu}
          >
            <Ionicons name="home-outline" size={20} color={COLORS.NIGHT_BLUE} />
            <Text style={styles.secondaryButtonText}>{t('debates.recapLocal.mainMenu')}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionButton, styles.primaryButton]}
            onPress={handleNewDebate}
          >
            <Ionicons name="add-circle-outline" size={20} color={COLORS.NIGHT_BLUE} />
            <Text style={styles.primaryButtonText}>{t('debates.recapLocal.newDebate')}</Text>
          </TouchableOpacity>
        </View>
      </LinearGradient>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.NIGHT_BLUE,
  },
  gradient: {
    flex: 1,
  },

  // Loading & Error
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.LARGE,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorText: {
    color: COLORS.RED_ERROR,
    fontSize: FONT_SIZES.BODY.LARGE,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    marginBottom: 20,
  },
  backButton: {
    backgroundColor: COLORS.YELLOW_CORE,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  backButtonText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },

  // Header
  header: {
    alignItems: 'center',
    paddingVertical: 30,
    paddingHorizontal: 20,
  },
  title: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.TITLE.LARGE,
    fontFamily: getFontFamily(FONTS.TITLE.REGULAR, FONTS.TITLE.FALLBACK),
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 5,
  },
  subtitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    opacity: 0.8,
  },

  // Content
  content: {
    flex: 1,
    paddingHorizontal: 20,
  },
  section: {
    marginBottom: 25,
  },
  sectionTitle: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.SUBTITLE.LARGE,
    fontFamily: getFontFamily(FONTS.SUBTITLE.REGULAR, FONTS.SUBTITLE.FALLBACK),
    fontWeight: 'bold',
    marginBottom: 15,
  },
  sectionContent: {
    backgroundColor: COLORS.GREY_MEDIUM + '15',
    borderRadius: 15,
    padding: 20,
    borderWidth: 1,
    borderColor: COLORS.YELLOW_CORE + '30',
  },

  // ✅ NOUVEAU : Style pour les cartes pressables avec effet 3D
  pressableCard: {
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },

  // Débat info
  debateTitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.SUBTITLE.MEDIUM,
    fontFamily: getFontFamily(FONTS.SUBTITLE.REGULAR, FONTS.SUBTITLE.FALLBACK),
    fontWeight: 'bold',
    marginBottom: 15,
    textAlign: 'center',
  },
  playersInfo: {
    alignItems: 'center',
  },
  playerInfo: {
    alignItems: 'center',
    marginVertical: 10,
  },
  playerName: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.BODY.LARGE,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
    marginBottom: 5,
  },
  playerViewpoint: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontStyle: 'italic',
    textAlign: 'center',
  },
  vs: {
    color: COLORS.RED_ERROR,
    fontSize: FONT_SIZES.TITLE.MEDIUM,
    fontFamily: getFontFamily(FONTS.TITLE.REGULAR, FONTS.TITLE.FALLBACK),
    fontWeight: 'bold',
    marginVertical: 10,
  },

  // Stats
  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.GREY_MEDIUM + '20',
  },
  statLabel: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    flex: 1,
  },
  statValue: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },

  // Arguments
  argumentAuthor: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
    marginBottom: 10,
  },
  argumentText: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    lineHeight: 22,
    marginBottom: 10,
  },
  argumentScore: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
    marginBottom: 5,
  },
  argumentJustification: {
    color: COLORS.PAPER_IVORY,
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    opacity: 0.8,
    fontStyle: 'italic',
  },
  argumentDuration: {
    color: COLORS.YELLOW_CORE,
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },

  // Actions
  actions: {
    flexDirection: 'row',
    paddingHorizontal: 20,
    paddingBottom: 30,
    paddingTop: 20,
    gap: 15,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 15,
    borderRadius: 25,
    gap: 8,
  },
  primaryButton: {
    backgroundColor: COLORS.YELLOW_CORE,
  },
  primaryButtonText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },
  secondaryButton: {
    backgroundColor: COLORS.PAPER_IVORY,
  },
  secondaryButtonText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    fontWeight: 'bold',
  },
});