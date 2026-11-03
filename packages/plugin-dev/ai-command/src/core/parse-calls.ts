// Shape check of the model's tool calls. A call that fails it is a schema
// failure: the request is retried once with these notes (§ 6.2).

import type { ToolCall } from './types';

export interface RawAdd {
  ref: string;
  title: string;
  project?: string;
  tags?: string[];
  day?: string;
  estimateMin?: number;
  parent?: string;
  note?: string;
}

export interface RawUpdate {
  id: string;
  title?: string;
  day?: string;
  estimateMin?: number;
  done?: boolean;
  project?: string;
  tags?: string[];
  appendNote?: string;
}

export interface RawShow {
  title: string;
  items: { id: string; reason: string }[];
}

export interface ParsedCalls {
  adds: RawAdd[];
  updates: RawUpdate[];
  deletes: { id: string }[];
  shows: RawShow[];
  says: string[];
  errors: string[];
}

type FieldType = 'string' | 'number' | 'boolean' | 'string[]';
type Spec = Record<string, FieldType>;

const SPECS: Record<string, { spec: Spec; required: string[] }> = {
  add_task: {
    spec: {
      ref: 'string',
      title: 'string',
      project: 'string',
      tags: 'string[]',
      day: 'string',
      estimateMin: 'number',
      parent: 'string',
      note: 'string',
    },
    required: ['ref', 'title'],
  },
  update_task: {
    spec: {
      id: 'string',
      title: 'string',
      day: 'string',
      estimateMin: 'number',
      done: 'boolean',
      project: 'string',
      tags: 'string[]',
      appendNote: 'string',
    },
    required: ['id'],
  },
  delete_task: { spec: { id: 'string' }, required: ['id'] },
  show_tasks: { spec: { title: 'string' }, required: ['title', 'items'] },
  say: { spec: { text: 'string' }, required: ['text'] },
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const hasType = (value: unknown, type: FieldType): boolean =>
  type === 'string[]'
    ? Array.isArray(value) && value.every((v) => typeof v === 'string')
    : type === 'number'
      ? typeof value === 'number' && Number.isFinite(value)
      : typeof value === type;

const isItem = (v: unknown): boolean =>
  isRecord(v) && typeof v.id === 'string' && typeof v.reason === 'string';

/** The first problem with one call's input, or null. Extra fields are a problem: strict schemas forbid them. */
export const shapeError = (call: ToolCall): string | null => {
  const def = SPECS[call.name];
  if (!def) return `unknown tool ${call.name}.`;
  if (!isRecord(call.input)) return `${call.name}: the input is not an object.`;
  const input = call.input;
  const missing = def.required.find((k) => input[k] === undefined);
  if (missing) return `${call.name}: ${missing} is missing.`;
  for (const [k, v] of Object.entries(input)) {
    if (call.name === 'show_tasks' && k === 'items') {
      if (!Array.isArray(v) || !v.every(isItem))
        return 'show_tasks: items must be {id, reason} objects.';
      continue;
    }
    const type = def.spec[k];
    if (!type) return `${call.name}: unknown field ${k}.`;
    if (v !== null && !hasType(v, type)) return `${call.name}: ${k} must be a ${type}.`;
  }
  return null;
};

/** Drops null fields, which strict schemas never send but other providers might. */
const clean = <T>(input: unknown): T =>
  Object.fromEntries(
    Object.entries(input as Record<string, unknown>).filter(([, v]) => v !== null),
  ) as T;

export const parseCalls = (calls: ToolCall[]): ParsedCalls => {
  const out: ParsedCalls = {
    adds: [],
    updates: [],
    deletes: [],
    shows: [],
    says: [],
    errors: [],
  };
  for (const call of calls) {
    const error = shapeError(call);
    if (error) {
      out.errors.push(error);
      continue;
    }
    if (call.name === 'add_task') out.adds.push(clean<RawAdd>(call.input));
    if (call.name === 'update_task') out.updates.push(clean<RawUpdate>(call.input));
    if (call.name === 'delete_task') out.deletes.push(clean<{ id: string }>(call.input));
    if (call.name === 'show_tasks') out.shows.push(clean<RawShow>(call.input));
    if (call.name === 'say') out.says.push((call.input as { text: string }).text);
  }
  return out;
};
