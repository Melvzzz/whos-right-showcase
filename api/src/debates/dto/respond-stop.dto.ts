import { IsString, IsNotEmpty, IsBoolean } from 'class-validator';

/**
 * DTO pour répondre à une proposition d'arrêt de débat asynchrone
 */
export class RespondStopDto {
  /**
   * ID du débat
   */
  @IsString()
  @IsNotEmpty()
  debateId: string;

  /**
   * Accepter ou refuser la proposition d'arrêt
   * true = accepter, false = refuser
   */
  @IsBoolean()
  accept: boolean;
}
