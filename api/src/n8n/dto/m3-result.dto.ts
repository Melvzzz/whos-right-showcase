import { IsString, IsOptional, IsArray, IsNumber, IsBoolean, ValidateIf } from 'class-validator';

export class M3ResultDto {
  // === IDENTIFIANTS ===
  @IsString()
  argumentId: string;

  @IsOptional()
  @ValidateIf((o) => o.debateId !== null)
  @IsString()
  debateId?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.userId !== null)
  @IsString()
  userId?: string | null;

  // === DONNÉES M1 ===
  @IsOptional()
  @ValidateIf((o) => o.moderation !== null)
  @IsString()
  moderation?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.moderationReason !== null)
  @IsString()
  moderationReason?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.gamingStatus !== null)
  @IsString()
  gamingStatus?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.gamingFlags !== null)
  @IsArray()
  gamingFlags?: string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.primaryType !== null)
  @IsString()
  primaryType?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.tags !== null)
  @IsArray()
  tags?: string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.engagement !== null)
  @IsString()
  engagement?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.unansweredPoints !== null)
  @IsArray()
  unansweredPoints?: string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.dimension !== null)
  @IsString()
  dimension?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.argumentSummary !== null)
  @IsString()
  argumentSummary?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.judgeType !== null)
  @IsString()
  judgeType?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.needsFactcheck !== null)
  @IsBoolean()
  needsFactcheck?: boolean | null;

  // === DONNÉES M2 (Factcheck) ===
  @IsOptional()
  @ValidateIf((o) => o.factcheckScore !== null)
  @IsNumber()
  factcheckScore?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.claim1 !== null)
  @IsString()
  claim1?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.verdict1 !== null)
  @IsString()
  verdict1?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.explanation1 !== null)
  @IsString()
  explanation1?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.claim2Block !== null)
  @IsString()
  claim2Block?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.factcheckSummary !== null)
  @IsString()
  factcheckSummary?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.sourcesSummary !== null)
  @IsString()
  sourcesSummary?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.overallSourceQuality !== null)
  @IsNumber()
  overallSourceQuality?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.sourcesForDisplay !== null)
  @IsArray()
  sourcesForDisplay?: Array<{
    name: string;
    url: string;
    tier: number;
    quality_score: number;
    description: string;
  }> | null;

  @IsOptional()
  @ValidateIf((o) => o.claimsAnalysis !== null)
  @IsArray()
  claimsAnalysis?: Array<{
    claim: string;
    verdict: string;
    explanation: string;
    sources?: string[];
  }> | null;

  @IsOptional()
  @ValidateIf((o) => o.sources !== null)
  @IsArray()
  sources?: Array<{
    name: string;
    url: string;
    tier?: number;
    quality_score?: number;
    description?: string;
  }> | null;

  @IsOptional()
  @ValidateIf((o) => typeof o.penaltyDetails === 'string')
  @IsString()
  penaltyDetails?: string | string[] | null;

  // === DONNÉES M3 (Scores) ===
  @IsOptional()
  @ValidateIf((o) => o.judgeScore !== null)
  @IsNumber()
  judgeScore?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.weightedScore !== null)
  @IsNumber()
  weightedScore?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.scoreBeforePenalty !== null)
  @IsNumber()
  scoreBeforePenalty?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.totalPenalty !== null)
  @IsNumber()
  totalPenalty?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.appliedPenalty !== null)
  @IsNumber()
  appliedPenalty?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.finalScore !== null)
  @IsNumber()
  finalScore?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.maxScore !== null)
  @IsNumber()
  maxScore?: number | null;

  // === BONUS DIMENSIONS ===
  @IsOptional()
  @ValidateIf((o) => o.dimensionBonus !== null)
  @IsNumber()
  dimensionBonus?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.coverageBonus !== null)
  @IsNumber()
  coverageBonus?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.totalBonus !== null)
  @IsNumber()
  totalBonus?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.finalScoreWithBonus !== null)
  @IsNumber()
  finalScoreWithBonus?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.isNewDimension !== null)
  @IsBoolean()
  isNewDimension?: boolean | null;

  @IsOptional()
  @ValidateIf((o) => o.justCompletedCoverage !== null)
  @IsBoolean()
  justCompletedCoverage?: boolean | null;

  @IsOptional()
  @ValidateIf((o) => o.bonusReason !== null)
  @IsString()
  bonusReason?: string | null;

  @IsOptional()
  @ValidateIf((o) => o.newCoveredDimensions !== null)
  @IsArray()
  newCoveredDimensions?: string[] | null;

  // === DONNÉES M3 (Analyse) ===
  @IsOptional()
  @ValidateIf((o) => o.criteriaBreakdown !== null)
  criteriaBreakdown?: Record<string, number> | null;

  @IsOptional()
  @ValidateIf((o) => o.fallacies !== null)
  @IsArray()
  fallacies?: Array<{
    type?: string;
    name?: string;
    severity?: string;
    quote?: string;
    explanation?: string;
  }> | null;

  @IsOptional()
  @ValidateIf((o) => o.biases !== null)
  @IsArray()
  biases?: Array<{
    type?: string;
    name?: string;
    explanation?: string;
  }> | null;

  @IsOptional()
  @ValidateIf((o) => o.fallacyCount !== null)
  @IsNumber()
  fallacyCount?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.biasCount !== null)
  @IsNumber()
  biasCount?: number | null;

  @IsOptional()
  @ValidateIf((o) => o.dimensionAddressed !== null)
  @IsString()
  dimensionAddressed?: string | null;

  @IsOptional()
  @ValidateIf((o) => Array.isArray(o.engagementIssues))
  @IsArray()
  engagementIssues?: string | string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.burdenViolation !== null)
  @IsBoolean()
  burdenViolation?: boolean | null;

  @IsOptional()
  @ValidateIf((o) => o.strengths !== null)
  @IsArray()
  strengths?: string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.weaknesses !== null)
  @IsArray()
  weaknesses?: string[] | null;

  @IsOptional()
  @ValidateIf((o) => o.briefJustification !== null)
  @IsString()
  briefJustification?: string | null;

  // === MÉTADONNÉES ===
  @IsOptional()
  @ValidateIf((o) => o.weights !== null)
  weights?: { M2: number; M3: number } | null;

  @IsOptional()
  @ValidateIf((o) => o.processedAt !== null)
  @IsString()
  processedAt?: string | null;
}
