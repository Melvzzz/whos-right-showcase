import { IsString, IsOptional, IsArray, IsNumber, IsEnum, ValidateIf } from 'class-validator';

export class M0ResultDto {
  @IsString()
  debateId: string;

  @IsOptional()
  @IsEnum(['OK', 'REJECT'])
  moderation?: 'OK' | 'REJECT';

  @IsOptional()
  @IsEnum(['TITLE', 'HOST_VIEW', 'GUEST_VIEW'])
  moderationSource?: 'TITLE' | 'HOST_VIEW' | 'GUEST_VIEW';

  @IsEnum(['FACTUAL', 'MIXED', 'AXIOLOGICAL'])
  nature: 'FACTUAL' | 'MIXED' | 'AXIOLOGICAL';

  @IsEnum(['SYMMETRIC', 'ASYMMETRIC_HOST', 'ASYMMETRIC_GUEST'])
  burden: 'SYMMETRIC' | 'ASYMMETRIC_HOST' | 'ASYMMETRIC_GUEST';

  @IsEnum(['SIMPLE', 'COMPLEX'])
  complexity: 'SIMPLE' | 'COMPLEX';

  @IsOptional()
  @ValidateIf((o) => o.factualPart !== null)
  @IsString()
  factualPart?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.axiologicalPart !== null)
  @IsString()
  axiologicalPart?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.dimensions !== null)
  @IsArray()
  dimensions?: string[] | null;

  // Topic (thème) sélectionné par l'IA
  // On peut passer soit topicId (UUID) soit topicLabel (ex: "climate", "aiData")
  @IsOptional()
  @ValidateIf((o) => o.topicId !== null)
  @IsString()
  topicId?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.topicLabel !== null)
  @IsString()
  topicLabel?: string | null;

  @IsString()
  branchCode: string;

  @IsNumber()
  weightsM2: number;

  @IsNumber()
  weightsM3: number;

  // ===== Sprint 2: Political Signals =====

  // Tag du sujet pour matching futur (ex: "minimum-wage", "ai-regulation")
  @IsOptional()
  @IsString()
  subjectTag?: string | null;

  // Signaux politiques HOST [-1, 1]
  @IsOptional()
  @IsNumber()
  hostPoliticalSignal?: number;

  @IsOptional()
  @IsNumber()
  hostEconomicSignal?: number;

  @IsOptional()
  @IsNumber()
  hostSocialSignal?: number;

  // Signaux politiques GUEST [-1, 1]
  @IsOptional()
  @IsNumber()
  guestPoliticalSignal?: number;

  @IsOptional()
  @IsNumber()
  guestEconomicSignal?: number;

  @IsOptional()
  @IsNumber()
  guestSocialSignal?: number;

  // Confiance dans les signaux [0, 1]
  @IsOptional()
  @IsNumber()
  signalConfidence?: number;
}
