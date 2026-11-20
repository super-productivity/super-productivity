// The proposal: a sentence, a selection, and the change rows with checkboxes.

import { canAddToToday } from '../core/day';
import { describeRow, planSummary } from '../core/describe';
import type { ChangeRow, Proposal, Snapshot, TaskLike } from '../core/types';
import { button, el, heading } from './dom';
import { moreMenu, type MenuItem } from './menu';

export interface SelectionActions {
  addToToday(taskIds: string[]): void;
  done(taskIds: string[]): void;
  start(taskId: string): void;
  open(taskId: string): void;
  canStart: boolean;
}

export interface ResultInput {
  proposal: Proposal;
  snapshot: Snapshot;
  ticked: Set<string>;
  onToggle(key: string, isOn: boolean): void;
  selection: SelectionActions;
  /** Selection rows the user picked for a bulk action. */
  picked: Set<string>;
  onPick(taskId: string, isOn: boolean): void;
  /** Current task state: the selection rows show it, not the snapshot's. */
  live: Map<string, TaskLike>;
}

const KEPT = 'Kept in Recently deleted on this device for 30 days';

const changeRow = (row: ChangeRow, input: ResultInput): HTMLLIElement => {
  const text = describeRow(row, input.snapshot);
  const li = el('li', `row${row.kind === 'delete' ? ' del' : ''}`);
  const label = el('label', 'main');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = input.ticked.has(row.key);
  box.addEventListener('change', () => {
    li.classList.toggle('off', !box.checked);
    input.onToggle(row.key, box.checked);
  });
  li.classList.toggle('off', !box.checked);
  const what = [...text.what, ...(row.kind === 'delete' ? [KEPT] : [])].join(' · ');
  label.append(box, el('span', 'title', text.title), el('span', 'what', what));
  li.append(label);
  return li;
};

const group = (title: string, rows: ChangeRow[], input: ResultInput): HTMLElement[] =>
  rows.length ? [heading(title), listOf(rows.map((r) => changeRow(r, input)))] : [];

const listOf = (items: HTMLLIElement[]): HTMLUListElement => {
  const ul = el('ul');
  ul.append(...items);
  return ul;
};

const dayPlanGroups = (input: ResultInput): HTMLElement[] => {
  const today = input.snapshot.day.todayStr;
  const rows = input.proposal.changes;
  const isPull = (r: ChangeRow): boolean => r.kind === 'update' && r.dueDay === today;
  const summary = el('p', 'summary');
  const update = (): void => {
    summary.textContent = planSummary(
      rows.filter((r) => input.ticked.has(r.key)),
      input.snapshot,
    );
  };
  // The summary follows the ticks, without re-rendering the rows.
  const local: ResultInput = {
    ...input,
    onToggle: (key, isOn) => (input.onToggle(key, isOn), update()),
  };
  update();
  return [
    summary,
    ...group('Pull in', rows.filter(isPull), local),
    ...group(
      'Move off today',
      rows.filter((r) => !isPull(r)),
      local,
    ),
  ];
};

const changeGroups = (input: ResultInput): HTMLElement[] => {
  if (input.proposal.isDayPlan) return dayPlanGroups(input);
  const of = (kind: ChangeRow['kind']): ChangeRow[] =>
    input.proposal.changes.filter((r) => r.kind === kind);
  return [
    ...group('Add', of('add'), input),
    ...group('Change', of('update'), input),
    ...group('Delete', of('delete'), input),
  ];
};

const selectionMenu = (task: TaskLike, input: ResultInput): MenuItem[] => {
  const a = input.selection;
  const items: MenuItem[] = [];
  if (!task.isDone) items.push(['Mark done', () => a.done([task.id])]);
  if (!task.isDone && a.canStart) items.push(['Start tracking', () => a.start(task.id)]);
  items.push(['Open', () => a.open(task.id)]);
  return items;
};

const selectionRow = (
  taskId: string,
  reason: string,
  i: number,
  input: ResultInput,
): HTMLLIElement => {
  // Live only: a task deleted since the answer gets no actions, just its old title.
  const task = input.live.get(taskId);
  const title = task?.title ?? input.snapshot.tasks.find((t) => t.id === taskId)?.title;
  const li = el('li', `row${task?.isDone ? ' off' : ''}`);
  const label = el('label', 'main');
  const box = el('input');
  box.type = 'checkbox';
  box.checked = input.picked.has(taskId);
  box.addEventListener('change', () => input.onPick(taskId, box.checked));
  const text = el('span', 'text');
  text.append(el('span', 'title', title || ''), el('span', 'what', reason));
  label.append(box, el('span', 'rank', String(i + 1)), text);
  const acts = el('div', 'acts');
  if (canAddToToday(task, input.snapshot.day)) {
    // An icon: a text button would squeeze the titles in the narrow side panel.
    const today = button('', () => input.selection.addToToday([taskId]), 'btn-icon');
    today.title = 'Add to today';
    today.setAttribute('aria-label', 'Add to today');
    today.append(el('span', 'material-icons', 'wb_sunny'));
    acts.append(today);
  }
  if (task) acts.append(...moreMenu(selectionMenu(task, input)));
  li.append(label, acts);
  return li;
};

export const renderResult = (root: HTMLElement, input: ResultInput): void => {
  const { proposal } = input;
  if (proposal.say) root.append(el('p', 'say', proposal.say));
  if (proposal.isTooMany) {
    root.append(
      el('p', 'msg warn', 'That would change more than 50 tasks. Narrow it down.'),
    );
  }
  if (proposal.selection?.items.length) {
    root.append(heading(proposal.selection.title));
    const items = proposal.selection.items.map((it, i) =>
      selectionRow(it.taskId, it.reason, i, input),
    );
    root.append(listOf(items));
  }
  root.append(...changeGroups(input));
  if (proposal.dropped.length) {
    const notes = el('ul', 'dropped');
    proposal.dropped.forEach((d) => notes.append(el('li', 'muted', d)));
    root.append(heading('Left out'), notes);
  }
  const isEmpty =
    !proposal.say && !proposal.selection?.items.length && !proposal.changes.length;
  if (isEmpty && !proposal.isTooMany) root.append(el('p', 'say', 'Nothing to change.'));
};
