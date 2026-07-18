import { mapShortSyntaxTokensToRanges, splitTextByRanges } from './short-syntax-ranges';

describe('mapShortSyntaxTokensToRanges', () => {
  it('should locate a single token', () => {
    const ranges = mapShortSyntaxTokensToRanges('Water plants @every friday', [
      { type: 'due', text: '@every friday' },
    ]);
    expect(ranges).toEqual([{ start: 13, end: 26, type: 'due' }]);
  });

  it('should locate multiple tokens of different types', () => {
    const raw = 'Fix bug #urgent +work 30m @friday';
    const ranges = mapShortSyntaxTokensToRanges(raw, [
      { type: 'estimate', text: '30m' },
      { type: 'due', text: '@friday' },
      { type: 'project', text: '+work' },
      { type: 'tag', text: '#urgent' },
    ]);
    expect(ranges.map((r) => raw.slice(r.start, r.end))).toEqual([
      '#urgent',
      '+work',
      '30m',
      '@friday',
    ]);
    expect(ranges.map((r) => r.type)).toEqual(['tag', 'project', 'estimate', 'due']);
  });

  it('should claim distinct positions for duplicate token texts', () => {
    const raw = 'A #x #x';
    const ranges = mapShortSyntaxTokensToRanges(raw, [
      { type: 'tag', text: '#x' },
      { type: 'tag', text: '#x' },
    ]);
    expect(ranges).toEqual([
      { start: 2, end: 4, type: 'tag' },
      { start: 5, end: 7, type: 'tag' },
    ]);
  });

  it('should skip tokens not present in the raw text', () => {
    const ranges = mapShortSyntaxTokensToRanges('Some task', [
      { type: 'due', text: '@friday' },
    ]);
    expect(ranges).toEqual([]);
  });

  it('should skip empty token texts', () => {
    expect(mapShortSyntaxTokensToRanges('abc', [{ type: 'tag', text: '' }])).toEqual([]);
  });

  it('should not claim a position inside an already-claimed range', () => {
    // '30m' also occurs inside the due token '@friday 30m'? Construct overlap:
    const raw = 'T @every friday friday';
    const ranges = mapShortSyntaxTokensToRanges(raw, [
      { type: 'due', text: '@every friday' },
      { type: 'tag', text: 'friday' },
    ]);
    expect(ranges).toEqual([
      { start: 2, end: 15, type: 'due' },
      { start: 16, end: 22, type: 'tag' },
    ]);
  });

  it('should return ranges sorted by start position', () => {
    const raw = '#a mid +b';
    const ranges = mapShortSyntaxTokensToRanges(raw, [
      { type: 'project', text: '+b' },
      { type: 'tag', text: '#a' },
    ]);
    expect(ranges.map((r) => r.start)).toEqual([0, 7]);
  });
});

describe('splitTextByRanges', () => {
  it('should interleave plain and highlighted segments', () => {
    const raw = 'Water plants @every friday now';
    const segments = splitTextByRanges(raw, [{ start: 13, end: 26, type: 'due' }]);
    expect(segments).toEqual([
      { text: 'Water plants ', type: null },
      { text: '@every friday', type: 'due' },
      { text: ' now', type: null },
    ]);
  });

  it('should handle a range at the very start and end', () => {
    const raw = '#a b #c';
    const segments = splitTextByRanges(raw, [
      { start: 0, end: 2, type: 'tag' },
      { start: 5, end: 7, type: 'tag' },
    ]);
    expect(segments).toEqual([
      { text: '#a', type: 'tag' },
      { text: ' b ', type: null },
      { text: '#c', type: 'tag' },
    ]);
  });

  it('should return one plain segment when there are no ranges', () => {
    expect(splitTextByRanges('abc', [])).toEqual([{ text: 'abc', type: null }]);
  });

  it('should return no segments for empty text', () => {
    expect(splitTextByRanges('', [])).toEqual([]);
  });
});
