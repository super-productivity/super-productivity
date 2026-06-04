import {
  addTaskRepeatCfgToTask,
  updateTaskRepeatCfg,
  updateTaskRepeatCfgs,
} from './task-repeat-cfg.actions';
import { DEFAULT_TASK_REPEAT_CFG, TaskRepeatCfg } from '../task-repeat-cfg.model';

// The op-log replays action *payloads* (operation-capture.service.ts), so the
// action creators are the single boundary that keeps an out-of-union
// quickSetting off the wire. These guard that clamp directly.
const cfg = (over: Partial<TaskRepeatCfg>): TaskRepeatCfg =>
  ({ ...DEFAULT_TASK_REPEAT_CFG, id: 'r1', ...over }) as TaskRepeatCfg;

describe('task-repeat-cfg actions — quickSetting persist clamp', () => {
  describe('addTaskRepeatCfgToTask', () => {
    it('clamps a newer preset literal to CUSTOM', () => {
      const action = addTaskRepeatCfgToTask({
        taskId: 't1',
        taskRepeatCfg: cfg({
          quickSetting: 'WEEKENDS',
          rrule: 'FREQ=WEEKLY;BYDAY=SA,SU',
        }),
      });
      expect(action.taskRepeatCfg.quickSetting).toBe('CUSTOM');
      // the opaque rule and other fields survive untouched
      expect(action.taskRepeatCfg.rrule).toBe('FREQ=WEEKLY;BYDAY=SA,SU');
    });

    it('clamps the in-memory RRULE literal to CUSTOM', () => {
      const action = addTaskRepeatCfgToTask({
        taskId: 't1',
        taskRepeatCfg: cfg({ quickSetting: 'RRULE', rrule: 'FREQ=DAILY' }),
      });
      expect(action.taskRepeatCfg.quickSetting).toBe('CUSTOM');
    });

    it('passes a released (master) value through unchanged', () => {
      const action = addTaskRepeatCfgToTask({
        taskId: 't1',
        taskRepeatCfg: cfg({ quickSetting: 'DAILY' }),
      });
      expect(action.taskRepeatCfg.quickSetting).toBe('DAILY');
    });
  });

  describe('updateTaskRepeatCfg', () => {
    it('clamps quickSetting in the Update changes', () => {
      const action = updateTaskRepeatCfg({
        taskRepeatCfg: {
          id: 'r1',
          changes: { quickSetting: 'RRULE', rrule: 'FREQ=DAILY' },
        },
      });
      expect(action.taskRepeatCfg.changes.quickSetting).toBe('CUSTOM');
      expect(action.taskRepeatCfg.changes.rrule).toBe('FREQ=DAILY');
      expect(action.taskRepeatCfg.id).toBe('r1');
    });

    it('leaves changes without a quickSetting untouched (never invents one)', () => {
      const action = updateTaskRepeatCfg({
        taskRepeatCfg: { id: 'r1', changes: { startTime: '09:00' } },
      });
      expect('quickSetting' in action.taskRepeatCfg.changes).toBe(false);
      expect(action.taskRepeatCfg.changes.startTime).toBe('09:00');
    });
  });

  describe('updateTaskRepeatCfgs', () => {
    it('clamps quickSetting in the bulk changes', () => {
      const action = updateTaskRepeatCfgs({
        ids: ['r1', 'r2'],
        changes: { quickSetting: 'QUARTERLY_CURRENT_DATE' },
      });
      expect(action.changes.quickSetting).toBe('CUSTOM');
      expect(action.ids).toEqual(['r1', 'r2']);
    });
  });
});
