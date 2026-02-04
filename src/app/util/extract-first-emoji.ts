/**
 * Emoji extraction and validation using Intl.Segmenter for correct
 * handling of compound emojis (ZWJ sequences, flags, keycaps).
 */

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/**
 * Maximum UTF-16 code unit length for a single emoji grapheme.
 * Longest real emoji (family with skin tones) is ~25 code units.
 * Guards against abusive ZWJ chains.
 */
const MAX_EMOJI_LENGTH = 30;

/**
 * Checks if a code point is within emoji ranges.
 */
const isEmojiCodePoint = (codePoint: number): boolean => {
  return (
    (codePoint >= 0x1f600 && codePoint <= 0x1f64f) || // Emoticons
    (codePoint >= 0x1f300 && codePoint <= 0x1f5ff) || // Misc Symbols and Pictographs
    (codePoint >= 0x1f680 && codePoint <= 0x1f6ff) || // Transport and Map Symbols
    (codePoint >= 0x1f1e0 && codePoint <= 0x1f1ff) || // Regional Indicator Symbols
    (codePoint >= 0x2600 && codePoint <= 0x26ff) || // Misc symbols
    (codePoint >= 0x2700 && codePoint <= 0x27bf) || // Dingbats
    (codePoint >= 0x2b00 && codePoint <= 0x2bff) || // Misc Symbols and Arrows (includes ⭐)
    (codePoint >= 0x1f900 && codePoint <= 0x1f9ff) || // Supplemental Symbols and Pictographs
    (codePoint >= 0x1f018 && codePoint <= 0x1f0ff) || // Some additional ranges
    (codePoint >= 0x1f200 && codePoint <= 0x1f2ff) || // Enclosed Ideographic Supplement
    (codePoint >= 0x1fa70 && codePoint <= 0x1faff) || // Symbols and Pictographs Extended-A
    codePoint === 0x1f004 || // Mahjong Tile Red Dragon
    codePoint === 0x1f0cf || // Playing Card Black Joker
    (codePoint >= 0x1f170 && codePoint <= 0x1f251) // Enclosed Alphanumeric Supplement
  );
};

/**
 * Checks if a grapheme segment represents an emoji.
 * Scans all code points for emoji code points, variation selectors (0xFE0F),
 * or keycap marks (0x20E3). Keycap emojis start with ASCII (e.g. #️⃣),
 * so we can't just check the first code point.
 */
const isEmojiGrapheme = (segment: string): boolean => {
  if (segment.length > MAX_EMOJI_LENGTH) {
    return false;
  }

  let i = 0;
  while (i < segment.length) {
    const codePoint = segment.codePointAt(i)!;
    if (
      isEmojiCodePoint(codePoint) ||
      codePoint === 0xfe0f || // Variation selector
      codePoint === 0x20e3 // Combining enclosing keycap
    ) {
      return true;
    }
    i += codePoint > 0xffff ? 2 : 1;
  }
  return false;
};

/**
 * Extracts the first emoji from a string.
 * Correctly handles compound emojis (ZWJ sequences, flags, keycaps).
 *
 * @param str - The string to extract emoji from
 * @returns The first emoji found, or empty string if none found
 */
export const extractFirstEmoji = (str: string): string => {
  if (!str || typeof str !== 'string') {
    return '';
  }

  const trimmed = str.trim();
  if (trimmed.length === 0) {
    return '';
  }

  for (const { segment } of segmenter.segment(trimmed)) {
    if (isEmojiGrapheme(segment)) {
      return segment;
    }
  }

  return '';
};

/**
 * Checks if a string contains exactly one emoji (with possible modifiers).
 *
 * @param str - The string to check
 * @returns true if the string is a single emoji, false otherwise
 */
export const isSingleEmoji = (str: string): boolean => {
  if (!str || typeof str !== 'string') {
    return false;
  }

  const trimmed = str.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const segments = Array.from(segmenter.segment(trimmed));
  return segments.length === 1 && isEmojiGrapheme(segments[0].segment);
};

/**
 * Fast check if a string contains any emoji.
 *
 * @param str - The string to check
 * @returns true if the string contains at least one emoji, false otherwise
 */
export const containsEmoji = (str: string): boolean => {
  if (!str || typeof str !== 'string') {
    return false;
  }

  const trimmed = str.trim();
  if (trimmed.length === 0) {
    return false;
  }

  for (const { segment } of segmenter.segment(trimmed)) {
    if (isEmojiGrapheme(segment)) {
      return true;
    }
  }

  return false;
};
