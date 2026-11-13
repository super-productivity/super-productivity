import {
  DUE_DATE_PATTERN,
  DUE_TIME_PATTERN,
  ESTIMATE_MINUTES_MAX,
  isCalendarDay,
} from './capture-args';
import { McpToolResult } from './mcp-protocol';
import {
  DESTRUCTIVE_HINTS,
  MAX_NOTES_CHARS,
  MAX_TITLE_CHARS,
  READ_ONLY_HINTS,
  ToolSpec,
  UNTRUSTED_NOTE,
  WRITE_HINTS,
  describeTool,
  fail,
  findUnknownArg,
  firstError,
  forwardRead,
  forwardWrite,
  invalid,
  isRecord,
  isToolError,
  ok,
  optionalBoolean,
  optionalId,
  optionalIdList,
  optionalInteger,
  optionalString,
  pick,
  requiredId,
  toTaskSummary,
} from './mcp-tool-kit';

/**
 * Task tools beyond reading and capture: what the local REST API can do with a
 * task, forwarded to the same routes (src/app/features/tasks/
 * local-rest-api-task-routes.service.ts), so a change made here goes through
 * the same paths as one made through the API.
 */

const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
const DUE_TIME_RE = new RegExp(DUE_TIME_PATTERN);
const MAX_LOG_MINUTES = 24 * 60;

const idSchema = (description: string): Record<string, unknown> => ({
  type: 'string',
  description,
});

/** A task the route answered with, as a summary; anything else as given. */
const taskResult = (data: unknown): McpToolResult =>
  isRecord(data) && typeof data.id === 'string' && 'title' in data
    ? ok({ task: toTaskSummary(data) })
    : ok(
        isRecord(data) ? pick(data, ['id', 'deleted', 'archived', 'currentTaskId']) : {},
      );

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

/** A day and time in this device's time zone, as the app stores them. */
const toLocalTimestamp = (day: string, time: string): number => {
  const [year, month, date] = day.split('-').map(Number);
  const [hours, minutes] = time.split(':').map(Number);
  return new Date(year, month - 1, date, hours, minutes).getTime();
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
  'notes',
  'isDone',
  'dueDate',
  'dueTime',
  'deadlineDate',
  'deadlineTime',
  'estimateMinutes',
  'projectId',
  'tagIds',
];

/**
 * Turns update_task's arguments into the route's task fields. A day alone
 * plans the task for that day; with a time it gets that start time in this
 * device's time zone (as create_task does); null clears it.
 */
const toTaskChanges = (
  args: Record<string, unknown>,
): Record<string, unknown> | string => {
  const title = optionalString(args, 'title', MAX_TITLE_CHARS);
  const notes = optionalString(args, 'notes', MAX_NOTES_CHARS);
  const isDone = optionalBoolean(args, 'isDone');
  const dueDate = optionalDay(args, 'dueDate');
  const dueTime = optionalClock(args, 'dueTime');
  const deadlineDate = optionalDay(args, 'deadlineDate');
  const deadlineTime = optionalClock(args, 'deadlineTime');
  const estimate = optionalInteger(args, 'estimateMinutes', 0, ESTIMATE_MINUTES_MAX);
  const projectId = optionalId(args, 'projectId');
  const tagIds = optionalIdList(args, 'tagIds');
  const error = firstError([
    title,
    notes,
    isDone,
    dueDate,
    dueTime,
    deadlineDate,
    deadlineTime,
    estimate,
    projectId,
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

  const changes: Record<string, unknown> = {};
  if (title !== undefined) changes.title = title;
  if (notes !== undefined) changes.notes = notes;
  if (isDone !== undefined) changes.isDone = isDone;
  if (dueDate === null) {
    changes.dueDay = null;
    changes.dueWithTime = null;
  } else if (typeof dueDate === 'string') {
    if (typeof dueTime === 'string') {
      changes.dueWithTime = toLocalTimestamp(dueDate, dueTime);
    } else {
      changes.dueDay = dueDate;
      changes.dueWithTime = null;
    }
  }
  if (deadlineDate === null) {
    changes.deadlineDay = null;
    changes.deadlineWithTime = null;
  } else if (typeof deadlineDate === 'string') {
    if (typeof deadlineTime === 'string') {
      changes.deadlineWithTime = toLocalTimestamp(deadlineDate, deadlineTime);
    } else {
      changes.deadlineDay = deadlineDate;
    }
  }
  if (typeof estimate === 'number') changes.timeEstimate = estimate * 60000;
  if (projectId !== undefined) changes.projectId = projectId;
  if (tagIds !== undefined) changes.tagIds = tagIds;
  return changes;
};

export const updateTask: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'update_task',
    ...describeTool('Update task', WRITE_HINTS),
    description:
      'Changes an existing task: only the fields given are changed. Set isDone to complete or reopen it. ' +
      'dueDate (with optional dueTime) plans it for a day or a start time, deadlineDate (with optional ' +
      'deadlineTime) sets when it is due; null clears either. projectId moves it to another project ' +
      '(not for subtasks); tagIds replaces its tags. Titles are stored as written. ' +
      'Returns the task as it is afterwards.',
    inputSchema: {
      type: 'object',
      properties: {
        id: idSchema('The task id.'),
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_CHARS },
        notes: {
          type: 'string',
          maxLength: MAX_NOTES_CHARS,
          description: 'Replaces the notes.',
        },
        isDone: { type: 'boolean' },
        dueDate: {
          type: ['string', 'null'],
          pattern: DUE_DATE_PATTERN,
          description:
            "Day to work on it, YYYY-MM-DD in the user's calendar; null clears it.",
        },
        dueTime: {
          type: 'string',
          pattern: DUE_TIME_PATTERN,
          description: "Start time on dueDate, 24-hour HH:MM in the user's time zone.",
        },
        deadlineDate: {
          type: ['string', 'null'],
          pattern: DUE_DATE_PATTERN,
          description: 'Day the work is due, YYYY-MM-DD; null removes the deadline.',
        },
        deadlineTime: {
          type: 'string',
          pattern: DUE_TIME_PATTERN,
          description: 'Time on deadlineDate, 24-hour HH:MM.',
        },
        estimateMinutes: {
          type: 'integer',
          minimum: 0,
          maximum: ESTIMATE_MINUTES_MAX,
          description: 'Estimate in whole minutes; 0 clears it.',
        },
        projectId: idSchema('Move the task to this project.'),
        tagIds: {
          type: 'array',
          items: { type: 'string' },
          maxItems: 50,
          description: "The task's tags (replaces them; not for subtasks).",
        },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, UPDATE_ARGS);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    if (id instanceof Error) {
      return invalid(id.message);
    }
    const changes = toTaskChanges(args);
    if (typeof changes === 'string') {
      return invalid(changes);
    }
    if (Object.keys(changes).length === 0) {
      return invalid('Give at least one field to change');
    }
    const data = await forwardWrite(forward, {
      method: 'PATCH',
      path: `/tasks/${id}`,
      body: { ...changes, isIgnoreShortSyntax: true },
    });
    return isToolError(data) ? data : taskResult(data);
  },
};

export const addSubtask: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'add_subtask',
    ...describeTool('Add subtask', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      'Adds a subtask to an existing task, with the title and notes exactly as written. ' +
      "It takes the parent task's project. Retrying after an error can create a duplicate.",
    inputSchema: {
      type: 'object',
      properties: {
        parentId: idSchema('The id of the task to add the subtask to.'),
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_CHARS },
        notes: { type: 'string', maxLength: MAX_NOTES_CHARS },
        estimateMinutes: { type: 'integer', minimum: 1, maximum: ESTIMATE_MINUTES_MAX },
      },
      required: ['parentId', 'title'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, [
      'parentId',
      'title',
      'notes',
      'estimateMinutes',
    ]);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const parentId = requiredId(args, 'parentId');
    const title = optionalString(args, 'title', MAX_TITLE_CHARS);
    const notes = optionalString(args, 'notes', MAX_NOTES_CHARS);
    const estimate = optionalInteger(args, 'estimateMinutes', 1, ESTIMATE_MINUTES_MAX);
    const error = firstError([parentId, notes, estimate]);
    if (error) {
      return invalid(error.message);
    }
    if (typeof title !== 'string' || !title.trim()) {
      return invalid(
        `title must be a non-empty string of at most ${MAX_TITLE_CHARS} characters`,
      );
    }
    const data = await forwardWrite(forward, {
      method: 'POST',
      path: '/tasks',
      body: {
        title,
        parentId,
        isIgnoreShortSyntax: true,
        ...(notes ? { notes } : {}),
        ...(typeof estimate === 'number' ? { timeEstimate: estimate * 60000 } : {}),
      },
    });
    return isToolError(data) ? data : taskResult(data);
  },
};

/** A tool that acts on one task by id: start, archive, restore, delete. */
const taskAction = (
  name: string,
  title: string,
  scope: 'tasks:edit' | 'tasks:delete',
  hints: typeof WRITE_HINTS | typeof DESTRUCTIVE_HINTS,
  description: string,
  method: 'POST' | 'DELETE',
  suffix: string,
): ToolSpec => ({
  scope,
  definition: {
    name,
    ...describeTool(title, hints),
    description,
    inputSchema: {
      type: 'object',
      properties: { id: idSchema('The task id.') },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['id']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    if (id instanceof Error) {
      return invalid(id.message);
    }
    const data = await forwardWrite(forward, { method, path: `/tasks/${id}${suffix}` });
    return isToolError(data) ? data : taskResult(data);
  },
});

export const startTask = taskAction(
  'start_task',
  'Start tracking task',
  'tasks:edit',
  WRITE_HINTS,
  'Starts tracking time on a task, like its play button; any other tracked task stops.',
  'POST',
  '/start',
);

export const archiveTask = taskAction(
  'archive_task',
  'Archive task',
  'tasks:edit',
  WRITE_HINTS,
  'Moves a top-level task (with its subtasks) to the archive, as finishing the day does. ' +
    'restore_task brings it back.',
  'POST',
  '/archive',
);

export const restoreTask = taskAction(
  'restore_task',
  'Restore task',
  'tasks:edit',
  WRITE_HINTS,
  'Brings an archived task (with its subtasks) back to the active tasks.',
  'POST',
  '/restore',
);

export const deleteTask = taskAction(
  'delete_task',
  'Delete task',
  'tasks:delete',
  DESTRUCTIVE_HINTS,
  'Deletes a task and its subtasks. This cannot be undone from here; ' +
    'confirm with the user first. To keep it, use archive_task instead.',
  'DELETE',
  '',
);

export const stopTracking: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'stop_tracking',
    ...describeTool('Stop tracking', WRITE_HINTS),
    description: 'Stops tracking time on the current task, like its pause button.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const data = await forwardWrite(forward, {
      method: 'POST',
      path: '/task-control/stop',
    });
    return isToolError(data) ? data : ok({ currentTaskId: null });
  },
};

export const logTime: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'log_time',
    ...describeTool('Log time', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      'Adds time spent on a task for a day, or with mode "set" ' +
      "replaces that day's time. Not for tasks with subtasks: log on a subtask.",
    inputSchema: {
      type: 'object',
      properties: {
        id: idSchema('The task id.'),
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
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['id', 'minutes', 'date', 'mode']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    const date = optionalDay(args, 'date');
    const mode = args.mode ?? 'add';
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
    if (mode !== 'add' && mode !== 'set') {
      return invalid('mode must be "add" or "set"');
    }
    if (typeof minutes !== 'number') {
      return invalid('minutes is required');
    }
    if (typeof date !== 'string') {
      return invalid('date must be a valid YYYY-MM-DD date');
    }
    const data = await forwardWrite(forward, {
      method: mode === 'set' ? 'PUT' : 'POST',
      path: `/tasks/${id}/time`,
      body: { date, duration: minutes * 60000 },
    });
    return isToolError(data) ? data : taskResult(data);
  },
};
