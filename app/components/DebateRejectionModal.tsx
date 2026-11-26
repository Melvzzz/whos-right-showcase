import React from 'react';
import {
  View,
  Text,
  Modal,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS } from '../constants/colors';
import { FONTS, FONT_SIZES, getFontFamily } from '../constants/fonts';
import { Ionicons } from '@expo/vector-icons';

interface DebateRejectionModalProps {
  visible: boolean;
  reason: string;
  message?: string;
  onGoBack: () => void;
  title?: string;
}

export const DebateRejectionModal: React.FC<DebateRejectionModalProps> = ({
  visible,
  reason,
  message,
  onGoBack,
  title = 'Débat rejeté',
}) => {
  // Déterminer l'icône et la couleur selon la raison
  const getReasonIcon = (): string => {
    if (reason.toLowerCase().includes('spam')) return '🚫';
    if (reason.toLowerCase().includes('insult')) return '⚠️';
    if (reason.toLowerCase().includes('inapproprié')) return '❌';
    return '⚠️';
  };

  const getReasonColor = (): string => {
    if (reason.toLowerCase().includes('spam')) return '#FF6B6B';
    if (reason.toLowerCase().includes('insult')) return '#FF8C42';
    if (reason.toLowerCase().includes('inapproprié')) return '#FF4444';
    return '#FF6B6B';
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onGoBack}
    >
      <View style={styles.overlay}>
        <View style={styles.modalContainer}>
          {/* En-tête avec icône */}
          <View style={[styles.header, { backgroundColor: getReasonColor() }]}>
            <Text style={styles.headerIcon}>{getReasonIcon()}</Text>
            <Text style={styles.headerTitle}>{title}</Text>
          </View>

          {/* Contenu */}
          <View style={styles.content}>
            <Text style={styles.reasonLabel}>Raison du rejet :</Text>
            <Text style={styles.reasonText}>{reason}</Text>

            {message && (
              <>
                <View style={styles.separator} />
                <Text style={styles.messageText}>{message}</Text>
              </>
            )}

            <View style={styles.tipContainer}>
              <Ionicons name="bulb-outline" size={20} color={COLORS.YELLOW_CORE} />
              <Text style={styles.tipText}>
                Assurez-vous que votre débat porte sur un sujet sérieux et que les arguments sont constructifs.
              </Text>
            </View>
          </View>

          {/* Bouton de retour */}
          <TouchableOpacity
            style={styles.backButton}
            onPress={onGoBack}
            activeOpacity={0.8}
          >
            <LinearGradient
              colors={[COLORS.YELLOW_CORE, '#FFB800']}
              style={styles.backButtonGradient}
            >
              <Ionicons name="arrow-back" size={20} color={COLORS.NIGHT_BLUE} />
              <Text style={styles.backButtonText}>Retour à la création</Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 20,
  },
  modalContainer: {
    backgroundColor: COLORS.NIGHT_BLUE,
    borderRadius: 20,
    width: '100%',
    maxWidth: 400,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 20,
    elevation: 10,
  },

  // En-tête
  header: {
    paddingVertical: 25,
    paddingHorizontal: 20,
    alignItems: 'center',
  },
  headerIcon: {
    fontSize: 50,
    marginBottom: 10,
  },
  headerTitle: {
    fontSize: FONT_SIZES.TITLE.SMALL,
    fontFamily: getFontFamily(FONTS.TITLE.REGULAR, FONTS.TITLE.FALLBACK),
    color: COLORS.PAPER_IVORY,
    fontWeight: 'bold',
    textAlign: 'center',
  },

  // Contenu
  content: {
    paddingHorizontal: 25,
    paddingVertical: 20,
  },
  reasonLabel: {
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.GREY_MEDIUM,
    marginBottom: 8,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reasonText: {
    fontSize: FONT_SIZES.SUBTITLE.SMALL,
    fontFamily: getFontFamily(FONTS.SUBTITLE.REGULAR, FONTS.SUBTITLE.FALLBACK),
    color: COLORS.PAPER_IVORY,
    fontWeight: '600',
    marginBottom: 15,
    lineHeight: 24,
  },
  separator: {
    height: 1,
    backgroundColor: COLORS.GREY_MEDIUM + '30',
    marginVertical: 15,
  },
  messageText: {
    fontSize: FONT_SIZES.BODY.MEDIUM,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.PAPER_IVORY,
    lineHeight: 22,
    marginBottom: 20,
    opacity: 0.9,
  },
  tipContainer: {
    flexDirection: 'row',
    backgroundColor: COLORS.YELLOW_CORE + '15',
    borderLeftWidth: 3,
    borderLeftColor: COLORS.YELLOW_CORE,
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    marginTop: 10,
  },
  tipText: {
    flex: 1,
    fontSize: FONT_SIZES.BODY.SMALL,
    fontFamily: getFontFamily(FONTS.BODY.REGULAR, FONTS.BODY.FALLBACK),
    color: COLORS.PAPER_IVORY,
    marginLeft: 10,
    lineHeight: 18,
  },

  // Bouton de retour
  backButton: {
    marginHorizontal: 20,
    marginVertical: 20,
    borderRadius: 25,
    overflow: 'hidden',
    shadowColor: COLORS.YELLOW_CORE,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  backButtonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    paddingHorizontal: 30,
    gap: 10,
  },
  backButtonText: {
    fontSize: FONT_SIZES.SUBTITLE.SMALL,
    fontFamily: getFontFamily(FONTS.SUBTITLE.REGULAR, FONTS.SUBTITLE.FALLBACK),
    color: COLORS.NIGHT_BLUE,
    fontWeight: 'bold',
  },
});
