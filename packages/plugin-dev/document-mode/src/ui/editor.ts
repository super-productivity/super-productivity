/**
 * Document-Mode editor — runs inside the plugin iframe. Notion-style UX:
 * inline bubble menu on text selection, block hover gutter with insert
 * (`+`) and grip (`⋮⋮`) buttons, slash menu for inserts and turn-into,
 * and a custom taskRef atom node tied to Super Productivity tasks.
 */

import { Editor } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { NodeSelection } from '@tiptap/pm/state';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import BubbleMenu from '@tiptap/extension-bubble-menu';
import {
  PluginHooks,
  type ActiveWorkContext,
  type AnyTaskUpdatePayload,
  type PluginAPI,
  type Task,
  type WorkContextChangePayload,
} from '@super-productivity/plugin-api';
import {
  buildSeedDoc,
  prepareStoredDoc,
  snapshotInContextTaskIds,
  stripChipContent,
  taskNodeJSON,
  taskRefWithSubtasksJSON,
  type TaskLookup,
} from '../doc-transform';
import {
  loadContextDoc,
  migrateToKeyedPersistence,
  saveContextDoc,
} from '../persistence';
import { iconSvg } from './icons';
import * as docNav from './doc-nav';
import { createTaskRefNode, type TaskRefNodeDeps } from './task-ref-node';

declare const PluginAPI: PluginAPI;

// Save cadence. This is a *throttle*, not a debounce: a debounce would never
// fire for a continuous typist, and the host tears the embed iframe down on
// every work-context switch. The throttle bounds op-rate during typing; the
// real safety net against data loss is the set of flush triggers wired up in
// mount(): `visibilitychange`, `blur`, `pagehide`, `unload`, plus the
// explicit `flushSaveSync` on work-context change. Together those cover
// every non-crash "user is done editing for now" moment, so the throttle
// ceiling is only paid on actual process termination without any of those
// firing. Kept above the host's 1 s persist rate limit
// (MIN_PLUGIN_PERSIST_INTERVAL_MS) so saves aren't rejected.
const SAVE_THROTTLE_MS = 30_000;

// Action type the host emits for an in-place single-task update (NgRx
// `createActionGroup`, source 'Task Shared'). `onAnyTaskUpdate` uses it to
// fast-path the common edit case past a full `getTasks()` round-trip. A
// drift in this string degrades safely — the fast path is skipped and the
// always-correct full refresh runs instead.
const UPDATE_TASK_ACTION = '[Task Shared] Update Task';

let currentCtx: ActiveWorkContext | null = null;
let taskCache = new Map<string, Task>();
/**
 * Stable task lookup handed to the pure `doc-transform` helpers. Defined as
 * an arrow (not `taskCache.get.bind`) so it always reads the *current*
 * `taskCache` binding — `refreshTaskCache` reassigns the Map wholesale.
 */
const lookupTask: TaskLookup = (id) => taskCache.get(id);
let saveTimer: ReturnType<typeof setTimeout> | null = null;
// True from the moment the throttled `flushSave` setTimeout fires until its
// async readBlob+persist round-trip completes. The dirty signal moves from
// `saveTimer` to this flag for the duration, so a teardown that arrives
// mid-flight (pagehide/unload while `await readBlob()` is suspended) still
// triggers the sync safety-net write in `flushSaveSync`.
let saveInFlight = false;
let editor: Editor | null = null;
let isLoadingDoc = false;
// Set when the stored doc for the current ctx failed to parse and we fell
// back to an empty seed. Gates scheduleSave so the empty seed is not
// auto-persisted on top of the original (possibly corrupt) blob.
let isDocCorrupt = false;
// Monotonic guard for setActiveContext: concurrent calls (rapid context
// switches) read this to drop after their awaits if a newer call has
// superseded them.
let activeContextSeq = 0;
// Snapshot of cached task ids at the last `setActiveContext` / external
// task update, used by `onAnyTaskUpdate` to detect *genuinely new* tasks
// (transition absent→present) and avoid re-appending chips the user has
// already removed.
let lastSeenTaskIds = new Set<string>();

/**
 * Safe error log: PluginAPI.log is declared on the type but currently not
 * wired up in the iframe runtime (see plugin-iframe.util.ts). Calling
 * PluginAPI.log.err crashes inside Promise catch handlers, which then
 * surfaces as the user-visible "Cannot read properties of undefined
 * (reading 'err')". Use this helper everywhere instead.
 */
const logErr = (msg: string, err?: unknown): void => {
  try {
    (PluginAPI as { log?: { err?: (...args: unknown[]) => void } }).log?.err?.(msg, err);
  } catch {
    // ignore — fall through to console
  }
  // eslint-disable-next-line no-console
  console.error('[document-mode]', msg, err);
};

/**
 * Tolerant deleteTask: a stale subTaskRef may point at a task that no
 * longer exists in the host (deleted via sync, or never persisted). In
 * that case the host rejects with "Task data not found", which is fine —
 * the user already removed the chip locally. Swallow that specific case;
 * still log anything else.
 */
const deleteTaskTolerant = async (taskId: string): Promise<void> => {
  if (!taskCache.has(taskId)) return;
  try {
    await PluginAPI.deleteTask(taskId);
  } catch (err) {
    const msg = (err as Error)?.message ?? String(err);
    if (/not found/i.test(msg)) return;
    logErr('deleteTask failed', err);
  }
};

/* -------------------------------------------------------------------------- */
/* taskRef node                                                                */
/* -------------------------------------------------------------------------- */

/**
 * taskRef is a content-bearing block node — its inline content IS the task
 * title, so typing inside it edits the linked task. We debounce write-back
 * to PluginAPI.updateTask and reconcile against ANY_TASK_UPDATE events
 * from the host without clobbering an active edit.
 */
/**
 * Seed `taskCache` with a freshly-created task so its chip renders (and is
 * editable) immediately, without waiting for a full `getTasks()` round-trip.
 * The host's ANY_TASK_UPDATE echo for the add reconciles the real entity
 * shortly after; this only bridges the gap so fast typing isn't dropped.
 */
const seedTaskCache = (
  taskId: string,
  title: string,
  ctx: ActiveWorkContext,
  parentId: string | null = null,
): void => {
  if (taskCache.has(taskId)) return;
  taskCache.set(taskId, {
    id: taskId,
    title,
    isDone: false,
    projectId: ctx.type === 'PROJECT' ? ctx.id : null,
    parentId,
    tagIds: [],
    subTaskIds: [],
    timeEstimate: 0,
    timeSpent: 0,
    created: Date.now(),
  });
};

/**
 * Helper invoked from keyboard shortcuts to create a new empty task and
 * insert a taskRef pointing at it. Hoisted so keybindings inside
 * TaskRefNode can call it without needing the editor closure variable
 * (which isn't initialised at extension creation time).
 */
const createTaskAfter = async (insertPos: number): Promise<void> => {
  if (!editor || !currentCtx) return;
  const ctx = currentCtx;
  try {
    const taskId = await PluginAPI.addTask({
      title: '',
      projectId: ctx.type === 'PROJECT' ? ctx.id : null,
    });
    seedTaskCache(taskId, '', ctx);
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, {
        type: 'taskRef',
        attrs: { taskId, isDone: false },
        content: [],
      })
      .run();
    // Cursor lands inside the new chip's empty title; refresh selection.
    editor.commands.focus(insertPos + 1);
  } catch (err) {
    logErr('createTaskAfter failed', err);
  }
};

/**
 * Sibling of createTaskAfter — creates a subtask under `parentTaskId` and
 * inserts a subTaskRef block at insertPos. Used by the subtask Enter handler.
 */
const createSubTaskAfter = async (
  insertPos: number,
  parentTaskId: string,
): Promise<void> => {
  if (!editor || !currentCtx) return;
  const ctx = currentCtx;
  try {
    const taskId = await PluginAPI.addTask({
      title: '',
      parentId: parentTaskId,
      projectId: ctx.type === 'PROJECT' ? ctx.id : null,
    });
    seedTaskCache(taskId, '', ctx, parentTaskId);
    editor
      .chain()
      .focus()
      .insertContentAt(insertPos, {
        type: 'subTaskRef',
        attrs: { taskId, isDone: false },
        content: [],
      })
      .run();
    editor.commands.focus(insertPos + 1);
  } catch (err) {
    logErr('createSubTaskAfter failed', err);
  }
};

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

const flushSave = async (): Promise<void> => {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!currentCtx || !editor) return;
  saveInFlight = true;
  try {
    // Keyed storage (Stage A): write only this context's doc. No need to
    // read+merge any sibling state — the meta entry (enabledCtxIds) lives
    // in its own LWW-resolved entity owned by background.ts, and sibling
    // contexts each have their own `doc:${ctxId}` entry.
    await saveContextDoc(PluginAPI, currentCtx.id, stripChipContent(editor.getJSON()));
  } catch (err) {
    logErr('persistDataSynced failed', err);
  } finally {
    saveInFlight = false;
  }
};

/**
 * Teardown-safe save. The work-context embed iframe is destroyed
 * *synchronously* whenever the active context changes (the host's work-view
 * drops `<plugin-index>` from the DOM while the context is switching), so an
 * awaited save is unusable on the way out: its `persistDataSynced` call may
 * never leave the iframe before it dies. The doc blob is then lost, and
 * because top-level chips are rebuilt from the host's task list on reload,
 * the loss only shows as vanished *text* blocks (paragraphs, headings,
 * dividers).
 *
 * Keyed storage (Stage A) means we no longer need to read+merge before
 * writing — each `doc:${ctxId}` entry stands alone, so the sync path is just
 * "stringify the doc and dispatch". The host transparently compresses the
 * payload on its end (see `plugin-data-codec.ts`).
 */
const flushSaveSync = (): void => {
  // Dirty signal: a timer is pending (edits queued for the throttle window)
  // OR an async flushSave is mid-flight (its dispatch may not have left
  // the iframe yet). Skipping when neither is true avoids a full stringify
  // + gzip on every blur (which fires on any focus shift inside the page).
  if (saveTimer === null && !saveInFlight) return;
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!currentCtx || !editor) return;
  // Same guard as scheduleSave — never overwrite a doc we couldn't read.
  if (isDocCorrupt) return;
  try {
    void saveContextDoc(PluginAPI, currentCtx.id, stripChipContent(editor.getJSON()));
  } catch (err) {
    logErr('persistDataSynced (sync flush) failed', err);
  }
};

const scheduleSave = (): void => {
  if (isLoadingDoc) return;
  // Refuse to persist while the doc is a fallback (loaded from an entry we
  // couldn't parse). Saving here would overwrite the original entry with
  // our empty seed.
  if (isDocCorrupt) return;
  // Throttle: if a save is already pending, leave it — do NOT reschedule.
  // A debounce (reset-on-every-keystroke) would never fire for a continuous
  // typist, and the iframe can be torn down at any moment. This guarantees
  // a save lands at most SAVE_THROTTLE_MS after the first unsaved change.
  if (saveTimer !== null) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    void flushSave();
  }, SAVE_THROTTLE_MS);
};

/* -------------------------------------------------------------------------- */
/* Seed + task sync                                                            */
/* -------------------------------------------------------------------------- */

const refreshTaskCache = async (): Promise<void> => {
  try {
    const tasks = await PluginAPI.getTasks();
    taskCache = new Map(tasks.map((t) => [t.id, t]));
  } catch (err) {
    logErr('getTasks failed', err);
  }
};

/* -------------------------------------------------------------------------- */
/* Document-status banner                                                      */
/* -------------------------------------------------------------------------- */

// Visible notice shown when the stored doc could not be loaded. Without it a
// corrupt / future-version blob renders as a blank editor, which reads as
// silent data loss — the banner makes clear the data is safe and untouched.
let bannerEl: HTMLDivElement | null = null;

const updateDocStatusBanner = (): void => {
  const message = isDocCorrupt
    ? 'This document could not be loaded, so a blank one is shown. Your ' +
      'saved data is untouched; editing is disabled here to protect it.'
    : null;
  if (!message) {
    bannerEl?.remove();
    bannerEl = null;
    return;
  }
  if (!bannerEl) {
    bannerEl = document.createElement('div');
    bannerEl.className = 'doc-banner';
    bannerEl.setAttribute('role', 'status');
    document.body.insertBefore(bannerEl, document.body.firstChild);
  }
  bannerEl.textContent = message;
};

const setActiveContext = async (ctx: ActiveWorkContext | null): Promise<void> => {
  // Take a sequence number for this invocation. If a newer call arrives
  // (rapid context switches), the older one bails after each await so it
  // can't write the previous editor doc under the new context's id.
  const seq = ++activeContextSeq;
  // Synchronous flush: a context change tears this iframe down right away,
  // so an awaited save would not survive long enough to persist.
  flushSaveSync();
  if (seq !== activeContextSeq) return;

  // Drop pending title writes from the previous context — letting them
  // resolve later would mutate `taskCache` against tasks the new context
  // may not even own.
  for (const t of titleWriteTimers.values()) clearTimeout(t);
  titleWriteTimers.clear();
  pendingTitleWrites.clear();
  lastWrittenTitles.clear();

  // Drop any pending chip-reorder write-back — it targets the old context.
  cancelPendingReorder();

  currentCtx = ctx;
  isDocCorrupt = false;
  if (!ctx || !editor) return;

  isLoadingDoc = true;
  await refreshTaskCache();
  if (seq !== activeContextSeq) {
    isLoadingDoc = false;
    return;
  }
  // Snapshot of "tasks already in this context" — onAnyTaskUpdate compares
  // future events against this to detect transitions into the context
  // (a task gaining the TODAY tag, a dueDay being set, etc.).
  lastSeenTaskIds = snapshotInContextTaskIds(taskCache.values(), ctx);

  const stored = await loadContextDoc(PluginAPI, ctx.id);
  if (seq !== activeContextSeq) {
    isLoadingDoc = false;
    return;
  }
  const docJson = stored
    ? prepareStoredDoc(stored, ctx, lookupTask)
    : buildSeedDoc(ctx, lookupTask);
  try {
    editor.commands.setContent(
      docJson as Parameters<typeof editor.commands.setContent>[0],
      false,
    );
  } catch (err) {
    // Parsing the stored blob failed. Don't auto-save the fallback —
    // scheduleSave is gated by isDocCorrupt so the empty seed cannot
    // overwrite the (possibly recoverable) original.
    logErr('setContent failed; suppressing saves to protect blob', err);
    isDocCorrupt = true;
    editor.commands.setContent(
      buildSeedDoc(ctx, lookupTask) as Parameters<typeof editor.commands.setContent>[0],
      false,
    );
  }
  updateDocStatusBanner();
  isLoadingDoc = false;
};

const isTaskNode = (name: string): name is 'taskRef' | 'subTaskRef' =>
  name === 'taskRef' || name === 'subTaskRef';

/**
 * Toggle the done state of a task: write it back to the host and optimistically
 * reflect it on every matching chip's `isDone` attr so the checkmark updates
 * immediately (and the change rides the undo stack) without waiting for the
 * host's `ANY_TASK_UPDATE` echo. Shared by the chip done-toggle and the
 * Mod-Enter keyboard shortcut.
 */
const toggleTaskDone = (taskId: string): void => {
  if (!editor) return;
  const task = taskCache.get(taskId);
  if (!task) return;
  const next = !task.isDone;
  PluginAPI.updateTask(taskId, { isDone: next }).catch((err) => {
    logErr('updateTask failed', err);
  });
  taskCache.set(taskId, { ...task, isDone: next });
  const tr = editor.state.tr;
  editor.state.doc.descendants((node, pos) => {
    if (isTaskNode(node.type.name) && node.attrs.taskId === taskId) {
      tr.setNodeAttribute(pos, 'isDone', next);
      return false;
    }
    return undefined;
  });
  if (tr.docChanged) editor.view.dispatch(tr);
};

/**
 * taskId of the chip the caret currently sits in, or null. Used by the
 * Mod-Enter shortcut; gated on `editor.isFocused` so the shortcut only fires
 * when the editor genuinely owns the selection.
 */
const currentChipTaskId = (): string | null => {
  if (!editor || !editor.isFocused) return null;
  const parent = editor.state.selection.$from.parent;
  if (isTaskNode(parent.type.name)) {
    return (parent.attrs.taskId as string) || null;
  }
  return null;
};

const collectKnownTaskIds = (): Set<string> => {
  const ids = new Set<string>();
  if (!editor) return ids;
  editor.state.doc.descendants((node: ProseMirrorNode): boolean | undefined => {
    if (isTaskNode(node.type.name) && node.attrs.taskId) {
      ids.add(node.attrs.taskId as string);
    }
    return undefined;
  });
  return ids;
};

const appendMissingTask = (taskId: string): void => {
  if (!editor) return;
  if (collectKnownTaskIds().has(taskId)) return;
  // Subtasks should be inserted next to their parent, not at the doc end.
  const task = taskCache.get(taskId);
  if (task?.parentId) {
    insertSubtaskByParent(taskId, task.parentId);
    return;
  }
  // Insert the parent chip *with* its title and any subtasks. Inserting a
  // bare `{ type: 'taskRef' }` leaves the chip with empty inline content,
  // which `reconcileTitlesFromDoc` then writes back to the host as a title
  // erasure on the next `onUpdate`.
  const endPos = editor.state.doc.content.size;
  editor
    .chain()
    .focus(endPos)
    .insertContentAt(
      endPos,
      taskRefWithSubtasksJSON(taskId, lookupTask) as Parameters<
        typeof editor.commands.insertContentAt
      >[1],
    )
    .run();
};

/**
 * Insert a subTaskRef right after the parent's group (parent taskRef +
 * any existing subTaskRefs). No-op if the parent is not in the doc.
 */
const insertSubtaskByParent = (taskId: string, parentTaskId: string): void => {
  if (!editor) return;
  const doc = editor.state.doc;
  let parentEndPos = -1;
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (
      child.type.name === 'taskRef' &&
      (child.attrs.taskId as string) === parentTaskId
    ) {
      parentEndPos = cursor + child.nodeSize;
      // Skip past existing subTaskRefs that belong to this parent.
      let scan = i + 1;
      let scanCursor = parentEndPos;
      while (scan < doc.childCount && doc.child(scan).type.name === 'subTaskRef') {
        scanCursor += doc.child(scan).nodeSize;
        scan++;
      }
      parentEndPos = scanCursor;
      break;
    }
    cursor += child.nodeSize;
  }
  if (parentEndPos < 0) return;
  // Insert with title content from the cache — see appendMissingTask for why
  // a content-less chip would be written back to the host as an empty title.
  editor
    .chain()
    .focus(parentEndPos)
    .insertContentAt(
      parentEndPos,
      taskNodeJSON(taskId, 'subTaskRef', lookupTask) as Parameters<
        typeof editor.commands.insertContentAt
      >[1],
    )
    .run();
};

/**
 * Per-task debouncers for writing edited titles back to the host. Pending
 * writes prevent ANY_TASK_UPDATE echoes from clobbering the user's typing.
 * `lastWrittenTitles` holds the value we last successfully wrote, so we
 * can distinguish our own echo from a genuine remote change in
 * refreshTaskRef.
 */
const titleWriteTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingTitleWrites = new Set<string>();
const lastWrittenTitles = new Map<string, string>();

const writeTitleBack = (taskId: string, newTitle: string): void => {
  const existing = titleWriteTimers.get(taskId);
  if (existing) clearTimeout(existing);
  pendingTitleWrites.add(taskId);
  titleWriteTimers.set(
    taskId,
    setTimeout(() => {
      titleWriteTimers.delete(taskId);
      PluginAPI.updateTask(taskId, { title: newTitle })
        .then(() => {
          // Record what we wrote so refreshTaskRef can recognise the echo
          // and skip it without needing the time-based pendingTitleWrites
          // guard (which races with genuine remote edits).
          lastWrittenTitles.set(taskId, newTitle);
          const cached = taskCache.get(taskId);
          if (cached) taskCache.set(taskId, { ...cached, title: newTitle });
        })
        .catch((err) => {
          logErr('updateTask (title) failed', err);
        })
        .finally(() => {
          // Keep the "pending" marker briefly to absorb the echo from our
          // own write that will arrive via ANY_TASK_UPDATE.
          setTimeout(() => pendingTitleWrites.delete(taskId), 500);
        });
    }, 600),
  );
};

/**
 * Walk all taskRef nodes in the current doc and emit write-backs for any
 * whose inline content drifted from the task cache.
 */
const reconcileTitlesFromDoc = (): void => {
  if (!editor || isLoadingDoc) return;
  editor.state.doc.descendants((node) => {
    if (!isTaskNode(node.type.name)) return;
    const taskId = node.attrs.taskId as string;
    if (!taskId) return;
    const docTitle = node.textContent;
    const cached = taskCache.get(taskId);
    if (!cached) return;
    if (docTitle !== cached.title) {
      writeTitleBack(taskId, docTitle);
    }
  });
};

const isTaskRefFocused = (taskId: string): boolean => {
  if (!editor) return false;
  const { from, to } = editor.state.selection;
  let focused = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (isTaskNode(node.type.name) && node.attrs.taskId === taskId) {
      focused = true;
      return false;
    }
    return undefined;
  });
  return focused;
};

/**
 * Refresh inline content + isDone attr for one taskRef from the cache.
 * Skips nodes that the user is currently editing or that have a pending
 * write-back (so we don't undo their typing).
 *
 * The selection-in-chip check is gated on `editor.isFocused` because
 * `editor.state.selection` persists across DOM-focus changes — without
 * the gate, a chip the user once clicked into stays "focused" forever
 * from this function's perspective, and an external title change
 * (host UI, sync) never propagates back to the chip.
 */
const refreshTaskRef = (taskId: string): void => {
  if (!editor) return;
  if (pendingTitleWrites.has(taskId)) return;
  if (editor.isFocused && isTaskRefFocused(taskId)) return;
  const task = taskCache.get(taskId);
  if (!task) return;

  const updates: { pos: number; nodeSize: number; node: ProseMirrorNode }[] = [];
  editor.state.doc.descendants((node, pos) => {
    if (isTaskNode(node.type.name) && node.attrs.taskId === taskId) {
      updates.push({ pos, nodeSize: node.nodeSize, node });
      return false;
    }
    return undefined;
  });
  if (updates.length === 0) return;

  const tr = editor.state.tr;
  for (const { pos, nodeSize, node } of updates) {
    if (node.attrs.isDone !== !!task.isDone) {
      tr.setNodeAttribute(pos, 'isDone', !!task.isDone);
    }
    if (node.textContent !== task.title) {
      const schema = editor.schema;
      const titleText = task.title || '';
      const newContent = titleText ? schema.text(titleText) : null;
      // Replace inline content of the node: positions are [pos+1, pos+nodeSize-1].
      const from = pos + 1;
      const to = pos + nodeSize - 1;
      if (newContent) {
        tr.replaceWith(from, to, newContent);
      } else {
        tr.delete(from, to);
      }
    }
  }
  if (tr.docChanged) {
    isLoadingDoc = true;
    editor.view.dispatch(tr);
    isLoadingDoc = false;
  }
};

/**
 * Shared tail of `onAnyTaskUpdate`: refresh the affected chip and detect a
 * task transitioning into the current context. Runs against whatever
 * `taskCache` currently holds — the caller decides whether to fully
 * re-fetch first or patch a single entry.
 *
 * Auto-append fires on transitions out→in for THIS context's filter, not
 * for the cache globally. A global check would make a task that exists in
 * another project invisible the moment it gains the TODAY tag (still
 * "known", so no transition detected) — the "today not working" symptom.
 * Per-context scoping fixes that and still avoids a chip-replay storm
 * (an already-in-context task stays in-context → `wasInCtx` true → no
 * append).
 */
const processTaskUpdate = (
  payload: AnyTaskUpdatePayload,
  ctxSnapshot: ActiveWorkContext,
): void => {
  if (payload.taskId) refreshTaskRef(payload.taskId);
  const newInCtx = snapshotInContextTaskIds(taskCache.values(), ctxSnapshot);
  if (payload.task && payload.taskId) {
    const wasInCtx = lastSeenTaskIds.has(payload.taskId);
    const isInCtx = newInCtx.has(payload.taskId);
    lastSeenTaskIds = newInCtx;
    if (!wasInCtx && isInCtx) appendMissingTask(payload.taskId);
  } else {
    // Deletion or non-payload event — refresh the snapshot so future
    // transitions are detected against the new state.
    lastSeenTaskIds = newInCtx;
  }
};

const onAnyTaskUpdate = (payload: AnyTaskUpdatePayload): void => {
  if (!currentCtx || !editor) return;
  const ctxSnapshot = currentCtx;

  // Fast path: an in-place single-task update for a task we already hold.
  // `getTasks()` returns ALL tasks, so a cache hit means no genuinely new
  // task can be hiding, and `handleUpdateTask` mutates only that one task
  // entity. Patch the single entry and skip the round-trip. Adds, deletes,
  // subtask moves and unknown tasks still take the full refresh — a new
  // task or a sibling reorder is not visible from `payload.task` alone.
  if (
    payload.action === UPDATE_TASK_ACTION &&
    payload.task &&
    payload.taskId &&
    taskCache.has(payload.taskId)
  ) {
    taskCache.set(payload.taskId, payload.task);
    processTaskUpdate(payload, ctxSnapshot);
    return;
  }

  void refreshTaskCache().then(() => processTaskUpdate(payload, ctxSnapshot));
};

/* -------------------------------------------------------------------------- */
/* Slash menu + block menu (Notion-style)                                      */
/* -------------------------------------------------------------------------- */

interface MenuItem {
  label: string;
  icon: string;
  hint?: string;
  action: () => void;
}

const insertItems = (): MenuItem[] => {
  if (!editor) return [];
  const ed = editor;
  return [
    {
      label: 'Paragraph',
      icon: 'segment',
      action: () => ed.chain().focus().setParagraph().run(),
    },
    {
      label: 'Heading 1',
      icon: 'title',
      hint: '#',
      action: () => ed.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      icon: 'text_fields',
      hint: '##',
      action: () => ed.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      label: 'Heading 3',
      icon: 'short_text',
      hint: '###',
      action: () => ed.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      label: 'Bullet list',
      icon: 'format_list_bulleted',
      hint: '-',
      action: () => ed.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: 'format_list_numbered',
      hint: '1.',
      action: () => ed.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      icon: 'format_quote',
      hint: '>',
      action: () => ed.chain().focus().setBlockquote().run(),
    },
    {
      label: 'Code block',
      icon: 'code',
      hint: '```',
      action: () => ed.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: 'Divider',
      icon: 'horizontal_rule',
      hint: '---',
      action: () => ed.chain().focus().setHorizontalRule().run(),
    },
    {
      label: 'New task',
      icon: 'check_circle_outline',
      action: async () => {
        if (slashActionInFlight) return;
        const ctxAtStart = currentCtx;
        if (!ctxAtStart) return;
        slashActionInFlight = true;
        try {
          const taskId = await PluginAPI.addTask({
            title: '',
            projectId: ctxAtStart.type === 'PROJECT' ? ctxAtStart.id : null,
          });
          seedTaskCache(taskId, '', ctxAtStart);
          // Skip the doc insert if the user switched contexts during the
          // host round-trip — the task is still saved in the host, it just
          // doesn't belong in this editor doc.
          if (currentCtx?.id === ctxAtStart.id) {
            const insertPos = ed.state.selection.from;
            ed.chain()
              .focus()
              .insertContent(
                taskNodeJSON(taskId, 'taskRef', lookupTask) as Parameters<
                  typeof ed.commands.insertContent
                >[0],
              )
              .run();
            // Land the caret inside the new empty chip so the user types the
            // title straight away (mirrors the Enter-to-create behaviour).
            ed.commands.focus(insertPos + 1);
          }
        } finally {
          slashActionInFlight = false;
        }
      },
    },
  ];
};

// Re-entrance guard for awaited slash-menu actions (e.g. "New task").
// The menu closes before the action awaits its host round-trip; without
// this, a second fast trigger could double-create a task or insert into
// a stale context.
let slashActionInFlight = false;

let menuEl: HTMLDivElement | null = null;
let menuActiveIndex = 0;
let menuFilter = '';
let menuCurrentItems: MenuItem[] = [];
// Doc position of the `/` that opened a slash-triggered menu, or null when
// the menu was opened some other way (gutter "+", block menu). When set,
// picking an item first deletes the `/query` text the user typed.
let slashQueryFrom: number | null = null;

const closeMenu = (): void => {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  menuFilter = '';
  menuActiveIndex = 0;
  menuCurrentItems = [];
  slashQueryFrom = null;
};

/**
 * Run a chosen menu item. For a slash-triggered menu, first delete the
 * literal `/query` text the user typed — the `/` and every filter character
 * land in the doc as ordinary input, so picking "Heading 1" would otherwise
 * leave "/head" behind inside the new heading.
 */
const runMenuItem = (action: () => void): void => {
  if (slashQueryFrom !== null && editor) {
    const to = editor.state.selection.from;
    const from = Math.min(slashQueryFrom, to);
    if (to > from) {
      try {
        editor.chain().focus().deleteRange({ from, to }).run();
      } catch {
        // Position no longer maps (doc changed under us) — leave the text.
      }
    }
  }
  closeMenu();
  action();
};

/**
 * Position a popover relative to an anchor rect. Default opens below; flips
 * above when there isn't room. The anchor rect is viewport-relative; we add
 * scrollX/Y because the popover is `position: absolute` in document space.
 * Set styles BEFORE measuring offsetHeight so the first paint is at the
 * final spot (no visual flicker).
 */
const positionPopover = (el: HTMLElement, rect: DOMRect): void => {
  el.style.left = `${rect.left + window.scrollX}px`;
  el.style.top = `${rect.bottom + window.scrollY + 4}px`;
  el.style.visibility = 'hidden';
  document.body.appendChild(el);
  const h = el.offsetHeight;
  const overflowsBelow = rect.bottom + 4 + h > window.innerHeight;
  const fitsAbove = rect.top - 4 - h > 0;
  if (overflowsBelow && fitsAbove) {
    el.style.top = `${rect.top + window.scrollY - 4 - h}px`;
  }
  el.style.visibility = '';
};

const renderMenu = (rect: DOMRect, items: MenuItem[]): void => {
  if (menuEl) menuEl.remove();
  menuCurrentItems = items;
  if (items.length === 0) {
    menuEl = document.createElement('div');
    menuEl.className = 'slash-menu';
    const empty = document.createElement('div');
    empty.className = 'slash-menu-empty';
    empty.textContent = 'No matches';
    menuEl.appendChild(empty);
    positionPopover(menuEl, rect);
    return;
  }
  menuEl = document.createElement('div');
  menuEl.className = 'slash-menu';
  menuEl.setAttribute('role', 'listbox');
  items.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'slash-menu-item';
    el.setAttribute('role', 'option');
    const isActive = idx === menuActiveIndex;
    el.classList.toggle('is-active', isActive);
    el.setAttribute('aria-selected', isActive ? 'true' : 'false');
    // Icon is a constant string we control (SVG path map), so innerHTML is
    // safe; label/hint may come from task titles or other dynamic sources
    // so build those as text nodes to avoid an XSS vector.
    el.innerHTML = iconSvg(item.icon, 'slash-menu-icon');
    const labelEl = document.createElement('span');
    labelEl.className = 'slash-menu-label';
    labelEl.textContent = item.label;
    el.appendChild(labelEl);
    if (item.hint) {
      const hintEl = document.createElement('span');
      hintEl.className = 'slash-menu-hint';
      hintEl.textContent = item.hint;
      el.appendChild(hintEl);
    }
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      runMenuItem(item.action);
    });
    el.addEventListener('mouseenter', () => {
      menuActiveIndex = idx;
      menuEl?.querySelectorAll('.slash-menu-item').forEach((n, i) => {
        const on = i === idx;
        n.classList.toggle('is-active', on);
        n.setAttribute('aria-selected', on ? 'true' : 'false');
      });
    });
    menuEl!.appendChild(el);
  });
  positionPopover(menuEl, rect);
  // Keep the keyboard-active item visible when the list scrolls.
  menuEl.querySelector('.slash-menu-item.is-active')?.scrollIntoView({
    block: 'nearest',
  });
};

/**
 * Selection rect for the slash menu. `getRangeAt(0).getBoundingClientRect()`
 * returns a zero-sized rect at (0,0) for empty blocks (e.g. the paragraph
 * we just inserted from the gutter "+"), which would place the menu in
 * the top-left of the iframe. ProseMirror's `coordsAtPos` always returns
 * useful coords, so prefer that when possible.
 */
const caretRect = (): DOMRect => {
  if (editor) {
    try {
      const c = editor.view.coordsAtPos(editor.state.selection.from);
      return new DOMRect(c.left, c.top, 0, c.bottom - c.top);
    } catch {
      // fall through to selection-based rect
    }
  }
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    return sel.getRangeAt(0).getBoundingClientRect();
  }
  return new DOMRect(0, 0, 0, 0);
};

/**
 * Open the insert menu. `slashTriggered` records whether a literal `/` was
 * typed (so `runMenuItem` knows to delete the `/query` text on pick); the
 * gutter "+" button opens the same menu without a slash to remove.
 */
const showSlashMenu = (slashTriggered: boolean): void => {
  if (!editor) return;
  menuActiveIndex = 0;
  menuFilter = '';
  slashQueryFrom = slashTriggered ? Math.max(0, editor.state.selection.from - 1) : null;
  renderMenu(caretRect(), insertItems());
};

const filterAndRender = (rect: DOMRect): void => {
  const items = insertItems().filter((i) =>
    i.label.toLowerCase().includes(menuFilter.toLowerCase()),
  );
  if (menuActiveIndex >= items.length) menuActiveIndex = 0;
  renderMenu(rect, items);
};

/* -------------------------------------------------------------------------- */
/* Block hover gutter (Notion-style + / drag handle)                           */
/* -------------------------------------------------------------------------- */

let gutterEl: HTMLDivElement | null = null;
let hoveredBlock: HTMLElement | null = null;
let hideGutterTimer: ReturnType<typeof setTimeout> | null = null;

// Drag-and-drop state for grip-based block reordering. We drive this via
// pointer events rather than the HTML5 drag API — the native API was
// fragile across browsers when the drag source lived outside the editor
// (the grip sits in document.body, not inside ProseMirror's view).
interface PendingDrag {
  startX: number;
  startY: number;
  nodePos: number;
  block: HTMLElement;
  pointerId: number;
  active: boolean;
  targetIdx: number | null;
  // Source slice: index in doc.content + how many children move together.
  // For a parent taskRef, sliceLen covers the parent and any trailing
  // subTaskRefs so the whole group is dragged atomically.
  fromIdx: number;
  sliceLen: number;
  sourceType: 'taskRef' | 'subTaskRef' | 'other';
}

let pendingDrag: PendingDrag | null = null;
let dropIndicatorEl: HTMLDivElement | null = null;
const DRAG_THRESHOLD_PX = 4;

const ensureDropIndicator = (): HTMLDivElement => {
  if (dropIndicatorEl) return dropIndicatorEl;
  dropIndicatorEl = document.createElement('div');
  dropIndicatorEl.className = 'doc-drop-indicator';
  dropIndicatorEl.style.display = 'none';
  document.body.appendChild(dropIndicatorEl);
  return dropIndicatorEl;
};

const positionDropIndicator = (y: number, x: number, width: number): void => {
  const el = ensureDropIndicator();
  el.style.display = 'block';
  el.style.top = `${y + window.scrollY}px`;
  el.style.left = `${x + window.scrollX}px`;
  el.style.width = `${width}px`;
};

const hideDropIndicator = (): void => {
  if (dropIndicatorEl) dropIndicatorEl.style.display = 'none';
};

const computeDropTarget = (
  clientY: number,
): { targetIdx: number; indicatorY: number; rootRect: DOMRect } | null => {
  if (!editor) return null;
  const editorRoot = editor.view.dom as HTMLElement;
  const blocks = Array.from(editorRoot.children) as HTMLElement[];
  if (blocks.length === 0) return null;
  const rootRect = editorRoot.getBoundingClientRect();
  let targetIdx = blocks.length;
  let indicatorY = blocks[blocks.length - 1].getBoundingClientRect().bottom;
  for (let i = 0; i < blocks.length; i++) {
    const r = blocks[i].getBoundingClientRect();
    const mid = r.top + r.height / 2;
    if (clientY < mid) {
      targetIdx = i;
      indicatorY = r.top;
      break;
    }
    indicatorY = r.bottom;
  }
  // Snap the raw hit-test index to a legal landing gap for the dragged
  // slice (see docNav.snapDropTargetIdx), then recompute the indicator Y.
  if (pendingDrag) {
    targetIdx = docNav.snapDropTargetIdx(editor.state.doc, targetIdx, pendingDrag);
    if (targetIdx === 0) {
      indicatorY = blocks[0].getBoundingClientRect().top;
    } else if (targetIdx >= blocks.length) {
      indicatorY = blocks[blocks.length - 1].getBoundingClientRect().bottom;
    } else {
      indicatorY = blocks[targetIdx - 1].getBoundingClientRect().bottom;
    }
  }
  return { targetIdx, indicatorY, rootRect };
};

const endBlockDrag = (commit: boolean): void => {
  const drag = pendingDrag;
  pendingDrag = null;
  hideDropIndicator();
  if (drag) {
    // Clear the dim on every block in the slice (and as a safety net any
    // stray .is-dragging the DOM might have).
    if (editor) {
      editor.view.dom
        .querySelectorAll('.is-dragging')
        .forEach((el) => el.classList.remove('is-dragging'));
    } else {
      drag.block.classList.remove('is-dragging');
    }
    try {
      (document.body as HTMLElement).releasePointerCapture(drag.pointerId);
    } catch {
      // pointer may already be released
    }
  }
  if (commit && drag && drag.active && drag.targetIdx !== null) {
    moveContentSliceToIndex(drag.fromIdx, drag.sliceLen, drag.targetIdx);
  }
};

const attachGripPointerHandlers = (grip: HTMLElement): void => {
  grip.addEventListener('pointerdown', (ev) => {
    ev.stopPropagation();
    // Only react to primary button (left mouse / touch / pen tip).
    if (ev.button !== 0) return;
    if (!hoveredBlock || !editor) return;
    const block = hoveredBlock;
    let nodePos: number;
    try {
      const pos = editor.view.posAtDOM(block, 0);
      if (pos < 0) return;
      const resolved = editor.state.doc.resolve(pos);
      if (resolved.depth === 0) return;
      nodePos = resolved.before(resolved.depth);
    } catch {
      return;
    }
    const fromIdx = childIdxAtPos(nodePos);
    if (fromIdx < 0) return;
    const srcNode = editor.state.doc.child(fromIdx);
    const sourceType: PendingDrag['sourceType'] =
      srcNode.type.name === 'taskRef'
        ? 'taskRef'
        : srcNode.type.name === 'subTaskRef'
          ? 'subTaskRef'
          : 'other';
    const sliceLen = sliceLenAt(fromIdx);
    pendingDrag = {
      startX: ev.clientX,
      startY: ev.clientY,
      nodePos,
      block,
      pointerId: ev.pointerId,
      active: false,
      targetIdx: null,
      fromIdx,
      sliceLen,
      sourceType,
    };
    // Select the node so the user sees what they're about to drag.
    try {
      editor.view.dispatch(
        editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, nodePos)),
      );
    } catch {
      // selection may not be valid (e.g. doc root)
    }
  });

  // Suppress the click that follows pointerup when a real drag occurred —
  // otherwise the block menu would pop open right after dropping.
  grip.addEventListener('click', (ev) => {
    if (grip.dataset.justDragged === '1') {
      ev.preventDefault();
      ev.stopPropagation();
      delete grip.dataset.justDragged;
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
    if (!hoveredBlock || !editor) return;
    openBlockMenu(grip.getBoundingClientRect());
  });
};

// Document-level pointer handlers; armed once at mount time. They drive any
// in-progress grip drag regardless of which gutter instance started it.
const installDocumentDragHandlers = (): void => {
  document.addEventListener('pointermove', (ev) => {
    const drag = pendingDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    const dx = ev.clientX - drag.startX;
    const dy = ev.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      // Dim every block in the dragged slice (a parent + its subtasks
      // move together — the user expects to see the whole group lifted).
      if (editor) {
        const root = editor.view.dom as HTMLElement;
        for (let i = 0; i < drag.sliceLen; i++) {
          const el = root.children[drag.fromIdx + i];
          el?.classList.add('is-dragging');
        }
      }
      if (gutterEl) {
        gutterEl.style.display = 'none';
        gutterEl.classList.remove('is-visible');
      }
      try {
        (document.body as HTMLElement).setPointerCapture(drag.pointerId);
      } catch {
        // setPointerCapture can fail in odd states; the listener still works
      }
    }
    const target = computeDropTarget(ev.clientY);
    if (!target) {
      drag.targetIdx = null;
      hideDropIndicator();
      return;
    }
    drag.targetIdx = target.targetIdx;
    positionDropIndicator(target.indicatorY, target.rootRect.left, target.rootRect.width);
  });
  document.addEventListener('pointerup', (ev) => {
    const drag = pendingDrag;
    if (!drag || drag.pointerId !== ev.pointerId) return;
    const wasActive = drag.active;
    endBlockDrag(true);
    if (wasActive) {
      // Mark all grips so the synthetic click that follows pointerup is
      // ignored (browsers fire click after pointerup unless preventDefault'd
      // on pointerdown, which would also break selection).
      document
        .querySelectorAll<HTMLElement>('.block-gutter-btn[data-action="grip"]')
        .forEach((el) => {
          el.dataset.justDragged = '1';
        });
      setTimeout(() => {
        document
          .querySelectorAll<HTMLElement>('.block-gutter-btn[data-action="grip"]')
          .forEach((el) => delete el.dataset.justDragged);
      }, 0);
    }
  });
  document.addEventListener('pointercancel', () => {
    if (pendingDrag) endBlockDrag(false);
  });
  // Safety net: pointerup / pointercancel may not fire when the drag leaves
  // the iframe entirely (drag into an Electron menu, browser dragging into
  // another tab, focus stolen by an OS-level overlay). Without this, the
  // drop indicator and dim state would stay forever.
  window.addEventListener('blur', () => {
    if (pendingDrag) endBlockDrag(false);
  });
  document.documentElement.addEventListener('pointerleave', (ev) => {
    if (!pendingDrag) return;
    // pointerleave fires when pointer crosses the iframe boundary. Treat
    // that as "drag aborted" — committing would land the slice based on
    // stale coords.
    if (!ev.relatedTarget) endBlockDrag(false);
  });
};

const scheduleHideGutter = (): void => {
  if (hideGutterTimer) clearTimeout(hideGutterTimer);
  hideGutterTimer = setTimeout(() => {
    hideGutterTimer = null;
    positionGutter(null);
  }, 200);
};

const cancelHideGutter = (): void => {
  if (hideGutterTimer) {
    clearTimeout(hideGutterTimer);
    hideGutterTimer = null;
  }
};

const createGutter = (): HTMLDivElement => {
  const g = document.createElement('div');
  g.className = 'block-gutter';
  g.setAttribute('role', 'toolbar');
  g.setAttribute('aria-label', 'Block actions');
  g.innerHTML = `
    <button type="button" class="block-gutter-btn" data-action="add"
      title="Insert below" aria-label="Insert below">
      ${iconSvg('add')}
    </button>
    <button type="button" class="block-gutter-btn" data-action="grip"
      title="Drag to move; click for menu" aria-label="Move block or open menu">
      ${iconSvg('drag_indicator')}
    </button>
    <button type="button" class="block-gutter-btn" data-action="details"
      title="Open task details" aria-label="Open task details">
      ${iconSvg('open_in_new')}
    </button>
  `;
  g.style.display = 'none';
  document.body.appendChild(g);

  // "Open task details" — only shown for task chips (see positionGutter).
  // Opens the host's task-detail panel via the PluginAPI bridge.
  g.querySelector('[data-action="details"]')?.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    const taskId = hoveredBlock?.dataset.taskId;
    if (!taskId) return;
    PluginAPI.selectTask(taskId).catch((err) => logErr('selectTask failed', err));
  });

  g.querySelector('[data-action="add"]')?.addEventListener('mousedown', (ev) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!hoveredBlock || !editor) return;
    // posAtDOM returns -1 if the block is no longer mapped (re-rendered between
    // hover and click). Bail rather than throwing on resolve(-1).
    const pos = editor.view.posAtDOM(hoveredBlock, 0);
    if (pos < 0) return;
    const $pos = editor.state.doc.resolve(pos);
    const blockEnd = $pos.end($pos.depth);
    editor
      .chain()
      .focus(blockEnd + 1)
      .insertContentAt(blockEnd + 1, { type: 'paragraph' })
      .run();
    requestAnimationFrame(() => showSlashMenu(false));
  });

  const grip = g.querySelector('[data-action="grip"]') as HTMLElement | null;
  if (grip) {
    attachGripPointerHandlers(grip);
  }

  return g;
};

const positionGutter = (block: HTMLElement | null): void => {
  if (!gutterEl) return;
  if (!block) {
    gutterEl.style.display = 'none';
    gutterEl.classList.remove('is-visible');
    hoveredBlock = null;
    return;
  }
  const rect = block.getBoundingClientRect();
  // The "open details" button is only meaningful for task chips.
  const detailsBtn = gutterEl.querySelector<HTMLElement>('[data-action="details"]');
  if (detailsBtn) {
    detailsBtn.style.display = block.classList.contains('task-ref') ? '' : 'none';
  }
  gutterEl.style.display = 'flex';
  gutterEl.style.top = `${rect.top + window.scrollY}px`;
  gutterEl.style.height = `${Math.max(28, rect.height)}px`;
  // Right-align the gutter just left of the block; measure its own width so
  // the layout holds whether or not the details button is showing.
  gutterEl.style.left = `${rect.left + window.scrollX - gutterEl.offsetWidth + 6}px`;
  gutterEl.classList.add('is-visible');
  hoveredBlock = block;
};

const findBlockFromEvent = (ev: MouseEvent): HTMLElement | null => {
  if (!editor) return null;
  const target = ev.target as HTMLElement | null;
  if (!target) return null;
  const root = editor.view.dom as HTMLElement;
  if (!root.contains(target) && target !== gutterEl && !gutterEl?.contains(target)) {
    return null;
  }
  // Walk up to the direct child of .ProseMirror.
  let node: HTMLElement | null = target;
  while (node && node.parentElement && node.parentElement !== root) {
    node = node.parentElement;
  }
  return node && node.parentElement === root ? node : null;
};

// Thin `editor`-bound wrappers over the pure `doc-nav` helpers used by the
// grip drag and block-menu move code. See `ui/doc-nav.ts` for the logic.
const sliceLenAt = (idx: number): number =>
  editor ? docNav.sliceLenAt(editor.state.doc, idx) : 1;

const childIdxAtPos = (pos: number): number =>
  editor ? docNav.childIdxAtPos(editor.state.doc, pos) : -1;

/* -------------------------------------------------------------------------- */
/* Chip-reorder write-back                                                     */
/* -------------------------------------------------------------------------- */

// A chip reorder inside the doc is written back to the host so it survives
// a reload — the load pipeline rebuilds top-level order from `ctx.taskIds`
// and subtask order from each parent's `subTaskIds`, so an un-persisted
// reorder would silently revert. Top-level order is only persistable for
// PROJECT contexts (`reorderTasks` has no TODAY/TAG context type);
// subtask order persists in any context (it is keyed on the parent task).
const REORDER_DEBOUNCE_MS = 400;
let reorderTimer: ReturnType<typeof setTimeout> | null = null;
let pendingTopLevelReorder = false;
const pendingSubtaskParents = new Set<string>();

const cancelPendingReorder = (): void => {
  if (reorderTimer !== null) {
    clearTimeout(reorderTimer);
    reorderTimer = null;
  }
  pendingTopLevelReorder = false;
  pendingSubtaskParents.clear();
};

/** Top-level `taskRef` ids in current doc order. */
const collectTopLevelTaskIds = (): string[] => {
  if (!editor) return [];
  const doc = editor.state.doc;
  const ids: string[] = [];
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name === 'taskRef' && child.attrs.taskId) {
      ids.push(child.attrs.taskId as string);
    }
  }
  return ids;
};

/** `subTaskRef` ids that currently sit under `parentTaskId` in the doc. */
const collectSubtaskIds = (parentTaskId: string): string[] => {
  if (!editor) return [];
  const doc = editor.state.doc;
  const ids: string[] = [];
  let i = 0;
  while (i < doc.childCount) {
    const child = doc.child(i);
    if (child.type.name === 'taskRef' && child.attrs.taskId === parentTaskId) break;
    i++;
  }
  for (i += 1; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (child.type.name !== 'subTaskRef') break;
    if (child.attrs.taskId) ids.push(child.attrs.taskId as string);
  }
  return ids;
};

/** Order-independent equality of two id lists. */
const sameIdSet = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length !== b.length) return false;
  const setB = new Set(b);
  return a.every((id) => setB.has(id));
};

/**
 * Write pending chip reorders back to the host. Each `reorderTasks` call
 * replaces an ordering list wholesale, so it is guarded to fire ONLY for a
 * true permutation: the doc's chip id set must still equal the host's
 * current id set. A membership mismatch (a deleted chip, a task added
 * elsewhere) means this is not a pure reorder — skip it and let the next
 * context reload reconcile, rather than risk dropping a task from
 * `project.taskIds` / `task.subTaskIds`.
 */
const flushReorder = async (): Promise<void> => {
  reorderTimer = null;
  const ctx = currentCtx;
  const wantTopLevel = pendingTopLevelReorder;
  const parents = [...pendingSubtaskParents];
  pendingTopLevelReorder = false;
  pendingSubtaskParents.clear();
  if (!ctx || !editor) return;

  // Top-level order — only PROJECT contexts have a reorderTasks target.
  if (wantTopLevel && ctx.type === 'PROJECT') {
    const docIds = collectTopLevelTaskIds();
    try {
      const fresh = await PluginAPI.getActiveWorkContext();
      if (
        docIds.length > 0 &&
        fresh &&
        fresh.id === ctx.id &&
        currentCtx?.id === ctx.id &&
        sameIdSet(docIds, fresh.taskIds)
      ) {
        await PluginAPI.reorderTasks(docIds, ctx.id, 'project');
      }
    } catch (err) {
      logErr('reorderTasks (project) failed', err);
    }
  }

  // Subtask order — keyed on the parent task, so any context can persist it.
  for (const parentId of parents) {
    if (currentCtx?.id !== ctx.id) break; // context switched mid-flush
    const docSubIds = collectSubtaskIds(parentId);
    const parent = taskCache.get(parentId);
    if (docSubIds.length === 0 || !parent) continue;
    if (!sameIdSet(docSubIds, parent.subTaskIds ?? [])) continue;
    try {
      await PluginAPI.reorderTasks(docSubIds, parentId, 'task');
    } catch (err) {
      logErr('reorderTasks (subtasks) failed', err);
    }
  }
};

const scheduleReorder = (): void => {
  if (reorderTimer !== null) clearTimeout(reorderTimer);
  reorderTimer = setTimeout(() => void flushReorder(), REORDER_DEBOUNCE_MS);
};

/**
 * Move a contiguous slice of top-level children to a new insertion-gap
 * index. `targetIdx` is interpreted as the gap (0 = before first child,
 * doc.childCount = after last). No-op when the target falls inside the
 * slice itself.
 *
 * Used for single-block moves AND for parent-with-subtasks moves: those
 * are the same operation with a different slice length.
 */
const moveContentSliceToIndex = (
  fromIdx: number,
  sliceLen: number,
  targetIdx: number,
): void => {
  if (!editor) return;
  const ed = editor;
  const doc = ed.state.doc;
  if (fromIdx < 0 || sliceLen <= 0 || fromIdx + sliceLen > doc.childCount) return;
  if (targetIdx >= fromIdx && targetIdx <= fromIdx + sliceLen) return;

  // Snapshot the slice's nodes and total size BEFORE building the tr.
  let fromPos = 0;
  for (let i = 0; i < fromIdx; i++) fromPos += doc.child(i).nodeSize;
  let sliceSize = 0;
  const sliceNodes: ProseMirrorNode[] = [];
  for (let i = 0; i < sliceLen; i++) {
    const child = doc.child(fromIdx + i);
    sliceNodes.push(child);
    sliceSize += child.nodeSize;
  }

  let toPos = 0;
  for (let i = 0; i < targetIdx && i < doc.childCount; i++) {
    toPos += doc.child(i).nodeSize;
  }
  // After deletion, positions past fromPos shift left by sliceSize.
  const adjustedInsert = toPos > fromPos ? toPos - sliceSize : toPos;

  const tr = ed.state.tr;
  tr.delete(fromPos, fromPos + sliceSize);
  let insertCursor = adjustedInsert;
  for (const node of sliceNodes) {
    tr.insert(insertCursor, node);
    insertCursor += node.nodeSize;
  }
  tr.setSelection(NodeSelection.create(tr.doc, adjustedInsert));
  ed.view.dispatch(tr.scrollIntoView());
  ed.view.focus();

  // Persist the reorder back to the host. A taskRef slice changed the
  // top-level order; a subTaskRef slice changed one parent's subtask
  // order — the dragged subtask is constrained to stay in its group, so
  // its parent at the new position owns the change.
  const movedType = sliceNodes[0]?.type.name;
  if (movedType === 'taskRef') {
    pendingTopLevelReorder = true;
    scheduleReorder();
  } else if (movedType === 'subTaskRef') {
    const parentId = docNav.findParentTaskIdBefore(ed.state.doc, adjustedInsert);
    if (parentId) {
      pendingSubtaskParents.add(parentId);
      scheduleReorder();
    }
  }
};

/**
 * Move up / Move down from the block menu. Handles three cases:
 *
 *  - subTaskRef: moves a single step within the parent's subtask group,
 *    refusing to cross the parent boundary (Move up on the first subtask
 *    is a no-op; Move down on the last subtask is a no-op).
 *  - taskRef parent (with or without trailing subtasks): moves the whole
 *    group atomically past the previous / next sibling group. The
 *    "previous group" is the prior taskRef + any subTaskRefs between it
 *    and us; the "next group" is the next taskRef + its trailing subs.
 *  - any other block: behaves like the old single-block swap.
 */
const moveBlock = (nodePos: number, direction: 'up' | 'down'): void => {
  if (!editor) return;
  const doc = editor.state.doc;
  const idx = childIdxAtPos(nodePos);
  if (idx < 0) return;
  const targetIdx = docNav.moveBlockTargetIdx(doc, idx, direction);
  if (targetIdx === null) return; // no-op at a boundary
  moveContentSliceToIndex(idx, sliceLenAt(idx), targetIdx);
};

/**
 * Promote a paragraph / heading into a task chip: create a host task whose
 * title is the block's text, then swap the block for a taskRef. Bails if the
 * doc shifted under the host round-trip (the task is still created and
 * surfaces via reconcile) so a stale position can't replace the wrong range.
 */
const turnBlockIntoTask = async (nodePos: number): Promise<void> => {
  if (!editor || !currentCtx) return;
  const ed = editor;
  const ctx = currentCtx;
  const node = ed.state.doc.nodeAt(nodePos);
  if (!node) return;
  const nodeName = node.type.name;
  const title = node.textContent;
  try {
    const taskId = await PluginAPI.addTask({
      title,
      projectId: ctx.type === 'PROJECT' ? ctx.id : null,
    });
    seedTaskCache(taskId, title, ctx);
    if (currentCtx?.id !== ctx.id) return;
    const current = ed.state.doc.nodeAt(nodePos);
    if (!current || current.type.name !== nodeName || current.textContent !== title) {
      return;
    }
    ed.chain()
      .focus()
      .insertContentAt(
        { from: nodePos, to: nodePos + current.nodeSize },
        taskNodeJSON(taskId, 'taskRef', lookupTask) as Parameters<
          typeof ed.commands.insertContentAt
        >[1],
      )
      .run();
  } catch (err) {
    logErr('turnBlockIntoTask failed', err);
  }
};

/**
 * Delete a task chip — and, for a parent, its whole subtask group — from
 * both the document and the host. Removing the chip without deleting the
 * task would leave the task alive, so it would reappear on the next reload.
 */
const deleteTaskChipGroup = (blockIdx: number): void => {
  if (!editor) return;
  const ed = editor;
  const doc = ed.state.doc;
  if (blockIdx < 0 || blockIdx >= doc.childCount) return;
  const len = Math.min(sliceLenAt(blockIdx), doc.childCount - blockIdx);
  const ids: string[] = [];
  let fromPos = 0;
  for (let i = 0; i < blockIdx; i++) fromPos += doc.child(i).nodeSize;
  let size = 0;
  for (let i = 0; i < len; i++) {
    const child = doc.child(blockIdx + i);
    size += child.nodeSize;
    if (isTaskNode(child.type.name) && child.attrs.taskId) {
      ids.push(child.attrs.taskId as string);
    }
  }
  // Remove the chips from the doc first (instant feedback), then delete the
  // host tasks. deleteTaskTolerant absorbs a subtask the host already
  // removed by cascading the parent delete.
  ed.view.dispatch(ed.state.tr.delete(fromPos, fromPos + size));
  ed.view.focus();
  for (const id of ids) void deleteTaskTolerant(id);
};

const openBlockMenu = (anchorRect: DOMRect): void => {
  if (!editor || !hoveredBlock) return;
  const ed = editor;
  const pos = ed.view.posAtDOM(hoveredBlock, 0);
  if (pos < 0) return;
  const $pos = ed.state.doc.resolve(pos);
  if ($pos.depth === 0) return;
  const nodePos = $pos.before($pos.depth);
  const blockIdx = $pos.index(0);
  const node = ed.state.doc.nodeAt(nodePos);
  if (!node) return;
  const nodeName = node.type.name;
  const isTask = isTaskNode(nodeName);
  const childCount = ed.state.doc.childCount;
  const canMoveUp = blockIdx > 0;
  const canMoveDown = blockIdx < childCount - 1;

  const items: MenuItem[] = [];

  // Turn-into options are text-block only: a task chip already *is* the task
  // form, and converting it to text would orphan the host task.
  if (!isTask) {
    items.push(
      {
        label: 'Turn into paragraph',
        icon: 'segment',
        action: () => ed.chain().focus().setNodeSelection(nodePos).setParagraph().run(),
      },
      {
        label: 'Turn into H1',
        icon: 'title',
        action: () =>
          ed.chain().focus().setNodeSelection(nodePos).setHeading({ level: 1 }).run(),
      },
      {
        label: 'Turn into H2',
        icon: 'text_fields',
        action: () =>
          ed.chain().focus().setNodeSelection(nodePos).setHeading({ level: 2 }).run(),
      },
      {
        label: 'Turn into H3',
        icon: 'short_text',
        action: () =>
          ed.chain().focus().setNodeSelection(nodePos).setHeading({ level: 3 }).run(),
      },
    );
    // Promote a paragraph / heading into a task — its text becomes the title.
    if (nodeName === 'paragraph' || nodeName === 'heading') {
      items.push({
        label: 'Turn into task',
        icon: 'check_circle_outline',
        action: () => void turnBlockIntoTask(nodePos),
      });
    }
  }

  if (canMoveUp) {
    items.push({
      label: 'Move up',
      icon: 'arrow_upward',
      action: () => moveBlock(nodePos, 'up'),
    });
  }
  if (canMoveDown) {
    items.push({
      label: 'Move down',
      icon: 'arrow_downward',
      action: () => moveBlock(nodePos, 'down'),
    });
  }

  // Duplicate is text-block only: cloning a chip would place a second node
  // with the same taskId in the doc and break every taskId-keyed invariant.
  if (!isTask) {
    items.push({
      label: 'Duplicate',
      icon: 'content_copy',
      action: () => {
        const n = ed.state.doc.nodeAt(nodePos);
        if (!n) return;
        ed.chain()
          .focus()
          .insertContentAt(nodePos + n.nodeSize, n.toJSON())
          .run();
      },
    });
  }

  items.push({
    label: isTask ? 'Delete task' : 'Delete',
    icon: 'delete',
    action: () => {
      if (isTask) {
        deleteTaskChipGroup(blockIdx);
      } else {
        ed.chain().focus().setNodeSelection(nodePos).deleteSelection().run();
      }
    },
  });

  menuActiveIndex = 0;
  menuFilter = '';
  // The block menu is not slash-triggered — nothing to delete on pick.
  slashQueryFrom = null;
  renderMenu(anchorRect, items);
};

/* -------------------------------------------------------------------------- */
/* Mount                                                                       */
/* -------------------------------------------------------------------------- */

// Guards against re-entering mount(). The iframe is rebuilt from scratch
// when the embed slot is closed and re-opened, but in dev HMR or odd
// host re-init flows we could land here twice — every listener and
// body-appended element would then duplicate. One source of truth.
let isMounted = false;

const mount = async (): Promise<void> => {
  if (isMounted) return;
  isMounted = true;
  // Run the legacy → keyed migration in case background.ts hasn't finished
  // it before the user opened the editor for the first time. The migration
  // is idempotent and stamp-guarded, so a duplicate call here is free.
  try {
    await migrateToKeyedPersistence(PluginAPI);
  } catch (err) {
    logErr('document-mode: migration failed', err);
  }
  updateDocStatusBanner();
  const initialCtx = await PluginAPI.getActiveWorkContext();

  const root = document.getElementById('editor-root');
  if (!root) {
    logErr('Document mode: #editor-root not found');
    isMounted = false;
    return;
  }

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'bubble-menu';
  bubbleEl.setAttribute('role', 'toolbar');
  bubbleEl.setAttribute('aria-label', 'Text formatting');
  bubbleEl.innerHTML = `
    <button type="button" data-action="bold" title="Bold" aria-label="Bold"><b>B</b></button>
    <button type="button" data-action="italic" title="Italic" aria-label="Italic"><i>I</i></button>
    <button type="button" data-action="strike" title="Strikethrough" aria-label="Strikethrough"><s>S</s></button>
    <button type="button" data-action="code" title="Inline code" aria-label="Inline code"><code>{}</code></button>
  `;
  document.body.appendChild(bubbleEl);

  // Editor-side collaborators handed to both task-ref node variants.
  // `getEditor` is late-bound — the nodes are constructed before the
  // `Editor` exists.
  const taskRefDeps: TaskRefNodeDeps = {
    getEditor: () => editor,
    lookupTask,
    toggleTaskDone,
    deleteTaskTolerant,
    createTaskAfter,
    createSubTaskAfter,
  };

  editor = new Editor({
    element: root,
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: "Press '/' to add tasks, headings and more…",
      }),
      createTaskRefNode('taskRef', taskRefDeps),
      createTaskRefNode('subTaskRef', taskRefDeps),
      BubbleMenu.configure({
        element: bubbleEl,
        shouldShow: ({ from, to, state }) => {
          if (from === to) return false;
          // A selection that *crosses* an atom (e.g. paragraph → divider
          // → paragraph) shouldn't show the inline-mark menu either —
          // toggling bold across the divider would do nothing useful.
          // Walk the whole range, not just the start, to catch this.
          let hasAtom = false;
          state.doc.nodesBetween(from, to, (node) => {
            if (node.isAtom) hasAtom = true;
            return !hasAtom;
          });
          return !hasAtom;
        },
      }),
    ],
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
    onUpdate: () => {
      reconcileTitlesFromDoc();
      scheduleSave();
    },
  });

  bubbleEl.querySelectorAll('button[data-action]').forEach((btn) => {
    btn.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      const action = (btn as HTMLElement).dataset.action;
      if (!editor) return;
      const chain = editor.chain().focus();
      if (action === 'bold') chain.toggleBold().run();
      else if (action === 'italic') chain.toggleItalic().run();
      else if (action === 'strike') chain.toggleStrike().run();
      else if (action === 'code') chain.toggleCode().run();
    });
  });

  gutterEl = createGutter();

  root.addEventListener('mousemove', (ev) => {
    cancelHideGutter();
    const block = findBlockFromEvent(ev);
    if (block !== hoveredBlock) positionGutter(block);
  });
  root.addEventListener('mouseleave', (ev) => {
    const next = ev.relatedTarget as HTMLElement | null;
    if (next && gutterEl?.contains(next)) return;
    // Debounce: gives the mouse ~200 ms to reach the gutter across the gap.
    scheduleHideGutter();
  });
  gutterEl.addEventListener('mouseenter', () => {
    cancelHideGutter();
  });
  gutterEl.addEventListener('mouseleave', (ev) => {
    const next = ev.relatedTarget as HTMLElement | null;
    if (next && (root.contains(next) || gutterEl?.contains(next))) return;
    scheduleHideGutter();
  });

  installDocumentDragHandlers();

  // Mod-Enter inside a task chip toggles its done state. Registered on
  // `document` in the capture phase so it runs before ProseMirror's keymap —
  // StarterKit's HardBreak binds the same chord, and a same-element listener
  // (capture or bubble) would still fire after ProseMirror's.
  document.addEventListener(
    'keydown',
    (ev) => {
      if (ev.key !== 'Enter' || !(ev.metaKey || ev.ctrlKey) || ev.shiftKey || ev.altKey) {
        return;
      }
      const taskId = currentChipTaskId();
      if (!taskId) return;
      ev.preventDefault();
      ev.stopPropagation();
      toggleTaskDone(taskId);
    },
    true,
  );

  editor.view.dom.addEventListener('keydown', (ev: KeyboardEvent) => {
    if (menuEl) {
      if (ev.key === 'Escape') {
        ev.preventDefault();
        closeMenu();
        return;
      }
      if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
        ev.preventDefault();
        if (menuCurrentItems.length === 0) return;
        if (ev.key === 'ArrowDown') {
          menuActiveIndex = (menuActiveIndex + 1) % menuCurrentItems.length;
        } else {
          menuActiveIndex =
            (menuActiveIndex - 1 + menuCurrentItems.length) % menuCurrentItems.length;
        }
        renderMenu(caretRect(), menuCurrentItems);
        return;
      }
      if (ev.key === 'Enter') {
        if (menuCurrentItems.length === 0) {
          // Empty result set — let Enter through to the editor instead of
          // eating it. Previously the menu stayed open with "No matches"
          // and Enter did nothing.
          closeMenu();
          return;
        }
        ev.preventDefault();
        if (menuCurrentItems[menuActiveIndex]) {
          runMenuItem(menuCurrentItems[menuActiveIndex].action);
        }
        return;
      }
      if (ev.key === 'Backspace') {
        if (menuFilter === '') {
          closeMenu();
        } else {
          menuFilter = menuFilter.slice(0, -1);
          filterAndRender(caretRect());
        }
        return;
      }
      if (ev.key.length === 1) {
        // Skip when an OS shortcut (Ctrl/Cmd/Alt + char) or IME composition
        // is in progress — those keys should NOT extend the slash filter.
        if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.isComposing) return;
        menuFilter += ev.key;
        filterAndRender(caretRect());
        return;
      }
    } else if (ev.key === '/') {
      // Defer so the `/` is in the doc before we read the caret position.
      setTimeout(() => showSlashMenu(true), 0);
    }
  });

  document.addEventListener('mousedown', (ev) => {
    if (menuEl && ev.target instanceof globalThis.Node && !menuEl.contains(ev.target)) {
      closeMenu();
    }
  });

  await setActiveContext(initialCtx);

  PluginAPI.registerHook(PluginHooks.WORK_CONTEXT_CHANGE, (payload) => {
    void setActiveContext(payload as WorkContextChangePayload);
  });
  PluginAPI.registerHook(PluginHooks.ANY_TASK_UPDATE, (payload) => {
    onAnyTaskUpdate(payload as AnyTaskUpdatePayload);
  });

  // Flush triggers. `flushSaveSync` is idempotent, so overlap is harmless.
  //
  // - `visibilitychange` (on 'hidden') covers tab-switch, window-minimize,
  //   mobile-background, and screen-lock. The iframe's visibilityState
  //   mirrors the top-level document.
  // - `blur` covers focus moving between iframes within the same page —
  //   which `visibilitychange` does not catch.
  // - `pagehide` / `unload` cover iframe teardown; browsers are inconsistent
  //   about which fires when an iframe element is removed from the DOM, so
  //   both are wired.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushSaveSync();
  });
  window.addEventListener('blur', () => flushSaveSync());
  window.addEventListener('pagehide', () => flushSaveSync());
  window.addEventListener('unload', () => flushSaveSync());
};

/**
 * Wait for the host to inject the PluginAPI global before bootstrapping.
 * Bounded so a misconfigured host (no injection) doesn't leave us busy-
 * polling forever — log and bail after ~5s, after which mount() will be
 * unable to run anyway.
 */
const waitForPluginAPI = (): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const INTERVAL_MS = 20;
    const MAX_ATTEMPTS = 250; // ~5s total
    let attempts = 0;
    const check = (): void => {
      if (
        typeof (window as unknown as { PluginAPI?: unknown }).PluginAPI !== 'undefined'
      ) {
        resolve();
        return;
      }
      attempts++;
      if (attempts >= MAX_ATTEMPTS) {
        // eslint-disable-next-line no-console
        console.error(
          '[document-mode] PluginAPI not injected after',
          MAX_ATTEMPTS * INTERVAL_MS,
          'ms — giving up',
        );
        reject(new Error('PluginAPI injection timed out'));
        return;
      }
      setTimeout(check, INTERVAL_MS);
    };
    check();
  });

void waitForPluginAPI()
  .then(() => mount())
  .catch(() => {
    // Already logged in waitForPluginAPI. Replace the blank editor area with
    // a visible message so a failed mount doesn't look like an empty /
    // broken panel.
    const root = document.getElementById('editor-root');
    if (root) {
      root.textContent = '';
      const msg = document.createElement('div');
      msg.className = 'doc-error-state';
      msg.textContent =
        'Document Mode could not connect to Super Productivity. ' +
        'Try closing and reopening this panel.';
      root.appendChild(msg);
    }
  });
