import { splitTextByRanges } from './short-syntax-ranges';

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

  // The segments are concatenated back into the overlay, so re-emitting the
  // overlapped text would lengthen the mirror and shift every later highlight.
  it('should skip an overlapping range instead of re-emitting its text', () => {
    const segments = splitTextByRanges('abcdefgh', [
      { start: 2, end: 6, type: 'tag' },
      { start: 4, end: 7, type: 'due' },
    ]);
    expect(segments.map((s) => s.text).join('')).toBe('abcdefgh');
    expect(segments).toEqual([
      { text: 'ab', type: null },
      { text: 'cdef', type: 'tag' },
      { text: 'gh', type: null },
    ]);
  });
});
