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

  // NOTE: the 'repeatFromCompletionDate' Formly select was removed along with the
  // legacy Custom UI — the RRULE builder owns that toggle now (covered by
  // rrule-builder.component.spec).

  describe('quickSetting change handler', () => {
    const getChangeHandler = (): ((field: unknown, event: unknown) => void) => {
      const field = TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG.find(
        (f) => f.key === 'quickSetting',
      );
      return field!.templateOptions!.change as (field: unknown, event: unknown) => void;
    };

    const callWith = (
      startDate: string | undefined,
      quickSetting: string,
    ): Record<string, unknown> => {
      let patched: Record<string, unknown> = {};
      const field = {
        model: { startDate },
        form: {
          patchValue: (v: Record<string, unknown>) => {
            patched = v;
          },
        },
      };
      getChangeHandler()(field, { value: quickSetting });
      return patched;
    };

    it('uses the selected start date for date-writing presets (not today)', () => {
      // Regression: without the reference date, MONTHLY_CURRENT_DATE stamped
      // *today* into the model, overwriting a user-picked future anchor.
      const patched = callWith('2099-09-15', 'MONTHLY_CURRENT_DATE');
      expect(patched['startDate']).toBe('2099-09-15');
    });

    it('uses the selected start date for the weekday flags of weekly presets', () => {
      // 2099-09-14 is a Monday.
      const patched = callWith('2099-09-14', 'WEEKLY_CURRENT_WEEKDAY');
      expect(patched['monday']).toBe(true);
      expect(patched['tuesday']).toBe(false);
    });

    it('falls back to today when no start date is set', () => {
      const patched = callWith(undefined, 'MONTHLY_CURRENT_DATE');
      expect(typeof patched['startDate']).toBe('string');
    });
  });
});
