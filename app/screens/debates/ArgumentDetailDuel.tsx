import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Linking,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

const { width } = Dimensions.get('window');
import { useRoute, useNavigation } from '@react-navigation/native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { COLORS } from '../../constants/colors';
import { useAuth } from '../../hooks/useAuth';
import type { RootStackScreenProps } from '../../types/navigation';
import { API_URL } from '../../constants/api';
import axios from 'axios';
import { useTranslation } from 'react-i18next';
import { AnimatedBackground } from '../../components/AnimatedBackground';
import { IconButton } from '../../components/IconButton';
import { useHaptics } from '../../hooks/useHaptics';

type Props = RootStackScreenProps<'ArgumentDetailDuel'>;

// Interface pour les données d'un argument en mode duel
interface ArgumentDetailDuelData {
  id: string;
  debateId: string;
  userId: string;
  turnIndex: number;
  rawText: string;
  cleanText: string;
  scoreTotal: number;
  reliability: number;
  impact: number;
  justification: string;
  factChecked: boolean;
  createdAt: string;
  // Nouveaux champs d'analyse
  briefJustification?: string;
  strengths?: string[];
  weaknesses?: string[];
  // Sources depuis sourcesData (JSON) ou ArgumentSource (fallback)
  sources: Array<{
    title: string;
    url: string;
    summary?: string;
    metadata?: any;
  }>;
  // Informations sur l'auteur
  author: {
    username: string;
    isCurrentUser: boolean;
  };
  // Informations sur le débat
  debate: {
    id: string;
    title: string;
    hostView: string;
    guestView: string;
  };
}

export const ArgumentDetailDuel: React.FC<Props> = ({ navigation }) => {
  const route = useRoute();
  const { user } = useAuth();
  const { t } = useTranslation();
  const { trigger } = useHaptics();

  const [argumentData, setArgumentData] = useState<ArgumentDetailDuelData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showFullJustification, setShowFullJustification] = useState(false);

  // Récupération des paramètres de navigation
  const params = route.params as {
    argumentId: string;
    debateId: string;
    isLocalDebate?: boolean;
    argumentData?: any;
  };

  // Fonction pour charger les détails de l'argument en mode duel
  const loadArgumentDetails = async (argumentId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const isLocal = params.isLocalDebate === true;
      console.log(`🔍 Chargement détails argument duel ${isLocal ? 'LOCAL' : 'EN LIGNE'} ${argumentId}`);

      const endpoint = isLocal
        ? `${API_URL}/local-debates/${params.debateId}/arguments/${argumentId}`
        : `${API_URL}/arguments/${argumentId}/details`;

      const response = await axios.get(endpoint);
      const result = response.data;

      const argumentDetails = isLocal ? result.argument : result.data;

      if (result.success && argumentDetails) {
        // Convertir sourcesdata/sourcesData en sources si nécessaire
        const sourcesDataKey = argumentDetails.sourcesData || argumentDetails.sourcesdata;
        if (sourcesDataKey && (!argumentDetails.sources || argumentDetails.sources.length === 0)) {
          argumentDetails.sources = sourcesDataKey.map((source: any, idx: number) => ({
            title: source.title || `Source #${idx + 1}`,
            url: source.url,
            summary: source.summary,
            metadata: source.metadata
          }));
          console.log('🔄 Conversion sourcesData → sources effectuée:', argumentDetails.sources.length);
        }

        setArgumentData(argumentDetails);
      } else {
        throw new Error(result.message || 'Erreur lors du chargement des détails');
      }
    } catch (error) {
      console.error('❌ Erreur chargement détails argument duel:', error);

      // Fallback avec données passées en paramètre si disponibles
      if (params.argumentData) {
        console.log('📋 Utilisation des données fallback passées en paramètre');
        console.log('📋 Données argumentData complètes:', params.argumentData);
        console.log('📋 Champs analyse:', {
          briefJustification: params.argumentData.briefJustification?.substring(0, 50),
          strengthsCount: params.argumentData.strengths?.length,
          weaknessesCount: params.argumentData.weaknesses?.length,
          sourcesCount: params.argumentData.sources?.length
        });

        let sourcesToUse: Array<{ title: string; url: string; summary?: string; metadata?: any }> = [];

        // Essayer sourcesdata d'abord (ancien format)
        if (params.argumentData.sourcesdata && Array.isArray(params.argumentData.sourcesdata)) {
          sourcesToUse = params.argumentData.sourcesdata.map((source: any, idx: number) => ({
            title: source.title || `Source #${idx + 1}`,
            url: source.url,
            summary: source.summary,
            metadata: source.metadata
          }));
          console.log('✅ Sources trouvées via sourcesdata:', sourcesToUse.length);
        }
        // Sinon essayer sources directement (nouveau format)
        else if (params.argumentData.sources && Array.isArray(params.argumentData.sources)) {
          sourcesToUse = params.argumentData.sources.map((source: any, idx: number) => ({
            title: source.title || `Source #${idx + 1}`,
            url: source.url,
            summary: source.summary,
            metadata: source.metadata
          }));
          console.log('✅ Sources trouvées via sources:', sourcesToUse.length);
        }
        else {
          console.log('⚠️ Aucune source trouvée dans les données argumentData');
          console.log('🔍 Propriétés disponibles:', Object.keys(params.argumentData));
        }

        const fallbackData: ArgumentDetailDuelData = {
          id: params.argumentData.id || argumentId,
          debateId: params.argumentData.debateId || params.debateId,
          userId: params.argumentData.userId || '',
          turnIndex: params.argumentData.turnIndex || 0,
          rawText: params.argumentData.rawText || '',
          cleanText: params.argumentData.cleanText || params.argumentData.rawText || 'Contenu non disponible',
          scoreTotal: params.argumentData.scoreTotal || params.argumentData.finalScoreWithBonus || 0,
          reliability: params.argumentData.reliability || 0,
          impact: params.argumentData.impact || 0,
          justification: params.argumentData.justification || 'Pas de justification disponible',
          factChecked: params.argumentData.factChecked || params.argumentData.needsFactcheck || false,
          createdAt: params.argumentData.createdAt || new Date().toISOString(),
          // Nouveaux champs d'analyse
          briefJustification: params.argumentData.briefJustification,
          strengths: params.argumentData.strengths || [],
          weaknesses: params.argumentData.weaknesses || [],
          sources: sourcesToUse,
          author: {
            username: params.argumentData.author?.username || 'Utilisateur inconnu',
            isCurrentUser: params.argumentData.author?.isCurrentUser || false
          },
          debate: {
            id: params.argumentData.debate?.id || params.debateId,
            title: params.argumentData.debate?.title || 'Débat',
            hostView: params.argumentData.debate?.hostView || '',
            guestView: params.argumentData.debate?.guestView || ''
          }
        };

        console.log('📋 Sources récupérées dans fallback:', {
          sourcesdataExists: !!params.argumentData.sourcesdata,
          sourcesdataLength: params.argumentData.sourcesdata?.length || 0,
          sourcesExists: !!params.argumentData.sources,
          sourcesLength: params.argumentData.sources?.length || 0,
          sourcesConverted: fallbackData.sources.length,
          firstSource: fallbackData.sources[0]
        });

        setArgumentData(fallbackData);
      } else {
        setError(error instanceof Error ? error.message : 'Erreur inconnue');
      }
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (params.argumentId) {
      loadArgumentDetails(params.argumentId);
    }
  }, [params.argumentId]);

  // Fonction pour retourner en arrière
  const handleGoBack = () => {
    trigger('button-tap');
    navigation.goBack();
  };

  // Helper pour détecter une URL
  const isUrl = (str: string) => {
    try {
      const url = new URL(str);
      return url.protocol === 'http:' || url.protocol === 'https:';
    } catch {
      return false;
    }
  };

  // Fonction pour extraire un titre lisible
  const extractReadableTitle = (url: string, index: number) => {
    try {
      // Cas spécial : URLs de redirection Vertex AI/Google
      if (url.includes('vertexaisearch.cloud.google.com') || url.includes('grounding-api-redirect')) {
        return `Source web #${index + 1}`;
      }

      // Pour les autres URLs, extraire et nettoyer le domaine
      const { hostname } = new URL(url);
      const cleanDomain = hostname.replace(/^www\./, '');

      return cleanDomain;
    } catch {
      return `Source #${index + 1}`;
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 15) return COLORS.success;
    if (score >= 10) return COLORS.YELLOW_CORE;
    if (score >= 5) return COLORS.warning;
    return COLORS.RED_ERROR;
  };

  const getScoreLabel = (score: number) => {
    if (score >= 15) return 'Excellent';
    if (score >= 10) return 'Bon';
    if (score >= 5) return 'Moyen';
    return 'Faible';
  };

  // Rendu de l'écran de chargement
  if (isLoading) {
    return (
      <View style={styles.container}>
        <AnimatedBackground enabled={true} theme="dark" opacity={1} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <IconButton
              type="action"
              icon={<Ionicons name="arrow-back" size={24} />}
              onPress={handleGoBack}
              size={50}
              backgroundColor={COLORS.surface}
              iconColor={COLORS.PAPER_IVORY}
            />
          </View>
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.YELLOW_CORE} />
            <Text style={styles.loadingText}>{t('debates.argumentDetailDuel.loading')}</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Rendu de l'écran d'erreur
  if (error || !argumentData) {
    return (
      <View style={styles.container}>
        <AnimatedBackground enabled={true} theme="dark" opacity={1} />
        <SafeAreaView style={styles.safeArea} edges={['top']}>
          <View style={styles.header}>
            <IconButton
              type="action"
              icon={<Ionicons name="arrow-back" size={24} />}
              onPress={handleGoBack}
              size={50}
              backgroundColor={COLORS.surface}
              iconColor={COLORS.PAPER_IVORY}
            />
          </View>
          <View style={styles.errorContainer}>
            <Text style={styles.errorIcon}>⚠️</Text>
            <Text style={styles.errorTitle}>{t('debates.argumentDetailDuel.errorTitle')}</Text>
            <Text style={styles.errorText}>{error}</Text>
            <TouchableOpacity
              style={styles.retryButton}
              onPress={() => {
                trigger('button-tap');
                loadArgumentDetails(params.argumentId);
              }}
            >
              <Text style={styles.retryButtonText}>{t('debates.argumentDetailDuel.retry')}</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // Rendu de la justification
  const renderJustification = () => {
    // Utiliser les nouveaux champs directement sur argumentData
    const hasNewFormat = argumentData.briefJustification ||
                         (argumentData.strengths && argumentData.strengths.length > 0) ||
                         (argumentData.weaknesses && argumentData.weaknesses.length > 0);

    // Vérifier si on a des détails supplémentaires à afficher
    const hasDetails = (argumentData.strengths && argumentData.strengths.length > 0) ||
                       (argumentData.weaknesses && argumentData.weaknesses.length > 0);

    const handleToggleDetails = () => {
      trigger('button-tap');
      setShowFullJustification(!showFullJustification);
    };

    return (
      <>
        <Text style={styles.sectionTitle}>📝 {t('debates.argumentDetailDuel.scoreJustification')}</Text>

        <View style={styles.justificationSection}>
          {hasNewFormat ? (
            <>
              {/* Brève justification - toujours visible */}
              {argumentData.briefJustification && (
                <Text style={[
                  styles.justificationText,
                  !showFullJustification && !hasDetails && { marginBottom: 0 }
                ]}>
                  {argumentData.briefJustification}
                </Text>
              )}

              {/* Bouton Voir plus/moins - seulement si on a des détails */}
              {hasDetails && (
                <TouchableOpacity
                  style={styles.seeMoreButton}
                  onPress={handleToggleDetails}
                  activeOpacity={0.7}
                >
                  <Text style={styles.seeMoreButtonText}>
                    {showFullJustification ? t('debates.argumentDetailDuel.seeLess') : t('debates.argumentDetailDuel.seeMore')}
                  </Text>
                  <Ionicons
                    name={showFullJustification ? "chevron-up" : "chevron-down"}
                    size={16}
                    color={COLORS.YELLOW_CORE}
                  />
                </TouchableOpacity>
              )}

              {/* Points forts - affichés seulement si showFullJustification */}
              {showFullJustification && argumentData.strengths && argumentData.strengths.length > 0 && (
                <View style={styles.detailSubSection}>
                  <Text style={styles.detailSubTitle}>✅ {t('debates.argumentDetailDuel.strengths')}</Text>
                  {argumentData.strengths.map((strength, index) => (
                    <View key={index} style={styles.listItem}>
                      <Text style={styles.listBullet}>•</Text>
                      <Text style={styles.listText}>{strength}</Text>
                    </View>
                  ))}
                </View>
              )}

              {/* Points d'amélioration (weaknesses) - affichés seulement si showFullJustification */}
              {showFullJustification && argumentData.weaknesses && argumentData.weaknesses.length > 0 && (
                <View style={styles.detailSubSection}>
                  <Text style={styles.detailSubTitle}>⚠️ {t('debates.argumentDetailDuel.improvements')}</Text>
                  {argumentData.weaknesses.map((weakness, index) => (
                    <View key={index} style={styles.listItem}>
                      <Text style={styles.listBullet}>•</Text>
                      <Text style={styles.listText}>{weakness}</Text>
                    </View>
                  ))}
                </View>
              )}
            </>
          ) : (
            /* Fallback : ancien format texte simple */
            <Text style={[styles.justificationText, { marginBottom: 0 }]}>
              {typeof argumentData.justification === 'string' ? argumentData.justification : t('debates.argumentDetailDuel.noJustification')}
            </Text>
          )}
        </View>
      </>
    );
  };

  // Composant source avec animation 3D press
  const SourceItem = ({ source, index }: { source: any; index: number }) => {
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

    const displayTitle = source.title || extractReadableTitle(source.url, index);

    return (
      <TouchableOpacity
        onPress={() => {
          trigger('button-tap');
          Linking.openURL(source.url);
        }}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        activeOpacity={1}
      >
        <Animated.View style={[styles.sourceItem, animatedStyle]}>
          <View style={styles.sourceHeader}>
            <Text style={styles.sourceTitle} numberOfLines={2}>
              {displayTitle}
            </Text>
            <Ionicons name="open-outline" size={18} color={COLORS.ROYAL_BLUE} />
          </View>
        </Animated.View>
      </TouchableOpacity>
    );
  };

  // Rendu des sources
  const renderSources = () => {
    if (!argumentData.sources || argumentData.sources.length === 0) {
      console.log('⚠️ Aucune source trouvée à afficher');
      return (
        <View style={styles.sourcesSection}>
          <Text style={styles.sectionTitle}>🔍 {t('debates.argumentDetailDuel.sourcesUsed')}</Text>
          <View style={styles.noSourcesContainer}>
            <Text style={styles.noSourcesText}>{t('debates.argumentDetailDuel.noSources')}</Text>
          </View>
        </View>
      );
    }

    console.log(`✅ Affichage de ${argumentData.sources.length} source(s)`);
    return (
      <View style={styles.sourcesSection}>
        <Text style={styles.sectionTitle}>🔍 {t('debates.argumentDetailDuel.sourcesUsed')}</Text>
        {argumentData.sources.map((source, index) => (
          <SourceItem key={index} source={source} index={index} />
        ))}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <AnimatedBackground enabled={true} theme="dark" opacity={1} />

      <SafeAreaView style={styles.safeArea} edges={['top']}>
        {/* Header transparent avec bouton retour */}
        <View style={styles.header}>
          <IconButton
            type="action"
            icon={<Ionicons name="arrow-back" size={24} />}
            onPress={handleGoBack}
            size={50}
            backgroundColor={COLORS.surface}
            iconColor={COLORS.PAPER_IVORY}
          />
        </View>

        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {/* Section argument principal */}
          <View style={styles.argumentSection}>
            {/* Pseudo centré sans fond */}
            <Text style={[
              styles.authorName,
              argumentData.author.isCurrentUser && styles.authorNameUser
            ]}>
              {argumentData.author.username}
            </Text>

            <View style={[
              styles.argumentCard,
              argumentData.author.isCurrentUser && styles.argumentCardUser
            ]}>
              <View style={styles.scoreChip}>
                <Text style={styles.scoreChipText}>
                  {argumentData.scoreTotal}
                </Text>
              </View>
              <Text style={[
                styles.argumentText,
                argumentData.author.isCurrentUser && styles.argumentTextUser
              ]}>
                {argumentData.cleanText || argumentData.rawText}
              </Text>
            </View>
          </View>

          {/* Disclaimer IA */}
          <Text style={styles.aiDisclaimer}>{t('gdebates.argumentDetail.aiDisclaimer')}</Text>

          {/* Section justification */}
          {renderJustification()}

          {/* Section sources */}
          {renderSources()}
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

  // Header transparent
  header: {
    position: 'absolute',
    top: 60,
    left: 20,
    zIndex: 100,
  },

  // Scroll
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 40,
  },

  // Section argument
  argumentSection: {
    marginBottom: 24,
    alignItems: 'center',
  },
  authorName: {
    color: COLORS.PAPER_IVORY,
    fontSize: 30,
    fontFamily: 'Raleway-Bold',
    textAlign: 'center',
    marginBottom: 20,
  },
  authorNameUser: {
    color: COLORS.YELLOW_CORE,
  },
  argumentCard: {
    maxWidth: width * 0.85,
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    padding: 14,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
    position: 'relative',
  },
  argumentCardUser: {
    backgroundColor: COLORS.YELLOW_CORE,
    borderColor: COLORS.INK,
  },
  argumentText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    lineHeight: 18,
  },
  argumentTextUser: {
    color: COLORS.NIGHT_BLUE,
    fontWeight: '700',
  },
  scoreChip: {
    position: 'absolute',
    top: -16,
    right: -15,
    backgroundColor: COLORS.ROYAL_BLUE,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 0,
    elevation: 5,
  },
  scoreChipText: {
    fontSize: 16,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
  },

  // Disclaimer IA
  aiDisclaimer: {
    color: COLORS.GREY_MEDIUM,
    fontSize: 12,
    fontFamily: 'Raleway-Regular',
    textAlign: 'center',
    marginBottom: 16,
    fontStyle: 'italic',
  },

  // Section justification
  sectionTitle: {
    fontSize: 18,
    fontFamily: 'Raleway-Black',
    color: COLORS.PAPER_IVORY,
    marginBottom: 12,
    textAlign: 'left',
  },
  justificationSection: {
    backgroundColor: COLORS.surface,
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    marginBottom: 24,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  justificationText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    lineHeight: 22,
    opacity: 0.9,
    marginBottom: 12,
  },
  seeMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
    marginBottom: 8,
    gap: 6,
  },
  seeMoreButtonText: {
    color: COLORS.YELLOW_CORE,
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
  },
  detailSubSection: {
    marginTop: 12,
  },
  detailSubTitle: {
    fontSize: 16,
    fontFamily: 'Raleway-ExtraBold',
    color: COLORS.YELLOW_CORE,
    marginBottom: 12,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 6,
  },
  listBullet: {
    fontSize: 14,
    color: COLORS.YELLOW_CORE,
    marginRight: 10,
    marginTop: 2,
    fontFamily: 'Raleway-Black',
  },
  listText: {
    flex: 1,
    fontSize: 14,
    color: COLORS.PAPER_IVORY,
    lineHeight: 20,
    fontFamily: 'Raleway-SemiBold',
  },

  // Section sources
  sourcesSection: {
    marginBottom: 24,
    marginTop: 8,
  },
  sourceItem: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 0,
    elevation: 4,
  },
  sourceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  sourceTitle: {
    flex: 1,
    color: COLORS.ROYAL_BLUE,
    fontSize: 14,
    fontFamily: 'Raleway-Bold',
    textDecorationLine: 'underline',
  },
  noSourcesContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    padding: 20,
    borderWidth: 3,
    borderColor: COLORS.INK,
    borderStyle: 'dashed',
  },
  noSourcesText: {
    color: COLORS.GREY_MEDIUM,
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    textAlign: 'center',
    fontStyle: 'italic',
  },

  // Loading & Error
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    color: COLORS.PAPER_IVORY,
    fontSize: 16,
    fontFamily: 'Raleway-SemiBold',
    marginTop: 16,
    textAlign: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  errorIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  errorTitle: {
    color: COLORS.PAPER_IVORY,
    fontSize: 24,
    fontFamily: 'Raleway-Black',
    marginBottom: 12,
    textAlign: 'center',
  },
  errorText: {
    color: COLORS.PAPER_IVORY + '80',
    fontSize: 14,
    fontFamily: 'Raleway-SemiBold',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  retryButton: {
    backgroundColor: COLORS.YELLOW_CORE,
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 3,
    borderColor: COLORS.INK,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 0,
    elevation: 4,
  },
  retryButtonText: {
    color: COLORS.NIGHT_BLUE,
    fontSize: 16,
    fontFamily: 'Raleway-Black',
  },
});
