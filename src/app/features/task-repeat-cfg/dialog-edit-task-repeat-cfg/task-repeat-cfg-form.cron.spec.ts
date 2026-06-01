import { FormlyFieldConfig } from '@ngx-formly/core';
import { TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG } from './task-repeat-cfg-form.const';
import { T } from '../../../t.const';

// Exercises the cronExpression field's validator + live-preview description via
// the exported form config, using raw cron values so the assertions do not
// depend on the (browser-only) WASM translator.

const findField = (
  fields: FormlyFieldConfig[],
  key: string,
): FormlyFieldConfig | undefined => {
  for (const f of fields) {
    if (f.key === key) return f;
    if (f.fieldGroup) {
      const found = findField(f.fieldGroup, key);
      if (found) return found;
    }
  }
  return undefined;
};

describe('task-repeat cron field config', () => {
  // Unrecognized inputs reach the lazy WASM loader; stub fetch so it fails fast
  // instead of leaving a hanging request that leaks across specs.
  beforeEach(() => {
    spyOn(window, 'fetch').and.rejectWith(new Error('no network in test'));
  });

  const field = findField(TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG, 'cronExpression');
  const validate = (value: unknown): boolean =>
    (field as any).validators.validCron.expression({ value });
  const describeFor = (cronExpression: string): string =>
    (field as any).expressionProperties['templateOptions.description']({
      cronExpression,
    });

  it('the cronExpression field exists', () => {
    expect(field).toBeDefined();
  });

  describe('validCron validator', () => {
    it('accepts empty (required handles emptiness separately)', () => {
      expect(validate('')).toBe(true);
      expect(validate(undefined)).toBe(true);
    });

    it('accepts valid raw cron', () => {
      expect(validate('0 9 * * 1')).toBe(true);
      expect(validate('0 0 0 ? * MON')).toBe(true);
    });

    it('rejects clearly invalid input', () => {
      expect(validate('definitely not a cron')).toBe(false);
    });
  });

  describe('live preview description', () => {
    it('shows the interpreted cron and an English reading', () => {
      const d = describeFor('0 0 0 ? * MON');
      expect(d).toContain('0 0 0 ? * MON');
      expect(d.toLowerCase()).toContain('monday');
    });

    it('warns that time of day is ignored when a time is specified', () => {
      expect(describeFor('0 0 9 ? * MON')).toContain('time of day is ignored');
    });

    it('does NOT warn about time for a plain midnight schedule', () => {
      expect(describeFor('0 0 0 ? * MON')).not.toContain('time of day is ignored');
    });

    it('warns "once per day" for a sub-daily schedule', () => {
      const d = describeFor('0 * * * * ?');
      expect(d).toContain('once per day');
    });

    it('falls back to the static hint for unrecognized input', () => {
      expect(describeFor('definitely not a cron')).toBe(
        T.F.TASK_REPEAT.F.CRON_EXPRESSION_DESCRIPTION,
      );
    });
  });
});
