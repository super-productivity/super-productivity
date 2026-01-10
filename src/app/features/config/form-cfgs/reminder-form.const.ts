import { ConfigFormSection, ReminderConfig } from '../global-config.model';
import { TASK_REMINDER_OPTIONS } from '../../planner/dialog-schedule-task/task-reminder-options.const';
import { T } from '../../../t.const';

export const REMINDER_FORM_CFG: ConfigFormSection<ReminderConfig> = {
  title: T.GCF.REMINDER.TITLE,
  // help: T.GCF.REMINDER.HELP,
  key: 'reminder',
  items: [
    {
      key: 'isCountdownBannerEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.REMINDER.IS_COUNTDOWN_BANNER_ENABLED,
      },
    },
    {
      key: 'countdownDuration',
      type: 'duration',
      hideExpression: (m, v, field) => !field?.model.isCountdownBannerEnabled,
      templateOptions: {
        required: true,
        label: T.GCF.REMINDER.COUNTDOWN_DURATION,
        description: T.G.DURATION_DESCRIPTION,
      },
    },
    {
      key: 'defaultTaskRemindOption',
      type: 'select',
      templateOptions: {
        required: true,
        label: T.GCF.REMINDER.DEFAULT_TASK_REMIND_OPTION,
        options: TASK_REMINDER_OPTIONS,
      },
    },
    {
      key: 'disableReminders',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.REMINDER.DISABLE_REMINDERS,
      },
    },
    {
      key: 'isFocusWindow',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.REMINDER.IS_FOCUS_WINDOW,
      },
    },
  ],
};
