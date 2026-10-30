import type { CardModel } from '../core/cards';
import { addRow, type AddInputs } from './add-inputs';
import { el } from './dom';
import {
  collapseToggle,
  doneToggle,
  dueEl,
  indicators,
  moreButton,
  progressBar,
  tagsRow,
  timeBlock,
} from './card-parts';

// A task card, drawn like a row in Super Productivity: done toggle, title with
// project and tag chips under it, time on the right, sub-tasks nested below.
// Hover controls and the context menu are added on demand (card-events.ts).

export interface BuildCtx {
  /** The selected PART (its cid), for changing it by voice. */
  selectedId: string | null;
  /** The task open in the host's detail panel. */
  selectedTaskId: string | null;
  taskCounts: Map<string, number>;
  canTrack: boolean;
  /** Task ids whose sub-tasks are folded; local to this view, not written. */
  collapsed: ReadonlySet<string>;
  /** Which add inputs are open, and what is typed in them. */
  adds: AddInputs;
  /** No hover: the more button is always shown, there are no hover controls. */
  isTouch: boolean;
}

const cardClass = (c: CardModel, ctx: BuildCtx): string =>
  [
    'card task',
    c.isDone && 'is-done',
    c.isTracking && 'is-tracking',
    ctx.selectedTaskId === c.id && 'is-selected',
    c.isSubTask && 'is-sub-task',
    c.subTasks.length > 0 && 'has-sub-tasks',
  ]
    .filter(Boolean)
    .join(' ');

const mainEl = (c: CardModel): HTMLElement => {
  const main = el('div', 'card-main');
  const title = el('div', 'card-title', c.title);
  title.dataset.action = 'title';
  main.appendChild(title);
  const tags = tagsRow(c);
  if (tags) main.appendChild(tags);
  return main;
};

const sideEl = (c: CardModel, ctx: BuildCtx): HTMLElement => {
  const side = el('div', 'card-side');
  for (const part of [timeBlock(c), dueEl(c), ...indicators(c)]) {
    if (part) side.appendChild(part);
  }
  if (ctx.isTouch) side.appendChild(moreButton());
  return side;
};

const lineEl = (c: CardModel, ctx: BuildCtx): HTMLElement => {
  const line = el('div', 'card-line');
  line.append(doneToggle(c), mainEl(c), sideEl(c, ctx));
  return line;
};

const subTasksEl = (c: CardModel, cid: string, ctx: BuildCtx): HTMLElement => {
  const isCollapsed = ctx.collapsed.has(c.id);
  const box = el('div', `sub-tasks${isCollapsed ? ' is-collapsed' : ''}`);
  if (c.subTasks.length) box.appendChild(collapseToggle(c, isCollapsed));
  if (isCollapsed) return box;
  if (c.subTasks.length) box.appendChild(cardList(c.subTasks, cid, ctx, false, true));
  const key = subTaskKey(c.id);
  if (ctx.adds.isOpen(key)) {
    box.appendChild(addRow({ key, label: 'New sub-task' }, ctx.adds, 'sub-task-add'));
  }
  return box;
};

const subTaskKey = (taskId: string): string => `sub:${taskId}`;

const keyboardHint = 'draggable task; Alt+Left or Alt+Right moves it';

export const card = (
  c: CardModel,
  cid: string,
  ctx: BuildCtx,
  draggable: boolean,
): HTMLElement => {
  const node = el('div', cardClass(c, ctx));
  // A task shown once keeps one key everywhere, so it glides between parts;
  // a task shown twice gets a key per part, so the two copies do not clash.
  node.dataset.flip =
    (ctx.taskCounts.get(c.id) ?? 0) > 1 ? `t:${cid}:${c.id}` : `t:${c.id}`;
  node.dataset.tid = c.id;
  node.dataset.cid = cid;
  node.setAttribute('role', 'listitem');
  node.tabIndex = 0;
  if (c.isTracking) node.setAttribute('aria-current', 'true');
  if (draggable && !c.isSubTask) {
    node.dataset.draggable = 'true';
    node.setAttribute('aria-roledescription', keyboardHint);
  }
  node.appendChild(lineEl(c, ctx));
  const progress = progressBar(c);
  if (progress) node.appendChild(progress);
  if (c.subTasks.length || ctx.adds.isOpen(subTaskKey(c.id))) {
    node.appendChild(subTasksEl(c, cid, ctx));
  }
  return node;
};

export const cardList = (
  cards: CardModel[],
  cid: string,
  ctx: BuildCtx,
  draggable: boolean,
  isSubList = false,
): HTMLElement => {
  const list = el('div', isSubList ? 'cards sub-cards' : 'cards');
  list.setAttribute('role', 'list');
  cards.forEach((c) => list.appendChild(card(c, cid, ctx, draggable)));
  return list;
};

/** A group or column heading: name, task count, summed estimate and an optional date. */
export const heading = (
  cls: string,
  label: string,
  count: number,
  extra: { estimate?: string; date?: string } = {},
): HTMLElement => {
  const node = el('h4', cls);
  node.appendChild(el('span', 'heading-name', label));
  if (extra.date) node.appendChild(el('span', 'heading-date', extra.date));
  node.appendChild(el('span', 'heading-count', String(count)));
  if (extra.estimate) {
    const sum = el('span', 'heading-sum', extra.estimate);
    sum.title = 'Estimate';
    node.appendChild(sum);
  }
  return node;
};
