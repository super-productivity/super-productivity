import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG,
  TASK_REPEAT_CFG_END_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
  getWeekdayChipLabels,
  withRepeatCycleUnits,
  withWeekdayShortLabels,
} from './task-repeat-cfg-form.const';
import { T } from '../../../t.const';
import { FormlyFieldConfig } from '@ngx-formly/core';
import { AFTER_COMPLETION_PRESET } from './after-completion-form-mapping';

describe('TaskRepeatCfgFormConfig', () => {
  it('should not contain startDate in essential form fields', () => {
    const startDateField = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
      (field) => field.key === 'startDate',
    );
    expect(startDateField).toBeUndefined();
  });

  it('should not contain startTime or remindAt in advanced form fields', () => {
    const flatFields = TASK_REPEAT_CFG_ADVANCED_FORM_CFG.flatMap((field) =>
      field.fieldGroup ? field.fieldGroup : [field],
    ).flatMap((field) => (field.fieldGroup ? field.fieldGroup : [field]));

    const startTimeField = flatFields.find((field) => field.key === 'startTime');
    const remindAtField = flatFields.find((field) => field.key === 'remindAt');

    expect(startTimeField).toBeUndefined();
    expect(remindAtField).toBeUndefined();
  });

  // The dialog reads top to bottom: what repeats, when it starts and ends, then
  // in Options how the series behaves and what new copies get.
  it('groups the fields in dialog order', () => {
    const keys = (cfg: FormlyFieldConfig[]): unknown[] => cfg.map((f) => f.key);
    expect(keys(TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG).slice(0, 2)).toEqual([
      'title',
      'quickSetting',
    ]);
    expect(keys(TASK_REPEAT_CFG_END_FORM_CFG)).toEqual(['repeatUntilDay']);
    expect(keys(TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG)).toEqual(['fallBehind', 'isPaused']);
    expect(keys(TASK_REPEAT_CFG_ADVANCED_FORM_CFG)).toEqual([
      'priority',
      'defaultEstimate',
      'deadlineOffsetDays',
      'notes',
      'shouldInheritSubtasks',
      'disableAutoUpdateSubtasks',
    ]);
  });

  describe('repeatUntilDay field (#10091)', () => {
    const field = TASK_REPEAT_CFG_END_FORM_CFG.find((f) => f.key === 'repeatUntilDay');
    const parse = (value: unknown): unknown => (field!.parsers![0] as any)(value);

    it('is an optional date field', () => {
      expect(field?.type).toBe('date');
      expect(field?.templateOptions?.required).toBeFalsy();
    });

    it('stores a picked Date as a local YYYY-MM-DD string', () => {
      expect(parse(new Date(2026, 2, 5, 0, 0))).toBe('2026-03-05');
    });

    it('stores a cleared picker as undefined, never null', () => {
      expect(parse(null)).toBeUndefined();
      expect(parse(undefined)).toBeUndefined();
    });

    it('keeps an already-stored string untouched', () => {
      expect(parse('2026-03-05')).toBe('2026-03-05');
    });

    it('uses the start date as the minimum', () => {
      const minExpr = field?.expressionProperties?.['templateOptions.min'] as (
        m: unknown,
      ) => unknown;
      expect(minExpr({ startDate: '2026-01-10' })).toBe('2026-01-10');
      expect(minExpr({})).toBeUndefined();
    });
  });

  it('explains that Day of month uses the start date (#8886)', () => {
    const repeatContainer = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
      (field) => field.fieldGroupClassName === 'repeat-config-container',
    );
    const monthlyAnchor = repeatContainer?.fieldGroup?.find(
      (field) => field.fieldGroupClassName === 'monthly-anchor',
    );
    const monthlyPattern = monthlyAnchor?.fieldGroup?.find(
      (field) => field.key === 'monthlyWeekOfMonth',
    );

    expect(monthlyPattern?.templateOptions?.description).toBe(
      T.F.TASK_REPEAT.F.MONTHLY_MODE_DAY_OF_MONTH_DESCRIPTION,
    );
  });

  describe('after completion (#5388)', () => {
    const repeatContainer = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
      (field) => field.fieldGroupClassName === 'repeat-config-container',
    );
    const hide = (field: FormlyFieldConfig | undefined, model: object): boolean =>
      (field?.hideExpression as (m: object) => boolean)(model);

    it('shows the custom block for Custom and for the after-completion preset', () => {
      expect(hide(repeatContainer, { quickSetting: 'CUSTOM' })).toBe(false);
      expect(hide(repeatContainer, { quickSetting: AFTER_COMPLETION_PRESET })).toBe(
        false,
      );
      expect(hide(repeatContainer, { quickSetting: 'DAILY' })).toBe(true);
    });

    // The preset is the one switch; a second control for it only invited
    // "which one wins?".
    it('offers no separate schedule type control', () => {
      const keys = (cfg: FormlyFieldConfig[]): unknown[] =>
        cfg.flatMap((f) => [f.key, ...keys(f.fieldGroup ?? [])]);
      expect(
        [
          ...TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
          ...TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG,
          ...TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
        ].flatMap((f) => keys([f])),
      ).not.toContain('repeatFromCompletionDate');
    });

    it('hides the monthly pattern after completion', () => {
      const monthlyAnchor = repeatContainer?.fieldGroup?.find(
        (field) => field.fieldGroupClassName === 'monthly-anchor',
      );
      expect(
        hide(monthlyAnchor, { repeatCycle: 'MONTHLY', quickSetting: 'CUSTOM' }),
      ).toBe(false);
      expect(
        hide(monthlyAnchor, {
          repeatCycle: 'MONTHLY',
          quickSetting: AFTER_COMPLETION_PRESET,
        }),
      ).toBe(true);
    });

    it('replaces the two pile-up checkboxes with one "If you fall behind" choice', () => {
      const keys = [
        ...TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG,
        ...TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
      ].map((f) => f.key);
      expect(keys).not.toContain('waitForCompletion');
      expect(keys).not.toContain('skipOverdue');
      const fallBehind = TASK_REPEAT_CFG_BEHAVIOUR_FORM_CFG.find(
        (f) => f.key === 'fallBehind',
      );
      expect(
        (fallBehind?.templateOptions?.options as { value: string }[]).map((o) => o.value),
      ).toEqual(['KEEP', 'LATEST', 'WAIT']);
      // after completion always waits
      expect(hide(fallBehind, { quickSetting: 'CUSTOM' })).toBe(false);
      expect(hide(fallBehind, { quickSetting: AFTER_COMPLETION_PRESET })).toBe(true);
    });
  });

  it('reads the unit options plural for any number but 1, translated', () => {
    const fields = withRepeatCycleUnits(
      TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
      (key) => key.split('.').pop()!,
    );
    const cycle = fields
      .find((f) => f.fieldGroupClassName === 'repeat-config-container')
      ?.fieldGroup?.find((f) => f.fieldGroupClassName === 'repeat-cycle')
      ?.fieldGroup?.find((f) => f.key === 'repeatCycle');
    const options = cycle?.expressionProperties?.['templateOptions.options'] as (m: {
      repeatEvery: unknown;
    }) => { label: string }[];

    expect(options({ repeatEvery: 1 }).map((o) => o.label)).toEqual([
      'C_DAY',
      'C_WEEK',
      'C_MONTH',
      'C_YEAR',
    ]);
    expect(options({ repeatEvery: '3' }).map((o) => o.label)).toEqual([
      'C_DAYS',
      'C_WEEKS',
      'C_MONTHS',
      'C_YEARS',
    ]);
  });

  describe('weekdays group visibility (issue #8025)', () => {
    const repeatContainer = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
      (field) => field.fieldGroupClassName === 'repeat-config-container',
    );
    const weekdaysGroup = repeatContainer?.fieldGroup?.find(
      (field) => field.fieldGroupClassName === 'weekdays',
    );
    const WEEKDAY_KEYS = [
      'monday',
      'tuesday',
      'wednesday',
      'thursday',
      'friday',
      'saturday',
      'sunday',
    ];

    it('should locate the weekdays group', () => {
      expect(weekdaysGroup).toBeDefined();
      expect(weekdaysGroup?.fieldGroup?.length).toBe(7);
    });

    // Regression guard for #8025: a `hideExpression` makes formly destroy and
    // recreate the checkbox views on every cycle switch, which breaks their
    // wiring to the FormControls (clicks stop updating the model after a
    // Week -> Month -> Week round-trip). Visibility must be driven by CSS instead.
    it('is a row of day chips named as a group', () => {
      expect(weekdaysGroup?.wrappers).toEqual(['labelled-group']);
      expect(weekdaysGroup?.templateOptions?.label).toBe(T.F.TASK_REPEAT.F.REPEAT_ON);
      expect(weekdaysGroup?.fieldGroup?.every((f) => f.type === 'chip-checkbox')).toBe(
        true,
      );
    });

    it("puts the locale's short weekday names on the chips, as a copy", () => {
      const fields = withWeekdayShortLabels(TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG, 'en-US');
      const labelled = fields
        .find((f) => f.fieldGroupClassName === 'repeat-config-container')
        ?.fieldGroup?.find((f) => f.fieldGroupClassName === 'weekdays');

      expect(labelled?.fieldGroup?.map((f) => f.templateOptions?.['shortLabel'])).toEqual(
        ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
      );
      expect(labelled?.fieldGroup?.[0].templateOptions?.label).toBe(
        T.F.TASK_REPEAT.F.MONDAY,
      );
      expect(
        weekdaysGroup?.fieldGroup?.[0].templateOptions?.['shortLabel'],
      ).toBeUndefined();
    });

    // Arabic short names are the full words, all starting with "ال"; clipped
    // on a phone the seven chips read the same.
    it('uses the narrow names where the short ones are too long for a chip', () => {
      const arabic = getWeekdayChipLabels('ar');
      expect(arabic.every((label) => label.length === 1)).toBe(true);
      expect(new Set(arabic).size).toBe(7);
    });

    it('keeps the short names where the narrow ones repeat a letter', () => {
      // Polish narrow names are "P W Ś C P S N": Monday and Friday would match.
      expect(getWeekdayChipLabels('pl')[4]).toBe(
        new Date(2024, 0, 5).toLocaleDateString('pl', { weekday: 'short' }),
      );
      expect(getWeekdayChipLabels('en-US')[0]).toBe('Mon');
    });

    it('should NOT use hideExpression (it would re-freeze the checkboxes)', () => {
      expect(weekdaysGroup?.hideExpression).toBeUndefined();
    });

    it('should toggle visibility via a dynamic className bound to repeatCycle', () => {
      const className = weekdaysGroup?.expressionProperties?.['className'] as (model: {
        repeatCycle: string;
      }) => string;
      expect(className).toEqual(jasmine.any(Function));
      expect(className({ repeatCycle: 'WEEKLY' })).toBe('');
      expect(className({ repeatCycle: 'MONTHLY' })).toBe('repeat-cfg-hidden');
      expect(className({ repeatCycle: 'YEARLY' })).toBe('repeat-cfg-hidden');
      expect(className({ repeatCycle: 'DAILY' })).toBe('repeat-cfg-hidden');
    });

    it('hides the weekdays after completion, where weeks are a plain interval (#5388)', () => {
      const className = weekdaysGroup?.expressionProperties?.['className'] as (model: {
        repeatCycle: string;
        quickSetting: string;
      }) => string;
      expect(className({ repeatCycle: 'WEEKLY', quickSetting: 'CUSTOM' })).toBe('');
      expect(
        className({ repeatCycle: 'WEEKLY', quickSetting: AFTER_COMPLETION_PRESET }),
      ).toBe('repeat-cfg-hidden');
    });

    // The group stays mounted, but the CUSTOM container above it still hides via
    // hideExpression. Each checkbox needs resetOnHide:false so the selection
    // survives a quickSetting != CUSTOM round-trip instead of being wiped.
    it('should keep every weekday checkbox value across hide (resetOnHide:false)', () => {
      WEEKDAY_KEYS.forEach((key) => {
        const field = weekdaysGroup?.fieldGroup?.find((f) => f.key === key);
        expect(field).withContext(`weekday field "${key}" exists`).toBeDefined();
        expect(field?.resetOnHide)
          .withContext(`weekday field "${key}" resetOnHide`)
          .toBe(false);
      });
    });
  });
});
