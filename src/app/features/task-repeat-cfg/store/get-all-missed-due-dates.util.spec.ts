import {
  getAllMissedDueDates,
  MAX_CREATE_FOR_EACH_MISSED,
} from './get-all-missed-due-dates.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

const cfg = (fields: Partial<TaskRepeatCfg>): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'CREATE_FOR_EACH_MISSED_CFG',
  title: 'create for each missed',
  projectId: null,
  monday: false,
  tuesday: false,
  wednesday: false,
  thursday: false,
  friday: false,
  saturday: false,
  sunday: false,
  ...fields,
});

const noon = (d: Date): Date => {
  const x = new Date(d);
  x.setHours(12, 0, 0, 0);
  return x;
};

describe('getAllMissedDueDates()', () => {
  describe('DAILY', () => {
    it('returns every missed day after lastTaskCreationDay up to and incl. today', () => {
      const result = getAllMissedDueDates(
        cfg({
          repeatCycle: 'DAILY',
          repeatEvery: 1,
          startDate: '2024-01-01',
          lastTaskCreationDay: '2024-01-01',
        }),
        new Date(2024, 0, 5),
      );

      expect(result).toEqual([
        noon(new Date(2024, 0, 2)),
        noon(new Date(2024, 0, 3)),
        noon(new Date(2024, 0, 4)),
        noon(new Date(2024, 0, 5)),
      ]);
    });

    it('returns [] when no occurrence was missed (last creation is today)', () => {
      const result = getAllMissedDueDates(
        cfg({
          repeatCycle: 'DAILY',
          repeatEvery: 1,
          startDate: '2024-01-01',
          lastTaskCreationDay: '2024-01-05',
        }),
        new Date(2024, 0, 5),
      );

      expect(result).toEqual([]);
    });

    it('honors repeatEvery (every 2 days)', () => {
      const result = getAllMissedDueDates(
        cfg({
          repeatCycle: 'DAILY',
          repeatEvery: 2,
          startDate: '2024-01-01',
          lastTaskCreationDay: '2024-01-01',
        }),
        new Date(2024, 0, 7),
      );

      // start 01-01, so scheduled days are 01-03, 01-05, 01-07 (01-01 already created)
      expect(result).toEqual([
        noon(new Date(2024, 0, 3)),
        noon(new Date(2024, 0, 5)),
        noon(new Date(2024, 0, 7)),
      ]);
    });

    it('caps the result at MAX_CREATE_FOR_EACH_MISSED, keeping the most recent', () => {
      const result = getAllMissedDueDates(
        cfg({
          repeatCycle: 'DAILY',
          repeatEvery: 1,
          startDate: '2024-01-01',
          lastTaskCreationDay: '2024-01-01',
        }),
        new Date(2024, 5, 1), // 2024-06-01, ~152 days later
      );

      expect(result.length).toBe(MAX_CREATE_FOR_EACH_MISSED);
      // newest is today, oldest is 29 days before today
      expect(result[result.length - 1]).toEqual(noon(new Date(2024, 5, 1)));
      expect(result[0]).toEqual(noon(new Date(2024, 4, 3))); // 2024-05-03
    });
  });

  describe('WEEKLY', () => {
    it('returns only scheduled weekdays that were missed', () => {
      // Mondays only. 2024-01-01 is a Monday.
      const result = getAllMissedDueDates(
        cfg({
          repeatCycle: 'WEEKLY',
          repeatEvery: 1,
          monday: true,
          startDate: '2024-01-01',
          lastTaskCreationDay: '2024-01-01',
        }),
        new Date(2024, 0, 22), // 2024-01-22 is a Monday
      );

      expect(result).toEqual([
        noon(new Date(2024, 0, 8)),
        noon(new Date(2024, 0, 15)),
        noon(new Date(2024, 0, 22)),
      ]);
    });
  });

  describe('edge cases', () => {
    it('returns [] when start date is in the future', () => {
      const result = getAllMissedDueDates(
        cfg({
          repeatCycle: 'DAILY',
          repeatEvery: 1,
          startDate: '2024-06-01',
          lastTaskCreationDay: '2024-01-01',
        }),
        new Date(2024, 0, 5),
      );

      expect(result).toEqual([]);
    });
  });
});
