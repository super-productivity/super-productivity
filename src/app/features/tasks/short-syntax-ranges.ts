import { ShortSyntaxToken, ShortSyntaxTokenType } from './short-syntax';

export interface ShortSyntaxRange {
  start: number;
  end: number;
  type: ShortSyntaxTokenType;
}

/**
 * Resolves the substrings consumed by the short-syntax parser to positions in
 * the raw input, for highlighting. The parser strips tokens from a working
 * copy stage by stage, so tokens carry only their text; each still appears
 * verbatim in the raw input. Tokens that cannot be located (or only overlap
 * an already-claimed range) are skipped — a missing highlight is harmless,
 * a wrong one is not.
 */
export const mapShortSyntaxTokensToRanges = (
  rawText: string,
  tokens: ShortSyntaxToken[],
): ShortSyntaxRange[] => {
  const claimed: ShortSyntaxRange[] = [];

  for (const token of tokens) {
    if (!token.text) {
      continue;
    }
    let searchFrom = 0;
    while (searchFrom <= rawText.length) {
      const idx = rawText.indexOf(token.text, searchFrom);
      if (idx === -1) {
        break;
      }
      const end = idx + token.text.length;
      const overlaps = claimed.some((r) => idx < r.end && end > r.start);
      if (!overlaps) {
        claimed.push({ start: idx, end, type: token.type });
        break;
      }
      searchFrom = idx + 1;
    }
  }

  return claimed.sort((a, b) => a.start - b.start);
};

export interface ShortSyntaxSegment {
  text: string;
  type: ShortSyntaxTokenType | null;
}

/**
 * Splits the raw input into contiguous segments for rendering: plain text
 * segments (type null) interleaved with highlighted token segments.
 */
export const splitTextByRanges = (
  rawText: string,
  ranges: ShortSyntaxRange[],
): ShortSyntaxSegment[] => {
  const segments: ShortSyntaxSegment[] = [];
  let pos = 0;
  for (const range of ranges) {
    if (range.start > pos) {
      segments.push({ text: rawText.slice(pos, range.start), type: null });
    }
    segments.push({ text: rawText.slice(range.start, range.end), type: range.type });
    pos = range.end;
  }
  if (pos < rawText.length) {
    segments.push({ text: rawText.slice(pos), type: null });
  }
  return segments;
};
