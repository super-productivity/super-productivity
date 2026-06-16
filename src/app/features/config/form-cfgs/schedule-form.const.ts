import { ConfigFormSection, ScheduleConfig } from '../global-config.model';
import { T } from '../../../t.const';
import { isValidSplitTime } from '../../../util/is-valid-split-time';

export const SCHEDULE_FORM_CFG: ConfigFormSection<ScheduleConfig> = {
  title: T.GCF.SCHEDULE.TITLE,
  help: T.GCF.SCHEDULE.HELP,
  key: 'schedule',
  items: [
    {
      key: 'isWorkStartEndEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SCHEDULE.L_IS_WORK_START_END_ENABLED,
      },
    },
    {
      hideExpression: (m, v, field) => !field?.model.isWorkStartEndEnabled,
      key: 'workStart',
      type: 'time',
      templateOptions: {
        required: true,
        label: T.GCF.SCHEDULE.L_WORK_START,
        description: T.GCF.SCHEDULE.WORK_START_END_DESCRIPTION,
      },
      validators: {
        validTimeString: (c: { value: string | undefined }) => {
          return isValidSplitTime(c.value);
        },
      },
    },
    {
      hideExpression: (m, v, field) => !field?.model.isWorkStartEndEnabled,
      key: 'workEnd',
      type: 'time',
      templateOptions: {
        required: true,
        label: T.GCF.SCHEDULE.L_WORK_END,
        description: T.GCF.SCHEDULE.WORK_START_END_DESCRIPTION,
      },
      validators: {
        validTimeString: (c: { value: string | undefined }) => {
          return isValidSplitTime(c.value);
        },
      },
    },
    {
      key: 'isLunchBreakEnabled',
      type: 'checkbox',
      templateOptions: {
        label: T.GCF.SCHEDULE.L_IS_LUNCH_BREAK_ENABLED,
      },
    },
    {
      hideExpression: (m, v, field) => !field?.model.isLunchBreakEnabled,
      key: 'lunchBreakStart',
      type: 'time',
      templateOptions: {
        required: true,
        label: T.GCF.SCHEDULE.L_LUNCH_BREAK_START,
        description: T.GCF.SCHEDULE.LUNCH_BREAK_START_END_DESCRIPTION,
      },
      validators: {
        validTimeString: (c: { value: string | undefined }) => {
          return isValidSplitTime(c.value);
        },
      },
    },
    {
      hideExpression: (m, v, field) => !field?.model.isLunchBreakEnabled,
      key: 'lunchBreakEnd',
      type: 'time',
      templateOptions: {
        required: true,
        label: T.GCF.SCHEDULE.L_LUNCH_BREAK_END,
        description: T.GCF.SCHEDULE.LUNCH_BREAK_START_END_DESCRIPTION,
      },
      validators: {
        validTimeString: (c: { value: string | undefined }) => {
          return isValidSplitTime(c.value);
        },
      },
    },
  ],
};
