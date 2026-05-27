/**
 * Pure document-transform helpers for Document Mode.
 *
 * Everything here operates on plain ProseMirror-JSON (`PMNode`) and a task
 * lookup function — no TipTap editor, no DOM, no module-global cache. That
 * keeps the load-time pipeline (`prepareStoredDoc`) and the context filter
 * (`isInContext`) unit-testable in plain Node; see `doc-transform.spec.ts`.
 *
 * The editor (`ui/editor.ts`) owns the live `taskCache` Map and passes
 * `(id) => taskCache.get(id)` as the `TaskLookup` argument.
 */

import type { ActiveWorkContext, Task } from '@super-productivity/plugin-api';

/** Resolves a task id to the host's current task, or `undefined` if unknown. */
export type TaskLookup = (taskId: string) => Task | undefined;

export type PMText = { type: 'text'; text: string };
export type PMNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: (PMNode | PMText)[];
  text?: string;
};

/* -------------------------------------------------------------------------- */
/* Node builders                                                               */
/* -------------------------------------------------------------------------- */

/**
 * Build a single chip node. Task title is pulled from the lookup so the
 * `taskRef` / `subTaskRef` carries inline content, not just an id — a chip
 * inserted without content reads back as an empty title and would be written
 * back to the host as a title erasure (see `reconcileTitlesFromDoc`).
 */
export const taskNodeJSON = (
  taskId: string,
  variant: 'taskRef' | 'subTaskRef',
  getTask: TaskLookup,
): PMNode => {
  const task = getTask(taskId);
  const title = task?.title || '';
  return {
    type: variant,
    attrs: { taskId, isDone: !!task?.isDone },
    content: title ? [{ type: 'text', text: title }] : [],
  };
};

/** A parent chip followed by one `subTaskRef` per host subtask. */
export const taskRefWithSubtasksJSON = (
  taskId: string,
  getTask: TaskLookup,
): PMNode[] => {
  const task = getTask(taskId);
  const out: PMNode[] = [taskNodeJSON(taskId, 'taskRef', getTask)];
  for (const subId of task?.subTaskIds ?? []) {
    out.push(taskNodeJSON(subId, 'subTaskRef', getTask));
  }
  return out;
};

/** Build a fresh doc for a context that has no stored doc yet. */
export const buildSeedDoc = (ctx: ActiveWorkContext, getTask: TaskLookup): PMNode => ({
  type: 'doc',
  content: [
    {
      type: 'heading',
      attrs: { level: 1 },
      content: [{ type: 'text', text: ctx.title }],
    },
    ...ctx.taskIds.flatMap((id) => taskRefWithSubtasksJSON(id, getTask)),
    { type: 'paragraph' },
  ],
});

/* -------------------------------------------------------------------------- */
/* Stored-doc pipeline                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Older docs stored taskRef as an atom node (no `content` array). Walk the
 * stored JSON and populate content from the task lookup so the new
 * content-bearing schema can load them. Idempotent — nodes that already have
 * content are left alone.
 */
export const migrateStoredDoc = (raw: unknown, getTask: TaskLookup): unknown => {
  const visit = (node: PMNode | PMText | undefined): PMNode | PMText | undefined => {
    if (!node || typeof node !== 'object') return node;
    if ('text' in node) return node;
    if (node.type === 'taskRef' || node.type === 'subTaskRef') {
      const taskId = (node.attrs?.taskId as string) || '';
      const task = getTask(taskId);
      const hasContent = Array.isArray(node.content) && node.content.length > 0;
      return {
        ...node,
        attrs: {
          taskId,
          isDone: (node.attrs?.isDone as boolean) ?? !!task?.isDone,
        },
        content: hasContent
          ? node.content
          : task?.title
            ? [{ type: 'text', text: task.title }]
            : [],
      };
    }
    if (Array.isArray(node.content)) {
      return {
        ...node,
        content: node.content
          .map(visit)
          .filter((n): n is PMNode | PMText => n !== undefined),
      };
    }
    return node;
  };
  return visit(raw as PMNode);
};

/**
 * Strip redundant chip data from a doc before it is serialized to storage.
 *
 * Each `taskRef` / `subTaskRef` chip carries inline title text (`content`)
 * and an `isDone` attr, but on load both are re-derived from the host task
 * cache: `migrateStoredDoc` backfills missing `content` and `refreshChipContentFromCache`
 * overwrites both unconditionally. Persisting them is therefore dead weight in
 * the synced payload — and the title is the byte-heavy, variable-length part.
 * This collapses every chip to a bare identity atom `{ type, attrs: { taskId } }`.
 *
 * Pure: returns new objects, never mutates `doc`. It runs only on the
 * serialized copy (`editor.getJSON()` returns a fresh object); the live
 * editor document keeps its inline content, so title write-back
 * (`reconcileTitlesFromDoc`, which reads the live doc) is unaffected.
 */
export const stripChipContent = (doc: unknown): unknown => {
  const visit = (node: PMNode | PMText | undefined): PMNode | PMText | undefined => {
    if (!node || typeof node !== 'object') return node;
    if ('text' in node) return node;
    if (node.type === 'taskRef' || node.type === 'subTaskRef') {
      return {
        type: node.type,
        attrs: { taskId: (node.attrs?.taskId as string) || '' },
      };
    }
    if (Array.isArray(node.content)) {
      return {
        ...node,
        content: node.content
          .map(visit)
          .filter((n): n is PMNode | PMText => n !== undefined),
      };
    }
    return node;
  };
  return visit(doc as PMNode);
};

/** A paragraph with no inline content — the editor's structural landing line. */
const isEmptyParagraph = (n: PMNode | PMText): boolean => {
  const node = n as PMNode;
  return (
    node.type === 'paragraph' &&
    (!Array.isArray(node.content) || node.content.length === 0)
  );
};

/**
 * Rebuild the doc against the current context.
 *
 *  - Top-level chip ORDER comes from `ctx.taskIds` (the host's canonical
 *    order for the view): TODAY re-sorts daily, and reorders done in the
 *    regular task view must win. Stale chips (not in `ctx`) are dropped, new
 *    ones appended; duplicate parent groups and subtask rows are de-duped.
 *  - Non-chip blocks (paragraphs, headings, lists, quotes, dividers) keep
 *    their POSITION: each is anchored to the chip group it follows in the
 *    stored doc and re-emitted directly after that group; blocks before the
 *    first chip stay at the top. This is what stops text the user typed
 *    *between* two tasks from collapsing to the bottom of the doc.
 *
 * A block whose anchor chip has left the context loses its anchor and is
 * appended after the last chip (kept, not dropped).
 */
export const reconcileTopLevelTaskRefs = (
  doc: unknown,
  ctx: ActiveWorkContext,
  getTask: TaskLookup,
): unknown => {
  const root = doc as PMNode;
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return doc;
  const src = root.content as (PMNode | PMText)[];

  // Trailing empty paragraphs are the editor's structural landing line, not
  // content. Ignore them here and re-add exactly one at the end, so they
  // cannot pile up mid-doc when chips get reordered.
  let end = src.length;
  while (end > 0 && isEmptyParagraph(src[end - 1])) end--;

  // Pass 1: index chip groups by parent taskId (de-duping subtask rows), and
  // anchor every non-chip block to the taskId of the chip group before it
  // (`null` = before any chip).
  const storedGroups = new Map<string, PMNode[]>();
  const leadingBlocks: (PMNode | PMText)[] = [];
  const blocksAfter = new Map<string, (PMNode | PMText)[]>();
  let anchor: string | null = null;

  let i = 0;
  while (i < end) {
    const node = src[i] as PMNode;
    if (node.type === 'taskRef') {
      const taskId = (node.attrs?.taskId as string) || '';
      const group: PMNode[] = [node];
      const seenSubs = new Set<string>();
      let j = i + 1;
      while (j < end && (src[j] as PMNode).type === 'subTaskRef') {
        const subId = ((src[j] as PMNode).attrs?.taskId as string) || '';
        if (subId && !seenSubs.has(subId)) {
          seenSubs.add(subId);
          group.push(src[j] as PMNode);
        }
        j++;
      }
      // First stored group for a parent wins; later duplicates are dropped.
      if (taskId && !storedGroups.has(taskId)) storedGroups.set(taskId, group);
      if (taskId) anchor = taskId;
      i = j;
    } else if (node.type === 'subTaskRef') {
      // Orphan subtask (no preceding parent) — drop it.
      i++;
    } else {
      // Any non-chip block — keep it anchored to the preceding chip group.
      if (anchor === null) {
        leadingBlocks.push(node);
      } else {
        const arr = blocksAfter.get(anchor);
        if (arr) arr.push(node);
        else blocksAfter.set(anchor, [node]);
      }
      i++;
    }
  }

  // Pass 2: rebuild in ctx order, re-emitting each group's anchored blocks
  // straight after it.
  const out: (PMNode | PMText)[] = [...leadingBlocks];
  const ctxIds = new Set(ctx.taskIds);
  for (const id of ctx.taskIds) {
    const group = storedGroups.get(id) ?? taskRefWithSubtasksJSON(id, getTask);
    for (const n of group) out.push(n);
    const after = blocksAfter.get(id);
    if (after) for (const n of after) out.push(n);
  }
  // Blocks whose anchor chip is no longer in the context — keep, don't drop.
  for (const [taskId, blocks] of blocksAfter) {
    if (!ctxIds.has(taskId)) for (const n of blocks) out.push(n);
  }
  // Exactly one trailing empty paragraph so the cursor always has a home.
  out.push({ type: 'paragraph' });
  return { ...root, content: out };
};

/**
 * Walk the top-level content and insert any subTaskRefs from the host that
 * aren't already present right after their parent taskRef. Idempotent —
 * existing subtask blocks are preserved.
 */
export const ensureSubtasksInJSON = (doc: unknown, getTask: TaskLookup): unknown => {
  const root = doc as PMNode;
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return doc;
  const src = root.content as (PMNode | PMText)[];
  const out: (PMNode | PMText)[] = [];
  let i = 0;
  while (i < src.length) {
    const node = src[i];
    out.push(node);
    if ((node as PMNode).type === 'taskRef') {
      const parentId = ((node as PMNode).attrs?.taskId as string) || '';
      const parent = getTask(parentId);
      const existing = new Set<string>();
      let j = i + 1;
      while (j < src.length && (src[j] as PMNode).type === 'subTaskRef') {
        out.push(src[j]);
        existing.add(((src[j] as PMNode).attrs?.taskId as string) || '');
        j++;
      }
      if (parent?.subTaskIds) {
        for (const subId of parent.subTaskIds) {
          if (!subId || existing.has(subId)) continue;
          // Skip subs not known to the host yet — they would render as empty
          // "ghost" rows. They show up live via onAnyTaskUpdate instead.
          if (!getTask(subId)) continue;
          out.push(taskNodeJSON(subId, 'subTaskRef', getTask));
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return { ...root, content: out };
};

/**
 * Final pass before loading: replace each chip's inline title text and
 * `isDone` attr with the current values from the task lookup. Without this,
 * stored chip nodes keep the title they had at the last save and look stale
 * after any external edit (host UI in another view, sync from server, app
 * reload) — there is no other refresh path during context load.
 *
 * Trade-off: if the user was typing in a chip and switched contexts before
 * the 600 ms write-back fired, those typed characters are overwritten by the
 * looked-up title on return. The pending timer is already cleared in
 * setActiveContext, so the host never saw that typing anyway — this just
 * makes the doc match the host.
 */
export const refreshChipContentFromCache = (
  doc: unknown,
  getTask: TaskLookup,
): unknown => {
  const root = doc as PMNode;
  if (!root || root.type !== 'doc' || !Array.isArray(root.content)) return doc;
  const refreshed = (root.content as (PMNode | PMText)[]).map((n) => {
    const node = n as PMNode;
    if (node.type !== 'taskRef' && node.type !== 'subTaskRef') return node;
    const taskId = (node.attrs?.taskId as string) || '';
    if (!taskId) return node;
    const task = getTask(taskId);
    if (!task) return node;
    const title = task.title || '';
    return {
      ...node,
      attrs: { ...(node.attrs ?? {}), taskId, isDone: !!task.isDone },
      content: title ? [{ type: 'text', text: title }] : [],
    };
  });
  return { ...root, content: refreshed };
};

/**
 * Pipeline applied to a stored doc before loading it into TipTap. Order
 * matters: schema migration first (canonicalises old taskRef shapes), then
 * top-level reconciliation against the current ctx (drops stale chips,
 * appends new ones), then subtask backfill (inserts host subtasks under each
 * kept parent), and finally a content refresh so every chip's title matches
 * the current host state rather than the stored snapshot.
 */
export const prepareStoredDoc = (
  raw: unknown,
  ctx: ActiveWorkContext,
  getTask: TaskLookup,
): unknown =>
  refreshChipContentFromCache(
    ensureSubtasksInJSON(
      reconcileTopLevelTaskRefs(migrateStoredDoc(raw, getTask), ctx, getTask),
      getTask,
    ),
    getTask,
  );

/* -------------------------------------------------------------------------- */
/* Context membership                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Does `task` belong to the given work context? Matches the host's
 * view-level filter:
 *  - PROJECT: task.projectId equals ctx.id
 *  - TODAY:   task has the TODAY tag OR a dueDay OR a dueWithTime
 *  - TAG:     task.tagIds contains ctx.id
 *
 * Subtasks (task.parentId set) are *not* surfaced at the top level — they
 * follow their parent.
 */
export const isInContext = (task: Task, ctx: ActiveWorkContext): boolean => {
  if (task.parentId) return false;
  if (ctx.type === 'PROJECT') return task.projectId === ctx.id;
  if (ctx.id === 'TODAY') {
    return !!task.tagIds?.includes('TODAY') || !!task.dueDay || !!task.dueWithTime;
  }
  if (ctx.type === 'TAG') return !!task.tagIds?.includes(ctx.id);
  return false;
};

/**
 * Set of task ids that the doc for `ctx` should currently contain: every
 * in-context top-level task plus the ids of its subtasks. `onAnyTaskUpdate`
 * diffs successive snapshots to detect a task (or subtask) transitioning
 * into the context and append a fresh chip for it.
 */
export const snapshotInContextTaskIds = (
  tasks: Iterable<Task>,
  ctx: ActiveWorkContext,
): Set<string> => {
  const ids = new Set<string>();
  for (const t of tasks) {
    if (!isInContext(t, ctx)) continue;
    ids.add(t.id);
    for (const subId of t.subTaskIds ?? []) ids.add(subId);
  }
  return ids;
};
