import {
  TASK_REPEAT_CFG_ADVANCED_FORM_CFG,
  TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG,
} from './task-repeat-cfg-form.const';

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
