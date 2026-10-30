import { applyStep, BoardColumn, Component, Query, StepResult, ViewSpec } from './spec';

// Ready-made views as pure spec builders. A recipe produces the same ordinary
// steps the model would, so it is checked by the same validator, can be changed
// afterwards with ordinary edits, and needs neither a key nor a model call.

export const RECIPE_NAMES = [
  'kanban',
  'eisenhower',
  'today-by-project',
  'weekly-review',
  'plan-my-week',
  'deadline-radar',
  'time-this-week',
  'focus',
  'overdue',
  'waiting',
] as const;
export type RecipeName = (typeof RECIPE_NAMES)[number];

export interface RecipeParams {
  /** A project or tag name, or "@current" or "all". */
  scope?: string;
  /** Only for "waiting": the tag that marks a task as waiting. */
  tag?: string;
}

type Step = { name: 'put_query' | 'put_component' | 'set_view'; input: object };

interface Recipe {
  /** Chip text. */
  label: string;
  /** One line for the model's prompt. */
  hint: string;
  /** What the person is told after a local apply. */
  said: string;
  defaultScope: string;
  steps: (scope: string, tag: string) => Step[];
}

const query = (id: string, props: Query): Step => ({
  name: 'put_query',
  input: { id, props },
});
const part = (id: string, props: Component): Step => ({
  name: 'put_component',
  input: { id, props },
});
const titled = (title: string): Step => ({ name: 'set_view', input: { title } });

const KANBAN_COLUMNS: BoardColumn[] = [
  { id: 'todo', title: 'To do', notTags: ['@doing'], isDone: false },
  { id: 'doing', title: 'Doing', tags: ['@doing'], isDone: false },
  { id: 'done', title: 'Done', isDone: true },
];

const MATRIX_COLUMNS: BoardColumn[] = [
  { id: 'do', title: 'Urgent and important', tags: ['@urgent', '@important'] },
  {
    id: 'plan',
    title: 'Important, not urgent',
    tags: ['@important'],
    notTags: ['@urgent'],
  },
  {
    id: 'delegate',
    title: 'Urgent, not important',
    tags: ['@urgent'],
    notTags: ['@important'],
  },
  { id: 'drop', title: 'Neither', notTags: ['@urgent', '@important'] },
];

export const RECIPES: Record<RecipeName, Recipe> = {
  kanban: {
    label: 'Kanban board',
    hint: "To do, Doing and Done columns; Doing is the app's in-progress tag.",
    said: 'Made a board with To do, Doing and Done; drag cards between them.',
    defaultScope: '@current',
    steps: (scope) => [
      query('open', { scope }),
      part('board', { type: 'board', query: 'open', columns: KANBAN_COLUMNS }),
      titled('Kanban board'),
    ],
  },
  eisenhower: {
    label: 'Eisenhower matrix',
    hint: 'Open tasks in four quadrants by urgent and important.',
    said: 'Made an Eisenhower matrix; drag tasks into a quadrant to tag them.',
    defaultScope: '@current',
    steps: (scope) => [
      query('open', { scope, isDone: false }),
      part('matrix', {
        type: 'board',
        query: 'open',
        columnsPerRow: 2,
        columns: MATRIX_COLUMNS,
      }),
      titled('Eisenhower matrix'),
    ],
  },
  'today-by-project': {
    label: 'Today, by project',
    hint: "Today's open tasks grouped by project, with the time tracked today.",
    said: "Made today's tasks grouped by project, with the time tracked today.",
    defaultScope: 'all',
    steps: (scope) => [
      query('all', { scope }),
      query('today', { scope, due: 'today', isDone: false }),
      part('main', { type: 'stack', children: ['time-today', 'list'] }),
      part('time-today', {
        type: 'metric',
        query: 'all',
        measure: 'timeSpentToday',
        title: 'Tracked today',
      }),
      part('list', {
        type: 'taskList',
        query: 'today',
        groupBy: 'project',
        emptyText: 'Nothing is due today.',
      }),
      titled('Today, by project'),
    ],
  },
  'weekly-review': {
    label: 'Weekly review',
    hint: 'Time this week and tasks finished this week, then what is overdue.',
    said: 'Made a weekly review: time, finished tasks and what is overdue.',
    defaultScope: 'all',
    steps: (scope) => [
      query('all', { scope }),
      query('done', { scope, doneOn: 'thisWeek' }),
      query('late', { scope, due: 'overdue', isDone: false, sort: 'due' }),
      part('main', { type: 'stack', children: ['stats', 'finished', 'overdue'] }),
      part('stats', { type: 'columns', children: ['time-week', 'done-count'] }),
      part('time-week', {
        type: 'metric',
        query: 'all',
        measure: 'timeSpentThisWeek',
        title: 'Time this week',
      }),
      part('done-count', {
        type: 'metric',
        query: 'done',
        measure: 'count',
        title: 'Done this week',
      }),
      part('finished', {
        type: 'taskList',
        query: 'done',
        groupBy: 'project',
        title: 'Finished this week',
        emptyText: 'Nothing finished yet this week.',
      }),
      part('overdue', {
        type: 'taskList',
        query: 'late',
        title: 'Overdue',
        emptyText: 'Nothing is overdue.',
      }),
      titled('Weekly review'),
    ],
  },
  'plan-my-week': {
    label: 'Plan my week',
    hint: 'The next 7 days as columns with the estimate per day, plus an overdue column.',
    said: 'Made a plan for the next 7 days, with what is overdue first.',
    defaultScope: 'all',
    steps: (scope) => [
      query('open', { scope, isDone: false }),
      part('week', {
        type: 'agenda',
        query: 'open',
        days: 7,
        showOverdue: true,
        title: 'Next 7 days',
      }),
      titled('Plan my week'),
    ],
  },
  'deadline-radar': {
    label: 'Deadline radar',
    hint: 'Open tasks that have a deadline, soonest first.',
    said: 'Made a list of open tasks with a deadline, soonest first.',
    defaultScope: 'all',
    steps: (scope) => [
      query('deadlines', {
        scope,
        isDone: false,
        hasDeadline: true,
        sort: 'deadline',
      }),
      part('radar', {
        type: 'taskList',
        query: 'deadlines',
        fields: ['project', 'tags', 'estimate', 'deadline'],
        emptyText: 'No deadlines ahead.',
      }),
      titled('Deadline radar'),
    ],
  },
  'time-this-week': {
    label: 'Time this week',
    hint: 'Tracked time this week in total, by project and by day.',
    said: 'Made a view of the time tracked this week, by project and by day.',
    defaultScope: 'all',
    steps: (scope) => [
      query('all', { scope }),
      part('main', { type: 'stack', children: ['total', 'by-project', 'by-day'] }),
      part('total', {
        type: 'metric',
        query: 'all',
        measure: 'timeSpentThisWeek',
        title: 'Time this week',
      }),
      part('by-project', {
        type: 'timeBreakdown',
        query: 'all',
        by: 'project',
        range: 'thisWeek',
        title: 'By project',
      }),
      part('by-day', {
        type: 'timeBreakdown',
        query: 'all',
        by: 'day',
        range: 'thisWeek',
        title: 'By day',
      }),
      titled('Time this week'),
    ],
  },
  focus: {
    label: 'Focus',
    hint: 'The three most important open tasks due today.',
    said: 'Made a short list of the three most important tasks due today.',
    defaultScope: 'all',
    steps: (scope) => [
      query('focus', {
        scope,
        due: 'today',
        isDone: false,
        sort: 'priority',
        limit: 3,
      }),
      part('focus', {
        type: 'taskList',
        query: 'focus',
        emptyText: 'Nothing is due today.',
      }),
      titled('Focus'),
    ],
  },
  overdue: {
    label: 'Overdue',
    hint: 'Open tasks past their due day, oldest first.',
    said: 'Made a list of overdue tasks, oldest first.',
    defaultScope: 'all',
    steps: (scope) => [
      query('late', { scope, due: 'overdue', isDone: false, sort: 'due' }),
      part('list', {
        type: 'taskList',
        query: 'late',
        emptyText: 'Nothing is overdue.',
      }),
      titled('Overdue'),
    ],
  },
  waiting: {
    label: 'Waiting',
    hint: 'Open tasks carrying one tag (params.tag, default "Waiting"), by project.',
    said: 'Made a list of the tasks that are waiting.',
    defaultScope: 'all',
    steps: (scope, tag) => [
      query('waiting', { scope, tags: [tag], isDone: false }),
      part('list', {
        type: 'taskList',
        query: 'waiting',
        groupBy: 'project',
        emptyText: 'Nothing is waiting.',
      }),
      titled(tag),
    ],
  },
};

export interface RecipeResult extends StepResult {
  /** What the recipe made, so a model that wants to adjust it knows the ids. */
  summary?: string;
}

const isRecipeName = (name: unknown): name is RecipeName =>
  typeof name === 'string' && (RECIPE_NAMES as readonly string[]).includes(name);

const paramText = (value: unknown, fallback: string): string =>
  typeof value === 'string' && value.trim() ? value.trim().slice(0, 60) : fallback;

const summarize = (spec: ViewSpec): string =>
  `The view "${spec.title}" now has components ${Object.entries(spec.components)
    .map(([id, c]) => `${id} (${c.type})`)
    .join(', ')} and queries ${Object.keys(spec.queries).join(', ')}.`;

/**
 * Replaces the whole view with a recipe. Anything else on the spec, including
 * fields from a newer version, is kept.
 */
export const applyRecipe = (spec: ViewSpec, input: unknown): RecipeResult => {
  const { name, params } = (input ?? {}) as { name?: unknown; params?: RecipeParams };
  if (!isRecipeName(name)) {
    return {
      spec,
      error: `use_recipe: name must be one of ${RECIPE_NAMES.join(', ')}`,
    };
  }
  const recipe = RECIPES[name];
  const steps = recipe.steps(
    paramText(params?.scope, recipe.defaultScope),
    paramText(params?.tag, 'Waiting'),
  );
  let next: ViewSpec = { ...spec, root: null, components: {}, queries: {} };
  for (const step of steps) {
    const result = applyStep(next, step.name, step.input);
    if (result.error) return { spec, error: `use_recipe ${name}: ${result.error}` };
    next = result.spec;
  }
  return { spec: next, summary: summarize(next) };
};

/** One tool call from the model: a recipe, or an ordinary step. */
export const applyToolCall = (
  spec: ViewSpec,
  name: string,
  input: unknown,
): RecipeResult =>
  name === 'use_recipe' ? applyRecipe(spec, input) : applyStep(spec, name, input);
