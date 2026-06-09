import { FormlyFieldConfig } from '@ngx-formly/core';
import { T } from '../../../t.const';
import { isValidSplitTime } from '../../../util/is-valid-split-time';
import { TASK_REMINDER_OPTIONS } from '../../planner/dialog-schedule-task/task-reminder-options.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
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
    // Default to a 'YYYY-MM-DD' string (not a Date): Formly skips `parsers` on
    // `defaultValue`, so a raw Date would slip into the model and downstream
    // `dateStrToUtcDate` would choke on it, crashing the dialog (#7945).
    defaultValue: getDbDateStr(),
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
        // Pass the selected start date as the reference, else date-writing
        // presets (MONTHLY_CURRENT_DATE etc.) stamp *today* into the model and
        // silently overwrite a user-picked future anchor (save-time recompute
        // then reads the overwritten value).
        const sd = (field.model as { startDate?: string | Date } | undefined)?.startDate;
        const referenceDate =
          sd instanceof Date ? sd : sd ? dateStrToUtcDate(sd) : undefined;
        const updatesForQuickSetting = getQuickSettingUpdates(
          event.value as RepeatQuickSetting,
          referenceDate,
        );
        if (updatesForQuickSetting) {
          // NOTE: for some reason this doesn't update the model value, just the view value :(
          updateParent(field, updatesForQuickSetting);
        }
      },
    },
  },

  // REPEAT CFG END
  // NOTE: the legacy "Custom" recurrence container (repeat-every / cycle /
  // weekday / monthly-anchor controls) was removed — the RRULE builder replaces
  // it. Existing legacy cfgs are migrated to RRULE on open
  // (legacyTaskRepeatCfgToRRule + _processQuickSettingForDate).
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
    key: 'waitForCompletion',
    type: 'checkbox',
    defaultValue: false,
    templateOptions: {
      label: T.F.TASK_REPEAT.F.WAIT_FOR_COMPLETION,
      description: T.F.TASK_REPEAT.F.WAIT_FOR_COMPLETION_DESCRIPTION,
    },
  },
  // NOTE: the "Schedule type" (repeatFromCompletionDate) select was removed from
  // here along with the legacy Custom UI — the RRULE builder owns that toggle now
  // (RruleBuilderComponent.repeatFromCompletion). #5326 / #5388.
  {
    key: 'skipOverdue',
    type: 'checkbox',
    defaultValue: false,
    templateOptions: {
      label: T.F.TASK_REPEAT.F.SKIP_OVERDUE,
      description: T.F.TASK_REPEAT.F.SKIP_OVERDUE_DESCRIPTION,
    },
  },
  // NOTE: a 'createForEachMissed' (backfill one task per missed occurrence)
  // checkbox was removed from this slice — the scheduling engine has no support
  // for it yet (occurrence engine creates the newest missed only). Re-add the
  // field together with the engine behavior.
];
