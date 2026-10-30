// The view spec: a view as data. Durable user data that syncs between devices
// and app versions, so every rule here is about staying readable:
// - unknown fields and component types are kept, never stripped;
// - edits merge into components by id, so a device that does not know a field
//   never drops it;
// - a breaking change needs a new SPEC_VERSION and a migration.

export const SPEC_VERSION = 1;

export const FIELD_NAMES = [
  'project',
  'tags',
  'estimate',
  'timeSpent',
  'due',
  'deadline',
  'priority',
] as const;
export type FieldName = (typeof FIELD_NAMES)[number];

export const GROUP_BY = ['none', 'project', 'tag', 'due', 'priority'] as const;
export type GroupBy = (typeof GROUP_BY)[number];

export const MEASURES = [
  'count',
  'timeSpentToday',
  'timeSpentThisWeek',
  'timeSpent',
  'estimate',
  'remaining',
] as const;
export type Measure = (typeof MEASURES)[number];

export const DUE_TOKENS = [
  'any',
  'today',
  'tomorrow',
  'overdue',
  'thisWeek',
  'none',
] as const;
export type DueToken = (typeof DUE_TOKENS)[number];

export const DONE_ON_TOKENS = ['today', 'thisWeek'] as const;
export type DoneOnToken = (typeof DONE_ON_TOKENS)[number];

export const PRIORITY_NAMES = ['high', 'medium', 'low', 'none'] as const;
export type PriorityName = (typeof PRIORITY_NAMES)[number];

export const SORT_KEYS = [
  'context',
  'due',
  'deadline',
  'priority',
  'created',
  'title',
  'estimate',
  'timeSpent',
] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const COMPONENT_TYPES = [
  'stack',
  'columns',
  'taskList',
  'board',
  'metric',
  'text',
] as const;
export type KnownComponentType = (typeof COMPONENT_TYPES)[number];

export interface Query {
  scope?: string;
  isDone?: boolean;
  due?: DueToken;
  doneOn?: DoneOnToken;
  tags?: string[];
  tagsMatch?: 'all' | 'any';
  notTags?: string[];
  priority?: PriorityName[];
  hasEstimate?: boolean;
  parentsOnly?: boolean;
  text?: string;
  includeArchived?: boolean;
  sort?: SortKey;
  sortDir?: 'asc' | 'desc';
  limit?: number;
  [key: string]: unknown;
}

export interface BoardColumn {
  id: string;
  title: string;
  tags?: string[];
  notTags?: string[];
  isDone?: boolean;
  [key: string]: unknown;
}

export interface Component {
  type: string;
  title?: string;
  children?: string[];
  query?: string;
  fields?: FieldName[];
  groupBy?: GroupBy;
  limit?: number;
  emptyText?: string;
  columns?: BoardColumn[];
  columnsPerRow?: number;
  measure?: Measure;
  text?: string;
  [key: string]: unknown;
}

export interface ViewSpec {
  specVersion: number;
  title: string;
  root: string | null;
  components: Record<string, Component>;
  queries: Record<string, Query>;
  [key: string]: unknown;
}

export const MAX_COMPONENTS = 60;
export const MAX_QUERIES = 40;
export const MAX_LIMIT = 500;
export const DEFAULT_LIMIT = 200;
const ID_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/;

export const emptySpec = (title = 'New view'): ViewSpec => ({
  specVersion: SPEC_VERSION,
  title,
  root: null,
  components: {},
  queries: {},
});

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const isStringArray = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((s) => typeof s === 'string');

const oneOf = <T extends string>(
  list: readonly T[],
  v: unknown,
  name: string,
  out: string[],
): void => {
  if (v !== undefined && !list.includes(v as T)) {
    out.push(`${name} must be one of ${list.join(', ')}`);
  }
};

const optionalBool = (v: unknown, name: string, out: string[]): void => {
  if (v !== undefined && typeof v !== 'boolean') {
    out.push(`${name} must be true or false`);
  }
};

const optionalNames = (v: unknown, name: string, out: string[]): void => {
  if (v !== undefined && !isStringArray(v)) {
    out.push(`${name} must be a list of names`);
  }
};

const optionalCount = (v: unknown, name: string, max: number, out: string[]): void => {
  if (
    v !== undefined &&
    (!Number.isInteger(v) || (v as number) < 1 || (v as number) > max)
  ) {
    out.push(`${name} must be a whole number from 1 to ${max}`);
  }
};

export const isValidId = (id: unknown): id is string =>
  typeof id === 'string' && ID_RE.test(id);

/** Problems with one query; fields this version does not know are allowed. */
export const validateQuery = (q: unknown): string[] => {
  const out: string[] = [];
  if (!isPlainObject(q)) {
    return ['a query must be an object'];
  }
  if (q.scope !== undefined && (typeof q.scope !== 'string' || !q.scope.trim())) {
    out.push('scope must be "@current", "all" or a project or tag name');
  }
  optionalBool(q.isDone, 'isDone', out);
  oneOf(DUE_TOKENS, q.due, 'due', out);
  oneOf(DONE_ON_TOKENS, q.doneOn, 'doneOn', out);
  optionalNames(q.tags, 'tags', out);
  oneOf(['all', 'any'] as const, q.tagsMatch, 'tagsMatch', out);
  optionalNames(q.notTags, 'notTags', out);
  if (q.priority !== undefined) {
    if (!Array.isArray(q.priority)) {
      out.push('priority must be a list');
    } else {
      q.priority.forEach((p) => oneOf(PRIORITY_NAMES, p, 'priority', out));
    }
  }
  optionalBool(q.hasEstimate, 'hasEstimate', out);
  optionalBool(q.parentsOnly, 'parentsOnly', out);
  optionalBool(q.includeArchived, 'includeArchived', out);
  if (q.text !== undefined && typeof q.text !== 'string') {
    out.push('text must be a string');
  }
  oneOf(SORT_KEYS, q.sort, 'sort', out);
  oneOf(['asc', 'desc'] as const, q.sortDir, 'sortDir', out);
  optionalCount(q.limit, 'limit', MAX_LIMIT, out);
  return out;
};

const validateColumn = (c: unknown, i: number, out: string[]): void => {
  if (!isPlainObject(c)) {
    out.push(`column ${i + 1} must be an object`);
    return;
  }
  if (!isValidId(c.id)) {
    out.push(`column ${i + 1} needs an id (letters, digits, - or _)`);
  }
  if (typeof c.title !== 'string') {
    out.push(`column ${i + 1} needs a title`);
  }
  optionalNames(c.tags, `column ${i + 1} tags`, out);
  optionalNames(c.notTags, `column ${i + 1} notTags`, out);
  optionalBool(c.isDone, `column ${i + 1} isDone`, out);
};

/**
 * Problems with one component. Unknown types are valid: a newer device may
 * have written them, and the renderer shows a placeholder.
 */
export const validateComponent = (c: unknown): string[] => {
  const out: string[] = [];
  if (!isPlainObject(c) || typeof c.type !== 'string' || !c.type) {
    return ['a component needs a type'];
  }
  if (c.title !== undefined && typeof c.title !== 'string') {
    out.push('title must be a string');
  }
  switch (c.type as KnownComponentType) {
    case 'stack':
    case 'columns':
      if (!Array.isArray(c.children) || !c.children.every(isValidId)) {
        out.push('children must be a list of component ids');
      }
      break;
    case 'taskList':
      if (!isValidId(c.query)) {
        out.push('query must be a query id');
      }
      if (c.fields !== undefined) {
        if (!Array.isArray(c.fields)) {
          out.push('fields must be a list');
        } else {
          c.fields.forEach((f) => oneOf(FIELD_NAMES, f, 'fields', out));
        }
      }
      oneOf(GROUP_BY, c.groupBy, 'groupBy', out);
      optionalCount(c.limit, 'limit', MAX_LIMIT, out);
      if (c.emptyText !== undefined && typeof c.emptyText !== 'string') {
        out.push('emptyText must be a string');
      }
      break;
    case 'board':
      if (!isValidId(c.query)) {
        out.push('query must be a query id');
      }
      if (!Array.isArray(c.columns) || c.columns.length === 0) {
        out.push('columns must be a non-empty list');
      } else {
        c.columns.forEach((col, i) => validateColumn(col, i, out));
        const ids = c.columns.map((col) => (isPlainObject(col) ? col.id : undefined));
        if (new Set(ids).size !== ids.length) {
          out.push('column ids must be unique');
        }
      }
      if (c.fields !== undefined) {
        if (!Array.isArray(c.fields)) {
          out.push('fields must be a list');
        } else {
          c.fields.forEach((f) => oneOf(FIELD_NAMES, f, 'fields', out));
        }
      }
      optionalCount(c.columnsPerRow, 'columnsPerRow', 6, out);
      break;
    case 'metric':
      if (!isValidId(c.query)) {
        out.push('query must be a query id');
      }
      if (!MEASURES.includes(c.measure as Measure)) {
        out.push(`measure must be one of ${MEASURES.join(', ')}`);
      }
      break;
    case 'text':
      if (typeof c.text !== 'string') {
        out.push('text must be a string');
      }
      break;
  }
  return out;
};

/** Ids referenced but not defined. Fine while streaming; reported to the model. */
export const findDanglingRefs = (spec: ViewSpec): string[] => {
  const out: string[] = [];
  if (spec.root && !spec.components[spec.root]) {
    out.push(`root "${spec.root}" is not a component`);
  }
  for (const [id, c] of Object.entries(spec.components)) {
    for (const child of Array.isArray(c.children) ? c.children : []) {
      if (!spec.components[child]) {
        out.push(`${id} lists child "${child}", which does not exist`);
      }
    }
    if (typeof c.query === 'string' && !spec.queries[c.query]) {
      out.push(`${id} uses query "${c.query}", which does not exist`);
    }
  }
  return out;
};

/** Validates a spec read from storage or another device. */
export const parseSpec = (raw: unknown): ViewSpec | null => {
  if (
    !isPlainObject(raw) ||
    typeof raw.specVersion !== 'number' ||
    !isPlainObject(raw.components) ||
    !isPlainObject(raw.queries)
  ) {
    return null;
  }
  return {
    ...raw,
    specVersion: raw.specVersion,
    title: typeof raw.title === 'string' && raw.title ? raw.title : 'Untitled view',
    root: typeof raw.root === 'string' ? raw.root : null,
    components: raw.components as Record<string, Component>,
    queries: raw.queries as Record<string, Query>,
  };
};

/** A spec from a newer version opens read-only rather than being rewritten. */
export const isReadOnlySpec = (spec: ViewSpec): boolean =>
  spec.specVersion > SPEC_VERSION;

// ---------- steps ----------

export const STEP_NAMES = [
  'put_component',
  'remove_component',
  'put_query',
  'remove_query',
  'set_view',
  'say',
] as const;
export type StepName = (typeof STEP_NAMES)[number];

export interface StepResult {
  spec: ViewSpec;
  error?: string;
  say?: string;
}

// JSON merge semantics on one level: a null value removes the field, arrays
// and objects are replaced whole.
const mergeProps = <T extends Record<string, unknown>>(
  base: T | undefined,
  props: Record<string, unknown>,
): Record<string, unknown> => {
  const next: Record<string, unknown> = { ...(base ?? {}) };
  for (const [key, value] of Object.entries(props)) {
    if (value === null) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
};

const fail = (spec: ViewSpec, error: string): StepResult => ({ spec, error });

/**
 * Applies one step to a spec and returns a new spec; the input is not changed.
 * A rejected step returns the input spec with an error for the model.
 */
export const applyStep = (spec: ViewSpec, name: string, input: unknown): StepResult => {
  if (!isPlainObject(input)) {
    return fail(spec, `${name}: input must be an object`);
  }
  switch (name as StepName) {
    case 'put_component': {
      const { id, props } = input;
      if (!isValidId(id)) {
        return fail(
          spec,
          'put_component: id must start with a letter and use letters, digits, - or _',
        );
      }
      if (!isPlainObject(props)) {
        return fail(spec, `put_component ${id}: props must be an object`);
      }
      const existing = spec.components[id];
      if (!existing && Object.keys(spec.components).length >= MAX_COMPONENTS) {
        return fail(
          spec,
          `put_component ${id}: a view holds at most ${MAX_COMPONENTS} components`,
        );
      }
      const merged = mergeProps(existing, props) as Component;
      const problems = validateComponent(merged);
      if (problems.length) {
        return fail(spec, `put_component ${id}: ${problems.join('; ')}`);
      }
      const children = merged.children ?? [];
      if (children.includes(id)) {
        return fail(spec, `put_component ${id}: a component cannot contain itself`);
      }
      return {
        spec: {
          ...spec,
          root: spec.root ?? id,
          components: { ...spec.components, [id]: merged },
        },
      };
    }
    case 'remove_component': {
      const { id } = input;
      if (typeof id !== 'string' || !spec.components[id]) {
        return fail(spec, `remove_component: no component "${String(id)}"`);
      }
      const components: Record<string, Component> = {};
      for (const [cid, c] of Object.entries(spec.components)) {
        if (cid === id) continue;
        components[cid] = Array.isArray(c.children)
          ? { ...c, children: c.children.filter((child) => child !== id) }
          : c;
      }
      return { spec: { ...spec, root: spec.root === id ? null : spec.root, components } };
    }
    case 'put_query': {
      const { id, props } = input;
      if (!isValidId(id)) {
        return fail(
          spec,
          'put_query: id must start with a letter and use letters, digits, - or _',
        );
      }
      if (!isPlainObject(props)) {
        return fail(spec, `put_query ${id}: props must be an object`);
      }
      if (!spec.queries[id] && Object.keys(spec.queries).length >= MAX_QUERIES) {
        return fail(spec, `put_query ${id}: a view holds at most ${MAX_QUERIES} queries`);
      }
      const merged = mergeProps(spec.queries[id], props) as Query;
      const problems = validateQuery(merged);
      if (problems.length) {
        return fail(spec, `put_query ${id}: ${problems.join('; ')}`);
      }
      return { spec: { ...spec, queries: { ...spec.queries, [id]: merged } } };
    }
    case 'remove_query': {
      const { id } = input;
      if (typeof id !== 'string' || !spec.queries[id]) {
        return fail(spec, `remove_query: no query "${String(id)}"`);
      }
      const queries = { ...spec.queries };
      delete queries[id];
      return { spec: { ...spec, queries } };
    }
    case 'set_view': {
      const { title, root } = input;
      if (title !== undefined && (typeof title !== 'string' || !title.trim())) {
        return fail(spec, 'set_view: title must be a non-empty string');
      }
      if (root !== undefined && (typeof root !== 'string' || !spec.components[root])) {
        return fail(spec, `set_view: root "${String(root)}" is not a component`);
      }
      return {
        spec: {
          ...spec,
          title: typeof title === 'string' ? title.trim().slice(0, 60) : spec.title,
          root: typeof root === 'string' ? root : spec.root,
        },
      };
    }
    case 'say': {
      const { text } = input;
      if (typeof text !== 'string' || !text.trim()) {
        return fail(spec, 'say: text must be a non-empty string');
      }
      return { spec, say: text.trim().slice(0, 300) };
    }
    default:
      return fail(spec, `unknown step "${name}"`);
  }
};

/** Makes a finished edit safe to save: drops child ids that point nowhere. */
export const finalizeSpec = (spec: ViewSpec): ViewSpec => {
  const components: Record<string, Component> = {};
  for (const [id, c] of Object.entries(spec.components)) {
    components[id] = Array.isArray(c.children)
      ? { ...c, children: c.children.filter((child) => !!spec.components[child]) }
      : c;
  }
  const root = spec.root && components[spec.root] ? spec.root : null;
  return { ...spec, root, components };
};
