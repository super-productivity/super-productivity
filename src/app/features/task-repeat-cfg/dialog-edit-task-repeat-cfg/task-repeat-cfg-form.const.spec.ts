import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
} from './task-repeat-cfg-form.const';
import { T } from '../../../t.const';

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
