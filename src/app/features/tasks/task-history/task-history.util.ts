import { Task, TaskState } from '../task.model';
import { isWontDoTask } from '../util/is-wont-do-task';
import { getTaskPriority } from '../task-priority.const';
import {
  OPTIONAL_TASK_HISTORY_FIELDS,
  TaskHistoryRecordingConfig,
} from './task-history-recording-config';
import {
  TaskHistoryBaseline,
  TaskHistoryEnvelope,
  TaskHistoryField,
  TaskHistoryState,
  TaskHistoryValue,
} from './task-history.model';

const FIELDS = ['status', 'schedule', 'deadline'] as const;
type CoreHistoryField = (typeof FIELDS)[number];
const MAX_TEXT_VALUE_LENGTH = 8_192;
const MAX_TEXT_PER_OPERATION = 32_768;

const dateValue = (
  day: string | null | undefined,
  time: number | null | undefined,
): TaskHistoryValue =>
  time != null
    ? { kind: 'time', value: time }
    : day
      ? { kind: 'day', value: day }
      : { kind: 'none' };

const getTaskHistoryValues = (
  task: Task,
): Record<CoreHistoryField, TaskHistoryValue> => ({
  status: {
    kind: 'status',
    value: !task.isDone ? 'open' : isWontDoTask(task) ? 'wontDo' : 'done',
  },
  schedule: dateValue(task.dueDay, task.dueWithTime),
  deadline: dateValue(task.deadlineDay, task.deadlineWithTime),
});

const optionalValues = {
  title: (task: Task): TaskHistoryValue => ({ kind: 'text', value: task.title }),
  priority: (task: Task): TaskHistoryValue => {
    const value = getTaskPriority(task.priority);
    return value === null ? { kind: 'none' } : { kind: 'priority', value };
  },
  notes: (task: Task): TaskHistoryValue =>
    task.notes ? { kind: 'text', value: task.notes } : { kind: 'none' },
};

const equalValue = (a: TaskHistoryValue, b: TaskHistoryValue): boolean =>
  a.kind === b.kind && (!('value' in a) || ('value' in b && a.value === b.value));

/** Pure diff of the full reducer result, including cascade/bulk/repeat changes. */
export const collectTaskHistory = (
  before: TaskState,
  after: TaskState,
  operationId: string,
  occurredAt: number,
  sourceAction: string,
  recording: TaskHistoryRecordingConfig = {},
): TaskHistoryEnvelope => {
  const result: TaskHistoryEnvelope = {
    version: 1,
    operationId,
    occurredAt,
    baselines: [],
    events: [],
  };
  if (before.entities === after.entities) return result;
  const optionalFields = OPTIONAL_TASK_HISTORY_FIELDS.filter((field) => recording[field]);
  let remainingText = MAX_TEXT_PER_OPERATION;
  const boundedValue = (value: TaskHistoryValue): TaskHistoryValue => {
    if (value.kind !== 'text') return value;
    let limit = Math.min(MAX_TEXT_VALUE_LENGTH, remainingText);
    const beforeCut = value.value.charCodeAt(limit - 1);
    const afterCut = value.value.charCodeAt(limit);
    if (
      beforeCut >= 0xd800 &&
      beforeCut <= 0xdbff &&
      afterCut >= 0xdc00 &&
      afterCut <= 0xdfff
    ) {
      limit--;
    }
    remainingText -= Math.min(limit, value.value.length);
    return value.value.length <= limit
      ? value
      : { kind: 'text', value: value.value.slice(0, limit), truncated: true };
  };

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
    const appendChange = (
      field: TaskHistoryField,
      previousValue: TaskHistoryValue,
      nextValue: TaskHistoryValue,
      bucket: 'events' | 'optionalEvents',
    ): void => {
      if (equalValue(previousValue, nextValue)) return;
      (result[bucket] ??= []).push({
        id: `${key}:${field}`,
        operationId,
        taskId,
        field,
        before: boundedValue(previousValue),
        after: boundedValue(nextValue),
        occurredAt,
        sourceAction,
      });
    };
    for (const field of FIELDS) {
      appendChange(field, previousValues[field], values[field], 'events');
    }
    for (const field of optionalFields) {
      appendChange(
        field,
        optionalValues[field](previous),
        optionalValues[field](task),
        'optionalEvents',
      );
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
  if (
    !envelope.baselines.length &&
    !envelope.events.length &&
    !envelope.optionalEvents?.length &&
    !envelope.gaps?.length
  )
    return state;
  const next = { ...state };
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
  for (const bucket of ['events', 'optionalEvents'] as const) {
    const touched = new Set<string>();
    for (const event of envelope[bucket] ?? []) {
      const current = Object.hasOwn(next, event.taskId) ? next[event.taskId] : undefined;
      // Author events always travel with a baseline.
      if (!current?.baseline)
        throw new Error('Task history event has no recording baseline');
      if (Object.hasOwn(current[bucket] ?? {}, event.id)) continue;
      if (!touched.has(event.taskId)) {
        next[event.taskId] = { ...current, [bucket]: { ...current[bucket] } };
        touched.add(event.taskId);
      }
      next[event.taskId][bucket]![event.id] = event;
    }
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
