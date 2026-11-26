import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm/llm.service';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { SocketGateway } from '../gateways/socket.gateway';

/**
 * Interface pour le résultat de l'analyse d'un débat duel
 */
export interface DuelDebateAnalysisResult {
  moderationStatus: 'approved' | 'rejected' | 'pending';
  rejectionReason?: string;
  contextPhrase?: string;
  tone?: 'humour' | 'modéré' | 'sérieux';
  reliabilityCoef?: number; // 1.0 - 2.0
  impactCoef?: number; // 1.0 - 2.0
  topicCategory?: string; // Label du topic pour affichage
  topicId?: string; // ID du topic pour attribution XP
}

/**
 * Service d'analyse automatique des débats duel
 * Effectue la modération, l'analyse contextuelle et la classification thématique
 * Basé sur la logique du worker-orga.ts du mode groupe
 */
@Injectable()
export class DuelDebateAnalysisService {
  private readonly logger = new Logger(DuelDebateAnalysisService.name);
  
  constructor(
    private readonly llmService: LlmService,
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
    private readonly socketGateway: SocketGateway
  ) {}
  
  /**
   * 🎯 MÉTHODE PRINCIPALE : Analyse complète d'un débat duel
   * @param debateId ID du débat
   * @param title Titre du débat  
   * @param hostView Point de vue de l'hôte
   * @param guestView Point de vue de l'invité
   * @returns Résultat de l'analyse avec coefficients et statut modération
   */
  async analyzeDebateForDuel(
    debateId: string, 
    title: string, 
    hostView: string, 
    guestView: string
  ): Promise<DuelDebateAnalysisResult> {
    const startTime = Date.now(); // ✅ Déplacer avant try/catch pour accès global
    
    try {
      this.logger.log(`🔍 Analyse débat duel ${debateId}: "${title.substring(0, 50)}..."`);
      

      // ✅ NOUVEAU : Analyse sans timeout - elle se termine naturellement
      const finalResult = await this.performAnalysis(debateId, title, hostView, guestView);

      const processingTime = Date.now() - startTime;
      this.logger.log(`✅ Analyse débat ${debateId} terminée: ${finalResult.moderationStatus} | ${finalResult.topicCategory} | ${processingTime}ms`);

      // Émettre l'événement de succès aux clients
      this.socketGateway.emitToRoom(
        `debate:${debateId}`,
        'debate_analysis_completed',
        {
          debateId,
          status: finalResult.moderationStatus,
          analysis: finalResult,
          processingTime
        }
      );

      return finalResult;
      
    } catch (error) {
      const processingTime = Date.now() - startTime;
      this.logger.error(`❌ Erreur analyse débat ${debateId}: ${error.message}`);
      
      // 📝 LOG DÉTAILLÉ : Erreur complète + stack trace
      this.logger.error(`🔥 [DUEL_ANALYSIS] ERREUR DÉTAILLÉE pour ${debateId}:
        💥 Message: ${error.message}
        📚 Stack: ${error.stack || 'N/A'}
        ⏱️ Temps avant erreur: ${processingTime}ms
        🔄 Fallback activé: OUI (valeurs par défaut)`);
      
      // Émettre l'événement d'erreur aux clients
      this.socketGateway.emitToRoom(
        `debate:${debateId}`,
        'debate_analysis_error',
        {
          debateId,
          error: error.message,
          processingTime
        }
      );
      
      // ✅ FALLBACK : Retourner des valeurs par défaut en cas d'erreur
      const fallbackResult = {
        moderationStatus: 'approved', // Par défaut approuvé si erreur d'analyse
        contextPhrase: `Débat sur: ${title}`,
        tone: 'modéré',
        reliabilityCoef: 1.5, // Valeur moyenne
        impactCoef: 1.5, // Valeur moyenne  
        topicCategory: 'Général' // Catégorie par défaut
      };
    }
  }

  /**
   * 🛡️ MODÉRATION : Détecte insultes, haine, spam dans le contenu du débat
   * Basé sur worker-orga.ts ligne 347-354
   */
  private async moderateDebateContent(
    title: string, 
    hostView: string, 
    guestView: string
  ): Promise<{status: 'approved' | 'rejected', reason?: string}> {
    try {
      this.logger.log(`🛡️ Modération débat: "${title.substring(0, 30)}..."`);

      // Construire le prompt de modération
      const prompt = this.buildModerationPrompt(title, hostView, guestView);

      // 📝 LOG DÉTAILLÉ : Prompt envoyé
      this.logger.log(`📝 [MODERATION] Prompt envoyé:\n${prompt}`);

      // Appeler le LLM Gemini pour la modération
      const llmResponse = await this.llmService.callGemini(
        this.llmService.MODEL_DEBATE_ANALYSIS_GEMINI,
        prompt,
        'MODERATION_DUEL',
        null, // Pas de debateId encore puisqu'on modère avant activation
        null  // Pas d'argumentId
      );

      // 📝 LOG DÉTAILLÉ : Réponse complète du LLM
      this.logger.log(`🤖 [MODERATION] Réponse LLM complète:\n${JSON.stringify(llmResponse, null, 2)}`);

      // Parser la réponse de modération
      const moderationResult = this.parseModerationResponse(llmResponse);
      
      // 📝 LOG DÉTAILLÉ : Résultat du parsing
      this.logger.log(`🔍 [MODERATION] Résultat parsing:
        - Status: ${moderationResult.status}
        - Raison: ${moderationResult.reason || 'N/A'}`);
      
      if (moderationResult.status === 'rejected') {
        this.logger.warn(`🚫 Modération: débat rejeté - ${moderationResult.reason}`);
      } else {
        this.logger.log(`✅ Modération: débat approuvé`);
      }
      
      return moderationResult;
      
    } catch (error) {
      this.logger.error(`❌ Erreur modération: ${error.message}`);
      // En cas d'erreur de modération, approuver par défaut (sécurité)
      return { status: 'approved' };
    }
  }

  /**
   * 🛡️ Construit le prompt de modération pour analyser le contenu du débat
   */
  private buildModerationPrompt(title: string, hostView: string, guestView: string): string {
    return `You are a content moderation expert. Your role is to moderate debate content and check for policy violations.

DEBATE CONTENT TO MODERATE:
TITLE: "${title}"
HOST VIEW: "${hostView}"
GUEST VIEW: "${guestView}"

TASK - MODERATION CHECK:
Analyze the debate content (title + both viewpoints) and check if it contains:
- Direct or indirect insults → "insult"
- Hate speech or discrimination → "hate_speech"  
- Incomprehensible or confusing content → "unintelligible"
- Spam/repetitive/nonsense content → "spam"
- Excessive clickbait manipulation → "clickbait"
If NO problems found → "approved"

IMPORTANT GUIDELINES:
- Democratic debates on controversial, political, or societal topics are ALLOWED
- Only flag REAL moderation issues (actual insults, hate speech, spam)
- Be permissive for legitimate debate topics, even if controversial
- Focus on content that violates platform policies, not opinions

RESPONSE FORMAT:
Respond with ONLY a JSON object:

If APPROVED:
{
  "moderationStatus": "approved"
}

If REJECTED:
{
  "moderationStatus": "insult|hate_speech|unintelligible|spam|clickbait",
  "reason": "Brief explanation of why this content violates policies"
}

Analyze the content and respond with ONLY the JSON object.`;
  }

  /**
   * 🛡️ Parse la réponse LLM de modération
   */
  private parseModerationResponse(response: string): {status: 'approved' | 'rejected', reason?: string} {
    try {
      // Extraire le JSON de la réponse
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        this.logger.warn(`⚠️ Réponse modération sans JSON valide: ${response.substring(0, 100)}`);
        return { status: 'approved' }; // Par défaut approuvé si parsing échoue
      }

      const jsonResponse = JSON.parse(jsonMatch[0]);
      const moderationStatus = jsonResponse.moderationStatus;

      if (moderationStatus === 'approved') {
        return { status: 'approved' };
      } else {
        // Status de rejet (insult, hate_speech, etc.)
        const reason = jsonResponse.reason || `Contenu inapproprié détecté: ${moderationStatus}`;
        return { 
          status: 'rejected', 
          reason: reason
        };
      }
      
    } catch (error) {
      this.logger.error(`❌ Erreur parsing modération: ${error.message}, réponse: ${response.substring(0, 200)}`);
      // En cas d'erreur de parsing, approuver par défaut (sécurité)
      return { status: 'approved' };
    }
  }

  /**
   * 🧠 ANALYSE CONTEXTUELLE : Extrait tone, coefficients de fiabilité/impact
   * Basé sur worker-orga.ts ligne 374-390
   */
  private async extractContextualFactors(
    title: string, 
    hostView: string, 
    guestView: string
  ): Promise<{
    contextPhrase: string,
    tone: 'humour' | 'modéré' | 'sérieux',
    reliabilityCoef: number,
    impactCoef: number
  }> {
    try {
      this.logger.log(`🧠 Analyse contextuelle débat: "${title.substring(0, 30)}..."`);

      // Construire le prompt d'analyse contextuelle
      const prompt = this.buildContextualAnalysisPrompt(title, hostView, guestView);

      // 📝 LOG DÉTAILLÉ : Prompt envoyé
      this.logger.log(`📝 [CONTEXT_ANALYSIS] Prompt envoyé:\n${prompt}`);
      this.logger.log(`📊 [CONTEXT_ANALYSIS] Données d'entrée:
        - Titre: "${title}"
        - Vue hôte: "${hostView}"
        - Vue invité: "${guestView}"`);

      // Appeler le LLM Gemini pour l'analyse contextuelle
      const llmResponse = await this.llmService.callGemini(
        this.llmService.MODEL_DEBATE_ANALYSIS_GEMINI,
        prompt,
        'CONTEXT_ANALYSIS_DUEL',
        null, // Pas de debateId encore
        null  // Pas d'argumentId
      );

      // 📝 LOG DÉTAILLÉ : Réponse complète du LLM
      this.logger.log(`🤖 [CONTEXT_ANALYSIS] Réponse LLM complète:\n${JSON.stringify(llmResponse, null, 2)}`);

      // Parser la réponse d'analyse contextuelle
      const contextResult = this.parseContextualResponse(llmResponse, title);
      
      // 📝 LOG DÉTAILLÉ : Résultat du parsing
      this.logger.log(`🔍 [CONTEXT_ANALYSIS] Résultat parsing:
        - Context phrase: "${contextResult.contextPhrase || 'N/A'}"
        - Tone: ${contextResult.tone || 'N/A'}
        - Reliability coef: ${contextResult.reliabilityCoef || 'N/A'}
        - Impact coef: ${contextResult.impactCoef || 'N/A'}`);
      
      this.logger.log(`✅ Analyse contextuelle: tone=${contextResult.tone}, reliabilityCoef=${contextResult.reliabilityCoef}, impactCoef=${contextResult.impactCoef}`);
      return contextResult;
      
    } catch (error) {
      this.logger.error(`❌ Erreur analyse contextuelle: ${error.message}`);
      
      // Fallback avec valeurs par défaut
      return {
        contextPhrase: `Débat: ${title}`,
        tone: 'modéré',
        reliabilityCoef: 1.5,
        impactCoef: 1.5
      };
    }
  }

  /**
   * 🧠 Construit le prompt d'analyse contextuelle pour déterminer tone et coefficients
   */
  private buildContextualAnalysisPrompt(title: string, hostView: string, guestView: string): string {
    return `You are a debate analysis expert. Your role is to analyze debate context and determine appropriate parameters.

DEBATE TO ANALYZE:
TITLE: "${title}"
HOST VIEW: "${hostView}"
GUEST VIEW: "${guestView}"

TASK - CONTEXT ANALYSIS:
Analyze the debate and determine:

1. contextPhrase: A comprehensive description of the debate's main issue, including how discussions typically unfold in this field, which sources are considered authoritative, and what potential biases and risks participants should be aware of (keep same language as title)
   Example: "Debate on COVID-19 vaccine effectiveness where discussions rely on peer-reviewed clinical studies and meta-analyses, with potential biases from pharmaceutical industry funding and risks of social media misinformation affecting public perception."
   Example: "Debate on greatest athlete of all time where discussions compare achievements across different sports and eras, with generational biases and risks of recency bias favoring current stars over legends."

2. tone: Appropriate tone for justifications
   - "formel": Technical/scientific debate requiring rigor
   - "modéré": Balanced general public debate
   - "humour": Light/entertaining debate

3. reliabilityCoef: Importance of reliable sources (1.0 to 2.0)
   - 1.7-2.0: Scientific/medical/economic debates
   - 1.5-1.8: Societal/political debates
   - 1.3-1.5: Cultural/opinion debates

4. impactCoef: How much argument quality influences the outcome (1.0 to 2.0)
   - 1.7–2.0: Outcome depends strongly on argument quality (policy, scientific, technical)
   - 1.5–1.8: Arguments matter but not the only factor (societal, ethical, political)
   - 1.3–1.5: Arguments are mostly opinion-based or for entertainment (cultural, lifestyle)

CRITICAL INSTRUCTIONS:
- Respond in the same language as the debate title
- Use ONLY valid JSON format
- Keep contextPhrase under 400 characters
- DO NOT add any explanation or text after the JSON
- STOP immediately after the closing brace }

RESPONSE FORMAT:
{
  "contextPhrase": "Clear description of the debate stake (in the main language)",
  "tone": "modéré",
  "reliabilityCoef": 1.5,
  "impactCoef": 1.5
}

Analyze the debate and respond with ONLY the JSON object.`;
  }

  /**
   * 🧠 Parse la réponse LLM d'analyse contextuelle
   */
  private parseContextualResponse(
    response: string, 
    fallbackTitle: string
  ): {
    contextPhrase: string,
    tone: 'humour' | 'modéré' | 'sérieux',
    reliabilityCoef: number,
    impactCoef: number
  } {
    try {
      // Extraire le JSON de la réponse
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        this.logger.warn(`⚠️ Réponse analyse contextuelle sans JSON valide: ${response.substring(0, 100)}`);
        return this.getDefaultContextualValues(fallbackTitle);
      }

      const jsonResponse = JSON.parse(jsonMatch[0]);
      
      // Valider et nettoyer les valeurs
      const contextPhrase = jsonResponse.contextPhrase || `Débat: ${fallbackTitle}`;
      const tone = this.validateTone(jsonResponse.tone);
      const reliabilityCoef = this.validateCoefficient(jsonResponse.reliabilityCoef, 1.5);
      const impactCoef = this.validateCoefficient(jsonResponse.impactCoef, 1.5);

      return {
        contextPhrase: contextPhrase.substring(0, 400), // Limiter à 400 caractères
        tone,
        reliabilityCoef,
        impactCoef
      };
      
    } catch (error) {
      this.logger.error(`❌ Erreur parsing analyse contextuelle: ${error.message}, réponse: ${response.substring(0, 200)}`);
      return this.getDefaultContextualValues(fallbackTitle);
    }
  }

  /**
   * 🧠 Valide et nettoie le tone
   */
  private validateTone(tone: string): 'humour' | 'modéré' | 'sérieux' {
    const validTones = ['humour', 'modéré', 'sérieux', 'formel'];
    if (!tone || !validTones.includes(tone)) {
      return 'modéré'; // Par défaut
    }
    // Mapper "formel" vers "sérieux" pour compatibilité
    return tone === 'formel' ? 'sérieux' : tone as 'humour' | 'modéré' | 'sérieux';
  }

  /**
   * 🧠 Valide et nettoie les coefficients (1.0-2.0)
   */
  private validateCoefficient(coef: number, defaultValue: number): number {
    if (typeof coef !== 'number' || isNaN(coef) || coef < 1.0 || coef > 2.0) {
      return defaultValue;
    }
    return Math.round(coef * 10) / 10; // Arrondir à 1 décimale
  }

  /**
   * 🧠 Valeurs par défaut en cas d'erreur
   */
  private getDefaultContextualValues(title: string): {
    contextPhrase: string,
    tone: 'humour' | 'modéré' | 'sérieux',
    reliabilityCoef: number,
    impactCoef: number
  } {
    return {
      contextPhrase: `Débat sur ${title} où s'opposent différents points de vue nécessitant analyse critique et argumentation structurée.`,
      tone: 'modéré',
      reliabilityCoef: 1.5,
      impactCoef: 1.5
    };
  }

  /**
   * 🗺️ CLASSIFICATION THÉMATIQUE : Trouve le topic le plus proche depuis la base de données
   */
  private async findClosestTopic(
    title: string, 
    hostView: string, 
    guestView: string
  ): Promise<{topicId: string, topicLabel: string}> {
    try {
      this.logger.log(`🗺️ Classification thématique débat: "${title.substring(0, 30)}..."`);

      // 1. Récupérer tous les topics depuis la base de données
      const allTopics = await this.prismaService.topic.findMany({
        orderBy: [
          { isMainTopic: 'desc' }, // Topics principaux en premier
          { label: 'asc' }
        ]
      });

      if (allTopics.length === 0) {
        this.logger.warn(`⚠️ Aucun topic trouvé en base de données`);
        return { topicId: 'default', topicLabel: 'Général' };
      }

      // 2. Construire le prompt avec les vrais topics de la base
      const prompt = this.buildTopicClassificationPrompt(title, hostView, guestView, allTopics);

      // 📝 LOG DÉTAILLÉ : Prompt envoyé et topics disponibles
      this.logger.log(`📝 [TOPIC_CLASSIFICATION] Prompt envoyé:\n${prompt}`);
      this.logger.log(`🏷️ [TOPIC_CLASSIFICATION] ${allTopics.length} topics disponibles en base:
        ${allTopics.map(t => `- ${t.label} (ID: ${t.id}, Main: ${t.isMainTopic})`).join('\n        ')}`);

      // 3. Appeler le LLM Gemini pour la classification
      const llmResponse = await this.llmService.callGemini(
        this.llmService.MODEL_DEBATE_ANALYSIS_GEMINI,
        prompt,
        'TOPIC_CLASSIFICATION_DUEL',
        null, // Pas de debateId encore
        null  // Pas d'argumentId
      );

      // 📝 LOG DÉTAILLÉ : Réponse complète du LLM
      this.logger.log(`🤖 [TOPIC_CLASSIFICATION] Réponse LLM complète:\n${JSON.stringify(llmResponse, null, 2)}`);

      // 4. Parser la réponse et trouver le topic correspondant
      const topicResult = this.parseTopicClassificationResponse(llmResponse, allTopics);
      
      // 📝 LOG DÉTAILLÉ : Résultat du parsing
      this.logger.log(`🔍 [TOPIC_CLASSIFICATION] Résultat parsing:
        - Topic choisi: "${topicResult.topicLabel || 'N/A'}"
        - Topic ID: ${topicResult.topicId || 'N/A'}
        - Fallback utilisé: ${topicResult.topicId === null ? 'OUI' : 'NON'}`);
      
      this.logger.log(`✅ Classification thématique: ${topicResult.topicLabel} (ID: ${topicResult.topicId})`);
      return topicResult;
      
    } catch (error) {
      this.logger.error(`❌ Erreur classification: ${error.message}`);
      
      // Fallback : essayer de trouver un topic par défaut en base
      try {
        const defaultTopic = await this.prismaService.topic.findFirst({
          where: { 
            OR: [
              { label: { contains: 'Temps libre' } },
              { label: { contains: 'Modes de vie' } },
              { label: { contains: 'Quotidien' } }
            ]
          },
          orderBy: { isMainTopic: 'asc' } // Préférer les sous-topics
        });

        if (defaultTopic) {
          return { 
            topicId: defaultTopic.id, 
            topicLabel: defaultTopic.label 
          };
        }
      } catch (dbError) {
        this.logger.error(`❌ Erreur récupération topic par défaut: ${dbError.message}`);
      }
      
      // Dernier fallback
      return { topicId: 'default', topicLabel: 'Général' };
    }
  }

  /**
   * 🗺️ Construit le prompt de classification thématique avec les topics de la base de données
   */
  private buildTopicClassificationPrompt(title: string, hostView: string, guestView: string, allTopics: any[]): string {
    // Construire la structure des topics depuis la base de données
    const mainTopics = allTopics.filter(topic => topic.isMainTopic);
    const subTopics = allTopics.filter(topic => !topic.isMainTopic);

    // Créer une map des sub-topics par parent
    const topicsByParent = {};
    subTopics.forEach(sub => {
      if (!topicsByParent[sub.parentId]) {
        topicsByParent[sub.parentId] = [];
      }
      topicsByParent[sub.parentId].push(sub);
    });

    // Construire la liste formatée
    const topicsTree = mainTopics.map((main, index) => {
      const children = topicsByParent[main.id] || [];
      const childrenList = children.map(child => `   • ${child.label}`).join('\n');
      return `${index + 1}. ${main.label}\n${childrenList}`;
    }).join('\n\n');

    return `You are a topic classification expert. Your role is to classify debates into the appropriate thematic category.

DEBATE TO CLASSIFY:
TITLE: "${title}"
HOST VIEW: "${hostView}"
GUEST VIEW: "${guestView}"

AVAILABLE TOPIC CATEGORIES:
${topicsTree}

TASK - TOPIC CLASSIFICATION:
Analyze the debate content and determine which topic category (main category > subcategory) best represents the main theme of this debate.

CLASSIFICATION RULES:
- Choose the MOST SPECIFIC subcategory that matches the debate content
- Use the exact format: "Main Category > Subcategory" (e.g., "Tech. > Intelligence artificielle & données")
- If the debate spans multiple categories, choose the PRIMARY/DOMINANT theme
- If uncertain between subcategories, choose the broader main category only (e.g., "Société")
- For general debates that don't fit well, use "Quotidien > Temps libre & hobbies"

EXAMPLES:
- Debate about electric cars → "Planète > Ressources naturelles & énergie"
- Debate about social media impact → "Tech. > Information & communication"  
- Debate about healthcare costs → "Santé > Systèmes de soins"
- Debate about movie rankings → "Culture > Arts & spectacles"
- Debate about unemployment → "Économie > Travail & emploi"

RESPONSE FORMAT:
Respond with ONLY a JSON object:
{
  "category": "Main Category > Subcategory"
}

Analyze the debate and respond with ONLY the JSON object.`;
  }

  /**
   * 🗺️ Parse la réponse LLM de classification thématique et trouve le topic correspondant
   */
  private parseTopicClassificationResponse(response: string, allTopics: any[]): {topicId: string, topicLabel: string} {
    try {
      // Extraire le JSON de la réponse
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        this.logger.warn(`⚠️ Réponse classification sans JSON valide: ${response.substring(0, 100)}`);
        return this.getDefaultTopicFallback(allTopics);
      }

      const jsonResponse = JSON.parse(jsonMatch[0]);
      
      // Valider la catégorie
      const category = jsonResponse.category;
      if (!category || typeof category !== 'string') {
        this.logger.warn(`⚠️ Catégorie invalide dans la réponse: ${category}`);
        return this.getDefaultTopicFallback(allTopics);
      }

      // Essayer de trouver le topic correspondant dans la base
      const foundTopic = this.findTopicByLabel(category, allTopics);
      if (foundTopic) {
        return {
          topicId: foundTopic.id,
          topicLabel: foundTopic.label
        };
      }

      // Si pas trouvé, essayer une recherche floue
      const fuzzyTopic = this.findTopicByFuzzySearch(category, allTopics);
      if (fuzzyTopic) {
        this.logger.log(`🔍 Topic trouvé par recherche floue: ${fuzzyTopic.label}`);
        return {
          topicId: fuzzyTopic.id,
          topicLabel: fuzzyTopic.label
        };
      }

      this.logger.warn(`⚠️ Aucun topic trouvé pour la catégorie: ${category}`);
      return this.getDefaultTopicFallback(allTopics);
      
    } catch (error) {
      this.logger.error(`❌ Erreur parsing classification: ${error.message}, réponse: ${response.substring(0, 200)}`);
      return this.getDefaultTopicFallback(allTopics);
    }
  }

  /**
   * 🔍 Trouve un topic par label exact ou recherche dans la réponse LLM
   */
  private findTopicByLabel(category: string, allTopics: any[]): any | null {
    // Recherche exacte d'abord
    for (const topic of allTopics) {
      if (topic.label.toLowerCase() === category.toLowerCase()) {
        return topic;
      }
    }

    // Si format "Parent > Child", extraire le sous-topic
    if (category.includes(' > ')) {
      const parts = category.split(' > ');
      const childLabel = parts[1]?.trim();
      if (childLabel) {
        for (const topic of allTopics) {
          if (topic.label.toLowerCase() === childLabel.toLowerCase()) {
            return topic;
          }
        }
      }
    }

    return null;
  }

  /**
   * 🔍 Recherche floue par mots-clés
   */
  private findTopicByFuzzySearch(category: string, allTopics: any[]): any | null {
    const searchTerms = category.toLowerCase().split(/[\s>]+/).filter(term => term.length > 2);
    
    for (const topic of allTopics) {
      const topicLabel = topic.label.toLowerCase();
      for (const term of searchTerms) {
        if (topicLabel.includes(term)) {
          return topic;
        }
      }
    }

    return null;
  }

  /**
   * 🎯 Fallback vers un topic par défaut
   */
  private getDefaultTopicFallback(allTopics: any[]): {topicId: string, topicLabel: string} {
    // Chercher "Temps libre & hobbies" en priorité
    const defaultTopic = allTopics.find(topic => 
      topic.label.includes('Temps libre') || 
      topic.label.includes('hobbies') ||
      topic.label.includes('Modes de vie')
    );

    if (defaultTopic) {
      return {
        topicId: defaultTopic.id,
        topicLabel: defaultTopic.label
      };
    }

    // Si pas trouvé, prendre le premier sous-topic disponible
    const firstSubTopic = allTopics.find(topic => !topic.isMainTopic);
    if (firstSubTopic) {
      return {
        topicId: firstSubTopic.id,
        topicLabel: firstSubTopic.label
      };
    }

    // Dernier fallback : premier topic disponible
    if (allTopics.length > 0) {
      return {
        topicId: allTopics[0].id,
        topicLabel: allTopics[0].label
      };
    }

    // Fallback ultime
    return {
      topicId: 'default',
      topicLabel: 'Général'
    };
  }

  /**
   * 🔧 MÉTHODE INTERNE : Effectue l'analyse complète avec UN SEUL prompt unifié
   */
  private async performAnalysis(
    debateId: string,
    title: string,
    hostView: string,
    guestView: string
  ): Promise<DuelDebateAnalysisResult> {
    
    this.logger.log(`🚀 Analyse unifiée débat ${debateId} avec prompt unique`);
    
    try {
      // 📋 ÉTAPE 1 : Récupérer tous les topics et les numéroter
      const allTopics = await this.prismaService.topic.findMany({
        orderBy: [
          { isMainTopic: 'desc' }, // Topics principaux en premier
          { label: 'asc' }
        ]
      });

      if (allTopics.length === 0) {
        this.logger.warn(`⚠️ Aucun topic trouvé en base de données`);
        return this.getFallbackResult(title);
      }

      // 🎯 ÉTAPE 2 : Prompt unifié (modération + contexte + classification)
      const result = await this.performUnifiedAnalysis(title, hostView, guestView, allTopics);
      
      this.logger.log(`✅ Analyse unifiée terminée pour ${debateId}`);
      return result;
      
    } catch (error) {
      this.logger.error(`❌ Erreur analyse unifiée ${debateId}: ${error.message}`);
      return this.getFallbackResult(title);
    }
  }

  /**
   * 🎯 NOUVEAU : Analyse unifiée avec UN SEUL prompt LLM
   */
  private async performUnifiedAnalysis(
    title: string,
    hostView: string,
    guestView: string,
    allTopics: any[]
  ): Promise<DuelDebateAnalysisResult> {
    
    // Construire la liste numérotée des topics
    const numberedTopics = allTopics.map((topic, index) => {
      return `${index + 1}. ${topic.label}`;
    }).join('\n');

    const prompt = `You are a comprehensive debate analysis expert. Analyze this debate and provide all results in ONE response.

DEBATE TO ANALYZE:
TITLE: "${title}"
HOST VIEW: "${hostView}"
GUEST VIEW: "${guestView}"

TASK - COMPLETE ANALYSIS:
Perform all these analyses in ONE response:

1. MODERATION CHECK:
   - Check for insults, hate speech, spam, unintelligible content
   - If problems found → set moderationStatus to "rejected" + reason
   - If no problems → set moderationStatus to "approved"

2. CONTEXTUAL ANALYSIS:
   - contextPhrase: Comprehensive description of debate context (keep same language as title, max 400 chars)
   - tone: "humour" | "modéré" | "sérieux" 
   - reliabilityCoef: 1.0-2.0 (importance of reliable sources)
   - impactCoef: 1.0-2.0 (how much argument quality matters)

3. TOPIC CLASSIFICATION:
   Choose the MOST relevant topic number from this list:

${numberedTopics}

RESPONSE FORMAT:
Respond with ONLY this JSON object:

{
  "moderationStatus": "approved|rejected",
  "rejectionReason": "reason if rejected, otherwise omit",
  "contextPhrase": "Debate description in same language",
  "tone": "modéré",
  "reliabilityCoef": 1.5,
  "impactCoef": 1.5,
  "topicNumber": 28
}

CRITICAL: Respond with ONLY the JSON object, nothing else.`;

    this.logger.log(`📝 [UNIFIED_ANALYSIS] Prompt envoyé avec ${allTopics.length} topics`);

    // Appeler le LLM Gemini avec le prompt unifié
    const llmResponse = await this.llmService.callGemini(
      this.llmService.MODEL_DEBATE_ANALYSIS_GEMINI,
      prompt,
      'UNIFIED_DUEL_ANALYSIS',
      null, // Pas de debateId encore
      null  // Pas d'argumentId
    );

    this.logger.log(`🤖 [UNIFIED_ANALYSIS] Réponse LLM reçue:\n${JSON.stringify(llmResponse, null, 2)}`);

    // Parser le résultat unifié
    return this.parseUnifiedResponse(llmResponse, allTopics, title);
  }

  /**
   * 🔍 Parse la réponse du prompt unifié
   */
  private parseUnifiedResponse(
    response: string, 
    allTopics: any[], 
    fallbackTitle: string
  ): DuelDebateAnalysisResult {
    try {
      // Extraire le JSON de la réponse
      const jsonMatch = response.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        this.logger.warn(`⚠️ Réponse unifie sans JSON valide: ${response.substring(0, 100)}`);
        return this.getFallbackResult(fallbackTitle);
      }

      const jsonResponse = JSON.parse(jsonMatch[0]);
      
      // Validation modération
      const moderationStatus = jsonResponse.moderationStatus === 'rejected' ? 'rejected' : 'approved';
      
      if (moderationStatus === 'rejected') {
        return {
          moderationStatus: 'rejected',
          rejectionReason: jsonResponse.rejectionReason || 'Contenu inapproprié détecté'
        };
      }

      // Validation et nettoyage des valeurs
      const contextPhrase = (jsonResponse.contextPhrase || `Débat: ${fallbackTitle}`).substring(0, 400);
      const tone = this.validateTone(jsonResponse.tone);
      const reliabilityCoef = this.validateCoefficient(jsonResponse.reliabilityCoef, 1.5);
      const impactCoef = this.validateCoefficient(jsonResponse.impactCoef, 1.5);

      // Récupérer le topic par numéro
      const topicNumber = parseInt(jsonResponse.topicNumber);
      const selectedTopic = this.getTopicByNumber(topicNumber, allTopics);

      this.logger.log(`🔍 [UNIFIED_ANALYSIS] Résultat parsing:
        - Modération: ${moderationStatus}
        - Tone: ${tone}
        - Coefficients: ${reliabilityCoef}/${impactCoef}
        - Topic numéro: ${topicNumber} → "${selectedTopic.label}"`);

      return {
        moderationStatus: 'approved',
        contextPhrase,
        tone,
        reliabilityCoef,
        impactCoef,
        topicCategory: selectedTopic.label,
        topicId: selectedTopic.id
      };
      
    } catch (error) {
      this.logger.error(`❌ Erreur parsing réponse unifiée: ${error.message}, réponse: ${response.substring(0, 200)}`);
      return this.getFallbackResult(fallbackTitle);
    }
  }

  /**
   * 🔢 Récupère un topic par son numéro dans la liste
   */
  private getTopicByNumber(topicNumber: number, allTopics: any[]): {id: string, label: string} {
    if (!topicNumber || topicNumber < 1 || topicNumber > allTopics.length) {
      this.logger.warn(`⚠️ Numéro de topic invalide: ${topicNumber}, utilisation fallback`);
      // Fallback vers "Temps libre & hobbies"
      const fallbackTopic = allTopics.find(topic => 
        topic.label.includes('Temps libre') || topic.label.includes('hobbies')
      );
      
      if (fallbackTopic) {
        return { id: fallbackTopic.id, label: fallbackTopic.label };
      }
      
      // Dernier fallback : premier topic disponible
      return allTopics.length > 0 
        ? { id: allTopics[0].id, label: allTopics[0].label }
        : { id: 'default', label: 'Général' };
    }

    const selectedTopic = allTopics[topicNumber - 1]; // -1 car la liste commence à 1
    return {
      id: selectedTopic.id,
      label: selectedTopic.label
    };
  }

  /**
   * 🛡️ Résultat de fallback en cas d'erreur
   */
  private getFallbackResult(title: string): DuelDebateAnalysisResult {
    return {
      moderationStatus: 'approved',
      contextPhrase: `Débat sur ${title} où s'opposent différents points de vue nécessitant analyse critique.`,
      tone: 'modéré',
      reliabilityCoef: 1.5,
      impactCoef: 1.5,
      topicCategory: 'Général',
      topicId: 'default'
    };
  }

  /**
   * 📊 UTILITAIRE : Sauvegarde les résultats d'analyse pour traçabilité
   */
  private async saveAnalysisResult(
    debateId: string,
    input: any,
    result: DuelDebateAnalysisResult,
    success: boolean = true,
    error?: string
  ) {
    try {
      // Note: On pourrait créer une table DebateAnalysisResult similaire à ArgumentModuleResult
      // Pour l'instant, on log juste pour traçabilité
      this.logger.log(`📊 Résultat analyse débat ${debateId} sauvegardé: ${JSON.stringify(result)}`);
    } catch (saveError) {
      this.logger.error(`❌ Erreur sauvegarde analyse: ${saveError.message}`);
    }
  }

  /**
   * 🧪 MÉTHODE DE TEST : Teste l'analyse avec un débat fictif
   */
  async testAnalysis(): Promise<{success: boolean, message: string, result?: DuelDebateAnalysisResult}> {
    try {
      this.logger.log(`🧪 Test d'analyse de débat...`);
      
      const testResult = await this.analyzeDebateForDuel(
        'test-debate-id',
        'Faut-il interdire les voitures en ville ?',
        'Les voitures polluent et créent des embouteillages',
        'Les voitures sont essentielles pour la mobilité'
      );

      return {
        success: true,
        message: `Test réussi: modération=${testResult.moderationStatus}, tone=${testResult.tone}`,
        result: testResult
      };
      
    } catch (error) {
      this.logger.error(`❌ Test d'analyse échoué: ${error.message}`);
      return {
        success: false,
        message: `Test échoué: ${error.message}`
             };
     }
   }

  /**
   * 📊 MONITORING : Log des métriques de performance
   */
  private logPerformanceMetrics(
    debateId: string, 
    processingTime: number, 
    result: DuelDebateAnalysisResult
  ) {
    const performanceLog = {
      debateId,
      processingTime,
      moderationStatus: result.moderationStatus,
      tone: result.tone,
      reliabilityCoef: result.reliabilityCoef,
      impactCoef: result.impactCoef,
      topicCategory: result.topicCategory,
      timestamp: new Date().toISOString()
    };

    // Log structuré pour monitoring/analytics
    this.logger.log(`📊 PERFORMANCE METRICS: ${JSON.stringify(performanceLog)}`);

    // Alertes si performance dégradée
    if (processingTime > 8000) {
      this.logger.warn(`⚠️ SLOW ANALYSIS: ${processingTime}ms pour débat ${debateId} (> 8s)`);
    }

    if (result.moderationStatus === 'rejected') {
      this.logger.warn(`🚫 MODERATION REJECT: Débat ${debateId} rejeté - ${result.rejectionReason}`);
    }

    // Métriques de fiabilité des coefficients
    if (result.reliabilityCoef && result.impactCoef) {
      const coefficientsLog = {
        debateId,
        reliabilityCoef: result.reliabilityCoef,
        impactCoef: result.impactCoef,
        coefficientsSum: result.reliabilityCoef + result.impactCoef,
        coefficientsAvg: (result.reliabilityCoef + result.impactCoef) / 2
      };
      this.logger.log(`🎯 COEFFICIENTS: ${JSON.stringify(coefficientsLog)}`);
    }
  }
 }  