import { taskRepeatCfgToRRuleInput } from './task-repeat-cfg-to-rrule-input.util';
import { getEffectiveRepeatStartDate } from './get-effective-repeat-start-date.util';
import { getEffectiveLastTaskCreationDay } from './get-effective-last-task-creation-day.util';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

const cfg = (over: Partial<TaskRepeatCfg> = {}): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'A',
  ...over,
});

describe('taskRepeatCfgToRRuleInput', () => {
  it('passes the rrule string through verbatim', () => {
    const c = cfg({ rrule: 'FREQ=WEEKLY;BYDAY=MO', startDate: '2024-06-01' });
    expect(taskRepeatCfgToRRuleInput(c).rrule).toBe('FREQ=WEEKLY;BYDAY=MO');
  });

  it('sources startDate / lastTaskCreationDay from the effective helpers', () => {
    const c = cfg({
      rrule: 'FREQ=DAILY',
      startDate: '2024-06-01',
      lastTaskCreationDay: '2024-06-10',
    });
    const input = taskRepeatCfgToRRuleInput(c);
    expect(input.startDate).toBe(getEffectiveRepeatStartDate(c));
    expect(input.lastTaskCreationDay).toBe(
      getEffectiveLastTaskCreationDay(c) || undefined,
    );
  });

  it('maps deletedInstanceDates onto exdates', () => {
    const c = cfg({
      rrule: 'FREQ=DAILY',
      startDate: '2024-06-01',
      deletedInstanceDates: ['2024-06-03', '2024-06-05'],
    });
    expect(taskRepeatCfgToRRuleInput(c).exdates).toEqual(['2024-06-03', '2024-06-05']);
  });

  it('leaves exdates undefined when there are no deleted instances', () => {
    const c = cfg({ rrule: 'FREQ=DAILY', startDate: '2024-06-01' });
    expect(taskRepeatCfgToRRuleInput(c).exdates).toBeUndefined();
  });
});
