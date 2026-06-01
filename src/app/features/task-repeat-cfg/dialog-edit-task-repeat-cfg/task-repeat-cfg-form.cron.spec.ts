import { FormlyFieldConfig } from '@ngx-formly/core';
import { TASK_REPEAT_CFG_ESSENTIAL_FORM_CFG } from './task-repeat-cfg-form.const';
import { getCronPreview } from '../util/cron-preview.util';

// Covers the cronExpression field's validator (via the exported form config)
// and the live-preview helper (getCronPreview) the dialog renders below the
// field. Raw cron values keep these assertions independent of the browser-only
// WASM translator.

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
    (
      field as {
        validators: { validCron: { expression: (c: { value: unknown }) => boolean } };
      }
    ).validators.validCron.expression({ value });

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
});

describe('getCronPreview()', () => {
  it('returns the interpreted cron and an English reading', () => {
    const p = getCronPreview('0 0 0 ? * MON');
    expect(p).not.toBeNull();
    expect(p!.cron).toBe('0 0 0 ? * MON');
    expect(p!.human.toLowerCase()).toContain('monday');
  });

  it('flags a specific time of day as timed', () => {
    const p = getCronPreview('0 0 9 ? * MON');
    expect(p!.timed).toBe(true);
    expect(p!.subDaily).toBe(false);
  });

  it('does not flag a plain midnight schedule as timed', () => {
    const p = getCronPreview('0 0 0 ? * MON');
    expect(p!.timed).toBe(false);
  });

  it('flags a sub-daily schedule (and treats it as timed)', () => {
    const p = getCronPreview('0 * * * * ?');
    expect(p!.subDaily).toBe(true);
    expect(p!.timed).toBe(true);
  });

  it('returns null for empty / unrecognized input', () => {
    expect(getCronPreview('')).toBeNull();
    expect(getCronPreview('   ')).toBeNull();
    expect(getCronPreview(undefined)).toBeNull();
  });
});
