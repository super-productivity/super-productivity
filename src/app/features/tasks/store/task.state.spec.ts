import { TestBed } from '@angular/core/testing';
import { initialTaskState, taskReducer } from './task.reducer';
import { startTask } from './task.actions';
import { Task } from '../task.model';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';

describe('Task State Persistence', () => {
  const task1: Task = {
    id: 'task1',
    projectId: 'p1',
    title: 'Task 1',
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    tagIds: [],
    created: 0,
    attachments: [],
  };
  const task2: Task = {
    id: 'task2',
    projectId: 'p1',
    title: 'Task 2',
    subTaskIds: [],
    timeSpentOnDay: {},
    timeSpent: 0,
    timeEstimate: 0,
    isDone: false,
    tagIds: [],
    created: 0,
    attachments: [],
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [],
    });
  });

  it('should persist activeTaskIds to the state and restore them via loadAllData', () => {
    // 1. Start two tasks
    let state = taskReducer(
      { ...initialTaskState, entities: { task1, task2 }, ids: ['task1', 'task2'] },
      startTask({ id: 'task1' }),
    );
    state = taskReducer(state, startTask({ id: 'task2' }));

    expect(state.activeTaskIds).toEqual(['task1', 'task2']);

    // 2. Simulate saving and loading the state
    const savedState = JSON.parse(JSON.stringify(state));
    const appData: any = { task: savedState };

    // 3. Load the data into a fresh initial state
    const restoredState = taskReducer(
      initialTaskState,
      loadAllData({ appDataComplete: appData as any }),
    );

    // 4. Verify that activeTaskIds are restored
    expect(restoredState.activeTaskIds).toEqual(['task1', 'task2']);
    // also check other properties
    expect(restoredState.entities['task1']?.title).toBe('Task 1');
  });

  it('should handle migration from old currentTaskId to activeTaskIds', () => {
    // 1. Create a legacy state with currentTaskId
    const legacyState = {
      ...initialTaskState,
      entities: { task1 },
      ids: ['task1'],
      currentTaskId: 'task1',
    };

    // 2. Simulate loading this legacy state
    const appData: any = { task: legacyState as any };
    const restoredState = taskReducer(
      initialTaskState,
      loadAllData({ appDataComplete: appData as any }),
    );

    // 3. Verify that currentTaskId was migrated to activeTaskIds
    expect(restoredState.activeTaskIds).toEqual(['task1']);
    expect((restoredState as any).currentTaskId).toBeUndefined();
  });
});
