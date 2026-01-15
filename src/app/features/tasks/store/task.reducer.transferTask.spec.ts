/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { Task, TaskState } from '../task.model';
import { initialTaskState, taskReducer } from './task.reducer';
import { PlannerActions } from '../../planner/store/planner.actions';
import { DEFAULT_TASK } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { createCombinedTaskSharedMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { RootState } from '../../../root-store/root-state';
import { TASK_FEATURE_NAME } from './task.reducer';
import { TAG_FEATURE_NAME } from '../../tag/store/tag.reducer';
import { plannerFeatureKey } from '../../planner/store/planner.reducer';
import { TODAY_TAG } from '../../tag/tag.const';
import { initialTagState } from '../../tag/store/tag.reducer';
import { plannerInitialState } from '../../planner/store/planner.reducer';

describe('Task Reducer - transferTask action', () => {
  // Apply meta-reducers to the root reducer
  const reducerWithMetaReducers = createCombinedTaskSharedMetaReducer((state, action) => {
    // Simulate the root state reduction by applying individual feature reducers
    const rootState = (state as RootState) || {
      [TASK_FEATURE_NAME]: initialTaskState,
      [TAG_FEATURE_NAME]: {
        ...initialTagState,
        entities: {
          [TODAY_TAG.id]: TODAY_TAG,
        },
        ids: [TODAY_TAG.id],
      },
      [plannerFeatureKey]: plannerInitialState,
    };

    return {
      ...rootState,
      [TASK_FEATURE_NAME]: taskReducer(rootState[TASK_FEATURE_NAME], action),
    };
  });
  const createTask = (id: string, partial: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    created: Date.now(),
    isDone: false,
    subTaskIds: [],
    tagIds: [],
    projectId: 'project1',
    parentId: undefined,
    timeSpentOnDay: {},
    timeEstimate: 0,
    timeSpent: 0,
    dueDay: undefined,
    dueWithTime: undefined,
    attachments: [],
    ...partial,
  });

  const createTransferTaskAction = (
    task: Task,
    prevDay: string,
    newDay: string,
    targetIndex: number = 0,
    today: string = getDbDateStr(),
    targetTaskId?: string,
  ) =>
    PlannerActions.transferTask({
      task,
      prevDay,
      newDay,
      targetIndex,
      today,
      targetTaskId,
    });

  let stateWithTasks: TaskState;

  let rootState: RootState;

  beforeEach(() => {
    // Create initial state with some tasks
    stateWithTasks = {
      ...initialTaskState,
      ids: ['task1', 'task2', 'task3'],
      entities: {
        task1: createTask('task1', { dueDay: '2025-01-15', dueWithTime: 1234567890 }),
        task2: createTask('task2', { dueDay: '2025-01-16' }),
        task3: createTask('task3', { dueDay: undefined }),
      },
      currentTaskId: null,
      selectedTaskId: null,
      taskDetailTargetPanel: null,
      lastCurrentTaskId: null,
      isDataLoaded: true,
    };

    // Create root state with all necessary slices
    rootState = {
      [TASK_FEATURE_NAME]: stateWithTasks,
      [TAG_FEATURE_NAME]: {
        ...initialTagState,
        entities: {
          [TODAY_TAG.id]: TODAY_TAG,
        },
        ids: [TODAY_TAG.id],
      },
      [plannerFeatureKey]: plannerInitialState,
    } as RootState;
  });

  it('should update task dueDay to newDay', () => {
    const task = stateWithTasks.entities.task1 as Task;
    const action = createTransferTaskAction(task, '2025-01-15', '2025-01-17');

    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    expect(taskState.entities.task1).toEqual({
      ...task,
      dueDay: '2025-01-17',
      dueWithTime: undefined,
    });
  });

  it('should clear dueWithTime when transferring task', () => {
    const task = stateWithTasks.entities.task1 as Task;
    expect(task.dueWithTime).toBe(1234567890); // Verify it has a dueWithTime initially

    const action = createTransferTaskAction(task, '2025-01-15', '2025-01-17');
    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    expect(taskState.entities.task1?.dueWithTime).toBeUndefined();
  });

  it('should handle transferring task with no previous dueDay', () => {
    const task = stateWithTasks.entities.task3 as Task;
    expect(task.dueDay).toBeUndefined(); // Verify it has no dueDay initially

    const action = createTransferTaskAction(task, 'ADD_TASK_PANEL_ID', '2025-01-18');
    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    expect(taskState.entities.task3).toEqual({
      ...task,
      dueDay: '2025-01-18',
      dueWithTime: undefined,
    });
  });

  it('should handle transferring task to ADD_TASK_PANEL_ID', () => {
    const task = stateWithTasks.entities.task2 as Task;
    const action = createTransferTaskAction(task, '2025-01-16', 'ADD_TASK_PANEL_ID');

    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    expect(taskState.entities.task2).toEqual({
      ...task,
      dueDay: 'ADD_TASK_PANEL_ID',
      dueWithTime: undefined,
    });
  });

  it('should handle transferring task to today', () => {
    const today = getDbDateStr();
    const task = stateWithTasks.entities.task1 as Task;
    const action = createTransferTaskAction(task, '2025-01-15', today);

    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    // Virtual tag pattern: TODAY_TAG should NOT be in task.tagIds
    // Membership is determined by task.dueDay, not tagIds
    expect(taskState.entities.task1).toEqual({
      ...task,
      dueDay: today,
      dueWithTime: undefined,
      // tagIds should NOT contain TODAY (virtual tag pattern)
    });
    expect(taskState.entities.task1!.tagIds).not.toContain(TODAY_TAG.id);
  });

  it('should not affect other tasks when transferring', () => {
    const task = stateWithTasks.entities.task1 as Task;
    const action = createTransferTaskAction(task, '2025-01-15', '2025-01-17');

    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    // Other tasks should remain unchanged
    expect(taskState.entities.task2).toEqual(stateWithTasks.entities.task2);
    expect(taskState.entities.task3).toEqual(stateWithTasks.entities.task3);
  });

  it('should handle transferring with targetTaskId parameter', () => {
    const task = stateWithTasks.entities.task1 as Task;
    const action = createTransferTaskAction(
      task,
      '2025-01-15',
      '2025-01-17',
      2,
      getDbDateStr(),
      'task2',
    );

    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    // Should still update dueDay regardless of targetTaskId
    expect(taskState.entities.task1).toEqual({
      ...task,
      dueDay: '2025-01-17',
      dueWithTime: undefined,
    });
  });

  it('should maintain other task properties when updating', () => {
    const task = createTask('task4', {
      dueDay: '2025-01-15',
      dueWithTime: 1234567890,
      timeSpent: 3600000,
      timeEstimate: 7200000,
      tagIds: ['tag1', 'tag2'],
      isDone: true,
      attachments: [{ id: 'att1', title: 'attachment', type: 'FILE' as const }],
    });

    const stateWithComplexTask: TaskState = {
      ...initialTaskState,
      ids: ['task4'],
      entities: { task4: task },
    };

    const complexRootState = {
      ...rootState,
      [TASK_FEATURE_NAME]: stateWithComplexTask,
    };

    const action = createTransferTaskAction(task, '2025-01-15', '2025-01-20');
    const result = reducerWithMetaReducers(complexRootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    expect(taskState.entities.task4).toEqual({
      ...task,
      dueDay: '2025-01-20',
      dueWithTime: undefined,
      // All other properties should remain unchanged
      timeSpent: 3600000,
      timeEstimate: 7200000,
      tagIds: ['tag1', 'tag2'],
      isDone: true,
      attachments: [{ id: 'att1', title: 'attachment', type: 'FILE' as const }],
    });
  });

  it('should handle transferring to the same day', () => {
    const task = stateWithTasks.entities.task1 as Task;
    const action = createTransferTaskAction(task, '2025-01-15', '2025-01-15');

    const result = reducerWithMetaReducers(rootState, action) as RootState;
    const taskState = result[TASK_FEATURE_NAME];

    // Should still update (clear dueWithTime)
    expect(taskState.entities.task1).toEqual({
      ...task,
      dueDay: '2025-01-15',
      dueWithTime: undefined,
    });
  });
});
