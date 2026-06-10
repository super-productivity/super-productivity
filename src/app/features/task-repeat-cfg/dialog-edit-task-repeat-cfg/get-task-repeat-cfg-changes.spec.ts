import { getTaskRepeatCfgChanges } from './get-task-repeat-cfg-changes';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { TaskReminderOptionId } from '../../tasks/task.model';

describe('getTaskRepeatCfgChanges', () => {
  const base: TaskRepeatCfg = {
    ...DEFAULT_TASK_REPEAT_CFG,
    id: 'cfg-1',
    title: 'Daily standup',
    startDate: '2026-04-26',
    repeatCycle: 'DAILY',
    repeatEvery: 1,
    startTime: '18:00',
    remindAt: TaskReminderOptionId.AtStart,
  };

  it('returns empty object when nothing changed', () => {
    expect(getTaskRepeatCfgChanges(base, { ...base })).toEqual({});
  });

  it('omits the id field even when it differs', () => {
    expect(getTaskRepeatCfgChanges(base, { ...base, id: 'cfg-2' })).toEqual({});
  });

  // Regression for issue #7373:
  // when only startTime changes, no schedule-affecting field must appear in the diff,
  // otherwise rescheduleTaskOnRepeatCfgUpdate$ fires and pushes today's task to tomorrow.
  it('returns only startTime when only the time changed (#7373)', () => {
    const changes = getTaskRepeatCfgChanges(base, { ...base, startTime: '19:15' });
    expect(changes).toEqual({ startTime: '19:15' });
    expect('startDate' in changes).toBe(false);
    expect('repeatCycle' in changes).toBe(false);
    expect('monday' in changes).toBe(false);
  });

  it('detects multiple changed primitive fields', () => {
    const changes = getTaskRepeatCfgChanges(base, {
      ...base,
      title: 'Renamed',
      repeatEvery: 2,
    });
    expect(changes).toEqual({ title: 'Renamed', repeatEvery: 2 });
  });

  it('detects array changes via deep comparison', () => {
    const initial = { ...base, tagIds: ['a', 'b'] };
    expect(getTaskRepeatCfgChanges(initial, { ...initial, tagIds: ['a', 'b'] })).toEqual(
      {},
    );
    expect(getTaskRepeatCfgChanges(initial, { ...initial, tagIds: ['a', 'c'] })).toEqual({
      tagIds: ['a', 'c'],
    });
  });

  it('detects when a field becomes undefined', () => {
    const changes = getTaskRepeatCfgChanges(base, { ...base, startTime: undefined });
    expect(changes).toEqual({ startTime: undefined });
    expect('startTime' in changes).toBe(true);
  });

  it('detects when a previously undefined field becomes set', () => {
    const initial = { ...base, defaultEstimate: undefined };
    const changes = getTaskRepeatCfgChanges(initial, {
      ...initial,
      defaultEstimate: 1500,
    });
    expect(changes).toEqual({ defaultEstimate: 1500 });
  });
});
