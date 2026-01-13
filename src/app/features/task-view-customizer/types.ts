import { T } from 'src/app/t.const';

export interface BaseOption<T> {
  label: string;
  type: T | null; // null - option is not selected
}

// === SORT ===

export interface SortOption extends BaseOption<SORT_OPTION_TYPE> {
  order?: SORT_ORDER;
}

export enum SORT_OPTION_TYPE {
  name = 'name',
  scheduledDate = 'scheduledDate',
  creationDate = 'creationDate',
  estimatedTime = 'estimatedTime',
  timeSpent = 'timeSpent',
  tag = 'tag',
}

export enum SORT_ORDER {
  ASC = 'ASC',
  DESC = 'DESC',
}

// === GROUP ===

export type GroupOption = BaseOption<GROUP_OPTION_TYPE>;

export enum GROUP_OPTION_TYPE {
  tag = 'tag',
  project = 'project',
  scheduledDate = 'scheduledDate',
}

// === FILTER ===

export interface FilterOption extends BaseOption<FILTER_OPTION_TYPE> {
  preset: FILTER_SCHEDULE | FILTER_TIME | string | null;
}

export enum FILTER_OPTION_TYPE {
  tag = 'tag',
  project = 'project',
  scheduledDate = 'scheduledDate',
  estimatedTime = 'estimatedTime',
  timeSpent = 'timeSpent',
}

export enum FILTER_SCHEDULE {
  today = 'today',
  tomorrow = 'tomorrow',
  thisWeek = 'thisWeek',
  nextWeek = 'nextWeek',
  thisMonth = 'thisMonth',
  nextMonth = 'nextMonth',
}

export enum FILTER_TIME {
  MIN_10 = '600000',
  MIN_30 = '1800000',
  MIN_60 = '3600000',
  MIN_120 = '7200000',
}

export enum FILTER_COMMON {
  NOT_SPECIFIED = 'NOT_SPECIFIED',
}

// === DEFAULTS ===

export const DEFAULT_OPTIONS = {
  sort: {
    type: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.SORT_DEFAULT,
  },
  group: {
    type: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_DEFAULT,
  },
  filter: {
    type: null,
    preset: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_DEFAULT,
  },
};

// VALUES

const sortOptions: SortOption[] = [
  DEFAULT_OPTIONS.sort,
  {
    type: SORT_OPTION_TYPE.name,
    order: SORT_ORDER.ASC,
    label: T.F.TASK_VIEW.CUSTOMIZER.SORT_NAME,
  },
  {
    type: SORT_OPTION_TYPE.scheduledDate,
    order: SORT_ORDER.ASC,
    label: T.F.TASK_VIEW.CUSTOMIZER.SORT_SCHEDULED_DATE,
  },
  {
    type: SORT_OPTION_TYPE.creationDate,
    order: SORT_ORDER.ASC,
    label: T.F.TASK_VIEW.CUSTOMIZER.SORT_CREATION_DATE,
  },
  {
    type: SORT_OPTION_TYPE.estimatedTime,
    order: SORT_ORDER.ASC,
    label: T.F.TASK_VIEW.CUSTOMIZER.ESTIMATED_TIME,
  },
  {
    type: SORT_OPTION_TYPE.timeSpent,
    order: SORT_ORDER.ASC,
    label: T.F.TASK_VIEW.CUSTOMIZER.TIME_SPENT,
  },
  {
    type: SORT_OPTION_TYPE.tag,
    order: SORT_ORDER.ASC,
    label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_TAG,
  },
];

const groupOptions: GroupOption[] = [
  DEFAULT_OPTIONS.group,
  {
    type: GROUP_OPTION_TYPE.tag,
    label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_TAG,
  },
  {
    type: GROUP_OPTION_TYPE.project,
    label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_PROJECT,
  },
  {
    type: GROUP_OPTION_TYPE.scheduledDate,
    label: T.F.TASK_VIEW.CUSTOMIZER.GROUP_SCHEDULED_DATE,
  },
];

const filterOptions: FilterOption[] = [
  DEFAULT_OPTIONS.filter,
  {
    type: FILTER_OPTION_TYPE.tag,
    preset: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_TAG,
  },
  {
    type: FILTER_OPTION_TYPE.project,
    preset: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_PROJECT,
  },
  {
    type: FILTER_OPTION_TYPE.scheduledDate,
    preset: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_SCHEDULED_DATE,
  },
  {
    type: FILTER_OPTION_TYPE.estimatedTime,
    preset: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_ESTIMATED_TIME,
  },
  {
    type: FILTER_OPTION_TYPE.timeSpent,
    preset: null,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_TIME_SPENT,
  },
];

const scheduledPresets: BaseOption<FILTER_COMMON | FILTER_SCHEDULE>[] = [
  {
    type: FILTER_COMMON.NOT_SPECIFIED,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_NOT_SPECIFIED,
  },
  {
    type: FILTER_SCHEDULE.today,
    label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_TODAY,
  },
  {
    type: FILTER_SCHEDULE.tomorrow,
    label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_TOMORROW,
  },
  {
    type: FILTER_SCHEDULE.thisWeek,
    label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_THIS_WEEK,
  },
  {
    type: FILTER_SCHEDULE.nextWeek,
    label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_NEXT_WEEK,
  },
  {
    type: FILTER_SCHEDULE.thisMonth,
    label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_THIS_MONTH,
  },
  {
    type: FILTER_SCHEDULE.nextMonth,
    label: T.F.TASK_VIEW.CUSTOMIZER.SCHEDULED_NEXT_MONTH,
  },
];

const timePresets: BaseOption<FILTER_COMMON | FILTER_TIME>[] = [
  {
    type: FILTER_COMMON.NOT_SPECIFIED,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_NOT_SPECIFIED,
  },
  { type: FILTER_TIME.MIN_10, label: T.F.TASK_VIEW.CUSTOMIZER.TIME_10MIN },
  { type: FILTER_TIME.MIN_30, label: T.F.TASK_VIEW.CUSTOMIZER.TIME_30MIN },
  { type: FILTER_TIME.MIN_60, label: T.F.TASK_VIEW.CUSTOMIZER.TIME_1HOUR },
  { type: FILTER_TIME.MIN_120, label: T.F.TASK_VIEW.CUSTOMIZER.TIME_2HOUR },
];

const tagPresets: BaseOption<FILTER_COMMON>[] = [
  {
    type: FILTER_COMMON.NOT_SPECIFIED,
    label: T.F.TASK_VIEW.CUSTOMIZER.FILTER_NOT_SPECIFIED,
  },
];

export const OPTIONS = {
  sort: {
    types: SORT_OPTION_TYPE,
    order: SORT_ORDER,
    list: sortOptions,
  },
  group: {
    types: GROUP_OPTION_TYPE,
    list: groupOptions,
  },
  filter: {
    types: FILTER_OPTION_TYPE,
    list: filterOptions,
  },
};

export const PRESETS = {
  tag: tagPresets,
  schedule: scheduledPresets,
  time: timePresets,
};
