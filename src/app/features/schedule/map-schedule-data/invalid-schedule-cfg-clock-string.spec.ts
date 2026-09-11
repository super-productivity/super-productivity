import { createSortedBlockerBlocks } from './create-sorted-blocker-blocks';
import { createScheduleDays } from './create-schedule-days';
import { BlockedBlockType } from '../schedule.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { _resetDevErrorState } from '../../../util/dev-error';
import { isTaskOutsideWorkHours } from '../../tasks/util/is-task-outside-work-hours';
import { ScheduleConfig } from '../../config/global-config.model';

/**
 * Reproduction for the "Invalid clock string" crash on opening the Schedule
 * panel (#5358, and the schedule-route variant in #4842).
 *
 * The repeat-cfg call sites were guarded in #7067, but the ones fed by the
 * *schedule config* (workStart/workEnd/lunchBreakStart/lunchBreakEnd) still
 * call getDateTimeFromClockString bare. A malformed value there is not
 * repairable by anything downstream:
 *
 *  - the settings form validates, but `loadAllData` spreads an incoming
 *    `globalConfig` over the defaults at the TOP level only — `schedule` is
 *    not deep-merged, so an imported/synced section is taken verbatim
 *    (global-config.reducer.ts:169-180);
 *  - `updateGlobalConfigSection` spreads a partial section with no validation,
 *    so a remote client's op lands unchecked;
 *  - typia accepts '' for a `string` field, so autoFixTypiaErrors never fires.
 *
 * Result: the value sticks and the Schedule panel throws on every open.
 * Expected behaviour is the #7067 one — skip/fall back, never throw.
 */
describe('Schedule: malformed schedule-config clock strings (#5358)', () => {
  const NOW = new Date('2026-08-21T10:00:00').getTime();

  beforeEach(() => {
    // test.ts stubs window.confirm to TRUE globally, which makes devError
    // rethrow in non-production -- that would mask the guard under the very
    // error it prevents. Silence both, and re-arm devError's one-shot alert
    // latch so ordering with other specs cannot change the outcome.
    _resetDevErrorState();
    if (jasmine.isSpy(window.confirm)) {
      (window.confirm as jasmine.Spy).and.returnValue(false);
    } else {
      spyOn(window, 'confirm').and.returnValue(false);
    }
    if (jasmine.isSpy(window.alert)) {
      (window.alert as jasmine.Spy).and.stub();
    } else {
      spyOn(window, 'alert').and.stub();
    }
  });

  describe('createSortedBlockerBlocks', () => {
    it('does not throw on an empty workStart/workEnd', () => {
      expect(() =>
        createSortedBlockerBlocks(
          [],
          [],
          [],
          { startTime: '', endTime: '' },
          undefined,
          NOW,
          3,
        ),
      ).not.toThrow();
    });

    it('does not throw on a malformed workEnd', () => {
      expect(() =>
        createSortedBlockerBlocks(
          [],
          [],
          [],
          { startTime: '09:00', endTime: '17:00 PM' },
          undefined,
          NOW,
          3,
        ),
      ).not.toThrow();
    });

    it('does not throw on an empty lunch break', () => {
      expect(() =>
        createSortedBlockerBlocks(
          [],
          [],
          [],
          undefined,
          { startTime: '', endTime: '' },
          NOW,
          3,
        ),
      ).not.toThrow();
    });

    it('emits no WorkdayStartEnd block for an unusable cfg rather than a bogus one', () => {
      const blocks = createSortedBlockerBlocks(
        [],
        [],
        [],
        { startTime: '', endTime: '' },
        undefined,
        NOW,
        3,
      );
      expect(
        blocks.filter((b) =>
          b.entries.some((e) => e.type === BlockedBlockType.WorkdayStartEnd),
        ),
      ).toEqual([]);
    });

    it('still honours a valid cfg', () => {
      const blocks = createSortedBlockerBlocks(
        [],
        [],
        [],
        { startTime: '09:00', endTime: '17:00' },
        undefined,
        NOW,
        3,
      );
      expect(
        blocks.filter((b) =>
          b.entries.some((e) => e.type === BlockedBlockType.WorkdayStartEnd),
        ).length,
      ).toBeGreaterThan(0);
    });
  });

  describe('createScheduleDays', () => {
    it('does not throw on an empty workStart', () => {
      const dayDates = [getDbDateStr(NOW)];
      expect(() =>
        createScheduleDays([], [], dayDates, {}, {}, { startTime: '', endTime: '' }, NOW),
      ).not.toThrow();
    });
  });

  describe('isTaskOutsideWorkHours', () => {
    const TASK = {
      dueWithTime: NOW,
      timeEstimate: 60 * 60 * 1000,
      timeSpent: 0,
      subTaskIds: [],
    };

    it('reports "not outside" instead of throwing on a corrupt workStart', () => {
      const cfg = {
        isWorkStartEndEnabled: true,
        workStart: '',
        workEnd: '17:00',
      } as ScheduleConfig;
      expect(() => isTaskOutsideWorkHours(TASK, cfg)).not.toThrow();
      expect(isTaskOutsideWorkHours(TASK, cfg)).toBe(false);
    });

    it('still detects a task outside valid work hours', () => {
      const cfg = {
        isWorkStartEndEnabled: true,
        workStart: '09:00',
        workEnd: '17:00',
      } as ScheduleConfig;
      const lateTask = {
        ...TASK,
        dueWithTime: new Date('2026-08-21T22:00:00').getTime(),
      };
      expect(isTaskOutsideWorkHours(lateTask, cfg)).toBe(true);
    });
  });
});
