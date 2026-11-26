import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketGateway } from '../gateways/socket.gateway';

/**
 * Interface pour les données brutes G3 - identique à SearchService
 */
interface G3RawData {
  geminiResponse: string;                    // Réponse factuelle brute de Gemini
  sourcesRaw: Array<{                      // Sources brutes de Gemini grounding
    url: string;        // URI de redirection Google
    title: string;      // Domaine (uefa.com, wikipedia.org)
  }>;
  webSearchQueries: string[];              // Requêtes générées par Gemini
}

/**
 * Interface pour le résultat du scoring d'un argument
 */
interface ScoringResult {
  reliability: number;  // Score de fiabilité (0-10)
  impact: number;       // Score d'impact (0-10)
  total: number;        // Score total (reliability + impact)
  gifCategory: number;  // Catégorie du GIF (0=NEG, 1=LOW, 2=MID, 3=HIGH)
  justification: string;
  bonuses: string[];    // Liste des bonus détectés
  maluses: string[];    // Liste des malus détectés
}

export interface DebateResult {
  hostScore: number;
  guestScore: number;
  winner: 'host' | 'guest' | 'tie';
}

export interface DebateScoringResult {
  hostEloChange: number;
  guestEloChange: number;
  hostXPGain: number;
  guestXPGain: number;
  hostNewElo: number;
  guestNewElo: number;
}

/**
 * Service de scoring des arguments (Module M3)
 * Évalue la fiabilité et l'impact des arguments
 * Choisit une catégorie de GIF en fonction du score
 */
@Injectable()
export class ScoringService {
  private readonly logger = new Logger(ScoringService.name);
  private readonly PLAYER_POINTS_FOR_MAX_XP = 150;
  
  constructor(
    private readonly llmService: LlmService,
    private readonly prismaService: PrismaService,
    private readonly socketGateway: SocketGateway
  ) {}
  
  /**
   * 🚨 ANCIENNE MÉTHODE - SUPPRIMÉE
   * Utiliser uniquement scoreArgumentWithM2Data maintenant
   */
  async scoreArgument(argumentId: string): Promise<ScoringResult> {
    throw new Error('❌ scoreArgument() est obsolète - utiliser scoreArgumentWithM2Data() uniquement');
  }
  
  /**
   * Construit le prompt pour évaluer un argument
   */
  private buildScoringPrompt(argument: any, sources: any[] = [], debate: any = null): string {
    throw new Error('❌ buildScoringPrompt() est obsolète - utiliser buildScoringPromptWithM2Data() uniquement');
  }
  
  /**
   * 🆕 NOUVEAU : Calcule le score total avec les coefficients du débat (dynamiques)
   */
  private async calculateTotalScoreWithDebateCoefficients(
    reliability: number, 
    impact: number, 
    bonuses: string[], 
    maluses: string[], 
    debateId?: string
  ): Promise<number> {
    try {
      let reliabilityCoef = 1.5; // Valeur par défaut
      let impactCoef = 1.5; // Valeur par défaut
      
      // Récupérer les coefficients du débat si debateId fourni
      if (debateId) {
        const debate = await this.prismaService.debate.findUnique({
          where: { id: debateId }
        });
        
        if (debate) {
          reliabilityCoef = (debate as any).reliabilityCoef || 1.5;
          impactCoef = (debate as any).impactCoef || 1.5;
          this.logger.log(`📊 Coefficients débat ${debateId}: reliability=${reliabilityCoef}, impact=${impactCoef}`);
        } else {
          this.logger.warn(`⚠️ Débat ${debateId} non trouvé, utilisation coefficients par défaut`);
        }
      } else {
        this.logger.log(`📊 Pas de debateId fourni, utilisation coefficients par défaut`);
      }
      
      // 1. Appliquer les coefficients aux scores de base
      const adjustedReliability = reliability * reliabilityCoef;
      const adjustedImpact = impact * impactCoef;
      
      // 2. Calculer les points de base ajustés
      let total = adjustedReliability + adjustedImpact;
      
      // 3. Ajouter les bonus (identique à l'ancienne méthode)
      if (bonuses) {
        for (const bonus of bonuses) {
          switch (bonus) {
            case 'complete_structure':
              total += 3;
              break;
            case 'source_recent_authority':
              total += 3;
              break;
            case 'answer_critical_q':
              total += 2;
              break;
            case 'reality_check':
              total += 2;
              break;
            case 'humility':
              total += 2;
              break;
            case 'steelman':
              total += 2;
              break;
            case 'new_information':
              total += 1;
              break;
            case 'clarity_concise':
              total += 1;
              break;
            case 'grice_relevance':
              total += 2;
              break;
            case 'balanced_rhetoric':
              total += 3;
              break;
            case 'turning_point':
              total += 5;
              break;
          }
        }
      }
      
      // 4. Soustraire les malus (identique à l'ancienne méthode)
      if (maluses) {
        for (const malus of maluses) {
          switch (malus) {
            case 'ad_hominem':
              total -= 5;
              break;
            case 'personal_opinion':
              total -= 2;
              break;
            case 'gish_gallop':
              total -= 4;
              break;
            case 'strawman':
              total -= 2;
              break;
            case 'moving_goalposts':
              total -= 3;
              break;
            case 'whataboutism':
              total -= 2;
              break;
            case 'cherry_picking':
              total -= 1;
              break;
            case 'bandwagon':
              total -= 2;
              break;
            case 'slippery_slope':
              total -= 2;
              break;
            case 'gaslighting':
              total -= 3;
              break;
            case 'sealioning':
              total -= 2;
              break;
            case 'tone_policing':
              total -= 1;
              break;
            case 'evasion':
              total -= 4;
              break;
            case 'no_evidence':
              total -= 2;
              break;
            case 'vagueness':
              total -= 1;
              break;
            case 'glittering_generality':
              total -= 2;
              break;
            case 'ad_nauseam':
              total -= 2;
              break;
            case 'appeal_to_fear':
              total -= 2;
              break;
            case 'paltering':
              total -= 2;
              break;
          }
        }
      }
      
      return Math.max(0, Math.round(total * 10) / 10); // Arrondir à 1 décimale
      
    } catch (error) {
      this.logger.error(`❌ Erreur calcul score avec coefficients débat: ${error.message}`);
      // Fallback vers l'ancienne méthode en cas d'erreur
      return this.calculateTotalScore(reliability, impact, bonuses, maluses, 'general');
    }
  }

  /**
   * Calcule le score total en fonction de la fiabilité, l'impact, les bonus/malus et le thème
   * ✅ CONSERVÉE pour compatibilité avec l'ancien système
   */
  private calculateTotalScore(reliability: number, impact: number, bonuses: string[], maluses: string[], theme: string): number {
    let total = 0;
    
    // 1. Calculer les points de base
    let baseReliability = reliability;
    let baseImpact = impact;
    
    // 2. Appliquer les coefficients de thème
    switch (theme) {
      case 'science':
      case 'tech':
        baseReliability *= 1.4;
        break;
      case 'policy':
      case 'law':
        baseReliability *= 1.2;
        break;
      case 'pop_culture':
      case 'lifestyle':
        baseImpact *= 1.4;
        break;
    }
    
    // 3. Ajouter les points de base
    total = baseReliability + baseImpact;
    
    // 4. Ajouter les bonus
    if (bonuses) {
      for (const bonus of bonuses) {
        switch (bonus) {
          case 'complete_structure':
            total += 3;
            break;
          case 'source_recent_authority':
            total += 3;
            if (theme === 'economics' || theme === 'business') {
              total += 3; // Double pour economics/business
            }
            break;
          case 'answer_critical_q':
            total += 2;
            break;
          case 'reality_check':
            total += 2;
            if (theme === 'ethics' || theme === 'society') {
              total += 2; // Double pour ethics/society
            }
            break;
          case 'humility':
            total += 2;
            if (theme === 'policy' || theme === 'law') {
              total += 2; // Double pour policy/law
            }
            break;
          case 'steelman':
            total += 2;
            break;
          case 'new_information':
            total += 1;
            break;
          case 'clarity_concise':
            total += 1;
            break;
          case 'grice_relevance':
            total += 2;
            break;
          case 'balanced_rhetoric':
            total += 3;
            break;
          case 'turning_point':
            total += 5;
            break;
        }
      }
    }
    
    // 5. Soustraire les malus
    if (maluses) {
      for (const malus of maluses) {
        switch (malus) {
          case 'ad_hominem':
            total -= 5;  // ✅ CORRIGÉ : -5 points comme indiqué dans le prompt
            break;
          case 'personal_opinion':
            total -= 2;
            break;
          case 'gish_gallop':
            total -= 4;
            break;
          case 'strawman':
            total -= 2;
            break;
          case 'moving_goalposts':
            total -= 3;
            break;
          case 'whataboutism':
            total -= 2;
            break;
          case 'cherry_picking':
            total -= 1;
            break;
          case 'bandwagon':
            total -= 2;
            break;
          case 'slippery_slope':
            total -= 2;
            break;
          case 'gaslighting':
            total -= 3;
            break;
          case 'sealioning':
            total -= 2;
            break;
          case 'tone_policing':
            total -= 1;
            break;
          case 'evasion':
            total -= 4;
            break;
          case 'no_evidence':
            total -= 2;
            break;
          case 'vagueness':
            total -= 1;
            break;
          case 'glittering_generality':
            total -= 2;
            break;
          case 'ad_nauseam':
            total -= 2;
            break;
          case 'appeal_to_fear':
            total -= 2;
            break;
          case 'paltering':
            total -= 2;
            break;
        }
      }
    }
    
    return Math.max(0, Math.round(total));
  }

  /**
   * Parse la réponse du LLM pour extraire les scores
   */
  private async parseScoringResponse(response: string, debateId?: string, insultFlag?: boolean): Promise<ScoringResult> {
    try {
      let jsonResponse;
      // ✅ CORRECTION : Utiliser une méthode plus robuste pour extraire le JSON complet
      const jsonMatch = this.extractCompleteJson(response);
      
      if (jsonMatch) {
        try {
          jsonResponse = JSON.parse(jsonMatch[0]);
          
          const reliability = Math.min(10, Math.max(0, parseInt(jsonResponse.reliability) || 5));
          const impact = Math.min(10, Math.max(0, parseInt(jsonResponse.impact) || 5));
          const bonuses = jsonResponse.bonuses || [];
          let maluses = jsonResponse.maluses || [];
          const theme = jsonResponse.theme || 'general';
          
          // ✅ NOUVEAU : Forcer l'ajout du malus ad_hominem si une insulte a été détectée par M1
          if (insultFlag && !maluses.includes('ad_hominem')) {
            maluses.push('ad_hominem');
            this.logger.log(`🚨 Malus ad_hominem automatiquement ajouté (InsultFlag=true)`);
          }
          
          // 🆕 NOUVEAU : Récupérer les coefficients du débat au lieu d'utiliser le theme hardcodé
          const total = await this.calculateTotalScoreWithDebateCoefficients(
            reliability, 
            impact, 
            bonuses, 
            maluses, 
            debateId
          );
          
          return {
            reliability,
            impact,
            total,
            bonuses,
            maluses,
            gifCategory: this.calculateGifCategoryFromTotal(total),
            justification: jsonResponse.justification
          };
        } catch (e) {
          this.logger.warn(`Failed to parse JSON match: ${e.message}`);
        }
      }
      
      throw new Error("Invalid JSON response format");
      
    } catch (error) {
      this.logger.error(`Failed to parse scoring response: ${error.message}`);
      return {
        reliability: 5,
        impact: 5,
        total: 10,
        bonuses: [],
        maluses: [],
        gifCategory: 1,
        justification: "Une erreur est survenue lors du calcul du score."
      };
    }
  }
  
  /**
   * Parse une catégorie de GIF à partir d'un texte
   */
  private parseGifCategoryFromText(text: string): number {
    const upperText = text.toUpperCase();
    
    if (upperText.includes('NEG') || upperText.includes('0') || upperText.includes('NÉGATIF') || 
        upperText.includes('NEGATIF') || upperText.includes('MAUVAIS')) {
      return 0;
    } else if (upperText.includes('LOW') || upperText.includes('1') || upperText.includes('FAIBLE') || 
              upperText.includes('BAS')) {
      return 1;
    } else if (upperText.includes('MID') || upperText.includes('2') || upperText.includes('MOYEN') || 
              upperText.includes('MEDIUM')) {
      return 2;
    } else if (upperText.includes('HIGH') || upperText.includes('3') || upperText.includes('EXCELLENT') || 
              upperText.includes('ÉLEVÉ') || upperText.includes('ELEVE') || upperText.includes('HAUT')) {
      return 3;
    }
    
    return 1; // Par défaut LOW
  }
  
  /**
   * Calcule la catégorie de GIF à partir du score total
   */
  private calculateGifCategoryFromTotal(total: number): number {
    if (total <= 5) return 0; // NEG
    else if (total <= 12) return 1; // LOW
    else if (total <= 16) return 2; // MID
    else return 3; // HIGH
  }
  
  /**
   * Récupère un argument par son ID
   */
  private async getArgumentById(argumentId: string) {
    return this.prismaService.argument.findUnique({
      where: { id: argumentId },
      include: {
        debate: true
      }
    });
  }

  /**
   * Met à jour les scores d'un argument
   */
  private async updateArgumentScores(
    argumentId: string,
    reliability: number,
    impact: number,
    total: number,
    gifCategory: number,
    justification?: string
  ) {
    try {
      this.logger.log(`Updating scores for argument ${argumentId}: reliability=${reliability}, impact=${impact}, total=${total}, gifCategory=${gifCategory}`);
      
      const updateData: any = {
        reliability,
        impact,
        scoreTotal: total,
        gifCategory
      };

      // Ajouter la justification si elle est fournie
      if (justification && justification.trim().length > 0) {
        updateData.justification = justification;
      }

      const result = await this.prismaService.argument.update({
        where: { id: argumentId },
        data: updateData
      });

      this.logger.log(`Successfully updated scores for argument ${argumentId}`);
      return result;
    } catch (error) {
      this.logger.error(`Failed to update argument scores: ${error.message}`);
      throw new Error(`Failed to update argument scores: ${error.message}`);
    }
  }

  /**
   * ✅ NOUVELLE MÉTHODE : Évalue un argument avec G3RawData (style G4)
   * Plus de latence d'attente ArgumentSource en base, G3RawData passé directement
   * @param argumentId ID de l'argument
   * @param g3Data Données de recherche G3 (peut être null si pas de fact-check)
   * @returns ScoringResult
   */
  async scoreArgumentWithG3Data(argumentId: string, g3Data: G3RawData | null): Promise<ScoringResult> {
    throw new Error('❌ scoreArgumentWithG3Data() est obsolète - utiliser scoreArgumentWithM2Data() uniquement');
  }

  /**
   * ✅ NOUVEAU : Construit le prompt de scoring avec G3RawData (adapté de G4)
   * Utilise le format G3RawData au lieu de la section M2_Sources complexe
   */
  private buildScoringPromptWithG3Data(argument: any, g3Data: G3RawData | null, debate: any): string {
    throw new Error('❌ buildScoringPromptWithG3Data() est obsolète - utiliser buildScoringPromptWithM2Data() uniquement');
  }

  /**
   * ✅ NOUVEAU : Score un argument avec les nouvelles données M2 restructurées
   * Utilise la fiabilité pré-calculée et ne calcule que l'impact
   */
  async scoreArgumentWithM2Data(argumentId: string, m2Data: any): Promise<ScoringResult> {
      // 1. Récupérer l'argument complet
      const argument = await this.getArgumentById(argumentId);
      
      if (!argument) {
        throw new Error(`Argument ${argumentId} not found`);
      }

      // 2. Récupérer le débat pour comprendre le contexte
      const debate = await this.prismaService.debate.findUnique({
        where: { id: argument.debateId }
      });
      
      if (!debate) {
        throw new Error(`Debate ${argument.debateId} not found`);
      }

      // 3. Construire le nouveau prompt M3 pour M2 data
      const prompt = this.buildScoringPromptWithM2Data(argument, m2Data, debate);

      this.logger.log(`🎯 M3: Scoring argument ${argumentId} avec nouvelles données M2 (fiabilité=${m2Data?.calculatedReliability || 'N/A'})`);
      
      // 4. Appeler le LLM Gemini avec nouveau prompt M3
      const llmResponse = await this.llmService.callGemini(
        this.llmService.MODEL_M3_GEMINI,
        prompt,
        'M3',
        argument.debateId,
        argumentId
      );
      
      // 5. Parser la réponse pour extraire seulement l'impact et les justifications
      const impactResult = await this.parseM3ResponseWithM2Data(llmResponse, m2Data, argument.debateId, argument.insultFlag);
      
      // 6. Combiner fiabilité pré-calculée + impact nouveau + coefficients débat
      const finalScoringResult = await this.calculateFinalScoreWithM2Data(impactResult, m2Data, argument.debateId);
      
      // 7. Mettre à jour l'argument en base avec les nouveaux scores
      await this.updateArgumentScores(
        argumentId, 
        finalScoringResult.reliability,
        finalScoringResult.impact, 
        finalScoringResult.total,
        finalScoringResult.gifCategory,
        finalScoringResult.justification
      );
      
      // 8. Émettre l'événement via WebSocket pour compatibilité
      if (argument && argument.debateId) {
        this.socketGateway.emitToRoom(
          `debate:${argument.debateId}`,
          'argument_scored',
          {
            debateId: argument.debateId,
            argumentId,
            scores: finalScoringResult,
            error: null
          }
        );
      }
      
      // 9. Enregistrer le résultat M3 pour traçabilité (optionnel)
      await this.saveModuleResult(
        argumentId,
        'M3',
        { 
          argumentId, 
          m2Data: m2Data || 'no_m2_data',
          prompt: prompt.substring(0, 500) + '...'
        },
        finalScoringResult,
        true
      );

      this.logger.log(`✅ M3: Argument ${argumentId} scoré avec M2Data (${finalScoringResult.total}/20, reliabilité=${finalScoringResult.reliability}, impact=${finalScoringResult.impact})`);
      return finalScoringResult;
  }

  /**
   * ✅ NOUVEAU : Construit le prompt M3 pour les nouvelles données M2
   */
  private buildScoringPromptWithM2Data(argument: any, m2Data: any, debate: any): string {
    const debateInfo = debate || argument.debate;
    
    // Section M2 avec les nouvelles données structurées
    const m2Section = m2Data ? `INTERNET RESEARCH RESULTS:
Veracity: ${m2Data.veracity}
Analysis: "${m2Data.analysis}"
Improvements: "${m2Data.improvements}"
Strengths: "${m2Data.strengths}"` 
    : 'INTERNET RESEARCH RESULTS: No fact-check performed for this argument';

    // Utiliser l'argument nettoyé
    const cleanText = argument.cleanText || "No text available";

    return `SYSTEM (Module M3 – "Impact Scorer & Justifier" - New Research Version)

You are the **third step of an AI pipeline** powering *Who's Right?*, a 1-vs-1 mobile debate-game that rewards critical-thinking skills.  

Pipeline:
1. **M1 – Rewrite & Moderation** cleans the raw text, censors insults (\`[CENSORED]\`), and flags \`insultFlag\`.  
2. **Internet Search** analyzes claims and provides veracity + analysis + sources (reliability auto-calculated).  
3. **YOU (M3)** evaluate IMPACT only + provide justifications (reliability already calculated from internet research).  

IMPORTANT: Your job is to evaluate IMPACT and provide clear bullet points justifications from your analysis and internet result analysis.

SCORING CRITERIA:

IMPACT ONLY (0-10):
I1 **Magnitude/Gravity** 0-4: How significant are the consequences? (lives, money, national scope, etc.)
I2 **Probability** 0-2: How likely is this to happen or be true? (≥50% certainty = 2)
I3 **Timeframe** 0-1: Is this relevant soon? (effect < 10 years = 1)
I4 **Debate Advancement** 0-2: Does this directly answer/refute opponent's points?
I5 **Persuasion/Style** 0-1: Clear presentation (≤30 words, structured Claim-Reason-Example = 1)

Consider the internet research results when evaluating impact. If veracity is 'likely_false', impact should be lower.

BONUS FLAGS TO DETECT (do not mention them in justification):

BONUSES
\`complete_structure\` – data + logical warrant clearly present.
\`source_recent_authority\` – ≤ 5 y old & reputable source.
\`answer_critical_q\` – explicitly addresses a Walton critical question.
\`reality_check\` – acknowledges a valid opponent point.
\`humility\` – phrases like "I could be wrong…".
\`steelman\` – fair restatement of opponent's idea before refuting.
\`new_information\` – info not in history (embedding distance > 0.5).
\`clarity_concise\` – ≤ 30 words, simple phrasing.
\`grice_relevance\` – tightly linked to last opponent argument.
\`balanced_rhetoric\` – good mix ethos / logos / pathos.
\`turning_point\` – fact verified through online research that overturns or decisively advances the debate.

MALUSES
\`ad_hominem\` – personal insult / attack. **ALWAYS apply if InsultFlag=true**
\`personal_opinion\` – uses personal feelings without added value.
\`gish_gallop\` – ≥ 3 unsupported claims in < 30 s.
\`strawman\` – misrepresents opponent's position.
\`moving_goalposts\` – changes proof standards after reply.
\`whataboutism\` – diverts with unrelated comparison.
\`cherry_picking\` – cites only favourable study.
\`bandwagon\` – "everyone knows…".
\`slippery_slope\` – alarmist outcome without link.
\`gaslighting\` – undermines other's perception of reality.

JUSTIFICATION INSTRUCTIONS:
- **Strengths**: Strong points of the argument based on your analysis AND internet research results. Explain with nuances why these aspects are assets. Provide concrete examples from internet research if relevant. Maximum 3-4 points.
- **Improvements**: Give nuances or counter arguments to explore about this argument and why we should be careful about it, explain in a educational way. If possiblese use examples from internet research. NEVER mention bonus/malus names. Maximum 3-4 points.
- **Language**: Write in the same language as the analyzed argument.

${m2Section}

DEBATE CONTEXT:
Title: "${debateInfo.title || 'Untitled'}"
Tone: ${(debateInfo as any).tone || 'sérieux'}
Context: ${(debateInfo as any).contextPhrase || 'Débat général'}

ARGUMENT TO SCORE:
"${cleanText}"

OUTPUT FORMAT (JSON only):
{
  "impact": 0-10,
  "justification": {
    "strengths": ["strength 1", "strength 2", "strength 3"],
    "improvements": ["improvement 1", "improvement 2", "improvement 3"]
  },
  "bonuses": ["bonus_1", "bonus_2"],
  "maluses": ["malus_1"]
}

Respond silently and output **only** the JSON object.`;
  }

  /**
   * ✅ NOUVEAU : Parse la réponse M3 pour extraire impact + justifications
   */
  private async parseM3ResponseWithM2Data(response: string, m2Data: any, debateId?: string, insultFlag?: boolean): Promise<{
    impact: number;
    justification: {
      strengths: string[];
      improvements: string[];
    };
    bonuses: string[];
    maluses: string[];
  }> {
    try {
      // ✅ NOUVEAU : Parsing JSON complet SANS FALLBACK
      const jsonMatch = response.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Aucun JSON trouvé dans la réponse M3');
      }
      
      const parsed = JSON.parse(jsonMatch[0]);
      
      // ✅ VALIDATION : Vérifier que tous les champs obligatoires sont présents
      if (typeof parsed.impact !== 'number') {
        throw new Error(`Impact manquant ou invalide: ${parsed.impact}`);
      }
      if (!parsed.justification || typeof parsed.justification !== 'object') {
        throw new Error('Justification manquante ou invalide');
      }
      if (!Array.isArray(parsed.justification.strengths)) {
        throw new Error(`Strengths manquants ou invalides: ${parsed.justification.strengths}`);
      }
      if (!Array.isArray(parsed.justification.improvements)) {
        throw new Error(`Improvements manquants ou invalides: ${parsed.justification.improvements}`);
      }
      if (!Array.isArray(parsed.bonuses)) {
        throw new Error(`Bonuses manquants ou invalides: ${parsed.bonuses}`);
      }
      if (!Array.isArray(parsed.maluses)) {
        throw new Error(`Maluses manquants ou invalides: ${parsed.maluses}`);
      }
      
      return {
        impact: Math.max(0, Math.min(10, parsed.impact)),
        justification: parsed.justification,
        bonuses: parsed.bonuses,
        maluses: parsed.maluses
      };
      
    } catch (error) {
      this.logger.error(`❌ M3 parsing error: ${error.message}`);
      this.logger.error(`❌ M3 response: ${response}`);
      throw new Error(`Échec du parsing M3: ${error.message}`);
    }
  }

  /**
   * ✅ NOUVEAU : Combine fiabilité M2 + impact M3 + coefficients débat
   */
  private async calculateFinalScoreWithM2Data(
    impactResult: any,
    m2Data: any,
    debateId?: string,
    overrideReliabilityCoef?: number,
    overrideImpactCoef?: number
  ): Promise<ScoringResult> {
    let reliabilityCoef = overrideReliabilityCoef !== undefined ? overrideReliabilityCoef : 1.0;
    let impactCoef = overrideImpactCoef !== undefined ? overrideImpactCoef : 1.0;

    // Récupérer les coefficients du débat (si pas d'override)
    if (debateId && overrideReliabilityCoef === undefined && overrideImpactCoef === undefined) {
      const debate = await this.prismaService.debate.findUnique({
        where: { id: debateId }
      });

      if (debate) {
        reliabilityCoef = (debate as any).reliabilityCoef || 1.0;
        impactCoef = (debate as any).impactCoef || 1.0;
      }
    }

    // Utiliser la fiabilité pré-calculée par M2
    const baseReliability = m2Data?.calculatedReliability || 5;
    const baseImpact = impactResult.impact || 5;

    // Appliquer les coefficients du débat
    const adjustedReliability = baseReliability * reliabilityCoef;
    const adjustedImpact = baseImpact * impactCoef;

    // ✅ NOUVELLE FORMULE : Total = (CoefFiab × NoteFiab) × (CoefImpact × NoteImpact) / 5
    const baseTotal = Math.round((adjustedReliability * adjustedImpact) / 5);

    // Calculer les points de bonus et malus
    const bonusPoints = this.calculateBonusPoints(impactResult.bonuses || []);
    const malusPoints = this.calculateMalusPoints(impactResult.maluses || []);

    // Score total final avec bonus et malus
    const total = baseTotal + bonusPoints - malusPoints;

    // Déterminer la catégorie GIF
    const gifCategory = total >= 15 ? 3 : total >= 12 ? 2 : total >= 8 ? 1 : 0;

    // Utiliser les justifications structurées
    const combinedJustification = JSON.stringify(impactResult.justification || { strengths: [], improvements: [] });

    this.logger.log(`🧮 M3: Score final calculé - R=${adjustedReliability.toFixed(1)}, I=${adjustedImpact.toFixed(1)}, Base=${baseTotal}, Bonus=+${bonusPoints}, Malus=-${malusPoints}, T=${total}, GIF=${gifCategory}`);

    return {
      reliability: Math.round(adjustedReliability),
      impact: Math.round(adjustedImpact),
      total,
      gifCategory,
      justification: combinedJustification,
      bonuses: impactResult.bonuses || [],
      maluses: impactResult.maluses || []
    };
  }

  /**
   * ✅ NOUVEAU : Calcule les points de bonus
   */
  private calculateBonusPoints(bonuses: string[]): number {
    let points = 0;
    for (const bonus of bonuses) {
      switch (bonus) {
        case 'complete_structure':
          points += 3;
          break;
        case 'source_recent_authority':
          points += 3;
          break;
        case 'answer_critical_q':
          points += 2;
          break;
        case 'reality_check':
          points += 2;
          break;
        case 'humility':
          points += 2;
          break;
        case 'steelman':
          points += 2;
          break;
        case 'new_information':
          points += 1;
          break;
        case 'clarity_concise':
          points += 1;
          break;
        case 'grice_relevance':
          points += 2;
          break;
        case 'balanced_rhetoric':
          points += 3;
          break;
        case 'turning_point':
          points += 5;
          break;
      }
    }
    return points;
  }

  /**
   * ✅ NOUVEAU : Calcule les points de malus
   */
  private calculateMalusPoints(maluses: string[]): number {
    let points = 0;
    for (const malus of maluses) {
      switch (malus) {
        case 'ad_hominem':
          points += 5;
          break;
        case 'personal_opinion':
          points += 2;
          break;
        case 'gish_gallop':
          points += 4;
          break;
        case 'strawman':
          points += 2;
          break;
        case 'moving_goalposts':
          points += 3;
          break;
        case 'whataboutism':
          points += 2;
          break;
        case 'cherry_picking':
          points += 1;
          break;
        case 'bandwagon':
          points += 2;
          break;
        case 'slippery_slope':
          points += 2;
          break;
        case 'gaslighting':
          points += 3;
          break;
        case 'sealioning':
          points += 2;
          break;
        case 'tone_policing':
          points += 1;
          break;
      }
    }
    return points;
  }

  /**
   * ✅ NOUVEAU : Enregistre le résultat d'un module pour traçabilité
   */
  private async saveModuleResult(
    argumentId: string, 
    module: string, 
    input: any, 
    output: any, 
    success: boolean = true,
    error?: string
  ) {
    try {
      await this.prismaService.argumentModuleResult.create({
        data: {
          argumentId,
          module,
          input: input ? JSON.parse(JSON.stringify(input)) : null,
          output: output ? JSON.parse(JSON.stringify(output)) : null,
          success,
          error
        }
      });
      this.logger.log(`📊 Résultat du module ${module} sauvegardé pour l'argument ${argumentId}`);
    } catch (saveError) {
      this.logger.error(`❌ Erreur sauvegarde module ${module}: ${saveError.message}`);
    }
  }

  /**
   * Calcule le changement d'ELO selon la formule classique
   * avec bonus basé sur l'écart de scores et facteur de complétion
   */
  calculateEloChange(
    playerElo: number,
    opponentElo: number,
    result: number, // 1 = victoire, 0.5 = égalité, 0 = défaite
    scoreGap: number,
    totalPoints?: number // Total des points du débat (hostScore + guestScore)
  ): number {
    // Seuils pour le facteur de complétion
    const SEUIL_POINTS_MIN = 30;      // En dessous → ELO = 0
    const SEUIL_POINTS_COMPLET = 250; // Au-dessus → ELO 100%

    // Si totalPoints fourni et en dessous du seuil minimum, pas de gain/perte ELO
    if (totalPoints !== undefined && totalPoints < SEUIL_POINTS_MIN) {
      this.logger.log(`⚖️ ELO: Points insuffisants (${totalPoints} < ${SEUIL_POINTS_MIN}), changement = 0`);
      return 0;
    }

    // Formule ELO classique
    const eloDifference = opponentElo - playerElo;
    const expectedScore = 1 / (1 + Math.pow(10, eloDifference / 400));

    // Facteur K de base
    let kFactor = 32;

    // Bonus basé sur l'écart de scores (max +100% du K factor)
    const gapBonus = Math.min(scoreGap / 100, 1.0);
    kFactor = kFactor * (1 + gapBonus);

    // Calcul ELO de base
    let eloChange = kFactor * (result - expectedScore);

    // Facteur de complétion : réduit le gain/perte si débat court
    if (totalPoints !== undefined) {
      const ratioCompletion = Math.min(1, totalPoints / SEUIL_POINTS_COMPLET);
      const eloBeforeCompletion = eloChange;
      eloChange = eloChange * ratioCompletion;
      this.logger.log(`⚖️ ELO: totalPoints=${totalPoints}, ratioCompletion=${ratioCompletion.toFixed(2)}, eloChange=${eloBeforeCompletion.toFixed(1)} → ${eloChange.toFixed(1)}`);
    }

    return Math.round(eloChange);
  }

  /**
   * ✅ NOUVEAU : Calcule le gain ELO pour le gagnant lors d'un forfait/abandon
   * Prend en compte :
   * - La différence d'ELO entre les joueurs (formule ELO classique)
   * - Les points marqués par le gagnant (ratio de complétion)
   * - L'écart de points (bonus si domination)
   *
   * @param winnerElo ELO du gagnant
   * @param forfeiterElo ELO de celui qui abandonne
   * @param winnerPoints Points totaux du gagnant dans le débat
   * @param forfeiterPoints Points totaux de celui qui abandonne
   * @returns Gain ELO pour le gagnant (0 si pas assez de points)
   */
  calculateForfeitEloGain(
    winnerElo: number,
    forfeiterElo: number,
    winnerPoints: number,
    forfeiterPoints: number
  ): number {
    // Constantes
    const K_FORFEIT = 24; // K factor réduit pour les abandons (vs 32 normal)
    const SEUIL_POINTS_COMPLET = 200; // Points pour un débat "bien engagé"
    const SEUIL_POINTS_MIN = 30; // Minimum pour recevoir de l'ELO
    const RATIO_ECART_MAX = 0.4; // Bonus max pour l'écart (1 + 0.4 = 1.4x)

    // Si pas assez de points, pas de gain ELO
    if (winnerPoints < SEUIL_POINTS_MIN) {
      this.logger.log(`⚖️ Forfeit ELO: Points insuffisants (${winnerPoints} < ${SEUIL_POINTS_MIN}), gain = 0`);
      return 0;
    }

    // 1. Calcul ELO de base selon la formule classique
    const eloDifference = forfeiterElo - winnerElo;
    const expectedScore = 1 / (1 + Math.pow(10, eloDifference / 400));
    const eloBaseVictoire = K_FORFEIT * (1 - expectedScore);

    // 2. Ratio de complétion basé sur les points du gagnant (0 à 1)
    const ratioCompletion = Math.min(1, winnerPoints / SEUIL_POINTS_COMPLET);

    // 3. Ratio d'écart - bonus si domination claire (1 à 1.4)
    let ratioEcart = 1;
    const ecart = winnerPoints - forfeiterPoints;
    if (forfeiterPoints > 0) {
      ratioEcart = 1 + Math.min(RATIO_ECART_MAX, ecart / (forfeiterPoints * 2));
    } else {
      ratioEcart = 1 + RATIO_ECART_MAX; // Max bonus si adversaire à 0 points
    }

    // 4. Calcul final
    const eloGain = Math.round(eloBaseVictoire * ratioCompletion * ratioEcart);

    this.logger.log(
      `⚖️ Forfeit ELO: winner=${winnerElo} vs forfeiter=${forfeiterElo}, ` +
      `points=${winnerPoints}vs${forfeiterPoints}, ` +
      `eloBase=${eloBaseVictoire.toFixed(1)}, ` +
      `ratioCompletion=${ratioCompletion.toFixed(2)}, ` +
      `ratioEcart=${ratioEcart.toFixed(2)}, ` +
      `gain=${eloGain}`
    );

    return Math.max(0, eloGain);
  }

  /**
   * Calcule le gain d'XP selon les règles spécifiées
   * Pour le mode duel : prend en compte les points individuels pour moduler l'XP
   * Pour le mode groupe : utilise l'ancienne logique mais avec facteur personnel
   * ✅ NOUVEAU : Prend en compte la difficulté du match via l'écart d'ELO
   */
  calculateXPGain(
    isWinner: boolean,
    playerPoints: number,
    opponentPoints: number,
    mode: 'duel' | 'group',
    playerElo?: number,
    opponentElo?: number
  ): number {
    // Si aucun point marqué, aucun XP
    if (playerPoints <= 0) {
      return 0;
    }

    // Facteur personnel basé sur l'implication du joueur
    const personalFactor = Math.min(1, playerPoints / this.PLAYER_POINTS_FOR_MAX_XP);

    if (mode === 'group') {
      // Mode groupe : XP de base proportionnel à l'implication
      return Math.round(30 * personalFactor);
    }

    // Mode duel : nouvelle formule avec bonus d'écart
    const gap = Math.abs(playerPoints - opponentPoints);
    const gapBonus = Math.floor(gap / 5);

    let raw: number;
    if (isWinner) {
      raw = 30 + 25 + gapBonus; // Base 55 + bonus d'écart
    } else {
      // Perdant : garantir un minimum d'XP basé sur l'implication (20 XP × personalFactor)
      const minLoserXP = 20;
      raw = Math.max(30 - gapBonus, minLoserXP);
    }

    // XP de base avant multiplicateur de difficulté
    const baseXP = Math.round(raw * personalFactor);

    // ✅ NOUVEAU : Multiplicateur de difficulté basé sur l'écart d'ELO
    if (playerElo !== undefined && opponentElo !== undefined) {
      // Calculer l'expected score (probabilité de victoire attendue)
      const eloDifference = opponentElo - playerElo;
      const expectedScore = 1 / (1 + Math.pow(10, eloDifference / 400));

      // Résultat réel : 1 si victoire, 0 si défaite
      const actualResult = isWinner ? 1 : 0;

      // Surprise factor : différence entre résultat réel et attendu (-1 à +1)
      const surprise = actualResult - expectedScore;

      // Multiplicateur de difficulté : 0.5x à 1.5x
      // surprise = -1 (défaite très attendue) → 0.5x
      // surprise = 0 (match équilibré) → 1.0x
      // surprise = +1 (victoire héroïque) → 1.5x
      const difficultyMultiplier = 0.5 + (surprise + 1) * 0.5;

      const finalXP = Math.round(baseXP * difficultyMultiplier);

      this.logger.log(`📊 XP Calculation: base=${baseXP}, ELO=${playerElo}vs${opponentElo}, expected=${expectedScore.toFixed(2)}, surprise=${surprise.toFixed(2)}, multiplier=${difficultyMultiplier.toFixed(2)}x, final=${finalXP}`);

      return Math.max(0, finalXP);
    }

    // Fallback : retourner l'XP de base si ELO non fourni
    return Math.max(0, baseXP);
  }

  /**
   * Calcule le niveau basé sur l'XP général
   * Formule: Niveau N nécessite 100 + (N-1) * 75 + (N-1)² * 25 XP
   */
  calculateLevel(totalXP: number): number {
    let level = 1;
    let xpRequired = 0;
    
    while (true) {
      const nextLevelXP = 100 + (level - 1) * 75 + Math.pow(level - 1, 2) * 25;
      if (xpRequired + nextLevelXP > totalXP) {
        break;
      }
      xpRequired += nextLevelXP;
      level++;
    }
    
    return level;
  }

  /**
   * Calcule l'XP requis pour le prochain niveau
   */
  calculateXPForNextLevel(currentLevel: number): number {
    return 100 + (currentLevel) * 75 + Math.pow(currentLevel, 2) * 25;
  }

  /**
   * Finalise un débat en calculant et sauvegardant les scores
   * ✅ CORRIGÉ : Transaction atomique pour éviter le double comptage
   */
  async finalizeDebate(debateId: string, result: DebateResult): Promise<DebateScoringResult> {
    // ✅ NOUVEAU : Transaction atomique pour éviter les race conditions
    return await this.prismaService.$transaction(async (tx) => {
      // Récupérer le débat avec les utilisateurs dans la transaction
      const debate = await tx.debate.findUnique({
        where: { id: debateId },
        include: {
          host: true,
          guest: true,
        },
      });

      if (!debate || !debate.guest) {
        throw new Error('Débat introuvable ou incomplet');
      }

      // ✅ PROTECTION RENFORCÉE : Vérifier et marquer comme scoré en une seule opération atomique
      if (debate.status === 'scored') {
        throw new Error('Ce débat a déjà été scoré');
      }

      // ✅ Marquer IMMÉDIATEMENT comme scoré pour éviter les race conditions
      const updateResult = await tx.debate.updateMany({
        where: { 
          id: debateId, 
          status: { not: 'scored' } // Seulement si pas encore scoré
        },
        data: { 
          status: 'scored',
          endedAt: new Date(),
        },
      });

      // Si aucune ligne mise à jour = déjà scoré par un autre processus
      if (updateResult.count === 0) {
        throw new Error('Ce débat a déjà été scoré par un autre processus');
      }



      // Calculer l'écart de scores
      const scoreGap = Math.abs(result.hostScore - result.guestScore);

      // Déterminer les résultats pour chaque joueur
      const hostResult = result.winner === 'host' ? 1 : (result.winner === 'tie' ? 0.5 : 0);
      const guestResult = result.winner === 'guest' ? 1 : (result.winner === 'tie' ? 0.5 : 0);

      // ✅ MODIFIÉ : ELO = 0 pour débats privés, mais XP pour TOUS les débats
      let hostEloChange = 0;
      let guestEloChange = 0;
      let hostXPGain = 0;
      let guestXPGain = 0;

      // Calculer les changements d'ELO seulement si débat PUBLIC
      const totalPoints = result.hostScore + result.guestScore;

      if (!debate.isPrivate) {
        hostEloChange = this.calculateEloChange(
          debate.host.elo,
          debate.guest.elo,
          hostResult,
          scoreGap,
          totalPoints
        );

        guestEloChange = this.calculateEloChange(
          debate.guest.elo,
          debate.host.elo,
          guestResult,
          scoreGap,
          totalPoints
        );

        // Protection ELO si erreur d'analyse détectée
        if ((debate as any).analysisErrorFlag) {
          this.logger.log(`🛡️ Protection ELO activée pour débat ${debateId} (erreur d'analyse)`);

          if (result.winner === 'host' && guestEloChange < 0) {
            this.logger.log(`🛡️ Protection ELO pour guest: ${guestEloChange} → 0`);
            guestEloChange = 0;
          } else if (result.winner === 'guest' && hostEloChange < 0) {
            this.logger.log(`🛡️ Protection ELO pour host: ${hostEloChange} → 0`);
            hostEloChange = 0;
          }
        }
      }

      // ✅ NOUVEAU : Calculer les gains d'XP pour TOUS les débats (publics ET privés)
      hostXPGain = this.calculateXPGain(
        result.winner === 'host',
        result.hostScore,
        result.guestScore,
        'duel',
        debate.host.elo,
        debate.guest.elo
      );
      guestXPGain = this.calculateXPGain(
        result.winner === 'guest',
        result.guestScore,
        result.hostScore,
        'duel',
        debate.guest.elo,
        debate.host.elo
      );

      // Nouveaux ELOs
      const hostNewElo = debate.host.elo + hostEloChange;
      const guestNewElo = debate.guest.elo + guestEloChange;

      // ✅ NOUVEAU : Sauvegarder les résultats de scoring dans le débat pour cohérence d'affichage
      // Note: Ces champs seront disponibles après la migration Prisma
      await tx.debate.update({
        where: { id: debateId },
        data: {
          // @ts-ignore - Ces champs seront ajoutés par la migration
          hostEloChange,
          guestEloChange,
          hostXPGain,
          guestXPGain,
          hostFinalScore: result.hostScore,
          guestFinalScore: result.guestScore,
          finalWinner: result.winner,
          scoringTimestamp: new Date(),
        },
      });

      // ✅ CORRIGÉ : Mettre à jour les utilisateurs (hors transaction pour l'instant)
      // Note: updateUserProgress doit être appelé hors transaction car il a ses propres opérations DB
      // ✅ MODIFIÉ : Mettre à jour pour TOUS les débats (ELO=0 pour privés, XP pour tous)
      await Promise.all([
        this.updateUserProgress(debate.host.id, hostEloChange, hostXPGain, debate.topicId, true),
        this.updateUserProgress(debate.guest.id, guestEloChange, guestXPGain, debate.topicId, true),
      ]);

      this.logger.log(`✅ Résultats de scoring sauvegardés pour débat ${debateId}: hostElo=${hostEloChange}, guestElo=${guestEloChange}, hostXP=${hostXPGain}, guestXP=${guestXPGain}`);

        return {
        hostEloChange,
        guestEloChange,
        hostXPGain,
        guestXPGain,
        hostNewElo,
        guestNewElo,
      };
    }); // ✅ Fermeture de la transaction
  }

  /**
   * ✅ NOUVEAU : Récupère les résultats d'un débat (lecture seule avec consultation intelligente)
   * Sépare la consultation de la finalisation pour éviter les race conditions
   */
  async getDebateResults(debateId: string, result: DebateResult): Promise<DebateScoringResult> {
    const debate = await this.prismaService.debate.findUnique({
      where: { id: debateId },
      include: {
        host: true,
        guest: true,
      },
    });

    if (!debate || !debate.guest) {
      throw new Error('Débat introuvable ou incomplet');
    }

    // Si le débat n'est pas encore scoré, déléguer à la finalisation
    if (debate.status !== 'scored') {
      this.logger.log(`📊 Débat ${debateId} pas encore finalisé, redirigé vers finalisation`);
      return await this.finalizeDebate(debateId, result);
    }

    // ✅ PRIORITÉ : Utiliser les données persistées si disponibles
    // @ts-ignore - Ces champs seront ajoutés par la migration
    if (debate.hostEloChange !== null && debate.guestEloChange !== null && 
        debate.hostXPGain !== null && debate.guestXPGain !== null && 
        debate.scoringTimestamp !== null) {
      
      // @ts-ignore - Ces champs seront ajoutés par la migration
      this.logger.log(`📊 Consultation des résultats persistés pour débat ${debateId}: hostXP=${debate.hostXPGain}, guestXP=${debate.guestXPGain}, hostEloChange=${debate.hostEloChange}, guestEloChange=${debate.guestEloChange}`);
      
      return {
        // @ts-ignore - Ces champs seront ajoutés par la migration
        hostEloChange: debate.hostEloChange,
        guestEloChange: debate.guestEloChange,
        hostXPGain: debate.hostXPGain,
        guestXPGain: debate.guestXPGain,
        hostNewElo: debate.host.elo + debate.hostEloChange, // ELO de base + changement persisté
        guestNewElo: debate.guest.elo + debate.guestEloChange,
      };
    }

    // ✅ FALLBACK : Recalculer si les données persistées ne sont pas disponibles
    this.logger.warn(`⚠️ Données persistées manquantes pour débat ${debateId}, recalcul en fallback`);

    const scoreGap = Math.abs(result.hostScore - result.guestScore);
    const totalPoints = result.hostScore + result.guestScore;
    const hostResult = result.winner === 'host' ? 1 : (result.winner === 'tie' ? 0.5 : 0);
    const guestResult = result.winner === 'guest' ? 1 : (result.winner === 'tie' ? 0.5 : 0);

    const hostEloChange = this.calculateEloChange(
      debate.host.elo,
      debate.guest.elo,
      hostResult,
      scoreGap,
      totalPoints
    );

    const guestEloChange = this.calculateEloChange(
      debate.guest.elo,
      debate.host.elo,
      guestResult,
      scoreGap,
      totalPoints
    );
    
    const hostXPGain = this.calculateXPGain(
      result.winner === 'host',
      result.hostScore,
      result.guestScore,
      'duel',
      debate.host.elo,
      debate.guest.elo
    );
    const guestXPGain = this.calculateXPGain(
      result.winner === 'guest',
      result.guestScore,
      result.hostScore,
      'duel',
      debate.guest.elo,
      debate.host.elo
    );

    this.logger.log(`📊 Résultats recalculés pour débat ${debateId}: hostXP=${hostXPGain}, guestXP=${guestXPGain}, hostEloChange=${hostEloChange}, guestEloChange=${guestEloChange}`);

    return {
      hostEloChange,
      guestEloChange,
      hostXPGain,
      guestXPGain,
      hostNewElo: debate.host.elo + hostEloChange,
      guestNewElo: debate.guest.elo + guestEloChange,
    };
  }

  /**
   * ✅ NOUVEAU : Incrémente le compteur totalDebates pour tous les participants d'un débat de groupe
   */
  async incrementTotalDebatesForGroupParticipants(debateId: string): Promise<void> {
    try {
      // Récupérer tous les participants du débat (organisateur + ceux qui ont soumis des arguments)
      const debate = await this.prismaService.groupDebate.findUnique({
        where: { id: debateId },
        include: {
          organizer: true,
          arguments: {
            select: { userId: true },
            distinct: ['userId']
          }
        }
      });

      if (!debate) {
        this.logger.warn(`❌ Débat de groupe ${debateId} non trouvé pour incrémentation totalDebates`);
        return;
      }

      // Collecter tous les participants uniques (organisateur + participants avec arguments)
      const participantIds = new Set<string>();
      participantIds.add(debate.organizerId); // Organisateur
      
      debate.arguments.forEach(arg => {
        participantIds.add(arg.userId); // Participants avec arguments
      });

             // Incrémenter totalDebates pour tous les participants
       if (participantIds.size > 0) {
         await this.prismaService.user.updateMany({
           where: {
             id: { in: Array.from(participantIds) }
           },
           data: {
             totalDebates: { increment: 1 }, // ✅ Compteur total (pour compatibilité)
             totalGroupDebates: { increment: 1 } // ✅ NOUVEAU : Compteur spécifique aux groupes
           }
         });

        this.logger.log(`✅ Compteur totalDebates incrémenté pour ${participantIds.size} participants du débat de groupe ${debateId}`);
      } else {
        this.logger.log(`⚪ Aucun participant trouvé pour le débat de groupe ${debateId}`);
      }

    } catch (error) {
      this.logger.error(`❌ Erreur lors de l'incrémentation totalDebates pour débat de groupe ${debateId}: ${error.message}`);
    }
  }

  /**
   * Met à jour le profil utilisateur avec ELO et XP
   * ✅ MODIFIÉ : Gère les bots différemment (pas de mise à jour ELO, incrémente botEngagementCount)
   */
  private async updateUserProgress(
    userId: string,
    eloChange: number,
    xpGain: number,
    topicId?: string,
    shouldIncrementDebateCount: boolean = false // ✅ NOUVEAU : Contrôler l'incrémentation
  ): Promise<void> {
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
    });

    if (!user) {
      throw new Error('Utilisateur introuvable');
    }

    // ✅ NOUVEAU : Si l'utilisateur est un bot, ne pas mettre à jour l'ELO mais incrémenter botEngagementCount
    if (user.isBot) {
      this.logger.log(`🤖 Bot détecté (${user.username}): ELO non modifié, incrémentation botEngagementCount`);
      await this.prismaService.user.update({
        where: { id: userId },
        data: {
          botEngagementCount: { increment: 1 },
          totalDebates: { increment: 1 },
          totalDuelDebates: { increment: 1 },
        },
      });
      return; // Ne pas exécuter la suite pour les bots
    }

    // Nouveau ELO (seulement pour les vrais utilisateurs)
    const newElo = user.elo + eloChange;

    // Récupérer la progression actuelle
    const currentProgress = user.topicsProgress as any || {
      generalXP: 0,
      level: 1,
      subTopics: {},
      mainTopics: {},
    };

    // Ajouter XP général
    const oldGeneralXP = currentProgress.generalXP || 0;
    currentProgress.generalXP = oldGeneralXP + xpGain;
    currentProgress.level = this.calculateLevel(currentProgress.generalXP);
    console.log(`✅ XP général ajouté pour ${user.username}: ${oldGeneralXP} → ${currentProgress.generalXP} (+${xpGain})`);

    // Ajouter XP au sujet spécifique si topicId fourni
    if (topicId) {
      console.log(`🎯 Attribution XP pour topic: ${topicId}`);
      // Récupérer le topic pour savoir s'il est principal ou sous-topic
      const topic = await this.prismaService.topic.findUnique({
        where: { id: topicId },
      });

      if (topic) {
        console.log(`📚 Topic trouvé: "${topic.label}" (isMainTopic: ${topic.isMainTopic}, parent: ${topic.parentId || 'aucun'})`);
        
        if (topic.isMainTopic) {
          // Topic principal
          if (!currentProgress.mainTopics[topicId]) {
            currentProgress.mainTopics[topicId] = { xp: 0, lastUpdate: new Date().toISOString() };
            console.log(`🆕 Création nouveau mainTopic: ${topicId}`);
          }
          const oldXp = currentProgress.mainTopics[topicId].xp;
          currentProgress.mainTopics[topicId].xp += xpGain;
          currentProgress.mainTopics[topicId].lastUpdate = new Date().toISOString();
          console.log(`✅ MainTopic XP: ${topic.label} (${oldXp} → ${currentProgress.mainTopics[topicId].xp}, +${xpGain})`);
        } else {
          // Sous-topic
          if (!currentProgress.subTopics[topicId]) {
            currentProgress.subTopics[topicId] = { xp: 0, lastActivity: new Date().toISOString() };
            console.log(`🆕 Création nouveau subTopic: ${topicId}`);
          }
          const oldXp = currentProgress.subTopics[topicId].xp;
          currentProgress.subTopics[topicId].xp += xpGain;
          currentProgress.subTopics[topicId].lastActivity = new Date().toISOString();
          console.log(`✅ SubTopic XP: ${topic.label} (${oldXp} → ${currentProgress.subTopics[topicId].xp}, +${xpGain})`);

          // ✅ Aussi ajouter XP au topic parent - créer le parent s'il n'existe pas
          if (topic.parentId) {
            console.log(`🌳 Attribution XP au parent: ${topic.parentId}`);
            
            // Créer le parent automatiquement s'il n'existe pas
            if (!currentProgress.mainTopics[topic.parentId]) {
              currentProgress.mainTopics[topic.parentId] = { 
                xp: 0, 
                lastUpdate: new Date().toISOString() 
              };
              console.log(`🆕 Création nouveau mainTopic parent: ${topic.parentId}`);
            }
            const parentOldXp = currentProgress.mainTopics[topic.parentId].xp;
            const parentXpGain = Math.floor(xpGain * 0.5); // 50% au parent
            currentProgress.mainTopics[topic.parentId].xp += parentXpGain;
            currentProgress.mainTopics[topic.parentId].lastUpdate = new Date().toISOString();
            console.log(`✅ MainTopic parent XP: ${topic.parentId} (${parentOldXp} → ${currentProgress.mainTopics[topic.parentId].xp}, +${parentXpGain})`);
          } else {
            console.log(`ℹ️ Pas de parent pour le sous-topic ${topic.label}`);
          }
        }
      } else {
        console.error(`❌ Topic non trouvé: ${topicId}`);
      }
    } else {
      console.log(`ℹ️ Pas de topicId fourni, seul l'XP général est ajouté`);
    }

    // ✅ Préparer les données de mise à jour
    const updateData: any = {
      elo: newElo,
      topicsProgress: currentProgress,
    };

    // ✅ Incrémenter les compteurs seulement si demandé (éviter la double incrémentation)
    if (shouldIncrementDebateCount) {
      updateData.totalDebates = { increment: 1 };
      updateData.totalDuelDebates = { increment: 1 };
    }

    // Sauvegarder en base
    await this.prismaService.user.update({
      where: { id: userId },
      data: updateData,
    });
  }

  /**
   * ✅ NOUVEAU : Score un argument local avec les données M2
   * Utilise la même logique que scoreArgumentWithM2Data mais pour LocalArgument
   */
  async scoreLocalArgumentWithM2Data(localArgumentId: string, m2Data: any): Promise<ScoringResult> {
    // 1. Récupérer l'argument local complet
    const localArgument = await this.prismaService.localArgument.findUnique({
      where: { id: localArgumentId },
      include: {
        localDebate: true
      }
    });

    if (!localArgument) {
      throw new Error(`Local argument ${localArgumentId} not found`);
    }

    // 2. Convertir l'argument local au format attendu par la méthode de scoring
    const argumentForScoring = {
      id: localArgument.id,
      cleanText: localArgument.cleanText,
      userId: localArgument.localDebate.hostUserId, // Utiliser l'host comme userId
      debateId: localArgument.localDebateId,
      debate: {
        id: localArgument.localDebate.id,
        title: localArgument.localDebate.title,
        hostView: localArgument.localDebate.player1Viewpoint,
        guestView: localArgument.localDebate.player2Viewpoint
      }
    };

    // 3. Construire le prompt de scoring
    const prompt = this.buildScoringPromptWithM2Data(argumentForScoring, m2Data, argumentForScoring.debate);

    // 4. Appeler le LLM Gemini pour le scoring
    this.logger.log(`🎯 M3 Local: Envoi prompt scoring pour argument local ${localArgumentId}`);
    const llmResponse = await this.llmService.callGemini(
      this.llmService.MODEL_M3_GEMINI,
      prompt,
      'M3_LOCAL',
      localArgument.localDebateId
    );

    // 5. Parser la réponse
    return this.parseScoringResponse(llmResponse);
  }

  /**
   * ✅ MÉTHODE DE TEST : Expose M3 pour l'interface de test
   * Score un argument avec M2 data et retourne prompt + réponse brute + données parsées
   */
  async testScoreWithM2Data(
    cleanText: string,
    m2Data: any,
    debate: {title: string, hostView: string, guestView: string, reliabilityCoef: number, impactCoef: number},
    insultFlag: boolean
  ): Promise<{
    prompt: string;
    rawResponse: string;
    parsed: any;
    finalScore: ScoringResult;
    processingTime: number;
  }> {
    const startTime = Date.now();
    this.logger.log(`🧪 M3 Test: Scoring argument "${cleanText.substring(0, 50)}..."`);

    // Construire un argument factice pour le prompt
    const argumentForScoring = {
      id: 'test-argument-id',
      cleanText,
      userId: 'test-user-id',
      debateId: 'test-debate-id',
      insultFlag,
      debate
    };

    // 1. Construire le prompt M3
    const prompt = this.buildScoringPromptWithM2Data(argumentForScoring, m2Data, debate);

    // 2. Appeler le LLM Gemini
    const rawResponse = await this.llmService.callGemini(
      this.llmService.MODEL_M3_GEMINI,
      prompt,
      'M3_TEST',
      'test-debate-id'
    );

    // 3. Parser la réponse pour extraire impact + justifications
    const impactResult = await this.parseM3ResponseWithM2Data(rawResponse, m2Data, 'test-debate-id', insultFlag);

    // 4. Calculer le score final avec coefficients (passer les coefficients en override)
    const finalScore = await this.calculateFinalScoreWithM2Data(
      impactResult,
      m2Data,
      null,
      debate.reliabilityCoef,
      debate.impactCoef
    );

    const processingTime = Date.now() - startTime;

    return {
      prompt,
      rawResponse,
      parsed: impactResult,
      finalScore,
      processingTime
    };
  }

  /**
   * ✅ NOUVEAU : Méthode robuste pour extraire le JSON complet même avec des objets imbriqués
   */
  private extractCompleteJson(response: string): string[] | null {
    const startIndex = response.indexOf('{');
    if (startIndex === -1) return null;

    let braceCount = 0;
    let endIndex = startIndex;

    // Parcourir caractère par caractère pour compter les accolades
    for (let i = startIndex; i < response.length; i++) {
      const char = response[i];

      if (char === '{') {
        braceCount++;
      } else if (char === '}') {
        braceCount--;

        // Quand on revient à 0, on a trouvé la fin du JSON
        if (braceCount === 0) {
          endIndex = i;
          break;
        }
      }
    }

    if (braceCount !== 0) return null; // JSON malformé

    const jsonString = response.substring(startIndex, endIndex + 1);
    return [jsonString];
  }
}
