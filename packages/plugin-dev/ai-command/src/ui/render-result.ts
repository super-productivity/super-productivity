// The proposal: a sentence, a selection, and the change rows with checkboxes.

import { describeRow, planSummary } from '../core/describe';
import type { ChangeRow, Proposal, Snapshot } from '../core/types';
import { button, el, heading } from './dom';

export interface SelectionActions {
  done(taskId: string): void;
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
  const what = row.kind === 'delete' ? KEPT : text.what.join(' · ');
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

const selectionRow = (
  taskId: string,
  reason: string,
  i: number,
  input: ResultInput,
): HTMLLIElement => {
  const task = input.snapshot.tasks.find((t) => t.id === taskId);
  const li = el('li', 'row');
  const main = el('div', 'main');
  main.append(el('span', 'title', task?.title || ''), el('span', 'what', reason));
  const acts = el('div', 'acts');
  const a = input.selection;
  const done = button('Done', () => {
    li.classList.add('off');
    done.disabled = true;
    a.done(taskId);
  });
  done.disabled = !!task?.isDone;
  acts.append(done);
  if (a.canStart) acts.append(button('Start', () => a.start(taskId)));
  acts.append(button('Open', () => a.open(taskId)));
  li.append(el('span', 'rank', String(i + 1)), main, acts);
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
