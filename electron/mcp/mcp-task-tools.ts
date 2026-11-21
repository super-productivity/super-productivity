import {
  ASSISTANT_TASK_LOG_TIME_PATH,
  ASSISTANT_TASK_START_PATH,
  ASSISTANT_TASK_STOP_PATH,
  ASSISTANT_TASK_UPDATE_PATH,
  AssistantAccessScope,
} from '../shared-with-frontend/assistant-access.model';
import {
  DUE_DATE_PATTERN,
  DUE_TIME_PATTERN,
  ESTIMATE_MINUTES_MAX,
  isCalendarDay,
} from './capture-args';
import { McpToolResult } from './mcp-protocol';
import {
  ID_LIST_MAX,
  MAX_TITLE_CHARS,
  READ_ONLY_HINTS,
  ToolSpec,
  UNTRUSTED_NOTE,
  WRITE_HINTS,
  describeTool,
  fail,
  findUnknownArg,
  firstError,
  forwardEdit,
  forwardRead,
  invalid,
  isRecord,
  isToolError,
  ok,
  optionalBoolean,
  optionalIdList,
  optionalInteger,
  optionalString,
  pick,
  requiredId,
  toTaskSummary,
} from './mcp-tool-kit';

/**
 * Task tools beyond listing and capture: the tracked task and focus session,
 * and editing. Edits go to the internal /assistant/tasks/* routes
 * (src/app/features/tasks/assistant-edit/), which refuse edits that would
 * reach an outside service and otherwise do what the app's own controls do.
 * Task notes cannot be written: get_task cuts them at 8 KB, so writing back
 * what it returned would lose the rest.
 */

const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
const DUE_TIME_RE = new RegExp(DUE_TIME_PATTERN);
const MAX_LOG_MINUTES = 24 * 60;

const NO_UNDO =
  'There is no undo for this from here; tell the user what you changed. ' +
  'Tasks linked to an issue in another service, and changes that would reach ' +
  "the user's calendar, are refused: ask the user to make those.";

const ID_ARG = { type: 'string', description: 'The task id.' } as const;

/**
 * The edited task as a summary, unless reading tasks was revoked meanwhile:
 * the change is still reported, so the assistant does not retry it.
 */
const editedTask = (
  task: Record<string, unknown> | undefined,
  getScopes: () => readonly AssistantAccessScope[],
): McpToolResult =>
  task && getScopes().includes('tasks:read')
    ? ok({ status: 'applied', task: toTaskSummary(task) })
    : ok({ status: 'applied' });

/** A day (YYYY-MM-DD), null to clear, or undefined when not given. */
const optionalDay = (
  args: Record<string, unknown>,
  key: string,
): string | null | undefined | Error => {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  if (value === null) {
    return null;
  }
  return typeof value === 'string' && DUE_DATE_RE.test(value) && isCalendarDay(value)
    ? value
    : new Error(`${key} must be a valid YYYY-MM-DD date or null`);
};

const optionalClock = (
  args: Record<string, unknown>,
  key: string,
): string | undefined | Error => {
  const value = args[key];
  if (value === undefined) {
    return undefined;
  }
  return typeof value === 'string' && DUE_TIME_RE.test(value)
    ? value
    : new Error(`${key} must be a 24-hour HH:MM time`);
};

// --- read ------------------------------------------------------------------------

export const getCurrentTask: ToolSpec = {
  scope: 'tasks:read',
  definition: {
    name: 'get_current_task',
    ...describeTool('Get tracked task', READ_ONLY_HINTS),
    description:
      'Returns the task whose time is being tracked right now, or null when nothing is tracked. ' +
      UNTRUSTED_NOTE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const data = await forwardRead(forward, {
      method: 'GET',
      path: '/task-control/current',
    });
    if (isToolError(data)) {
      return data;
    }
    return ok({ task: isRecord(data) ? toTaskSummary(data) : null });
  },
};

export const getFocus: ToolSpec = {
  scope: 'tasks:read',
  definition: {
    name: 'get_focus',
    ...describeTool('Get focus session', READ_ONLY_HINTS),
    description:
      'Returns the focus mode state: the mode, the cycle, and the running timer ' +
      '(work or break, running, paused or done, elapsed and remaining milliseconds), or timer null.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const data = await forwardRead(forward, { method: 'GET', path: '/focus' });
    if (isToolError(data)) {
      return data;
    }
    if (!isRecord(data)) {
      return fail('INTERNAL_ERROR', 'The request failed.');
    }
    const timer = isRecord(data.timer)
      ? pick(data.timer, [
          'purpose',
          'status',
          'isOvertime',
          'isLongBreak',
          'elapsedMs',
          'remainingMs',
          'durationMs',
        ])
      : null;
    return ok({ ...pick(data, ['mode', 'cycle', 'isSessionDone']), timer });
  },
};

// --- edit ------------------------------------------------------------------------

const UPDATE_ARGS = [
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

/** update_task's arguments as the route's body, or an error message. */
const toUpdateBody = (
  args: Record<string, unknown>,
): Record<string, unknown> | string => {
  const id = requiredId(args, 'id');
  const title = optionalString(args, 'title', MAX_TITLE_CHARS);
  const isDone = optionalBoolean(args, 'isDone');
  const dueDate = optionalDay(args, 'dueDate');
  const dueTime = optionalClock(args, 'dueTime');
  const deadlineDate = optionalDay(args, 'deadlineDate');
  const deadlineTime = optionalClock(args, 'deadlineTime');
  const estimate = optionalInteger(args, 'estimateMinutes', 0, ESTIMATE_MINUTES_MAX);
  const tagIds = optionalIdList(args, 'tagIds');
  const error = firstError([
    id,
    title,
    isDone,
    dueDate,
    dueTime,
    deadlineDate,
    deadlineTime,
    estimate,
    tagIds,
  ]);
  if (error) {
    return error.message;
  }
  if (typeof title === 'string' && !title.trim()) {
    return 'title must not be empty';
  }
  if (dueTime !== undefined && typeof dueDate !== 'string') {
    return 'dueTime requires dueDate';
  }
  if (deadlineTime !== undefined && typeof deadlineDate !== 'string') {
    return 'deadlineTime requires deadlineDate';
  }
  const body: Record<string, unknown> = {};
  for (const key of UPDATE_ARGS) {
    if (args[key] !== undefined) {
      body[key] = key === 'tagIds' ? tagIds : args[key];
    }
  }
  return Object.keys(body).length > 1 ? body : 'Give at least one field to change';
};

export const updateTask: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'update_task',
    ...describeTool('Update task', WRITE_HINTS),
    description:
      'Changes an existing task; only the fields given change. isDone completes or reopens it. ' +
      'dueDate plans it for a day as the task menu does: a task with a start time keeps that time ' +
      'on the new day. dueDate with dueTime gives it that start time; dueDate null unschedules it. ' +
      'A recurring task cannot be rescheduled. deadlineDate (with optional deadlineTime) sets when ' +
      'the work is due; null removes it. estimateMinutes replaces the estimate (not on a task with ' +
      'subtasks); tagIds replaces its tags. Titles are stored as written; notes cannot be changed. ' +
      'Returns the task as it is afterwards. ' +
      NO_UNDO,
    inputSchema: {
      type: 'object',
      properties: {
        id: ID_ARG,
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_CHARS },
        isDone: { type: 'boolean' },
        dueDate: {
          type: ['string', 'null'],
          pattern: DUE_DATE_PATTERN,
          description:
            "Day to work on it, YYYY-MM-DD in the user's calendar (get_status gives today); " +
            'null unschedules it.',
        },
        dueTime: {
          type: 'string',
          pattern: DUE_TIME_PATTERN,
          description:
            "Start time on dueDate, 24-hour HH:MM in the user's time zone. Requires dueDate.",
        },
        deadlineDate: {
          type: ['string', 'null'],
          pattern: DUE_DATE_PATTERN,
          description: 'Day the work is due, YYYY-MM-DD; null removes the deadline.',
        },
        deadlineTime: {
          type: 'string',
          pattern: DUE_TIME_PATTERN,
          description: 'Time on deadlineDate, 24-hour HH:MM. Requires deadlineDate.',
        },
        estimateMinutes: {
          type: 'integer',
          minimum: 0,
          maximum: ESTIMATE_MINUTES_MAX,
          description: 'Estimate in whole minutes; 0 clears it.',
        },
        tagIds: {
          type: 'array',
          items: { type: 'string' },
          maxItems: ID_LIST_MAX,
          description: "The task's tags, from list_tags; replaces them.",
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward, getScopes, writeCap) => {
    const unknownArg = findUnknownArg(args, UPDATE_ARGS);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const body = toUpdateBody(args);
    if (typeof body === 'string') {
      return invalid(body);
    }
    const result = await forwardEdit(forward, writeCap, {
      path: ASSISTANT_TASK_UPDATE_PATH,
      body,
    });
    return isToolError(result) ? result : editedTask(result.task, getScopes);
  },
};

export const startTask: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'start_task',
    ...describeTool('Start tracking task', WRITE_HINTS),
    description:
      'Starts tracking time on a task, like its play button; a task tracked before stops. ' +
      'Only for an open task without subtasks, and only while time tracking is on. ' +
      NO_UNDO,
    inputSchema: {
      type: 'object',
      properties: { id: ID_ARG },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward, _getScopes, writeCap) => {
    const unknownArg = findUnknownArg(args, ['id']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    if (id instanceof Error) {
      return invalid(id.message);
    }
    const result = await forwardEdit(forward, writeCap, {
      path: ASSISTANT_TASK_START_PATH,
      body: { id },
    });
    return isToolError(result) ? result : ok({ status: 'applied', currentTaskId: id });
  },
};

export const stopTracking: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'stop_tracking',
    ...describeTool('Stop tracking', WRITE_HINTS),
    description:
      'Stops tracking time on the current task, like its pause button. Does nothing when nothing is tracked.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward, _getScopes, writeCap) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const result = await forwardEdit(forward, writeCap, {
      path: ASSISTANT_TASK_STOP_PATH,
      body: {},
    });
    return isToolError(result) ? result : ok({ status: 'applied', currentTaskId: null });
  },
};

export const logTime: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'log_time',
    // Adding is not idempotent: a repeated call adds the time again.
    ...describeTool('Log time', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      'Adds time spent on a task for a day, as the time dialog does, or with mode "set" ' +
      "replaces that day's total. Not for tasks with subtasks: log on a subtask. After an " +
      'error, check the task with get_task before retrying, since a retry can count the time twice. ' +
      NO_UNDO,
    inputSchema: {
      type: 'object',
      properties: {
        id: ID_ARG,
        minutes: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_LOG_MINUTES,
          description:
            'Minutes to add (at least 1), or the day\'s total with mode "set".',
        },
        date: {
          type: 'string',
          pattern: DUE_DATE_PATTERN,
          description: "The day, YYYY-MM-DD in the user's calendar, not after today.",
        },
        mode: { type: 'string', enum: ['add', 'set'], description: 'Default "add".' },
      },
      required: ['id', 'minutes', 'date'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward, getScopes, writeCap) => {
    const unknownArg = findUnknownArg(args, ['id', 'minutes', 'date', 'mode']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const mode = args.mode ?? 'add';
    if (mode !== 'add' && mode !== 'set') {
      return invalid('mode must be "add" or "set"');
    }
    const id = requiredId(args, 'id');
    const date = optionalDay(args, 'date');
    const minutes = optionalInteger(
      args,
      'minutes',
      mode === 'set' ? 0 : 1,
      MAX_LOG_MINUTES,
    );
    const error = firstError([id, date, minutes]);
    if (error) {
      return invalid(error.message);
    }
    if (typeof date !== 'string') {
      return invalid('date must be a valid YYYY-MM-DD date');
    }
    if (typeof minutes !== 'number') {
      return invalid('minutes is required');
    }
    const result = await forwardEdit(
      forward,
      writeCap,
      { path: ASSISTANT_TASK_LOG_TIME_PATH, body: { id, date, minutes, mode } },
      'The time may or may not have been logged. Check the task with get_task before ' +
        'retrying: a retry can count it twice.',
    );
    return isToolError(result) ? result : editedTask(result.task, getScopes);
  },
};
