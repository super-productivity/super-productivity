import type { AgendaNode, BreakdownNode } from '../core/parts';
import { laneAddRow } from './add-inputs';
import { el } from './dom';
import { BuildCtx, cardList, heading } from './render-card';

// The agenda and the time breakdown, drawn in plain HTML and CSS.

export const agendaEl = (node: AgendaNode, ctx: BuildCtx): HTMLElement => {
  const days = el('div', 'agenda-days');
  for (const day of node.days) {
    const col = el('div', `agenda-day${day.isOverdue ? ' is-overdue' : ''}`);
    col.dataset.flip = `day:${node.cid}:${day.key}`;
    col.appendChild(
      heading('col-title', day.label, day.cards.length, {
        date: day.date,
        estimate: day.planned,
      }),
    );
    if (day.cards.length) {
      col.appendChild(cardList(day.cards, node.cid, ctx, false));
    } else {
      col.appendChild(el('p', 'empty text-muted', 'Nothing planned.'));
    }
    // At the bottom of the day, where the app's planner has it.
    const add = laneAddRow(day.add, day.label, ctx.adds);
    if (add) col.appendChild(add);
    days.appendChild(col);
  }
  return days;
};

export const breakdownEl = (node: BreakdownNode): HTMLElement => {
  if (!node.rows.length) return el('p', 'empty text-muted', node.emptyText);
  const list = el('ul', 'breakdown-rows');
  list.setAttribute('role', 'list');
  for (const row of node.rows) {
    const item = el('li', 'breakdown-row');
    item.dataset.flip = `row:${node.cid}:${row.key}`;
    item.appendChild(el('span', 'breakdown-label', row.label));
    const track = el('span', 'breakdown-track');
    const fill = el('span', 'breakdown-fill');
    fill.style.width = `${row.percent}%`;
    // Validated in the model, like a chip's color.
    if (row.color) fill.style.setProperty('--bar', row.color);
    track.appendChild(fill);
    item.appendChild(track);
    item.appendChild(el('span', 'breakdown-value', row.value));
    list.appendChild(item);
  }
  return list;
};
