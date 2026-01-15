import {
  getAnchorFromDragDrop,
  moveItemAfterAnchor,
  moveItemInList,
} from './work-context-meta.helper';

describe('moveItemAfterAnchor()', () => {
  it('should move item to start when afterItemId is null', () => {
    const result = moveItemAfterAnchor('x', null, ['A', 'B', 'x', 'C']);
    expect(result).toEqual(['x', 'A', 'B', 'C']);
  });

  it('should move item after the specified anchor', () => {
    const result = moveItemAfterAnchor('x', 'A', ['x', 'A', 'B', 'C']);
    expect(result).toEqual(['A', 'x', 'B', 'C']);
  });

  it('should move item after anchor when item is currently at start', () => {
    const result = moveItemAfterAnchor('x', 'B', ['x', 'A', 'B', 'C']);
    expect(result).toEqual(['A', 'B', 'x', 'C']);
  });

  it('should move item to end if anchor is last', () => {
    const result = moveItemAfterAnchor('x', 'C', ['A', 'x', 'B', 'C']);
    expect(result).toEqual(['A', 'B', 'C', 'x']);
  });

  it('should handle anchor not found by appending to end', () => {
    const result = moveItemAfterAnchor('x', 'missing', ['A', 'x', 'B', 'C']);
    expect(result).toEqual(['A', 'B', 'C', 'x']);
  });

  it('should handle item not in list (add after anchor)', () => {
    const result = moveItemAfterAnchor('x', 'A', ['A', 'B', 'C']);
    expect(result).toEqual(['A', 'x', 'B', 'C']);
  });

  it('should handle item not in list with null anchor (add to start)', () => {
    const result = moveItemAfterAnchor('x', null, ['A', 'B', 'C']);
    expect(result).toEqual(['x', 'A', 'B', 'C']);
  });
});

describe('getAnchorFromDragDrop()', () => {
  it('should return null when item is at start', () => {
    const result = getAnchorFromDragDrop('x', ['x', 'A', 'B', 'C']);
    expect(result).toBeNull();
  });

  it('should return the previous item as anchor', () => {
    const result = getAnchorFromDragDrop('x', ['A', 'x', 'B', 'C']);
    expect(result).toBe('A');
  });

  it('should return correct anchor when item is at end', () => {
    const result = getAnchorFromDragDrop('x', ['A', 'B', 'C', 'x']);
    expect(result).toBe('C');
  });

  it('should return null if item not found', () => {
    const result = getAnchorFromDragDrop('x', ['A', 'B', 'C']);
    expect(result).toBeNull();
  });
});

describe('moveItemInList()', () => {
  it('should work for moving INSIDE an unfiltered list', () => {
    const result = moveItemInList('x', ['x', 'A', 'B'], ['A', 'x', 'B']);
    expect(result).toEqual(['A', 'x', 'B']);
  });

  it('should work for moving INSIDE a filtered list', () => {
    const result = moveItemInList('x', ['x', 'A', 'B', 'C'], ['A', 'x', 'B']);
    expect(result).toEqual(['A', 'x', 'B', 'C']);
  });

  it('should work for moving INTO an unfiltered list', () => {
    const result = moveItemInList('x', ['A', 'B', 'C'], ['A', 'B', 'x', 'C']);
    expect(result).toEqual(['A', 'B', 'x', 'C']);
  });

  it('should work for moving INTO a filtered list', () => {
    const result = moveItemInList('x', ['A', 'B', 'C'], ['B', 'x']);
    expect(result).toEqual(['A', 'B', 'x', 'C']);
  });

  it('should work for moving INTO a filtered list with only one item after', () => {
    const result = moveItemInList('x', ['A', 'B', 'C'], ['x', 'C']);
    expect(result).toEqual(['A', 'B', 'x', 'C']);
  });

  it('should work for moving INTO a filtered list with only one item after', () => {
    const result = moveItemInList('x', ['A', 'B', 'C'], ['x', 'C']);
    expect(result).toEqual(['A', 'B', 'x', 'C']);
  });

  it('should work for moving INTO an empty filtered list with hidden items', () => {
    const result = moveItemInList('x', ['A', 'B', 'C'], ['x'], 0);
    expect(result).toEqual(['x', 'A', 'B', 'C']);
  });

  it('should work for moving INTO an empty filtered list with hidden items 2', () => {
    const result = moveItemInList('x', ['A', 'B', 'C'], ['x'], 3);
    expect(result).toEqual(['A', 'B', 'C', 'x']);
  });

  it('should work for moving INTO an empty list (without unfiltered items)', () => {
    const result = moveItemInList('x', [], ['x']);
    expect(result).toEqual(['x']);
  });
});
