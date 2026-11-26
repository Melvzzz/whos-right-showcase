import { IsString, IsNotEmpty } from 'class-validator';

/**
 * DTO pour proposer l'arrêt d'un débat asynchrone
 */
export class ProposeStopDto {
  /**
   * ID du débat
   */
  @IsString()
  @IsNotEmpty()
  debateId: string;
}
