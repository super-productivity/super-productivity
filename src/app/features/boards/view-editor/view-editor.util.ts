import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgScheduledState,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards.model';
import {
  hasStaleDueState,
  isAllProjects,
  isPanelUntagged,
  normalizeBoardForSave,
  toEditorModel,
} from '../boards.util';
import { deepEqual } from '@sp/sync-core';
import { T } from '../../../t.const';
import { TASK_DATE_RULES } from '../../tasks/task-criteria/task-criteria.model';

/**
 * The view editor's rules: which a stored panel has set, what adding or
 * removing one writes, and how a select shows a stored value. Everything works
 * on the editor model (`toEditorModel`), only ever overwriting the fields the
 * user changed, so values this client doesn't know survive.
 */

export type ViewRuleId =
  | 'project'
  | 'backlog'
  | 'includedTags'
  | 'excludedTags'
  | 'untagged'
  | 'plannedDate'
  | 'deadline'
  | 'done'
  | 'parentOnly'
  | 'priority'
  | 'estimate'
  | 'timeSpent';

/** The Add-rule menu's groups (Where, Tags, When, Status, Effort), in order. */
export const VIEW_RULE_GROUPS: readonly (readonly ViewRuleId[])[] = [
  ['project', 'backlog'],
  ['includedTags', 'excludedTags', 'untagged'],
  ['plannedDate', 'deadline'],
  ['done', 'parentOnly'],
  ['priority', 'estimate', 'timeSpent'],
];
export const VIEW_RULE_ORDER: readonly ViewRuleId[] = VIEW_RULE_GROUPS.flat();

/** Rule labels, in the filter menu's wording where it has one. */
export const VIEW_RULE_LABELS: Record<ViewRuleId, string> = {
  project: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PROJECT,
  backlog: T.F.BOARDS.EDITOR.RULE_BACKLOG,
  includedTags: T.F.BOARDS.FORM.TAGS_REQUIRED,
  excludedTags: T.F.BOARDS.FORM.TAGS_EXCLUDED,
  untagged: T.F.BOARDS.EDITOR.RULE_UNTAGGED,
  plannedDate: T.F.TASK_VIEW.CUSTOMIZER.FILTER_SCHEDULED_DATE,
  deadline: T.F.TASK_VIEW.CUSTOMIZER.FILTER_DEADLINE,
  done: T.F.BOARDS.EDITOR.RULE_DONE,
  parentOnly: T.F.BOARDS.FORM.ONLY_PARENT_TASKS,
  priority: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PRIORITY,
  estimate: T.F.TASK_VIEW.CUSTOMIZER.FILTER_ESTIMATED_TIME,
  timeSpent: T.F.TASK_VIEW.CUSTOMIZER.FILTER_TIME_SPENT,
};

/** Shown for a stored value this client doesn't know; saved unchanged. */
export const OTHER_VALUE = '__other__';

export type RuleValue = string | number;
export interface RuleOption {
  value: RuleValue;
  label: string;
}

/** Rules with a select. The others have no control or their own. */
export type SelectRuleId = Exclude<
  ViewRuleId,
  'project' | 'includedTags' | 'excludedTags' | 'untagged' | 'parentOnly'
>;

const DATE_RULE_OPTIONS: RuleOption[] = [
  { value: 'overdue', label: T.F.BOARDS.FORM.DUE_STATE_OVERDUE },
  { value: 'todayOrOverdue', label: T.F.BOARDS.FORM.DUE_STATE_TODAY_OR_OVERDUE },
  { value: 'today', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_TODAY },
  { value: 'tomorrow', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_TOMORROW },
  { value: 'next7Days', label: T.F.BOARDS.FORM.DUE_STATE_NEXT_7_DAYS },
  { value: 'thisWeek', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_THIS_WEEK },
  { value: 'nextWeek', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_NEXT_WEEK },
  { value: 'thisMonth', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_THIS_MONTH },
  { value: 'nextMonth', label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_NEXT_MONTH },
];

const AMOUNT_RULE_OPTIONS: RuleOption[] = [
  { value: 'none', label: T.F.BOARDS.FORM.RULE_NOT_SET },
  { value: '600000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_10MIN },
  { value: '1800000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_30MIN },
  { value: '3600000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_1HOUR },
  { value: '7200000', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_2HOUR },
];

/** The planned-date select's own values next to the date rules. */
export const PLANNED_HAS_DATE = 'scheduled';
export const PLANNED_NO_DATE = 'unscheduled';

export const VIEW_RULE_OPTIONS: Record<SelectRuleId, readonly RuleOption[]> = {
  backlog: [
    {
      value: BoardPanelCfgTaskTypeFilter.NoBacklog,
      label: T.F.BOARDS.EDITOR.BACKLOG_EXCLUDE,
    },
    {
      value: BoardPanelCfgTaskTypeFilter.OnlyBacklog,
      label: T.F.BOARDS.FORM.BACKLOG_TASK_FILTER_ONLY_BACKLOG,
    },
  ],
  plannedDate: [
    { value: PLANNED_HAS_DATE, label: T.F.BOARDS.EDITOR.PLANNED_HAS_DATE },
    { value: PLANNED_NO_DATE, label: T.F.BOARDS.EDITOR.PLANNED_NO_DATE },
    ...DATE_RULE_OPTIONS,
  ],
  deadline: [
    { value: 'none', label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_DEADLINE_NONE },
    ...DATE_RULE_OPTIONS,
  ],
  done: [
    {
      value: BoardPanelCfgTaskDoneState.UnDone,
      label: T.F.BOARDS.FORM.TASK_DONE_STATE_UNDONE,
    },
    {
      value: BoardPanelCfgTaskDoneState.Done,
      label: T.F.BOARDS.FORM.TASK_DONE_STATE_DONE,
    },
  ],
  priority: [
    { value: '3', label: T.F.TASK.CMP.PRIORITY_HIGH },
    { value: '2', label: T.F.TASK.CMP.PRIORITY_MEDIUM },
    { value: '1', label: T.F.TASK.CMP.PRIORITY_LOW },
    { value: 'none', label: T.F.BOARDS.FORM.RULE_NOT_SET },
  ],
  estimate: AMOUNT_RULE_OPTIONS,
  timeSpent: AMOUNT_RULE_OPTIONS,
};

/** The sort select's manual order (a select can't show a `null` option). */
export const SORT_MANUAL = 'manual';

export const SORT_OPTIONS: readonly { value: string; label: string }[] = [
  { value: SORT_MANUAL, label: T.F.BOARDS.FORM.SORT_BY_MANUAL },
  { value: 'plannedDate', label: T.F.TASK_VIEW.CUSTOMIZER.SORT_SCHEDULED_DATE },
  { value: 'deadline', label: T.F.TASK_VIEW.CUSTOMIZER.SORT_DEADLINE },
  { value: 'created', label: T.F.BOARDS.FORM.SORT_BY_CREATED },
  { value: 'title', label: T.F.BOARDS.FORM.SORT_BY_TITLE },
  { value: 'estimate', label: T.F.BOARDS.FORM.SORT_BY_TIME_ESTIMATE },
  { value: 'timeSpent', label: T.F.TASK_VIEW.CUSTOMIZER.TIME_SPENT },
  { value: 'priority', label: T.F.TASK_VIEW.CUSTOMIZER.SORT_PRIORITY },
  { value: 'tag', label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_TAG },
];

const isSetString = (value: unknown): boolean =>
  typeof value === 'string' && value !== '';

/** Whether the stored panel has the rule, from its values. */
export const isRuleSet = (panel: BoardPanelCfg, rule: ViewRuleId): boolean => {
  switch (rule) {
    case 'project':
      return (
        !isAllProjects(panel.projectIds) && (panel.projectIds ?? []).some((id) => !!id)
      );
    case 'backlog':
      return (
        panel.backlogState !== undefined &&
        panel.backlogState !== BoardPanelCfgTaskTypeFilter.All
      );
    case 'includedTags':
      return (panel.includedTagIds ?? []).length > 0;
    case 'excludedTags':
      return (panel.excludedTagIds ?? []).length > 0;
    case 'untagged':
      return isPanelUntagged(panel);
    case 'plannedDate':
      return (
        isSetString(panel.dueState) ||
        (panel.scheduledState !== undefined &&
          panel.scheduledState !== BoardPanelCfgScheduledState.All)
      );
    case 'deadline':
      return isSetString(panel.deadlineState);
    case 'done':
      return (
        panel.taskDoneState !== undefined &&
        panel.taskDoneState !== BoardPanelCfgTaskDoneState.All
      );
    case 'parentOnly':
      return panel.isParentTasksOnly === true;
    case 'priority':
      return isSetString(panel.priorityRule);
    case 'estimate':
      return isSetString(panel.estimateRule);
    case 'timeSpent':
      return isSetString(panel.timeSpentRule);
  }
};

/** The rules the stored panel has set, in menu order. */
export const getSetRules = (panel: BoardPanelCfg): ViewRuleId[] =>
  VIEW_RULE_ORDER.filter((rule) => isRuleSet(panel, rule));

const TAG_RULES: ReadonlySet<ViewRuleId> = new Set(['includedTags', 'excludedTags']);

/**
 * The rules the Add-rule menu offers: those not shown yet. "Without tags" and
 * the tag rules hide each other there (only there: a stored panel with both
 * shows both).
 */
export const getAddableRuleGroups = (shown: readonly ViewRuleId[]): ViewRuleId[][] => {
  const isShown = new Set(shown);
  const hasTagRule = shown.some((rule) => TAG_RULES.has(rule));
  return VIEW_RULE_GROUPS.map((group) =>
    group.filter(
      (rule) =>
        !isShown.has(rule) &&
        !(rule === 'untagged' && hasTagRule) &&
        !(TAG_RULES.has(rule) && isShown.has('untagged')),
    ),
  ).filter((group) => group.length > 0);
};

/** The value a rule gets when it is added (the first useful option). */
const RULE_DEFAULTS: Partial<Record<ViewRuleId, RuleValue | true>> = {
  backlog: BoardPanelCfgTaskTypeFilter.NoBacklog,
  untagged: true,
  plannedDate: 'today',
  deadline: 'today',
  done: BoardPanelCfgTaskDoneState.UnDone,
  parentOnly: true,
  priority: '3',
  estimate: 'none',
  timeSpent: 'none',
};

/**
 * Adds a rule with its default. Project and tags start empty (the editor opens
 * their control); left empty, they save as no rule.
 */
export const withRuleAdded = (panel: BoardPanelCfg, rule: ViewRuleId): BoardPanelCfg => {
  const value = RULE_DEFAULTS[rule];
  if (value === undefined) {
    return panel;
  }
  if (rule === 'untagged') {
    return { ...panel, isUntagged: true };
  }
  if (rule === 'parentOnly') {
    return { ...panel, isParentTasksOnly: true };
  }
  return withRuleValue(panel, rule as SelectRuleId, value as RuleValue);
};

const without = <K extends keyof BoardPanelCfg>(
  panel: BoardPanelCfg,
  ...keys: K[]
): BoardPanelCfg => {
  const out = { ...panel };
  for (const key of keys) {
    delete out[key];
  }
  return out;
};

/**
 * Removes a rule: optional fields are deleted, required ones go to their
 * default. Never `null` or `undefined`, which an op would carry to released
 * clients.
 */
export const withoutRule = (panel: BoardPanelCfg, rule: ViewRuleId): BoardPanelCfg => {
  switch (rule) {
    case 'project':
      return { ...panel, projectIds: [''] };
    case 'backlog':
      return { ...panel, backlogState: BoardPanelCfgTaskTypeFilter.All };
    case 'includedTags':
      return { ...without(panel, 'includedTagsMatch'), includedTagIds: [] };
    case 'excludedTags':
      return { ...without(panel, 'excludedTagsMatch'), excludedTagIds: [] };
    case 'untagged':
      return without(panel, 'isUntagged');
    case 'plannedDate':
      return {
        ...without(panel, 'dueState'),
        scheduledState: BoardPanelCfgScheduledState.All,
      };
    case 'deadline':
      return without(panel, 'deadlineState');
    case 'done':
      return { ...panel, taskDoneState: BoardPanelCfgTaskDoneState.All };
    case 'parentOnly':
      return { ...panel, isParentTasksOnly: false };
    case 'priority':
      return without(panel, 'priorityRule');
    case 'estimate':
      return without(panel, 'estimateRule');
    case 'timeSpent':
      return without(panel, 'timeSpentRule');
  }
};

const isKnownDateRule = (value: string): boolean =>
  (TASK_DATE_RULES as readonly string[]).includes(value);

/**
 * What the planned-date select shows for `dueState` + `scheduledState`: a
 * known date rule, else "Has a date" / "No date" from the scheduled state,
 * `OTHER_VALUE` for a value this client doesn't know, `null` for no rule.
 */
export const getPlannedDateChoice = (panel: BoardPanelCfg): string | null => {
  if (isSetString(panel.dueState) && !hasStaleDueState(panel)) {
    const dueState = panel.dueState as string;
    if (dueState === 'none') return PLANNED_NO_DATE;
    return isKnownDateRule(dueState) ? dueState : OTHER_VALUE;
  }
  switch (panel.scheduledState) {
    case BoardPanelCfgScheduledState.Scheduled:
      return PLANNED_HAS_DATE;
    case BoardPanelCfgScheduledState.NotScheduled:
      return PLANNED_NO_DATE;
    case BoardPanelCfgScheduledState.All:
    case undefined:
      return null;
    default:
      return OTHER_VALUE;
  }
};

/**
 * Writes the planned-date select (only called when the user changes it):
 * "Has a date" and "No date" are scheduled states without a date rule; a date
 * rule is `dueState` (normalize adds the "scheduled" it implies).
 */
export const withPlannedDateChoice = (
  panel: BoardPanelCfg,
  choice: string | null,
): BoardPanelCfg => {
  if (choice === OTHER_VALUE) {
    return panel;
  }
  if (choice === PLANNED_HAS_DATE) {
    return {
      ...without(panel, 'dueState'),
      scheduledState: BoardPanelCfgScheduledState.Scheduled,
    };
  }
  if (choice === PLANNED_NO_DATE) {
    return {
      ...without(panel, 'dueState'),
      scheduledState: BoardPanelCfgScheduledState.NotScheduled,
    };
  }
  if (choice && isKnownDateRule(choice)) {
    return { ...panel, dueState: choice };
  }
  return withoutRule(panel, 'plannedDate');
};

const isOption = (rule: SelectRuleId, value: unknown): boolean =>
  VIEW_RULE_OPTIONS[rule].some((option) => option.value === value);

/** The select value for a rule; `OTHER_VALUE` for a value it can't show. */
export const getRuleValue = (panel: BoardPanelCfg, rule: SelectRuleId): RuleValue => {
  const value = ((): unknown => {
    switch (rule) {
      case 'backlog':
        return panel.backlogState;
      case 'plannedDate':
        return getPlannedDateChoice(panel);
      case 'deadline':
        return panel.deadlineState;
      case 'done':
        return panel.taskDoneState;
      case 'priority':
        return panel.priorityRule;
      case 'estimate':
        return panel.estimateRule;
      case 'timeSpent':
        return panel.timeSpentRule;
    }
  })();
  return isOption(rule, value) ? (value as RuleValue) : OTHER_VALUE;
};

/** Writes a rule's select value; `OTHER_VALUE` keeps the stored one. */
export const withRuleValue = (
  panel: BoardPanelCfg,
  rule: SelectRuleId,
  value: RuleValue,
): BoardPanelCfg => {
  if (value === OTHER_VALUE || !isOption(rule, value)) {
    return panel;
  }
  switch (rule) {
    case 'backlog':
      return { ...panel, backlogState: value as BoardPanelCfgTaskTypeFilter };
    case 'plannedDate':
      return withPlannedDateChoice(panel, value as string);
    case 'deadline':
      return { ...panel, deadlineState: value as string };
    case 'done':
      return { ...panel, taskDoneState: value as BoardPanelCfgTaskDoneState };
    case 'priority':
      return { ...panel, priorityRule: value as string };
    case 'estimate':
      return { ...panel, estimateRule: value as string };
    case 'timeSpent':
      return { ...panel, timeSpentRule: value as string };
  }
};

/** The sort select's value: `SORT_MANUAL`, a key, or `OTHER_VALUE` for an unknown key. */
export const getSortValue = (panel: BoardPanelCfg): string => {
  if (!isSetString(panel.sortKey)) return SORT_MANUAL;
  return SORT_OPTIONS.some((option) => option.value === panel.sortKey)
    ? (panel.sortKey as string)
    : OTHER_VALUE;
};

/** Sets the sort key of the editor model (normalize stores it); manual drops the direction. */
export const withSortValue = (panel: BoardPanelCfg, value: string): BoardPanelCfg => {
  if (value === OTHER_VALUE) return panel;
  if (value === SORT_MANUAL || !value) return without(panel, 'sortKey', 'sortDir');
  return { ...panel, sortKey: value };
};

type Translate = (key: string) => string;

/** What the rule summary names projects and tags by. */
export interface RuleSummaryCtx {
  projects: readonly { id: string; title: string }[];
  tags: readonly { id: string; title: string }[];
}

/**
 * One line for a collapsed section: each set rule as `Label: value` (option
 * labels; project and tag titles, the label alone when none is known; the
 * label alone for rules without a value), joined by " · ", or "Every task".
 */
export const getRuleSummary = (
  panel: BoardPanelCfg,
  ctx: RuleSummaryCtx,
  translate: Translate,
): string => {
  const titled = (
    label: string,
    ids: readonly string[] | undefined,
    all: RuleSummaryCtx['tags'],
  ): string => {
    const titles = (ids ?? [])
      .map((id) => all.find((item) => item.id === id)?.title)
      .filter((title): title is string => !!title);
    return titles.length ? `${label}: ${titles.join(', ')}` : label;
  };
  const parts = getSetRules(panel).map((rule) => {
    const label = translate(VIEW_RULE_LABELS[rule]);
    switch (rule) {
      case 'project':
        return titled(label, panel.projectIds, ctx.projects);
      case 'includedTags':
        return titled(label, panel.includedTagIds, ctx.tags);
      case 'excludedTags':
        return titled(label, panel.excludedTagIds, ctx.tags);
      case 'untagged':
      case 'parentOnly':
        return label;
      default: {
        const value = getRuleValue(panel, rule);
        const option = VIEW_RULE_OPTIONS[rule].find((o) => o.value === value);
        return `${label}: ${translate(option?.label ?? T.F.BOARDS.EDITOR.OTHER_KEPT)}`;
      }
    }
  });
  return parts.length ? parts.join(' · ') : translate(T.F.BOARDS.EDITOR.EVERY_TASK);
};

/**
 * The editor model with titles as shown: default views are titled with
 * translation keys, which the inputs show translated.
 */
export const toEditorDisplayModel = (board: BoardCfg, translate: Translate): BoardCfg => {
  const model = toEditorModel(board);
  return {
    ...model,
    title: model.title ? translate(model.title) : model.title,
    panels: model.panels.map((panel) => ({
      ...panel,
      title: panel.title ? translate(panel.title) : panel.title,
    })),
  };
};

/**
 * A title as stored: the text, unless it still equals the translation of the
 * stored key, which then stays (translated on every client and language).
 */
export const toStoredTitle = (
  text: string,
  storedTitle: string | undefined,
  translate: Translate,
): string => (storedTitle && text === translate(storedTitle) ? storedTitle : text);

/** Whether a view shows its section titles (a board, or a list with several). */
export const isSectionTitleShown = (board: Pick<BoardCfg, 'cols' | 'panels'>): boolean =>
  board.cols > 1 || board.panels.length > 1;

/**
 * What the editor stores: titles back to their keys where unchanged, the
 * hidden title of a single-section list following the view's title, then
 * `normalizeBoardForSave`. Untouched, that is
 * `normalizeBoardForSave(toEditorModel(stored))`.
 */
export const toSavedBoard = (
  model: BoardCfg,
  stored: BoardCfg,
  translate: Translate,
): BoardCfg => {
  const storedPanels = new Map(stored.panels.map((panel) => [panel.id, panel]));
  const title = toStoredTitle(model.title, stored.title, translate);
  let panels = model.panels.map((panel) => ({
    ...panel,
    title: toStoredTitle(panel.title, storedPanels.get(panel.id)?.title, translate),
  }));
  if (!isSectionTitleShown(model) && panels.length === 1) {
    // Released clients show it as the card header, so a rename follows. A
    // title of its own (save as view, released clients) is kept.
    const sectionTitle = panels[0].title;
    if (
      !sectionTitle ||
      (!!stored.title &&
        (sectionTitle === stored.title || sectionTitle === translate(stored.title)))
    ) {
      panels = [{ ...panels[0], title }];
    }
  }
  return normalizeBoardForSave({ ...model, title, panels });
};

/**
 * What saving `saved` changes: only the fields that differ from `opened`, what
 * an untouched save of the board the editor opened stores, so a field synced
 * in meanwhile that the editor didn't touch stays. Changed panels keep the task order they have now, not the one the
 * editor opened with (a reorder synced in while it was open). Null when the
 * save changes nothing.
 */
export const getViewUpdates = (
  opened: BoardCfg,
  saved: BoardCfg,
  current: BoardCfg | undefined,
): Partial<BoardCfg> | null => {
  const updates: Partial<BoardCfg> = {};
  let isChanged = false;
  for (const key of Object.keys(saved) as (keyof BoardCfg)[]) {
    if (!deepEqual(saved[key], opened[key])) {
      (updates as Record<string, unknown>)[key] = saved[key];
      isChanged = true;
    }
  }
  if (!isChanged) {
    return null;
  }
  if (updates.panels && current) {
    const currentTaskIds = new Map(
      current.panels.map((panel) => [panel.id, panel.taskIds]),
    );
    updates.panels = updates.panels.map((panel) => {
      const taskIds = currentTaskIds.get(panel.id);
      return taskIds ? { ...panel, taskIds } : panel;
    });
  }
  return updates;
};
