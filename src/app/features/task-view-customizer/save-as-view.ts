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
import { T } from '../../t.const';

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
 * tasks due today or overdue. `hints` are translation keys for what the view
 * can't carry over: grouping (columns don't group), Today's own overdue
 * section, and filter parts one column can't express next to the list's own
 * project or tag. Those parts are left out, so the view stays within the
 * list's project or tag but may show more of it than the filtered list.
 */
export const buildViewFromList = (opts: {
  list: ViewSourceList;
  filter: FilterOption;
  sort: SortOption;
  isGrouped: boolean;
  tags: readonly { id: string; title: string }[];
  projects: readonly { id: string; title: string }[];
}): { board: BoardCfg; hints: string[] } => {
  const { list } = opts;
  const hints: string[] = [];
  const isToday = list.type === WorkContextType.TAG && list.id === TODAY_TAG.id;
  const isTagList = list.type === WorkContextType.TAG && !isToday;
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
    hints.push(T.F.BOARDS.V.HINT_TODAY_OR_OVERDUE);
  } else if (list.type === WorkContextType.PROJECT) {
    panel.projectIds = [list.id];
    panel.backlogState = BoardPanelCfgTaskTypeFilter.NoBacklog;
  } else {
    panel.includedTagIds = [list.id];
  }
  if (opts.isGrouped) {
    hints.push(T.F.BOARDS.V.HINT_GROUPING_NOT_SAVED);
  }

  const criteria = filterToCriteria(opts.filter, {
    tags: opts.tags,
    projects: opts.projects,
  });
  let isFilterPartDropped = !!criteria?.isNoMatch;
  if (criteria && !criteria.isNoMatch) {
    const fields = criteriaToPanelFields(criteria);
    if (isTagList) {
      // "Untagged" or "any of several tags" can't sit next to the list's tag.
      const isAnyOfSeveral =
        fields.includedTagsMatch === 'any' && (fields.includedTagIds?.length ?? 0) > 1;
      if (fields.isUntagged || isAnyOfSeveral) {
        delete fields.isUntagged;
        delete fields.includedTagIds;
        delete fields.includedTagsMatch;
        isFilterPartDropped = true;
      } else if (fields.includedTagIds) {
        fields.includedTagIds = [...panel.includedTagIds, ...fields.includedTagIds];
        fields.includedTagsMatch = 'all';
      }
    }
    if (fields.projectIds && list.type === WorkContextType.PROJECT) {
      // A project search inside a project list: it either keeps the project
      // or would match nothing, which a column can't say.
      if (!fields.projectIds.includes(list.id)) isFilterPartDropped = true;
      delete fields.projectIds;
    }
    panel = { ...panel, ...fields };
  }
  if (isFilterPartDropped) {
    hints.push(T.F.BOARDS.V.HINT_FILTER_PART_NOT_SAVED);
  }

  const sortKey = opts.sort.type ? SORT_OPTION_TO_KEY[opts.sort.type] : undefined;
  panel = withPanelSortKey(panel, sortKey);
  if (sortKey) {
    panel.sortDir = opts.sort.order === SORT_ORDER.DESC ? 'desc' : 'asc';
  } else {
    // Without a sort the column keeps the list's order.
    panel.taskIds = [...list.taskIds];
  }

  return { board: { id: '', title: list.title, cols: 1, panels: [panel] }, hints };
};
