import { REPEAT_WEEKDAYS } from './capture-args';
import { McpToolDefinition, McpToolResult } from './mcp-protocol';
import {
  MAX_NAMED_ENTITIES,
  READ_ONLY_HINTS,
  ToolSpec,
  UNTRUSTED_NOTE,
  describeTool,
  fail,
  findUnknownArg,
  fitToResponseCap,
  forwardRead,
  invalid,
  isRecord,
  isToolError,
  ok,
  pick,
  requiredId,
} from './mcp-tool-kit';

/**
 * Repeat configurations (recurring tasks), read through the local REST API's
 * /task-repeat-cfgs routes and answered in create_task's repeat terms (cycle,
 * every, weekdays) rather than the stored field names.
 */

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
  isRecord(data) && typeof data.id === 'string'
    ? ok({ repeatConfig: toRepeatConfig(data) })
    : fail('INTERNAL_ERROR', 'The request failed.');

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
