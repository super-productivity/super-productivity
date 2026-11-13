import { DUE_DATE_PATTERN } from './capture-args';
import { McpToolDefinition, McpToolResult } from './mcp-protocol';
import {
  MAX_NAMED_ENTITIES,
  MAX_NOTES_CHARS,
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
  optionalId,
  pick,
  requiredId,
} from './mcp-tool-kit';

/**
 * Notes (project notes and notes pinned to Today) and simple counters
 * (counters and habits), read through the local REST API's /notes and
 * /simple-counters routes.
 */

const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
// Enough history for "this week" and "this month" questions.
const COUNTER_HISTORY_DAYS = 31;

const ID_ONLY = (description: string): McpToolDefinition['inputSchema'] => ({
  type: 'object',
  properties: { id: { type: 'string', description } },
  required: ['id'],
  additionalProperties: false,
});

const idArg = (args: Record<string, unknown>): string | McpToolResult => {
  const unknownArg = findUnknownArg(args, ['id']);
  if (unknownArg) {
    return invalid(unknownArg);
  }
  const id = requiredId(args, 'id');
  return id instanceof Error ? invalid(id.message) : id;
};

// --- notes -------------------------------------------------------------------------

/** A note with its content capped like task notes. */
const toNote = (note: Record<string, unknown>): Record<string, unknown> => {
  const content = typeof note.content === 'string' ? note.content : '';
  return {
    ...pick(note, ['id', 'projectId', 'isPinnedToToday', 'created', 'modified']),
    content: content.slice(0, MAX_NOTES_CHARS),
    contentTruncated: content.length > MAX_NOTES_CHARS,
  };
};

const noteResult = (data: unknown): McpToolResult =>
  isRecord(data) && typeof data.id === 'string' && 'content' in data
    ? ok({ note: toNote(data) })
    : fail('INTERNAL_ERROR', 'The request failed.');

export const listNotes: ToolSpec = {
  scope: 'notes:read',
  definition: {
    name: 'list_notes',
    ...describeTool('List notes', READ_ONLY_HINTS),
    description:
      'Lists notes (project notes and notes pinned to Today), optionally of one project, ' +
      `with their content cut at ${MAX_NOTES_CHARS} characters. ` +
      UNTRUSTED_NOTE,
    inputSchema: {
      type: 'object',
      properties: {
        projectId: { type: 'string', description: 'Only notes of this project.' },
      },
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['projectId']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const projectId = optionalId(args, 'projectId');
    if (projectId instanceof Error) {
      return invalid(projectId.message);
    }
    const data = await forwardRead(forward, {
      method: 'GET',
      path: '/notes',
      ...(projectId ? { query: { projectId } } : {}),
    });
    if (isToolError(data)) {
      return data;
    }
    const all = Array.isArray(data) ? data.filter(isRecord) : [];
    const page = all.slice(0, MAX_NAMED_ENTITIES).map(toNote);
    const fitted = fitToResponseCap(page, (notes) => ({ notes, truncated: true }));
    return ok({ notes: fitted, truncated: all.length > fitted.length });
  },
};

export const getNote: ToolSpec = {
  scope: 'notes:read',
  definition: {
    name: 'get_note',
    ...describeTool('Get note', READ_ONLY_HINTS),
    description: 'Returns one note by id. ' + UNTRUSTED_NOTE,
    inputSchema: ID_ONLY('The note id.'),
  },
  run: async (args, _scopes, forward) => {
    const id = idArg(args);
    if (typeof id !== 'string') {
      return id;
    }
    const data = await forwardRead(forward, { method: 'GET', path: `/notes/${id}` });
    return isToolError(data) ? data : noteResult(data);
  },
};

// --- counters ---------------------------------------------------------------------

/** A counter with its most recent days only. */
const toCounter = (counter: Record<string, unknown>): Record<string, unknown> => {
  const countOnDay = isRecord(counter.countOnDay) ? counter.countOnDay : {};
  const recent = Object.keys(countOnDay)
    .filter((day) => DUE_DATE_RE.test(day))
    .sort()
    .slice(-COUNTER_HISTORY_DAYS);
  return {
    ...pick(counter, ['id', 'title', 'type', 'isEnabled', 'isOn']),
    countOnDay: Object.fromEntries(recent.map((day) => [day, countOnDay[day]])),
  };
};

const counterResult = (data: unknown): McpToolResult =>
  isRecord(data) && typeof data.id === 'string'
    ? ok({ counter: toCounter(data) })
    : fail('INTERNAL_ERROR', 'The request failed.');

export const listCounters: ToolSpec = {
  scope: 'counters:read',
  definition: {
    name: 'list_counters',
    ...describeTool('List counters', READ_ONLY_HINTS),
    description:
      `Lists the counters and habits with their values for the last ${COUNTER_HISTORY_DAYS} days ` +
      'that have one. ' +
      UNTRUSTED_NOTE,
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, []);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const data = await forwardRead(forward, { method: 'GET', path: '/simple-counters' });
    if (isToolError(data)) {
      return data;
    }
    const all = Array.isArray(data) ? data.filter(isRecord) : [];
    const page = all.slice(0, MAX_NAMED_ENTITIES).map(toCounter);
    const fitted = fitToResponseCap(page, (counters) => ({ counters, truncated: true }));
    return ok({ counters: fitted, truncated: all.length > fitted.length });
  },
};

export const getCounter: ToolSpec = {
  scope: 'counters:read',
  definition: {
    name: 'get_counter',
    ...describeTool('Get counter', READ_ONLY_HINTS),
    description:
      `Returns one counter or habit with its last ${COUNTER_HISTORY_DAYS} days. ` +
      UNTRUSTED_NOTE,
    inputSchema: ID_ONLY('The counter id.'),
  },
  run: async (args, _scopes, forward) => {
    const id = idArg(args);
    if (typeof id !== 'string') {
      return id;
    }
    const data = await forwardRead(forward, {
      method: 'GET',
      path: `/simple-counters/${id}`,
    });
    return isToolError(data) ? data : counterResult(data);
  },
};
