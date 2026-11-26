/**
 * Text normalizer for leetspeak and obfuscation detection
 * Converts common character substitutions back to regular letters
 */

/**
 * Character substitution map for leetspeak normalization
 * Maps leetspeak characters to their alphabetic equivalents
 */
const LEETSPEAK_MAP: Record<string, string> = {
  // Numbers to letters
  '0': 'o',
  '1': 'i',
  '2': 'z',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '6': 'g',
  '7': 't',
  '8': 'b',
  '9': 'g',

  // Special characters to letters
  '@': 'a',
  '$': 's',
  '!': 'i',
  '|': 'i',
  '+': 't',
  '€': 'e',
  '£': 'l',
  '¥': 'y',
  '©': 'c',
  '®': 'r',

  // Common substitutions
  '(': 'c',
  ')': 'd',
  '[': 'c',
  ']': 'd',
  '{': 'c',
  '}': 'd',
  '<': 'c',
  '>': 'd',
  '/': 'l',
  '\\': 'l',
  '†': 't',
  '‡': 't',
  '×': 'x',
  '÷': 'd',

  // Cyrillic lookalikes (often used to bypass filters)
  'а': 'a', // Cyrillic а
  'с': 'c', // Cyrillic с
  'е': 'e', // Cyrillic е
  'о': 'o', // Cyrillic о
  'р': 'p', // Cyrillic р
  'х': 'x', // Cyrillic х
  'у': 'y', // Cyrillic у

  // Accented characters
  'á': 'a',
  'à': 'a',
  'â': 'a',
  'ä': 'a',
  'ã': 'a',
  'å': 'a',
  'æ': 'ae',
  'ç': 'c',
  'é': 'e',
  'è': 'e',
  'ê': 'e',
  'ë': 'e',
  'í': 'i',
  'ì': 'i',
  'î': 'i',
  'ï': 'i',
  'ñ': 'n',
  'ó': 'o',
  'ò': 'o',
  'ô': 'o',
  'ö': 'o',
  'õ': 'o',
  'ø': 'o',
  'œ': 'oe',
  'ú': 'u',
  'ù': 'u',
  'û': 'u',
  'ü': 'u',
  'ý': 'y',
  'ÿ': 'y',

  // Asterisks and censorship bypasses
  '*': '',
  '#': '',
  '_': '',
  '.': '',
  '-': '',
};

/**
 * Common word obfuscations that should be normalized
 * Maps obfuscated patterns to their normalized forms
 */
const OBFUSCATION_PATTERNS: Array<{ pattern: RegExp; replacement: string }> = [
  // "ph" → "f" (phuck → fuck)
  { pattern: /ph/gi, replacement: 'f' },
  // Double letters reduction (fuuuck → fuck)
  { pattern: /(.)\1{2,}/gi, replacement: '$1$1' },
  // "ck" variations (fuk → fuck)
  { pattern: /\b(fu)k\b/gi, replacement: '$1ck' },
  // "kk" → "ck"
  { pattern: /kk/gi, replacement: 'ck' },
  // "z" at end → "s" in some cases
  { pattern: /(\w)z\b/gi, replacement: '$1s' },
];

/**
 * Normalizes text by converting leetspeak and removing obfuscations
 * @param text - Input text to normalize
 * @returns Normalized text in lowercase
 */
export function normalizeText(text: string): string {
  if (!text) return '';

  let normalized = text.toLowerCase();

  // Step 1: Replace leetspeak characters
  normalized = normalized
    .split('')
    .map((char) => LEETSPEAK_MAP[char] || char)
    .join('');

  // Step 2: Apply obfuscation pattern replacements
  for (const { pattern, replacement } of OBFUSCATION_PATTERNS) {
    normalized = normalized.replace(pattern, replacement);
  }

  // Step 3: Remove remaining special characters (keep only alphanumeric and spaces)
  normalized = normalized.replace(/[^a-z0-9\s]/g, '');

  // Step 4: Collapse multiple spaces into one
  normalized = normalized.replace(/\s+/g, ' ').trim();

  return normalized;
}

/**
 * Extracts words from text, preserving compound words
 * @param text - Input text
 * @returns Array of words
 */
export function extractWords(text: string): string[] {
  if (!text) return [];

  const normalized = normalizeText(text);

  // Split by spaces and filter empty strings
  return normalized.split(' ').filter((word) => word.length > 0);
}

/**
 * Creates a "cleaned" version of text for pattern matching
 * Removes all non-alphanumeric characters and spaces
 * @param text - Input text
 * @returns Cleaned text without spaces or special chars
 */
export function createCleanedText(text: string): string {
  if (!text) return '';

  return normalizeText(text).replace(/\s/g, '');
}
