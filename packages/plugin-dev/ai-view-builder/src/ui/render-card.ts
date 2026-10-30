import type { CardModel, Chip } from '../core/cards';
import { el } from './dom';

// A task card, drawn like a row in Super Productivity: a done circle, the
// title with project and tag chips under it, estimate and due on the right.

export interface BuildCtx {
  selectedId: string | null;
  taskCounts: Map<string, number>;
  canTrack: boolean;
}

const chip = (c: Chip): HTMLElement => {
  const node = el('span', 'tag-chip', c.label);
  // The color was validated in the model; a custom property keeps the
  // stylesheet in charge of how it is used.
  if (c.color) node.style.setProperty('--chip', c.color);
  return node;
};

const sublineOf = (c: CardModel): HTMLElement | null => {
  if (!c.chips.length && !c.meta.length) return null;
  const line = el('div', 'card-sub');
  c.chips.forEach((x) => line.appendChild(chip(x)));
  if (c.meta.length) line.appendChild(el('span', 'card-meta', c.meta.join(' · ')));
  return line;
};

const asideOf = (c: CardModel): HTMLElement | null => {
  if (!c.due && !c.estimate) return null;
  const aside = el('div', 'card-aside');
  if (c.due) {
    const due = el('span', `card-due${c.due.overdue ? ' is-overdue' : ''}`, c.due.text);
    due.title = c.due.overdue ? 'Overdue' : 'Due';
    aside.appendChild(due);
  }
  if (c.estimate) {
    const est = el('span', 'card-est', c.estimate);
    est.title = 'Estimate';
    aside.appendChild(est);
  }
  return aside;
};

const doneButton = (c: CardModel): HTMLButtonElement => {
  const done = el('button', 'icon-btn done-btn', c.isDone ? '✓' : '');
  done.type = 'button';
  done.dataset.action = 'done';
  done.setAttribute(
    'aria-label',
    c.isDone ? `Mark "${c.title}" not done` : `Mark "${c.title}" done`,
  );
  return done;
};

const trackButton = (c: CardModel): HTMLButtonElement => {
  const track = el('button', 'icon-btn track-btn', c.isTracking ? '❚❚' : '▶');
  track.type = 'button';
  track.dataset.action = 'track';
  track.setAttribute(
    'aria-label',
    c.isTracking ? 'Stop tracking time' : 'Start tracking time',
  );
  return track;
};

export const card = (
  c: CardModel,
  cid: string,
  ctx: BuildCtx,
  draggable: boolean,
): HTMLElement => {
  const node = el(
    'div',
    `card task${c.isDone ? ' is-done' : ''}${c.isTracking ? ' is-tracking' : ''}`,
  );
  // A task shown once keeps one key everywhere, so it glides between parts;
  // a task shown twice gets a key per part, so the two copies do not clash.
  node.dataset.flip =
    (ctx.taskCounts.get(c.id) ?? 0) > 1 ? `t:${cid}:${c.id}` : `t:${c.id}`;
  node.dataset.tid = c.id;
  node.dataset.cid = cid;
  node.setAttribute('role', 'listitem');
  if (draggable && !c.isSubTask) {
    node.tabIndex = 0;
    node.dataset.draggable = 'true';
    node.setAttribute(
      'aria-roledescription',
      'draggable task; Alt+Left or Alt+Right moves it',
    );
  }
  node.appendChild(doneButton(c));

  const body = el('div', 'card-body');
  const title = el('button', 'card-title', c.title);
  title.type = 'button';
  title.dataset.action = 'open';
  body.appendChild(title);
  const sub = sublineOf(c);
  if (sub) body.appendChild(sub);
  node.appendChild(body);

  const aside = asideOf(c);
  if (aside) node.appendChild(aside);
  if (ctx.canTrack && !c.isDone) node.appendChild(trackButton(c));
  return node;
};

export const cardList = (
  cards: CardModel[],
  cid: string,
  ctx: BuildCtx,
  draggable: boolean,
): HTMLElement => {
  const list = el('div', 'cards');
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
