import { BoardCfg, BoardPanelCfg, BoardPanelCfgScheduledState } from './boards.model';
import {
  criteriaToPanelFields,
  getPanelSortKey,
  hasStaleDueState,
  isPanelUntagged,
  normalizeBoardForSave,
  withPanelSortKey,
} from './boards.util';
import { TaskSortKey } from '../tasks/task-criteria/task-criteria';
import {
  filterToCriteria,
  SORT_OPTION_TO_KEY,
} from '../task-view-customizer/filter-to-criteria';
import {
  DEFAULT_OPTIONS,
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FilterOption,
  OPTIONS,
  SORT_OPTION_TYPE,
  SORT_ORDER,
  SortOption,
} from '../task-view-customizer/types';

/**
 * The filter/sort menu on a list-layout view: what it shows and what a click
 * writes. Every click replaces the view's `panels` (one `updateBoard` op), so
 * the result goes through `normalizeBoardForSave` like the editor's.
 */

/** Filter types the menu edits on a view. The project text search stays list-only. */
export const VIEW_FILTER_TYPES: readonly FILTER_OPTION_TYPE[] = [
  FILTER_OPTION_TYPE.tag,
  FILTER_OPTION_TYPE.scheduledDate,
  FILTER_OPTION_TYPE.deadline,
  FILTER_OPTION_TYPE.estimatedTime,
  FILTER_OPTION_TYPE.timeSpent,
  FILTER_OPTION_TYPE.priority,
];

export interface ViewMenuState {
  /** The sort all panels share (`type: null` = manual order); `null` when they differ. */
  sort: SortOption | null;
  /** Per filter type, the rule all panels share; absent when none has one or they differ. */
  filters: Partial<Record<FILTER_OPTION_TYPE, FilterOption>>;
  /** Filter types whose rule differs per panel: the menu can't edit them. */
  differingFilterTypes: FILTER_OPTION_TYPE[];
}

export interface ViewMenuLookups {
  tags: readonly { id: string; title: string }[];
}

const sortedCopy = (ids: readonly string[] | undefined): string[] =>
  [...(ids ?? [])].sort();

/**
 * One string per panel and filter type that is equal exactly when the rules
 * are; `''` when the panel has no rule of that type. Tags include the
 * excluded tags: setting "untagged" clears them, so panels that differ there
 * must not be edited together.
 */
const getRuleKey = (panel: BoardPanelCfg, type: FILTER_OPTION_TYPE): string => {
  switch (type) {
    case FILTER_OPTION_TYPE.tag: {
      const included = sortedCopy(panel.includedTagIds);
      const excluded = sortedCopy(panel.excludedTagIds);
      const isUntagged = isPanelUntagged(panel);
      if (!isUntagged && !included.length && !excluded.length) {
        return '';
      }
      return JSON.stringify([
        isUntagged,
        included,
        // Match modes only matter for several tags.
        included.length > 1 ? (panel.includedTagsMatch ?? 'all') : '',
        excluded,
        excluded.length > 1 ? (panel.excludedTagsMatch ?? 'any') : '',
      ]);
    }
    case FILTER_OPTION_TYPE.scheduledDate:
      if (panel.dueState && !hasStaleDueState(panel)) return `due:${panel.dueState}`;
      if (panel.scheduledState === BoardPanelCfgScheduledState.NotScheduled) {
        return 'unscheduled';
      }
      return panel.scheduledState === BoardPanelCfgScheduledState.Scheduled
        ? 'scheduled'
        : '';
    case FILTER_OPTION_TYPE.deadline:
      return panel.deadlineState ?? '';
    case FILTER_OPTION_TYPE.estimatedTime:
      return panel.estimateRule ?? '';
    case FILTER_OPTION_TYPE.timeSpent:
      return panel.timeSpentRule ?? '';
    case FILTER_OPTION_TYPE.priority:
      return panel.priorityRule ?? '';
    default:
      return '';
  }
};

const toPreset = (value: string): string =>
  value === 'none' ? FILTER_COMMON.NOT_SPECIFIED : value;

/**
 * A panel's rule as the menu's filter option. A rule without a menu preset
 * (planned date "overdue", an unknown value from a newer client) keeps its
 * raw value as `preset`: the type shows as set, no preset as checked.
 */
const getPanelFilter = (
  panel: BoardPanelCfg,
  type: FILTER_OPTION_TYPE,
): FilterOption | undefined => {
  const option = OPTIONS.filter.list.find((opt) => opt.type === type);
  if (!option) return undefined;
  switch (type) {
    case FILTER_OPTION_TYPE.tag:
      if (isPanelUntagged(panel)) {
        return { ...option, preset: FILTER_COMMON.NOT_SPECIFIED };
      }
      return panel.includedTagIds?.length
        ? {
            ...option,
            preset: null,
            tagIds: [...panel.includedTagIds],
            tagFilterMode: panel.includedTagsMatch === 'any' ? 'OR' : 'AND',
          }
        : undefined;
    case FILTER_OPTION_TYPE.scheduledDate: {
      const key = getRuleKey(panel, type);
      if (!key) return undefined;
      const preset =
        key === 'unscheduled'
          ? FILTER_COMMON.NOT_SPECIFIED
          : key.startsWith('due:')
            ? toPreset(key.slice('due:'.length))
            : key;
      return { ...option, preset };
    }
    default: {
      const value = getRuleKey(panel, type);
      return value ? { ...option, preset: toPreset(value) } : undefined;
    }
  }
};

const getPanelSort = (
  panel: BoardPanelCfg,
): { key: string | null; dir: SORT_ORDER | null } => {
  const key = getPanelSortKey(panel) ?? panel.sortKey ?? null;
  return {
    key,
    dir: key ? (panel.sortDir === 'desc' ? SORT_ORDER.DESC : SORT_ORDER.ASC) : null,
  };
};

const SORT_TYPE_BY_KEY = new Map<string, SORT_OPTION_TYPE>(
  (Object.keys(SORT_OPTION_TO_KEY) as SORT_OPTION_TYPE[]).map((type) => [
    SORT_OPTION_TO_KEY[type],
    type,
  ]),
);

const getSortState = (panels: readonly BoardPanelCfg[]): SortOption | null => {
  const sorts = panels.map(getPanelSort);
  const first = sorts[0] ?? { key: null, dir: null };
  if (sorts.some((sort) => sort.key !== first.key || sort.dir !== first.dir)) {
    return null;
  }
  if (!first.key) return DEFAULT_OPTIONS.sort;
  const type = SORT_TYPE_BY_KEY.get(first.key);
  const option = type && OPTIONS.sort.list.find((opt) => opt.type === type);
  return option ? { ...option, order: first.dir ?? SORT_ORDER.ASC } : null;
};

/** What the menu shows for `board`: the sort and filters all its panels share. */
export const getViewMenuState = (board: Pick<BoardCfg, 'panels'>): ViewMenuState => {
  const filters: Partial<Record<FILTER_OPTION_TYPE, FilterOption>> = {};
  const differingFilterTypes: FILTER_OPTION_TYPE[] = [];
  const [first] = board.panels;
  for (const type of VIEW_FILTER_TYPES) {
    if (!first) break;
    const key = getRuleKey(first, type);
    if (board.panels.some((panel) => getRuleKey(panel, type) !== key)) {
      differingFilterTypes.push(type);
      continue;
    }
    const filter = getPanelFilter(first, type);
    if (filter) filters[type] = filter;
  }
  return { sort: getSortState(board.panels), filters, differingFilterTypes };
};

/** The panel without its rule of `type`. Cleared rules are deleted keys. */
const clearRule = (panel: BoardPanelCfg, type: FILTER_OPTION_TYPE): BoardPanelCfg => {
  const out: BoardPanelCfg = { ...panel };
  switch (type) {
    case FILTER_OPTION_TYPE.tag:
      out.includedTagIds = [];
      delete out.includedTagsMatch;
      delete out.isUntagged;
      break;
    case FILTER_OPTION_TYPE.scheduledDate:
      delete out.dueState;
      out.scheduledState = BoardPanelCfgScheduledState.All;
      break;
    case FILTER_OPTION_TYPE.deadline:
      delete out.deadlineState;
      break;
    case FILTER_OPTION_TYPE.estimatedTime:
      delete out.estimateRule;
      break;
    case FILTER_OPTION_TYPE.timeSpent:
      delete out.timeSpentRule;
      break;
    case FILTER_OPTION_TYPE.priority:
      delete out.priorityRule;
      break;
  }
  return out;
};

/**
 * Stores panels like the editor does. `normalizeBoardForSave` reads the sort
 * from the form's `sortKey`, so it is filled from the stored fields first;
 * an unknown key from a newer client is kept.
 */
const normalizePanels = (
  board: BoardCfg,
  panels: readonly BoardPanelCfg[],
): BoardPanelCfg[] =>
  normalizeBoardForSave({
    ...board,
    panels: panels.map((panel) => {
      const sortKey = getPanelSortKey(panel) ?? panel.sortKey;
      const out: BoardPanelCfg = { ...panel };
      if (sortKey) {
        out.sortKey = sortKey;
      } else {
        delete out.sortKey;
      }
      return out;
    }),
  }).panels;

/**
 * The view's panels with `sort` on all of them. Picking the sort they already
 * share flips its direction, as in a list; the default sort is manual order.
 */
export const getPanelsWithViewSort = (
  board: BoardCfg,
  sort: SortOption,
): BoardPanelCfg[] => {
  const current = getSortState(board.panels);
  const key: TaskSortKey | undefined = sort.type
    ? SORT_OPTION_TO_KEY[sort.type]
    : undefined;
  const order =
    key && current?.type === sort.type
      ? current.order === SORT_ORDER.DESC
        ? SORT_ORDER.ASC
        : SORT_ORDER.DESC
      : (sort.order ?? SORT_ORDER.ASC);
  return normalizePanels(
    board,
    board.panels.map((panel) => {
      const out = withPanelSortKey(panel, key);
      if (key) {
        out.sortDir = order === SORT_ORDER.DESC ? 'desc' : 'asc';
      } else {
        delete out.sortDir;
      }
      return out;
    }),
  );
};

/**
 * The view's panels with the rule of `type` set to `filter` on all of them
 * (`null` clears it), other rules untouched. `null` when the panels differ
 * for that type: the menu can't edit it then.
 */
export const getPanelsWithViewFilter = (
  board: BoardCfg,
  type: FILTER_OPTION_TYPE,
  filter: FilterOption | null,
  lookups: ViewMenuLookups,
): BoardPanelCfg[] | null => {
  if (
    !VIEW_FILTER_TYPES.includes(type) ||
    getViewMenuState(board).differingFilterTypes.includes(type)
  ) {
    return null;
  }
  const criteria = filter
    ? filterToCriteria({ ...filter, type }, { tags: lookups.tags, projects: [] })
    : null;
  const fields = criteria && !criteria.isNoMatch ? criteriaToPanelFields(criteria) : {};
  return normalizePanels(
    board,
    board.panels.map((panel) => {
      const out: BoardPanelCfg = { ...clearRule(panel, type), ...fields };
      // Each panel gets its own arrays.
      if (fields.includedTagIds) out.includedTagIds = [...fields.includedTagIds];
      return out;
    }),
  );
};

/**
 * A preset click: sets that preset for `type` on all panels, or clears the
 * rule when the preset is already the checked one.
 */
export const getPanelsWithViewFilterPreset = (
  board: BoardCfg,
  type: FILTER_OPTION_TYPE,
  preset: string,
  lookups: ViewMenuLookups,
): BoardPanelCfg[] | null => {
  const current = getViewMenuState(board).filters[type];
  const option = OPTIONS.filter.list.find((opt) => opt.type === type);
  if (!option) return null;
  return getPanelsWithViewFilter(
    board,
    type,
    current?.preset === preset ? null : { ...option, preset },
    lookups,
  );
};
