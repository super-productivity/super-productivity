/// <reference lib="webworker" />

import { ReminderCopy } from './reminder.model';
import { lazySetInterval } from '../../../../electron/shared-with-frontend/lazy-set-interval';
import { Log } from '../../core/log';
import { getRemindersToActivate } from './due-reminders.util';

const CHECK_INTERVAL_DURATION = 10000;
let cancelCheckInterval: (() => void) | undefined;

addEventListener('message', ({ data }: MessageEvent<ReminderCopy[]>) => {
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
    checkAndPostDueReminders(reminders);
  }, CHECK_INTERVAL_DURATION);
};

const checkAndPostDueReminders = (reminders: ReminderCopy[]): void => {
  const remindersToSend = getRemindersToActivate(reminders);
  if (remindersToSend.length) {
    postMessage(remindersToSend);
    Log.log('Worker postMessage', {
      count: remindersToSend.length,
      ids: remindersToSend.map((r) => r.id),
      type: remindersToSend[0]?.type,
    });
  }
};
