/* eslint-disable @typescript-eslint/naming-convention */
import { taskBatchUpdateMetaReducer } from './task-batch-update.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { Task } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import {
  BatchTaskCreate,
  BatchTaskUpdate,
  BatchTaskDelete,
  BatchTaskReorder,
  BatchOperation,
} from '@super-productivity/plugin-api';
import { createBaseState, createStateWithExistingTasks } from './test-utils';

describe('taskBatchUpdateMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskBatchUpdateMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('project validation', () => {
    it('should skip batch update if project does not exist', () => {
      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'non-existent-project',
        operations: [],
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
      expect(result).toBe(baseState);
    });

    it('should process batch update if project exists', () => {
      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations: [],
        createdTaskIds: {},
      });

      metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalled();
    });
  });

  describe('create operations', () => {
    it('should create a new task with provided ID', () => {
      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp-1',
          data: {
            title: 'New Task',
            isDone: false,
          },
        } as BatchTaskCreate,
      ];

      const createdTaskIds = {
        'temp-1': 'actual-id-1',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(baseState, action);

      // Check task was created
      expect(result[TASK_FEATURE_NAME].entities['actual-id-1']).toBeTruthy();
      const task = result[TASK_FEATURE_NAME].entities['actual-id-1'] as Task;
      expect(task.title).toBe('New Task');
      expect(task.projectId).toBe('project1');
      expect(task.isDone).toBe(false);
    });

    it('should skip task creation if title is empty', () => {
      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp-1',
          data: {
            title: '',
            isDone: false,
          },
        } as BatchTaskCreate,
      ];

      const createdTaskIds = {
        'temp-1': 'actual-id-1',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(baseState, action);

      expect(result[TASK_FEATURE_NAME].entities['actual-id-1']).toBeUndefined();
    });

    it('should skip task creation if circular dependency detected', () => {
      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp-1',
          data: {
            title: 'Task with circular dependency',
            parentId: 'actual-id-1', // Same as the actual ID
          },
        } as BatchTaskCreate,
      ];

      const createdTaskIds = {
        'temp-1': 'actual-id-1',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(baseState, action);

      expect(result[TASK_FEATURE_NAME].entities['actual-id-1']).toBeUndefined();
    });

    it('should create subtask and update parent', () => {
      const stateWithParent = createStateWithExistingTasks(['parent-task']);

      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp-1',
          data: {
            title: 'Subtask',
            parentId: 'parent-task',
          },
        } as BatchTaskCreate,
      ];

      const createdTaskIds = {
        'temp-1': 'subtask-id',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(stateWithParent, action);

      expect(result[TASK_FEATURE_NAME].entities['subtask-id']).toBeTruthy();
      const parentTask = result[TASK_FEATURE_NAME].entities['parent-task'] as Task;
      expect(parentTask.subTaskIds).toContain('subtask-id');
    });

    it('should resolve temp parent IDs', () => {
      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp-parent',
          data: {
            title: 'Parent Task',
          },
        } as BatchTaskCreate,
        {
          type: 'create',
          tempId: 'temp-child',
          data: {
            title: 'Child Task',
            parentId: 'temp-parent',
          },
        } as BatchTaskCreate,
      ];

      const createdTaskIds = {
        'temp-parent': 'parent-id',
        'temp-child': 'child-id',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(baseState, action);

      const childTask = result[TASK_FEATURE_NAME].entities['child-id'] as Task;
      expect(childTask.parentId).toBe('parent-id');

      const parentTask = result[TASK_FEATURE_NAME].entities['parent-id'] as Task;
      expect(parentTask.subTaskIds).toContain('child-id');
    });
  });

  describe('update operations', () => {
    it('should update existing task', () => {
      const stateWithTask = createStateWithExistingTasks(['task-1']);

      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'task-1',
          updates: {
            title: 'Updated Title',
            isDone: true,
            notes: 'Updated notes',
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(stateWithTask, action);

      const task = result[TASK_FEATURE_NAME].entities['task-1'] as Task;
      expect(task.title).toBe('Updated Title');
      expect(task.isDone).toBe(true);
      expect(task.notes).toBe('Updated notes');
    });

    it('should skip update for non-existent task', () => {
      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'non-existent',
          updates: {
            title: 'Updated Title',
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(baseState, action);

      expect(result[TASK_FEATURE_NAME].entities['non-existent']).toBeUndefined();
    });

    it('should handle parent ID changes correctly', () => {
      const state = createStateWithExistingTasks(['parent1', 'parent2', 'child']);
      // Set up initial parent-child relationship
      state[TASK_FEATURE_NAME].entities['child'] = {
        ...state[TASK_FEATURE_NAME].entities['child']!,
        parentId: 'parent1',
      };
      state[TASK_FEATURE_NAME].entities['parent1'] = {
        ...state[TASK_FEATURE_NAME].entities['parent1']!,
        subTaskIds: ['child'],
      };

      const operations: BatchOperation[] = [
        {
          type: 'update',
          taskId: 'child',
          updates: {
            parentId: 'parent2',
          },
        } as BatchTaskUpdate,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(state, action);

      const parent1 = result[TASK_FEATURE_NAME].entities['parent1'] as Task;
      const parent2 = result[TASK_FEATURE_NAME].entities['parent2'] as Task;
      const child = result[TASK_FEATURE_NAME].entities['child'] as Task;

      expect(parent1.subTaskIds).not.toContain('child');
      expect(parent2.subTaskIds).toContain('child');
      expect(child.parentId).toBe('parent2');
    });
  });

  describe('delete operations', () => {
    it('should delete task and remove from parent', () => {
      const state = createStateWithExistingTasks(['parent', 'child']);
      // Set up parent-child relationship
      state[TASK_FEATURE_NAME].entities['child'] = {
        ...state[TASK_FEATURE_NAME].entities['child']!,
        parentId: 'parent',
      };
      state[TASK_FEATURE_NAME].entities['parent'] = {
        ...state[TASK_FEATURE_NAME].entities['parent']!,
        subTaskIds: ['child'],
      };

      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'child',
        } as BatchTaskDelete,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(state, action);

      expect(result[TASK_FEATURE_NAME].entities['child']).toBeUndefined();
      const parent = result[TASK_FEATURE_NAME].entities['parent'] as Task;
      expect(parent.subTaskIds).not.toContain('child');
    });

    it('should cascade delete subtasks', () => {
      const state = createStateWithExistingTasks(['parent', 'child1', 'child2']);
      state[TASK_FEATURE_NAME].entities['parent'] = {
        ...state[TASK_FEATURE_NAME].entities['parent']!,
        subTaskIds: ['child1', 'child2'],
      };
      state[TASK_FEATURE_NAME].entities['child1'] = {
        ...state[TASK_FEATURE_NAME].entities['child1']!,
        parentId: 'parent',
      };
      state[TASK_FEATURE_NAME].entities['child2'] = {
        ...state[TASK_FEATURE_NAME].entities['child2']!,
        parentId: 'parent',
      };

      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'parent',
        } as BatchTaskDelete,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(state, action);

      expect(result[TASK_FEATURE_NAME].entities['parent']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['child1']).toBeUndefined();
      expect(result[TASK_FEATURE_NAME].entities['child2']).toBeUndefined();
    });

    it('should skip delete for non-existent task', () => {
      const operations: BatchOperation[] = [
        {
          type: 'delete',
          taskId: 'non-existent',
        } as BatchTaskDelete,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      // Should not throw, just skip
      expect(() => metaReducer(baseState, action)).not.toThrow();
    });
  });

  describe('reorder operations', () => {
    it('should reorder project tasks', () => {
      const state = createStateWithExistingTasks(['task1', 'task2', 'task3']);
      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['task1', 'task2', 'task3'],
      };

      const operations: BatchOperation[] = [
        {
          type: 'reorder',
          taskIds: ['task3', 'task1', 'task2'],
        } as BatchTaskReorder,
      ];

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds: {},
      });

      const result = metaReducer(state, action);

      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      expect(project?.taskIds).toEqual(['task3', 'task1', 'task2']);
    });

    it('should resolve temp IDs in reorder', () => {
      const state = createStateWithExistingTasks(['existing1', 'existing2']);
      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['existing1', 'existing2'],
      };

      const operations: BatchOperation[] = [
        {
          type: 'create',
          tempId: 'temp-new',
          data: {
            title: 'New Task',
          },
        } as BatchTaskCreate,
        {
          type: 'reorder',
          taskIds: ['temp-new', 'existing1', 'existing2'],
        } as BatchTaskReorder,
      ];

      const createdTaskIds = {
        'temp-new': 'new-task-id',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(state, action);

      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      expect(project?.taskIds).toEqual(['new-task-id', 'existing1', 'existing2']);
    });
  });

  describe('mixed operations', () => {
    it('should handle multiple operations in correct order', () => {
      const state = createStateWithExistingTasks(['task1', 'task2']);
      state[PROJECT_FEATURE_NAME].entities['project1'] = {
        ...state[PROJECT_FEATURE_NAME].entities['project1']!,
        taskIds: ['task1', 'task2'],
      };

      const operations: BatchOperation[] = [
        // Create a new task
        {
          type: 'create',
          tempId: 'temp-new',
          data: {
            title: 'New Task',
          },
        } as BatchTaskCreate,
        // Update existing task
        {
          type: 'update',
          taskId: 'task1',
          updates: {
            title: 'Updated Task 1',
          },
        } as BatchTaskUpdate,
        // Delete a task
        {
          type: 'delete',
          taskId: 'task2',
        } as BatchTaskDelete,
        // Reorder
        {
          type: 'reorder',
          taskIds: ['temp-new', 'task1'],
        } as BatchTaskReorder,
      ];

      const createdTaskIds = {
        'temp-new': 'new-task-id',
      };

      const action = TaskSharedActions.batchUpdateForProject({
        projectId: 'project1',
        operations,
        createdTaskIds,
      });

      const result = metaReducer(state, action);

      // Check create
      expect(result[TASK_FEATURE_NAME].entities['new-task-id']).toBeTruthy();

      // Check update
      const task1 = result[TASK_FEATURE_NAME].entities['task1'] as Task;
      expect(task1.title).toBe('Updated Task 1');

      // Check delete
      expect(result[TASK_FEATURE_NAME].entities['task2']).toBeUndefined();

      // Check reorder
      const project = result[PROJECT_FEATURE_NAME].entities['project1'];
      expect(project?.taskIds).toEqual(['new-task-id', 'task1']);
    });
  });
});
