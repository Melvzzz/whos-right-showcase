import { NativeStackScreenProps, NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Debate } from '../services/debates.service';

// Type pour les données de récap
type RecapData = {
  debate: {
    id: string;
    title: string;
    hostView: string;
    guestView: string;
  };
  players: {
    host: {
      username: string;
      eloChange: number;
    };
    guest: {
      username: string;
      eloChange: number;
    };
  };
  stats: {
    host: {
      bestArgument: any;
      worstArgument: any;
      totalScore: number;
    };
    guest: {
      bestArgument: any;
      worstArgument: any;
      totalScore: number;
    };
  };
  result: {
    winner: 'host' | 'guest' | 'tie';
    hostScore: number;
    guestScore: number;
  };
  allArguments: any[];
};

// Définition des paramètres pour chaque route
export type RootStackParamList = {
  Loading: { showTutorial?: boolean } | undefined;
  Welcome: undefined;
  Login: undefined;
  Register: undefined;
  ForgotPassword: undefined;
  Username: undefined;
  ProfileData: undefined;
  TopicsSelection: {
    profileData?: {
      ageRange?: string;
    };
  };
  OnboardingQuestion: {
    step: number;
    previousChoices: string[];
    profileData?: {
      ageRange?: string;
    };
  };
  OnboardingComplete: undefined;
  TutorialDebate: {
    choices: string[];
    profileData?: {
      ageRange?: string;
    };
  };
  TutorialRecapA: {
    tutorialData: any; // TutorialRecapData
    choices: string[];
    profileData?: {
      ageRange?: string;
    };
  };
  TutorialRecapB: {
    tutorialData: any; // TutorialRecapData
    choices: string[];
    profileData?: {
      ageRange?: string;
    };
  };
  Home: { showTutorial?: boolean; showPremiumOffer?: boolean } | undefined;
  Profile: { openCountryPicker?: boolean } | undefined;
  Settings: undefined;
  Shop: undefined;
  News: undefined;
  // Nouveaux écrans pour les débats
  DebateSelection: {
    suggestedDebateId?: number;
    searchQuery?: string;
  };
  CreateFriendInvite: undefined; // ✅ NOUVEAU : Écran de création d'invitation ami
  InviteValidation: { inviteCode: string }; // ✅ NOUVEAU : Écran de validation d'invitation ami
  CreateDebate: {
    suggestedTitle?: string;
    suggestedDescription?: string;
    suggestionId?: string; // ID de la suggestion utilisée
    suggestionType?: 'evergreen' | 'trending'; // Type de suggestion
  };
  WaitingScreen: {
    debate: Debate;
  };
  DebateScreen: {
    debate: Debate;
  };
  // ✅ ASYNC : Écran de débat asynchrone
  AsyncDebateScreen: {
    debate: Debate;
  };
  // ✅ NOUVEAU : Écrans de récapitulatif
  RecapA: {
    debateId: string;
    isReturning?: boolean;
    firstVisit?: boolean;
    fromProfile?: boolean; // ✅ NOUVEAU : Indiquer qu'on vient du profil
    isLocalDebate?: boolean; // ✅ NOUVEAU : Indiquer un débat local
    recapData?: RecapData; // ✅ NOUVEAU : Données transmises (retour de RecapB)
  };
  RecapB: {
    debateId: string;
    recapData?: RecapData;
    firstVisit?: boolean;
    fromProfile?: boolean; // ✅ NOUVEAU : Indiquer qu'on vient du profil
    isLocalDebate?: boolean; // ✅ NOUVEAU : Indiquer un débat local
  };
  // ✅ NOUVEAU : Écrans mode groupe
  GDebateSelection: undefined;
  CreateGDebate: undefined;
  GDebateParticipation: {
    debateId: string;
    inviteToken?: string;
    fromSummary?: boolean; // <--- Ajouté pour permettre le flag de retour
    fromProfile?: boolean; // ✅ NOUVEAU : Indiquer qu'on vient du profil
  };
  GDebateSubmission: {
    debateId: string;
    title: string;
  };
  ReliableFacts: {
    facts: Array<{
      id: string;
      statement: string;
      source: string;
      reliability: number;
    }>;
    debateTitle: string;
  };
  ArgumentDetail: {
    argumentId: string;
    mode?: 'justification' | 'contestation';
    argumentData?: any; // Données de l'argument passées depuis l'écran de participation
    openContestationModal?: boolean; // ✅ NOUVEAU: Pour ouvrir automatiquement le modal de contestation
    userContestationId?: string; // ✅ NOUVEAU: ID de la contestation de l'utilisateur à afficher
  };
  // ✅ NOUVEAU : Écran de détail d'argument pour le mode duel
  ArgumentDetailDuel: {
    argumentId: string;
    debateId: string;
    isLocalDebate?: boolean; // ✅ NOUVEAU : Flag pour débat local
    argumentData?: any; // Données de l'argument passées depuis la liste
  };
  ContestationForm: {
    argumentId: string;
    argumentData?: any; // ✅ NOUVEAU: Données de l'argument pour éviter les données mockées
  };
  // ✅ NOUVEAU : Écrans de résumé personnel
  UserViewpointSummary: {
    debateId: string;
    userId?: string;
    fromSummary?: boolean; // <--- Ajouté pour permettre le flag de retour
  };
  ArgumentDetailPersonal: {
    argumentId: string;
    debateId: string;
  };
  // ✅ NOUVEAU : Écrans mode duel local
  LocalDuelSetup: undefined;
  LocalDuelGame: {
    localDebate: {
      id: string;
      title: string;
      player1: { name: string; viewpoint: string; timer: number };
      player2: { name: string; viewpoint: string; timer: number };
      privateContext: string;
      currentTurn: 'player1' | 'player2';
      arguments: any[];
      status: 'active' | 'completed';
    };
  };
  // ✅ NOUVEAU : Écran récap duel local
  RecapLocal: {
    debateId: string;
  };
  // Daily Challenge
  DailyChallenge: undefined;
};

// Types pour les props de navigation
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;

// Type helper pour useNavigation
export type NavigationProp = NativeStackNavigationProp<RootStackParamList>;

// Type helper pour useNavigation
declare global {
  namespace ReactNavigation {
    interface RootParamList extends RootStackParamList {}
  }
}

// ✅ NOUVEAU : Types pour le Bottom Tab Navigator
export type MainTabParamList = {
  HomeTab: undefined;
  ShopTab: undefined;
  DebatesTab: undefined;
  ModesTab: undefined;
  RankingsTab: undefined;
}; 