import { TaskReminderOption, TaskReminderOptionId } from '../../tasks/task.model';
import { T } from '../../../t.const';

export const TASK_REMINDER_OPTIONS: TaskReminderOption[] = [
  {
    value: TaskReminderOptionId.DoNotRemind,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_NEVER,
  },
  {
    value: TaskReminderOptionId.AtStart,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_START,
  },
  {
    value: TaskReminderOptionId.m5,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_5M,
  },
  {
    value: TaskReminderOptionId.m10,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_10M,
  },
  {
    value: TaskReminderOptionId.m15,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_15M,
  },
  {
    value: TaskReminderOptionId.m30,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_30M,
  },
  {
    value: TaskReminderOptionId.h1,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_1H,
  },
  {
    value: TaskReminderOptionId.d1,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_1D,
  },
  {
    value: TaskReminderOptionId.d3,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_3D,
  },
  {
    value: TaskReminderOptionId.w1,
    label: T.F.TASK.D_SCHEDULE_TASK.RO_1W,
  },
];

const LONG_LEAD_OPTION_IDS: TaskReminderOptionId[] = [
  TaskReminderOptionId.d1,
  TaskReminderOptionId.d3,
  TaskReminderOptionId.w1,
];

/**
 * For places that persist the option id itself instead of an absolute
 * `remindAt`: the global default and repeat configs. Clients before v19.2.0
 * cannot convert the long lead times (`remindOptionToMilliseconds` returns
 * undefined there), so tasks created on such a device would get no reminder.
 * Repeat instances are also only created on their day, so a lead time of days
 * could not fire for them anyway.
 */
export const TASK_REMINDER_OPTIONS_WITHOUT_LONG_LEAD: TaskReminderOption[] =
  TASK_REMINDER_OPTIONS.filter((opt) => !LONG_LEAD_OPTION_IDS.includes(opt.value));

/**
 * Maps a long lead time to the longest option a persisted option id may hold,
 * for paths where a task-level pick (offering every option) flows into a
 * repeat config.
 */
export const toPersistableRemindOption = (
  id: TaskReminderOptionId,
): TaskReminderOptionId =>
  LONG_LEAD_OPTION_IDS.includes(id) ? TaskReminderOptionId.h1 : id;
