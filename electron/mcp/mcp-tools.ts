import {
  AssistantAccessScope,
  ASSISTANT_CAPTURE_PATH,
  ASSISTANT_CAPTURE_TIMEOUT_MS,
  AssistantCaptureResult,
} from '../shared-with-frontend/assistant-access.model';
import { McpToolDefinition, McpToolResult } from './mcp-protocol';
import {
  DUE_DATE_PATTERN,
  DUE_TIME_PATTERN,
  REPEAT_CYCLES,
  REPEAT_EVERY_MAX,
  REPEAT_WEEKDAYS,
  validateCaptureSchedule,
} from './capture-args';
import {
  DEFAULT_LIST_LIMIT,
  MAX_LIST_LIMIT,
  MAX_NAMED_ENTITIES,
  MAX_NOTES_CHARS,
  MAX_TITLE_CHARS,
  MAX_FILTER_CHARS,
  MAX_RESPONSE_BYTES,
  ForwardToRenderer,
  RendererReply,
  ToolSpec,
  UNTRUSTED_NOTE,
  READ_ONLY_HINTS,
  describeTool,
  ok,
  fail,
  invalid,
  findUnknownArg,
  optionalString,
  optionalId,
  optionalBoolean,
  isRecord,
  toTaskSummary,
  toNamedEntity,
  byteLength,
  fitToResponseCap,
  failFromRenderer,
  forwardSafely,
  isToolResult,
} from './mcp-tool-kit';

/**
 * The assistant tools, mapped onto the renderer routes the local REST API
 * already has. Scopes, argument validation, field projection and size caps
 * all happen here in the main process, so a tool can never hand an assistant
 * more than its grant allows, whatever the route returns.
 */

// Re-exported so the HTTP layer and the forwarder only know this module.
export { RendererTimeoutError } from './mcp-tool-kit';
export type { ForwardToRenderer } from './mcp-tool-kit';

export const MCP_API_VERSION = '1';

// --- tools -----------------------------------------------------------------------

const getStatus: ToolSpec = {
  definition: {
    name: 'get_status',
    ...describeTool('Check connection', READ_ONLY_HINTS),
    description:
      'Reports whether Super Productivity is ready and which permissions this connection has. Returns no task data.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    // Only the status code is used; the route's payload is discarded.
    const reply = await forwardSafely(forward, { method: 'GET', path: '/status' });
    const isReady = !isToolResult(reply) && reply.status === 200;
    return ok({ isReady, apiVersion: MCP_API_VERSION, grantedScopes: [...scopes] });
  },
};

const listTasks: ToolSpec = {
  scope: 'tasks:read',
  definition: {
    name: 'list_tasks',
    ...describeTool('List tasks', READ_ONLY_HINTS),
    description:
      'Lists active (not archived) tasks as summaries, open tasks only unless includeDone is set. ' +
      'Filter by a title search, a project id or a tag id (use tagId "TODAY" for today\'s tasks). ' +
      `Returns at most ${MAX_LIST_LIMIT} tasks; "truncated" means there are more, so narrow the filter. ` +
      UNTRUSTED_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          maxLength: MAX_FILTER_CHARS,
          description: 'Case-insensitive text that must appear in the title.',
        },
        projectId: { type: 'string', description: 'Only tasks of this project.' },
        tagId: { type: 'string', description: 'Only tasks with this tag, or "TODAY".' },
        includeDone: { type: 'boolean', description: 'Also include completed tasks.' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: MAX_LIST_LIMIT,
          description: `Maximum number of tasks (default ${DEFAULT_LIST_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, [
      'query',
      'projectId',
      'tagId',
      'includeDone',
      'limit',
    ]);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const query = optionalString(args, 'query', MAX_FILTER_CHARS);
    const projectId = optionalId(args, 'projectId');
    const tagId = optionalId(args, 'tagId');
    const includeDone = optionalBoolean(args, 'includeDone');
    for (const value of [query, projectId, tagId, includeDone]) {
      if (value instanceof Error) {
        return invalid(value.message);
      }
    }
    const rawLimit = args.limit;
    if (
      rawLimit !== undefined &&
      (typeof rawLimit !== 'number' ||
        !Number.isInteger(rawLimit) ||
        rawLimit < 1 ||
        rawLimit > MAX_LIST_LIMIT)
    ) {
      return invalid(`limit must be an integer from 1 to ${MAX_LIST_LIMIT}`);
    }
    const limit = typeof rawLimit === 'number' ? rawLimit : DEFAULT_LIST_LIMIT;

    const routeQuery: Record<string, string> = {
      source: 'active',
      includeDone: includeDone === true ? 'true' : 'false',
    };
    if (typeof query === 'string' && query) routeQuery.query = query;
    if (typeof projectId === 'string') routeQuery.projectId = projectId;
    if (typeof tagId === 'string') routeQuery.tagId = tagId;

    const reply = await forwardSafely(forward, {
      method: 'GET',
      path: '/tasks',
      query: routeQuery,
    });
    if (isToolResult(reply)) {
      return reply;
    }
    if (!reply.body.ok || !Array.isArray(reply.body.data)) {
      return failFromRenderer(reply);
    }
    const all = reply.body.data.filter(isRecord);
    const page = all.slice(0, limit).map(toTaskSummary);
    const fitted = fitToResponseCap(page, (tasks) => ({ tasks, truncated: true }));
    return ok({ tasks: fitted, truncated: all.length > fitted.length });
  },
};

const getTask: ToolSpec = {
  scope: 'tasks:read',
  definition: {
    name: 'get_task',
    ...describeTool('Get task', READ_ONLY_HINTS),
    description:
      'Returns one active task by id, including its subtask ids. Notes are only included when ' +
      `includeNotes is set and this connection may read notes; they are cut at ${MAX_NOTES_CHARS} characters. ` +
      UNTRUSTED_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The task id.' },
        includeNotes: { type: 'boolean', description: 'Also return the task notes.' },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, scopes, forward, getScopes) => {
    const unknownArg = findUnknownArg(args, ['id', 'includeNotes']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = optionalId(args, 'id');
    const includeNotes = optionalBoolean(args, 'includeNotes');
    if (id === undefined || id instanceof Error) {
      return invalid('id must be a task id');
    }
    if (includeNotes instanceof Error) {
      return invalid(includeNotes.message);
    }
    if (includeNotes && !scopes.includes('tasks:read_notes')) {
      return fail(
        'NOTES_NOT_PERMITTED',
        'This connection may not read notes. The user can allow it in Super Productivity settings.',
      );
    }

    // `source=active` hides tasks of archived projects, like list_tasks does.
    const reply = await forwardSafely(forward, {
      method: 'GET',
      path: `/tasks/${id}`,
      query: { source: 'active' },
    });
    if (isToolResult(reply)) {
      return reply;
    }
    if (!reply.body.ok || !isRecord(reply.body.data)) {
      return failFromRenderer(reply);
    }
    const source = reply.body.data;
    const task: Record<string, unknown> = {
      ...toTaskSummary(source),
      subTaskIds: Array.isArray(source.subTaskIds) ? source.subTaskIds : [],
    };
    if (includeNotes && !getScopes().includes('tasks:read_notes')) {
      // Revoked while the task was being fetched.
      return fail(
        'NOTES_NOT_PERMITTED',
        'This connection may not read notes. The user can allow it in Super Productivity settings.',
      );
    }
    if (includeNotes) {
      const notes = typeof source.notes === 'string' ? source.notes : '';
      task.notes = notes.slice(0, MAX_NOTES_CHARS);
      task.notesTruncated = notes.length > MAX_NOTES_CHARS;
    }
    // Titles and subtask lists are not bounded by the app.
    if (byteLength({ task }) > MAX_RESPONSE_BYTES) {
      return fail('RESPONSE_TOO_LARGE', 'This task is too large to return.');
    }
    return ok({ task });
  },
};

const namedEntityList = (
  name: 'list_projects' | 'list_tags',
  title: string,
  path: '/projects' | '/tags',
  key: 'projects' | 'tags',
  description: string,
): ToolSpec => ({
  scope: 'tasks:read',
  definition: {
    name,
    ...describeTool(title, READ_ONLY_HINTS),
    description,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const reply = await forwardSafely(forward, { method: 'GET', path });
    if (isToolResult(reply)) {
      return reply;
    }
    if (!reply.body.ok || !Array.isArray(reply.body.data)) {
      return failFromRenderer(reply);
    }
    const all = reply.body.data.filter(isRecord);
    const page = all.slice(0, MAX_NAMED_ENTITIES).map(toNamedEntity);
    const fitted = fitToResponseCap(page, (items) => ({ [key]: items, truncated: true }));
    return ok({ [key]: fitted, truncated: all.length > fitted.length });
  },
});

const listProjects = namedEntityList(
  'list_projects',
  'List projects',
  '/projects',
  'projects',
  'Lists the ids and titles of active projects, to interpret or filter tasks. ' +
    UNTRUSTED_NOTE,
);

const listTags = namedEntityList(
  'list_tags',
  'List tags',
  '/tags',
  'tags',
  'Lists the ids and titles of tags, to interpret or filter tasks. ' + UNTRUSTED_NOTE,
);

const CAPTURE_MESSAGES: Record<
  Exclude<AssistantCaptureResult['status'], 'created'>,
  string
> = {
  APP_BUSY: 'Super Productivity is applying synced changes. Retry in a few seconds.',
  PERSIST_DEGRADED:
    'Super Productivity could not save recent changes. Nothing was added; ask the user to check the app.',
  OUTCOME_UNKNOWN:
    'The task may or may not have been saved. Ask the user to check the Inbox before retrying.',
};

const createTask: ToolSpec = {
  scope: 'tasks:capture',
  definition: {
    name: 'create_task',
    // Adds and never overwrites; a repeated call adds another task.
    ...describeTool('Add task to Inbox', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      "Adds a new task to the user's Inbox with the given title and optional notes, exactly as written. " +
      'It gets the same defaults as a task the user adds to the Inbox by hand; no project or tag ' +
      'comes from the request, and #tags, +projects and dates in the title or notes are not parsed. ' +
      'Pass dueDate (and optionally dueTime) to schedule the task, and repeat to make it recurring. ' +
      'Retrying after an error can create a duplicate.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', minLength: 1, maxLength: MAX_TITLE_CHARS },
        notes: { type: 'string', maxLength: MAX_NOTES_CHARS },
        dueDate: {
          type: 'string',
          description:
            "Optional day to schedule the task for, as YYYY-MM-DD in the user's " +
            'local calendar.',
          pattern: DUE_DATE_PATTERN,
        },
        dueTime: {
          type: 'string',
          description:
            "Optional start time on dueDate, as 24-hour HH:MM in the user's local " +
            'time zone. Requires dueDate. Without it the task is due on the day, ' +
            'with no time.',
          pattern: DUE_TIME_PATTERN,
        },
        repeat: {
          type: 'object',
          description:
            'Optional: make the task recurring, starting on dueDate (or today). ' +
            'dueTime, if given, is the time of every occurrence. A monthly or ' +
            "yearly task repeats on the start day's date.",
          properties: {
            cycle: { type: 'string', enum: [...REPEAT_CYCLES] },
            every: {
              type: 'integer',
              description: `Repeat every N cycles, 1 to ${REPEAT_EVERY_MAX}. Default 1.`,
              minimum: 1,
              maximum: REPEAT_EVERY_MAX,
            },
            weekdays: {
              type: 'array',
              description:
                "Weekly only: the days it repeats on. Default: the start day's weekday.",
              items: { type: 'string', enum: [...REPEAT_WEEKDAYS] },
              minItems: 1,
              uniqueItems: true,
            },
          },
          required: ['cycle'],
          additionalProperties: false,
        },
      },
      required: ['title'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, [
      'title',
      'notes',
      'dueDate',
      'dueTime',
      'repeat',
    ]);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const title = optionalString(args, 'title', MAX_TITLE_CHARS);
    const notes = optionalString(args, 'notes', MAX_NOTES_CHARS);
    if (typeof title !== 'string' || !title.trim()) {
      return invalid(
        `title must be a non-empty string of at most ${MAX_TITLE_CHARS} characters`,
      );
    }
    if (notes instanceof Error) {
      return invalid(notes.message);
    }
    const schedule = validateCaptureSchedule(args);
    if (typeof schedule === 'string') {
      return invalid(schedule);
    }

    let reply: RendererReply;
    try {
      reply = await forward({
        method: 'POST',
        path: ASSISTANT_CAPTURE_PATH,
        body: { title, ...(notes ? { notes } : {}), ...schedule },
        source: 'mcp',
        timeoutMs: ASSISTANT_CAPTURE_TIMEOUT_MS,
      });
    } catch {
      // The command may already have been dispatched: never claim it was not.
      return fail('OUTCOME_UNKNOWN', CAPTURE_MESSAGES.OUTCOME_UNKNOWN);
    }
    if (!reply.body.ok || !isRecord(reply.body.data)) {
      return failFromRenderer(reply);
    }
    const result = reply.body.data as unknown as AssistantCaptureResult;
    if (result.status === 'created' && typeof result.id === 'string') {
      return ok({ id: result.id, status: 'created' });
    }
    const message = CAPTURE_MESSAGES[result.status as keyof typeof CAPTURE_MESSAGES];
    return message
      ? fail(result.status, message)
      : fail('OUTCOME_UNKNOWN', CAPTURE_MESSAGES.OUTCOME_UNKNOWN);
  },
};

const ALL_TOOLS: ToolSpec[] = [
  getStatus,
  listTasks,
  getTask,
  listProjects,
  listTags,
  createTask,
];

const isGranted = (tool: ToolSpec, scopes: readonly AssistantAccessScope[]): boolean =>
  tool.scope === undefined || scopes.includes(tool.scope);

export const listGrantedTools = (
  scopes: readonly AssistantAccessScope[],
): McpToolDefinition[] =>
  ALL_TOOLS.filter((tool) => isGranted(tool, scopes)).map((tool) => tool.definition);

export const isToolGranted = (
  name: string,
  scopes: readonly AssistantAccessScope[],
): boolean =>
  ALL_TOOLS.some((tool) => tool.definition.name === name && isGranted(tool, scopes));

/**
 * Runs a granted tool. `getScopes` is read at call time, so a grant revoked
 * while the request was in flight is not honoured.
 */
export const runTool = async (
  name: string,
  args: Record<string, unknown>,
  getScopes: () => readonly AssistantAccessScope[],
  forward: ForwardToRenderer,
): Promise<McpToolResult> => {
  const scopes = getScopes();
  const tool = ALL_TOOLS.find(
    (candidate) => candidate.definition.name === name && isGranted(candidate, scopes),
  );
  if (!tool) {
    return fail('NOT_PERMITTED', 'This connection may not use this tool.');
  }
  const result = await tool.run(args, scopes, forward, getScopes);
  // A grant revoked (or access switched off) while the renderer was answering
  // must not still hand out the data. A capture that already ran is reported
  // as such, since withholding it would invite a duplicate.
  if (tool.scope !== 'tasks:capture' && !isGranted(tool, getScopes())) {
    return fail('NOT_PERMITTED', 'This connection may not use this tool.');
  }
  return result;
};
