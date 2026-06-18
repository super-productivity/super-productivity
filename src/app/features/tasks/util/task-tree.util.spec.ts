import { Dictionary } from '@ngrx/entity';
import {
  buildTaskWithSubTasks,
  canNestUnder,
  getAncestorIds,
  getDescendantIds,
  getSubtreeHeight,
  getTaskDepth,
} from './task-tree.util';
import { DEFAULT_TASK, Task } from '../task.model';

const task = (id: string, parentId?: string, subTaskIds: string[] = []): Task => ({
  ...DEFAULT_TASK,
  id,
  parentId,
  subTaskIds,
  projectId: 'p1',
});

/**
 * Tree used in most cases (depths shown):
 *   a (1)
 *   └─ b (2)
 *      └─ c (3)
 *         └─ d (4)
 *   e (1) — lone leaf
 */
const makeEntities = (): Dictionary<Task> => ({
  a: task('a', undefined, ['b']),
  b: task('b', 'a', ['c']),
  c: task('c', 'b', ['d']),
  d: task('d', 'c', []),
  e: task('e', undefined, []),
});

describe('task-tree.util', () => {
  describe('getDescendantIds', () => {
    it('returns the full subtree depth-first', () => {
      expect(getDescendantIds('a', makeEntities())).toEqual(['b', 'c', 'd']);
    });
    it('returns [] for a leaf', () => {
      expect(getDescendantIds('d', makeEntities())).toEqual([]);
    });
    it('is cycle-safe', () => {
      const cyclic: Dictionary<Task> = {
        x: task('x', 'y', ['y']),
        y: task('y', 'x', ['x']),
      };
      expect(getDescendantIds('x', cyclic)).toEqual(['y']);
    });
  });

  describe('getAncestorIds', () => {
    it('returns parent..root order', () => {
      expect(getAncestorIds('d', makeEntities())).toEqual(['c', 'b', 'a']);
    });
    it('returns [] for a root', () => {
      expect(getAncestorIds('a', makeEntities())).toEqual([]);
    });
    it('is cycle-safe', () => {
      const cyclic: Dictionary<Task> = {
        x: task('x', 'y'),
        y: task('y', 'x'),
      };
      expect(getAncestorIds('x', cyclic)).toEqual(['y']);
    });
  });

  describe('getTaskDepth', () => {
    it('is 1-based (root = 1)', () => {
      const e = makeEntities();
      expect(getTaskDepth('a', e)).toBe(1);
      expect(getTaskDepth('b', e)).toBe(2);
      expect(getTaskDepth('d', e)).toBe(4);
    });
  });

  describe('getSubtreeHeight', () => {
    it('is 1 for a leaf and counts levels otherwise', () => {
      const e = makeEntities();
      expect(getSubtreeHeight('d', e)).toBe(1);
      expect(getSubtreeHeight('c', e)).toBe(2);
      expect(getSubtreeHeight('a', e)).toBe(4);
    });
  });

  describe('canNestUnder', () => {
    it('allows a move that stays within MAX_TASK_DEPTH (4)', () => {
      // moving leaf 'e' (height 1) under 'c' (depth 3) → 3 + 1 = 4 OK
      expect(canNestUnder('e', 'c', makeEntities())).toBe(true);
    });
    it('rejects a move that would exceed MAX_TASK_DEPTH', () => {
      // moving 'e' under 'd' (depth 4) → 4 + 1 = 5 > 4
      expect(canNestUnder('e', 'd', makeEntities())).toBe(false);
    });
    it('rejects nesting a tall subtree even under a shallow parent', () => {
      // moving 'b' (subtree height 3: b→c→d) under 'e' (depth 1) → 1 + 3 = 4 OK
      expect(canNestUnder('b', 'e', makeEntities())).toBe(true);
      // moving 'a' (height 4) under 'e' → 1 + 4 = 5 > 4
      expect(canNestUnder('a', 'e', makeEntities())).toBe(false);
    });
    it('rejects nesting under self or own descendant (cycle)', () => {
      const e = makeEntities();
      expect(canNestUnder('a', 'a', e)).toBe(false);
      expect(canNestUnder('a', 'c', e)).toBe(false);
    });
  });

  describe('buildTaskWithSubTasks', () => {
    it('builds a recursive view-model up to MAX_TASK_DEPTH', () => {
      const built = buildTaskWithSubTasks(makeEntities().a as Task, makeEntities());
      expect(built.id).toBe('a');
      expect(built.subTasks.length).toBe(1);
      expect(built.subTasks[0].id).toBe('b');
      expect(built.subTasks[0].subTasks[0].id).toBe('c');
      expect(built.subTasks[0].subTasks[0].subTasks[0].id).toBe('d');
      // depth 4 is the last rendered level → no deeper children
      expect(built.subTasks[0].subTasks[0].subTasks[0].subTasks).toEqual([]);
    });
    it('caps at the depth budget even if data is deeper', () => {
      // a 5-deep chain: only 4 levels should be materialized
      const e: Dictionary<Task> = {
        l1: task('l1', undefined, ['l2']),
        l2: task('l2', 'l1', ['l3']),
        l3: task('l3', 'l2', ['l4']),
        l4: task('l4', 'l3', ['l5']),
        l5: task('l5', 'l4', []),
      };
      const built = buildTaskWithSubTasks(e.l1 as Task, e);
      const l4 = built.subTasks[0].subTasks[0].subTasks[0];
      expect(l4.id).toBe('l4');
      expect(l4.subTasks).toEqual([]); // l5 cut off by the depth cap
    });
    it('returns an empty subTasks array for a leaf', () => {
      const built = buildTaskWithSubTasks(makeEntities().e as Task, makeEntities());
      expect(built.subTasks).toEqual([]);
    });
    it('does not render a cycle back into the same branch', () => {
      const cyclic: Dictionary<Task> = {
        x: task('x', 'y', ['y']),
        y: task('y', 'x', ['x']),
      };
      const built = buildTaskWithSubTasks(cyclic.x as Task, cyclic);
      expect(built.subTasks.map((t) => t.id)).toEqual(['y']);
      expect(built.subTasks[0].subTasks).toEqual([]);
    });
  });
});
