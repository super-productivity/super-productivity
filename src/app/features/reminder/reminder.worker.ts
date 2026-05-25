/// <reference lib="webworker" />

import { ReminderCopy } from './reminder.model';
import { lazySetInterval } from '../../../../electron/shared-with-frontend/lazy-set-interval';
import { Log } from '../../core/log';

const CHECK_INTERVAL_DURATION = 10000;
let cancelCheckInterval: (() => void) | undefined;

addEventListener('message', ({ data }) => {
  // Log.log('REMINDER WORKER', data);
  reInitCheckInterval(data);
});

const reInitCheckInterval = (reminders: ReminderCopy[]): void => {
  if (cancelCheckInterval) {
    cancelCheckInterval();
    cancelCheckInterval = undefined;
  }
  if (!reminders || !reminders.length) {
    return;
  }

  cancelCheckInterval = lazySetInterval(() => {
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
  }, CHECK_INTERVAL_DURATION);
};

const getDueReminders = (reminders: ReminderCopy[]): ReminderCopy[] => {
  const now = Date.now();
  return reminders
    .filter((reminder) => reminder.remindAt < now)
    .sort((a, b) => a.remindAt - b.remindAt);
};
