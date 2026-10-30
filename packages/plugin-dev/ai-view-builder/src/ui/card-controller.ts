import type { ModelEnv } from '../core/cards';
import type { KeyCommand } from '../core/card-keys';
import {
  isAvailable,
  menuEntries,
  parseDuration,
  type CardAction,
  type MenuView,
} from '../core/task-actions';
import { focusAddInput, type AddInputs } from './add-inputs';
import type { CardActions } from './card-actions';
import { editEstimate, editTitle } from './card-edit';
import { openCardMenu, type MenuSource, type OpenMenu } from './card-menu';

// Decides what a gesture on a card means and starts it: an inline editor, the
// menu, a write through the actions. The DOM events that lead here are wired
// in card-events.ts; the keys in core/card-keys.ts.

export interface ControllerDeps {
  root: HTMLElement;
  actions: CardActions;
  adds: AddInputs;
  /** Task ids whose sub-tasks are folded in this view. */
  collapsed: Set<string>;
  env(): ModelEnv | null;
  canTrack: boolean;
  /** Draws the view again even if the data did not change. */
  redraw(): void;
  /** An inline editor closed; whatever was held back while typing can be drawn. */
  editorEnded(): void;
}

export interface Point {
  x: number;
  y: number;
}

export interface CardController {
  run(action: CardAction, cardEl: HTMLElement): void;
  command(cmd: KeyCommand, cardEl: HTMLElement): void;
  openMenu(cardEl: HTMLElement, view: MenuView, at: Point): void;
  toggleCollapse(cardEl: HTMLElement): void;
}

const findCard = (root: HTMLElement, tid: string, cid: string): HTMLElement | null =>
  root.querySelector<HTMLElement>(
    `.card[data-tid="${CSS.escape(tid)}"][data-cid="${CSS.escape(cid)}"]`,
  );

/** Where a menu opened from the keyboard appears: on the card, not at a pointer. */
const cardAnchor = (cardEl: HTMLElement): Point => {
  const rect = cardEl.getBoundingClientRect();
  return { x: rect.left + 48, y: rect.top + 24 };
};

export const createCardController = (deps: ControllerDeps): CardController => {
  const { root, actions } = deps;
  let menu: OpenMenu | null = null;
  const taskOf = (id: string) => deps.env()?.tasks.find((t) => t.id === id);

  const startEstimate = (cardEl: HTMLElement, id: string, ms: number): void => {
    // The hover controls sit on top of the place the editor takes.
    cardEl.querySelector(':scope > .card-line > .hover-controls')?.remove();
    editEstimate(cardEl, ms, {
      validate: (text) => parseDuration(text) !== null,
      commit: (text) => actions.saveEstimate(id, parseDuration(text) ?? 0),
      end: deps.editorEnded,
    });
  };

  const startSubTask = (id: string): void => {
    deps.collapsed.delete(id);
    deps.adds.open(`sub:${id}`);
    deps.redraw();
    focusAddInput(root, `sub:${id}`);
  };

  const menuSource = (id: string, cid: string): MenuSource => ({
    entries: (view) => {
      const env = deps.env();
      const task = taskOf(id);
      if (!env || !task) return [];
      const { tags, projects } = env;
      const isTracking = env.currentTaskId === id;
      return menuEntries(view, {
        task,
        isTracking,
        canTrack: deps.canTrack,
        tags,
        projects,
      });
    },
    pick: (entryId) => {
      if (entryId.startsWith('tag:')) return actions.toggleTag(id, entryId.slice(4));
      if (entryId.startsWith('project:')) {
        return actions.moveToProject(id, entryId.slice(8));
      }
      const cardEl = findCard(root, id, cid);
      if (cardEl) run(entryId as CardAction, cardEl);
    },
  });

  const openMenu = (cardEl: HTMLElement, view: MenuView, at: Point): void => {
    menu?.close();
    const id = cardEl.dataset.tid!;
    const cid = cardEl.dataset.cid!;
    menu = openCardMenu({
      source: menuSource(id, cid),
      view,
      at,
      label: 'Task actions',
      onClose: (refocus) => {
        menu = null;
        if (refocus) findCard(root, id, cid)?.focus({ preventScroll: true });
      },
    });
  };

  const startMenu = (cardEl: HTMLElement, view: MenuView): void => {
    const task = taskOf(cardEl.dataset.tid!);
    if (!task) return;
    // Sub-tasks have no tags of their own and move with their parent.
    if (view !== 'main' && !isAvailable(view, task, deps.canTrack)) return;
    openMenu(cardEl, view, cardAnchor(cardEl));
  };

  const run = (action: CardAction, cardEl: HTMLElement): void => {
    const id = cardEl.dataset.tid!;
    const task = taskOf(id);
    if (!task || !isAvailable(action, task, deps.canTrack)) return;
    const handlers: Record<CardAction, () => void> = {
      toggleDone: () => actions.toggleDone(id),
      toggleTrack: () => actions.toggleTrack(id),
      editTitle: () =>
        editTitle(cardEl, task.title, {
          commit: (text) => actions.saveTitle(id, text),
          end: deps.editorEnded,
        }),
      editEstimate: () => startEstimate(cardEl, id, task.timeEstimate),
      addSubTask: () => startSubTask(id),
      tags: () => startMenu(cardEl, 'tags'),
      project: () => startMenu(cardEl, 'project'),
      open: () => actions.open(id),
      delete: () => actions.remove(id),
    };
    handlers[action]();
  };

  const setCollapsed = (cardEl: HTMLElement, isCollapsed: boolean): void => {
    const id = cardEl.dataset.tid!;
    if (
      !cardEl.querySelector(':scope > .sub-tasks') ||
      deps.collapsed.has(id) === isCollapsed
    ) {
      return;
    }
    if (isCollapsed) deps.collapsed.add(id);
    else deps.collapsed.delete(id);
    deps.redraw();
    findCard(root, id, cardEl.dataset.cid!)?.focus({ preventScroll: true });
  };

  const moveFocus = (cardEl: HTMLElement, direction: -1 | 1): void => {
    const cards = Array.from(root.querySelectorAll<HTMLElement>('.card'));
    cards[cards.indexOf(cardEl) + direction]?.focus();
  };

  return {
    run,
    openMenu,
    toggleCollapse: (cardEl) =>
      setCollapsed(cardEl, !deps.collapsed.has(cardEl.dataset.tid!)),
    command: (cmd, cardEl) => {
      switch (cmd.type) {
        case 'action':
          return run(cmd.action, cardEl);
        case 'menu':
          return startMenu(cardEl, cmd.view);
        case 'focus':
          return moveFocus(cardEl, cmd.direction);
        case 'collapse':
          return setCollapsed(cardEl, cmd.collapsed);
        case 'release':
          return cardEl.blur();
      }
    },
  };
};
