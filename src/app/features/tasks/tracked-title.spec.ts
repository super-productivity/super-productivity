import { TrackedTitle } from './tracked-title';

describe('TrackedTitle', () => {
  it('should start as the identity mapping', () => {
    const t = new TrackedTitle('abc');
    expect(t.text).toBe('abc');
    expect(t.rawRanges(0, 3)).toEqual([{ start: 0, end: 3 }]);
  });

  it('should map working positions to raw positions after a removal', () => {
    const t = new TrackedTitle('Call Bob @tomorrow 1h evening');
    t.remove(18, 21); // ' 1h'
    expect(t.text).toBe('Call Bob @tomorrow evening');
    // '@tomorrow evening' in the working title spans two raw runs around the
    // removed ' 1h' (the run edges are whitespace-trimmed)
    expect(t.rawRanges(9, 26)).toEqual([
      { start: 9, end: 18 },
      { start: 22, end: 29 },
    ]);
  });

  it('should trim whitespace at range edges and drop whitespace-only runs', () => {
    const t = new TrackedTitle('a  b');
    expect(t.rawRanges(0, 4)).toEqual([{ start: 0, end: 4 }]);
    expect(t.rawRanges(1, 3)).toEqual([]);
    expect(t.rawRanges(0, 3)).toEqual([{ start: 0, end: 1 }]);
  });

  it('should support successive removals', () => {
    const t = new TrackedTitle('one two three');
    t.remove(3, 7); // ' two'
    expect(t.text).toBe('one three');
    expect(t.rawRanges(4, 9)).toEqual([{ start: 8, end: 13 }]);
    t.remove(0, 3); // 'one'
    expect(t.text).toBe(' three');
    expect(t.rawRanges(1, 6)).toEqual([{ start: 8, end: 13 }]);
  });

  it('should trim the working title while keeping offsets', () => {
    const t = new TrackedTitle('  task  ');
    t.trim();
    expect(t.text).toBe('task');
    expect(t.rawRanges(0, 4)).toEqual([{ start: 2, end: 6 }]);
  });

  it('should collapse whitespace like .trim().replace(/\\s+/g, " ")', () => {
    const t = new TrackedTitle(' a \t  b  ');
    t.collapseWhitespace();
    expect(t.text).toBe('a b');
    expect(t.rawRanges(0, 3)).toEqual([
      { start: 1, end: 2 },
      { start: 6, end: 7 },
    ]);
  });

  it('should keep positions exact for a partial (markdown-style) removal', () => {
    const t = new TrackedTitle('see [docs](https://ex.com) now');
    // '[docs](url)' → 'docs': drop '](https://ex.com)' then '['
    t.remove(9, 26);
    t.remove(4, 5);
    expect(t.text).toBe('see docs now');
    expect(t.rawRanges(4, 8)).toEqual([{ start: 5, end: 9 }]);
    expect(t.rawRanges(9, 12)).toEqual([{ start: 27, end: 30 }]);
  });
});
