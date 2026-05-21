/**
 * Document-Mode editor — runs inside the plugin iframe. Notion-style UX:
 * inline bubble menu on text selection, block hover gutter with insert
 * (`+`) and grip (`⋮⋮`) buttons, slash menu for inserts and turn-into,
 * and a custom taskRef atom node tied to Super Productivity tasks.
 */

import { Editor, Node, mergeAttributes } from '@tiptap/core';
import type { NodeViewRendererProps } from '@tiptap/core';
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

declare const PluginAPI: PluginAPI;

const SAVE_DEBOUNCE_MS = 5_000;
const STORAGE_VERSION = 1;

interface StoredState {
  version: number;
  docs: Record<string, unknown>;
  [key: string]: unknown; // preserve fields owned by background script
}

let currentCtx: ActiveWorkContext | null = null;
let storedState: StoredState = { version: STORAGE_VERSION, docs: {} };
let taskCache = new Map<string, Task>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;
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
 * Helper invoked from keyboard shortcuts to create a new empty task and
 * insert a taskRef pointing at it. Hoisted so keybindings inside
 * TaskRefNode can call it without needing the editor closure variable
 * (which isn't initialised at extension creation time).
 */
const createTaskAfter = async (insertPos: number): Promise<void> => {
  if (!editor || !currentCtx) return;
  try {
    const taskId = await PluginAPI.addTask({
      title: '',
      projectId: currentCtx.type === 'PROJECT' ? currentCtx.id : null,
    });
    await refreshTaskCache();
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
  try {
    const taskId = await PluginAPI.addTask({
      title: '',
      parentId: parentTaskId,
      projectId: currentCtx.type === 'PROJECT' ? currentCtx.id : null,
    });
    await refreshTaskCache();
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

/**
 * Walk doc backwards from a position to find which top-level taskRef owns
 * the subtask that lives at that position. Returns its taskId, or null
 * if there is no owning parent (orphan subTaskRef).
 *
 * Uses manual childCount iteration rather than `doc.resolve(pos).index(0)`
 * — the latter's gap-vs-node semantics at top-level boundaries differ
 * subtly across the docs and at least one reviewer flagged it as
 * mis-resolving for certain positions. Iterating cursors is provably
 * correct and runs in O(childCount) which is fine for our doc sizes.
 */
const findParentTaskIdBefore = (subTaskRefPos: number): string | null => {
  if (!editor) return null;
  const doc = editor.state.doc;
  let subIdx = -1;
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (cursor === subTaskRefPos) {
      subIdx = i;
      break;
    }
    cursor += doc.child(i).nodeSize;
  }
  if (subIdx < 0) return null;
  for (let i = subIdx - 1; i >= 0; i--) {
    const child = doc.child(i);
    if (child.type.name === 'taskRef') {
      return (child.attrs.taskId as string) || null;
    }
    if (child.type.name === 'subTaskRef') continue;
    return null;
  }
  return null;
};

/**
 * Given a taskRef's nodePos, return the doc position immediately after the
 * parent's whole "group" — past the parent and any subTaskRefs that follow
 * it. Used so that Enter at the end of a parent inserts the next sibling
 * after its subtasks, not between parent and first child.
 */
const positionAfterParentGroup = (parentNodePos: number): number => {
  if (!editor) return parentNodePos;
  const doc = editor.state.doc;
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    const child = doc.child(i);
    if (cursor === parentNodePos && child.type.name === 'taskRef') {
      let end = cursor + child.nodeSize;
      let j = i + 1;
      while (j < doc.childCount && doc.child(j).type.name === 'subTaskRef') {
        end += doc.child(j).nodeSize;
        j++;
      }
      return end;
    }
    cursor += child.nodeSize;
  }
  return parentNodePos;
};

const TaskRefNode = Node.create({
  name: 'taskRef',
  group: 'block',
  content: 'inline*',
  selectable: true,
  draggable: true,
  addKeyboardShortcuts() {
    const inTaskRef = (): null | {
      from: number;
      to: number;
      atStart: boolean;
      atEnd: boolean;
      isEmpty: boolean;
      taskId: string;
      nodePos: number;
      nodeSize: number;
    } => {
      if (!editor) return null;
      const { $from } = editor.state.selection;
      if ($from.parent.type.name !== 'taskRef') return null;
      const node = $from.parent;
      const nodePos = $from.before($from.depth);
      return {
        from: $from.parentOffset,
        to: $from.parentOffset,
        atStart: $from.parentOffset === 0,
        atEnd: $from.parentOffset === node.content.size,
        isEmpty: node.content.size === 0,
        taskId: node.attrs.taskId as string,
        nodePos,
        nodeSize: node.nodeSize,
      };
    };

    return {
      Enter: () => {
        const info = inTaskRef();
        if (!info) return false;
        if (info.isEmpty) {
          // Empty chip + Enter → convert to paragraph + delete the empty task.
          if (info.taskId) void deleteTaskTolerant(info.taskId);
          if (!editor) return false;
          editor
            .chain()
            .focus()
            .setNodeSelection(info.nodePos)
            .setParagraph()
            // Drop the NodeSelection: leave a text cursor inside the new
            // paragraph so a follow-up Enter behaves normally (NodeSelection
            // on the same block would route Enter through a different path).
            .setTextSelection(info.nodePos + 1)
            .run();
          return true;
        }
        if (info.atEnd) {
          // Enter at end of chip → new empty task below. Skip past any
          // subtasks of this task so the new sibling lands after the group.
          const insertAfter = positionAfterParentGroup(info.nodePos);
          void createTaskAfter(insertAfter);
          return true;
        }
        // Enter in the middle: swallow for POC (avoid splitting chip into
        // two with the same taskId). Could split + create new task in v2.
        return true;
      },
      Backspace: () => {
        const info = inTaskRef();
        if (!info) return false;
        if (!info.atStart) return false;
        if (info.isEmpty) {
          // Empty chip + Backspace at start → delete task + remove chip.
          if (info.taskId) void deleteTaskTolerant(info.taskId);
          if (!editor) return false;
          editor.chain().focus().setNodeSelection(info.nodePos).deleteSelection().run();
          return true;
        }
        // Non-empty chip + Backspace at start: suppress default to avoid
        // merging the chip's content into the previous block (which would
        // detach the title from the task).
        return true;
      },
    };
  },
  addAttributes() {
    return {
      taskId: { default: '' },
      isDone: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-done') === 'true',
        renderHTML: (attrs) => ({ 'data-done': attrs.isDone ? 'true' : 'false' }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-task-ref]',
        getAttrs: (el: HTMLElement | string) => {
          if (typeof el === 'string') return false;
          return {
            taskId: el.getAttribute('data-task-id') || '',
            isDone: el.getAttribute('data-done') === 'true',
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-task-ref': '',
        'data-task-id': HTMLAttributes.taskId,
        class: 'task-ref',
      }),
      0,
    ];
  },
  addNodeView() {
    return ({ node, editor: viewEditor, getPos }: NodeViewRendererProps) => {
      const dom = document.createElement('div');
      dom.className = 'task-ref';
      dom.dataset.taskRef = '';
      dom.dataset.taskId = node.attrs.taskId;

      // Done-toggle: matches the app's <done-toggle> — a faint outline
      // circle with an animated checkmark that fades in once done.
      const toggle = document.createElement('span');
      toggle.className = 'done-toggle';
      toggle.contentEditable = 'false';
      toggle.setAttribute('role', 'checkbox');
      toggle.setAttribute('tabindex', '-1');
      // Squircle (rounded square) — matches the shape used in the app, not a circle.
      toggle.innerHTML = `
        <svg class="done-toggle-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect class="done-circle" x="3" y="3" width="18" height="18" rx="5" ry="5"></rect>
          <polyline class="done-check" points="6,12 10.5,16.5 18,8"></polyline>
        </svg>
      `;

      const title = document.createElement('span');
      title.className = 'title';

      const applyState = (n: ProseMirrorNode): void => {
        const taskId = n.attrs.taskId as string;
        const task = taskCache.get(taskId);
        if (!task) {
          dom.classList.add('is-missing');
          dom.classList.remove('is-done');
          toggle.setAttribute('aria-checked', 'false');
          toggle.setAttribute('aria-disabled', 'true');
        } else {
          dom.classList.remove('is-missing');
          const done = !!(n.attrs.isDone || task.isDone);
          dom.classList.toggle('is-done', done);
          toggle.setAttribute('aria-checked', done ? 'true' : 'false');
          toggle.removeAttribute('aria-disabled');
        }
      };

      const onToggle = (ev: Event): void => {
        ev.preventDefault();
        ev.stopPropagation();
        const taskId = node.attrs.taskId as string;
        const task = taskCache.get(taskId);
        if (!task) return;
        const next = !task.isDone;
        PluginAPI.updateTask(taskId, { isDone: next }).catch((err) => {
          logErr('updateTask failed', err);
        });
        taskCache.set(taskId, { ...task, isDone: next });
        // Reflect on attr so undo stack carries it.
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) {
          const tr = viewEditor.state.tr.setNodeAttribute(pos, 'isDone', next);
          viewEditor.view.dispatch(tr);
        } else {
          applyState(node);
        }
      };
      toggle.addEventListener('mousedown', onToggle);

      dom.appendChild(toggle);
      dom.appendChild(title);
      applyState(node);

      return {
        dom,
        contentDOM: title,
        update: (updatedNode: ProseMirrorNode): boolean => {
          if (updatedNode.type.name !== 'taskRef') return false;
          if (updatedNode.attrs.taskId !== node.attrs.taskId) return false;
          applyState(updatedNode);
          return true;
        },
      };
    };
  },
});

/**
 * Subtask variant of taskRef. Same content/attrs/parse/render plumbing but
 * lives at indent depth — its NodeView adds `.sub-task-ref` so CSS shifts
 * it right, and Enter/Backspace behaviours target the subtask's parent
 * instead of the top level.
 */
const SubTaskRefNode = Node.create({
  name: 'subTaskRef',
  group: 'block',
  content: 'inline*',
  selectable: true,
  draggable: true,
  addKeyboardShortcuts() {
    const inSubTaskRef = (): null | {
      atStart: boolean;
      atEnd: boolean;
      isEmpty: boolean;
      taskId: string;
      nodePos: number;
      nodeSize: number;
    } => {
      if (!editor) return null;
      const { $from } = editor.state.selection;
      if ($from.parent.type.name !== 'subTaskRef') return null;
      const node = $from.parent;
      const nodePos = $from.before($from.depth);
      return {
        atStart: $from.parentOffset === 0,
        atEnd: $from.parentOffset === node.content.size,
        isEmpty: node.content.size === 0,
        taskId: node.attrs.taskId as string,
        nodePos,
        nodeSize: node.nodeSize,
      };
    };

    return {
      Enter: () => {
        const info = inSubTaskRef();
        if (!info) return false;
        if (info.isEmpty) {
          // Empty subtask + Enter → outdent to paragraph + delete the empty task.
          if (info.taskId) void deleteTaskTolerant(info.taskId);
          if (!editor) return false;
          editor
            .chain()
            .focus()
            .setNodeSelection(info.nodePos)
            .setParagraph()
            .setTextSelection(info.nodePos + 1)
            .run();
          return true;
        }
        if (info.atEnd) {
          // Enter at end of subtask → create another subtask under same parent.
          const parentTaskId = findParentTaskIdBefore(info.nodePos);
          if (!parentTaskId) return false;
          const insertAfter = info.nodePos + info.nodeSize;
          void createSubTaskAfter(insertAfter, parentTaskId);
          return true;
        }
        // Middle: swallow to avoid splitting a chip into two with the same taskId.
        return true;
      },
      Backspace: () => {
        const info = inSubTaskRef();
        if (!info) return false;
        if (!info.atStart) return false;
        if (info.isEmpty) {
          if (info.taskId) void deleteTaskTolerant(info.taskId);
          if (!editor) return false;
          editor.chain().focus().setNodeSelection(info.nodePos).deleteSelection().run();
          return true;
        }
        return true;
      },
    };
  },
  addAttributes() {
    return {
      taskId: { default: '' },
      isDone: {
        default: false,
        parseHTML: (el: HTMLElement) => el.getAttribute('data-done') === 'true',
        renderHTML: (attrs) => ({ 'data-done': attrs.isDone ? 'true' : 'false' }),
      },
    };
  },
  parseHTML() {
    return [
      {
        tag: 'div[data-sub-task-ref]',
        getAttrs: (el: HTMLElement | string) => {
          if (typeof el === 'string') return false;
          return {
            taskId: el.getAttribute('data-task-id') || '',
            isDone: el.getAttribute('data-done') === 'true',
          };
        },
      },
    ];
  },
  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-sub-task-ref': '',
        'data-task-id': HTMLAttributes.taskId,
        class: 'task-ref sub-task-ref',
      }),
      0,
    ];
  },
  addNodeView() {
    return ({ node, editor: viewEditor, getPos }: NodeViewRendererProps) => {
      const dom = document.createElement('div');
      dom.className = 'task-ref sub-task-ref';
      dom.dataset.subTaskRef = '';
      dom.dataset.taskId = node.attrs.taskId;

      const toggle = document.createElement('span');
      toggle.className = 'done-toggle';
      toggle.contentEditable = 'false';
      toggle.setAttribute('role', 'checkbox');
      toggle.setAttribute('tabindex', '-1');
      toggle.innerHTML = `
        <svg class="done-toggle-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <rect class="done-circle" x="3" y="3" width="18" height="18" rx="5" ry="5"></rect>
          <polyline class="done-check" points="6,12 10.5,16.5 18,8"></polyline>
        </svg>
      `;

      const title = document.createElement('span');
      title.className = 'title';

      const applyState = (n: ProseMirrorNode): void => {
        const taskId = n.attrs.taskId as string;
        const task = taskCache.get(taskId);
        if (!task) {
          dom.classList.add('is-missing');
          dom.classList.remove('is-done');
          toggle.setAttribute('aria-checked', 'false');
          toggle.setAttribute('aria-disabled', 'true');
        } else {
          dom.classList.remove('is-missing');
          const done = !!(n.attrs.isDone || task.isDone);
          dom.classList.toggle('is-done', done);
          toggle.setAttribute('aria-checked', done ? 'true' : 'false');
          toggle.removeAttribute('aria-disabled');
        }
      };

      toggle.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        const taskId = node.attrs.taskId as string;
        const task = taskCache.get(taskId);
        if (!task) return;
        const next = !task.isDone;
        PluginAPI.updateTask(taskId, { isDone: next }).catch((err) => {
          logErr('updateTask failed', err);
        });
        taskCache.set(taskId, { ...task, isDone: next });
        const pos = typeof getPos === 'function' ? getPos() : null;
        if (pos !== null && pos !== undefined) {
          const tr = viewEditor.state.tr.setNodeAttribute(pos, 'isDone', next);
          viewEditor.view.dispatch(tr);
        } else {
          applyState(node);
        }
      });

      dom.appendChild(toggle);
      dom.appendChild(title);
      applyState(node);

      return {
        dom,
        contentDOM: title,
        update: (updatedNode: ProseMirrorNode): boolean => {
          if (updatedNode.type.name !== 'subTaskRef') return false;
          if (updatedNode.attrs.taskId !== node.attrs.taskId) return false;
          applyState(updatedNode);
          return true;
        },
      };
    };
  },
});

/* -------------------------------------------------------------------------- */
/* Persistence                                                                 */
/* -------------------------------------------------------------------------- */

const readBlob = async (): Promise<StoredState> => {
  try {
    const raw = await PluginAPI.loadSyncedData();
    if (!raw) return { version: STORAGE_VERSION, docs: {} };
    const parsed = JSON.parse(raw) as StoredState;
    if (parsed && typeof parsed === 'object') {
      return {
        ...parsed,
        version: parsed.version || STORAGE_VERSION,
        docs: parsed.docs || {},
      };
    }
  } catch (err) {
    logErr('Failed to parse stored doc state', err);
  }
  return { version: STORAGE_VERSION, docs: {} };
};

const loadStoredState = async (): Promise<void> => {
  storedState = await readBlob();
};

const flushSave = async (): Promise<void> => {
  if (saveTimer !== null) {
    clearTimeout(saveTimer);
    saveTimer = null;
  }
  if (!currentCtx || !editor) return;
  try {
    const latest = await readBlob();
    const merged: StoredState = {
      ...latest,
      docs: { ...latest.docs, [currentCtx.id]: editor.getJSON() },
    };
    storedState = merged;
    await PluginAPI.persistDataSynced(JSON.stringify(merged));
  } catch (err) {
    logErr('persistDataSynced failed', err);
  }
};

const scheduleSave = (): void => {
  if (isLoadingDoc) return;
  // Refuse to persist while the doc is a fallback (loaded from a blob we
  // couldn't parse). Saving here would overwrite the original blob with
  // an empty seed.
  if (isDocCorrupt) return;
  if (saveTimer !== null) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    void flushSave();
  }, SAVE_DEBOUNCE_MS);
};

/* -------------------------------------------------------------------------- */
/* Seed + task sync                                                            */
/* -------------------------------------------------------------------------- */

/**
 * Build a fresh doc from the work-context's task list. Task titles are
 * pulled from the cache (populated by refreshTaskCache before this is
 * called) so the taskRef nodes have content, not just IDs.
 */
const taskNodeJSON = (taskId: string, variant: 'taskRef' | 'subTaskRef'): unknown => {
  const task = taskCache.get(taskId);
  const title = task?.title || '';
  return {
    type: variant,
    attrs: { taskId, isDone: !!task?.isDone },
    content: title ? [{ type: 'text', text: title }] : [],
  };
};

const taskRefWithSubtasksJSON = (taskId: string): unknown[] => {
  const task = taskCache.get(taskId);
  const out: unknown[] = [taskNodeJSON(taskId, 'taskRef')];
  for (const subId of task?.subTaskIds ?? []) {
    out.push(taskNodeJSON(subId, 'subTaskRef'));
  }
  return out;
};

const buildSeedDoc = (ctx: ActiveWorkContext): unknown => {
  return {
    type: 'doc',
    content: [
      {
        type: 'heading',
        attrs: { level: 1 },
        content: [{ type: 'text', text: ctx.title }],
      },
      ...ctx.taskIds.flatMap(taskRefWithSubtasksJSON),
      { type: 'paragraph' },
    ],
  };
};

type PMText = { type: 'text'; text: string };
type PMNode = {
  type?: string;
  attrs?: Record<string, unknown>;
  content?: (PMNode | PMText)[];
  text?: string;
};

/**
 * Older docs stored taskRef as an atom node (no `content` array). Walk the
 * stored JSON and populate content from the task cache so the new
 * content-bearing schema can load them. Idempotent — nodes that already
 * have content are left alone.
 */
/**
 * After loading a stored doc (which may have been saved before subtasks were
 * supported), walk the top-level content and insert any subTaskRefs from the
 * host that aren't already present right after their parent taskRef.
 * Idempotent — existing subtask blocks are preserved in order.
 */
const ensureSubtasksInJSON = (doc: unknown): unknown => {
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
      const parent = taskCache.get(parentId);
      const existing = new Set<string>();
      let j = i + 1;
      while (j < src.length && (src[j] as PMNode).type === 'subTaskRef') {
        out.push(src[j]);
        existing.add(((src[j] as PMNode).attrs?.taskId as string) || '');
        j++;
      }
      if (parent?.subTaskIds) {
        for (const subId of parent.subTaskIds) {
          if (subId && !existing.has(subId)) {
            out.push(taskNodeJSON(subId, 'subTaskRef') as PMNode);
          }
        }
      }
      i = j;
    } else {
      i++;
    }
  }
  return { ...root, content: out };
};

const migrateStoredDoc = (raw: unknown): unknown => {
  const visit = (node: PMNode | PMText | undefined): PMNode | PMText | undefined => {
    if (!node || typeof node !== 'object') return node;
    if ('text' in node) return node;
    if (node.type === 'taskRef' || node.type === 'subTaskRef') {
      const taskId = (node.attrs?.taskId as string) || '';
      const task = taskCache.get(taskId);
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

const refreshTaskCache = async (): Promise<void> => {
  try {
    const tasks = await PluginAPI.getTasks();
    taskCache = new Map(tasks.map((t) => [t.id, t]));
  } catch (err) {
    logErr('getTasks failed', err);
  }
};

const setActiveContext = async (ctx: ActiveWorkContext | null): Promise<void> => {
  // Take a sequence number for this invocation. If a newer call arrives
  // (rapid context switches), the older one bails after each await so it
  // can't write the previous editor doc under the new context's id.
  const seq = ++activeContextSeq;
  await flushSave();
  if (seq !== activeContextSeq) return;

  // Drop pending title writes from the previous context — letting them
  // resolve later would mutate `taskCache` against tasks the new context
  // may not even own.
  for (const t of titleWriteTimers.values()) clearTimeout(t);
  titleWriteTimers.clear();
  pendingTitleWrites.clear();
  lastWrittenTitles.clear();

  currentCtx = ctx;
  isDocCorrupt = false;
  if (!ctx || !editor) return;

  isLoadingDoc = true;
  await refreshTaskCache();
  if (seq !== activeContextSeq) {
    isLoadingDoc = false;
    return;
  }
  lastSeenTaskIds = new Set(taskCache.keys());

  const stored = storedState.docs[ctx.id];
  const docJson = stored
    ? ensureSubtasksInJSON(migrateStoredDoc(stored))
    : buildSeedDoc(ctx);
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
      buildSeedDoc(ctx) as Parameters<typeof editor.commands.setContent>[0],
      false,
    );
  }
  isLoadingDoc = false;
};

const isTaskNode = (name: string): name is 'taskRef' | 'subTaskRef' =>
  name === 'taskRef' || name === 'subTaskRef';

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
  const endPos = editor.state.doc.content.size;
  editor
    .chain()
    .focus(endPos)
    .insertContentAt(endPos, { type: 'taskRef', attrs: { taskId } })
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
  editor
    .chain()
    .focus(parentEndPos)
    .insertContentAt(parentEndPos, { type: 'subTaskRef', attrs: { taskId } })
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
 */
const refreshTaskRef = (taskId: string): void => {
  if (!editor) return;
  if (pendingTitleWrites.has(taskId)) return;
  if (isTaskRefFocused(taskId)) return;
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

const onAnyTaskUpdate = (payload: AnyTaskUpdatePayload): void => {
  if (!currentCtx || !editor) return;
  const ctxSnapshot = currentCtx;
  void refreshTaskCache().then(() => {
    if (payload.taskId) refreshTaskRef(payload.taskId);

    // Auto-append only on transitions absent → present in the cache.
    // Without this, time-tracking ticks (and every other ANY_TASK_UPDATE
    // event for an existing task in this context) would re-insert chips
    // the user had deliberately removed from the doc.
    if (payload.task && payload.taskId) {
      const wasKnown = lastSeenTaskIds.has(payload.taskId);
      const isKnown = taskCache.has(payload.taskId);
      const isNewlyArrived = !wasKnown && isKnown;
      // Refresh the snapshot regardless so later events compute correctly.
      lastSeenTaskIds = new Set(taskCache.keys());
      if (!isNewlyArrived) return;
      const inProject =
        ctxSnapshot.type === 'PROJECT' && payload.task.projectId === ctxSnapshot.id;
      const inToday =
        ctxSnapshot.id === 'TODAY' &&
        (payload.task.tagIds?.includes('TODAY') ||
          !!payload.task.dueDay ||
          !!payload.task.dueWithTime);
      if (inProject || inToday) appendMissingTask(payload.taskId);
    } else {
      // Deletion or non-payload event — still keep the snapshot fresh so
      // we don't treat a re-arrival after deletion as the "same" task.
      lastSeenTaskIds = new Set(taskCache.keys());
    }
  });
};

/* -------------------------------------------------------------------------- */
/* Icons (inline SVG — no Google Fonts dependency)                             */
/* -------------------------------------------------------------------------- */

// Standard Material Symbols 24×24 outline paths. Kept as a static map so the
// iframe renders icons offline without loading the Material Icons web font.
const ICON_PATHS: Record<string, string> = {
  add: 'M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z',
  drag_indicator:
    'M11 18c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2zm-2-8c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0-6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm6 4c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z',
  arrow_upward: 'M4 12l1.41 1.41L11 7.83V20h2V7.83l5.58 5.59L20 12l-8-8-8 8z',
  arrow_downward: 'M20 12l-1.41-1.41L13 16.17V4h-2v12.17l-5.58-5.59L4 12l8 8 8-8z',
  content_copy:
    'M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z',
  delete: 'M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z',
  segment: 'M9 18h12v-2H9v2zM3 6v2h18V6H3zm6 7h12v-2H9v2z',
  title: 'M5 4v3h5.5v12h3V7H19V4z',
  text_fields: 'M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z',
  short_text: 'M4 9h16v2H4zm0 4h10v2H4z',
  format_list_bulleted:
    'M4 10.5c-.83 0-1.5.67-1.5 1.5s.67 1.5 1.5 1.5 1.5-.67 1.5-1.5-.67-1.5-1.5-1.5zm0-6c-.83 0-1.5.67-1.5 1.5S3.17 7.5 4 7.5 5.5 6.83 5.5 6 4.83 4.5 4 4.5zm0 12c-.83 0-1.5.68-1.5 1.5s.68 1.5 1.5 1.5 1.5-.68 1.5-1.5-.67-1.5-1.5-1.5zM7 19h14v-2H7v2zm0-6h14v-2H7v2zm0-8v2h14V5H7z',
  format_list_numbered:
    'M2 17h2v.5H3v1h1v.5H2v1h3v-4H2v1zm1-9h1V4H2v1h1v3zm-1 3h1.8L2 13.1v.9h3v-1H3.2L5 10.9V10H2v1zm5-6v2h14V5H7zm0 14h14v-2H7v2zm0-6h14v-2H7v2z',
  format_quote: 'M6 17h3l2-4V7H5v6h3zm8 0h3l2-4V7h-6v6h3z',
  code: 'M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  horizontal_rule: 'M4 11h16v2H4z',
  check_circle_outline:
    'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-2-7.7L7.7 10.7l-1.4 1.4L10 15.8l8-8-1.4-1.4z',
};

const iconSvg = (name: string, extraClass = ''): string => {
  const path = ICON_PATHS[name] ?? '';
  const cls = extraClass ? `doc-icon ${extraClass}` : 'doc-icon';
  return `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}"/></svg>`;
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
      action: () => ed.chain().focus().setHeading({ level: 1 }).run(),
    },
    {
      label: 'Heading 2',
      icon: 'text_fields',
      action: () => ed.chain().focus().setHeading({ level: 2 }).run(),
    },
    {
      label: 'Heading 3',
      icon: 'short_text',
      action: () => ed.chain().focus().setHeading({ level: 3 }).run(),
    },
    {
      label: 'Bullet list',
      icon: 'format_list_bulleted',
      action: () => ed.chain().focus().toggleBulletList().run(),
    },
    {
      label: 'Numbered list',
      icon: 'format_list_numbered',
      action: () => ed.chain().focus().toggleOrderedList().run(),
    },
    {
      label: 'Quote',
      icon: 'format_quote',
      action: () => ed.chain().focus().setBlockquote().run(),
    },
    {
      label: 'Code block',
      icon: 'code',
      action: () => ed.chain().focus().toggleCodeBlock().run(),
    },
    {
      label: 'Divider',
      icon: 'horizontal_rule',
      action: () => ed.chain().focus().setHorizontalRule().run(),
    },
    {
      label: 'New task',
      icon: 'check_circle_outline',
      action: async () => {
        if (!currentCtx) return;
        const taskId = await PluginAPI.addTask({
          title: 'New task',
          projectId: currentCtx.type === 'PROJECT' ? currentCtx.id : null,
        });
        await refreshTaskCache();
        ed.chain().focus().insertContent({ type: 'taskRef', attrs: { taskId } }).run();
      },
    },
  ];
};

let menuEl: HTMLDivElement | null = null;
let menuActiveIndex = 0;
let menuFilter = '';
let menuCurrentItems: MenuItem[] = [];

const closeMenu = (): void => {
  if (menuEl) {
    menuEl.remove();
    menuEl = null;
  }
  menuFilter = '';
  menuActiveIndex = 0;
  menuCurrentItems = [];
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
  items.forEach((item, idx) => {
    const el = document.createElement('div');
    el.className = 'slash-menu-item';
    if (idx === menuActiveIndex) el.classList.add('is-active');
    el.innerHTML = `
      ${iconSvg(item.icon, 'slash-menu-icon')}
      <span class="slash-menu-label">${item.label}</span>
      ${item.hint ? `<span class="slash-menu-hint">${item.hint}</span>` : ''}
    `;
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      closeMenu();
      item.action();
    });
    el.addEventListener('mouseenter', () => {
      menuActiveIndex = idx;
      menuEl
        ?.querySelectorAll('.slash-menu-item')
        .forEach((n, i) => n.classList.toggle('is-active', i === idx));
    });
    menuEl!.appendChild(el);
  });
  positionPopover(menuEl, rect);
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

const showSlashMenu = (): void => {
  if (!editor) return;
  menuActiveIndex = 0;
  menuFilter = '';
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

/**
 * Range of valid insertion indices for the dragging node. Subtasks must
 * stay inside their parent's group; top-level tasks can land between
 * groups (still allowed inside a group for now — out of scope).
 */
const validInsertRange = (draggingPos: number): { min: number; max: number } | null => {
  if (!editor) return null;
  const doc = editor.state.doc;
  const dragNode = doc.nodeAt(draggingPos);
  if (!dragNode || dragNode.type.name !== 'subTaskRef') return null;
  // Resolve the dragged node's index via manual iteration (same reason as
  // findParentTaskIdBefore — robust regardless of position-resolve corner
  // cases).
  let dragIdx = -1;
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (cursor === draggingPos) {
      dragIdx = i;
      break;
    }
    cursor += doc.child(i).nodeSize;
  }
  if (dragIdx < 0) return null;
  // Owning parent: nearest earlier taskRef, walking past sibling subtasks.
  let parentIdx = -1;
  for (let i = dragIdx - 1; i >= 0; i--) {
    const c = doc.child(i);
    if (c.type.name === 'taskRef') {
      parentIdx = i;
      break;
    }
    if (c.type.name !== 'subTaskRef') return null;
  }
  if (parentIdx < 0) return null;
  // Walk forward past contiguous subTaskRefs to find the group's end index.
  let end = parentIdx + 1;
  while (end < doc.childCount && doc.child(end).type.name === 'subTaskRef') end++;
  // Insertion gaps that keep the subtask in its group: anywhere between
  // parent and the first non-subtask sibling.
  return { min: parentIdx + 1, max: end };
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
  // Per-source constraints:
  //  • subTaskRef: stay inside the parent's subtask group (validInsertRange)
  //  • taskRef:    snap past a foreign subtask so the parent never lands
  //                between someone else's parent and their first subtask
  if (pendingDrag) {
    const doc = editor.state.doc;
    if (pendingDrag.sourceType === 'subTaskRef') {
      const range = validInsertRange(pendingDrag.nodePos);
      if (range) {
        targetIdx = Math.max(range.min, Math.min(targetIdx, range.max));
      }
    } else if (pendingDrag.sourceType === 'taskRef') {
      // If targetIdx points at a subTaskRef that isn't ours, advance past
      // the run so the parent group lands cleanly after its previous owner.
      while (
        targetIdx < doc.childCount &&
        doc.child(targetIdx).type.name === 'subTaskRef' &&
        !(
          targetIdx >= pendingDrag.fromIdx &&
          targetIdx < pendingDrag.fromIdx + pendingDrag.sliceLen
        )
      ) {
        targetIdx++;
      }
    }
    // Recompute indicatorY for the (possibly snapped) target.
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
      if (gutterEl) gutterEl.style.display = 'none';
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
  g.innerHTML = `
    <button class="block-gutter-btn" data-action="add" title="Insert below">
      ${iconSvg('add')}
    </button>
    <button class="block-gutter-btn" data-action="grip" title="Drag to move; click for menu">
      ${iconSvg('drag_indicator')}
    </button>
  `;
  g.style.display = 'none';
  document.body.appendChild(g);

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
    requestAnimationFrame(() => showSlashMenu());
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
    hoveredBlock = null;
    return;
  }
  const rect = block.getBoundingClientRect();
  gutterEl.style.display = 'flex';
  gutterEl.style.top = `${rect.top + window.scrollY}px`;
  gutterEl.style.left = `${rect.left + window.scrollX - 52}px`;
  gutterEl.style.height = `${Math.max(28, rect.height)}px`;
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

/**
 * For a top-level child index `idx`, return how many siblings move as a
 * single atomic unit. A parent taskRef is bundled with its trailing
 * subTaskRef children — moving the parent out from under its subtasks
 * leaves orphans whose host parent no longer matches their doc position.
 */
const sliceLenAt = (idx: number): number => {
  if (!editor) return 1;
  const doc = editor.state.doc;
  if (idx < 0 || idx >= doc.childCount) return 1;
  const node = doc.child(idx);
  if (node.type.name !== 'taskRef') return 1;
  let end = idx + 1;
  while (end < doc.childCount && doc.child(end).type.name === 'subTaskRef') end++;
  return end - idx;
};

const childIdxAtPos = (pos: number): number => {
  if (!editor) return -1;
  const doc = editor.state.doc;
  let cursor = 0;
  for (let i = 0; i < doc.childCount; i++) {
    if (cursor === pos) return i;
    cursor += doc.child(i).nodeSize;
  }
  return -1;
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
  const src = doc.child(idx);
  const sliceLen = sliceLenAt(idx);

  let targetIdx: number;
  if (direction === 'up') {
    if (idx === 0) return;
    if (src.type.name === 'subTaskRef') {
      // Stop at the parent boundary — never escape the group.
      if (doc.child(idx - 1).type.name !== 'subTaskRef') return;
      targetIdx = idx - 1;
    } else {
      // Walk past any subtask siblings to find the start of the previous group.
      let prev = idx - 1;
      while (prev > 0 && doc.child(prev).type.name === 'subTaskRef') prev--;
      targetIdx = prev;
    }
  } else {
    const sliceEnd = idx + sliceLen;
    if (sliceEnd >= doc.childCount) return;
    if (src.type.name === 'subTaskRef') {
      if (doc.child(sliceEnd).type.name !== 'subTaskRef') return;
      targetIdx = sliceEnd + 1;
    } else {
      // Walk past the next group's parent + its trailing subtasks.
      let groupEnd = sliceEnd + 1;
      while (
        groupEnd < doc.childCount &&
        doc.child(groupEnd).type.name === 'subTaskRef'
      ) {
        groupEnd++;
      }
      targetIdx = groupEnd;
    }
  }
  moveContentSliceToIndex(idx, sliceLen, targetIdx);
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
  const childCount = ed.state.doc.childCount;
  const canMoveUp = blockIdx > 0;
  const canMoveDown = blockIdx < childCount - 1;

  const items: MenuItem[] = [
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
  ];

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

  items.push(
    {
      label: 'Duplicate',
      icon: 'content_copy',
      action: () => {
        const node = ed.state.doc.nodeAt(nodePos);
        if (!node) return;
        ed.chain()
          .focus()
          .insertContentAt(nodePos + node.nodeSize, node.toJSON())
          .run();
      },
    },
    {
      label: 'Delete',
      icon: 'delete',
      action: () => {
        ed.chain().focus().setNodeSelection(nodePos).deleteSelection().run();
      },
    },
  );

  menuActiveIndex = 0;
  menuFilter = '';
  renderMenu(anchorRect, items);
};

/* -------------------------------------------------------------------------- */
/* Mount                                                                       */
/* -------------------------------------------------------------------------- */

const mount = async (): Promise<void> => {
  await loadStoredState();
  const initialCtx = await PluginAPI.getActiveWorkContext();

  const root = document.getElementById('editor-root');
  if (!root) {
    logErr('Document mode: #editor-root not found');
    return;
  }

  const bubbleEl = document.createElement('div');
  bubbleEl.className = 'bubble-menu';
  bubbleEl.innerHTML = `
    <button data-action="bold" title="Bold"><b>B</b></button>
    <button data-action="italic" title="Italic"><i>I</i></button>
    <button data-action="strike" title="Strike"><s>S</s></button>
    <button data-action="code" title="Code"><code>{}</code></button>
  `;
  document.body.appendChild(bubbleEl);

  editor = new Editor({
    element: root,
    extensions: [
      StarterKit,
      Placeholder.configure({ placeholder: "Type '/' for commands…" }),
      TaskRefNode,
      SubTaskRefNode,
      BubbleMenu.configure({
        element: bubbleEl,
        shouldShow: ({ from, to, state }) => {
          if (from === to) return false;
          // Don't show on atom node selections (taskRef).
          const node = state.doc.nodeAt(from);
          if (node?.isAtom) return false;
          return true;
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
        ev.preventDefault();
        if (menuCurrentItems[menuActiveIndex]) {
          const action = menuCurrentItems[menuActiveIndex].action;
          closeMenu();
          action();
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
        menuFilter += ev.key;
        filterAndRender(caretRect());
        return;
      }
    } else if (ev.key === '/') {
      setTimeout(() => showSlashMenu(), 0);
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

  window.addEventListener('pagehide', () => {
    void flushSave();
  });
};

const waitForPluginAPI = (): Promise<void> =>
  new Promise<void>((resolve) => {
    const check = (): void => {
      if (
        typeof (window as unknown as { PluginAPI?: unknown }).PluginAPI !== 'undefined'
      ) {
        resolve();
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });

void waitForPluginAPI().then(() => mount());
