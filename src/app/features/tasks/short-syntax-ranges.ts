import { ShortSyntaxRange, ShortSyntaxTokenType } from './short-syntax';

export interface ShortSyntaxSegment {
  text: string;
  type: ShortSyntaxTokenType | null;
}

/**
 * Splits the raw input into contiguous segments for rendering: plain text
 * segments (type null) interleaved with highlighted token segments. Ranges
 * come straight from the parser's offset map (sorted, non-overlapping).
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
