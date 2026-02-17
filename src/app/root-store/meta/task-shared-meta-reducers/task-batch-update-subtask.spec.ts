/* eslint-disable @typescript-eslint/naming-convention */
import { taskBatchUpdateMetaReducer } from './task-batch-update.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import {
  BatchOperation,
  BatchTaskCreate,
  BatchTaskUpdate,
} from '@super-productivity/plugin-api';
import { createBaseState, createMockTask } from './test-utils';
import { Log } from '../../../core/log';

describe('taskBatchUpdateMetaReducer - SubTask Updates', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskBatchUpdateMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('subtask ID updates', () => {
    it('should update parent task subTaskIds when subtasks are moved to root', () => {
      // Setup: Create parent task with subtasks
      const parentTask = createMockTask({
        id: 'parent-task',
        title: 'Parent Task',
        subTaskIds: ['subtask-1', 'subtask-2', 'subtask-3'],
        projectId: 'project1',
      });

      const subtask1 = createMockTask({
        id: 'subtask-1',
        title: 'Subtask 1',
        parentId: 'parent-task',
        projectId: 'project1',
      });

      const subtask2 = createMockTask({
        id: 'subtask-2',
        title: 'Subtask 2',
        parentId: 'parent-task',
        projectId: 'project1',
      });

      const subtask3 = createMockTask({
        id: 'subtask-3',
        title: 'Subtask 3',
        parentId: 'parent-task',
        projectId: 'project1',
      });

      // Add tasks to state
      baseState[TASK_FEATURE_NAME].entities = {
        'parent-task': parentTask,
        'subtask-1': subtask1,
        'subtask-2': subtask2,
        'subtask-3': subtask3,
      };
      baseState[TASK_FEATURE_NAME].ids = [
        'parent-task',
        'subtask-1',
        'subtask-2',
        'subtask-3',
      ];

      // Operation: Update parent to remove some subtasks
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'parent-task',
          updates: {
            parentId: null,
            subTaskIds: [], // Only keep subtask-1
          },
        } as BatchTaskUpdate,
        {
          type: 'update',
          taskId: 'subtask-1',
          updates: {
            parentId: null,
          },
        } as BatchTaskUpdate,
        {
          type: 'update',
          taskId: 'subtask-2',
          updates: {
            parentId: null,
          },
        } as BatchTaskUpdate,
        {
          type: 'update',
          taskId: 'subtask-3',
          updates: {
            parentId: null,
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      // Verify parent task was updated correctly
      const updatedParentTask = result[TASK_FEATURE_NAME].entities['parent-task'] as Task;
      expect(updatedParentTask.subTaskIds).toEqual([]);
    });

    it('should handle empty subTaskIds array when all subtasks are removed', () => {
      // Setup: Create parent task with subtasks
      const parentTask = createMockTask({
        id: 'QtsKTxuqH8hkHH6oVW2Bu',
        title: 'Task A',
        subTaskIds: ['J51QnQgFUpIfoyAdKn-oh', 'GjNKThCMkJqC4rMp-e21u'],
        projectId: 'project1',
      });

      const subtask1 = createMockTask({
        id: 'J51QnQgFUpIfoyAdKn-oh',
        title: 'Task B',
        parentId: 'QtsKTxuqH8hkHH6oVW2Bu',
        projectId: 'project1',
      });

      const subtask2 = createMockTask({
        id: 'GjNKThCMkJqC4rMp-e21u',
        title: 'Task D',
        parentId: 'QtsKTxuqH8hkHH6oVW2Bu',
        projectId: 'project1',
      });

      // Add tasks to state
      baseState[TASK_FEATURE_NAME].entities = {
        QtsKTxuqH8hkHH6oVW2Bu: parentTask,
        'J51QnQgFUpIfoyAdKn-oh': subtask1,
        'GjNKThCMkJqC4rMp-e21u': subtask2,
      };
      baseState[TASK_FEATURE_NAME].ids = [
        'QtsKTxuqH8hkHH6oVW2Bu',
        'J51QnQgFUpIfoyAdKn-oh',
        'GjNKThCMkJqC4rMp-e21u',
      ];

      // Operation: Update parent to have empty subTaskIds
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'QtsKTxuqH8hkHH6oVW2Bu',
          updates: {
            subTaskIds: [],
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      // Verify parent task has empty subTaskIds
      const updatedParentTask = result[TASK_FEATURE_NAME].entities[
        'QtsKTxuqH8hkHH6oVW2Bu'
      ] as Task;
      expect(updatedParentTask.subTaskIds).toEqual([]);
    });

    it('should handle multiple update operations including subTaskIds changes', () => {
      // Setup: Create parent task with subtasks
      const parentTask = createMockTask({
        id: '74koiXFDzSSBzDunlGAi-',
        title: 'Main Task',
        subTaskIds: ['old-subtask-1', 'old-subtask-2', 'old-subtask-3'],
        projectId: 'project1',
      });

      const oldSubtask1 = createMockTask({
        id: 'old-subtask-1',
        title: 'Old Subtask 1',
        parentId: '74koiXFDzSSBzDunlGAi-',
        projectId: 'project1',
      });

      const oldSubtask2 = createMockTask({
        id: 'old-subtask-2',
        title: 'Old Subtask 2',
        parentId: '74koiXFDzSSBzDunlGAi-',
        projectId: 'project1',
      });

      const oldSubtask3 = createMockTask({
        id: 'old-subtask-3',
        title: 'Old Subtask 3',
        parentId: '74koiXFDzSSBzDunlGAi-',
        projectId: 'project1',
      });

      // Add tasks to state
      baseState[TASK_FEATURE_NAME].entities = {
        '74koiXFDzSSBzDunlGAi-': parentTask,
        'old-subtask-1': oldSubtask1,
        'old-subtask-2': oldSubtask2,
        'old-subtask-3': oldSubtask3,
      };
      baseState[TASK_FEATURE_NAME].ids = [
        '74koiXFDzSSBzDunlGAi-',
        'old-subtask-1',
        'old-subtask-2',
        'old-subtask-3',
      ];

      // Operations: Update parent with new subtask IDs
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: '74koiXFDzSSBzDunlGAi-',
          updates: {
            subTaskIds: ['old-subtask-1'], // Only keep the first subtask
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      // Verify parent task was updated correctly
      const updatedParentTask = result[TASK_FEATURE_NAME].entities[
        '74koiXFDzSSBzDunlGAi-'
      ] as Task;
      expect(updatedParentTask.subTaskIds).toEqual(['old-subtask-1']);
    });

    it('should skip update for non-existent task', () => {
      // Operation: Try to update a task that doesn't exist
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'non-existent-task',
          updates: {
            subTaskIds: [],
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      // Spy on Log.warn
      spyOn(Log, 'warn');

      const result = metaReducer(baseState, action);

      // Verify warning was logged
      expect(Log.warn).toHaveBeenCalledWith(
        'Skipping update for non-existent task: non-existent-task',
      );

      // Verify state wasn't changed
      expect(result[TASK_FEATURE_NAME]).toEqual(baseState[TASK_FEATURE_NAME]);
    });

    it('should handle reordering of subtasks', () => {
      // Setup: Create parent task with subtasks
      const parentTask = createMockTask({
        id: 'parent-task',
        title: 'Parent Task',
        subTaskIds: ['subtask-a', 'subtask-b', 'subtask-c'],
        projectId: 'project1',
      });

      const subtaskA = createMockTask({
        id: 'subtask-a',
        title: 'Subtask A',
        parentId: 'parent-task',
        projectId: 'project1',
      });

      const subtaskB = createMockTask({
        id: 'subtask-b',
        title: 'Subtask B',
        parentId: 'parent-task',
        projectId: 'project1',
      });

      const subtaskC = createMockTask({
        id: 'subtask-c',
        title: 'Subtask C',
        parentId: 'parent-task',
        projectId: 'project1',
      });

      // Add tasks to state
      baseState[TASK_FEATURE_NAME].entities = {
        'parent-task': parentTask,
        'subtask-a': subtaskA,
        'subtask-b': subtaskB,
        'subtask-c': subtaskC,
      };
      baseState[TASK_FEATURE_NAME].ids = [
        'parent-task',
        'subtask-a',
        'subtask-b',
        'subtask-c',
      ];

      // Operation: Reorder subtasks
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'parent-task',
          updates: {
            subTaskIds: ['subtask-c', 'subtask-a', 'subtask-b'], // Changed order
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      // Verify parent task has reordered subtasks
      const updatedParentTask = result[TASK_FEATURE_NAME].entities['parent-task'] as Task;
      expect(updatedParentTask.subTaskIds).toEqual([
        'subtask-c',
        'subtask-a',
        'subtask-b',
      ]);
    });

    it('should handle combined updates to task properties including subTaskIds', () => {
      // Setup: Create parent task
      const parentTask = createMockTask({
        id: 'parent-task',
        title: 'Original Title',
        notes: 'Original notes',
        isDone: false,
        subTaskIds: ['subtask-1', 'subtask-2'],
        projectId: 'project1',
      });

      // Add task to state
      baseState[TASK_FEATURE_NAME].entities = {
        'parent-task': parentTask,
      };
      baseState[TASK_FEATURE_NAME].ids = ['parent-task'];

      // Operation: Update multiple properties including subTaskIds
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'parent-task',
          updates: {
            title: 'Updated Title',
            notes: 'Updated notes',
            isDone: true,
            subTaskIds: ['subtask-2'], // Remove subtask-1
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      // Verify all properties were updated
      const updatedTask = result[TASK_FEATURE_NAME].entities['parent-task'] as Task;
      expect(updatedTask.title).toBe('Updated Title');
      expect(updatedTask.notes).toBe('Updated notes');
      expect(updatedTask.isDone).toBe(true);
      expect(updatedTask.subTaskIds).toEqual(['subtask-2']);
    });

    it('should handle moving subtask to new parent with temp ID resolution', () => {
      // Create initial state with two parent tasks and one subtask
      const parentTask1 = createMockTask({
        id: 'parent1-id',
        title: 'Parent 1',
        subTaskIds: ['subtask-id'],
        projectId: 'project1',
      });
      const parentTask2 = createMockTask({
        id: 'parent2-id',
        title: 'Parent 2',
        subTaskIds: [],
        projectId: 'project1',
      });
      const subtask = createMockTask({
        id: 'subtask-id',
        title: 'Subtask',
        projectId: 'project1',
        parentId: 'parent1-id',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'parent1-id': parentTask1,
            'parent2-id': parentTask2,
            'subtask-id': subtask,
          },
          ids: ['parent1-id', 'parent2-id', 'subtask-id'],
        },
      };

      // Move subtask from parent1 to parent2 using temp ID
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'subtask-id',
          updates: {
            parentId: 'temp_new_parent',
          },
        } as BatchTaskUpdate,
      ];

      const createdTaskIds = {
        temp_new_parent: 'parent2-id',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify subtask was moved to new parent
      const updatedSubtask = result[TASK_FEATURE_NAME].entities['subtask-id'] as Task;
      expect(updatedSubtask.parentId).toBe('parent2-id');

      // Verify old parent no longer has the subtask
      const updatedParent1 = result[TASK_FEATURE_NAME].entities['parent1-id'] as Task;
      expect(updatedParent1.subTaskIds).toEqual([]);

      // Verify new parent now has the subtask
      const updatedParent2 = result[TASK_FEATURE_NAME].entities['parent2-id'] as Task;
      expect(updatedParent2.subTaskIds).toContain('subtask-id');
      expect(updatedParent2.subTaskIds.length).toBe(1);
    });

    it('should handle converting null parentId to undefined when moving subtask to root', () => {
      // Create initial state with parent task and subtask
      const parentTask = createMockTask({
        id: 'parent-id',
        title: 'Parent',
        subTaskIds: ['subtask-id'],
        projectId: 'project1',
      });
      const subtask = createMockTask({
        id: 'subtask-id',
        title: 'Subtask',
        projectId: 'project1',
        parentId: 'parent-id',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'parent-id': parentTask,
            'subtask-id': subtask,
          },
          ids: ['parent-id', 'subtask-id'],
        },
      };

      // Move subtask to root level (null parentId should become undefined)
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'subtask-id',
          updates: {
            parentId: null as any, // Simulating null from external source
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify subtask is now at root level (parentId is undefined)
      const updatedSubtask = result[TASK_FEATURE_NAME].entities['subtask-id'] as Task;
      expect(updatedSubtask.parentId).toBeUndefined();

      // Verify old parent no longer has the subtask
      const updatedParent = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
      expect(updatedParent.subTaskIds).toEqual([]);
    });

    it('should resolve temp IDs in subTaskIds when creating subtask and updating parent order', () => {
      // Setup: Parent with one existing subtask
      const parentTask = createMockTask({
        id: 'parent-id',
        title: 'Parent',
        subTaskIds: ['existing-subtask-id'],
        projectId: 'project1',
      });
      const existingSubtask = createMockTask({
        id: 'existing-subtask-id',
        title: 'Existing Subtask',
        projectId: 'project1',
        parentId: 'parent-id',
      });

      baseState[TASK_FEATURE_NAME].entities = {
        'parent-id': parentTask,
        'existing-subtask-id': existingSubtask,
      };
      baseState[TASK_FEATURE_NAME].ids = ['parent-id', 'existing-subtask-id'];

      // Operations: create new subtask with temp ID, then update parent's subTaskIds
      // with the temp ID (this is what the sync-md plugin produces)
      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp_2',
          data: {
            parentId: 'parent-id',
            title: 'New Subtask',
          },
        } as BatchTaskCreate,
        {
          type: 'update',
          taskId: 'parent-id',
          updates: {
            subTaskIds: ['existing-subtask-id', 'temp_2'],
          },
        } as BatchTaskUpdate,
      ];

      const createdTaskIds: Record<string, string> = {
        temp_2: 'new-subtask-real-id',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(baseState, action);

      // Parent's subTaskIds should have the resolved real ID, not the temp ID
      const updatedParent = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
      expect(updatedParent.subTaskIds).toEqual([
        'existing-subtask-id',
        'new-subtask-real-id',
      ]);

      // New subtask should exist with correct parentId
      const newSubtask = result[TASK_FEATURE_NAME].entities[
        'new-subtask-real-id'
      ] as Task;
      expect(newSubtask).toBeDefined();
      expect(newSubtask.parentId).toBe('parent-id');

      // No entity with the temp ID should exist
      expect(result[TASK_FEATURE_NAME].entities['temp_2']).toBeUndefined();
    });

    it('should handle adding subtask to parent that already has other subtasks', () => {
      // Create initial state with parent having existing subtasks
      const parentTask = createMockTask({
        id: 'parent-id',
        title: 'Parent',
        subTaskIds: ['existing-subtask-id'],
        projectId: 'project1',
      });
      const existingSubtask = createMockTask({
        id: 'existing-subtask-id',
        title: 'Existing Subtask',
        projectId: 'project1',
        parentId: 'parent-id',
      });
      const movingSubtask = createMockTask({
        id: 'moving-subtask-id',
        title: 'Moving Subtask',
        projectId: 'project1',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'parent-id': parentTask,
            'existing-subtask-id': existingSubtask,
            'moving-subtask-id': movingSubtask,
          },
          ids: ['parent-id', 'existing-subtask-id', 'moving-subtask-id'],
        },
      };

      // Move subtask to parent that already has children
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'moving-subtask-id',
          updates: {
            parentId: 'parent-id',
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify moving subtask now has correct parent
      const updatedMovingSubtask = result[TASK_FEATURE_NAME].entities[
        'moving-subtask-id'
      ] as Task;
      expect(updatedMovingSubtask.parentId).toBe('parent-id');

      // Verify parent now has both subtasks
      const updatedParent = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
      expect(updatedParent.subTaskIds).toContain('existing-subtask-id');
      expect(updatedParent.subTaskIds).toContain('moving-subtask-id');
      expect(updatedParent.subTaskIds.length).toBe(2);
    });
  });

  describe('Delete Operations', () => {
    it('should handle deleting non-existent task with warning', () => {
      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'non-existent-task-id',
        },
      ];

      // Spy on Log.err (note: the code uses Log.err, not Log.warn for delete)
      spyOn(Log, 'err');

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      // Verify warning was logged
      expect(Log.err).toHaveBeenCalledWith(
        'Skipping delete for non-existent task: non-existent-task-id',
      );

      // Verify state wasn't changed
      expect(result[TASK_FEATURE_NAME]).toEqual(baseState[TASK_FEATURE_NAME]);
    });

    it('should delete subtask and remove it from parent subTaskIds', () => {
      // Create initial state with parent and subtask
      const parentTask = createMockTask({
        id: 'parent-id',
        title: 'Parent Task',
        subTaskIds: ['subtask-1', 'subtask-2'],
        projectId: 'project1',
      });
      const subtask1 = createMockTask({
        id: 'subtask-1',
        title: 'Subtask 1',
        projectId: 'project1',
        parentId: 'parent-id',
      });
      const subtask2 = createMockTask({
        id: 'subtask-2',
        title: 'Subtask 2',
        projectId: 'project1',
        parentId: 'parent-id',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'parent-id': parentTask,
            'subtask-1': subtask1,
            'subtask-2': subtask2,
          },
          ids: ['parent-id', 'subtask-1', 'subtask-2'],
        },
      };

      // Delete one subtask
      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'subtask-1',
        },
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify subtask was deleted
      expect(result[TASK_FEATURE_NAME].entities['subtask-1']).toBeUndefined();

      // Verify other subtask still exists
      expect(result[TASK_FEATURE_NAME].entities['subtask-2']).toBeDefined();

      // Verify parent's subTaskIds was updated
      const updatedParent = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
      expect(updatedParent.subTaskIds).toEqual(['subtask-2']);
      expect(updatedParent.subTaskIds).not.toContain('subtask-1');
    });

    it('should delete parent task and its direct subtasks', () => {
      // Create initial state with parent and subtasks
      const parentTask = createMockTask({
        id: 'parent-id',
        title: 'Parent Task',
        subTaskIds: ['subtask-1', 'subtask-2'],
        projectId: 'project1',
      });
      const subtask1 = createMockTask({
        id: 'subtask-1',
        title: 'Subtask 1',
        projectId: 'project1',
        parentId: 'parent-id',
      });
      const subtask2 = createMockTask({
        id: 'subtask-2',
        title: 'Subtask 2',
        projectId: 'project1',
        parentId: 'parent-id',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'parent-id': parentTask,
            'subtask-1': subtask1,
            'subtask-2': subtask2,
          },
          ids: ['parent-id', 'subtask-1', 'subtask-2'],
        },
      };

      // Delete parent task (should delete parent and its direct subtasks)
      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'parent-id',
        },
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify parent and direct subtasks were deleted
      expect(result[TASK_FEATURE_NAME].entities['parent-id']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['subtask-1']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['subtask-2']).toBeUndefined();

      // Verify task IDs were removed from the list
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('parent-id');
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('subtask-1');
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('subtask-2');
    });

    it('should handle deleting subtask when parent has pending subTaskIds updates', () => {
      // Create initial state with parent and subtasks
      const parentTask = createMockTask({
        id: 'parent-id',
        title: 'Parent Task',
        subTaskIds: ['subtask-1', 'subtask-2'],
        projectId: 'project1',
      });
      const subtask1 = createMockTask({
        id: 'subtask-1',
        title: 'Subtask 1',
        projectId: 'project1',
        parentId: 'parent-id',
      });
      const subtask2 = createMockTask({
        id: 'subtask-2',
        title: 'Subtask 2',
        projectId: 'project1',
        parentId: 'parent-id',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'parent-id': parentTask,
            'subtask-1': subtask1,
            'subtask-2': subtask2,
          },
          ids: ['parent-id', 'subtask-1', 'subtask-2'],
        },
      };

      // First update parent's subTaskIds, then delete one of the subtasks
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'parent-id',
          updates: {
            subTaskIds: ['subtask-2', 'subtask-1'], // Reorder
          },
        },
        {
          type: 'delete',
          taskId: 'subtask-1',
        },
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify subtask was deleted
      expect(result[TASK_FEATURE_NAME].entities['subtask-1']).toBeUndefined();

      // Verify parent's subTaskIds reflects both the reorder and the deletion
      const updatedParent = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
      expect(updatedParent.subTaskIds).toEqual(['subtask-2']);
      expect(updatedParent.subTaskIds).not.toContain('subtask-1');
    });

    it('should handle deleting root task without parent', () => {
      // Create initial state with a root task
      const rootTask = createMockTask({
        id: 'root-task',
        title: 'Root Task',
        projectId: 'project1',
      });

      const stateWithTasks = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            'root-task': rootTask,
          },
          ids: ['root-task'],
        },
      };

      // Delete root task
      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'root-task',
        },
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTasks, action);

      // Verify root task was deleted
      expect(result[TASK_FEATURE_NAME].entities['root-task']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].ids).not.toContain('root-task');
    });
  });
});
