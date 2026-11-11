import { issueProviderSharedMetaReducer } from './issue-provider-shared.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Action, ActionReducer } from '@ngrx/store';
import { createStateWithExistingTasks, expectStateUpdate } from './test-utils';
import { RootState } from '../../root-state';

describe('issueProviderSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = issueProviderSharedMetaReducer(mockReducer);
  });

  for (const bulk of [false, true]) {
    it(`should derive ${bulk ? 'bulk' : 'single'} delete unlinks from replay state and clear sync baselines`, () => {
      const state = createStateWithExistingTasks(['task1', 'task2', 'task3'], [], []);
      for (const [id, providerId] of [
        ['task1', 'provider-1'],
        ['task2', 'provider-2'],
        ['task3', 'provider-3'],
      ]) {
        state[TASK_FEATURE_NAME].entities[id] = {
          ...state[TASK_FEATURE_NAME].entities[id]!,
          issueProviderId: providerId,
          issueId: `issue-${id}`,
          issueType: 'JIRA',
          issueLastSyncedValues: { title: 'Synced title' },
        };
      }
      const snapshot = structuredClone(state);
      const action = bulk
        ? TaskSharedActions.deleteIssueProviders({
            ids: ['provider-1', 'provider-2'],
            taskIdsToUnlink: ['missing-task', 'task1'],
          })
        : TaskSharedActions.deleteIssueProvider({
            issueProviderId: 'provider-1',
            taskIdsToUnlink: ['missing-task'],
          });

      const result = metaReducer(state, action) as RootState;
      for (const id of bulk ? ['task1', 'task2'] : ['task1']) {
        expect(result[TASK_FEATURE_NAME].entities[id]).toEqual(
          jasmine.objectContaining({
            issueProviderId: undefined,
            issueId: undefined,
            issueType: undefined,
            issueLastSyncedValues: undefined,
          }),
        );
      }
      expect(result[TASK_FEATURE_NAME].entities.task3).toBe(
        state[TASK_FEATURE_NAME].entities.task3,
      );
      if (!bulk) {
        expect(result[TASK_FEATURE_NAME].entities.task2).toBe(
          state[TASK_FEATURE_NAME].entities.task2,
        );
      }
      expect(state).toEqual(snapshot);
    });
  }

  describe('deleteIssueProvider action', () => {
    it('should unlink issue data from tasks', () => {
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], []);

      // Add issue data to tasks
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...testState[TASK_FEATURE_NAME].entities.task1!,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueType: 'GITHUB' as any,
      };
      testState[TASK_FEATURE_NAME].entities.task2 = {
        ...testState[TASK_FEATURE_NAME].entities.task2!,
        issueId: 'issue-2',
        issueProviderId: 'provider-1',
        issueType: 'GITHUB' as any,
      };

      const action = TaskSharedActions.deleteIssueProvider({
        issueProviderId: 'provider-1',
        taskIdsToUnlink: ['task1', 'task2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                issueId: undefined,
                issueProviderId: undefined,
                issueType: undefined,
              }),
              task2: jasmine.objectContaining({
                issueId: undefined,
                issueProviderId: undefined,
                issueType: undefined,
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

      const action = TaskSharedActions.deleteIssueProvider({
        issueProviderId: 'provider-1',
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

      // Add issue data
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...testState[TASK_FEATURE_NAME].entities.task1!,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
      };

      const action = TaskSharedActions.deleteIssueProvider({
        issueProviderId: 'provider-1',
        taskIdsToUnlink: ['task1', 'non-existent-task'],
      });

      metaReducer(testState, action);

      // Should only update task1, ignore non-existent
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                issueId: undefined,
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

  describe('deleteIssueProviders action', () => {
    it('should unlink issue data from tasks for bulk delete', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...testState[TASK_FEATURE_NAME].entities.task1!,
        issueId: 'issue-1',
        issueProviderId: 'provider-1',
        issueType: 'JIRA' as any,
      };

      const action = TaskSharedActions.deleteIssueProviders({
        ids: ['provider-1', 'provider-2'],
        taskIdsToUnlink: ['task1'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                issueId: undefined,
                issueProviderId: undefined,
                issueType: undefined,
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
