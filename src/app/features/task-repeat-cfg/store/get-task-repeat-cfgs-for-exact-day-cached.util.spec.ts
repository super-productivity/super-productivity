import { getTaskRepeatCfgsForExactDayCached } from './get-task-repeat-cfgs-for-exact-day-cached.util';
import { selectTaskRepeatCfgsForExactDay } from './task-repeat-cfg.selectors';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

describe('getTaskRepeatCfgsForExactDayCached', () => {
  const dailyCfg = (id: string): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    repeatCycle: 'DAILY',
    startDate: '2024-01-01',
    lastTaskCreationDay: '2024-01-01',
  });
  const weeklyMondayCfg = (id: string): TaskRepeatCfg => ({
    ...DEFAULT_TASK_REPEAT_CFG,
    id,
    repeatCycle: 'WEEKLY',
    startDate: '2024-01-01',
    lastTaskCreationDay: '2024-01-01',
    monday: true,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
  });
  // 2024-03-04 is a Monday, 2024-03-05 a Tuesday
  const monday = new Date(2024, 2, 4).getTime();
  const tuesday = new Date(2024, 2, 5).getTime();

  it('returns the same result as the uncached projector', () => {
    const cfgs = [dailyCfg('D'), weeklyMondayCfg('W')];

    for (const day of [monday, tuesday]) {
      expect(getTaskRepeatCfgsForExactDayCached(cfgs, day)).toEqual(
        selectTaskRepeatCfgsForExactDay.projector(cfgs, { dayDate: day }),
      );
    }
    expect(getTaskRepeatCfgsForExactDayCached(cfgs, monday).map((c) => c.id)).toEqual([
      'D',
      'W',
    ]);
    expect(getTaskRepeatCfgsForExactDayCached(cfgs, tuesday).map((c) => c.id)).toEqual([
      'D',
    ]);
  });

  it('reuses the result for the same cfg array and day', () => {
    const cfgs = [dailyCfg('D')];
    expect(getTaskRepeatCfgsForExactDayCached(cfgs, monday)).toBe(
      getTaskRepeatCfgsForExactDayCached(cfgs, monday),
    );
  });

  it('recomputes when the cfg array is replaced', () => {
    const cfgs = [dailyCfg('D')];
    const first = getTaskRepeatCfgsForExactDayCached(cfgs, monday);
    const edited = [{ ...cfgs[0], isPaused: true }];

    expect(getTaskRepeatCfgsForExactDayCached(edited, monday)).not.toBe(first);
    expect(getTaskRepeatCfgsForExactDayCached(edited, monday)).toEqual([]);
  });
});
