import { IsString, IsOptional, IsArray, IsNumber, IsBoolean, IsEnum, ValidateIf } from 'class-validator';

export class M1ResultDto {
  @IsString()
  argumentId: string;

  // Moderation
  @IsEnum(['OK', 'WARNING', 'REJECT'])
  moderation: 'OK' | 'WARNING' | 'REJECT';

  @IsOptional()
  @ValidateIf((o) => o.moderationReason !== null)
  @IsString()
  moderationReason?: string | null;

  // Anti-gaming
  @IsOptional()
  @ValidateIf((o) => o.gamingStatus !== null)
  @IsEnum(['STOP', 'WARNING', 'NONE'])
  gamingStatus?: 'STOP' | 'WARNING' | 'NONE' | null;

  @IsOptional()
  @ValidateIf((o) => o.gamingFlags !== null)
  @IsArray()
  gamingFlags?: string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.gamingFlagDetails !== null)
  @IsString()
  gamingFlagDetails?: string | null;

  // Classification (optional for rejected arguments)
  @IsOptional()
  @ValidateIf((o) => o.primaryType !== null)
  @IsString()
  primaryType?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.tags !== null)
  @IsArray()
  tags?: string[] | null;

  // Factcheck (optional for rejected arguments)
  @IsOptional()
  @ValidateIf((o) => o.needsFactcheck !== null)
  @IsBoolean()
  needsFactcheck?: boolean | null;

  @IsOptional()
  @ValidateIf((o) => o.factcheckClaims !== null)
  @IsArray()
  factcheckClaims?: string[] | null;

  // Engagement (optional for rejected arguments)
  @IsOptional()
  @ValidateIf((o) => o.engagement !== null)
  @IsString()
  engagement?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.unansweredPoints !== null)
  @IsArray()
  unansweredPoints?: string[] | null;

  // Other
  @IsOptional()
  @ValidateIf((o) => o.dimension !== null)
  @IsString()
  dimension?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.argumentSummary !== null)
  @IsString()
  argumentSummary?: string | null;

  // Calculated (optional for rejected arguments)
  @IsOptional()
  @ValidateIf((o) => o.maxScore !== null)
  @IsNumber()
  maxScore?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.judgeType !== null)
  @IsString()
  judgeType?: string | null;

  // Clean text (optional - if not provided, rawText will be used)
  @IsOptional()
  @ValidateIf((o) => o.cleanText !== null)
  @IsString()
  cleanText?: string | null;

  // Identifiers (optional, for context)
  @IsOptional()
  @ValidateIf((o) => o.debateId !== null)
  @IsString()
  debateId?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.userId !== null)
  @IsString()
  userId?: string | null;

  // Raw text (optional, for rejected arguments display)
  @IsOptional()
  @ValidateIf((o) => o.rawText !== null)
  @IsString()
  rawText?: string | null;
}
