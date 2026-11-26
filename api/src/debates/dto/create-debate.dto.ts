import { IsString, IsOptional, IsNumber, IsArray, IsNotEmpty, Min, Max, IsBoolean, IsIn } from 'class-validator';

/**
 * DTO pour la création d'un débat
 */
export class CreateDebateDto {
  /**
   * Titre du débat
   */
  @IsString()
  @IsNotEmpty()
  title: string;

  /**
   * Point de vue de l'hôte
   */
  @IsString()
  @IsNotEmpty()
  hostView: string;

  /**
   * Point de vue de l'invité (optionnel)
   */
  @IsOptional()
  @IsString()
  guestView?: string;

  /**
   * Durée du débat en minutes (par défaut: 5)
   */
  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(15)
  mode?: number;

  /**
   * Liste des thèmes du débat (1 à 3 thèmes)
   */
  @IsArray()
  @IsString({ each: true })
  themes: string[];

  /**
   * Mode de débat : true = live (temps réel), false = async (tour par tour)
   * Par défaut: true
   */
  @IsOptional()
  @IsBoolean()
  isLive?: boolean;

  /**
   * Nombre maximum de messages par utilisateur (uniquement pour débats async)
   * Valeurs possibles : 10, 20, 30
   * 30 messages réservé aux tiers Premium et Creator
   */
  @IsOptional()
  @IsNumber()
  @IsIn([10, 20, 30], { message: 'maxMessagesPerUser doit être 10, 20 ou 30' })
  maxMessagesPerUser?: number;

  /**
   * Mode de jeu : COMPETITIVE (objectif de gagner) ou EXPLORATORY (objectif d'apprendre)
   * Par défaut: COMPETITIVE
   */
  @IsOptional()
  @IsString()
  @IsIn(['COMPETITIVE', 'EXPLORATORY'], { message: 'gameMode doit être COMPETITIVE ou EXPLORATORY' })
  gameMode?: 'COMPETITIVE' | 'EXPLORATORY';

  /**
   * Langue du débat : 'fr' (français) ou 'en' (anglais)
   * Par défaut: langue préférée du créateur
   */
  @IsOptional()
  @IsString()
  @IsIn(['fr', 'en'], { message: 'language doit être fr ou en' })
  language?: 'fr' | 'en';

  /**
   * ID de la suggestion utilisée pour créer ce débat (optionnel)
   * Permet de tracker quelle suggestion a été utilisée
   */
  @IsOptional()
  @IsString()
  suggestionId?: string;

  /**
   * Type de la suggestion : 'evergreen' ou 'trending'
   */
  @IsOptional()
  @IsString()
  @IsIn(['evergreen', 'trending'], { message: 'suggestionType doit être evergreen ou trending' })
  suggestionType?: 'evergreen' | 'trending';
} 