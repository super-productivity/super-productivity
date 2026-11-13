import {
  DUE_DATE_PATTERN,
  REPEAT_CYCLES,
  REPEAT_WEEKDAYS,
  isCalendarDay,
} from './capture-args';
import { McpToolDefinition, McpToolResult } from './mcp-protocol';
import {
  DESTRUCTIVE_HINTS,
  MAX_NAMED_ENTITIES,
  READ_ONLY_HINTS,
  ToolSpec,
  UNTRUSTED_NOTE,
  WRITE_HINTS,
  describeTool,
  findUnknownArg,
  firstError,
  fitToResponseCap,
  forwardRead,
  forwardWrite,
  invalid,
  isRecord,
  isToolError,
  ok,
  optionalBoolean,
  optionalInteger,
  pick,
  requiredId,
} from './mcp-tool-kit';

/**
 * Repeat configurations (recurring tasks), forwarded to the local REST API's
 * /task-repeat-cfgs routes. The arguments use create_task's repeat shape
 * (cycle, every, weekdays) rather than the stored field names.
 */

const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
// The repeat dialog's limit, which the route enforces.
const REPEAT_EVERY_LIMIT = 1000;
const STORED_WEEKDAYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
] as const;

/** A stored repeat configuration, in create_task's repeat terms. */
const toRepeatConfig = (cfg: Record<string, unknown>): Record<string, unknown> => ({
  ...pick(cfg, [
    'id',
    'title',
    'projectId',
    'tagIds',
    'repeatEvery',
    'startDate',
    'repeatUntilDay',
    'startTime',
    'isPaused',
    'skipOverdue',
    'lastTaskCreationDay',
  ]),
  ...(typeof cfg.repeatCycle === 'string'
    ? { cycle: cfg.repeatCycle.toLowerCase() }
    : {}),
  ...(cfg.repeatCycle === 'WEEKLY'
    ? {
        weekdays: REPEAT_WEEKDAYS.filter((_, i) => cfg[STORED_WEEKDAYS[i]] === true),
      }
    : {}),
});

const repeatResult = (data: unknown): McpToolResult =>
  isRecord(data) && typeof data.id === 'string' && 'repeatCycle' in data
    ? ok({ repeatConfig: toRepeatConfig(data) })
    : ok(isRecord(data) ? pick(data, ['id', 'deleted']) : {});

/**
 * The schedule arguments as the route's fields, or an error message. The route
 * takes a cycle, interval, weekdays or start day only as a "CUSTOM" schedule,
 * like the repeat dialog's custom option; a new one without a cycle is daily.
 */
const toScheduleFields = (
  args: Record<string, unknown>,
  isCreate: boolean,
): Record<string, unknown> | string => {
  const every = optionalInteger(args, 'every', 1, REPEAT_EVERY_LIMIT);
  const isPaused = optionalBoolean(args, 'isPaused');
  const skipOverdue = optionalBoolean(args, 'skipOverdue');
  const error = firstError([every, isPaused, skipOverdue]);
  if (error) {
    return error.message;
  }
  const fields: Record<string, unknown> = {};
  if (args.cycle !== undefined) {
    if (!REPEAT_CYCLES.includes(args.cycle as (typeof REPEAT_CYCLES)[number])) {
      return `cycle must be one of ${REPEAT_CYCLES.join(', ')}`;
    }
    fields.repeatCycle = (args.cycle as string).toUpperCase();
  }
  if (args.startDate !== undefined) {
    const day = args.startDate;
    if (typeof day !== 'string' || !DUE_DATE_RE.test(day) || !isCalendarDay(day)) {
      return 'startDate must be a valid YYYY-MM-DD date';
    }
    fields.startDate = day;
  }
  if (args.weekdays !== undefined) {
    const days = args.weekdays;
    if (
      !Array.isArray(days) ||
      days.length === 0 ||
      !days.every((d) => REPEAT_WEEKDAYS.includes(d as (typeof REPEAT_WEEKDAYS)[number]))
    ) {
      return `weekdays must be a non-empty list of ${REPEAT_WEEKDAYS.join(', ')}`;
    }
    REPEAT_WEEKDAYS.forEach((day, i) => {
      fields[STORED_WEEKDAYS[i]] = days.includes(day);
    });
  }
  if (typeof every === 'number') fields.repeatEvery = every;
  if (
    ['repeatCycle', 'repeatEvery', 'startDate', 'monday'].some((key) => key in fields)
  ) {
    fields.quickSetting = 'CUSTOM';
    if (isCreate && !('repeatCycle' in fields)) {
      fields.repeatCycle = 'DAILY';
    }
  }
  if (isPaused !== undefined) fields.isPaused = isPaused;
  if (skipOverdue !== undefined) fields.skipOverdue = skipOverdue;
  return fields;
};

const SCHEDULE_PROPERTIES: Record<string, unknown> = {
  cycle: { type: 'string', enum: [...REPEAT_CYCLES] },
  every: {
    type: 'integer',
    minimum: 1,
    maximum: REPEAT_EVERY_LIMIT,
    description: 'Repeat every N cycles. Default 1.',
  },
  weekdays: {
    type: 'array',
    items: { type: 'string', enum: [...REPEAT_WEEKDAYS] },
    minItems: 1,
    uniqueItems: true,
    description: 'Weekly only: the days it repeats on.',
  },
  startDate: {
    type: 'string',
    pattern: DUE_DATE_PATTERN,
    description: 'First day of the repeat, YYYY-MM-DD.',
  },
  isPaused: { type: 'boolean', description: 'Paused repeats create no new tasks.' },
  skipOverdue: {
    type: 'boolean',
    description: 'Skip occurrences missed while the app was closed.',
  },
};
const SCHEDULE_KEYS = Object.keys(SCHEDULE_PROPERTIES);

export const listRepeatConfigs: ToolSpec = {
  scope: 'tasks:read',
  definition: {
    name: 'list_repeat_configs',
    ...describeTool('List recurring tasks', READ_ONLY_HINTS),
    description:
      'Lists the repeat configurations of recurring tasks: title, project, tags and schedule. ' +
      UNTRUSTED_NOTE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const data = await forwardRead(forward, { method: 'GET', path: '/task-repeat-cfgs' });
    if (isToolError(data)) {
      return data;
    }
    const all = Array.isArray(data) ? data.filter(isRecord) : [];
    const page = all.slice(0, MAX_NAMED_ENTITIES).map(toRepeatConfig);
    const fitted = fitToResponseCap(page, (items) => ({
      repeatConfigs: items,
      truncated: true,
    }));
    return ok({ repeatConfigs: fitted, truncated: all.length > fitted.length });
  },
};

const byId = (args: Record<string, unknown>): string | McpToolResult => {
  const unknownArg = findUnknownArg(args, ['id']);
  if (unknownArg) {
    return invalid(unknownArg);
  }
  const id = requiredId(args, 'id');
  return id instanceof Error ? invalid(id.message) : id;
};

const ID_ONLY_SCHEMA: McpToolDefinition['inputSchema'] = {
  type: 'object',
  properties: { id: { type: 'string', description: 'The repeat configuration id.' } },
  required: ['id'],
  additionalProperties: false,
};

export const getRepeatConfig: ToolSpec = {
  scope: 'tasks:read',
  definition: {
    name: 'get_repeat_config',
    ...describeTool('Get recurring task', READ_ONLY_HINTS),
    description: 'Returns one repeat configuration by id. ' + UNTRUSTED_NOTE,
    inputSchema: ID_ONLY_SCHEMA,
  },
  run: async (args, _scopes, forward) => {
    const id = byId(args);
    if (typeof id !== 'string') {
      return id;
    }
    const data = await forwardRead(forward, {
      method: 'GET',
      path: `/task-repeat-cfgs/${id}`,
    });
    return isToolError(data) ? data : repeatResult(data);
  },
};

export const createRepeatConfig: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'create_repeat_config',
    ...describeTool('Make task recurring', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      'Makes an existing task recurring, like its repeat dialog: the task becomes the first occurrence. ' +
      'Without a cycle it repeats daily.',
    inputSchema: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: 'The task to make recurring.' },
        ...SCHEDULE_PROPERTIES,
      },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['taskId', ...SCHEDULE_KEYS]);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const taskId = requiredId(args, 'taskId');
    if (taskId instanceof Error) {
      return invalid(taskId.message);
    }
    const fields = toScheduleFields(args, true);
    if (typeof fields === 'string') {
      return invalid(fields);
    }
    const data = await forwardWrite(forward, {
      method: 'POST',
      path: '/task-repeat-cfgs',
      body: { taskId, ...fields },
    });
    return isToolError(data) ? data : repeatResult(data);
  },
};

export const updateRepeatConfig: ToolSpec = {
  scope: 'tasks:edit',
  definition: {
    name: 'update_repeat_config',
    ...describeTool('Change recurring task', WRITE_HINTS),
    description:
      "Changes a recurring task's schedule, or pauses or resumes it. Only the fields given change.",
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The repeat configuration id.' },
        ...SCHEDULE_PROPERTIES,
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['id', ...SCHEDULE_KEYS]);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    if (id instanceof Error) {
      return invalid(id.message);
    }
    const fields = toScheduleFields(args, false);
    if (typeof fields === 'string') {
      return invalid(fields);
    }
    if (Object.keys(fields).length === 0) {
      return invalid('Give at least one field to change');
    }
    const data = await forwardWrite(forward, {
      method: 'PATCH',
      path: `/task-repeat-cfgs/${id}`,
      body: fields,
    });
    return isToolError(data) ? data : repeatResult(data);
  },
};

export const deleteRepeatConfig: ToolSpec = {
  scope: 'tasks:delete',
  definition: {
    name: 'delete_repeat_config',
    ...describeTool('Stop recurring task', DESTRUCTIVE_HINTS),
    description:
      'Deletes a repeat configuration, so no new occurrences are created; tasks it already created stay. ' +
      'Confirm with the user first; to stop it for a while, pause it with update_repeat_config.',
    inputSchema: ID_ONLY_SCHEMA,
  },
  run: async (args, _scopes, forward) => {
    const id = byId(args);
    if (typeof id !== 'string') {
      return id;
    }
    const data = await forwardWrite(forward, {
      method: 'DELETE',
      path: `/task-repeat-cfgs/${id}`,
    });
    return isToolError(data) ? data : repeatResult(data);
  },
};
