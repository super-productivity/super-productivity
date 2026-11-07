import { Task, TaskState } from '../task.model';
import { isWontDoTask } from '../util/is-wont-do-task';
import {
  TaskHistoryBaseline,
  TaskHistoryEnvelope,
  TaskHistoryField,
  TaskHistoryState,
  TaskHistoryValue,
} from './task-history.model';

const FIELDS: readonly TaskHistoryField[] = ['status', 'schedule', 'deadline'];

const dateValue = (
  day: string | null | undefined,
  time: number | null | undefined,
): TaskHistoryValue =>
  time != null
    ? { kind: 'time', value: time }
    : day
      ? { kind: 'day', value: day }
      : { kind: 'none' };

export const getTaskHistoryValues = (
  task: Task,
): Record<TaskHistoryField, TaskHistoryValue> => ({
  status: {
    kind: 'status',
    value: !task.isDone ? 'open' : isWontDoTask(task) ? 'wontDo' : 'done',
  },
  schedule: dateValue(task.dueDay, task.dueWithTime),
  deadline: dateValue(task.deadlineDay, task.deadlineWithTime),
});

const equalValue = (a: TaskHistoryValue, b: TaskHistoryValue): boolean =>
  a.kind === b.kind && (!('value' in a) || ('value' in b && a.value === b.value));

/** Pure diff of the full reducer result, including cascade/bulk/repeat changes. */
export const collectTaskHistory = (
  before: TaskState,
  after: TaskState,
  operationId: string,
  occurredAt: number,
  sourceAction: string,
): TaskHistoryEnvelope => {
  const result: TaskHistoryEnvelope = {
    version: 1,
    operationId,
    occurredAt,
    baselines: [],
    events: [],
  };
  if (before.entities === after.entities) return result;

  for (const taskId of after.ids) {
    const task = after.entities[taskId];
    const previous = before.entities[taskId];
    if (!task || task === previous) continue;
    const key = `${operationId}:${encodeURIComponent(taskId)}`;
    const values = getTaskHistoryValues(task);
    const previousValues = previous ? getTaskHistoryValues(previous) : values;
    const baseline = Object.hasOwn(before.taskHistory ?? {}, taskId)
      ? before.taskHistory![taskId].baseline
      : undefined;
    result.baselines.push(
      baseline ?? {
        id: `${key}:baseline`,
        taskId,
        observedAt: occurredAt,
        createdAt: task.created,
        ...previousValues,
      },
    );
    const gaps = before.taskHistory?.[taskId]?.gaps;
    if (gaps) (result.gaps ??= []).push(...Object.values(gaps));
    // Initial values of a newly created instance belong to its baseline.
    if (!previous) continue;
    for (const field of FIELDS) {
      if (equalValue(previousValues[field], values[field])) continue;
      result.events.push({
        id: `${key}:${field}`,
        operationId,
        taskId,
        field,
        before: previousValues[field],
        after: values[field],
        occurredAt,
        sourceAction,
      });
    }
  }
  return result;
};

const earlierBaseline = (
  a: TaskHistoryBaseline,
  b: TaskHistoryBaseline,
): TaskHistoryBaseline =>
  a.observedAt < b.observedAt || (a.observedAt === b.observedAt && a.id < b.id) ? a : b;

/** Immutable union. Replayed delivery cannot append another copy of an event. */
export const mergeTaskHistory = (
  state: TaskHistoryState | undefined,
  envelope: TaskHistoryEnvelope,
): TaskHistoryState | undefined => {
  if (!envelope.baselines.length && !envelope.events.length && !envelope.gaps?.length)
    return state;
  const next = { ...state };
  const touched = new Set<string>();
  for (const baseline of envelope.baselines) {
    const current = Object.hasOwn(next, baseline.taskId)
      ? next[baseline.taskId]
      : undefined;
    next[baseline.taskId] = {
      ...current,
      baseline: current?.baseline
        ? earlierBaseline(current.baseline, baseline)
        : baseline,
      events: current?.events ?? {},
    };
  }
  for (const event of envelope.events) {
    const current = Object.hasOwn(next, event.taskId) ? next[event.taskId] : undefined;
    // The first event for a task always travels with its baseline. A missing
    // baseline is invalid input, not a reason to invent the task's old state.
    if (!current?.baseline)
      throw new Error('Task history event has no recording baseline');
    if (Object.hasOwn(current.events, event.id)) continue;
    if (!touched.has(event.taskId)) {
      next[event.taskId] = { ...current, events: { ...current.events } };
      touched.add(event.taskId);
    }
    next[event.taskId].events[event.id] = event;
  }
  for (const gap of envelope.gaps ?? []) {
    const current = Object.hasOwn(next, gap.taskId) ? next[gap.taskId] : undefined;
    if (!current) throw new Error('Task history gap has no task record');
    next[gap.taskId] = {
      ...current,
      gaps: { ...current.gaps, [gap.id]: gap },
    };
  }
  return next;
};

/** A replay observation is not evidence of the author's old/new values or time. */
export const recordTaskHistoryGaps = (
  before: TaskState,
  after: TaskState,
): TaskHistoryState | undefined => {
  if (before.entities === after.entities) return after.taskHistory;
  let next = after.taskHistory;
  for (const taskId of after.ids) {
    const previous = before.entities[taskId];
    const task = after.entities[taskId];
    if (!previous || !task || previous === task) continue;
    const oldValues = getTaskHistoryValues(previous);
    const values = getTaskHistoryValues(task);
    if (FIELDS.every((field) => equalValue(oldValues[field], values[field]))) continue;
    const current = Object.hasOwn(next ?? {}, taskId) ? next![taskId] : undefined;
    // One bounded coverage warning per task. A replay cannot reconstruct the
    // missing interval's endpoints or the original detection time.
    const id = `recording-unavailable:${encodeURIComponent(taskId)}`;
    if (Object.hasOwn(current?.gaps ?? {}, id)) continue;
    next = {
      ...next,
      [taskId]: {
        ...current,
        events: current?.events ?? {},
        gaps: {
          ...current?.gaps,
          [id]: { id, taskId, reason: 'recording-unavailable', detectedAt: null },
        },
      },
    };
  }
  return next;
};
