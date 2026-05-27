/**
 * The `taskRef` / `subTaskRef` TipTap node — a content-bearing block whose
 * inline content IS the linked task's title, so typing inside it edits the
 * task. `taskRef` is a top-level chip; `subTaskRef` is the indented subtask
 * variant. The two are otherwise identical, so a single factory builds
 * both — the only differences are the node name, the `.sub-task-ref` CSS
 * hook, and which task the Enter-at-end shortcut creates.
 *
 * The factory takes a `deps` object instead of reaching into `ui/editor.ts`
 * module globals: the node is constructed before the `Editor` exists, so
 * `getEditor()` is a late-bound getter, and the task-mutating callbacks
 * live in editor.ts where the host `PluginAPI` and caches are owned.
 */

import { Editor, Node, mergeAttributes } from '@tiptap/core';
import type { NodeViewRendererProps } from '@tiptap/core';
import type { Node as ProseMirrorNode } from '@tiptap/pm/model';
import type { TaskLookup } from '../doc-transform';
import * as docNav from './doc-nav';

export type TaskRefVariant = 'taskRef' | 'subTaskRef';

/** Editor-side collaborators a task-ref node needs to do its job. */
export interface TaskRefNodeDeps {
  /** Late-bound editor accessor — the node is created before the Editor is. */
  getEditor: () => Editor | null;
  /** Resolves a task id to the host's current task. */
  lookupTask: TaskLookup;
  /** Toggle a task's done state (host write-back + optimistic chip update). */
  toggleTaskDone: (taskId: string) => void;
  /** Delete a task, tolerating an already-gone one. */
  deleteTaskTolerant: (taskId: string) => Promise<void>;
  /** Create a new empty top-level task and insert its chip at `insertPos`. */
  createTaskAfter: (insertPos: number) => Promise<void>;
  /** Create a new empty subtask under `parentTaskId` and insert its chip. */
  createSubTaskAfter: (insertPos: number, parentTaskId: string) => Promise<void>;
}

/** Done-toggle markup — a squircle outline with an animated checkmark. */
const DONE_TOGGLE_SVG = `
  <svg class="done-toggle-svg" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <rect class="done-circle" x="3" y="3" width="18" height="18" rx="5" ry="5"></rect>
    <polyline class="done-check" points="6,12 10.5,16.5 18,8"></polyline>
  </svg>
`;

/** The chip the caret currently sits in, or null. */
interface ChipInfo {
  atStart: boolean;
  atEnd: boolean;
  isEmpty: boolean;
  taskId: string;
  nodePos: number;
  nodeSize: number;
}

/**
 * Build the `taskRef` or `subTaskRef` node. Both share content/attrs/parse/
 * render plumbing and the NodeView; `variant` selects the name, the
 * `.sub-task-ref` class, the parse/render data attribute, and the
 * Enter-at-end behaviour.
 */
export const createTaskRefNode = (
  variant: TaskRefVariant,
  deps: TaskRefNodeDeps,
): Node => {
  const isSub = variant === 'subTaskRef';
  const dataAttr = isSub ? 'data-sub-task-ref' : 'data-task-ref';
  const cssClass = isSub ? 'task-ref sub-task-ref' : 'task-ref';

  return Node.create({
    name: variant,
    group: 'block',
    content: 'inline*',
    selectable: true,
    draggable: true,

    addKeyboardShortcuts() {
      // Chip the caret is in, or null if the selection is elsewhere.
      const inChip = (): ChipInfo | null => {
        const editor = deps.getEditor();
        if (!editor) return null;
        const { $from } = editor.state.selection;
        if ($from.parent.type.name !== variant) return null;
        const node = $from.parent;
        return {
          atStart: $from.parentOffset === 0,
          atEnd: $from.parentOffset === node.content.size,
          isEmpty: node.content.size === 0,
          taskId: node.attrs.taskId as string,
          nodePos: $from.before($from.depth),
          nodeSize: node.nodeSize,
        };
      };

      return {
        Enter: () => {
          const info = inChip();
          if (!info) return false;
          const editor = deps.getEditor();
          if (!editor) return false;
          if (info.isEmpty) {
            // Empty chip + Enter → convert to a paragraph, delete the
            // empty task. Drop the NodeSelection afterwards so a follow-up
            // Enter behaves normally (a NodeSelection routes Enter through
            // a different path).
            if (info.taskId) void deps.deleteTaskTolerant(info.taskId);
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
            if (isSub) {
              // Enter at end of a subtask → another subtask, same parent.
              const parentTaskId = docNav.findParentTaskIdBefore(
                editor.state.doc,
                info.nodePos,
              );
              if (!parentTaskId) return false;
              void deps.createSubTaskAfter(info.nodePos + info.nodeSize, parentTaskId);
              return true;
            }
            // Enter at end of a parent chip → new empty task below, after
            // any subtasks of this task so it lands after the whole group.
            const insertAfter = docNav.positionAfterParentGroup(
              editor.state.doc,
              info.nodePos,
            );
            void deps.createTaskAfter(insertAfter);
            return true;
          }
          // Enter in the middle: swallow — splitting would yield two chips
          // with the same taskId.
          return true;
        },
        Backspace: () => {
          const info = inChip();
          if (!info) return false;
          if (!info.atStart) return false;
          if (info.isEmpty) {
            // Empty chip + Backspace at start → delete task + remove chip.
            if (info.taskId) void deps.deleteTaskTolerant(info.taskId);
            const editor = deps.getEditor();
            if (!editor) return false;
            editor.chain().focus().setNodeSelection(info.nodePos).deleteSelection().run();
            return true;
          }
          // Non-empty chip + Backspace at start: suppress the default so
          // the chip content isn't merged into the previous block (which
          // would detach the title from the task).
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
          tag: `div[${dataAttr}]`,
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
          [dataAttr]: '',
          'data-task-id': HTMLAttributes.taskId,
          class: cssClass,
        }),
        0,
      ];
    },

    addNodeView() {
      return ({ node }: NodeViewRendererProps) => {
        const dom = document.createElement('div');
        dom.className = cssClass;
        dom.dataset[isSub ? 'subTaskRef' : 'taskRef'] = '';
        dom.dataset.taskId = node.attrs.taskId;

        // Done-toggle: matches the app's <done-toggle>.
        const toggle = document.createElement('span');
        toggle.className = 'done-toggle';
        toggle.contentEditable = 'false';
        toggle.setAttribute('role', 'checkbox');
        // Keyboard-focusable so a task can be completed without a mouse —
        // the chip's only other route is the undiscoverable Mod-Enter.
        toggle.setAttribute('tabindex', '0');
        toggle.innerHTML = DONE_TOGGLE_SVG;

        const title = document.createElement('span');
        title.className = 'title';

        const applyState = (n: ProseMirrorNode): void => {
          const task = deps.lookupTask(n.attrs.taskId as string);
          if (!task) {
            dom.classList.add('is-missing');
            dom.classList.remove('is-done');
            toggle.setAttribute('aria-checked', 'false');
            toggle.setAttribute('aria-disabled', 'true');
            toggle.setAttribute('aria-label', 'Task not found');
          } else {
            dom.classList.remove('is-missing');
            // Trust task.isDone (the host's source of truth) — the attr is
            // optimistic and only useful for the undo stack. OR-ing would
            // keep "done" stuck visually if the host clears it but the doc
            // node's attr hasn't been refreshed (e.g. while focused).
            const done = !!task.isDone;
            dom.classList.toggle('is-done', done);
            toggle.setAttribute('aria-checked', done ? 'true' : 'false');
            toggle.removeAttribute('aria-disabled');
            toggle.setAttribute('aria-label', done ? 'Mark as not done' : 'Mark as done');
          }
        };

        toggle.addEventListener('mousedown', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          deps.toggleTaskDone(node.attrs.taskId as string);
        });

        // Enter / Space activate the toggle for keyboard users. stopPropagation
        // keeps the keypress out of ProseMirror's keymap; the document-level
        // Mod-Enter handler already ignores an unmodified Enter.
        toggle.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          ev.preventDefault();
          ev.stopPropagation();
          deps.toggleTaskDone(node.attrs.taskId as string);
        });

        dom.appendChild(toggle);
        dom.appendChild(title);
        applyState(node);

        return {
          dom,
          contentDOM: title,
          update: (updatedNode: ProseMirrorNode): boolean => {
            if (updatedNode.type.name !== variant) return false;
            if (updatedNode.attrs.taskId !== node.attrs.taskId) return false;
            applyState(updatedNode);
            return true;
          },
        };
      };
    },
  });
};
