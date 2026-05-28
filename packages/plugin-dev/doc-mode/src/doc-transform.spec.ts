/**
 * Unit tests for the pure document-transform helpers. Run with
 * `npm test` (see scripts/test.js) — esbuild transpiles this file and the
 * built-in `node --test` runner executes it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildSeedDoc,
  ensureSubtasksInJSON,
  isInContext,
  migrateStoredDoc,
  prepareStoredDoc,
  reconcileTopLevelTaskRefs,
  refreshChipContentFromCache,
  snapshotInContextTaskIds,
  stripChipContent,
  taskNodeJSON,
  taskRefWithSubtasksJSON,
  type PMNode,
  type TaskLookup,
} from './doc-transform';
import type { ActiveWorkContext, Task } from '@super-productivity/plugin-api';

/* -------------------------------------------------------------------------- */
/* Fixtures                                                                    */
/* -------------------------------------------------------------------------- */

const mkTask = (partial: Partial<Task> & { id: string }): Task => {
  const base: Task = {
    id: partial.id,
    title: '',
    timeEstimate: 0,
    timeSpent: 0,
    isDone: false,
    projectId: null,
    tagIds: [],
    created: 0,
    subTaskIds: [],
  };
  return { ...base, ...partial };
};

const mkLookup = (tasks: Task[]): TaskLookup => {
  const map = new Map(tasks.map((t) => [t.id, t]));
  return (id) => map.get(id);
};

const mkCtx = (
  partial: Partial<ActiveWorkContext> & { id: string },
): ActiveWorkContext => ({
  type: 'PROJECT',
  title: 'Untitled',
  taskIds: [],
  ...partial,
});

/** Compact `[type:taskId, ...]` view of a doc's top-level children. */
const summary = (doc: unknown): string[] =>
  ((doc as PMNode).content ?? []).map((n) => {
    const node = n as PMNode;
    if (node.type === 'taskRef' || node.type === 'subTaskRef') {
      return `${node.type}:${String(node.attrs?.taskId)}`;
    }
    return node.type ?? '?';
  });

/** Concatenated inline text of a chip node. */
const chipText = (node: PMNode): string =>
  (node.content ?? []).map((c) => (c as PMNode).text ?? '').join('');

const childAt = (doc: unknown, i: number): PMNode =>
  ((doc as PMNode).content ?? [])[i] as PMNode;

/* -------------------------------------------------------------------------- */
/* taskNodeJSON / taskRefWithSubtasksJSON                                      */
/* -------------------------------------------------------------------------- */

test('taskNodeJSON: builds a content-bearing chip from the lookup', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'Buy milk', isDone: true })]);
  assert.deepEqual(taskNodeJSON('a', 'taskRef', look), {
    type: 'taskRef',
    attrs: { taskId: 'a', isDone: true },
    content: [{ type: 'text', text: 'Buy milk' }],
  });
});

test('taskNodeJSON: unknown task yields an empty (but valid) chip', () => {
  const node = taskNodeJSON('ghost', 'subTaskRef', mkLookup([]));
  assert.deepEqual(node, {
    type: 'subTaskRef',
    attrs: { taskId: 'ghost', isDone: false },
    content: [],
  });
});

test('taskRefWithSubtasksJSON: emits the parent followed by each subtask', () => {
  const look = mkLookup([
    mkTask({ id: 'p', title: 'Parent', subTaskIds: ['s1', 's2'] }),
    mkTask({ id: 's1', title: 'Sub 1' }),
    mkTask({ id: 's2', title: 'Sub 2' }),
  ]);
  assert.deepEqual(summary({ content: taskRefWithSubtasksJSON('p', look) }), [
    'taskRef:p',
    'subTaskRef:s1',
    'subTaskRef:s2',
  ]);
});

/* -------------------------------------------------------------------------- */
/* buildSeedDoc                                                                */
/* -------------------------------------------------------------------------- */

test('buildSeedDoc: heading + chips with content + trailing paragraph', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'Alpha', subTaskIds: ['s1'] }),
    mkTask({ id: 's1', title: 'Sub' }),
  ]);
  const doc = buildSeedDoc(
    mkCtx({ id: 'P1', title: 'Project One', taskIds: ['a'] }),
    look,
  );
  assert.equal((doc as PMNode).type, 'doc');
  assert.deepEqual(summary(doc), ['heading', 'taskRef:a', 'subTaskRef:s1', 'paragraph']);
  assert.equal(chipText(childAt(doc, 0)), 'Project One');
  assert.equal(chipText(childAt(doc, 1)), 'Alpha');
});

/* -------------------------------------------------------------------------- */
/* migrateStoredDoc                                                            */
/* -------------------------------------------------------------------------- */

test('migrateStoredDoc: backfills content for old atom-shape taskRefs', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'Hello', isDone: true })]);
  const raw = { type: 'doc', content: [{ type: 'taskRef', attrs: { taskId: 'a' } }] };
  const out = migrateStoredDoc(raw, look) as PMNode;
  assert.deepEqual(childAt(out, 0), {
    type: 'taskRef',
    attrs: { taskId: 'a', isDone: true },
    content: [{ type: 'text', text: 'Hello' }],
  });
});

test('migrateStoredDoc: leaves chips that already have content (idempotent)', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'Fresh title' })]);
  const raw = {
    type: 'doc',
    content: [
      {
        type: 'taskRef',
        attrs: { taskId: 'a', isDone: false },
        content: [{ type: 'text', text: 'Edited title' }],
      },
    ],
  };
  const out = migrateStoredDoc(raw, look) as PMNode;
  assert.equal(chipText(childAt(out, 0)), 'Edited title');
});

test('migrateStoredDoc: preserves non-task nodes', () => {
  const raw = {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'note' }] }],
  };
  assert.deepEqual(migrateStoredDoc(raw, mkLookup([])), raw);
});

/* -------------------------------------------------------------------------- */
/* stripChipContent                                                            */
/* -------------------------------------------------------------------------- */

test('stripChipContent: strips taskRef/subTaskRef content + isDone, keeps taskId', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'taskRef',
        attrs: { taskId: 'a', isDone: true },
        content: [{ type: 'text', text: 'Buy milk' }],
      },
      {
        type: 'subTaskRef',
        attrs: { taskId: 's1', isDone: false },
        content: [{ type: 'text', text: 'Sub one' }],
      },
    ],
  };
  const out = stripChipContent(doc) as PMNode;
  assert.deepEqual(childAt(out, 0), { type: 'taskRef', attrs: { taskId: 'a' } });
  assert.deepEqual(childAt(out, 1), { type: 'subTaskRef', attrs: { taskId: 's1' } });
});

test('stripChipContent: leaves prose blocks and their text content intact', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'Title' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'a note' }] },
      {
        type: 'bulletList',
        content: [
          {
            type: 'listItem',
            content: [{ type: 'paragraph', content: [{ type: 'text', text: 'item' }] }],
          },
        ],
      },
      { type: 'taskRef', attrs: { taskId: 'a' }, content: [{ type: 'text', text: 'A' }] },
    ],
  };
  const out = stripChipContent(doc) as PMNode;
  assert.deepEqual(childAt(out, 0), doc.content[0]);
  assert.deepEqual(childAt(out, 1), doc.content[1]);
  assert.deepEqual(childAt(out, 2), doc.content[2]);
  // Chip inside the same doc is still stripped.
  assert.deepEqual(childAt(out, 3), { type: 'taskRef', attrs: { taskId: 'a' } });
});

test('stripChipContent: does not mutate the input object', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'taskRef',
        attrs: { taskId: 'a', isDone: true },
        content: [{ type: 'text', text: 'Buy milk' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'a note' }] },
    ],
  };
  const before = JSON.stringify(doc);
  const out = stripChipContent(doc);
  assert.notEqual(out, doc);
  assert.equal(JSON.stringify(doc), before);
});

test('stripChipContent: round-trips through prepareStoredDoc to rebuild chip titles', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'Alpha', isDone: true, subTaskIds: ['s1'] }),
    mkTask({ id: 's1', title: 'Sub one' }),
  ]);
  const live = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Proj' }] },
      {
        type: 'taskRef',
        attrs: { taskId: 'a', isDone: true },
        content: [{ type: 'text', text: 'Alpha' }],
      },
      {
        type: 'subTaskRef',
        attrs: { taskId: 's1', isDone: false },
        content: [{ type: 'text', text: 'Sub one' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'a note' }] },
    ],
  };
  const stripped = stripChipContent(live);
  const out = prepareStoredDoc(
    stripped,
    mkCtx({ id: 'P', taskIds: ['a'] }),
    look,
  ) as PMNode;
  assert.deepEqual(summary(out), [
    'heading',
    'taskRef:a',
    'subTaskRef:s1',
    'paragraph',
    'paragraph',
  ]);
  assert.equal(chipText(childAt(out, 1)), 'Alpha');
  assert.equal(childAt(out, 1).attrs?.isDone, true);
  assert.equal(chipText(childAt(out, 2)), 'Sub one');
  assert.equal(chipText(childAt(out, 3)), 'a note');
});

/* -------------------------------------------------------------------------- */
/* reconcileTopLevelTaskRefs                                                   */
/* -------------------------------------------------------------------------- */

test('reconcile: rebuilds order from ctx, drops stale chips, appends new ones', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'A' }),
    mkTask({ id: 'b', title: 'B' }),
    mkTask({ id: 'c', title: 'C' }),
  ]);
  const stored = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
      { type: 'taskRef', attrs: { taskId: 'b' }, content: [{ type: 'text', text: 'B' }] },
      {
        type: 'taskRef',
        attrs: { taskId: 'x' },
        content: [{ type: 'text', text: 'gone' }],
      },
      { type: 'taskRef', attrs: { taskId: 'a' }, content: [{ type: 'text', text: 'A' }] },
    ],
  };
  const out = reconcileTopLevelTaskRefs(
    stored,
    mkCtx({ id: 'P', taskIds: ['a', 'b', 'c'] }),
    look,
  );
  assert.deepEqual(summary(out), [
    'heading',
    'taskRef:a',
    'taskRef:b',
    'taskRef:c',
    'paragraph',
  ]);
  // The freshly-appended chip carries its title, not an empty body.
  assert.equal(chipText(childAt(out, 3)), 'C');
});

test('reconcile: dedupes duplicate subtask rows and duplicate parent groups', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'A' })]);
  const stored = {
    type: 'doc',
    content: [
      { type: 'taskRef', attrs: { taskId: 'a' } },
      { type: 'subTaskRef', attrs: { taskId: 's1' } },
      { type: 'subTaskRef', attrs: { taskId: 's1' } },
      { type: 'subTaskRef', attrs: { taskId: 's2' } },
      { type: 'taskRef', attrs: { taskId: 'a' } },
      { type: 'subTaskRef', attrs: { taskId: 's3' } },
    ],
  };
  const out = reconcileTopLevelTaskRefs(stored, mkCtx({ id: 'P', taskIds: ['a'] }), look);
  assert.deepEqual(summary(out), [
    'taskRef:a',
    'subTaskRef:s1',
    'subTaskRef:s2',
    'paragraph',
  ]);
});

test('reconcile: drops orphan subtasks and keeps non-chip blocks in place', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'A' })]);
  const stored = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: 'intro' }] },
      { type: 'subTaskRef', attrs: { taskId: 'orphan' } },
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'T' }] },
      { type: 'taskRef', attrs: { taskId: 'a' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'mid' }] },
    ],
  };
  const out = reconcileTopLevelTaskRefs(stored, mkCtx({ id: 'P', taskIds: ['a'] }), look);
  // Orphan subtask dropped; intro + heading stay above the chip, mid below it.
  assert.deepEqual(summary(out), [
    'paragraph',
    'heading',
    'taskRef:a',
    'paragraph',
    'paragraph',
  ]);
});

test('reconcile: text inserted between two tasks stays between them', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'A' }),
    mkTask({ id: 'b', title: 'B' }),
  ]);
  const stored = {
    type: 'doc',
    content: [
      { type: 'taskRef', attrs: { taskId: 'a' }, content: [{ type: 'text', text: 'A' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'a note' }] },
      { type: 'taskRef', attrs: { taskId: 'b' }, content: [{ type: 'text', text: 'B' }] },
    ],
  };
  const out = reconcileTopLevelTaskRefs(
    stored,
    mkCtx({ id: 'P', taskIds: ['a', 'b'] }),
    look,
  );
  assert.deepEqual(summary(out), ['taskRef:a', 'paragraph', 'taskRef:b', 'paragraph']);
  assert.equal(chipText(childAt(out, 1)), 'a note');
});

test('reconcile: an anchored block follows its chip when ctx reorders', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'A' }),
    mkTask({ id: 'b', title: 'B' }),
  ]);
  const stored = {
    type: 'doc',
    content: [
      { type: 'taskRef', attrs: { taskId: 'a' } },
      { type: 'paragraph', content: [{ type: 'text', text: 'under a' }] },
      { type: 'taskRef', attrs: { taskId: 'b' } },
    ],
  };
  // Context order is now b, a — the note must travel with its anchor (a).
  const out = reconcileTopLevelTaskRefs(
    stored,
    mkCtx({ id: 'P', taskIds: ['b', 'a'] }),
    look,
  );
  assert.deepEqual(summary(out), ['taskRef:b', 'taskRef:a', 'paragraph', 'paragraph']);
});

test('reconcile: appends a trailing paragraph when the doc ends with a chip', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'A' })]);
  const stored = { type: 'doc', content: [{ type: 'taskRef', attrs: { taskId: 'a' } }] };
  const out = reconcileTopLevelTaskRefs(stored, mkCtx({ id: 'P', taskIds: ['a'] }), look);
  assert.deepEqual(summary(out), ['taskRef:a', 'paragraph']);
});

test('reconcile: returns the input untouched when it is not a doc node', () => {
  const notADoc = { type: 'paragraph' };
  assert.equal(
    reconcileTopLevelTaskRefs(notADoc, mkCtx({ id: 'P' }), mkLookup([])),
    notADoc,
  );
  assert.equal(reconcileTopLevelTaskRefs(null, mkCtx({ id: 'P' }), mkLookup([])), null);
});

/* -------------------------------------------------------------------------- */
/* ensureSubtasksInJSON                                                        */
/* -------------------------------------------------------------------------- */

test('ensureSubtasksInJSON: backfills host subtasks missing from the doc', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'A', subTaskIds: ['s1', 's2'] }),
    mkTask({ id: 's1', title: 'S1' }),
    mkTask({ id: 's2', title: 'S2' }),
  ]);
  const doc = { type: 'doc', content: [{ type: 'taskRef', attrs: { taskId: 'a' } }] };
  const out = ensureSubtasksInJSON(doc, look);
  assert.deepEqual(summary(out), ['taskRef:a', 'subTaskRef:s1', 'subTaskRef:s2']);
});

test('ensureSubtasksInJSON: idempotent — keeps existing rows, adds only the gaps', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'A', subTaskIds: ['s1', 's2'] }),
    mkTask({ id: 's1', title: 'S1' }),
    mkTask({ id: 's2', title: 'S2' }),
  ]);
  const doc = {
    type: 'doc',
    content: [
      { type: 'taskRef', attrs: { taskId: 'a' } },
      { type: 'subTaskRef', attrs: { taskId: 's1' } },
    ],
  };
  const out = ensureSubtasksInJSON(doc, look);
  assert.deepEqual(summary(out), ['taskRef:a', 'subTaskRef:s1', 'subTaskRef:s2']);
});

test('ensureSubtasksInJSON: skips subtasks the host does not know yet', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'A', subTaskIds: ['s1', 'ghost'] }),
    mkTask({ id: 's1', title: 'S1' }),
  ]);
  const doc = { type: 'doc', content: [{ type: 'taskRef', attrs: { taskId: 'a' } }] };
  const out = ensureSubtasksInJSON(doc, look);
  assert.deepEqual(summary(out), ['taskRef:a', 'subTaskRef:s1']);
});

/* -------------------------------------------------------------------------- */
/* refreshChipContentFromCache                                                 */
/* -------------------------------------------------------------------------- */

test('refreshChipContentFromCache: replaces stale title + isDone from the lookup', () => {
  const look = mkLookup([mkTask({ id: 'a', title: 'New title', isDone: true })]);
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'taskRef',
        attrs: { taskId: 'a', isDone: false },
        content: [{ type: 'text', text: 'Stale title' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'untouched' }] },
    ],
  };
  const out = refreshChipContentFromCache(doc, look) as PMNode;
  assert.equal(chipText(childAt(out, 0)), 'New title');
  assert.equal(childAt(out, 0).attrs?.isDone, true);
  assert.equal(chipText(childAt(out, 1)), 'untouched');
});

test('refreshChipContentFromCache: leaves chips whose task is unknown', () => {
  const doc = {
    type: 'doc',
    content: [
      {
        type: 'taskRef',
        attrs: { taskId: 'gone' },
        content: [{ type: 'text', text: 'last known' }],
      },
    ],
  };
  const out = refreshChipContentFromCache(doc, mkLookup([])) as PMNode;
  assert.equal(chipText(childAt(out, 0)), 'last known');
});

/* -------------------------------------------------------------------------- */
/* prepareStoredDoc — end-to-end pipeline / regression guard                   */
/* -------------------------------------------------------------------------- */

test('prepareStoredDoc: migrates, reconciles, backfills subtasks and refreshes titles', () => {
  const look = mkLookup([
    mkTask({ id: 'a', title: 'Alpha', subTaskIds: ['s1'] }),
    mkTask({ id: 's1', title: 'Sub one' }),
    mkTask({ id: 'b', title: 'Beta' }),
  ]);
  const stored = {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: 'My Project' }],
      },
      // Old atom shape — no content array.
      { type: 'taskRef', attrs: { taskId: 'a' } },
      // Duplicate parent group — must be discarded.
      { type: 'taskRef', attrs: { taskId: 'a' }, content: [{ type: 'text', text: 'A' }] },
      // Stale chip for a task no longer in the context.
      {
        type: 'taskRef',
        attrs: { taskId: 'old' },
        content: [{ type: 'text', text: 'gone' }],
      },
      { type: 'paragraph', content: [{ type: 'text', text: 'a note' }] },
    ],
  };
  const out = prepareStoredDoc(
    stored,
    mkCtx({ id: 'P', taskIds: ['a', 'b'] }),
    look,
  ) as PMNode;

  // 'a note' was anchored to the stale 'old' chip; with that chip dropped it
  // is kept (appended), followed by the structural trailing paragraph.
  assert.deepEqual(summary(out), [
    'heading',
    'taskRef:a',
    'subTaskRef:s1',
    'taskRef:b',
    'paragraph',
    'paragraph',
  ]);
  // Every chip carries current host content — the invariant whose violation
  // caused content-less chips to be written back as title erasures.
  assert.equal(chipText(childAt(out, 1)), 'Alpha');
  assert.equal(chipText(childAt(out, 2)), 'Sub one');
  assert.equal(chipText(childAt(out, 3)), 'Beta');
  assert.equal(chipText(childAt(out, 4)), 'a note');
});

/* -------------------------------------------------------------------------- */
/* isInContext                                                                 */
/* -------------------------------------------------------------------------- */

test('isInContext: PROJECT matches on projectId', () => {
  const ctx = mkCtx({ id: 'P1', type: 'PROJECT' });
  assert.equal(isInContext(mkTask({ id: 't', projectId: 'P1' }), ctx), true);
  assert.equal(isInContext(mkTask({ id: 't', projectId: 'P2' }), ctx), false);
});

test('isInContext: subtasks never surface at the top level', () => {
  const ctx = mkCtx({ id: 'P1', type: 'PROJECT' });
  assert.equal(
    isInContext(mkTask({ id: 't', projectId: 'P1', parentId: 'a' }), ctx),
    false,
  );
});

test('isInContext: TODAY accepts the TODAY tag, a dueDay or a dueWithTime', () => {
  const today = mkCtx({ id: 'TODAY', type: 'TAG' });
  assert.equal(isInContext(mkTask({ id: 't', tagIds: ['TODAY'] }), today), true);
  assert.equal(isInContext(mkTask({ id: 't', dueDay: '2026-05-22' }), today), true);
  assert.equal(isInContext(mkTask({ id: 't', dueWithTime: 1_700_000_000 }), today), true);
  assert.equal(isInContext(mkTask({ id: 't' }), today), false);
});

test('isInContext: TAG matches on tagIds membership', () => {
  const ctx = mkCtx({ id: 'work', type: 'TAG' });
  assert.equal(isInContext(mkTask({ id: 't', tagIds: ['work'] }), ctx), true);
  assert.equal(isInContext(mkTask({ id: 't', tagIds: ['home'] }), ctx), false);
});

/* -------------------------------------------------------------------------- */
/* snapshotInContextTaskIds                                                    */
/* -------------------------------------------------------------------------- */

test('snapshotInContextTaskIds: includes in-context parents and their subtask ids', () => {
  const tasks = [
    mkTask({ id: 'a', projectId: 'P1', subTaskIds: ['s1', 's2'] }),
    mkTask({ id: 's1', projectId: 'P1', parentId: 'a' }),
    mkTask({ id: 's2', projectId: 'P1', parentId: 'a' }),
    mkTask({ id: 'b', projectId: 'P2', subTaskIds: ['s3'] }),
    mkTask({ id: 's3', projectId: 'P2', parentId: 'b' }),
  ];
  const snapshot = snapshotInContextTaskIds(tasks, mkCtx({ id: 'P1', type: 'PROJECT' }));
  assert.deepEqual([...snapshot].sort(), ['a', 's1', 's2']);
});
