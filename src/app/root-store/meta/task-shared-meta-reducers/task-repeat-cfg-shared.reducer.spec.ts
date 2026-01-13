import { taskRepeatCfgSharedMetaReducer } from './task-repeat-cfg-shared.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Action, ActionReducer } from '@ngrx/store';
import { createStateWithExistingTasks, expectStateUpdate } from './test-utils';

describe('taskRepeatCfgSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskRepeatCfgSharedMetaReducer(mockReducer);
  });

  describe('deleteTaskRepeatCfg action', () => {
    it('should unlink repeatCfgId from tasks', () => {
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], []);

      // Add repeatCfgId to tasks
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...testState[TASK_FEATURE_NAME].entities.task1!,
        repeatCfgId: 'repeat-cfg-1',
      };
      testState[TASK_FEATURE_NAME].entities.task2 = {
        ...testState[TASK_FEATURE_NAME].entities.task2!,
        repeatCfgId: 'repeat-cfg-1',
      };

      const action = TaskSharedActions.deleteTaskRepeatCfg({
        taskRepeatCfgId: 'repeat-cfg-1',
        taskIdsToUnlink: ['task1', 'task2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                repeatCfgId: undefined,
              }),
              task2: jasmine.objectContaining({
                repeatCfgId: undefined,
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle empty task list', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      const action = TaskSharedActions.deleteTaskRepeatCfg({
        taskRepeatCfgId: 'repeat-cfg-1',
        taskIdsToUnlink: [],
      });

      metaReducer(testState, action);

      // Should pass through unchanged
      expect(mockReducer).toHaveBeenCalledWith(
        jasmine.objectContaining({
          [TASK_FEATURE_NAME]: testState[TASK_FEATURE_NAME],
        }),
        action,
      );
    });

    it('should skip non-existent tasks', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...testState[TASK_FEATURE_NAME].entities.task1!,
        repeatCfgId: 'repeat-cfg-1',
      };

      const action = TaskSharedActions.deleteTaskRepeatCfg({
        taskRepeatCfgId: 'repeat-cfg-1',
        taskIdsToUnlink: ['task1', 'non-existent-task'],
      });

      metaReducer(testState, action);

      // Should only update task1, ignore non-existent
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                repeatCfgId: undefined,
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle tasks without repeatCfgId', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      // task1 has no repeatCfgId
      const action = TaskSharedActions.deleteTaskRepeatCfg({
        taskRepeatCfgId: 'repeat-cfg-1',
        taskIdsToUnlink: ['task1'],
      });

      metaReducer(testState, action);

      // Should still set to undefined (idempotent)
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                repeatCfgId: undefined,
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('unrelated actions', () => {
    it('should pass through state unchanged for unrelated actions', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      const action = { type: '[Some] Unrelated Action' };

      metaReducer(testState, action);

      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });
  });
});
