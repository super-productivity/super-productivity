import { TaskCriteria, TaskDateRule } from '../tasks/task-criteria/task-criteria.model';
import { TaskPriority } from '../tasks/task.model';
import {
  FILTER_COMMON,
  FILTER_OPTION_TYPE,
  FILTER_SCHEDULE,
  FilterOption,
  SORT_OPTION_TYPE,
} from './types';
import { TaskSortKey } from '../tasks/task-criteria/task-criteria';

const SCHEDULE_PRESETS: ReadonlySet<string> = new Set(Object.values(FILTER_SCHEDULE));

const toDateRule = (value: string): TaskDateRule | null =>
  value === FILTER_COMMON.NOT_SPECIFIED
    ? 'none'
    : SCHEDULE_PRESETS.has(value)
      ? (value as TaskDateRule)
      : null;

const toAmountRule = (value: string): 'none' | number =>
  value === FILTER_COMMON.NOT_SPECIFIED ? 'none' : +value;

/**
 * The filter menu's filter as task criteria, or `null` for "no filter". The
 * legacy title-search presets for tags and projects resolve to ids here, so a
 * search without hits matches nothing (as before). Tag filters keep only tags
 * that still exist; when none is left the filter is off, like the chip list.
 */
export const filterToCriteria = (
  filter: FilterOption,
  lookups: {
    tags: readonly { id: string; title: string }[];
    projects: readonly { id: string; title: string }[];
  },
): TaskCriteria | null => {
  if (!filter.type) {
    return null;
  }
  const value = filter.preset?.trim() ?? '';
  switch (filter.type) {
    case FILTER_OPTION_TYPE.tag: {
      const knownIds = new Set(lookups.tags.map((tag) => tag.id));
      const tagIds = (filter.tagIds ?? []).filter((id) => knownIds.has(id));
      if (tagIds.length) {
        return {
          includedTagIds: tagIds,
          includedTagsMatch: filter.tagFilterMode === 'AND' ? 'all' : 'any',
        };
      }
      if (!value) return null;
      if (value === FILTER_COMMON.NOT_SPECIFIED) return { isUntagged: true };
      const search = value.toLowerCase();
      const ids = lookups.tags
        .filter((tag) => tag.title.toLowerCase().includes(search))
        .map((tag) => tag.id);
      return ids.length
        ? { includedTagIds: ids, includedTagsMatch: 'any' }
        : { isNoMatch: true };
    }
    case FILTER_OPTION_TYPE.project: {
      if (!value) return null;
      const search = value.toLowerCase();
      const ids = lookups.projects
        .filter((project) => project.title.toLowerCase().includes(search))
        .map((project) => project.id);
      return ids.length ? { projectIds: ids } : { isNoMatch: true };
    }
    case FILTER_OPTION_TYPE.scheduledDate: {
      const rule = value ? toDateRule(value) : null;
      return rule ? { plannedDate: rule } : null;
    }
    case FILTER_OPTION_TYPE.deadline: {
      const rule = value ? toDateRule(value) : null;
      return rule ? { deadline: rule } : null;
    }
    case FILTER_OPTION_TYPE.estimatedTime:
      return value ? { estimate: toAmountRule(value) } : null;
    case FILTER_OPTION_TYPE.timeSpent:
      return value ? { timeSpent: toAmountRule(value) } : null;
    case FILTER_OPTION_TYPE.priority:
      return value
        ? {
            priority:
              value === FILTER_COMMON.NOT_SPECIFIED ? 'none' : (+value as TaskPriority),
          }
        : null;
    default:
      return null;
  }
};

/** The filter menu's sort options as task sort keys. */
export const SORT_OPTION_TO_KEY: Record<SORT_OPTION_TYPE, TaskSortKey> = {
  [SORT_OPTION_TYPE.name]: 'title',
  [SORT_OPTION_TYPE.scheduledDate]: 'plannedDate',
  [SORT_OPTION_TYPE.deadline]: 'deadline',
  [SORT_OPTION_TYPE.creationDate]: 'created',
  [SORT_OPTION_TYPE.estimatedTime]: 'estimate',
  [SORT_OPTION_TYPE.timeSpent]: 'timeSpent',
  [SORT_OPTION_TYPE.tag]: 'tag',
  [SORT_OPTION_TYPE.priority]: 'priority',
};
