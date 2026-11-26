/**
 * DTO for bot argument generation via n8n webhook
 *
 * This is used by BotPlayerService to generate arguments for AI bots
 * when playing against real users.
 */

/**
 * Request payload sent to n8n for bot argument generation
 */
export interface BotArgumentRequestDto {
  // Debate context
  debateId: string;
  debateTitle: string;
  language: 'fr' | 'en';

  // Bot info
  botId: string;
  botUsername: string;
  botElo: number;
  botSkillLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert';
  botPosition: string;       // The viewpoint the bot is defending

  // Opponent info
  opponentUsername: string;
  opponentElo: number;

  // Current debate state
  turnNumber: number;
  isLive: boolean;           // Live vs async debate

  // Final phase context (opponent's timer expired, bot plays solo)
  isOpponentTimerExpired?: boolean;   // true when opponent ran out of time
  finalPhaseArgumentCount?: number;   // how many args bot has sent since opponent expired

  // Conversation history (to avoid repetition)
  previousArguments: BotArgumentHistoryItem[];

  // Last opponent argument (what we're responding to)
  opponentLastArgument: string;

  // n8n analysis data (from M0)
  n8nNature?: string;
  n8nBurden?: string;
  n8nComplexity?: string;
  n8nDimensions?: string[];

  // Instructions for generating the argument
  instructions: BotArgumentInstructions;
}

/**
 * Item in the conversation history
 */
export interface BotArgumentHistoryItem {
  role: 'bot' | 'opponent';
  text: string;
  summary?: string;           // n8nArgumentSummary if available
  turnIndex: number;
}

/**
 * Instructions for generating the bot argument
 * These define the personality and quality of the response
 */
export interface BotArgumentInstructions {
  // Quality modifiers based on skill level
  shouldMakeMistakes: boolean;      // true for beginner/intermediate
  mistakeTypes?: string[];          // e.g., ['logical_fallacy', 'weak_evidence', 'off_topic']
  mistakeProbability?: number;      // 0-1, chance of making a mistake

  // Style instructions
  responseLength: 'short' | 'medium' | 'long';
  argumentStyle: 'aggressive' | 'defensive' | 'balanced' | 'emotional';
  useStatistics: boolean;           // Should cite statistics (more for expert)
  useSources: boolean;              // Should mention sources (more for expert)
  useEmoji: boolean;                // Lower skill = occasional emoji

  // Engagement instructions
  shouldAcknowledgeOpponent: boolean;  // Steelman, reality_check
  shouldAskQuestions: boolean;         // Engage opponent
  shouldUseHumor: boolean;             // Occasional wit
}

/**
 * Response from n8n with the generated argument
 */
export interface BotArgumentResponseDto {
  // The generated argument text
  generatedArgument: string;

  // Metadata about the generation
  estimatedQuality: number;          // 0-10, self-assessment
  usedStrategy: string;              // e.g., 'counter_argument', 'new_evidence', 'emotional_appeal'
  intentionalMistakes?: string[];    // List of intentional mistakes made (for logging)

  // Debug info
  processingTimeMs?: number;
}

/**
 * Helper function to build instructions based on bot skill level
 */
export function buildBotInstructions(
  skillLevel: 'beginner' | 'intermediate' | 'advanced' | 'expert',
  botElo: number,
): BotArgumentInstructions {
  switch (skillLevel) {
    case 'beginner':
      return {
        shouldMakeMistakes: true,
        mistakeTypes: ['logical_fallacy', 'weak_evidence', 'off_topic', 'personal_opinion', 'emotional_argument'],
        mistakeProbability: 0.6, // 60% chance of making a mistake
        responseLength: 'short',
        argumentStyle: 'emotional',
        useStatistics: false,
        useSources: false,
        useEmoji: true,
        shouldAcknowledgeOpponent: false,
        shouldAskQuestions: false,
        shouldUseHumor: false,
      };

    case 'intermediate':
      return {
        shouldMakeMistakes: true,
        mistakeTypes: ['weak_evidence', 'slight_off_topic', 'incomplete_reasoning'],
        mistakeProbability: 0.35, // 35% chance
        responseLength: 'medium',
        argumentStyle: 'balanced',
        useStatistics: false,
        useSources: false,
        useEmoji: false,
        shouldAcknowledgeOpponent: true,
        shouldAskQuestions: true,
        shouldUseHumor: false,
      };

    case 'advanced':
      return {
        shouldMakeMistakes: true,
        mistakeTypes: ['minor_logical_gap', 'cherry_picking'],
        mistakeProbability: 0.15, // 15% chance
        responseLength: 'medium',
        argumentStyle: 'balanced',
        useStatistics: true,
        useSources: true,
        useEmoji: false,
        shouldAcknowledgeOpponent: true,
        shouldAskQuestions: true,
        shouldUseHumor: true,
      };

    case 'expert':
      return {
        shouldMakeMistakes: false,
        mistakeTypes: [],
        mistakeProbability: 0.05, // 5% chance (very rare)
        responseLength: 'long',
        argumentStyle: 'balanced',
        useStatistics: true,
        useSources: true,
        useEmoji: false,
        shouldAcknowledgeOpponent: true,
        shouldAskQuestions: true,
        shouldUseHumor: true,
      };
  }
}
