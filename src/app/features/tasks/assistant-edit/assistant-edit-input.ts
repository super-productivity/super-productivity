import {
  CAPTURE_ESTIMATE_MINUTES_MAX,
  parseDueDay,
  parseDueTime,
} from '../agent-capture/capture-schedule';
import { MAX_CAPTURE_TITLE_LENGTH } from '../assistant-capture/assistant-capture.service';
import { MAX_TIME_SPENT_PER_DAY_MS } from '../local-rest-api-task-time';

/**
 * The bodies main sends to the assistant edit routes, parsed again here: main
 * is the strict gate, and this keeps a malformed body from reaching a dispatch.
 */

/** A day, optionally with a start (or deadline) time in this device's time zone. */
export interface AssistantDayTime {
  day: string;
  time?: [number, number];
}

export interface AssistantTaskUpdate {
  id: string;
  title?: string;
  isDone?: boolean;
  /** null unschedules the task. */
  due?: AssistantDayTime | null;
  /** null removes the deadline. */
  deadline?: AssistantDayTime | null;
  /** Whole minutes; 0 clears the estimate. */
  estimateMinutes?: number;
  tagIds?: string[];
}

export interface AssistantLogTime {
  id: string;
  date: string;
  minutes: number;
  mode: 'add' | 'set';
}

const ID_RE = /^[A-Za-z0-9_-]{1,200}$/;
const MAX_TAG_IDS = 50;
const MAX_LOG_MINUTES = MAX_TIME_SPENT_PER_DAY_MS / 60000;

const UPDATE_KEYS = [
  'id',
  'title',
  'isDone',
  'dueDate',
  'dueTime',
  'deadlineDate',
  'deadlineTime',
  'estimateMinutes',
  'tagIds',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOnlyKeys = (body: Record<string, unknown>, keys: string[]): boolean =>
  Object.keys(body).every((key) => keys.includes(key));

const isId = (value: unknown): value is string =>
  typeof value === 'string' && ID_RE.test(value);

const isWholeNumber = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

/**
 * A `dateKey` / `timeKey` pair: absent, null (clear), or a valid day with an
 * optional valid time. A time without a day is invalid.
 */
const parseDayTime = (
  body: Record<string, unknown>,
  dateKey: string,
  timeKey: string,
): AssistantDayTime | null | undefined | false => {
  const date = body[dateKey];
  const time = body[timeKey];
  if (date === undefined) {
    return time === undefined ? undefined : false;
  }
  if (date === null) {
    return time === undefined ? null : false;
  }
  const day = parseDueDay(date);
  if (!day) {
    return false;
  }
  if (time === undefined) {
    return { day };
  }
  const clock = parseDueTime(time);
  return clock ? { day, time: clock } : false;
};

/** Accepts the update_task body or nothing; at least one change is required. */
export const parseAssistantTaskUpdate = (
  body: unknown,
): AssistantTaskUpdate | undefined => {
  if (!isRecord(body) || !hasOnlyKeys(body, UPDATE_KEYS) || !isId(body.id)) {
    return undefined;
  }
  const { title, isDone, estimateMinutes, tagIds } = body;
  if (
    title !== undefined &&
    (typeof title !== 'string' ||
      !title.trim() ||
      title.length > MAX_CAPTURE_TITLE_LENGTH)
  ) {
    return undefined;
  }
  if (isDone !== undefined && typeof isDone !== 'boolean') {
    return undefined;
  }
  if (
    estimateMinutes !== undefined &&
    !isWholeNumber(estimateMinutes, 0, CAPTURE_ESTIMATE_MINUTES_MAX)
  ) {
    return undefined;
  }
  if (
    tagIds !== undefined &&
    (!Array.isArray(tagIds) || tagIds.length > MAX_TAG_IDS || !tagIds.every(isId))
  ) {
    return undefined;
  }
  const due = parseDayTime(body, 'dueDate', 'dueTime');
  const deadline = parseDayTime(body, 'deadlineDate', 'deadlineTime');
  if (due === false || deadline === false) {
    return undefined;
  }
  const update: AssistantTaskUpdate = {
    id: body.id,
    ...(typeof title === 'string' ? { title: title.trim() } : {}),
    ...(typeof isDone === 'boolean' ? { isDone } : {}),
    ...(due !== undefined ? { due } : {}),
    ...(deadline !== undefined ? { deadline } : {}),
    ...(typeof estimateMinutes === 'number' ? { estimateMinutes } : {}),
    ...(Array.isArray(tagIds) ? { tagIds: [...new Set(tagIds as string[])] } : {}),
  };
  return Object.keys(update).length > 1 ? update : undefined;
};

/** `{id}` for start_task. */
export const parseAssistantTaskId = (body: unknown): string | undefined =>
  isRecord(body) && hasOnlyKeys(body, ['id']) && isId(body.id) ? body.id : undefined;

/** `{id, date, minutes, mode}` for log_time; "add" needs at least one minute. */
export const parseAssistantLogTime = (body: unknown): AssistantLogTime | undefined => {
  if (!isRecord(body) || !hasOnlyKeys(body, ['id', 'date', 'minutes', 'mode'])) {
    return undefined;
  }
  const { id, date, minutes, mode } = body;
  const day = parseDueDay(date);
  if (!isId(id) || !day || (mode !== 'add' && mode !== 'set')) {
    return undefined;
  }
  return isWholeNumber(minutes, mode === 'add' ? 1 : 0, MAX_LOG_MINUTES)
    ? { id, date: day, minutes, mode }
    : undefined;
};
