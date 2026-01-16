import { EntityState } from '@ngrx/entity';
import { TaskReminderOptionId } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';

export const TASK_REPEAT_WEEKDAY_MAP: (keyof TaskRepeatCfg)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export type RepeatCycleOption = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RepeatQuickSetting =
  | 'DAILY'
  | 'WEEKLY_CURRENT_WEEKDAY'
  | 'MONTHLY_CURRENT_DATE'
  | 'MONDAY_TO_FRIDAY'
  | 'YEARLY_CURRENT_DATE'
  | 'CUSTOM';

export interface TaskRepeatCfgCopy {
  id: string;
  projectId: string | null;
  // TODO remove at some point
  lastTaskCreation?: number;
  lastTaskCreationDay?: string;
  title: string | null;
  tagIds: string[];
  order: number;
  defaultEstimate?: number;
  startTime?: string;
  remindAt?: TaskReminderOptionId;

  // actual repeat cfg fields
  isPaused: boolean;
  // has no direct effect, but is used to update values inside form
  quickSetting: RepeatQuickSetting;
  repeatCycle: RepeatCycleOption;
  // worklog string; only in effect for monthly/yearly
  startDate?: string;
  repeatEvery: number;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;

  // advanced
  notes: string | undefined;
  // ... possible sub tasks & attachments
  shouldInheritSubtasks?: boolean;
  // Base new start date on completion date
  repeatFromCompletionDate?: boolean;
  // new UX: disable auto update checkbox (auto-update is default)
  disableAutoUpdateSubtasks?: boolean;
  subTaskTemplates?: {
    title: string;
    timeEstimate?: number;
    notes?: string;
  }[];
  // Exception list for deleted instances (ISO date strings YYYY-MM-DD)
  deletedInstanceDates?: string[];
}

export type TaskRepeatCfg = Readonly<TaskRepeatCfgCopy>;

export type TaskRepeatCfgState = EntityState<TaskRepeatCfg>;

export const DEFAULT_TASK_REPEAT_CFG: Omit<TaskRepeatCfgCopy, 'id'> = {
  lastTaskCreation: Date.now(),
  lastTaskCreationDay: getDbDateStr(),
  title: null,
  defaultEstimate: undefined,

  // id: undefined,
  projectId: null,

  startTime: undefined,
  startDate: undefined,
  repeatEvery: 1,
  remindAt: undefined,
  isPaused: false,
  quickSetting: 'DAILY',
  repeatCycle: 'WEEKLY',
  repeatFromCompletionDate: false,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
  tagIds: [],
  order: 0,

  notes: undefined,
  shouldInheritSubtasks: false,
  disableAutoUpdateSubtasks: false,
};
