import { reorderBoardTasks } from './reorder-board-tasks';

describe('reorderBoardTasks', () => {
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const selected = new Set(['b', 'd']);

  it('moves separated selected rows up once without reversing them', () => {
    expect(reorderBoardTasks(ids, selected, 'up')).toEqual(['b', 'a', 'd', 'c', 'e']);
    expect(ids).toEqual(['a', 'b', 'c', 'd', 'e']);
  });

  it('moves separated selected rows down once', () => {
    expect(reorderBoardTasks(ids, selected, 'down')).toEqual(['a', 'c', 'b', 'e', 'd']);
  });

  it('moves a contiguous selection as a block', () => {
    expect(reorderBoardTasks(ids, new Set(['b', 'c']), 'down')).toEqual([
      'a',
      'd',
      'b',
      'c',
      'e',
    ]);
    expect(reorderBoardTasks(ids, new Set(['b', 'c']), 'up')).toEqual([
      'b',
      'c',
      'a',
      'd',
      'e',
    ]);
  });

  it('keeps selected and unselected relative order at either end', () => {
    expect(reorderBoardTasks(ids, selected, 'top')).toEqual(['b', 'd', 'a', 'c', 'e']);
    expect(reorderBoardTasks(ids, selected, 'bottom')).toEqual(['a', 'c', 'e', 'b', 'd']);
  });

  it('does not move past the edges or insert selections from other panels', () => {
    expect(reorderBoardTasks(ids, new Set(['a', 'b', 'elsewhere']), 'up')).toEqual(ids);
    expect(reorderBoardTasks(ids, new Set(['d', 'e']), 'down')).toEqual(ids);
    expect(reorderBoardTasks([], selected, 'bottom')).toEqual([]);
  });
});
