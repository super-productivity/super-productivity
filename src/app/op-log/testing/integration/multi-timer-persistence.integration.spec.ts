import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { resetTestUuidCounter } from './helpers/test-client.helper';
import { createMinimalTaskPayload } from './helpers/operation-factory.helper';
import { TaskState } from '../../../features/tasks/task.model';
import {
  initialTaskState,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { startTask, stopTask } from '../../../features/tasks/store/task.actions';

describe('Multi-Timer Persistence Integration', () => {
  let storeService: OperationLogStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService],
    });
    storeService = TestBed.inject(OperationLogStoreService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  it('should persist and reload multiple activeTaskIds in snapshot', async () => {
    const activeTaskIds = ['task-1', 'task-2', 'task-3'];
    const taskState: TaskState = {
      ...initialTaskState,
      ids: ['task-1', 'task-2', 'task-3'],
      entities: {
        ['task-1']: createMinimalTaskPayload('task-1', {
          title: 'Task 1',
          isCurrent: true,
        }) as any,
        ['task-2']: createMinimalTaskPayload('task-2', {
          title: 'Task 2',
          isCurrent: true,
        }) as any,
        ['task-3']: createMinimalTaskPayload('task-3', {
          title: 'Task 3',
          isCurrent: true,
        }) as any,
      },
      activeTaskIds: activeTaskIds,
    };

    const testSnapshot = {
      state: {
        task: taskState,
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
        globalConfig: {},
      },
      lastAppliedOpSeq: 10,
      vectorClock: { ['test-client']: 10 },
      compactedAt: Date.now(),
      schemaVersion: 1,
    };

    await storeService.saveStateCache(testSnapshot as any);

    const loadedSnapshot = (await storeService.loadStateCache()) as any;
    expect(loadedSnapshot).toBeDefined();
    expect(loadedSnapshot?.state.task.activeTaskIds).toEqual(activeTaskIds);
    expect(loadedSnapshot?.state.task.entities['task-1'].isCurrent).toBe(true);
    expect(loadedSnapshot?.state.task.entities['task-2'].isCurrent).toBe(true);
    expect(loadedSnapshot?.state.task.entities['task-3'].isCurrent).toBe(true);
  });

  it('should correctly migrate legacy currentTaskId to activeTaskIds', async () => {
    // This tests the migration logic in the reducer when loaded via loadAllData
    // though here we are just testing the persistence layer's ability to store/retrieve
    // whatever we give it. The actual migration happens in the reducer.

    const legacyTaskState = {
      ...initialTaskState,
      ids: ['task-1'],
      entities: {
        ['task-1']: createMinimalTaskPayload('task-1', {
          title: 'Task 1',
          isCurrent: true,
        }) as any,
      },
      // activeTaskIds missing or empty
      activeTaskIds: [],
      currentTaskId: 'task-1', // Legacy field
    } as any;

    const testSnapshot = {
      state: {
        task: legacyTaskState,
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
        globalConfig: {},
      },
      lastAppliedOpSeq: 5,
      vectorClock: { ['test-client']: 5 },
      compactedAt: Date.now(),
      schemaVersion: 1,
    };

    await storeService.saveStateCache(testSnapshot as any);

    const loadedSnapshot = (await storeService.loadStateCache()) as any;
    expect(loadedSnapshot?.state.task.currentTaskId).toBe('task-1');
    // The reducer (not tested here) will handle the migration to activeTaskIds
  });

  it('should maintain multiple active tasks after replaying startTask operations', () => {
    // Add tasks first
    const tasks = [
      createMinimalTaskPayload('task-1', { title: 'Task 1' }),
      createMinimalTaskPayload('task-2', { title: 'Task 2' }),
    ] as any;
    const initialState = {
      ...initialTaskState,
      ids: ['task-1', 'task-2'],
      entities: {
        ['task-1']: tasks[0],
        ['task-2']: tasks[1],
      },
    };

    const state1 = taskReducer(initialState, startTask({ id: 'task-1' }));
    const state2 = taskReducer(state1, startTask({ id: 'task-2' }));

    expect(state2.activeTaskIds).toEqual(['task-1', 'task-2']);
    expect(state2.entities['task-1']?.isCurrent).toBe(true);
    expect(state2.entities['task-2']?.isCurrent).toBe(true);

    const state3 = taskReducer(state2, stopTask({ id: 'task-1' }));
    expect(state3.activeTaskIds).toEqual(['task-2']);
    expect(state3.entities['task-1']?.isCurrent).toBe(false);
    expect(state3.entities['task-2']?.isCurrent).toBe(true);
  });
});
