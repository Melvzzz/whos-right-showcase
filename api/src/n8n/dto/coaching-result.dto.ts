import { IsString, IsOptional, IsArray, IsNumber, ValidateNested, ValidateIf } from 'class-validator';

/**
 * DTO for coaching result callback from n8n M4
 * Received when coaching analysis is complete
 */
export class CoachingResultDto {
  @IsString()
  coachingResultId: string;

  @IsString()
  debateId: string;

  @IsString()
  userId: string;

  @IsOptional()
  indicators?: {
    rigor: { score: number };
    evidence: { score: number };
    rebuttal: { score: number };
    clarity: { score: number };
    openness: { score: number };
  };

  @IsOptional()
  @IsArray()
  coachingItems?: Array<{
    rank: number;
    type: 'MISSED_ATTACK' | 'LOGICAL_FALLACY' | 'WEAK_COUNTER' | 'IGNORED_POINT' | 'BIAS';
    severity: 'HIGH' | 'MEDIUM' | 'LOW';
    title: string;
    quote: string;
    explanation: string;
    suggestion: string;
  }>;

  @IsOptional()
  learning?: {
    conceptName: string;
    definition: string;
    howToSpot: string;
    howToCounter: string;
    exampleFromDebate: string;
    betterExample: string;
  };
}
