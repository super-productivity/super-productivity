// Plain-text descriptions of proposed and applied rows: what changes, old → new.

import {
  dayLabel,
  freeMinutesToday,
  minutesLabel,
  plannedDayOf,
  plannedMinutesToday,
} from './day';
import { quoted } from './validate';
import type { AddRow, ChangeRow, Named, Snapshot, TaskLike, UpdateRow } from './types';

export interface RowText {
  title: string;
  what: string[];
}

const nameOf = (list: Named[], id: string | null | undefined): string =>
  list.find((n) => n.id === id)?.title || 'none';

const estimate = (ms: number | undefined): string =>
  ms ? minutesLabel(ms / 60000) : 'none';

const describeAdd = (row: AddRow, s: Snapshot): RowText => {
  const what: string[] = [];
  if (row.parentId)
    what.push(
      `Subtask of ${quoted(s.tasks.find((t) => t.id === row.parentId)?.title || '')}`,
    );
  if (row.parentRef) what.push('Subtask of a new task');
  if (row.projectId) what.push(nameOf(s.projects, row.projectId));
  if (row.dueDay) what.push(dayLabel(row.dueDay, s.day.todayStr));
  if (row.timeEstimate) what.push(estimate(row.timeEstimate));
  row.tagIds?.forEach((id) => what.push(`+ tag ${nameOf(s.tags, id)}`));
  if (row.note) what.push('+ note');
  return { title: row.title, what };
};

const tagDiff = (task: TaskLike, next: string[], s: Snapshot): string[] => [
  ...next
    .filter((id) => !task.tagIds.includes(id))
    .map((id) => `+ tag ${nameOf(s.tags, id)}`),
  ...task.tagIds
    .filter((id) => !next.includes(id))
    .map((id) => `− tag ${nameOf(s.tags, id)}`),
];

const describeUpdate = (row: UpdateRow, task: TaskLike, s: Snapshot): RowText => {
  const what: string[] = [];
  const today = s.day.todayStr;
  if (row.title !== undefined) what.push(`Renamed from ${quoted(task.title)}`);
  if (row.dueDay !== undefined) {
    what.push(
      `${dayLabel(plannedDayOf(task, s.day), today)} → ${dayLabel(row.dueDay, today)}`,
    );
  }
  if (row.timeEstimate !== undefined) {
    what.push(`Estimate ${estimate(task.timeEstimate)} → ${estimate(row.timeEstimate)}`);
  }
  if (row.isDone !== undefined) what.push(row.isDone ? 'Marked done' : 'Marked not done');
  if (row.projectId)
    what.push(
      `${nameOf(s.projects, task.projectId)} → ${nameOf(s.projects, row.projectId)}`,
    );
  if (row.tagIds) what.push(...tagDiff(task, row.tagIds, s));
  if (row.appendNote) what.push('+ note');
  return { title: row.title ?? task.title, what };
};

/** The host deletes subtasks with their parent; the row must say so. */
const deleteLabel = (task: TaskLike): string => {
  const n = task.subTaskIds?.length || 0;
  return n ? `Delete with ${n} subtask${n === 1 ? '' : 's'}` : 'Delete';
};

export const describeRow = (row: ChangeRow, s: Snapshot): RowText => {
  if (row.kind === 'add') return describeAdd(row, s);
  const task = s.tasks.find((t) => t.id === row.taskId);
  if (!task) return { title: '', what: [] };
  return row.kind === 'update'
    ? describeUpdate(row, task, s)
    : { title: task.title, what: [deleteLabel(task)] };
};

/** "Today: 7 tasks, 4 h 50 min of 5 h 30 min free" after the plan's day changes. */
export const planSummary = (rows: ChangeRow[], s: Snapshot): string => {
  const moves = new Map(
    rows.flatMap((r) =>
      r.kind === 'update' && r.dueDay !== undefined ? [[r.taskId, r.dueDay]] : [],
    ),
  );
  const after = s.tasks.map((t) =>
    moves.has(t.id) ? { ...t, dueDay: moves.get(t.id) } : t,
  );
  const count = after.filter(
    (t) => !t.isDone && !t.parentId && plannedDayOf(t, s.day) === s.day.todayStr,
  ).length;
  const planned = plannedMinutesToday(after, s.day);
  const free = freeMinutesToday(s.tasks, s.day);
  const over = planned > free ? `, over by ${minutesLabel(planned - free)}` : '';
  return `Today: ${count} tasks, ${minutesLabel(planned)} of ${minutesLabel(free)} free${over}`;
};
