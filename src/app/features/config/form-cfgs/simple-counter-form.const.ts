import { ConfigFormSection } from '../global-config.model';
import {
  SimpleCounterConfig,
  SimpleCounterType,
} from '../../simple-counter/simple-counter.model';
import { T } from '../../../t.const';
import { EMPTY_SIMPLE_COUNTER } from '../../simple-counter/simple-counter.const';
import { nanoid } from 'nanoid';
import { FormlyFieldConfig } from '@ngx-formly/core';

export const SIMPLE_COUNTER_FORM: ConfigFormSection<SimpleCounterConfig> = {
  title: T.F.SIMPLE_COUNTER.FORM.TITLE,
  key: 'EMPTY',
  customSection: 'SIMPLE_COUNTER_CFG',
  help: T.F.SIMPLE_COUNTER.FORM.HELP,
  items: [
    {
      key: 'counters',
      type: 'repeat',
      className: 'simple-counters',
      templateOptions: {
        addText: T.F.SIMPLE_COUNTER.FORM.ADD_NEW,
        getInitialValue: () => ({
          ...EMPTY_SIMPLE_COUNTER,
          id: nanoid(),
          isEnabled: true,
        }),
      },
      fieldArray: {
        fieldGroup: [
          {
            type: 'input',
            key: 'title',
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_TITLE,
            },
          },
          {
            type: 'checkbox',
            key: 'isEnabled',
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_IS_ENABLED,
            },
          },
          {
            key: 'type',
            type: 'select',
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_TYPE,
              required: true,
              options: [
                {
                  label: T.F.SIMPLE_COUNTER.FORM.TYPE_STOPWATCH,
                  value: SimpleCounterType.StopWatch,
                },
                {
                  label: T.F.SIMPLE_COUNTER.FORM.TYPE_CLICK_COUNTER,
                  value: SimpleCounterType.ClickCounter,
                },
                {
                  label: T.F.SIMPLE_COUNTER.FORM.TYPE_REPEATED_COUNTDOWN,
                  value: SimpleCounterType.RepeatedCountdownReminder,
                },
              ],
            },
          },
          {
            type: 'icon',
            key: 'icon',
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_ICON,
              description: T.G.ICON_INP_DESCRIPTION,
            },
          },
          {
            key: 'countdownDuration',
            type: 'duration',
            hideExpression: (model: any) => {
              return model.type !== SimpleCounterType.RepeatedCountdownReminder;
            },
            hooks: {
              onInit: (field) => {
                if (!field?.formControl?.value && field?.formControl?.value !== null) {
                  field?.formControl?.setValue(30 * 60000);
                }
              },
            },
            templateOptions: {
              required: false,
              isAllowSeconds: false,
              label: T.F.SIMPLE_COUNTER.FORM.L_COUNTDOWN_DURATION,
              description: T.G.DURATION_DESCRIPTION,
            },
          },
          {
            type: 'checkbox',
            key: 'isTrackStreaks',
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_TRACK_STREAKS,
            },
          },
          {
            key: 'streakMinValue',
            type: 'input',
            expressions: {
              hide: (fCfg: FormlyFieldConfig) =>
                fCfg.model.type === SimpleCounterType.StopWatch ||
                !fCfg.model.isTrackStreaks,
            },
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_DAILY_GOAL,
              type: 'number',
              min: 1,
              required: true,
              getInitialValue: () => 1,
            },
          },
          {
            key: 'streakMinValue',
            type: 'duration',
            expressions: {
              hide: (fCfg: FormlyFieldConfig) =>
                fCfg.model.type !== SimpleCounterType.StopWatch ||
                !fCfg.model.isTrackStreaks,
            },
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_DAILY_GOAL,
              min: 60 * 1000,
              required: true,
              description: T.G.DURATION_DESCRIPTION,
              getInitialValue: () => 10 * 60 * 1000,
            },
          },
          {
            key: 'streakMode',
            type: 'select',
            expressions: {
              hide: (fCfg: FormlyFieldConfig) => !fCfg.model.isTrackStreaks,
            },
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_STREAK_MODE,
              required: true,
              options: [
                {
                  label: T.F.SIMPLE_COUNTER.FORM.L_STREAK_MODE_SPECIFIC_DAYS,
                  value: 'specific-days',
                },
                {
                  label: T.F.SIMPLE_COUNTER.FORM.L_STREAK_MODE_WEEKLY_FREQUENCY,
                  value: 'weekly-frequency',
                },
              ],
              getInitialValue: () => 'specific-days',
            },
          },
          {
            key: 'streakWeekDays',
            type: 'multicheckbox',
            expressions: {
              hide: (fCfg: FormlyFieldConfig) =>
                !fCfg.model.isTrackStreaks ||
                (fCfg.model.streakMode && fCfg.model.streakMode !== 'specific-days'),
            },
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_WEEKDAYS,
              required: true,
              options: [
                { label: T.F.TASK_REPEAT.F.MONDAY, value: 1 },
                { label: T.F.TASK_REPEAT.F.TUESDAY, value: 2 },
                { label: T.F.TASK_REPEAT.F.WEDNESDAY, value: 3 },
                { label: T.F.TASK_REPEAT.F.THURSDAY, value: 4 },
                { label: T.F.TASK_REPEAT.F.FRIDAY, value: 5 },
                { label: T.F.TASK_REPEAT.F.SATURDAY, value: 6 },
                { label: T.F.TASK_REPEAT.F.SUNDAY, value: 0 },
              ],
            },
          },
          {
            key: 'streakWeeklyFrequency',
            type: 'input',
            expressions: {
              hide: (fCfg: FormlyFieldConfig) =>
                !fCfg.model.isTrackStreaks ||
                !fCfg.model.streakMode ||
                fCfg.model.streakMode !== 'weekly-frequency',
            },
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_WEEKLY_FREQUENCY,
              type: 'number',
              min: 1,
              max: 7,
              required: true,
              getInitialValue: () => 3,
            },
          },
          {
            type: 'checkbox',
            key: 'isHideButton',
            templateOptions: {
              label: T.F.SIMPLE_COUNTER.FORM.L_IS_HIDE_BUTTON,
            },
          },
        ],
      },
    },
  ],
};
