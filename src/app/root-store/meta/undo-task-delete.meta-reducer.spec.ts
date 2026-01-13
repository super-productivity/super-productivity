import {
  undoTaskDeleteMetaReducer,
  getLastDeletePayload,
} from './undo-task-delete.meta-reducer';
import { TaskSharedActions } from './task-shared.actions';
import { RootState } from '../root-state';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { Tag } from '../../features/tag/tag.model';
import { Project } from '../../features/project/project.model';
import { Action, ActionReducer } from '@ngrx/store';
import { DEFAULT_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG, TODAY_TAG } from '../../features/tag/tag.const';

describe('undoTaskDeleteMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  // =============================================================================
  // TEST HELPERS
  // =============================================================================

  const createMockTask = (overrides: Partial<Task> = {}): Task => ({
    ...DEFAULT_TASK,
    id: 'task1',
    title: 'Test Task',
    tagIds: ['tag1'],
    projectId: 'project1',
    ...overrides,
  });

  const createMockTaskWithSubTasks = (
    overrides: Partial<TaskWithSubTasks> = {},
  ): TaskWithSubTasks => ({
    ...createMockTask(overrides),
    subTasks: overrides.subTasks || [],
  });

  const createMockProject = (overrides: Partial<Project> = {}): Project => ({
    ...DEFAULT_PROJECT,
    id: 'project1',
    title: 'Test Project',
    isEnableBacklog: true,
    taskIds: ['task1'],
    backlogTaskIds: [],
    ...overrides,
  });

  const createMockTag = (overrides: Partial<Tag> = {}): Tag => ({
    ...DEFAULT_TAG,
    id: 'tag1',
    title: 'Test Tag',
    taskIds: ['task1'],
    ...overrides,
  });

  const createMockState = (overrides: any = {}): RootState =>
    ({
      [TASK_FEATURE_NAME]: {
        entities: {
          task1: createMockTask(),
          parentTask: createMockTask({ id: 'parentTask', subTaskIds: ['task1'] }),
          ...overrides.taskEntities,
        },
        ids: ['task1', 'parentTask'],
        ...overrides.taskState,
      },
      [PROJECT_FEATURE_NAME]: {
        entities: {
          project1: createMockProject(),
          INBOX_PROJECT: createMockProject({
            id: 'INBOX_PROJECT',
            title: 'Inbox',
            taskIds: [],
            backlogTaskIds: [],
          }),
          ...overrides.projectEntities,
        },
        ids: ['project1', 'INBOX_PROJECT'],
        ...overrides.projectState,
      },
      [TAG_FEATURE_NAME]: {
        entities: {
          tag1: createMockTag(),
          [TODAY_TAG.id]: { ...TODAY_TAG, taskIds: ['task1'] },
          ...overrides.tagEntities,
        },
        ids: ['tag1', TODAY_TAG.id],
        ...overrides.tagState,
      },
      ...overrides.otherState,
    }) as any;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = undoTaskDeleteMetaReducer(mockReducer);
    baseState = createMockState();
    // Clear any previous payload
    getLastDeletePayload();
  });

  // =============================================================================
  // DELETE TASK - STATE CAPTURE TESTS
  // =============================================================================

  describe('deleteTask action - state capture', () => {
    it('should capture state and pass through to reducer', () => {
      const task = createMockTaskWithSubTasks();
      const action = TaskSharedActions.deleteTask({ task });

      const result = metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
      expect(result).toBe(baseState);
    });

    it('should capture task data in payload', () => {
      const task = createMockTaskWithSubTasks();
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);
      const payload = getLastDeletePayload();

      expect(payload).toBeDefined();
      expect(payload!.task).toEqual(task);
      expect(payload!.deletedTaskEntities['task1']).toBeDefined();
    });

    it('should capture project context for main tasks', () => {
      const task = createMockTaskWithSubTasks({ projectId: 'project1' });
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);
      const payload = getLastDeletePayload();

      expect(payload!.projectContext).toBeDefined();
      expect(payload!.projectContext!.projectId).toBe('project1');
      expect(payload!.projectContext!.taskIdsForProject).toContain('task1');
    });

    it('should capture parent context for subtasks', () => {
      const subTask = createMockTaskWithSubTasks({
        id: 'sub1',
        parentId: 'parentTask',
        projectId: 'project1',
      });
      const state = createMockState({
        taskEntities: {
          parentTask: createMockTask({ id: 'parentTask', subTaskIds: ['sub1'] }),
          sub1: subTask,
        },
      });
      const action = TaskSharedActions.deleteTask({ task: subTask });

      metaReducer(state, action);
      const payload = getLastDeletePayload();

      expect(payload!.parentContext).toBeDefined();
      expect(payload!.parentContext!.parentTaskId).toBe('parentTask');
      expect(payload!.parentContext!.subTaskIds).toContain('sub1');
    });

    it('should capture tag associations including TODAY_TAG', () => {
      const task = createMockTaskWithSubTasks({ tagIds: ['tag1'] });
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);
      const payload = getLastDeletePayload();

      expect(payload!.tagTaskIdMap['tag1']).toBeDefined();
      expect(payload!.tagTaskIdMap['tag1']).toContain('task1');
      expect(payload!.tagTaskIdMap[TODAY_TAG.id]).toBeDefined();
      expect(payload!.tagTaskIdMap[TODAY_TAG.id]).toContain('task1');
    });

    it('should capture subtask information', () => {
      const subTask1 = createMockTask({
        id: 'sub1',
        parentId: 'task1',
        tagIds: ['tag2'],
      });
      const subTask2 = createMockTask({
        id: 'sub2',
        parentId: 'task1',
        tagIds: ['tag3'],
      });
      const task = createMockTaskWithSubTasks({
        subTaskIds: ['sub1', 'sub2'],
        subTasks: [subTask1, subTask2],
      });
      const state = createMockState({
        taskEntities: {
          task1: task,
          sub1: subTask1,
          sub2: subTask2,
        },
        tagEntities: {
          tag1: createMockTag({ taskIds: ['task1'] }),
          tag2: createMockTag({ id: 'tag2', taskIds: ['sub1'] }),
          tag3: createMockTag({ id: 'tag3', taskIds: ['sub2'] }),
          [TODAY_TAG.id]: { ...TODAY_TAG, taskIds: ['task1', 'sub1', 'sub2'] },
        },
      });

      const action = TaskSharedActions.deleteTask({ task });
      metaReducer(state, action);
      const payload = getLastDeletePayload();

      // Check all entities are captured
      expect(payload!.deletedTaskEntities['task1']).toBeDefined();
      expect(payload!.deletedTaskEntities['sub1']).toBeDefined();
      expect(payload!.deletedTaskEntities['sub2']).toBeDefined();

      // Check tag associations are captured
      expect(payload!.tagTaskIdMap['tag2']).toContain('sub1');
      expect(payload!.tagTaskIdMap['tag3']).toContain('sub2');
    });

    it('should handle task with undefined subTasks', () => {
      const taskWithUndefinedSubTasks = {
        ...createMockTask(),
        subTasks: undefined,
      } as any as TaskWithSubTasks;
      const action = TaskSharedActions.deleteTask({ task: taskWithUndefinedSubTasks });

      expect(() => metaReducer(baseState, action)).not.toThrow();

      const payload = getLastDeletePayload();
      expect(payload).toBeDefined();
      expect(payload!.task.id).toBe('task1');
    });

    it('should throw error if project data is invalid', () => {
      const state = createMockState({
        projectEntities: {
          project1: { ...createMockProject(), taskIds: null, backlogTaskIds: null },
        },
      });
      const task = createMockTaskWithSubTasks();
      const action = TaskSharedActions.deleteTask({ task });

      expect(() => metaReducer(state, action)).toThrowError('Invalid project data');
    });

    it('should handle task without project', () => {
      const task = createMockTaskWithSubTasks({ projectId: '' });
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);
      const payload = getLastDeletePayload();

      expect(payload!.projectContext).toBeUndefined();
    });

    it('should handle task with non-existent project', () => {
      const task = createMockTaskWithSubTasks({ projectId: 'nonExistentProject' });
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);
      const payload = getLastDeletePayload();

      expect(payload!.projectContext).toBeUndefined();
    });
  });

  // =============================================================================
  // getLastDeletePayload() TESTS
  // =============================================================================

  describe('getLastDeletePayload', () => {
    it('should return null when no delete has occurred', () => {
      const payload = getLastDeletePayload();
      expect(payload).toBeNull();
    });

    it('should return payload after delete', () => {
      const task = createMockTaskWithSubTasks();
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);
      const payload = getLastDeletePayload();

      expect(payload).toBeDefined();
      expect(payload!.task.id).toBe('task1');
    });

    it('should clear payload after retrieval', () => {
      const task = createMockTaskWithSubTasks();
      const action = TaskSharedActions.deleteTask({ task });

      metaReducer(baseState, action);

      // First retrieval should return payload
      const payload1 = getLastDeletePayload();
      expect(payload1).toBeDefined();

      // Second retrieval should return null (cleared)
      const payload2 = getLastDeletePayload();
      expect(payload2).toBeNull();
    });

    it('should overwrite previous payload on new delete', () => {
      const task1 = createMockTaskWithSubTasks({ id: 'task1' });
      const task2 = createMockTaskWithSubTasks({ id: 'task2' });
      const state = createMockState({
        taskEntities: {
          task1: task1,
          task2: task2,
        },
        projectEntities: {
          project1: createMockProject({ taskIds: ['task1', 'task2'] }),
        },
        tagEntities: {
          tag1: createMockTag({ taskIds: ['task1', 'task2'] }),
          [TODAY_TAG.id]: { ...TODAY_TAG, taskIds: ['task1', 'task2'] },
        },
      });

      // Delete first task
      metaReducer(state, TaskSharedActions.deleteTask({ task: task1 }));
      // Delete second task (should overwrite)
      metaReducer(state, TaskSharedActions.deleteTask({ task: task2 }));

      const payload = getLastDeletePayload();
      expect(payload!.task.id).toBe('task2');
    });
  });

  // =============================================================================
  // OTHER ACTIONS
  // =============================================================================

  describe('other actions', () => {
    it('should pass through unrelated actions without capturing', () => {
      const action = { type: 'UNRELATED_ACTION' };
      const result = metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
      expect(result).toBe(baseState);

      // Should not have captured anything
      const payload = getLastDeletePayload();
      expect(payload).toBeNull();
    });
  });
});
