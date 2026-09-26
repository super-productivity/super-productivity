import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { capDateAtRepeatUntilDay, isAfterRepeatUntilDay } from './repeat-until-day.util';

const mkCfg = (repeatUntilDay?: string): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'test-id',
  repeatUntilDay,
});

describe('repeat-until-day util (#10091)', () => {
  describe('isAfterRepeatUntilDay', () => {
    it('is false without an end day', () => {
      expect(isAfterRepeatUntilDay(mkCfg(), new Date(2099, 0, 1))).toBe(false);
    });

    it('is false on the end day at any time (inclusive)', () => {
      expect(isAfterRepeatUntilDay(mkCfg('2026-03-05'), new Date(2026, 2, 5, 0, 0))).toBe(
        false,
      );
      expect(
        isAfterRepeatUntilDay(mkCfg('2026-03-05'), new Date(2026, 2, 5, 23, 59)),
      ).toBe(false);
    });

    it('is true from the next local day on', () => {
      expect(isAfterRepeatUntilDay(mkCfg('2026-03-05'), new Date(2026, 2, 6, 0, 0))).toBe(
        true,
      );
    });
  });

  describe('capDateAtRepeatUntilDay', () => {
    it('returns the same date when not past the end day', () => {
      const d = new Date(2026, 2, 4, 9);
      expect(capDateAtRepeatUntilDay(mkCfg('2026-03-05'), d)).toBe(d);
      expect(capDateAtRepeatUntilDay(mkCfg(), d)).toBe(d);
    });

    it('caps a later date to noon on the end day', () => {
      const capped = capDateAtRepeatUntilDay(
        mkCfg('2026-03-05'),
        new Date(2026, 5, 1, 8),
      );
      expect(getDbDateStr(capped)).toBe('2026-03-05');
      expect(capped.getHours()).toBe(12);
    });
  });
});
