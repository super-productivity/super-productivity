import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
} from './task-repeat-cfg-form.const';
import { TaskReminderOptionId } from '../../tasks/task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('TaskRepeatCfgFormConfig', () => {
  describe('startDate field parser (issue #6860)', () => {
    const startDateField = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
      (field) => field.key === 'startDate',
    );
    const parser = startDateField?.parsers?.[0] as (val: unknown) => unknown;

    it('should have a parser defined', () => {
      expect(parser).toBeDefined();
    });

    it('should convert Date objects to date strings', () => {
      const date = new Date(2026, 2, 18);
      expect(parser(date)).toBe(getDbDateStr(date));
    });

    it('should pass through string values unchanged', () => {
      expect(parser('2026-03-18')).toBe('2026-03-18');
    });

    it('should NOT convert null to epoch date (1970-01-01)', () => {
      // This is the core regression test for issue #6860:
      // getDbDateStr(null) returns '1970-01-01', but the parser should
      // pass null through so the required validator can handle it
      expect(parser(null)).toBeNull();
    });

    it('should pass through undefined unchanged', () => {
      expect(parser(undefined)).toBeUndefined();
    });

    // Regression test for #7945: a `new Date()` default bypasses `parsers`, so a
    // raw Date object would reach the model and crash the dialog. The default
    // must already be a 'YYYY-MM-DD' string.
    it('should default to a YYYY-MM-DD string, not a Date', () => {
      expect(typeof startDateField?.defaultValue).toBe('string');
      expect(startDateField?.defaultValue).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    });
  });

  describe('remindAt field', () => {
    const remindAtField = TASK_REPEAT_CFG_ADVANCED_FORM_CFG.flatMap((field) =>
      field.fieldGroup ? field.fieldGroup : [field],
    )
      .flatMap((field) => (field.fieldGroup ? field.fieldGroup : [field]))
      .find((field) => field.key === 'remindAt');

    it('should have a remindAt field configured', () => {
      expect(remindAtField).toBeDefined();
    });

    it('should have a defaultValue of AtStart to prevent undefined remindAt bug', () => {
      // This test ensures the fix for the bug where repeatable tasks with time
      // were always scheduled with remindAt set to "never" because the form
      // field lacked a defaultValue, causing Formly to not properly bind
      // the initial model value.
      expect(remindAtField?.defaultValue).toBe(TaskReminderOptionId.AtStart);
    });

    it('should be hidden when startTime is not set', () => {
      expect(remindAtField?.hideExpression).toBe('!model.startTime');
    });

    it('should be a required select field', () => {
      expect(remindAtField?.type).toBe('select');
      expect(remindAtField?.templateOptions?.required).toBe(true);
    });
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
