import {
  AFTER_COMPLETION_PRESET,
  isCustomOrAfterCompletionPreset,
  keepUneditedAfterCompletionSchedule,
  syncAfterCompletionMode,
  toRepeatCfgFormModel,
  toStoredRepeatCfg,
} from './after-completion-form-mapping';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfgCopy } from '../task-repeat-cfg.model';
import { getTaskRepeatCfgChanges } from './get-task-repeat-cfg-changes';

const cfg = (changes: Partial<TaskRepeatCfgCopy> = {}): TaskRepeatCfgCopy => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'cfg1',
  title: 'Water the plants',
  ...changes,
});

describe('after-completion form mapping (#5388)', () => {
  describe('toRepeatCfgFormModel', () => {
    it('leaves fixed schedules untouched', () => {
      const fixed = cfg({
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
      });
      expect(toRepeatCfgFormModel(fixed)).toBe(fixed);
    });

    it('opens an after-completion config on the dialog-only preset', () => {
      const model = toRepeatCfgFormModel(
        cfg({
          quickSetting: 'CUSTOM',
          repeatFromCompletionDate: true,
          repeatCycle: 'DAILY',
          repeatEvery: 3,
        }),
      );
      expect(model.quickSetting).toBe(AFTER_COMPLETION_PRESET);
      expect(model.repeatCycle).toBe('DAILY');
      expect(model.repeatEvery).toBe(3);
    });

    it('shows whole weeks stored as days as weeks', () => {
      const model = toRepeatCfgFormModel(
        cfg({
          quickSetting: 'CUSTOM',
          repeatFromCompletionDate: true,
          repeatCycle: 'DAILY',
          repeatEvery: 14,
        }),
      );
      expect(model.repeatCycle).toBe('WEEKLY');
      expect(model.repeatEvery).toBe(2);
    });

    it('maps a hidden after-completion flag on a fixed preset to the preset too', () => {
      // resetOnHide:false kept the flag when users switched presets before #5388.
      const model = toRepeatCfgFormModel(
        cfg({ quickSetting: 'DAILY', repeatFromCompletionDate: true }),
      );
      expect(model.quickSetting).toBe(AFTER_COMPLETION_PRESET);
    });
  });

  describe('toStoredRepeatCfg', () => {
    it('never persists the dialog-only preset', () => {
      const stored = toStoredRepeatCfg({
        ...cfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
        repeatCycle: 'DAILY',
        repeatEvery: 2,
      });
      expect(stored.quickSetting).toBe('CUSTOM');
      expect(stored.repeatFromCompletionDate).toBe(true);
    });

    it('stores weeks after completion as days × 7, waiting for completion', () => {
      const stored = toStoredRepeatCfg({
        ...cfg({ monday: false, tuesday: false }),
        quickSetting: AFTER_COMPLETION_PRESET,
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
      });
      expect(stored.repeatCycle).toBe('DAILY');
      expect(stored.repeatEvery).toBe(14);
      expect(stored.waitForCompletion).toBe(true);
    });

    it('keeps months and years after completion as they are', () => {
      const months = toStoredRepeatCfg({
        ...cfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
        repeatCycle: 'MONTHLY',
        repeatEvery: 3,
      });
      expect(months.repeatCycle).toBe('MONTHLY');
      expect(months.repeatEvery).toBe(3);
    });

    it('clears monthly anchors hidden in after-completion mode', () => {
      const stored = toStoredRepeatCfg({
        ...cfg({ monthlyWeekOfMonth: 3, monthlyWeekday: 2, monthlyLastDay: true }),
        quickSetting: AFTER_COMPLETION_PRESET,
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
      });
      expect(stored.monthlyWeekOfMonth).toBeUndefined();
      expect(stored.monthlyWeekday).toBeUndefined();
      expect(stored.monthlyLastDay).toBeUndefined();
    });

    it('accepts the string a number input can leave in the model', () => {
      const stored = toStoredRepeatCfg({
        ...cfg(),
        quickSetting: AFTER_COMPLETION_PRESET,
        repeatCycle: 'WEEKLY',
        repeatEvery: '3' as unknown as number,
      });
      expect(stored.repeatEvery).toBe(21);
    });

    it('drops a hidden after-completion flag from a fixed preset', () => {
      const stored = toStoredRepeatCfg(
        cfg({ quickSetting: 'CUSTOM', repeatFromCompletionDate: true }),
      );
      expect(stored.repeatFromCompletionDate).toBe(false);
    });

    it('returns a fixed config without the flag unchanged (no spurious diff)', () => {
      const fixed = cfg({ quickSetting: 'MONTHLY_CURRENT_DATE' });
      expect(toStoredRepeatCfg(fixed)).toBe(fixed);
    });
  });

  describe('round trip', () => {
    it('is a no-op for an already-normalized after-completion config', () => {
      const stored = cfg({
        quickSetting: 'CUSTOM',
        repeatFromCompletionDate: true,
        waitForCompletion: true,
        repeatCycle: 'DAILY',
        repeatEvery: 14,
      });
      const roundTripped = toStoredRepeatCfg(toRepeatCfgFormModel(stored));
      expect(getTaskRepeatCfgChanges(stored, roundTripped)).toEqual({});
    });

    it('is a no-op for a fixed config', () => {
      const stored = cfg({
        quickSetting: 'CUSTOM',
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
      });
      const roundTripped = toStoredRepeatCfg(toRepeatCfgFormModel(stored));
      expect(getTaskRepeatCfgChanges(stored, roundTripped)).toEqual({});
    });

    it('rewrites a legacy weekly-with-weekday after-completion config as shown', () => {
      // Before #5388 "every 2 weeks after completion" + Monday could land five
      // days after completion. Saved in the new dialog it becomes what it shows.
      const legacy = cfg({
        quickSetting: 'CUSTOM',
        repeatFromCompletionDate: true,
        waitForCompletion: false,
        repeatCycle: 'WEEKLY',
        repeatEvery: 2,
        monday: true,
      });
      const changes = getTaskRepeatCfgChanges(
        legacy,
        toStoredRepeatCfg(toRepeatCfgFormModel(legacy)),
      );
      expect(changes).toEqual({
        repeatCycle: 'DAILY',
        repeatEvery: 14,
        waitForCompletion: true,
      });
    });
  });

  describe('keepUneditedAfterCompletionSchedule', () => {
    const legacy = cfg({
      quickSetting: 'CUSTOM',
      repeatFromCompletionDate: true,
      repeatCycle: 'WEEKLY',
      repeatEvery: 2,
      monday: true,
      monthlyWeekOfMonth: 3,
    });

    it('keeps a legacy schedule when only other fields changed', () => {
      const model = { ...toRepeatCfgFormModel(legacy), title: 'Renamed' };
      const kept = keepUneditedAfterCompletionSchedule(
        legacy,
        model,
        toStoredRepeatCfg(model),
      );
      expect(getTaskRepeatCfgChanges(legacy, kept)).toEqual({
        title: 'Renamed',
        waitForCompletion: true,
      });
    });

    it('keeps a legacy fixed preset with its anchor when only other fields changed', () => {
      const legacyPreset = cfg({
        quickSetting: 'MONTHLY_LAST_DAY',
        repeatFromCompletionDate: true,
        repeatCycle: 'MONTHLY',
        monthlyLastDay: true,
      });
      const model = { ...toRepeatCfgFormModel(legacyPreset), title: 'Renamed' };
      const kept = keepUneditedAfterCompletionSchedule(
        legacyPreset,
        model,
        toStoredRepeatCfg(model),
      );
      expect(getTaskRepeatCfgChanges(legacyPreset, kept)).toEqual({
        title: 'Renamed',
        waitForCompletion: true,
      });
    });

    it('converts the schedule once the user edits it', () => {
      const model = { ...toRepeatCfgFormModel(legacy), repeatEvery: 3 };
      const stored = toStoredRepeatCfg(model);
      expect(keepUneditedAfterCompletionSchedule(legacy, model, stored)).toBe(stored);
      expect(stored.repeatCycle).toBe('DAILY');
      expect(stored.repeatEvery).toBe(21);
    });

    it('does nothing for a config that was not after completion', () => {
      const fixed = cfg({ quickSetting: 'CUSTOM', repeatCycle: 'WEEKLY' });
      const model = {
        ...toRepeatCfgFormModel(fixed),
        quickSetting: AFTER_COMPLETION_PRESET,
      };
      const stored = toStoredRepeatCfg(model);
      expect(keepUneditedAfterCompletionSchedule(fixed, model, stored)).toBe(stored);
    });
  });

  describe('syncAfterCompletionMode', () => {
    const custom = { quickSetting: 'CUSTOM' as const, repeatFromCompletionDate: false };
    const after = {
      quickSetting: AFTER_COMPLETION_PRESET,
      repeatFromCompletionDate: true,
    };

    it('turns the mode on, with waiting, when the preset is picked', () => {
      const next = syncAfterCompletionMode(
        custom,
        { ...custom, ...{ quickSetting: AFTER_COMPLETION_PRESET } },
        false,
      );
      expect(next.repeatFromCompletionDate).toBe(true);
      expect((next as { waitForCompletion?: boolean }).waitForCompletion).toBe(true);
    });

    it('restores the fixed waiting behaviour when leaving the mode', () => {
      const leaveViaPreset = syncAfterCompletionMode(
        after,
        { ...after, quickSetting: 'DAILY' as const, waitForCompletion: true },
        true,
      );
      expect(leaveViaPreset.repeatFromCompletionDate).toBe(false);
      expect(leaveViaPreset.waitForCompletion).toBe(true);
    });

    it('returns the same object when the preset did not change', () => {
      const next = { ...custom, title: 'x' };
      expect(syncAfterCompletionMode(custom, next, false)).toBe(next);
    });

    it('leaves switches between fixed presets alone', () => {
      const next = { quickSetting: 'DAILY' as const, repeatFromCompletionDate: false };
      expect(syncAfterCompletionMode(custom, next, false)).toBe(next);
    });
  });

  describe('isCustomOrAfterCompletionPreset', () => {
    it('is true for both presets that show the custom block', () => {
      expect(isCustomOrAfterCompletionPreset('CUSTOM')).toBe(true);
      expect(isCustomOrAfterCompletionPreset(AFTER_COMPLETION_PRESET)).toBe(true);
      expect(isCustomOrAfterCompletionPreset('DAILY')).toBe(false);
      expect(isCustomOrAfterCompletionPreset(undefined)).toBe(false);
    });
  });
});
