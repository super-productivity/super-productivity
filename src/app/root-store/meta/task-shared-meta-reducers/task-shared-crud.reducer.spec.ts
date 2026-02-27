/* eslint-disable @typescript-eslint/explicit-function-return-type,@typescript-eslint/naming-convention */
import { taskSharedCrudMetaReducer } from './task-shared-crud.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { Tag } from '../../../features/tag/tag.model';
import { Project } from '../../../features/project/project.model';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { Action, ActionReducer } from '@ngrx/store';
import { getDbDateStr } from '../../../util/get-db-date-str';
import {
  createBaseState,
  createMockTag,
  createMockTask,
  createStateWithExistingTasks,
  expectProjectUpdate,
  expectStateUpdate,
  expectTagUpdate,
  expectTagUpdates,
  expectTaskEntityExists,
  expectTaskEntityNotExists,
  expectTaskUpdate,
} from './test-utils';

describe('taskSharedCrudMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskSharedCrudMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('addTask action', () => {
    const createAddTaskAction = (
      taskOverrides: Partial<Task> = {},
      actionOverrides = {},
    ) =>
      TaskSharedActions.addTask({
        task: createMockTask(taskOverrides),
        workContextId: 'project1',
        workContextType: WorkContextType.PROJECT,
        isAddToBottom: false,
        isAddToBacklog: false,
        ...actionOverrides,
      });

    it('should add task to project taskIds when not adding to backlog', () => {
      const action = createAddTaskAction();

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should create task entity with correct properties', () => {
      const taskData = {
        id: 'task1',
        title: 'Test Task with Time',
        timeSpentOnDay: { '2023-12-06': 3600000 }, // 1 hour
        projectId: 'project1',
        tagIds: ['tag1'],
      };
      const action = createAddTaskAction(taskData);

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskUpdate('task1', {
            id: 'task1',
            title: 'Test Task with Time',
            timeSpent: 3600000, // Should be calculated from timeSpentOnDay
            projectId: 'project1',
            tagIds: ['tag1'],
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should create task entity with default values when minimal data provided', () => {
      const action = createAddTaskAction({ id: 'task1', title: 'Minimal Task' });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskUpdate('task1', {
            id: 'task1',
            title: 'Minimal Task',
            timeSpent: 0, // Should default to 0
            isDone: false, // Should use DEFAULT_TASK values
            subTaskIds: [],
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should add task to project backlogTaskIds when adding to backlog', () => {
      const action = createAddTaskAction({}, { isAddToBacklog: true });

      metaReducer(baseState, action);
      expectStateUpdate(
        expectProjectUpdate('project1', { backlogTaskIds: ['task1'] }),
        action,
        mockReducer,
        baseState,
      );
    });

    it('should add task to Today tag when due today', () => {
      const action = createAddTaskAction({ dueDay: getDbDateStr() });

      metaReducer(baseState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['task1'] },
          TODAY: { taskIds: ['task1'] },
        }),
        action,
        mockReducer,
        baseState,
      );
    });

    it('should add task to planner days when due in future', () => {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const tomorrowStr = getDbDateStr(tomorrow);

      const action = createAddTaskAction({ dueDay: tomorrowStr });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
          planner: jasmine.objectContaining({
            days: jasmine.objectContaining({
              [tomorrowStr]: ['task1'],
            }),
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should not add task to planner days when due today (should go to TODAY tag instead)', () => {
      const today = getDbDateStr();
      const action = createAddTaskAction({ dueDay: today });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          ...expectTagUpdates({
            tag1: { taskIds: ['task1'] },
            TODAY: { taskIds: ['task1'] },
          }),
          planner: jasmine.objectContaining({
            days: {}, // Should remain empty
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should not add task to planner days when no dueDay is specified', () => {
      const action = createAddTaskAction({ dueDay: undefined });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
          planner: jasmine.objectContaining({
            days: {}, // Should remain empty
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should add task to bottom when isAddToBottom is true', () => {
      const testState = createStateWithExistingTasks(
        ['existing-task'],
        [],
        ['existing-task'],
      );
      const action = createAddTaskAction({}, { isAddToBottom: true });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['existing-task', 'task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['existing-task', 'task1'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should skip project update when task has no projectId', () => {
      const action = createAddTaskAction({ projectId: '' });

      metaReducer(baseState, action);
      expectStateUpdate(
        expectTagUpdate('tag1', { taskIds: ['task1'] }),
        action,
        mockReducer,
        baseState,
      );
    });

    it('should handle task with missing properties gracefully', () => {
      const action = createAddTaskAction(
        {
          id: 'minimal-task',
          title: 'Minimal',
          projectId: '',
          tagIds: [],
          // No timeSpentOnDay, etc.
        },
        { workContextId: '', workContextType: WorkContextType.PROJECT },
      );

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('minimal-task'),
          ...expectTaskUpdate('minimal-task', {
            timeSpent: 0, // Should default to 0
            projectId: '', // Should default to empty string
            title: 'Minimal',
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should add task to correct project list based on isEnableBacklog', () => {
      // Test with project that has backlog disabled
      const testState = createStateWithExistingTasks();
      const project1 = testState[PROJECT_FEATURE_NAME].entities.project1 as Project;
      testState[PROJECT_FEATURE_NAME].entities.project1 = {
        ...project1,
        isEnableBacklog: false,
      };

      const action = createAddTaskAction({}, { isAddToBacklog: true });

      metaReducer(testState, action);
      expectStateUpdate(
        // Should add to taskIds instead of backlogTaskIds when backlog is disabled
        expectProjectUpdate('project1', { taskIds: ['task1'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle non-existent project gracefully', () => {
      const action = createAddTaskAction({ projectId: 'non-existent-project' });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          // Project should not be updated since it doesn't exist
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining(baseState[PROJECT_FEATURE_NAME].entities),
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should handle non-existent tags gracefully', () => {
      const action = createAddTaskAction({ tagIds: ['non-existent-tag'] });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          // No tag updates should happen since the tag doesn't exist
          [TAG_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              tag1: jasmine.objectContaining({
                taskIds: [], // Should remain empty since task only has non-existent tag
              }),
            }),
          }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should not duplicate task ID in project or tag taskIds when task already exists', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createAddTaskAction();

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('convertToMainTask action', () => {
    const createConvertAction = (
      taskOverrides: Partial<Task> = {},
      actionOverrides = {},
    ) => {
      // Create state with parent task that has tagIds for the sub-task to inherit
      const parentTask = createMockTask({
        id: 'parent-task',
        tagIds: ['tag1'],
        projectId: 'project1',
      });

      // Set up state with parent task
      const stateWithParent = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            ...baseState[TASK_FEATURE_NAME].entities,
            'parent-task': parentTask,
          },
          ids: [...baseState[TASK_FEATURE_NAME].ids, 'parent-task'],
        },
      };

      const action = TaskSharedActions.convertToMainTask({
        task: createMockTask({ parentId: 'parent-task', ...taskOverrides }),
        parentTagIds: ['tag1'],
        isPlanForToday: false,
        ...actionOverrides,
      });

      return { action, testState: stateWithParent };
    };

    it('should add task to project taskIds', () => {
      const { action, testState } = createConvertAction();

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should add task to Today tag when isPlanForToday is true', () => {
      const { action, testState } = createConvertAction({}, { isPlanForToday: true });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['task1'] },
          TODAY: { taskIds: ['task1'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should add task at the beginning of existing taskIds', () => {
      const { action, testState: baseTestState } = createConvertAction();

      // Combine with existing tasks state
      const testState = {
        ...baseTestState,
        [TASK_FEATURE_NAME]: {
          ...baseTestState[TASK_FEATURE_NAME],
          entities: {
            ...baseTestState[TASK_FEATURE_NAME].entities,
            'existing-task': createMockTask({ id: 'existing-task' }),
          },
          ids: [...baseTestState[TASK_FEATURE_NAME].ids, 'existing-task'],
        },
        [PROJECT_FEATURE_NAME]: {
          ...baseTestState[PROJECT_FEATURE_NAME],
          entities: {
            ...baseTestState[PROJECT_FEATURE_NAME].entities,
            project1: {
              ...baseTestState[PROJECT_FEATURE_NAME].entities.project1,
              taskIds: ['existing-task'],
            } as Project,
          },
        },
        [TAG_FEATURE_NAME]: {
          ...baseTestState[TAG_FEATURE_NAME],
          entities: {
            ...baseTestState[TAG_FEATURE_NAME].entities,
            tag1: {
              ...baseTestState[TAG_FEATURE_NAME].entities.tag1,
              taskIds: ['existing-task'],
            } as Tag,
          },
        },
      };

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1', 'existing-task'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1', 'existing-task'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should not duplicate task ID in project or tag taskIds when task already exists', () => {
      const { action, testState: baseTestState } = createConvertAction();

      const testState = {
        ...baseTestState,
        [PROJECT_FEATURE_NAME]: {
          ...baseTestState[PROJECT_FEATURE_NAME],
          entities: {
            ...baseTestState[PROJECT_FEATURE_NAME].entities,
            project1: {
              ...baseTestState[PROJECT_FEATURE_NAME].entities.project1,
              taskIds: ['task1'],
            } as Project,
          },
        },
        [TAG_FEATURE_NAME]: {
          ...baseTestState[TAG_FEATURE_NAME],
          entities: {
            ...baseTestState[TAG_FEATURE_NAME].entities,
            tag1: {
              ...baseTestState[TAG_FEATURE_NAME].entities.tag1,
              taskIds: ['task1'],
            } as Tag,
          },
        },
      };

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('deleteTask action', () => {
    const createDeleteAction = (taskOverrides: Partial<TaskWithSubTasks> = {}) =>
      TaskSharedActions.deleteTask({
        task: {
          ...createMockTask(),
          subTasks: [],
          ...taskOverrides,
        } as TaskWithSubTasks,
      });

    it('should remove task from project taskIds and backlogTaskIds', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'other-task'],
        ['task1', 'backlog-task'],
        ['task1', 'other-task'],
        ['task1', 'today-task'],
      );
      const action = createDeleteAction();

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1', baseState),
          ...expectProjectUpdate('project1', {
            taskIds: ['other-task'],
            backlogTaskIds: ['backlog-task'],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: ['other-task'] },
            TODAY: { taskIds: ['today-task'] },
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should delete task entity and handle subtasks', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'subtask1', 'other-task'],
        [],
        ['task1', 'subtask1', 'other-task'],
        [],
      );
      const action = createDeleteAction({
        id: 'task1',
        subTaskIds: ['subtask1'],
        subTasks: [{ id: 'subtask1', tagIds: ['tag1'] } as Task],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1', baseState),
          ...expectTagUpdate('tag1', { taskIds: ['other-task'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should delete task entity even when not in any project or tag', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = createDeleteAction({ projectId: '', tagIds: [] });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1', baseState),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle task with subtasks removal from tags', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        ['task1', 'subtask1', 'other-task'],
        ['task1', 'subtask1', 'today-task'],
      );
      const action = createDeleteAction({
        projectId: '',
        subTaskIds: ['subtask1'],
        subTasks: [{ id: 'subtask1', tagIds: ['tag1'] } as Task],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          TODAY: { taskIds: ['today-task'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('deleteTasks action', () => {
    it('should remove multiple task IDs from all tags', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        ['task1', 'task2', 'other-task'],
        ['task1', 'task3', 'today-task'],
      );
      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1', 'task2', 'task3'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          TODAY: { taskIds: ['today-task'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove task entities and handle currentTaskId', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2', 'other-task'],
        [],
        ['task1', 'task2', 'other-task'],
        [],
      );
      testState[TASK_FEATURE_NAME].currentTaskId = 'task1';

      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1', 'task2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1', baseState),
          ...expectTaskEntityNotExists('task2', baseState),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            currentTaskId: null, // Should be reset when current task is deleted
            entities: jasmine.objectContaining({
              'other-task': jasmine.anything(),
            }),
            ids: ['other-task'],
          }),
          ...expectTagUpdate('tag1', { taskIds: ['other-task'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should preserve currentTaskId when not in deleted tasks', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2', 'current-task'],
        [],
        ['task1', 'task2', 'current-task'],
        [],
      );
      testState[TASK_FEATURE_NAME].currentTaskId = 'current-task';

      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1', 'task2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            currentTaskId: 'current-task', // Should be preserved
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle tasks with subtasks', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'subtask1', 'other-task'],
        [],
        ['task1', 'other-task'], // subtask1 should not be in tags directly
        [],
      );

      // Setup parent-child relationship
      const task1 = testState[TASK_FEATURE_NAME].entities.task1 as Task;
      const subtask1 = testState[TASK_FEATURE_NAME].entities.subtask1 as Task;
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...task1,
        subTaskIds: ['subtask1'],
      };
      testState[TASK_FEATURE_NAME].entities.subtask1 = {
        ...subtask1,
        parentId: 'task1',
        tagIds: [], // Subtasks typically don't have tags
      };

      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1'], // Only deleting parent, but should include subtasks
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTagUpdate('tag1', { taskIds: ['other-task'] }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            ids: ['other-task'], // Only other-task should remain
            entities: jasmine.objectContaining({
              'other-task': jasmine.anything(),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle empty taskIds array', () => {
      const action = TaskSharedActions.deleteTasks({ taskIds: [] });

      metaReducer(baseState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: [] },
          TODAY: { taskIds: [] },
        }),
        action,
        mockReducer,
        baseState,
      );
    });

    it('should only update tags that contain the deleted tasks', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        ['task1', 'other-task'],
        ['different-task'], // TODAY tag doesn't contain task1
      );

      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdate('tag1', { taskIds: ['other-task'] }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove subtasks from tags when parent is deleted (sync scenario)', () => {
      // Scenario: Parent task deleted, subtask is in Today tag but not in action payload
      const testState = createStateWithExistingTasks(
        ['task1', 'subtask1', 'other-task'],
        [],
        ['task1', 'other-task'],
        ['subtask1', 'today-task'], // Subtask in Today, not in tag1
      );

      // Setup parent-child relationship
      const task1 = testState[TASK_FEATURE_NAME].entities.task1 as Task;
      const subtask1 = testState[TASK_FEATURE_NAME].entities.subtask1 as Task;
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...task1,
        subTaskIds: ['subtask1'],
      };
      testState[TASK_FEATURE_NAME].entities.subtask1 = {
        ...subtask1,
        parentId: 'task1',
        tagIds: [], // Subtask doesn't have tagIds in payload
      };

      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1'],
      });

      metaReducer(testState, action);
      // Subtask should be removed from TODAY tag even though not in payload
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          TODAY: { taskIds: ['today-task'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove subtasks from multiple tags when parent is deleted', () => {
      // Scenario: Subtask is in both tag1 and TODAY, parent deleted
      const testState = createStateWithExistingTasks(
        ['task1', 'subtask1', 'other-task'],
        [],
        ['task1', 'subtask1', 'other-task'], // Subtask in tag1
        ['subtask1', 'today-task'], // Subtask also in TODAY
      );

      const task1 = testState[TASK_FEATURE_NAME].entities.task1 as Task;
      const subtask1 = testState[TASK_FEATURE_NAME].entities.subtask1 as Task;
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...task1,
        subTaskIds: ['subtask1'],
      };
      testState[TASK_FEATURE_NAME].entities.subtask1 = {
        ...subtask1,
        parentId: 'task1',
      };

      const action = TaskSharedActions.deleteTasks({
        taskIds: ['task1'],
      });

      metaReducer(testState, action);
      // Subtask should be removed from both tags
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          TODAY: { taskIds: ['today-task'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });
  });

  describe('updateTask action', () => {
    const createUpdateTaskAction = (taskId: string, changes: Partial<Task>) =>
      TaskSharedActions.updateTask({
        task: { id: taskId, changes },
      });

    it('should update task properties without affecting tags', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        title: 'Updated Title',
        isDone: true,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                title: 'Updated Title',
                isDone: true,
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should add task to new tags and remove from old tags when tagIds are updated', () => {
      const testState = createStateWithExistingTasks(
        ['task1'],
        [],
        ['task1', 'other-task'],
      );

      // Add tag2 to the test state
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
      ];

      const action = createUpdateTaskAction('task1', { tagIds: ['tag2'] });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          tag2: { taskIds: ['task1'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle adding multiple new tags', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);

      // Add additional tags
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
      });
      testState[TAG_FEATURE_NAME].entities.tag3 = createMockTag({
        id: 'tag3',
        title: 'Tag 3',
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
        'tag3',
      ];

      const action = createUpdateTaskAction('task1', {
        tagIds: ['tag1', 'tag2', 'tag3'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['task1'] },
          tag2: { taskIds: ['task1'] },
          tag3: { taskIds: ['task1'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle removing all tags', () => {
      const testState = createStateWithExistingTasks(
        ['task1'],
        [],
        ['task1', 'other-task'],
      );
      const action = createUpdateTaskAction('task1', { tagIds: [] });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle no tag changes when tagIds are the same', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        title: 'Updated Title',
        tagIds: ['tag1'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TAG_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              tag1: jasmine.objectContaining({
                taskIds: ['task1'],
              }),
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                title: 'Updated Title',
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle updating non-existent task gracefully', () => {
      const testState = createStateWithExistingTasks([], [], []);
      const action = createUpdateTaskAction('non-existent', { title: 'Updated' });

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });

    it('should update both task properties and tags in one action', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);

      // Add tag2
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
      ];

      const action = createUpdateTaskAction('task1', {
        title: 'Updated Title',
        isDone: true,
        tagIds: ['tag2'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TAG_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              tag1: jasmine.objectContaining({
                taskIds: [],
              }),
              tag2: jasmine.objectContaining({
                taskIds: ['task1'],
              }),
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                title: 'Updated Title',
                isDone: true,
                tagIds: ['tag2'],
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle timeSpentOnDay updates and recalculate timeSpent', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        timeSpentOnDay: {
          '2023-12-06': 3600000, // 1 hour
          '2023-12-07': 1800000, // 30 minutes
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          timeSpentOnDay: {
            '2023-12-06': 3600000,
            '2023-12-07': 1800000,
          },
          timeSpent: 5400000, // Should be sum: 1.5 hours
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle timeEstimate updates', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        timeEstimate: 7200000, // 2 hours
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', {
          timeEstimate: 7200000,
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle isDone updates and set doneOn timestamp', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        isDone: true,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                isDone: true,
                doneOn: jasmine.any(Number), // Should set timestamp
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should skip tag updates when tagIds are not provided', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        title: 'Updated Title',
        // No tagIds provided
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                title: 'Updated Title',
              }),
            }),
          }),
          // Tags should remain unchanged
          [TAG_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              tag1: jasmine.objectContaining({
                taskIds: ['task1'], // Should remain unchanged
              }),
            }),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle updating task with invalid tag IDs gracefully', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        tagIds: ['tag1', 'non-existent-tag'],
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TAG_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              tag1: jasmine.objectContaining({
                taskIds: ['task1'], // Should still be updated
              }),
              // non-existent-tag should be ignored
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1', 'non-existent-tag'], // Task should still have both tags in its data
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

  describe('edge cases and error handling', () => {
    it('should handle unknown actions gracefully', () => {
      const unknownAction = { type: 'UNKNOWN_ACTION' };

      metaReducer(baseState, unknownAction);

      // Should pass through to reducer without modification
      expect(mockReducer).toHaveBeenCalledWith(baseState, unknownAction);
    });

    it('should handle null or undefined state gracefully', () => {
      const action = { type: 'SOME_ACTION' };

      metaReducer(null, action);
      expect(mockReducer).toHaveBeenCalledWith(null, action);

      metaReducer(undefined, action);
      expect(mockReducer).toHaveBeenCalledWith(undefined, action);
    });

    it('should preserve task entity order when adding tasks', () => {
      const testState = createStateWithExistingTasks(['existing1', 'existing2']);
      const action = TaskSharedActions.addTask({
        task: createMockTask({ id: 'new-task' }),
        workContextId: 'project1',
        workContextType: WorkContextType.PROJECT,
        isAddToBottom: false,
        isAddToBacklog: false,
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            ids: jasmine.arrayContaining(['existing1', 'existing2', 'new-task']),
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle concurrent task operations', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2'],
        [],
        ['task1', 'task2'],
      );

      // Simulate multiple operations that might happen concurrently
      const updateAction = TaskSharedActions.updateTask({
        task: { id: 'task1', changes: { title: 'Updated' } },
      });

      const intermediateState = metaReducer(testState, updateAction);

      const deleteAction = TaskSharedActions.deleteTask({
        task: {
          id: 'task2',
          tagIds: ['tag1'],
          subTasks: [],
        } as any,
      });

      metaReducer(intermediateState, deleteAction);

      // Both operations should be reflected
      expect(mockReducer).toHaveBeenCalledTimes(2);
    });

    it('should handle large numbers of tasks efficiently', () => {
      const manyTaskIds = Array.from({ length: 100 }, (_, i) => `task${i}`);
      const testState = createStateWithExistingTasks([], [], manyTaskIds);

      const action = TaskSharedActions.deleteTasks({
        taskIds: manyTaskIds.slice(0, 50), // Delete half
      });

      // Should complete without performance issues
      const startTime = Date.now();
      metaReducer(testState, action);
      const endTime = Date.now();

      expect(endTime - startTime).toBeLessThan(1000); // Should complete in under 1 second
      expect(mockReducer).toHaveBeenCalled();
    });
  });

  describe('parent/sub-task tag conflict resolution', () => {
    describe('addTask action', () => {
      it('should remove parent from tag when adding sub-task to same tag', () => {
        // Setup: parent task already in tag
        const testState = createStateWithExistingTasks(
          ['parent-task'],
          [],
          ['parent-task'],
        );

        // Create sub-task that will be added to the same tag
        const subTask = createMockTask({
          id: 'sub-task',
          parentId: 'parent-task',
          tagIds: ['tag1'],
        });

        const action = TaskSharedActions.addTask({
          task: subTask,
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          isAddToBottom: false,
          isAddToBacklog: false,
        });

        metaReducer(testState, action);

        // Parent should be removed from tag, and tag removed from parent
        expectStateUpdate(
          {
            ...expectTaskUpdate('parent-task', {
              tagIds: [], // Tag should be removed from parent
            }),
            ...expectTagUpdate('tag1', {
              taskIds: ['sub-task'], // Only sub-task should remain
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });

      it('should remove sub-tasks from tag when adding parent to same tag', () => {
        // Setup: sub-tasks already in tag
        const testState = createStateWithExistingTasks(
          ['sub1', 'sub2', 'other-task'],
          [],
          ['sub1', 'sub2', 'other-task'],
        );

        // Update sub-tasks to have parentId
        testState[TASK_FEATURE_NAME].entities.sub1 = createMockTask({
          id: 'sub1',
          parentId: 'parent-task',
          tagIds: ['tag1'],
        });
        testState[TASK_FEATURE_NAME].entities.sub2 = createMockTask({
          id: 'sub2',
          parentId: 'parent-task',
          tagIds: ['tag1'],
        });

        // Create parent task with sub-tasks
        const parentTask = createMockTask({
          id: 'parent-task',
          subTaskIds: ['sub1', 'sub2'],
          tagIds: ['tag1'],
        });

        const action = TaskSharedActions.addTask({
          task: parentTask,
          workContextId: 'project1',
          workContextType: WorkContextType.PROJECT,
          isAddToBottom: false,
          isAddToBacklog: false,
        });

        metaReducer(testState, action);

        // Sub-tasks should be removed from tag, and tag removed from sub-tasks
        expectStateUpdate(
          {
            ...expectTaskUpdate('sub1', {
              tagIds: [], // Tag should be removed
            }),
            ...expectTaskUpdate('sub2', {
              tagIds: [], // Tag should be removed
            }),
            ...expectTagUpdate('tag1', {
              taskIds: ['parent-task', 'other-task'], // Only parent and other-task
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });
    });

    describe('updateTask action', () => {
      it('should remove parent from tag when adding tag to sub-task', () => {
        // Setup: parent task in tag, sub-task without tag
        const testState = createStateWithExistingTasks(
          ['parent-task', 'sub-task'],
          [],
          ['parent-task'],
        );

        testState[TASK_FEATURE_NAME].entities['sub-task'] = createMockTask({
          id: 'sub-task',
          parentId: 'parent-task',
          tagIds: [],
        });

        const action = TaskSharedActions.updateTask({
          task: {
            id: 'sub-task',
            changes: { tagIds: ['tag1'] },
          },
        });

        metaReducer(testState, action);

        expectStateUpdate(
          {
            ...expectTaskUpdate('parent-task', {
              tagIds: [], // Tag removed from parent
            }),
            ...expectTaskUpdate('sub-task', {
              tagIds: ['tag1'], // Tag added to sub-task
            }),
            ...expectTagUpdate('tag1', {
              taskIds: ['sub-task'], // Only sub-task in tag
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });

      it('should remove sub-tasks from tag when adding tag to parent', () => {
        // Setup: sub-tasks in tag, parent without tag
        const testState = createStateWithExistingTasks(
          ['parent-task', 'sub1', 'sub2'],
          [],
          ['sub1', 'sub2'],
        );

        testState[TASK_FEATURE_NAME].entities['parent-task'] = createMockTask({
          id: 'parent-task',
          subTaskIds: ['sub1', 'sub2'],
          tagIds: [],
        });
        testState[TASK_FEATURE_NAME].entities.sub1 = createMockTask({
          id: 'sub1',
          parentId: 'parent-task',
          tagIds: ['tag1'],
        });
        testState[TASK_FEATURE_NAME].entities.sub2 = createMockTask({
          id: 'sub2',
          parentId: 'parent-task',
          tagIds: ['tag1'],
        });

        const action = TaskSharedActions.updateTask({
          task: {
            id: 'parent-task',
            changes: { tagIds: ['tag1'] },
          },
        });

        metaReducer(testState, action);

        expectStateUpdate(
          {
            ...expectTaskUpdate('parent-task', {
              tagIds: ['tag1'], // Tag added to parent
            }),
            ...expectTaskUpdate('sub1', {
              tagIds: [], // Tag removed from sub-task
            }),
            ...expectTaskUpdate('sub2', {
              tagIds: [], // Tag removed from sub-task
            }),
            ...expectTagUpdate('tag1', {
              taskIds: ['parent-task'], // Only parent in tag
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });
    });

    describe('convertToMainTask action', () => {
      it('should keep parent tags when converting sub-task to main task with same tag', () => {
        // Setup: parent and sub-task exist, parent is in tag
        const testState = createStateWithExistingTasks(
          ['parent-task', 'sub-task'],
          [],
          ['parent-task'],
        );

        testState[TASK_FEATURE_NAME].entities['parent-task'] = createMockTask({
          id: 'parent-task',
          subTaskIds: ['sub-task'],
          tagIds: ['tag1'],
        });
        testState[TASK_FEATURE_NAME].entities['sub-task'] = createMockTask({
          id: 'sub-task',
          parentId: 'parent-task',
          tagIds: [],
        });

        const action = TaskSharedActions.convertToMainTask({
          task: testState[TASK_FEATURE_NAME].entities['sub-task'] as Task,
          parentTagIds: ['tag1'],
          isPlanForToday: false,
        });

        metaReducer(testState, action);

        expectStateUpdate(
          {
            ...expectTaskUpdate('parent-task', {
              tagIds: ['tag1'], // Parent keeps its tag
            }),
            ...expectTaskUpdate('sub-task', {
              parentId: undefined, // No longer a sub-task
              tagIds: ['tag1'], // Inherited parent's tag
            }),
            ...expectTagUpdate('tag1', {
              taskIds: ['sub-task', 'parent-task'], // Both tasks in tag
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });
    });
  });

  describe('restoreDeletedTask action', () => {
    const createRestoreAction = (
      overrides: {
        taskOverrides?: Partial<Task>;
        projectContext?: {
          projectId: string;
          taskIdsForProject: string[];
          taskIdsForProjectBacklog: string[];
        };
        parentContext?: {
          parentTaskId: string;
          subTaskIds: string[];
        };
        tagTaskIdMap?: Record<string, string[]>;
        deletedTaskEntities?: Record<string, Task | undefined>;
      } = {},
    ) => {
      const task = createMockTask(overrides.taskOverrides);
      const taskWithSubTasks = {
        ...task,
        subTasks: [],
      };

      return TaskSharedActions.restoreDeletedTask({
        task: taskWithSubTasks as any,
        projectContext: overrides.projectContext,
        parentContext: overrides.parentContext,
        tagTaskIdMap: overrides.tagTaskIdMap || {},
        deletedTaskEntities: overrides.deletedTaskEntities || { [task.id]: task },
      });
    };

    it('should restore task entity with updated modified timestamp', () => {
      const oldTimestamp = Date.now() - 10000;
      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', modified: oldTimestamp },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            modified: oldTimestamp,
          }),
        },
      });

      const beforeRestore = Date.now();
      metaReducer(baseState, action);

      const updatedState = mockReducer.calls.mostRecent().args[0];
      const restoredTask = updatedState[TASK_FEATURE_NAME].entities['restored-task'];

      expect(restoredTask).toBeDefined();
      expect(restoredTask.modified).toBeGreaterThanOrEqual(beforeRestore);
      expect(restoredTask.modified).not.toEqual(oldTimestamp);
    });

    it('should restore task to project taskIds', () => {
      const testState = createStateWithExistingTasks(['existing-task'], [], [], []);
      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', projectId: 'project1' },
        projectContext: {
          projectId: 'project1',
          taskIdsForProject: ['restored-task', 'existing-task'],
          taskIdsForProjectBacklog: [],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            projectId: 'project1',
          }),
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectProjectUpdate('project1', {
            taskIds: ['restored-task', 'existing-task'],
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should restore task to project backlogTaskIds', () => {
      const testState = createStateWithExistingTasks([], ['existing-backlog'], [], []);
      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', projectId: 'project1' },
        projectContext: {
          projectId: 'project1',
          taskIdsForProject: [],
          taskIdsForProjectBacklog: ['restored-task', 'existing-backlog'],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            projectId: 'project1',
          }),
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectProjectUpdate('project1', {
            backlogTaskIds: ['restored-task', 'existing-backlog'],
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should restore task to tag taskIds', () => {
      const testState = createStateWithExistingTasks([], [], ['existing-task'], []);
      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', tagIds: ['tag1'] },
        tagTaskIdMap: {
          tag1: ['restored-task', 'existing-task'],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            tagIds: ['tag1'],
          }),
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectTagUpdate('tag1', {
            taskIds: ['restored-task', 'existing-task'],
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should restore task to TODAY tag', () => {
      const testState = createStateWithExistingTasks([], [], [], ['existing-today']);
      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task' },
        tagTaskIdMap: {
          TODAY: ['restored-task', 'existing-today'],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({ id: 'restored-task' }),
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectTagUpdate('TODAY', {
            taskIds: ['restored-task', 'existing-today'],
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should restore subtask and parent relationship', () => {
      const testState = createStateWithExistingTasks(['parent-task'], [], [], []);
      testState[TASK_FEATURE_NAME].entities['parent-task'] = createMockTask({
        id: 'parent-task',
        subTaskIds: [], // Subtask was removed
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'sub-task', parentId: 'parent-task' },
        parentContext: {
          parentTaskId: 'parent-task',
          subTaskIds: ['sub-task'], // Restore the relationship
        },
        deletedTaskEntities: {
          'sub-task': createMockTask({
            id: 'sub-task',
            parentId: 'parent-task',
          }),
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('sub-task'),
          ...expectTaskUpdate('parent-task', {
            subTaskIds: ['sub-task'],
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should restore task with subtasks', () => {
      const subTask1 = createMockTask({ id: 'sub1', parentId: 'parent-task' });
      const subTask2 = createMockTask({ id: 'sub2', parentId: 'parent-task' });
      const parentTask = createMockTask({
        id: 'parent-task',
        subTaskIds: ['sub1', 'sub2'],
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'parent-task', subTaskIds: ['sub1', 'sub2'] },
        deletedTaskEntities: {
          'parent-task': parentTask,
          sub1: subTask1,
          sub2: subTask2,
        },
        tagTaskIdMap: {
          tag1: ['parent-task'],
        },
      });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('parent-task'),
          ...expectTaskEntityExists('sub1'),
          ...expectTaskEntityExists('sub2'),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should skip project restoration if project no longer exists', () => {
      // Project does not exist in state
      const testState = {
        ...baseState,
        [PROJECT_FEATURE_NAME]: {
          ...baseState[PROJECT_FEATURE_NAME],
          entities: {}, // No projects
          ids: [],
        },
      };

      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', projectId: 'deleted-project' },
        projectContext: {
          projectId: 'deleted-project',
          taskIdsForProject: ['restored-task'],
          taskIdsForProjectBacklog: [],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            projectId: 'deleted-project',
          }),
        },
      });

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();

      // Task should still be restored
      const updatedState = mockReducer.calls.mostRecent().args[0];
      expect(updatedState[TASK_FEATURE_NAME].entities['restored-task']).toBeDefined();
    });

    it('should skip tag restoration if tag no longer exists', () => {
      const testState = {
        ...baseState,
        [TAG_FEATURE_NAME]: {
          ...baseState[TAG_FEATURE_NAME],
          entities: {
            TODAY: baseState[TAG_FEATURE_NAME].entities.TODAY,
            // tag1 does not exist
          },
          ids: ['TODAY'],
        },
      };

      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', tagIds: ['deleted-tag'] },
        tagTaskIdMap: {
          'deleted-tag': ['restored-task'], // Tag no longer exists
          TODAY: ['restored-task'],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            tagIds: ['deleted-tag'],
          }),
        },
      });

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();

      // Task should still be restored, only TODAY should be updated
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectTagUpdate('TODAY', { taskIds: ['restored-task'] }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should skip parent restoration if parent no longer exists', () => {
      // Parent task does not exist
      const action = createRestoreAction({
        taskOverrides: { id: 'sub-task', parentId: 'deleted-parent' },
        parentContext: {
          parentTaskId: 'deleted-parent',
          subTaskIds: ['sub-task'],
        },
        deletedTaskEntities: {
          'sub-task': createMockTask({
            id: 'sub-task',
            parentId: 'deleted-parent',
          }),
        },
      });

      // Should not throw
      expect(() => metaReducer(baseState, action)).not.toThrow();

      // Subtask should still be restored
      const updatedState = mockReducer.calls.mostRecent().args[0];
      expect(updatedState[TASK_FEATURE_NAME].entities['sub-task']).toBeDefined();
    });

    it('should handle restore without project context', () => {
      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', projectId: '' },
        // No projectContext provided
        tagTaskIdMap: { tag1: ['restored-task'] },
        deletedTaskEntities: {
          'restored-task': createMockTask({ id: 'restored-task', projectId: '' }),
        },
      });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectTagUpdate('tag1', { taskIds: ['restored-task'] }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should handle restore without parent context', () => {
      const action = createRestoreAction({
        taskOverrides: { id: 'main-task' },
        // No parentContext provided - this is a main task
        tagTaskIdMap: { tag1: ['main-task'] },
        deletedTaskEntities: {
          'main-task': createMockTask({ id: 'main-task' }),
        },
      });

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('main-task'),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should handle empty deletedTaskEntities gracefully', () => {
      const action = TaskSharedActions.restoreDeletedTask({
        task: { ...createMockTask(), subTasks: [] } as any,
        tagTaskIdMap: {},
        deletedTaskEntities: {},
      });

      // Should not throw
      expect(() => metaReducer(baseState, action)).not.toThrow();
    });

    it('should restore multiple tags simultaneously', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag2');

      const action = createRestoreAction({
        taskOverrides: { id: 'restored-task', tagIds: ['tag1', 'tag2'] },
        tagTaskIdMap: {
          tag1: ['restored-task'],
          tag2: ['restored-task'],
          TODAY: ['restored-task'],
        },
        deletedTaskEntities: {
          'restored-task': createMockTask({
            id: 'restored-task',
            tagIds: ['tag1', 'tag2'],
          }),
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectTagUpdates({
            tag1: { taskIds: ['restored-task'] },
            tag2: { taskIds: ['restored-task'] },
            TODAY: { taskIds: ['restored-task'] },
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    it('should handle full restore scenario with all associations', () => {
      const testState = createStateWithExistingTasks(
        ['existing-task'],
        ['existing-backlog'],
        ['existing-tag'],
        ['existing-today'],
      );

      const subTask = createMockTask({ id: 'sub1', parentId: 'restored-task' });
      const mainTask = createMockTask({
        id: 'restored-task',
        projectId: 'project1',
        tagIds: ['tag1'],
        subTaskIds: ['sub1'],
      });

      const action = TaskSharedActions.restoreDeletedTask({
        task: { ...mainTask, subTasks: [subTask] } as any,
        projectContext: {
          projectId: 'project1',
          taskIdsForProject: ['restored-task', 'existing-task'],
          taskIdsForProjectBacklog: ['existing-backlog'],
        },
        tagTaskIdMap: {
          tag1: ['restored-task', 'existing-tag'],
          TODAY: ['restored-task', 'existing-today'],
        },
        deletedTaskEntities: {
          'restored-task': mainTask,
          sub1: subTask,
        },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTaskEntityExists('restored-task'),
          ...expectTaskEntityExists('sub1'),
          ...expectProjectUpdate('project1', {
            taskIds: ['restored-task', 'existing-task'],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: ['restored-task', 'existing-tag'] },
            TODAY: { taskIds: ['restored-task', 'existing-today'] },
          }),
        },
        action,
        mockReducer,
        testState,
      );
    });

    // ==========================================================================
    // MERGE BEHAVIOR TESTS - verify tasks added after delete are preserved
    // ==========================================================================

    it('should preserve new tasks in tag when restoring (MERGE not REPLACE)', () => {
      // Scenario: delete task1, then create task3, then undo delete task1
      // Expected: tag should have [task1, task3] (task3 is preserved)
      const testState = createStateWithExistingTasks([], [], [], []);

      // Current state has task3 (created after task1 was deleted)
      testState[TAG_FEATURE_NAME].entities.tag1 = createMockTag({
        id: 'tag1',
        taskIds: ['task3'], // New task added after delete
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', tagIds: ['tag1'] },
        tagTaskIdMap: {
          // Captured at delete time: ['task1', 'task2']
          tag1: ['task1', 'task2'],
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', tagIds: ['tag1'] }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // task1 should be restored at position 0, task3 should still be there
      expect(updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds).toContain('task1');
      expect(updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds).toContain('task3');
    });

    it('should preserve new tasks in project when restoring (MERGE not REPLACE)', () => {
      // Scenario: delete task1, then create task3, then undo delete task1
      const testState = createStateWithExistingTasks(['task3'], [], [], []);

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', projectId: 'project1' },
        projectContext: {
          projectId: 'project1',
          // Captured at delete time
          taskIdsForProject: ['task1', 'task2'],
          taskIdsForProjectBacklog: [],
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', projectId: 'project1' }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // Both task1 and task3 should be present
      expect(updatedState[PROJECT_FEATURE_NAME].entities.project1.taskIds).toContain(
        'task1',
      );
      expect(updatedState[PROJECT_FEATURE_NAME].entities.project1.taskIds).toContain(
        'task3',
      );
    });

    it('should preserve new subtasks when restoring parent relationship (MERGE)', () => {
      // Scenario: delete sub1, add sub3 to parent, undo delete sub1
      const testState = createStateWithExistingTasks(['parent-task'], [], [], []);
      testState[TASK_FEATURE_NAME].entities['parent-task'] = createMockTask({
        id: 'parent-task',
        subTaskIds: ['sub3'], // New subtask added after delete
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'sub1', parentId: 'parent-task' },
        parentContext: {
          parentTaskId: 'parent-task',
          // Captured at delete time
          subTaskIds: ['sub1', 'sub2'],
        },
        deletedTaskEntities: {
          sub1: createMockTask({ id: 'sub1', parentId: 'parent-task' }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // Both sub1 and sub3 should be present
      const parentSubTaskIds =
        updatedState[TASK_FEATURE_NAME].entities['parent-task'].subTaskIds;
      expect(parentSubTaskIds).toContain('sub1');
      expect(parentSubTaskIds).toContain('sub3');
    });

    it('should restore task at original position in tag', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag1 = createMockTag({
        id: 'tag1',
        taskIds: ['task2', 'task3'], // Remaining tasks after delete
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', tagIds: ['tag1'] },
        tagTaskIdMap: {
          // Captured: task1 was at position 0
          tag1: ['task1', 'task2', 'task3'],
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', tagIds: ['tag1'] }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // task1 should be restored at position 0
      const taskIds = updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds;
      expect(taskIds[0]).toBe('task1');
    });

    it('should not duplicate task if already present (idempotent restore)', () => {
      // Scenario: restore action replayed during sync
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag1 = createMockTag({
        id: 'tag1',
        taskIds: ['task1', 'task2'], // task1 already restored
      });
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1'],
      });
      (testState[TASK_FEATURE_NAME].ids as string[]).push('task1');

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', tagIds: ['tag1'] },
        tagTaskIdMap: {
          tag1: ['task1', 'task2'],
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', tagIds: ['tag1'] }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // task1 should appear exactly once
      const taskIds = updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds;
      const task1Count = taskIds.filter((id: string) => id === 'task1').length;
      expect(task1Count).toBe(1);
    });

    it('should correctly restore multiple adjacent tasks to their original positions', () => {
      // Scenario: delete task1 and task2 (adjacent), then restore both
      // This tests that mergeTaskIdsAtPositions handles multiple inserts correctly
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag1 = createMockTag({
        id: 'tag1',
        taskIds: ['task3'], // Only task3 remains after deleting task1 and task2
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', tagIds: ['tag1'] },
        tagTaskIdMap: {
          // Captured at delete time: task1 at 0, task2 at 1, task3 at 2
          tag1: ['task1', 'task2', 'task3'],
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', tagIds: ['tag1'] }),
          task2: createMockTask({ id: 'task2', tagIds: ['tag1'] }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      const taskIds = updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds;
      // All three tasks should be present
      expect(taskIds).toContain('task1');
      expect(taskIds).toContain('task2');
      expect(taskIds).toContain('task3');
      // task1 should be before task2 (original relative order preserved)
      expect(taskIds.indexOf('task1')).toBeLessThan(taskIds.indexOf('task2'));
    });

    it('should use current project state when restoring task to project', () => {
      // This test verifies that we read from the current state, not stale state
      const testState = createStateWithExistingTasks(['newTask'], [], [], []);

      const action = createRestoreAction({
        taskOverrides: { id: 'restoredTask', projectId: 'project1' },
        projectContext: {
          projectId: 'project1',
          // Captured at delete time (before newTask existed)
          taskIdsForProject: ['restoredTask', 'oldTask'],
          taskIdsForProjectBacklog: [],
        },
        deletedTaskEntities: {
          restoredTask: createMockTask({ id: 'restoredTask', projectId: 'project1' }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      const projectTaskIds = updatedState[PROJECT_FEATURE_NAME].entities.project1.taskIds;
      // Both restoredTask and newTask should be present (merge, not replace)
      expect(projectTaskIds).toContain('restoredTask');
      expect(projectTaskIds).toContain('newTask');
    });

    // ==========================================================================
    // DATA PRESERVATION TESTS - ensure all task data is preserved
    // ==========================================================================

    it('should preserve timeSpentOnDay data when restoring', () => {
      const timeSpentOnDay = {
        '2024-01-15': 3600000,
        '2024-01-16': 1800000,
      };
      const task = createMockTask({
        id: 'task-with-time',
        timeSpentOnDay,
        timeSpent: 5400000,
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task-with-time' },
        deletedTaskEntities: { 'task-with-time': task },
      });

      metaReducer(baseState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const restoredTask = updatedState[TASK_FEATURE_NAME].entities['task-with-time'];

      expect(restoredTask.timeSpentOnDay).toEqual(timeSpentOnDay);
      expect(restoredTask.timeSpent).toBe(5400000);
    });

    it('should preserve task attachments when restoring', () => {
      const attachments = [
        {
          id: 'att1',
          path: '/path/to/file.pdf',
          originalFileName: 'file.pdf',
          type: 'FILE',
        },
      ];
      const task = createMockTask({
        id: 'task-with-attachments',
        attachments: attachments as any,
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task-with-attachments' },
        deletedTaskEntities: { 'task-with-attachments': task },
      });

      metaReducer(baseState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const restoredTask =
        updatedState[TASK_FEATURE_NAME].entities['task-with-attachments'];

      expect(restoredTask.attachments).toEqual(attachments);
    });

    it('should preserve notes and other task properties when restoring', () => {
      const task = createMockTask({
        id: 'task-with-notes',
        notes: 'Important notes here',
        issueId: 'JIRA-123',
        issueType: 'JIRA',
        reminderId: 'reminder-1',
        dueWithTime: 1700000000000,
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task-with-notes' },
        deletedTaskEntities: { 'task-with-notes': task },
      });

      metaReducer(baseState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const restoredTask = updatedState[TASK_FEATURE_NAME].entities['task-with-notes'];

      expect(restoredTask.notes).toBe('Important notes here');
      expect(restoredTask.issueId).toBe('JIRA-123');
      expect(restoredTask.issueType).toBe('JIRA');
      expect(restoredTask.reminderId).toBe('reminder-1');
      expect(restoredTask.dueWithTime).toBe(1700000000000);
    });

    it('should not duplicate task in project if already present (idempotent)', () => {
      // Scenario: restore action replayed during sync - project already has task
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], [], []);

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', projectId: 'project1' },
        projectContext: {
          projectId: 'project1',
          taskIdsForProject: ['task1', 'task2'],
          taskIdsForProjectBacklog: [],
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', projectId: 'project1' }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // task1 should appear exactly once in project taskIds
      const projectTaskIds = updatedState[PROJECT_FEATURE_NAME].entities.project1.taskIds;
      const task1Count = projectTaskIds.filter((id: string) => id === 'task1').length;
      expect(task1Count).toBe(1);
    });

    it('should restore task with subtasks where subtasks have their own tags', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'SubTask Tag',
        taskIds: [],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]).push('tag2');

      const subTask = createMockTask({
        id: 'sub1',
        parentId: 'parent-task',
        tagIds: ['tag2'], // Subtask has different tag
      });
      const parentTask = createMockTask({
        id: 'parent-task',
        subTaskIds: ['sub1'],
        tagIds: ['tag1'], // Parent has tag1
      });

      const action = TaskSharedActions.restoreDeletedTask({
        task: { ...parentTask, subTasks: [subTask] } as any,
        tagTaskIdMap: {
          tag1: ['parent-task'], // Parent in tag1
          tag2: ['sub1'], // Subtask in tag2
        },
        deletedTaskEntities: {
          'parent-task': parentTask,
          sub1: subTask,
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      // Parent should be in tag1
      expect(updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds).toContain(
        'parent-task',
      );
      // Subtask should be in tag2
      expect(updatedState[TAG_FEATURE_NAME].entities.tag2.taskIds).toContain('sub1');
      // Subtask should NOT be in tag1
      expect(updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds).not.toContain('sub1');
    });

    it('should handle restore of task from middle position in list', () => {
      // Task was at position 1 (middle), should be restored there
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag1 = createMockTag({
        id: 'tag1',
        taskIds: ['task0', 'task2'], // task1 was between these
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task1', tagIds: ['tag1'] },
        tagTaskIdMap: {
          tag1: ['task0', 'task1', 'task2'], // Original order
        },
        deletedTaskEntities: {
          task1: createMockTask({ id: 'task1', tagIds: ['tag1'] }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      const taskIds = updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds;
      // task1 should be at index 1
      expect(taskIds.indexOf('task1')).toBe(1);
      expect(taskIds).toEqual(['task0', 'task1', 'task2']);
    });

    it('should handle restore when captured position exceeds current array length', () => {
      // Task was at position 5, but current array only has 2 items
      const testState = createStateWithExistingTasks([], [], [], []);
      testState[TAG_FEATURE_NAME].entities.tag1 = createMockTag({
        id: 'tag1',
        taskIds: ['taskA', 'taskB'], // Only 2 tasks now
      });

      const action = createRestoreAction({
        taskOverrides: { id: 'task-at-end', tagIds: ['tag1'] },
        tagTaskIdMap: {
          // Original had 6 tasks, restored task was at position 5
          tag1: ['t0', 't1', 't2', 't3', 't4', 'task-at-end'],
        },
        deletedTaskEntities: {
          'task-at-end': createMockTask({ id: 'task-at-end', tagIds: ['tag1'] }),
        },
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      const taskIds = updatedState[TAG_FEATURE_NAME].entities.tag1.taskIds;
      // Should be clamped to end of current array
      expect(taskIds).toContain('task-at-end');
      expect(taskIds.length).toBe(3);
    });
  });

  describe('other actions', () => {
    it('should pass through other actions to the reducer', () => {
      const action = { type: 'SOME_OTHER_ACTION' };
      metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });
});
