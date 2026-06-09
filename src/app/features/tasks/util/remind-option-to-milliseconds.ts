import { TaskReminderOptionId } from '../task.model';

export const remindOptionToMilliseconds = (
  due: number,
  remindOptId: TaskReminderOptionId,
): number | undefined => {
  switch (remindOptId) {
    case TaskReminderOptionId.AtStart: {
      return due;
    }
    case TaskReminderOptionId.m5: {
      // prettier-ignore
      return due - (5 * 60 * 1000);
    }
    case TaskReminderOptionId.m10: {
      // prettier-ignore
      return due - (10 * 60 * 1000);
    }
    case TaskReminderOptionId.m15: {
      // prettier-ignore
      return due - (15 * 60 * 1000);
    }
    case TaskReminderOptionId.m30: {
      // prettier-ignore
      return due - (30 * 60 * 1000);
    }
    case TaskReminderOptionId.h1: {
      // prettier-ignore
      return due - (60 * 60 * 1000);
    }
  }
  return undefined;
};

export const millisecondsDiffToRemindOption = (
  due: number,
  remindAt?: number,
): TaskReminderOptionId => {
  if (typeof remindAt !== 'number') {
    return TaskReminderOptionId.DoNotRemind;
  }
  const diff: number = due - remindAt;
  const diffInMinutes = diff / (60 * 1000);

  if (diffInMinutes >= 45) {
    return TaskReminderOptionId.h1;
  } else if (diffInMinutes >= 22.5) {
    return TaskReminderOptionId.m30;
  } else if (diffInMinutes >= 12.5) {
    return TaskReminderOptionId.m15;
  } else if (diffInMinutes >= 7.5) {
    return TaskReminderOptionId.m10;
  } else if (diffInMinutes >= 2.5) {
    return TaskReminderOptionId.m5;
  } else {
    // Also handles diff <= 0
    return TaskReminderOptionId.AtStart;
  }
};
