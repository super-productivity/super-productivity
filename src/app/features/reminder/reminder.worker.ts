/// <reference lib="webworker" />

import { ReminderCopy } from './reminder.model';
import { lazySetInterval } from '../../../../electron/shared-with-frontend/lazy-set-interval';
import { Log } from '../../core/log';

const CHECK_INTERVAL_DURATION = 10000;
let cancelCheckInterval: (() => void) | undefined;

interface ReminderWorkerUpdate {
  reminders: ReminderCopy[];
  isCheckImmediately?: boolean;
}

addEventListener(
  'message',
  ({ data }: MessageEvent<ReminderCopy[] | ReminderWorkerUpdate>) => {
    const reminders = Array.isArray(data) ? data : data.reminders;
    // Log.log('REMINDER WORKER', reminders);
    reInitCheckInterval(reminders, !Array.isArray(data) && !!data.isCheckImmediately);
  },
);

const reInitCheckInterval = (
  reminders: ReminderCopy[],
  isCheckImmediately: boolean = false,
): void => {
  if (cancelCheckInterval) {
    cancelCheckInterval();
    cancelCheckInterval = undefined;
  }
  if (!reminders || !reminders.length) {
    return;
  }

  if (isCheckImmediately) {
    checkAndPostDueReminders(reminders);
  }

  cancelCheckInterval = lazySetInterval(() => {
    checkAndPostDueReminders(reminders);
  }, CHECK_INTERVAL_DURATION);
};

const checkAndPostDueReminders = (reminders: ReminderCopy[]): void => {
  const dueReminders = getDueReminders(reminders);
  if (dueReminders.length) {
    const oldest = dueReminders[0];

    const remindersToSend =
      oldest.type === 'TASK'
        ? dueReminders.filter((r) => r.type === 'TASK')
        : // NOTE: for notes we just send the oldest due reminder
          [oldest];

    postMessage(remindersToSend);
    Log.log('Worker postMessage', {
      count: remindersToSend.length,
      ids: remindersToSend.map((r) => r.id),
      type: remindersToSend[0]?.type,
    });
  }
};

const getDueReminders = (reminders: ReminderCopy[]): ReminderCopy[] => {
  const now = Date.now();
  return reminders
    .filter((reminder) => reminder.remindAt < now)
    .sort((a, b) => a.remindAt - b.remindAt);
};
