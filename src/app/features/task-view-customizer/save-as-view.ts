import { nanoid } from 'nanoid';
import {
  BoardCfg,
  BoardPanelCfg,
  BoardPanelCfgTaskDoneState,
  BoardPanelCfgTaskTypeFilter,
} from '../boards/boards.model';
import { DEFAULT_PANEL_CFG } from '../boards/boards.const';
import { criteriaToPanelFields, withPanelSortKey } from '../boards/boards.util';
import { TODAY_TAG } from '../tag/tag.const';
import { WorkContextType } from '../work-context/work-context.model';
import { filterToCriteria, SORT_OPTION_TO_KEY } from './filter-to-criteria';
import { FilterOption, SORT_ORDER, SortOption } from './types';

export interface ViewSourceList {
  type: WorkContextType;
  id: string;
  title: string;
  /** The list's manual order, used when no sort is active. */
  taskIds: string[];
}

/**
 * A one-column view (board) showing what a task list shows with its current
 * filter and sort: the project's or tag's undone tasks, or for Today the
 * tasks due today or overdue. Grouping is not carried over (columns don't
 * group); the dialog says so.
 */
export const buildViewFromList = (opts: {
  list: ViewSourceList;
  filter: FilterOption;
  sort: SortOption;
  tags: readonly { id: string; title: string }[];
  projects: readonly { id: string; title: string }[];
}): BoardCfg => {
  const { list } = opts;
  const isToday = list.type === WorkContextType.TAG && list.id === TODAY_TAG.id;
  let panel: BoardPanelCfg = {
    ...DEFAULT_PANEL_CFG,
    id: nanoid(),
    title: list.title,
    taskDoneState: BoardPanelCfgTaskDoneState.UnDone,
    // Project and tag lists show parent tasks with their subtasks; Today also
    // lists subtasks whose parent isn't due today.
    isParentTasksOnly: !isToday,
  };
  if (isToday) {
    panel.dueState = 'todayOrOverdue';
  } else if (list.type === WorkContextType.PROJECT) {
    panel.projectIds = [list.id];
    panel.backlogState = BoardPanelCfgTaskTypeFilter.NoBacklog;
  } else {
    panel.includedTagIds = [list.id];
  }

  const criteria = filterToCriteria(opts.filter, {
    tags: opts.tags,
    projects: opts.projects,
  });
  if (criteria) {
    const fields = criteriaToPanelFields(criteria);
    // The list's own tag stays required next to filter tags, unless the
    // filter wants any of several tags (one column can't say "T and (A or B)").
    const isAnyOfSeveral =
      fields.includedTagsMatch === 'any' && (fields.includedTagIds?.length ?? 0) > 1;
    if (fields.includedTagIds && panel.includedTagIds.length && !isAnyOfSeveral) {
      fields.includedTagIds = [...panel.includedTagIds, ...fields.includedTagIds];
      fields.includedTagsMatch = 'all';
    }
    // A project search inside a project list keeps only that project.
    if (fields.projectIds && list.type === WorkContextType.PROJECT) {
      fields.projectIds = fields.projectIds.includes(list.id) ? [list.id] : [];
    }
    panel = { ...panel, ...fields };
  }

  const sortKey = opts.sort.type ? SORT_OPTION_TO_KEY[opts.sort.type] : undefined;
  panel = withPanelSortKey(panel, sortKey);
  if (sortKey) {
    panel.sortDir = opts.sort.order === SORT_ORDER.DESC ? 'desc' : 'asc';
  } else {
    // Without a sort the column keeps the list's order.
    panel.taskIds = [...list.taskIds];
  }

  return { id: '', title: list.title, cols: 1, panels: [panel] };
};
