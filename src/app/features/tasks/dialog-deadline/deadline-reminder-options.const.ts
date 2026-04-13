import { TaskReminderOption, TaskReminderOptionId } from '../task.model';
import { T } from '../../../t.const';

export const DEADLINE_REMINDER_OPTIONS: TaskReminderOption[] = [
  {
    value: TaskReminderOptionId.DoNotRemind,
    label: T.F.TASK.D_DEADLINE.RO_NEVER,
  },
  {
    value: TaskReminderOptionId.AtStart,
    label: T.F.TASK.D_DEADLINE.RO_AT_DEADLINE,
  },
  {
    value: TaskReminderOptionId.m5,
    label: T.F.TASK.D_DEADLINE.RO_5M,
  },
  {
    value: TaskReminderOptionId.m10,
    label: T.F.TASK.D_DEADLINE.RO_10M,
  },
  {
    value: TaskReminderOptionId.m15,
    label: T.F.TASK.D_DEADLINE.RO_15M,
  },
  {
    value: TaskReminderOptionId.m30,
    label: T.F.TASK.D_DEADLINE.RO_30M,
  },
  {
    value: TaskReminderOptionId.h1,
    label: T.F.TASK.D_DEADLINE.RO_1H,
  },
];
