import type { CardModel, CardTime, Chip } from '../core/cards';
import { el } from './dom';
import { doneGlyph, icon, IconName, isIconName } from './icons';

// The pieces of a task row, each a small function so the card reads as the
// layout of a Super Productivity row: done toggle, title and tags, time, hints.

const button = (cls: string, action: string, label: string): HTMLButtonElement => {
  const btn = el('button', cls);
  btn.type = 'button';
  btn.dataset.action = action;
  btn.setAttribute('aria-label', label);
  btn.title = label;
  return btn;
};

export const doneToggle = (c: CardModel): HTMLButtonElement => {
  const label = c.isDone ? `Mark "${c.title}" not done` : `Mark "${c.title}" done`;
  const btn = button('done-toggle', 'done', label);
  btn.appendChild(doneGlyph());
  return btn;
};

const chipGlyph = (chip: Chip, isProject: boolean): HTMLElement | SVGElement => {
  const name = chip.icon && isIconName(chip.icon) ? chip.icon : null;
  const glyph: IconName | null = name ?? (isProject ? 'list' : null);
  if (!glyph) return el('span', 'tag-dot');
  const node = icon(glyph);
  node.classList.add('tag-ico');
  return node;
};

const chipEl = (chip: Chip, isProject: boolean): HTMLElement => {
  const node = el('span', `card-tag${isProject ? ' is-project' : ''}`);
  // The color was validated in the model; a custom property keeps the
  // stylesheet in charge of how it is used.
  if (chip.color) node.style.setProperty('--chip', chip.color);
  node.appendChild(chipGlyph(chip, isProject));
  node.appendChild(el('span', 'tag-title', chip.label));
  return node;
};

export const tagsRow = (c: CardModel): HTMLElement | null => {
  if (!c.chips.length && !c.meta.length && !c.isRepeating) return null;
  const row = el('div', 'card-tags');
  c.chips.forEach((chip, i) =>
    row.appendChild(chipEl(chip, c.hasProjectChip && i === 0)),
  );
  if (c.isRepeating) {
    const repeat = icon('repeat');
    repeat.classList.add('card-repeat');
    row.appendChild(repeat);
  }
  if (c.meta.length) row.appendChild(el('span', 'card-meta', c.meta.join(' · ')));
  return row;
};

const timeVal = (glyph: IconName | null, text: string): HTMLElement => {
  const val = el('span', 'time-val');
  if (glyph) val.appendChild(icon(glyph));
  val.appendChild(el('span', undefined, text));
  return val;
};

const timeVals = (t: CardTime): HTMLElement[] =>
  t.isParent
    ? [
        ...(t.spent ? [timeVal('sigma', t.spent)] : []),
        ...(t.left ? [timeVal('hourglass', t.left)] : []),
      ]
    : [
        ...(t.spent ? [timeVal(null, t.spent)] : []),
        ...(t.estimate ? [timeVal(null, t.estimate)] : []),
      ];

/** Spent over estimate, or a parent's totals; only a task without sub-tasks takes an estimate. */
export const timeBlock = (c: CardModel): HTMLElement | null => {
  if (!c.time) return null;
  const vals = timeVals(c.time);
  const wrap = c.time.isParent
    ? el('div', 'card-time')
    : button('card-time is-editable', 'estimate', 'Estimate');
  vals.forEach((v, i) => {
    if (i) wrap.appendChild(el('span', 'time-sep'));
    wrap.appendChild(v);
  });
  return wrap;
};

export const dueEl = (c: CardModel): HTMLElement | null => {
  if (!c.due) return null;
  const due = el('span', `card-due${c.due.overdue ? ' is-overdue' : ''}`);
  due.title = c.due.overdue ? 'Overdue' : 'Scheduled';
  due.appendChild(icon('calendar'));
  due.appendChild(el('span', undefined, c.due.text));
  return due;
};

const indicator = (glyph: IconName, label: string): HTMLButtonElement => {
  const btn = button('card-ind', 'open', label);
  btn.appendChild(icon(glyph));
  return btn;
};

export const indicators = (c: CardModel): HTMLElement[] => [
  ...(c.attachments ? [indicator('attach', 'Attachments')] : []),
  ...(c.hasNotes ? [indicator('notes', 'Notes')] : []),
];

export const moreButton = (): HTMLButtonElement => {
  const btn = button('card-more', 'menu', 'More actions');
  btn.setAttribute('aria-haspopup', 'menu');
  btn.appendChild(icon('more'));
  return btn;
};

export const progressBar = (c: CardModel): HTMLElement | null => {
  if (!c.isTracking || c.progress === undefined) return null;
  const bar = el('div', 'card-progress');
  const fill = el('span', 'card-progress-fill');
  fill.style.width = `${c.progress}%`;
  bar.appendChild(fill);
  return bar;
};

/** The round button on a parent row's left edge: fold or unfold its sub-tasks. */
export const collapseToggle = (c: CardModel, isCollapsed: boolean): HTMLButtonElement => {
  const sub = c.subCount;
  const label = sub ? `Sub-tasks, ${sub.done} of ${sub.total} done` : 'Toggle sub-tasks';
  const btn = button('toggle-sub-tasks', 'collapse', label);
  btn.setAttribute('aria-expanded', String(!isCollapsed));
  btn.appendChild(icon(isCollapsed ? 'add' : 'remove'));
  if (isCollapsed && sub) {
    btn.appendChild(el('span', 'sub-badge', `${sub.done}/${sub.total}`));
  }
  return btn;
};

/** Hover controls: mounted on demand, so a long list does not carry them on every row. */
export const hoverControls = (
  c: Pick<CardModel, 'isDone' | 'isTracking'>,
  canTrack: boolean,
): HTMLElement => {
  const wrap = el('div', 'hover-controls');
  wrap.setAttribute('role', 'group');
  wrap.setAttribute('aria-label', 'Task actions');
  if (canTrack && !c.isDone) {
    const label = c.isTracking ? 'Stop tracking time' : 'Start tracking time';
    const track = button('hover-btn track-btn', 'track', label);
    track.appendChild(icon(c.isTracking ? 'pause' : 'play'));
    wrap.appendChild(track);
  }
  const detail = button('hover-btn', 'open', 'Open details');
  detail.appendChild(icon('panel'));
  wrap.appendChild(detail);
  const more = button('hover-btn', 'menu', 'More actions');
  more.setAttribute('aria-haspopup', 'menu');
  more.appendChild(icon('more'));
  wrap.appendChild(more);
  return wrap;
};
