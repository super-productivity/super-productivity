import {
  taskRepeatCfgReducer,
  initialTaskRepeatCfgState,
} from './task-repeat-cfg.reducer';
import * as TaskRepeatCfgActions from './task-repeat-cfg.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
  TaskRepeatCfgState,
} from '../task-repeat-cfg.model';
import { AppDataCompleteLegacy } from '../../../imex/sync/sync.model';

const createTaskRepeatCfg = (
  id: string,
  partial: Partial<TaskRepeatCfg> = {},
): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id,
  title: `Repeat Config ${id}`,
  ...partial,
});

const createStateWithCfgs = (cfgs: TaskRepeatCfg[]): TaskRepeatCfgState => ({
  ids: cfgs.map((c) => c.id),
  entities: cfgs.reduce(
    (acc, c) => {
      acc[c.id] = c;
      return acc;
    },
    {} as Record<string, TaskRepeatCfg>,
  ),
});

describe('TaskRepeatCfgReducer', () => {
  describe('initial state', () => {
    it('should return empty entity state for unknown action', () => {
      const action = { type: 'UNKNOWN' };
      const result = taskRepeatCfgReducer(undefined, action);

      expect(result).toEqual(initialTaskRepeatCfgState);
      expect(result.ids).toEqual([]);
      expect(result.entities).toEqual({});
    });
  });

  describe('loadAllData', () => {
    it('should load task repeat configs when available', () => {
      const cfgs = [
        createTaskRepeatCfg('cfg1', { title: 'Daily Standup' }),
        createTaskRepeatCfg('cfg2', { title: 'Weekly Review' }),
      ];
      const taskRepeatCfgState = createStateWithCfgs(cfgs);
      const appDataComplete = {
        taskRepeatCfg: taskRepeatCfgState,
      } as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = taskRepeatCfgReducer(initialTaskRepeatCfgState, action);

      expect(result.ids).toEqual(['cfg1', 'cfg2']);
      expect(result.entities['cfg1']).toEqual(cfgs[0]);
      expect(result.entities['cfg2']).toEqual(cfgs[1]);
    });

    it('should preserve state when taskRepeatCfg is undefined', () => {
      const existingCfg = createTaskRepeatCfg('existing');
      const existingState = createStateWithCfgs([existingCfg]);
      const appDataComplete = {
        taskRepeatCfg: undefined,
      } as unknown as AppDataCompleteLegacy;

      const action = loadAllData({ appDataComplete });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result).toBe(existingState);
    });
  });

  describe('deleteProject', () => {
    it('should remove all repeat configs for the deleted project', () => {
      const projectId = 'project-1';
      const cfgs = [
        createTaskRepeatCfg('cfg1', { projectId }),
        createTaskRepeatCfg('cfg2', { projectId }),
        createTaskRepeatCfg('cfg3', { projectId: 'other-project' }),
      ];
      const existingState = createStateWithCfgs(cfgs);

      const action = TaskSharedActions.deleteProject({
        projectId,
        noteIds: [],
        allTaskIds: [],
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).not.toContain('cfg1');
      expect(result.ids).not.toContain('cfg2');
      expect(result.ids).toContain('cfg3');
      expect(result.entities['cfg1']).toBeUndefined();
      expect(result.entities['cfg2']).toBeUndefined();
      expect(result.entities['cfg3']).toBeDefined();
    });

    it('should not affect configs from other projects', () => {
      const cfg = createTaskRepeatCfg('cfg1', { projectId: 'other-project' });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskSharedActions.deleteProject({
        projectId: 'deleted-project',
        noteIds: [],
        allTaskIds: [],
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).toContain('cfg1');
    });

    it('should handle project with no repeat configs', () => {
      const cfg = createTaskRepeatCfg('cfg1', { projectId: 'project-1' });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskSharedActions.deleteProject({
        projectId: 'empty-project',
        noteIds: [],
        allTaskIds: [],
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).toEqual(['cfg1']);
    });
  });

  describe('addTaskRepeatCfgToTask', () => {
    it('should add new repeat config to state', () => {
      const newCfg = createTaskRepeatCfg('new-cfg', { title: 'New Repeat' });
      const action = TaskRepeatCfgActions.addTaskRepeatCfgToTask({
        taskId: 'task-1',
        taskRepeatCfg: newCfg,
      });

      const result = taskRepeatCfgReducer(initialTaskRepeatCfgState, action);

      expect(result.ids).toContain('new-cfg');
      expect(result.entities['new-cfg']).toEqual(newCfg);
    });

    it('should not affect existing configs when adding new one', () => {
      const existingCfg = createTaskRepeatCfg('existing');
      const existingState = createStateWithCfgs([existingCfg]);
      const newCfg = createTaskRepeatCfg('new-cfg');

      const action = TaskRepeatCfgActions.addTaskRepeatCfgToTask({
        taskId: 'task-1',
        taskRepeatCfg: newCfg,
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).toEqual(['existing', 'new-cfg']);
      expect(result.entities['existing']).toEqual(existingCfg);
    });
  });

  describe('updateTaskRepeatCfg', () => {
    it('should update existing config', () => {
      const existingCfg = createTaskRepeatCfg('cfg1', { title: 'Old Title' });
      const existingState = createStateWithCfgs([existingCfg]);

      const action = TaskRepeatCfgActions.updateTaskRepeatCfg({
        taskRepeatCfg: {
          id: 'cfg1',
          changes: { title: 'New Title' },
        },
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.title).toBe('New Title');
    });

    it('should preserve other properties when updating', () => {
      const existingCfg = createTaskRepeatCfg('cfg1', {
        title: 'Title',
        repeatEvery: 2,
        projectId: 'project-1',
      });
      const existingState = createStateWithCfgs([existingCfg]);

      const action = TaskRepeatCfgActions.updateTaskRepeatCfg({
        taskRepeatCfg: {
          id: 'cfg1',
          changes: { title: 'Updated Title' },
        },
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.repeatEvery).toBe(2);
      expect(result.entities['cfg1']!.projectId).toBe('project-1');
    });
  });

  describe('upsertTaskRepeatCfg', () => {
    it('should add config if not exists', () => {
      const newCfg = createTaskRepeatCfg('new-cfg');
      const action = TaskRepeatCfgActions.upsertTaskRepeatCfg({
        taskRepeatCfg: newCfg,
      });

      const result = taskRepeatCfgReducer(initialTaskRepeatCfgState, action);

      expect(result.ids).toContain('new-cfg');
      expect(result.entities['new-cfg']).toEqual(newCfg);
    });

    it('should update config if exists', () => {
      const existingCfg = createTaskRepeatCfg('cfg1', { title: 'Old' });
      const existingState = createStateWithCfgs([existingCfg]);
      const updatedCfg = createTaskRepeatCfg('cfg1', { title: 'New' });

      const action = TaskRepeatCfgActions.upsertTaskRepeatCfg({
        taskRepeatCfg: updatedCfg,
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids.length).toBe(1);
      expect(result.entities['cfg1']!.title).toBe('New');
    });
  });

  describe('deleteTaskRepeatCfg', () => {
    it('should remove config by id', () => {
      const cfgs = [createTaskRepeatCfg('cfg1'), createTaskRepeatCfg('cfg2')];
      const existingState = createStateWithCfgs(cfgs);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfg({ id: 'cfg1' });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).not.toContain('cfg1');
      expect(result.ids).toContain('cfg2');
      expect(result.entities['cfg1']).toBeUndefined();
    });

    it('should handle deletion of non-existent id', () => {
      const cfg = createTaskRepeatCfg('cfg1');
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfg({ id: 'non-existent' });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).toEqual(['cfg1']);
    });
  });

  describe('deleteTaskRepeatCfgs', () => {
    it('should remove multiple configs by ids', () => {
      const cfgs = [
        createTaskRepeatCfg('cfg1'),
        createTaskRepeatCfg('cfg2'),
        createTaskRepeatCfg('cfg3'),
      ];
      const existingState = createStateWithCfgs(cfgs);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgs({ ids: ['cfg1', 'cfg2'] });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).not.toContain('cfg1');
      expect(result.ids).not.toContain('cfg2');
      expect(result.ids).toContain('cfg3');
    });

    it('should handle empty ids array', () => {
      const cfg = createTaskRepeatCfg('cfg1');
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgs({ ids: [] });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.ids).toEqual(['cfg1']);
    });
  });

  describe('updateTaskRepeatCfgs', () => {
    it('should update multiple configs with same changes', () => {
      const cfgs = [
        createTaskRepeatCfg('cfg1', { isPaused: false }),
        createTaskRepeatCfg('cfg2', { isPaused: false }),
        createTaskRepeatCfg('cfg3', { isPaused: false }),
      ];
      const existingState = createStateWithCfgs(cfgs);

      const action = TaskRepeatCfgActions.updateTaskRepeatCfgs({
        ids: ['cfg1', 'cfg2'],
        changes: { isPaused: true },
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.isPaused).toBe(true);
      expect(result.entities['cfg2']!.isPaused).toBe(true);
      expect(result.entities['cfg3']!.isPaused).toBe(false);
    });

    it('should handle empty ids array', () => {
      const cfg = createTaskRepeatCfg('cfg1', { isPaused: false });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.updateTaskRepeatCfgs({
        ids: [],
        changes: { isPaused: true },
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.isPaused).toBe(false);
    });
  });

  describe('deleteTaskRepeatCfgInstance', () => {
    it('should add date to deletedInstanceDates array', () => {
      const cfg = createTaskRepeatCfg('cfg1', { deletedInstanceDates: [] });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgInstance({
        repeatCfgId: 'cfg1',
        dateStr: '2024-01-15',
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.deletedInstanceDates).toContain('2024-01-15');
    });

    it('should append to existing deletedInstanceDates', () => {
      const cfg = createTaskRepeatCfg('cfg1', {
        deletedInstanceDates: ['2024-01-10', '2024-01-12'],
      });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgInstance({
        repeatCfgId: 'cfg1',
        dateStr: '2024-01-15',
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.deletedInstanceDates).toEqual([
        '2024-01-10',
        '2024-01-12',
        '2024-01-15',
      ]);
    });

    it('should not add duplicate date', () => {
      const cfg = createTaskRepeatCfg('cfg1', {
        deletedInstanceDates: ['2024-01-15'],
      });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgInstance({
        repeatCfgId: 'cfg1',
        dateStr: '2024-01-15',
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.deletedInstanceDates).toEqual(['2024-01-15']);
      expect(result).toBe(existingState); // Same reference = no change
    });

    it('should handle undefined deletedInstanceDates', () => {
      const cfg = createTaskRepeatCfg('cfg1', { deletedInstanceDates: undefined });
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgInstance({
        repeatCfgId: 'cfg1',
        dateStr: '2024-01-15',
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result.entities['cfg1']!.deletedInstanceDates).toEqual(['2024-01-15']);
    });

    it('should return unchanged state for non-existent config', () => {
      const cfg = createTaskRepeatCfg('cfg1');
      const existingState = createStateWithCfgs([cfg]);

      const action = TaskRepeatCfgActions.deleteTaskRepeatCfgInstance({
        repeatCfgId: 'non-existent',
        dateStr: '2024-01-15',
      });
      const result = taskRepeatCfgReducer(existingState, action);

      expect(result).toBe(existingState);
    });
  });
});
