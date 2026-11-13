import { DUE_DATE_PATTERN, isCalendarDay } from './capture-args';
import { McpToolDefinition, McpToolResult } from './mcp-protocol';
import {
  DESTRUCTIVE_HINTS,
  MAX_NAMED_ENTITIES,
  MAX_NOTES_CHARS,
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
  optionalId,
  optionalInteger,
  optionalString,
  pick,
  requiredId,
} from './mcp-tool-kit';

/**
 * Notes (project notes and notes pinned to Today) and simple counters
 * (counters and habits), forwarded to the local REST API's /notes and
 * /simple-counters routes.
 */

const DUE_DATE_RE = new RegExp(DUE_DATE_PATTERN);
// A day's counter value; the route only needs a safe integer.
const MAX_COUNTER_VALUE = 1_000_000;
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
    : ok(isRecord(data) ? pick(data, ['id', 'deleted']) : {});

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

const NOTE_FIELDS = {
  content: { type: 'string', minLength: 1, maxLength: MAX_NOTES_CHARS },
  projectId: { type: 'string', description: 'The project the note belongs to.' },
  isPinnedToToday: { type: 'boolean', description: 'Show the note on Today.' },
};

/** The note fields given, checked, or an error message. */
const toNoteFields = (
  args: Record<string, unknown>,
): Record<string, unknown> | string => {
  const content = optionalString(args, 'content', MAX_NOTES_CHARS);
  const projectId = optionalId(args, 'projectId');
  const isPinnedToToday = optionalBoolean(args, 'isPinnedToToday');
  const error = firstError([content, projectId, isPinnedToToday]);
  if (error) {
    return error.message;
  }
  if (typeof content === 'string' && !content.trim()) {
    return 'content must not be empty';
  }
  return {
    ...(content !== undefined ? { content } : {}),
    ...(projectId !== undefined ? { projectId } : {}),
    ...(isPinnedToToday !== undefined ? { isPinnedToToday } : {}),
  };
};

export const createNote: ToolSpec = {
  scope: 'notes:edit',
  definition: {
    name: 'create_note',
    ...describeTool('Add note', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      'Adds a note to a project, or pinned to Today, with the content exactly as written. ' +
      'Give a projectId, isPinnedToToday true, or both. Retrying after an error can create a duplicate.',
    inputSchema: {
      type: 'object',
      properties: NOTE_FIELDS,
      required: ['content'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, Object.keys(NOTE_FIELDS));
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const fields = toNoteFields(args);
    if (typeof fields === 'string') {
      return invalid(fields);
    }
    if (typeof fields.content !== 'string') {
      return invalid('content is required');
    }
    if (fields.projectId === undefined && fields.isPinnedToToday !== true) {
      return invalid('Give a projectId or isPinnedToToday: true');
    }
    const data = await forwardWrite(forward, {
      method: 'POST',
      path: '/notes',
      body: fields,
    });
    return isToolError(data) ? data : noteResult(data);
  },
};

export const updateNote: ToolSpec = {
  scope: 'notes:edit',
  definition: {
    name: 'update_note',
    ...describeTool('Update note', WRITE_HINTS),
    description:
      'Changes a note: its content (replaced as written), whether it is pinned to Today, or, ' +
      'on its own, the project it belongs to.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', description: 'The note id.' }, ...NOTE_FIELDS },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['id', ...Object.keys(NOTE_FIELDS)]);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    if (id instanceof Error) {
      return invalid(id.message);
    }
    const fields = toNoteFields(args);
    if (typeof fields === 'string') {
      return invalid(fields);
    }
    if (Object.keys(fields).length === 0) {
      return invalid('Give at least one field to change');
    }
    const data = await forwardWrite(forward, {
      method: 'PATCH',
      path: `/notes/${id}`,
      body: fields,
    });
    return isToolError(data) ? data : noteResult(data);
  },
};

export const deleteNote: ToolSpec = {
  scope: 'notes:edit',
  definition: {
    name: 'delete_note',
    ...describeTool('Delete note', DESTRUCTIVE_HINTS),
    description:
      'Deletes a note. This cannot be undone from here; confirm with the user first.',
    inputSchema: ID_ONLY('The note id.'),
  },
  run: async (args, _scopes, forward) => {
    const id = idArg(args);
    if (typeof id !== 'string') {
      return id;
    }
    const data = await forwardWrite(forward, { method: 'DELETE', path: `/notes/${id}` });
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
    : ok({});

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

export const setCounter: ToolSpec = {
  scope: 'counters:edit',
  definition: {
    name: 'set_counter',
    ...describeTool('Set counter value', WRITE_HINTS),
    description:
      "Sets a counter's or habit's value for a day (today unless date is given), " +
      'replacing what was there.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The counter id.' },
        value: { type: 'integer', minimum: 0, maximum: MAX_COUNTER_VALUE },
        date: {
          type: 'string',
          pattern: DUE_DATE_PATTERN,
          description: 'The day, YYYY-MM-DD, not after today. Default: today.',
        },
      },
      required: ['id', 'value'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['id', 'value', 'date']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    const value = optionalInteger(args, 'value', 0, MAX_COUNTER_VALUE);
    const error = firstError([id, value]);
    if (error) {
      return invalid(error.message);
    }
    if (value === undefined) {
      return invalid('value is required');
    }
    const date = args.date;
    if (
      date !== undefined &&
      (typeof date !== 'string' || !DUE_DATE_RE.test(date) || !isCalendarDay(date))
    ) {
      return invalid('date must be a valid YYYY-MM-DD date');
    }
    const data = await forwardWrite(forward, {
      method: 'PUT',
      path: `/simple-counters/${id}/value`,
      body: { value, ...(date !== undefined ? { date } : {}) },
    });
    return isToolError(data) ? data : counterResult(data);
  },
};

export const incrementCounter: ToolSpec = {
  scope: 'counters:edit',
  definition: {
    name: 'increment_counter',
    ...describeTool('Count up', {
      readOnly: false,
      destructive: false,
      idempotent: false,
    }),
    description:
      "Adds to today's value of a counter or habit, like its button (by 1 unless by is given). " +
      'Not for stopwatch counters.',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'The counter id.' },
        by: { type: 'integer', minimum: 1, maximum: MAX_COUNTER_VALUE },
      },
      required: ['id'],
      additionalProperties: false,
    },
  },
  run: async (args, _scopes, forward) => {
    const unknownArg = findUnknownArg(args, ['id', 'by']);
    if (unknownArg) {
      return invalid(unknownArg);
    }
    const id = requiredId(args, 'id');
    const by = optionalInteger(args, 'by', 1, MAX_COUNTER_VALUE);
    const error = firstError([id, by]);
    if (error) {
      return invalid(error.message);
    }
    const data = await forwardWrite(forward, {
      method: 'POST',
      path: `/simple-counters/${id}/increment`,
      body: typeof by === 'number' ? { by } : {},
    });
    return isToolError(data) ? data : counterResult(data);
  },
};
