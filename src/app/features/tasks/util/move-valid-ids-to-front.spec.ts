import { moveValidIdsToFront } from './move-valid-ids-to-front';

describe('moveValidIdsToFront', () => {
  it('moves all ids to the front when all are valid, preserving relative order', () => {
    const result = moveValidIdsToFront(
      ['t1', 't2', 't3', 't4'],
      ['t2', 't4'],
      () => true,
    );

    expect(result.ids).toEqual(['t2', 't4', 't1', 't3']);
    expect(result.invalidCount).toBe(0);
  });

  it('filters out invalid ids and only moves the valid ones', () => {
    const isValid = (id: string): boolean => id !== 'nonexistent';
    const result = moveValidIdsToFront(
      ['t1', 't2', 't3', 't4'],
      ['t2', 'nonexistent', 't4'],
      isValid,
    );

    expect(result.ids).toEqual(['t2', 't4', 't1', 't3']);
    expect(result.invalidCount).toBe(1);
  });

  it('reports every id invalid and leaves order unchanged when none are valid', () => {
    const result = moveValidIdsToFront(
      ['t1', 't2'],
      ['nonexistent1', 'nonexistent2'],
      () => false,
    );

    expect(result.ids).toEqual(['t1', 't2']);
    expect(result.invalidCount).toBe(2);
  });
});
