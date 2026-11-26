import { Controller, Post, Body, Get, UseGuards, Logger } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { DuelDebateAnalysisService } from './duel-debate-analysis.service';

/**
 * Controller pour tester et débugger l'analyse des débats duel
 * Endpoints utiles pour le développement et monitoring
 */
@Controller('duel-debate-analysis')
export class DuelDebateAnalysisController {
  private readonly logger = new Logger(DuelDebateAnalysisController.name);

  constructor(
    private readonly duelDebateAnalysisService: DuelDebateAnalysisService
  ) {}

  /**
   * 🧪 TEST : Teste l'analyse complète avec un débat fictif
   * GET /duel-debate-analysis/test
   */
  @Get('test')
  async testAnalysis() {
    return await this.duelDebateAnalysisService.testAnalysis();
  }

  /**
   * 🚀 NOUVEAU TEST : Teste le prompt unifié avec données courtes
   * GET /duel-debate-analysis/test-unified
   */
  @Get('test-unified')
  async testUnifiedAnalysis() {
    try {
      this.logger.log(`🚀 Test du prompt unifié avec données courtes`);
      
      const result = await this.duelDebateAnalysisService.analyzeDebateForDuel(
        'test-unified-id',
        'L\'IA va-t-elle remplacer les enseignants ?',
        'Les IA vont remplacer les enseignants',
        'Les humains restent irremplaçables pour enseigner'
      );

      return {
        success: true,
        message: `Test unifié réussi: modération=${result.moderationStatus}, tone=${result.tone}`,
        result: result,
        testType: 'UNIFIED_PROMPT',
        inputData: {
          title: 'L\'IA va-t-elle remplacer les enseignants ?',
          hostView: 'Les IA vont remplacer les enseignants',
          guestView: 'Les humains restent irremplaçables pour enseigner'
        }
      };
      
    } catch (error) {
      this.logger.error(`❌ Test unifié échoué: ${error.message}`);
      return {
        success: false,
        message: `Test unifié échoué: ${error.message}`,
        testType: 'UNIFIED_PROMPT'
      };
    }
  }

  /**
   * 🔍 DEBUG : Analyse un débat spécifique pour debug
   * POST /duel-debate-analysis/debug
   */
  @Post('debug')
  @UseGuards(AuthGuard('jwt'))
  async debugAnalysis(@Body() data: {
    title: string;
    hostView: string;
    guestView: string;
    timeout?: number;
  }) {
    const { title, hostView, guestView, timeout = 10000 } = data;
    
    if (!title || !hostView || !guestView) {
      return {
        success: false,
        error: 'title, hostView, et guestView sont requis'
      };
    }

    try {
      const startTime = Date.now();
      
      const result = await this.duelDebateAnalysisService.analyzeDebateForDuel(
        'debug-debate-id',
        title,
        hostView,
        guestView
      );

      const processingTime = Date.now() - startTime;

      return {
        success: true,
        processingTime,
        input: { title, hostView, guestView, timeout },
        result
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        input: { title, hostView, guestView, timeout }
      };
    }
  }

  /**
   * 🗺️ TEST TOPICS : Teste la classification thématique avec les vrais topics de la base
   * GET /duel-debate-analysis/test-topics
   */
  @Get('test-topics')
  async testTopicsClassification() {
    try {
      // Tester avec quelques exemples
      const testCases = [
        {
          title: "L'intelligence artificielle va-t-elle remplacer les humains ?",
          hostView: "L'IA va créer plus d'emplois qu'elle n'en détruira",
          guestView: "L'IA va éliminer de nombreux emplois"
        },
        {
          title: "Faut-il interdire les SUV en ville ?",
          hostView: "Les SUV polluent trop et sont dangereux",
          guestView: "Les SUV offrent sécurité et confort aux familles"
        },
        {
          title: "Netflix est-il meilleur que Disney+ ?",
          hostView: "Netflix a plus de contenu original",
          guestView: "Disney+ a des franchises iconiques"
        }
      ];

      const results = [];
      
      for (const testCase of testCases) {
        try {
          const result = await this.duelDebateAnalysisService.analyzeDebateForDuel(
            `test-topics-${Date.now()}`,
            testCase.title,
            testCase.hostView,
            testCase.guestView
          );

          results.push({
            input: testCase,
            output: {
              moderationStatus: result.moderationStatus,
              tone: result.tone,
              topicCategory: result.topicCategory,
              topicId: result.topicId,
              reliabilityCoef: result.reliabilityCoef,
              impactCoef: result.impactCoef
            }
          });
        } catch (error) {
          results.push({
            input: testCase,
            error: error.message
          });
        }
      }

      return {
        success: true,
        testCases: results.length,
        results
      };
      
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 📊 STATS : Informations sur le service d'analyse
   * GET /duel-debate-analysis/stats
   */
  @Get('stats')
  async getStats() {
    return {
      service: 'DuelDebateAnalysisService',
      version: '1.0.0',
      features: [
        'Modération automatique (insults, spam, hate speech)',
        'Analyse contextuelle (tone, coefficients)',
        'Classification thématique (TOPICS_TREE)',
        'Gestion timeout (10s par défaut)',
        'Fallbacks gracieux'
      ],
             endpoints: {
         test: 'GET /duel-debate-analysis/test',
         debug: 'POST /duel-debate-analysis/debug',
         testTopics: 'GET /duel-debate-analysis/test-topics',
         stats: 'GET /duel-debate-analysis/stats'
       },
      configuration: {
        defaultTimeout: '10000ms',
        defaultReliabilityCoef: 1.5,
        defaultImpactCoef: 1.5,
        defaultTone: 'modéré'
      }
    };
  }
} 