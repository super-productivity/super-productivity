/**
 * Unit tests for the pure top-level-navigation helpers. Run with
 * `npm test` (see scripts/test.js) — esbuild transpiles this file and the
 * built-in `node --test` runner executes it.
 *
 * These cover the drag / move math that was previously buried in
 * `ui/editor.ts` behind the live ProseMirror editor and so had no
 * coverage at all.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  childIdxAtPos,
  findParentTaskIdBefore,
  moveBlockTargetIdx,
  positionAfterParentGroup,
  sliceLenAt,
  snapDropTargetIdx,
  validInsertRange,
  type DocLike,
} from './doc-nav';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

/** Spec for one top-level child in a fake doc. */
interface ChildSpec {
  name: string;
  /** nodeSize — defaults to 2, varied on purpose so index ≠ position. */
  size?: number;
  taskId?: string;
}

/**
 * Build a minimal `DocLike` from a list of child specs, plus a `posOf`
 * helper that returns the ProseMirror start position of child `idx`
 * (the sum of preceding nodeSizes). Non-uniform sizes keep the tests
 * honest — a helper that confused an index for a position would pass
 * with uniform size 1 and fail here.
 */
const build = (
  children: ChildSpec[],
): { doc: DocLike; posOf: (idx: number) => number } => {
  const nodes = children.map((c) => ({
    type: { name: c.name },
    nodeSize: c.size ?? 2,
    attrs: { taskId: c.taskId ?? '' },
  }));
  const doc: DocLike = {
    childCount: nodes.length,
    child: (i) => {
      const n = nodes[i];
      if (!n) throw new RangeError(`child ${i} out of range`);
      return n;
    },
    nodeAt: (pos) => {
      let cursor = 0;
      for (const n of nodes) {
        if (cursor === pos) return n;
        cursor += n.nodeSize;
      }
      return null;
    },
  };
  const posOf = (idx: number): number => {
    let p = 0;
    for (let i = 0; i < idx; i++) p += nodes[i].nodeSize;
    return p;
  };
  return { doc, posOf };
};

// Shorthand child specs.
const para = (size = 2): ChildSpec => ({ name: 'paragraph', size });
const task = (taskId: string, size = 3): ChildSpec => ({
  name: 'taskRef',
  taskId,
  size,
});
const sub = (taskId: string, size = 3): ChildSpec => ({
  name: 'subTaskRef',
  taskId,
  size,
});

/* -------------------------------------------------------------------------- */
/* childIdxAtPos                                                               */
/* -------------------------------------------------------------------------- */

test('childIdxAtPos: returns the index whose start position matches', () => {
  const { doc, posOf } = build([para(), task('a'), sub('a1'), para()]);
  assert.equal(childIdxAtPos(doc, posOf(0)), 0);
  assert.equal(childIdxAtPos(doc, posOf(1)), 1);
  assert.equal(childIdxAtPos(doc, posOf(2)), 2);
  assert.equal(childIdxAtPos(doc, posOf(3)), 3);
});

test('childIdxAtPos: returns -1 for a position inside a node', () => {
  const { doc } = build([para(4), task('a', 6)]);
  // Position 1 falls inside the first child (which spans 0..3).
  assert.equal(childIdxAtPos(doc, 1), -1);
});

test('childIdxAtPos: returns -1 past the end and for an empty doc', () => {
  const { doc, posOf } = build([para(), task('a')]);
  assert.equal(childIdxAtPos(doc, posOf(2)), -1); // == doc end
  assert.equal(childIdxAtPos(doc, 999), -1);
  assert.equal(childIdxAtPos(build([]).doc, 0), -1);
});

/* -------------------------------------------------------------------------- */
/* sliceLenAt                                                                  */
/* -------------------------------------------------------------------------- */

test('sliceLenAt: a plain block is a slice of 1', () => {
  const { doc } = build([para(), task('a'), para()]);
  assert.equal(sliceLenAt(doc, 0), 1);
  assert.equal(sliceLenAt(doc, 2), 1);
});

test('sliceLenAt: a childless taskRef is a slice of 1', () => {
  const { doc } = build([task('a'), task('b')]);
  assert.equal(sliceLenAt(doc, 0), 1);
});

test('sliceLenAt: a taskRef bundles its trailing subTaskRefs', () => {
  const { doc } = build([task('a'), sub('a1'), sub('a2'), task('b')]);
  assert.equal(sliceLenAt(doc, 0), 3);
  assert.equal(sliceLenAt(doc, 3), 1);
});

test('sliceLenAt: a lone subTaskRef is a slice of 1', () => {
  const { doc } = build([task('a'), sub('a1')]);
  assert.equal(sliceLenAt(doc, 1), 1);
});

test('sliceLenAt: an out-of-range index yields 1', () => {
  const { doc } = build([task('a')]);
  assert.equal(sliceLenAt(doc, -1), 1);
  assert.equal(sliceLenAt(doc, 5), 1);
});

/* -------------------------------------------------------------------------- */
/* findParentTaskIdBefore                                                      */
/* -------------------------------------------------------------------------- */

test('findParentTaskIdBefore: resolves the owning parent of a subtask', () => {
  const { doc, posOf } = build([task('a'), sub('a1'), sub('a2')]);
  assert.equal(findParentTaskIdBefore(doc, posOf(1)), 'a');
  assert.equal(findParentTaskIdBefore(doc, posOf(2)), 'a');
});

test('findParentTaskIdBefore: a subtask with no preceding parent is an orphan', () => {
  const { doc, posOf } = build([para(), sub('x1')]);
  assert.equal(findParentTaskIdBefore(doc, posOf(1)), null);
});

test('findParentTaskIdBefore: a subtask at index 0 has no parent', () => {
  const { doc, posOf } = build([sub('x1'), task('a')]);
  assert.equal(findParentTaskIdBefore(doc, posOf(0)), null);
});

test('findParentTaskIdBefore: an unaligned position resolves to null', () => {
  const { doc } = build([task('a', 4), sub('a1', 4)]);
  assert.equal(findParentTaskIdBefore(doc, 2), null);
});

/* -------------------------------------------------------------------------- */
/* positionAfterParentGroup                                                    */
/* -------------------------------------------------------------------------- */

test('positionAfterParentGroup: lands just past a childless parent', () => {
  const { doc, posOf } = build([task('a', 5), task('b', 5)]);
  assert.equal(positionAfterParentGroup(doc, posOf(0)), posOf(1));
});

test('positionAfterParentGroup: skips past the parent and all its subtasks', () => {
  const { doc, posOf } = build([task('a', 5), sub('a1', 4), sub('a2', 6), para()]);
  assert.equal(positionAfterParentGroup(doc, posOf(0)), posOf(3));
});

test('positionAfterParentGroup: a non-taskRef position is returned unchanged', () => {
  const { doc, posOf } = build([para(), task('a')]);
  assert.equal(positionAfterParentGroup(doc, posOf(0)), posOf(0));
});

test('positionAfterParentGroup: an unaligned position is returned unchanged', () => {
  const { doc } = build([task('a', 4)]);
  assert.equal(positionAfterParentGroup(doc, 2), 2);
});

/* -------------------------------------------------------------------------- */
/* validInsertRange                                                            */
/* -------------------------------------------------------------------------- */

test('validInsertRange: a subtask may move anywhere inside its group', () => {
  const { doc, posOf } = build([task('a'), sub('a1'), sub('a2'), sub('a3'), para()]);
  // Dragging the middle subtask: gaps 1..4 keep it inside the group.
  assert.deepEqual(validInsertRange(doc, posOf(2)), { min: 1, max: 4 });
});

test('validInsertRange: null when the dragged node is not a subTaskRef', () => {
  const { doc, posOf } = build([task('a'), sub('a1')]);
  assert.equal(validInsertRange(doc, posOf(0)), null);
});

test('validInsertRange: null for an orphan subtask with no parent', () => {
  const { doc, posOf } = build([para(), sub('x1')]);
  assert.equal(validInsertRange(doc, posOf(1)), null);
});

test('validInsertRange: null for an unaligned position', () => {
  const { doc } = build([task('a', 4), sub('a1', 4)]);
  assert.equal(validInsertRange(doc, 2), null);
});

/* -------------------------------------------------------------------------- */
/* moveBlockTargetIdx                                                          */
/* -------------------------------------------------------------------------- */

test('moveBlockTargetIdx: a plain block steps up and down by one', () => {
  const { doc } = build([para(), para(), para()]);
  // The result is an insertion-gap index: the dragged slice is removed
  // before re-insertion, so a one-step move down lands past the next
  // block (gap `sliceEnd + 1`), not at the next block's index.
  assert.equal(moveBlockTargetIdx(doc, 1, 'up'), 0);
  assert.equal(moveBlockTargetIdx(doc, 1, 'down'), 3);
});

test('moveBlockTargetIdx: no-op moving the first block up / last block down', () => {
  const { doc } = build([para(), para()]);
  assert.equal(moveBlockTargetIdx(doc, 0, 'up'), null);
  assert.equal(moveBlockTargetIdx(doc, 1, 'down'), null);
});

test('moveBlockTargetIdx: a subtask steps within its group', () => {
  const { doc } = build([task('a'), sub('a1'), sub('a2'), sub('a3')]);
  assert.equal(moveBlockTargetIdx(doc, 2, 'up'), 1);
  assert.equal(moveBlockTargetIdx(doc, 2, 'down'), 4);
});

test('moveBlockTargetIdx: a subtask never crosses the parent boundary', () => {
  const { doc } = build([task('a'), sub('a1'), sub('a2'), task('b')]);
  // First subtask up would escape above the parent — no-op.
  assert.equal(moveBlockTargetIdx(doc, 1, 'up'), null);
  // Last subtask down would escape into the next group — no-op.
  assert.equal(moveBlockTargetIdx(doc, 2, 'down'), null);
});

test('moveBlockTargetIdx: a parent group jumps the previous group going up', () => {
  const { doc } = build([task('a'), sub('a1'), task('b')]);
  // Moving b up lands it before the whole [a, a1] group.
  assert.equal(moveBlockTargetIdx(doc, 2, 'up'), 0);
});

test('moveBlockTargetIdx: a parent group jumps the next group going down', () => {
  const { doc } = build([task('a'), sub('a1'), task('b'), sub('b1')]);
  // Moving the [a, a1] group down lands it past the whole [b, b1] group.
  assert.equal(moveBlockTargetIdx(doc, 0, 'down'), 4);
});

test('moveBlockTargetIdx: no-op when a parent group is already last', () => {
  const { doc } = build([task('a'), task('b'), sub('b1')]);
  assert.equal(moveBlockTargetIdx(doc, 1, 'down'), null);
});

test('moveBlockTargetIdx: null for an out-of-range index', () => {
  const { doc } = build([para()]);
  assert.equal(moveBlockTargetIdx(doc, 9, 'up'), null);
});

/* -------------------------------------------------------------------------- */
/* snapDropTargetIdx                                                           */
/* -------------------------------------------------------------------------- */

test('snapDropTargetIdx: a plain-block drag is returned unchanged', () => {
  const { doc } = build([para(), task('a'), sub('a1')]);
  const idx = snapDropTargetIdx(doc, 1, {
    sourceType: 'other',
    nodePos: 0,
    fromIdx: 0,
    sliceLen: 1,
  });
  assert.equal(idx, 1);
});

test('snapDropTargetIdx: a subtask drag is clamped into its group', () => {
  const { doc, posOf } = build([task('a'), sub('a1'), sub('a2'), para()]);
  const drag = {
    sourceType: 'subTaskRef' as const,
    nodePos: posOf(1),
    fromIdx: 1,
    sliceLen: 1,
  };
  // Raw targets outside [1, 3] snap back to the group bounds.
  assert.equal(snapDropTargetIdx(doc, 0, drag), 1);
  assert.equal(snapDropTargetIdx(doc, 9, drag), 3);
  assert.equal(snapDropTargetIdx(doc, 2, drag), 2);
});

test('snapDropTargetIdx: a parent drag advances past a foreign subtask run', () => {
  const { doc, posOf } = build([task('b'), sub('b1'), task('a'), para()]);
  const drag = {
    sourceType: 'taskRef' as const,
    nodePos: posOf(2),
    fromIdx: 2,
    sliceLen: 1,
  };
  // A raw target of 1 (between b and its subtask) is illegal — snap past it.
  assert.equal(snapDropTargetIdx(doc, 1, drag), 2);
});

test('snapDropTargetIdx: a parent drag does not skip its own subtasks', () => {
  const { doc, posOf } = build([task('a'), sub('a1'), sub('a2'), para()]);
  const drag = {
    sourceType: 'taskRef' as const,
    nodePos: posOf(0),
    fromIdx: 0,
    sliceLen: 3,
  };
  // Target 1 sits inside the dragged slice's own subtasks — left as-is
  // (the caller treats an in-slice target as a no-op).
  assert.equal(snapDropTargetIdx(doc, 1, drag), 1);
});
