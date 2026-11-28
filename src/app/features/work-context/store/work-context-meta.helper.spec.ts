import {
  getAnchorFromDragDrop,
  moveItemAfterAnchor,
  moveItemInList,
  moveUndoneTaskDownInList,
  moveUndoneTaskUpInList,
} from './work-context-meta.helper';
import { arrayMoveLeftUntil, arrayMoveRightUntil } from '../../../util/array-move';

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

  it('should preserve current position when anchor not found (no-op)', () => {
    const result = moveItemAfterAnchor('x', 'missing', ['A', 'x', 'B', 'C']);
    expect(result).toEqual(['A', 'x', 'B', 'C']);
  });

  it('should append to end when anchor not found and item not in list (cross-list move)', () => {
    const result = moveItemAfterAnchor('x', 'missing', ['A', 'B', 'C']);
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

describe('moveUndoneTaskUpInList() / moveUndoneTaskDownInList() (#11464)', () => {
  const without = (list: string[], ...ids: string[]): string[] =>
    list.filter((id) => !ids.includes(id));

  describe('without a concurrent change (same as the legacy move)', () => {
    it('moves up past the upper neighbour', () => {
      const list = ['T4', 'T3', 'T2', 'T1'];
      expect(moveUndoneTaskUpInList(list, 'T1', list)).toEqual(['T4', 'T3', 'T1', 'T2']);
    });

    it('moves down past the lower neighbour', () => {
      const list = ['T4', 'T3', 'T2', 'T1'];
      expect(moveUndoneTaskDownInList(list, 'T3', list)).toEqual([
        'T4',
        'T2',
        'T3',
        'T1',
      ]);
    });

    it('skips done tasks like the legacy move', () => {
      const list = ['A', 'd1', 'B', 'd2', 'X', 'd3', 'C'];
      const undone = ['A', 'B', 'X', 'C'];
      expect(moveUndoneTaskUpInList(list, 'X', undone)).toEqual([
        'A',
        'd1',
        'X',
        'B',
        'd2',
        'd3',
        'C',
      ]);
      expect(moveUndoneTaskDownInList(list, 'X', undone)).toEqual([
        'A',
        'd1',
        'B',
        'd2',
        'd3',
        'C',
        'X',
      ]);
    });

    it('matches the legacy move for every task of generated lists', () => {
      let seed = 7;
      const rand = (n: number): number => {
        seed = (seed * 48271) % 2147483647;
        return seed % n;
      };
      for (let run = 0; run < 300; run++) {
        const list = Array.from({ length: 1 + rand(8) }, (_, i) => `t${i}`);
        // Like the real payload: computeOrderedTaskIdsForToday/-ForTag append
        // members missing from the stored order after the listed ones.
        const unlisted = Array.from({ length: rand(3) }, (_, i) => `u${i}`);
        const undone = [...list.filter(() => rand(3) > 0), ...unlisted];
        const isSkipped = (id: string): boolean => !undone.includes(id);
        for (const id of [...list, ...unlisted]) {
          expect(moveUndoneTaskUpInList(list, id, undone)).toEqual(
            arrayMoveLeftUntil(list, id, isSkipped),
          );
          expect(moveUndoneTaskDownInList(list, id, undone)).toEqual(
            arrayMoveRightUntil(list, id, isSkipped),
          );
        }
      }
    });
  });

  describe('against a concurrent delete', () => {
    it('keeps the task in the deleted upper neighbour slot (E2E scenario 1)', () => {
      // B moved T1 up past T2 while A deleted T2.
      const undoneOnB = ['T4', 'T3', 'T2', 'T1'];
      const onB = without(moveUndoneTaskUpInList(undoneOnB, 'T1', undoneOnB), 'T2');
      const onA = moveUndoneTaskUpInList(['T4', 'T3', 'T1'], 'T1', undoneOnB);
      expect(onB).toEqual(['T4', 'T3', 'T1']);
      expect(onA).toEqual(onB);
    });

    it('converges for three moves past two deleted tasks (E2E scenario 2)', () => {
      let onB = ['T6', 'T5', 'T4', 'T3', 'T2', 'T1'];
      const snapshots: string[][] = [];
      for (let i = 0; i < 3; i++) {
        snapshots.push(onB);
        onB = moveUndoneTaskUpInList(onB, 'T1', onB);
      }
      expect(onB).toEqual(['T6', 'T5', 'T1', 'T4', 'T3', 'T2']);
      let onA = ['T6', 'T5', 'T3', 'T1'];
      for (const snapshot of snapshots) {
        onA = moveUndoneTaskUpInList(onA, 'T1', snapshot);
      }
      expect(onA).toEqual(without(onB, 'T2', 'T4'));
    });

    it('keeps the task in the deleted lower neighbour slot (reverse E2E scenario)', () => {
      const undoneOnB = ['T4', 'T3', 'T2', 'T1'];
      const onB = without(moveUndoneTaskDownInList(undoneOnB, 'T3', undoneOnB), 'T2');
      const onA = moveUndoneTaskDownInList(['T4', 'T3', 'T1'], 'T3', undoneOnB);
      expect(onB).toEqual(['T4', 'T3', 'T1']);
      expect(onA).toEqual(onB);
    });

    it('still moves past the neighbour when another task was deleted', () => {
      const undone = ['Q', 'P', 'X', 'N'];
      expect(moveUndoneTaskUpInList(['P', 'X', 'N'], 'X', undone)).toEqual([
        'X',
        'P',
        'N',
      ]);
      expect(
        moveUndoneTaskDownInList(['Q', 'P', 'X'], 'X', ['Q', 'P', 'X', 'N', 'M']),
      ).toEqual(['Q', 'P', 'X']);
    });

    it('commutes with the delete of any other task in the visible (undone) order', () => {
      let seed = 11;
      const rand = (n: number): number => {
        seed = (seed * 48271) % 2147483647;
        return seed % n;
      };
      for (let run = 0; run < 300; run++) {
        const list = Array.from({ length: 2 + rand(8) }, (_, i) => `t${i}`);
        const undone = list.filter(() => rand(3) > 0);
        const undoneSet = new Set(undone);
        const visible = (l: string[]): string[] => l.filter((id) => undoneSet.has(id));
        for (const id of undone) {
          for (const deleted of list) {
            if (deleted === id) continue;
            const moveUp = (l: string[]): string[] =>
              moveUndoneTaskUpInList(l, id, undone);
            const moveDown = (l: string[]): string[] =>
              moveUndoneTaskDownInList(l, id, undone);
            for (const move of [moveUp, moveDown]) {
              const moveThenDelete = without(move(list), deleted);
              const deleteThenMove = move(without(list, deleted));
              expect(visible(deleteThenMove)).toEqual(visible(moveThenDelete));
            }
          }
        }
      }
    });
  });
});
