import { unique } from './unique';

describe('unique', () => {
  it('should keep the first occurrence and its order', () => {
    expect(unique(['b', 'a', 'b', 'c', 'a'])).toEqual(['b', 'a', 'c']);
  });

  it('should return a new array and leave the input untouched', () => {
    const input = ['a', 'a'];
    Object.freeze(input);

    const result = unique(input);

    expect(result).not.toBe(input);
    expect(input).toEqual(['a', 'a']);
  });

  it('should handle empty arrays and single entries', () => {
    expect(unique([])).toEqual([]);
    expect(unique(['only'])).toEqual(['only']);
  });

  it('should deduplicate by reference, not by structural equality', () => {
    const shared = { id: 'a' };

    expect(unique([shared, { id: 'a' }, shared])).toEqual([shared, { id: 'a' }]);
  });

  it('should treat -0 and +0 as the same value', () => {
    expect(unique([0, -0])).toEqual([0]);
  });

  it('should deduplicate NaN', () => {
    // Differs from the previous indexOf-based implementation, which kept both.
    // Documented because no caller passes numbers; see unique.ts.
    expect(unique([NaN, NaN]).length).toBe(1);
  });
});
