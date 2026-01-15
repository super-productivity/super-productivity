import { taskBatchUpdateMetaReducer } from './task-batch-update.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { Action, ActionReducer } from '@ngrx/store';
import { BatchOperation } from '@super-productivity/plugin-api';
import { createBaseState } from './test-utils';

describe('taskBatchUpdateMetaReducer - Two Subtasks Bug', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskBatchUpdateMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  it('should create parent with two subtasks correctly', () => {
    // This test reproduces the exact bug scenario from the sync-md plugin
    const operations: BatchOperation[] = [
      {
        type: 'create',
        tempId: 'temp_0',
        data: {
          title: 'Parent task',
          isDone: false,
          notes: '',
        },
      },
      {
        type: 'create',
        tempId: 'temp_1',
        data: {
          title: 'with sub tasks and everything',
          isDone: false,
          notes: '',
          parentId: 'temp_0',
        },
      },
      {
        type: 'create',
        tempId: 'temp_2',
        data: {
          title: 'sounds great?',
          isDone: false,
          notes: '',
          parentId: 'temp_0',
        },
      },
      {
        type: 'reorder',
        taskIds: ['temp_0'],
      },
    ];

    const createdTaskIds = {
      temp_0: 'parent-id',
      temp_1: 'subtask-1-id',
      temp_2: 'subtask-2-id',
    };

    const action = TaskSharedActions.batchUpdateForProject({
      projectId: 'project1',
      operations,
      createdTaskIds,
    });

    const result = metaReducer(baseState, action);

    // Verify parent task was created
    const parentTask = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
    expect(parentTask).toBeDefined();
    expect(parentTask.title).toBe('Parent task');

    // Verify both subtasks were created
    const subtask1 = result[TASK_FEATURE_NAME].entities['subtask-1-id'] as Task;
    const subtask2 = result[TASK_FEATURE_NAME].entities['subtask-2-id'] as Task;
    expect(subtask1).toBeDefined();
    expect(subtask1.title).toBe('with sub tasks and everything');
    expect(subtask1.parentId).toBe('parent-id');

    expect(subtask2).toBeDefined();
    expect(subtask2.title).toBe('sounds great?');
    expect(subtask2.parentId).toBe('parent-id');

    // THE BUG: Verify parent has BOTH subtasks in subTaskIds
    expect(parentTask.subTaskIds).toBeDefined();
    expect(parentTask.subTaskIds.length).toBe(2);
    expect(parentTask.subTaskIds).toContain('subtask-1-id');
    expect(parentTask.subTaskIds).toContain('subtask-2-id');
  });

  it('should preserve subTaskIds order when parent has explicit update', () => {
    // Test when parent has an explicit subTaskIds update in the operations
    const operations: BatchOperation[] = [
      {
        type: 'create',
        tempId: 'temp_0',
        data: {
          title: 'Parent task',
          isDone: false,
          notes: '',
        },
      },
      {
        type: 'create',
        tempId: 'temp_1',
        data: {
          title: 'with sub tasks and everything',
          isDone: false,
          notes: '',
          parentId: 'temp_0',
        },
      },
      {
        type: 'create',
        tempId: 'temp_2',
        data: {
          title: 'sounds great?',
          isDone: false,
          notes: '',
          parentId: 'temp_0',
        },
      },
      {
        type: 'update',
        taskId: 'parent-id',
        updates: {
          subTaskIds: ['subtask-1-id', 'subtask-2-id'],
        },
      },
      {
        type: 'reorder',
        taskIds: ['temp_0'],
      },
    ];

    const createdTaskIds = {
      temp_0: 'parent-id',
      temp_1: 'subtask-1-id',
      temp_2: 'subtask-2-id',
    };

    const action = TaskSharedActions.batchUpdateForProject({
      projectId: 'project1',
      operations,
      createdTaskIds,
    });

    const result = metaReducer(baseState, action);

    const parentTask = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
    expect(parentTask.subTaskIds).toEqual(['subtask-1-id', 'subtask-2-id']);
  });

  it('should handle parent created before subtasks', () => {
    // First create parent
    const operations1: BatchOperation[] = [
      {
        type: 'create',
        tempId: 'temp_0',
        data: {
          title: 'Parent task',
          isDone: false,
          notes: '',
        },
      },
      {
        type: 'reorder',
        taskIds: ['temp_0'],
      },
    ];

    const createdTaskIds1 = {
      temp_0: 'parent-id',
    };

    const action1 = TaskSharedActions.batchUpdateForProject({
      projectId: 'project1',
      operations: operations1,
      createdTaskIds: createdTaskIds1,
    });

    let result = metaReducer(baseState, action1);

    // Then add subtasks
    const operations2: BatchOperation[] = [
      {
        type: 'create',
        tempId: 'temp_1',
        data: {
          title: 'with sub tasks and everything',
          isDone: false,
          notes: '',
          parentId: 'parent-id',
        },
      },
      {
        type: 'create',
        tempId: 'temp_2',
        data: {
          title: 'sounds great?',
          isDone: false,
          notes: '',
          parentId: 'parent-id',
        },
      },
    ];

    const createdTaskIds2 = {
      temp_1: 'subtask-1-id',
      temp_2: 'subtask-2-id',
    };

    const action2 = TaskSharedActions.batchUpdateForProject({
      projectId: 'project1',
      operations: operations2,
      createdTaskIds: createdTaskIds2,
    });

    result = metaReducer(result, action2);

    const parentTask = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
    expect(parentTask.subTaskIds).toBeDefined();
    expect(parentTask.subTaskIds.length).toBe(2);
    expect(parentTask.subTaskIds).toContain('subtask-1-id');
    expect(parentTask.subTaskIds).toContain('subtask-2-id');
  });

  it('should create multiple sub tasks correctly', () => {
    // Simultaneously create 1 parent and 3 subtasks
    const operations: BatchOperation[] = [
      // Create first subtask
      {
        type: 'create',
        tempId: 'temp_child1',
        data: {
          title: 'First Subtask',
          isDone: false,
          notes: '',
          parentId: 'temp_parent',
        },
      },
      // Create second subtask
      {
        type: 'create',
        tempId: 'temp_child2',
        data: {
          title: 'Second Subtask',
          isDone: false,
          notes: '',
          parentId: 'temp_parent',
        },
      },
      // Create third subtask
      {
        type: 'create',
        tempId: 'temp_child3',
        data: {
          title: 'Third Subtask',
          isDone: false,
          notes: '',
          parentId: 'temp_parent',
        },
      },
      // Create parent task
      {
        type: 'create',
        tempId: 'temp_parent',
        data: {
          title: 'Parent Task',
          isDone: false,
          notes: '',
        },
      },
      // Reorder operation
      {
        type: 'reorder',
        taskIds: ['temp_parent'],
      },
    ];

    const createdTaskIds = {
      temp_parent: 'parent-id',
      temp_child1: 'child1-id',
      temp_child2: 'child2-id',
      temp_child3: 'child3-id',
    };

    const action = TaskSharedActions.batchUpdateForProject({
      projectId: 'project1',
      operations: operations,
      createdTaskIds: createdTaskIds,
    });

    const result = metaReducer(baseState, action);

    // Verify parent task was created
    const parentTask = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
    expect(parentTask).toBeDefined();
    expect(parentTask.title).toBe('Parent Task');
    expect(parentTask.parentId).toBeUndefined();

    // Verify parent has all 3 subtasks
    expect(parentTask.subTaskIds).toBeDefined();
    expect(parentTask.subTaskIds.length).toBe(3);
    expect(parentTask.subTaskIds).toContain('child1-id');
    expect(parentTask.subTaskIds).toContain('child2-id');
    expect(parentTask.subTaskIds).toContain('child3-id');

    // Verify all subtasks were created correctly
    const child1 = result[TASK_FEATURE_NAME].entities['child1-id'] as Task;
    expect(child1).toBeDefined();
    expect(child1.title).toBe('First Subtask');
    expect(child1.parentId).toBe('parent-id');

    const child2 = result[TASK_FEATURE_NAME].entities['child2-id'] as Task;
    expect(child2).toBeDefined();
    expect(child2.title).toBe('Second Subtask');
    expect(child2.parentId).toBe('parent-id');

    const child3 = result[TASK_FEATURE_NAME].entities['child3-id'] as Task;
    expect(child3).toBeDefined();
    expect(child3.title).toBe('Third Subtask');
    expect(child3.parentId).toBe('parent-id');

    // Verify project taskIds only contains the parent (not subtasks)
    const project = result[PROJECT_FEATURE_NAME].entities['project1'];
    expect(project.taskIds).toContain('parent-id');
    expect(project.taskIds).not.toContain('child1-id');
    expect(project.taskIds).not.toContain('child2-id');
    expect(project.taskIds).not.toContain('child3-id');
  });
});
