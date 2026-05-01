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
  | 'MONTHLY_FIRST_DAY'
  | 'MONTHLY_LAST_DAY'
  | 'MONTHLY_NTH_WEEKDAY'
  | 'MONDAY_TO_FRIDAY'
  | 'YEARLY_CURRENT_DATE'
  | 'CUSTOM';

// MONTHLY Nth-weekday anchor (issue #6040). Both fields together form an
// anchor like "first Thursday" or "last Monday"; either field absent /
// out-of-range falls back to legacy day-of-month recurrence.
// 1..4 = 1st through 4th occurrence; -1 = last occurrence in the month
export type MonthlyWeekOfMonth = 1 | 2 | 3 | 4 | -1;
// 0 = Sunday … 6 = Saturday (matches Date.getDay() and TASK_REPEAT_WEEKDAY_MAP)
export type MonthlyWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TaskRepeatCfgCopy {
  id: string;
  projectId: string | null;
  // TODO remove at some point
  lastTaskCreation?: number;
  lastTaskCreationDay?: string;
  title: string | null;
  tagIds: string[];
  /**
   * @deprecated No longer configurable via UI. Kept for backwards compatibility.
   * order<=0 → task inserted at top; order>0 → task inserted at bottom.
   */
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

  // MONTHLY-only: when both fields are set and in range, the recurrence
  // anchors to the Nth weekday of each month instead of the numeric day.
  // Anchor presence is the discriminator — there is no separate mode field.
  // Issue #6040.
  monthlyWeekOfMonth?: MonthlyWeekOfMonth;
  monthlyWeekday?: MonthlyWeekday;

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
  // When true, missed/overdue instances are silently skipped instead of being created
  skipOverdue?: boolean;
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
  skipOverdue: false,
};
