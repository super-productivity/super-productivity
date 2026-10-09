import { TaskReminderOptionId } from '../task.model';

const DAY_MS = 24 * 60 * 60 * 1000;
const THREE_DAYS_MS = 3 * DAY_MS;
const WEEK_MS = 7 * DAY_MS;

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
    // shortcut: fixed 24h days — a DST switch in between shifts the reminder by 1h
    case TaskReminderOptionId.d1: {
      return due - DAY_MS;
    }
    case TaskReminderOptionId.d3: {
      return due - THREE_DAYS_MS;
    }
    case TaskReminderOptionId.w1: {
      return due - WEEK_MS;
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

/**
 * Like `millisecondsDiffToRemindOption`, but also maps to the long-lead options
 * (days/week) only offered for deadlines. Kept separate so due-date reminders
 * stay within their own option list.
 */
export const millisecondsDiffToDeadlineRemindOption = (
  deadline: number,
  remindAt?: number,
): TaskReminderOptionId => {
  if (typeof remindAt !== 'number') {
    return TaskReminderOptionId.DoNotRemind;
  }
  const diffInDays = (deadline - remindAt) / DAY_MS;
  if (diffInDays >= 5) {
    return TaskReminderOptionId.w1;
  } else if (diffInDays >= 2) {
    return TaskReminderOptionId.d3;
  } else if (diffInDays >= 0.5) {
    return TaskReminderOptionId.d1;
  }
  return millisecondsDiffToRemindOption(deadline, remindAt);
};
