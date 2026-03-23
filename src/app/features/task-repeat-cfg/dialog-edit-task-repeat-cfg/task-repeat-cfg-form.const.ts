import { FormlyFieldConfig } from '@ngx-formly/core';
import { T } from '../../../t.const';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { TASK_REMINDER_OPTIONS } from '../../planner/dialog-schedule-task/task-reminder-options.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { RepeatQuickSetting, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getQuickSettingUpdates } from './get-quick-setting-updates';
import { TaskReminderOptionId } from '../../tasks/task.model';

const updateParent = (
  field: FormlyFieldConfig,
  changes: Partial<TaskRepeatCfg>,
): void => {
  // possibly better?
  field.form?.patchValue({
    // ...field.parent.model,
    ...changes,
  } as any);
};

export const TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG: FormlyFieldConfig[] = [
  {
    key: 'title',
    type: 'input',
    templateOptions: {
      label: T.F.TASK_REPEAT.F.TITLE,
    },
  },
  {
    key: 'startDate',
    type: 'date',
    defaultValue: new Date(),
    templateOptions: {
      label: T.F.TASK_REPEAT.F.START_DATE,
      required: true,
    },
    parsers: [(val: unknown) => (val instanceof Date ? getDbDateStr(val) : val)],
  },
  {
    key: 'quickSetting',
    type: 'select',
    defaultValue: 'DAILY',
    templateOptions: {
      required: true,
      label: T.F.TASK_REPEAT.F.QUICK_SETTING,
      // NOTE replaced in component to allow for dynamic translation
      options: [],
      change: (field, event) => {
        const updatesForQuickSetting = getQuickSettingUpdates(
          event.value as RepeatQuickSetting,
        );
        if (updatesForQuickSetting) {
          // NOTE: for some reason this doesn't update the model value, just the view value :(
          updateParent(field, updatesForQuickSetting);
        }
      },
    },
  },

  // REPEAT CUSTOM CFG - Wrapped in container
  {
    fieldGroupClassName: 'repeat-config-container',
    resetOnHide: false,
    hideExpression: (model: any) => model.quickSetting !== 'CUSTOM',
    fieldGroup: [
      {
        fieldGroupClassName: 'repeat-cycle',
        fieldGroup: [
          {
            key: 'repeatEvery',
            type: 'input',
            defaultValue: 1,
            templateOptions: {
              label: T.F.TASK_REPEAT.F.REPEAT_EVERY,
              required: true,
              min: 1,
              max: 1000,
              type: 'number',
            },
          },
          {
            key: 'repeatCycle',
            type: 'select',
            defaultValue: 'WEEKLY',
            templateOptions: {
              required: true,
              label: T.F.TASK_REPEAT.F.REPEAT_CYCLE,
              options: [
                { value: 'DAILY', label: T.F.TASK_REPEAT.F.C_DAY },
                { value: 'WEEKLY', label: T.F.TASK_REPEAT.F.C_WEEK },
                { value: 'MONTHLY', label: T.F.TASK_REPEAT.F.C_MONTH },
                { value: 'YEARLY', label: T.F.TASK_REPEAT.F.C_YEAR },
              ],
            },
          },
        ],
      },
      {
        fieldGroupClassName: 'weekdays',
        resetOnHide: false,
        hideExpression: (model: any) => model.repeatCycle !== 'WEEKLY',
        fieldGroup: [
          {
            key: 'monday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.MONDAY,
            },
          },
          {
            key: 'tuesday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.TUESDAY,
            },
          },
          {
            key: 'wednesday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.WEDNESDAY,
            },
          },
          {
            key: 'thursday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.THURSDAY,
            },
          },
          {
            key: 'friday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.FRIDAY,
            },
          },
          {
            key: 'saturday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.SATURDAY,
            },
          },
          {
            key: 'sunday',
            type: 'checkbox',
            templateOptions: {
              label: T.F.TASK_REPEAT.F.SUNDAY,
            },
          },
        ],
      },
    ],
  },
  // REPEAT CFG END
];

export const TASK_REPEAT_CFG_ADVANCED_FORM_CFG: FormlyFieldConfig[] = [
  {
    key: 'defaultEstimate',
    type: 'duration',
    templateOptions: {
      label: T.F.TASK_REPEAT.F.DEFAULT_ESTIMATE,
      description: T.G.DURATION_DESCRIPTION,
    },
    // otherwise the input duration field messes up :(
    modelOptions: {
      updateOn: 'blur',
    },
  },
  {
    fieldGroupClassName: 'formly-row',
    fieldGroup: [
      {
        key: 'startTime',
        type: 'input',
        templateOptions: {
          label: T.F.TASK_REPEAT.F.START_TIME,
          description: T.F.TASK_REPEAT.F.START_TIME_DESCRIPTION,
        },
        validators: {
          validTimeString: (c: { value: string | undefined }) => {
            return !c.value || isValidSplitTime(c.value);
          },
        },
      },
      {
        key: 'remindAt',
        type: 'select',
        defaultValue: TaskReminderOptionId.AtStart,
        hideExpression: '!model.startTime',
        templateOptions: {
          required: true,
          label: T.F.TASK_REPEAT.F.REMIND_AT,
          options: TASK_REMINDER_OPTIONS,
          valueProp: 'value',
          labelProp: 'label',
          placeholder: T.F.TASK_REPEAT.F.REMIND_AT_PLACEHOLDER,
        },
      },
    ],
  },
  {
    key: 'notes',
    type: 'textarea',
    templateOptions: {
      label: T.F.TASK_REPEAT.F.NOTES,
      rows: 4,
    },
  },
  // Schedule type: from due date or from completion
  {
    key: 'repeatFromCompletionDate',
    type: 'select',
    defaultValue: false,
    resetOnHide: false,
    hideExpression: (model: any) => {
      // Only show for custom settings with intervals > 1
      if (model.quickSetting !== 'CUSTOM') {
        return true;
      }
      if (model.repeatCycle === 'DAILY' && model.repeatEvery === 1) {
        return true;
      }
      if (model.repeatCycle === 'WEEKLY' && model.repeatEvery === 1) {
        return true;
      }
      return false;
    },
    templateOptions: {
      label: T.F.TASK_REPEAT.F.SCHEDULE_TYPE_LABEL,
      options: [],
    },
    expressionProperties: {
      ['templateOptions.options']: (model: any) => {
        const repeatEvery = model.repeatEvery || 1;
        const cycleMap: Record<string, string> = {
          DAILY: repeatEvery === 1 ? 'day' : 'days',
          WEEKLY: repeatEvery === 1 ? 'week' : 'weeks',
          MONTHLY: repeatEvery === 1 ? 'month' : 'months',
          YEARLY: repeatEvery === 1 ? 'year' : 'years',
        };
        const cycleName = cycleMap[model.repeatCycle] || 'days';

        return [
          {
            value: false,
            label: `Fixed schedule (every ${repeatEvery} ${cycleName} from start date)`,
          },
          {
            value: true,
            label: `After completion (${repeatEvery} ${cycleName} after I finish)`,
          },
        ];
      },
    },
  },
  {
    key: 'shouldInheritSubtasks',
    type: 'checkbox',
    defaultValue: false,
    templateOptions: {
      label: T.F.TASK_REPEAT.F.INHERIT_SUBTASKS,
      description: T.F.TASK_REPEAT.F.INHERIT_SUBTASKS_DESCRIPTION,
    },
  },
  // child option depending on inherit
  {
    key: 'disableAutoUpdateSubtasks',
    type: 'checkbox',
    defaultValue: false,
    hideExpression: (model: any) => !model.shouldInheritSubtasks,
    templateOptions: {
      label: T.F.TASK_REPEAT.F.DISABLE_AUTO_UPDATE_SUBTASKS,
      description: T.F.TASK_REPEAT.F.DISABLE_AUTO_UPDATE_SUBTASKS_DESCRIPTION,
    },
    className: 'sp-formly-child-option',
  },
  {
    key: 'skipOverdue',
    type: 'checkbox',
    defaultValue: false,
    templateOptions: {
      label: T.F.TASK_REPEAT.F.SKIP_OVERDUE,
      description: T.F.TASK_REPEAT.F.SKIP_OVERDUE_DESCRIPTION,
    },
  },
];
