/* eslint-disable @typescript-eslint/explicit-function-return-type,@typescript-eslint/naming-convention */
import { createCombinedTaskSharedMetaReducer } from './task-shared-meta-reducers/test-helpers';
import { TaskSharedActions } from './task-shared.actions';
import { RootState } from '../root-state';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { Tag } from '../../features/tag/tag.model';
import { Project } from '../../features/project/project.model';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { Action, ActionReducer } from '@ngrx/store';
import { getDbDateStr } from '../../util/get-db-date-str';
import { DEFAULT_PROJECT } from '../../features/project/project.const';
import { DEFAULT_TAG } from '../../features/tag/tag.const';
import { PlannerActions } from '../../features/planner/store/planner.actions';
import {
  plannerFeatureKey,
  plannerInitialState,
} from '../../features/planner/store/planner.reducer';
import { appStateFeatureKey } from '../app-state/app-state.reducer';

describe('taskSharedMetaReducer', () => {
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

  const createMockProject = (overrides: Partial<Project> = {}): Project => ({
    ...DEFAULT_PROJECT,
    id: 'project1',
    title: 'Test Project',
    isEnableBacklog: true,
    ...overrides,
  });

  const createMockTag = (overrides: Partial<Tag> = {}): Tag => ({
    ...DEFAULT_TAG,
    id: 'tag1',
    title: 'Test Tag',
    ...overrides,
  });

  const createStateWithExistingTasks = (
    projectTaskIds: string[] = [],
    projectBacklogIds: string[] = [],
    tagTaskIds: string[] = [],
    todayTaskIds: string[] = [],
  ): RootState => {
    // Collect all unique task IDs
    const allTaskIds = [
      ...new Set([
        ...projectTaskIds,
        ...projectBacklogIds,
        ...tagTaskIds,
        ...todayTaskIds,
      ]),
    ];

    // Create task entities
    const taskEntities: Record<string, Task> = {};
    const taskIds: string[] = [];

    allTaskIds.forEach((taskId) => {
      taskEntities[taskId] = createMockTask({
        id: taskId,
        tagIds: tagTaskIds.includes(taskId) ? ['tag1'] : [],
        projectId:
          projectTaskIds.includes(taskId) || projectBacklogIds.includes(taskId)
            ? 'project1'
            : undefined,
      });
      taskIds.push(taskId);
    });

    return {
      ...baseState,
      [TASK_FEATURE_NAME]: {
        ...baseState[TASK_FEATURE_NAME],
        ids: taskIds,
        entities: taskEntities,
      },
      [PROJECT_FEATURE_NAME]: {
        ...baseState[PROJECT_FEATURE_NAME],
        entities: {
          ...baseState[PROJECT_FEATURE_NAME].entities,
          project1: {
            ...baseState[PROJECT_FEATURE_NAME].entities.project1,
            taskIds: projectTaskIds,
            backlogTaskIds: projectBacklogIds,
          } as Project,
        },
      },
      [TAG_FEATURE_NAME]: {
        ...baseState[TAG_FEATURE_NAME],
        entities: {
          ...baseState[TAG_FEATURE_NAME].entities,
          tag1: {
            ...baseState[TAG_FEATURE_NAME].entities.tag1,
            taskIds: tagTaskIds,
          } as Tag,
          TODAY: {
            ...baseState[TAG_FEATURE_NAME].entities.TODAY,
            taskIds: todayTaskIds,
          } as Tag,
        },
      },
    };
  };

  const expectStateUpdate = (
    expectedState: any,
    action: Action,
    testState: RootState = baseState,
  ) => {
    metaReducer(testState, action);
    expect(mockReducer).toHaveBeenCalledWith(
      jasmine.objectContaining(expectedState),
      action,
    );
  };

  const expectProjectUpdate = (projectId: string, changes: Partial<Project>) => ({
    [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
      entities: jasmine.objectContaining({
        [projectId]: jasmine.objectContaining(changes),
      }),
    }),
  });

  const expectTagUpdate = (tagId: string, changes: Partial<Tag>) => ({
    [TAG_FEATURE_NAME]: jasmine.objectContaining({
      entities: jasmine.objectContaining({
        [tagId]: jasmine.objectContaining(changes),
      }),
    }),
  });

  const expectTagUpdates = (updates: Record<string, Partial<Tag>>) => ({
    [TAG_FEATURE_NAME]: jasmine.objectContaining({
      entities: jasmine.objectContaining(
        Object.fromEntries(
          Object.entries(updates).map(([tagId, changes]) => [
            tagId,
            jasmine.objectContaining(changes),
          ]),
        ),
      ),
    }),
  });

  const expectTaskUpdate = (taskId: string, changes: Partial<Task>) => ({
    [TASK_FEATURE_NAME]: jasmine.objectContaining({
      entities: jasmine.objectContaining({
        [taskId]: jasmine.objectContaining(changes),
      }),
    }),
  });

  const expectTaskEntityExists = (taskId: string) => ({
    [TASK_FEATURE_NAME]: jasmine.objectContaining({
      entities: jasmine.objectContaining({
        [taskId]: jasmine.anything(),
      }),
      ids: jasmine.arrayContaining([taskId]),
    }),
  });

  const expectTaskEntityNotExists = (taskId: string) => ({
    [TASK_FEATURE_NAME]: jasmine.objectContaining({
      entities: jasmine.objectContaining(
        Object.fromEntries(
          Object.keys(baseState[TASK_FEATURE_NAME].entities)
            .filter((id) => id !== taskId)
            .map((id) => [id, jasmine.anything()]),
        ),
      ),
    }),
  });

  // =============================================================================
  // SETUP
  // =============================================================================

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = createCombinedTaskSharedMetaReducer(mockReducer);

    const mockProject = createMockProject();
    const mockTag = createMockTag();

    baseState = {
      [TASK_FEATURE_NAME]: {
        ids: [],
        entities: {},
        currentTaskId: null,
        selectedTaskId: null,
        taskDetailTargetPanel: null,
        lastCurrentTaskId: null,
        isDataLoaded: false,
      },
      [TAG_FEATURE_NAME]: {
        ids: ['tag1', 'TODAY'],
        entities: {
          tag1: mockTag,
          TODAY: {
            ...mockTag,
            id: 'TODAY',
            title: 'Today',
            taskIds: [],
          },
        },
      },
      [PROJECT_FEATURE_NAME]: {
        ids: ['project1'],
        entities: { project1: mockProject },
      },
      [plannerFeatureKey]: plannerInitialState,
      [appStateFeatureKey]: { todayStr: getDbDateStr(), startOfNextDayDiffMs: 0 },
    } as any as RootState;
  });

  // =============================================================================
  // TESTS
  // =============================================================================

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

      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
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
      );
    });

    it('should create task entity with default values when minimal data provided', () => {
      const action = createAddTaskAction({ id: 'task1', title: 'Minimal Task' });

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
      );
    });

    it('should add task to project backlogTaskIds when adding to backlog', () => {
      const action = createAddTaskAction({}, { isAddToBacklog: true });

      expectStateUpdate(
        expectProjectUpdate('project1', { backlogTaskIds: ['task1'] }),
        action,
      );
    });

    it('should add task to Today tag when due today', () => {
      const action = createAddTaskAction({ dueDay: getDbDateStr() });

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['task1'] },
          TODAY: { taskIds: ['task1'] },
        }),
        action,
      );
    });

    it('should add task to bottom when isAddToBottom is true', () => {
      const testState = createStateWithExistingTasks(
        ['existing-task'],
        [],
        ['existing-task'],
      );
      const action = createAddTaskAction({}, { isAddToBottom: true });

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['existing-task', 'task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['existing-task', 'task1'] }),
        },
        action,
        testState,
      );
    });

    it('should skip project update when task has no projectId', () => {
      const action = createAddTaskAction({ projectId: '' });

      expectStateUpdate(expectTagUpdate('tag1', { taskIds: ['task1'] }), action);
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

      expectStateUpdate(
        // Should add to taskIds instead of backlogTaskIds when backlog is disabled
        expectProjectUpdate('project1', { taskIds: ['task1'] }),
        action,
        testState,
      );
    });

    it('should handle non-existent project gracefully', () => {
      const action = createAddTaskAction({ projectId: 'non-existent-project' });

      expectStateUpdate(
        {
          ...expectTaskEntityExists('task1'),
          // Project should not be updated since it doesn't exist
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining(baseState[PROJECT_FEATURE_NAME].entities),
          }),
        },
        action,
      );
    });

    it('should handle non-existent tags gracefully', () => {
      const action = createAddTaskAction({ tagIds: ['non-existent-tag'] });

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

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
        testState,
      );
    });

    it('should add task to Today tag when isPlanForToday is true', () => {
      const { action, testState } = createConvertAction({}, { isPlanForToday: true });

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['task1'] },
          TODAY: { taskIds: ['task1'] },
        }),
        action,
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

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1', 'existing-task'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1', 'existing-task'] }),
        },
        action,
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

      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1'),
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

      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1'),
          ...expectTagUpdate('tag1', { taskIds: ['other-task'] }),
        },
        action,
        testState,
      );
    });

    it('should delete task entity even when not in any project or tag', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const action = createDeleteAction({ projectId: '', tagIds: [] });

      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1'),
        },
        action,
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

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          TODAY: { taskIds: ['today-task'] },
        }),
        action,
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

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          TODAY: { taskIds: ['today-task'] },
        }),
        action,
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

      expectStateUpdate(
        {
          ...expectTaskEntityNotExists('task1'),
          ...expectTaskEntityNotExists('task2'),
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

      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            currentTaskId: 'current-task', // Should be preserved
          }),
        },
        action,
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
        testState,
      );
    });

    it('should handle empty taskIds array', () => {
      const action = TaskSharedActions.deleteTasks({ taskIds: [] });

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: [] },
          TODAY: { taskIds: [] },
        }),
        action,
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

      expectStateUpdate(
        expectTagUpdate('tag1', { taskIds: ['other-task'] }),
        action,
        testState,
      );
    });
  });

  describe('moveToArchive action', () => {
    // Helper to create TaskWithSubTasks from mock task
    const createTaskWithSubTasks = (
      taskOverrides: Partial<Task>,
      subTasks: Task[] = [],
    ): TaskWithSubTasks => ({
      ...createMockTask(taskOverrides),
      subTasks,
    });

    // Helper to create archive action with tasks
    const createArchiveAction = (tasks: TaskWithSubTasks[]) =>
      TaskSharedActions.moveToArchive({ tasks });

    it('should remove tasks from project taskIds and backlogTaskIds', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2', 'keep-task'],
        ['task1', 'backlog-task'],
        ['task1', 'subtask1', 'keep-task'],
        ['task1', 'subtask1', 'today-task'],
      );

      const subtask1 = createMockTask({
        id: 'subtask1',
        projectId: 'project1',
        tagIds: ['tag1'],
        parentId: 'task1',
      });

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks(
          {
            id: 'task1',
            projectId: 'project1',
            tagIds: ['tag1'],
            subTaskIds: ['subtask1'],
          },
          [subtask1],
        ),
        createTaskWithSubTasks({
          id: 'task2',
          projectId: 'project1',
          tagIds: [],
        }),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', {
            taskIds: ['keep-task'],
            backlogTaskIds: ['backlog-task'],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: ['keep-task'] },
            TODAY: { taskIds: ['today-task'] },
          }),
        },
        action,
        testState,
      );
    });

    it('should handle empty tasks array', () => {
      const action = createArchiveAction([]);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', {
            taskIds: [],
            backlogTaskIds: [],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: [] },
            TODAY: { taskIds: [] },
          }),
        },
        action,
      );
    });

    it('should remove tasks and subtasks from all associated tags', () => {
      const testState = createStateWithExistingTasks(
        ['parent-task', 'subtask1', 'subtask2', 'keep-task'],
        [],
        ['parent-task', 'subtask1', 'subtask2', 'keep-task'],
        ['parent-task', 'subtask1', 'keep-task'],
      );

      // Add another tag
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: ['subtask2', 'keep-task'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
      ];

      // Update task entities to match expected state (handleMoveToArchive reads from state)
      testState[TASK_FEATURE_NAME].entities['parent-task'] = {
        ...testState[TASK_FEATURE_NAME].entities['parent-task'],
        subTaskIds: ['subtask1', 'subtask2'],
      } as Task;
      testState[TASK_FEATURE_NAME].entities.subtask2 = {
        ...testState[TASK_FEATURE_NAME].entities.subtask2,
        tagIds: ['tag1', 'tag2'],
        parentId: 'parent-task',
      } as Task;
      testState[TASK_FEATURE_NAME].entities.subtask1 = {
        ...testState[TASK_FEATURE_NAME].entities.subtask1,
        parentId: 'parent-task',
      } as Task;

      const subtask1 = createMockTask({
        id: 'subtask1',
        projectId: 'project1',
        tagIds: ['tag1'],
        parentId: 'parent-task',
      });
      const subtask2 = createMockTask({
        id: 'subtask2',
        projectId: 'project1',
        tagIds: ['tag1', 'tag2'],
        parentId: 'parent-task',
      });

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks(
          {
            id: 'parent-task',
            projectId: 'project1',
            tagIds: ['tag1'],
            subTaskIds: ['subtask1', 'subtask2'],
          },
          [subtask1, subtask2],
        ),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', {
            taskIds: ['keep-task'],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: ['keep-task'] },
            tag2: { taskIds: ['keep-task'] },
            TODAY: { taskIds: ['keep-task'] },
          }),
        },
        action,
        testState,
      );
    });

    it('should handle tasks without projectId', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        ['task1', 'task2'],
        ['task1'],
      );

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks({
          id: 'task1',
          projectId: undefined,
          tagIds: ['tag1'],
        }),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectTagUpdates({
            tag1: { taskIds: ['task2'] },
            TODAY: { taskIds: [] },
          }),
        },
        action,
        testState,
      );
    });

    it('should handle mixed tasks with and without projects', () => {
      const testState = createStateWithExistingTasks(
        ['project-task'],
        [],
        ['project-task', 'orphan-task'],
        ['project-task', 'orphan-task'],
      );

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks({
          id: 'project-task',
          projectId: 'project1',
          tagIds: ['tag1'],
        }),
        createTaskWithSubTasks({
          id: 'orphan-task',
          projectId: undefined,
          tagIds: ['tag1'],
        }),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', {
            taskIds: [],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: [] },
            TODAY: { taskIds: [] },
          }),
        },
        action,
        testState,
      );
    });

    it('should always update TODAY tag even if no tasks are in it', () => {
      const testState = createStateWithExistingTasks(
        ['task1'],
        [],
        ['task1'],
        [], // No tasks in TODAY
      );

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks({
          id: 'task1',
          projectId: 'project1',
          tagIds: ['tag1'],
        }),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectTagUpdates({
            tag1: { taskIds: [] },
            TODAY: { taskIds: [] }, // Should still be updated
          }),
        },
        action,
        testState,
      );
    });

    it('should handle archiving tasks from multiple projects', () => {
      const testState = createStateWithExistingTasks(
        ['task1'],
        [],
        ['task1', 'task2'],
        [],
      );

      // Add second project
      testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
        id: 'project2',
        title: 'Project 2',
        taskIds: ['task2'],
      });
      (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
        ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
        'project2',
      ];

      // Update task2 entity to have correct projectId (createStateWithExistingTasks
      // only sets projectId for tasks in project1's taskIds/backlogTaskIds)
      testState[TASK_FEATURE_NAME].entities.task2 = {
        ...testState[TASK_FEATURE_NAME].entities.task2,
        projectId: 'project2',
      } as Task;

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks({
          id: 'task1',
          projectId: 'project1',
          tagIds: ['tag1'],
        }),
        createTaskWithSubTasks({
          id: 'task2',
          projectId: 'project2',
          tagIds: ['tag1'],
        }),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', {
            taskIds: [],
          }),
          ...expectProjectUpdate('project2', {
            taskIds: [],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: [] },
          }),
        },
        action,
        testState,
      );
    });

    it('should handle tasks with deeply nested subtasks', () => {
      const testState = createStateWithExistingTasks(
        ['parent', 'sub1', 'sub2', 'sub3'],
        [],
        ['parent', 'sub1', 'sub2', 'sub3'],
        [],
      );

      const sub1 = createMockTask({
        id: 'sub1',
        projectId: 'project1',
        tagIds: ['tag1'],
        parentId: 'parent',
      });
      const sub2 = createMockTask({
        id: 'sub2',
        projectId: 'project1',
        tagIds: ['tag1'],
        parentId: 'parent',
      });
      const sub3 = createMockTask({
        id: 'sub3',
        projectId: 'project1',
        tagIds: ['tag1'],
        parentId: 'parent',
      });

      const tasksToArchive: TaskWithSubTasks[] = [
        createTaskWithSubTasks(
          {
            id: 'parent',
            projectId: 'project1',
            tagIds: ['tag1'],
            subTaskIds: ['sub1', 'sub2', 'sub3'],
          },
          [sub1, sub2, sub3],
        ),
      ];

      const action = createArchiveAction(tasksToArchive);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', {
            taskIds: [],
          }),
          ...expectTagUpdates({
            tag1: { taskIds: [] },
          }),
        },
        action,
        testState,
      );
    });
  });

  describe('restoreTask action', () => {
    const createRestoreAction = (
      taskOverrides: Partial<Task> = {},
      subTasks: Task[] = [],
    ) =>
      TaskSharedActions.restoreTask({
        task: createMockTask(taskOverrides),
        subTasks,
      });

    it('should add task to project taskIds', () => {
      const action = createRestoreAction();

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
      );
    });

    it('should handle task with subtasks', () => {
      const subTasks = [createMockTask({ id: 'subtask1' })];
      const action = createRestoreAction({ subTaskIds: ['subtask1'] }, subTasks);

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1', 'subtask1'] }),
        },
        action,
      );
    });

    it('should add tasks to existing taskIds', () => {
      const testState = createStateWithExistingTasks(
        ['existing-task'],
        [],
        ['existing-task'],
      );
      const action = createRestoreAction();

      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['existing-task', 'task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['existing-task', 'task1'] }),
        },
        action,
        testState,
      );
    });
  });

  describe('scheduleTaskWithTime action', () => {
    const createScheduleAction = (
      taskOverrides: Partial<Task> = {},
      dueWithTime: number,
    ) =>
      TaskSharedActions.scheduleTaskWithTime({
        task: createMockTask(taskOverrides),
        dueWithTime,
        isMoveToBacklog: false,
      });

    it('should add task to Today tag when scheduled for today', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);
      const action = createScheduleAction({}, Date.now());

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1'] }),
        action,
        testState,
      );
    });

    it('should remove task from Today tag when scheduled for different day', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // eslint-disable-next-line no-mixed-operators
      const tomorrowTimestamp = Date.now() + 24 * 60 * 60 * 1000;
      const action = createScheduleAction({}, tomorrowTimestamp);

      expectStateUpdate(expectTagUpdate('TODAY', { taskIds: [] }), action, testState);
    });

    it('should not change state when task is already correctly scheduled', () => {
      const now = Date.now();
      const testState = createStateWithExistingTasks([], [], [], ['task1']);
      // Update the task to already have the correct dueWithTime
      const task1 = testState[TASK_FEATURE_NAME].entities.task1 as Task;
      testState[TASK_FEATURE_NAME].entities.task1 = {
        ...task1,
        dueWithTime: now,
        dueDay: undefined,
      } as Task;
      const action = createScheduleAction({}, now);

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });
  });

  describe('unScheduleTask action', () => {
    it('should remove task from Today tag when task is in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const action = TaskSharedActions.unscheduleTask({ id: 'task1' });

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        testState,
      );
    });

    it('should not change state when task is not in Today tag', () => {
      const action = TaskSharedActions.unscheduleTask({ id: 'task1' });

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
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

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
          tag2: { taskIds: ['task1'] },
        }),
        action,
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

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['task1'] },
          tag2: { taskIds: ['task1'] },
          tag3: { taskIds: ['task1'] },
        }),
        action,
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

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['other-task'] },
        }),
        action,
        testState,
      );
    });

    it('should handle no tag changes when tagIds are the same', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        title: 'Updated Title',
        tagIds: ['tag1'],
      });

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
        testState,
      );
    });

    it('should handle updating non-existent task gracefully', () => {
      const testState = createStateWithExistingTasks([], [], []);
      const action = createUpdateTaskAction('non-existent', { title: 'Updated' });

      expectStateUpdate(testState, action, testState);
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

      expectStateUpdate(
        expectTaskUpdate('task1', {
          timeSpentOnDay: {
            '2023-12-06': 3600000,
            '2023-12-07': 1800000,
          },
          timeSpent: 5400000, // Should be sum: 1.5 hours
        }),
        action,
        testState,
      );
    });

    it('should handle timeEstimate updates', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        timeEstimate: 7200000, // 2 hours
      });

      expectStateUpdate(
        expectTaskUpdate('task1', {
          timeEstimate: 7200000,
        }),
        action,
        testState,
      );
    });

    it('should handle isDone updates and set doneOn timestamp', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        isDone: true,
      });

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
        testState,
      );
    });

    it('should skip tag updates when tagIds are not provided', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        title: 'Updated Title',
        // No tagIds provided
      });

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
        testState,
      );
    });

    it('should handle updating task with invalid tag IDs gracefully', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1']);
      const action = createUpdateTaskAction('task1', {
        tagIds: ['tag1', 'non-existent-tag'],
      });

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
        testState,
      );
    });
  });

  describe('moveToOtherProject action', () => {
    const createMoveToOtherProjectAction = (
      task: TaskWithSubTasks,
      targetProjectId: string,
    ) =>
      TaskSharedActions.moveToOtherProject({
        task,
        targetProjectId,
      });

    it('should move task from one project to another', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      // Add target project
      testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
        id: 'project2',
        title: 'Target Project',
      });
      (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
        ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
        'project2',
      ];

      const task: TaskWithSubTasks = {
        ...createMockTask({ id: 'task1', projectId: 'project1' }),
        subTasks: [],
        subTaskIds: [],
      };

      const action = createMoveToOtherProjectAction(task, 'project2');

      expectStateUpdate(
        {
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              project1: jasmine.objectContaining({
                taskIds: [],
              }),
              project2: jasmine.objectContaining({
                taskIds: ['task1'],
              }),
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                projectId: 'project2',
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should move task with subtasks to another project', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'subtask1', 'subtask2'],
        [],
        [],
      );

      // Add target project
      testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
        id: 'project2',
        title: 'Target Project',
      });
      (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
        ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
        'project2',
      ];

      const task: TaskWithSubTasks = {
        ...createMockTask({ id: 'task1', projectId: 'project1' }),
        subTasks: [
          createMockTask({ id: 'subtask1', projectId: 'project1' }),
          createMockTask({ id: 'subtask2', projectId: 'project1' }),
        ],
        subTaskIds: ['subtask1', 'subtask2'],
      };

      const action = createMoveToOtherProjectAction(task, 'project2');

      expectStateUpdate(
        {
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              project1: jasmine.objectContaining({
                taskIds: [],
              }),
              project2: jasmine.objectContaining({
                taskIds: ['task1'],
              }),
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                projectId: 'project2',
              }),
              subtask1: jasmine.objectContaining({
                projectId: 'project2',
              }),
              subtask2: jasmine.objectContaining({
                projectId: 'project2',
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle moving task from backlog', () => {
      const testState = createStateWithExistingTasks([], ['task1'], []);

      // Add target project
      testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
        id: 'project2',
        title: 'Target Project',
      });
      (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
        ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
        'project2',
      ];

      const task: TaskWithSubTasks = {
        ...createMockTask({ id: 'task1', projectId: 'project1' }),
        subTasks: [],
        subTaskIds: [],
      };

      const action = createMoveToOtherProjectAction(task, 'project2');

      expectStateUpdate(
        {
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              project1: jasmine.objectContaining({
                backlogTaskIds: [],
              }),
              project2: jasmine.objectContaining({
                taskIds: ['task1'],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle moving task when source project does not exist', () => {
      const testState = createStateWithExistingTasks([], [], []);

      // Add target project
      testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
        id: 'project2',
        title: 'Target Project',
      });
      (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
        ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
        'project2',
      ];

      // Create task without project
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        projectId: undefined,
      });
      (testState[TASK_FEATURE_NAME].ids as string[]) = ['task1'];

      const task: TaskWithSubTasks = {
        ...createMockTask({ id: 'task1', projectId: undefined }),
        subTasks: [],
        subTaskIds: [],
      };

      const action = createMoveToOtherProjectAction(task, 'project2');

      expectStateUpdate(
        {
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              project2: jasmine.objectContaining({
                taskIds: ['task1'],
              }),
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                projectId: 'project2',
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle moving task when target project does not exist', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      const task: TaskWithSubTasks = {
        ...createMockTask({ id: 'task1', projectId: 'project1' }),
        subTasks: [],
        subTaskIds: [],
      };

      const action = createMoveToOtherProjectAction(task, 'non-existent-project');

      expectStateUpdate(
        {
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              project1: jasmine.objectContaining({
                taskIds: [],
              }),
            }),
          }),
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                projectId: 'non-existent-project',
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });
  });

  describe('deleteProject action', () => {
    it('should remove all project tasks from all tags', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        ['task1', 'task2', 'keep-task'],
        ['task1', 'task3', 'keep-task'],
      );
      const mockProject = createMockProject();
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1', 'task2', 'task3'],
      });

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['keep-task'] },
          TODAY: { taskIds: ['keep-task'] },
        }),
        action,
        testState,
      );
    });

    it('should handle empty project task lists', () => {
      const mockProject = createMockProject();
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: [],
      });

      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: [] },
          TODAY: { taskIds: [] },
        }),
        action,
      );
    });
  });

  describe('planTasksForToday action', () => {
    it('should add new tasks to the top of Today tag', () => {
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1', 'task2'],
        parentTaskMap: {},
      });

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'task2', 'existing-task'] }),
        action,
        testState,
      );
    });

    it('should not add tasks that are already in Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['task1', 'existing-task'],
      );
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['task1', 'task2'],
        parentTaskMap: {},
      });

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task2', 'task1', 'existing-task'] }),
        action,
        testState,
      );
    });

    it('should handle parentTaskMap filtering', () => {
      const testState = createStateWithExistingTasks([], [], [], ['parent-task']);
      const action = TaskSharedActions.planTasksForToday({
        taskIds: ['subtask1', 'task2'],
        parentTaskMap: { subtask1: 'parent-task' },
      });

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task2', 'parent-task'] }),
        action,
        testState,
      );
    });
  });

  describe('removeTasksFromTodayTag action', () => {
    it('should remove specified tasks from Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['task1', 'task2', 'keep-task'],
      );
      const action = TaskSharedActions.removeTasksFromTodayTag({
        taskIds: ['task1', 'task2'],
      });

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['keep-task'] }),
        action,
        testState,
      );
    });

    it('should handle empty taskIds array', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'task2']);
      const action = TaskSharedActions.removeTasksFromTodayTag({ taskIds: [] });

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'task2'] }),
        action,
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

      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            ids: jasmine.arrayContaining(['existing1', 'existing2', 'new-task']),
          }),
        },
        action,
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

  describe('removeTagsForAllTasks action', () => {
    it('should remove specified tags from all tasks', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2'],
        [],
        ['task1', 'task2', 'task3'],
        [],
      );

      // Add another tag to task1 and task3
      testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
        id: 'tag2',
        title: 'Tag 2',
        taskIds: ['task1', 'task3'],
      });
      (testState[TAG_FEATURE_NAME].ids as string[]) = [
        ...(testState[TAG_FEATURE_NAME].ids as string[]),
        'tag2',
      ];

      // Update tasks to have multiple tags
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2'],
        projectId: 'project1',
      });
      testState[TASK_FEATURE_NAME].entities.task3 = createMockTask({
        id: 'task3',
        tagIds: ['tag1', 'tag2'],
        projectId: undefined,
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag2'],
      });

      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
              task2: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
              task3: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should remove multiple tags from all tasks', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      // Add more tags
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

      // Update task to have multiple tags
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: ['tag1', 'tag2', 'tag3'],
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag2', 'tag3'],
      });

      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle removing tags from tasks with no tags', () => {
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], [], []);

      // task1 has no tags
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: [],
        projectId: 'project1',
      });
      // task2 has tag1
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        tagIds: ['tag1'],
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag1'],
      });

      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: [],
              }),
              task2: jasmine.objectContaining({
                tagIds: [],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle empty tagIdsToRemove array', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: [],
      });

      // State should remain unchanged
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should only update tasks that have the tags being removed', () => {
      const testState = createStateWithExistingTasks(
        ['task1', 'task2', 'task3'],
        [],
        ['task1', 'task3'],
        [],
      );

      // task2 doesn't have any tags
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        tagIds: [],
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag1'],
      });

      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: [],
              }),
              task2: jasmine.objectContaining({
                tagIds: [], // Should remain empty
              }),
              task3: jasmine.objectContaining({
                tagIds: [],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle removing non-existent tags', () => {
      const testState = createStateWithExistingTasks(['task1'], [], ['task1'], []);

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['non-existent-tag'],
      });

      // Task should keep its existing tags
      expectStateUpdate(
        {
          [TASK_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              task1: jasmine.objectContaining({
                tagIds: ['tag1'],
              }),
            }),
          }),
        },
        action,
        testState,
      );
    });

    it('should handle tasks with null or undefined tagIds', () => {
      const testState = createStateWithExistingTasks(['task1', 'task2'], [], [], []);

      // task1 has null tagIds
      testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
        id: 'task1',
        tagIds: null as any,
        projectId: 'project1',
      });
      // task2 has undefined tagIds
      testState[TASK_FEATURE_NAME].entities.task2 = createMockTask({
        id: 'task2',
        tagIds: undefined as any,
        projectId: 'project1',
      });

      const action = TaskSharedActions.removeTagsForAllTasks({
        tagIdsToRemove: ['tag1'],
      });

      // Should not crash and tasks should remain unchanged
      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalled();
    });
  });

  describe('PlannerActions.transferTask action', () => {
    const createTransferTaskAction = (
      task: Task,
      today: string,
      targetIndex: number,
      newDay: string,
      prevDay: string,
      targetTaskId?: string,
    ) =>
      PlannerActions.transferTask({
        task,
        today,
        targetIndex,
        newDay,
        prevDay,
        targetTaskId,
      });

    it('should remove task from Today tag when moving from today to different day', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, 'tomorrow', todayStr);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        testState,
      );
    });

    it('should add task to Today tag when moving from different day to today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 1, todayStr, 'yesterday');

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['existing-task', 'task1'] }),
        action,
        testState,
      );
    });

    it('should insert task at specific position when targetTaskId is provided', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'target-task', 'last-task'],
      );
      const task = createMockTask({ id: 'new-task' });
      const action = createTransferTaskAction(
        task,
        todayStr,
        0,
        todayStr,
        'yesterday',
        'target-task',
      );

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'new-task', 'target-task', 'last-task'],
        }),
        action,
        testState,
      );
    });

    it('should not change state when transferring within same day', () => {
      const todayStr = getDbDateStr();
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, todayStr, todayStr);

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });

    it('should handle unique task IDs when adding to Today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createTransferTaskAction(task, todayStr, 0, todayStr, 'yesterday');

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'other-task'] }),
        action,
        testState,
      );
    });
  });

  describe('PlannerActions.planTaskForDay action', () => {
    const createPlanTaskForDayAction = (
      task: Task,
      day: string,
      isAddToTop: boolean = false,
    ) =>
      PlannerActions.planTaskForDay({
        task,
        day,
        isAddToTop,
      });

    it('should add task to Today tag when planning for today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, todayStr, false);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['existing-task', 'task1'] }),
        action,
        testState,
      );
    });

    it('should add task to top of Today tag when isAddToTop is true', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['existing-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, todayStr, true);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'existing-task'] }),
        action,
        testState,
      );
    });

    it('should remove task from Today tag when planning for different day', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, 'tomorrow', false);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        testState,
      );
    });

    it('should reorder task in Today tag when already in Today and planned for today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      // Set task1.tagIds to already include TODAY for board-style consistency test
      (testState as any).tasks.entities['task1'].tagIds = ['TODAY'];
      const task = createMockTask({ id: 'task1', tagIds: ['TODAY'] });
      const action = createPlanTaskForDayAction(task, todayStr, false);

      // Task gets reordered to end of TODAY tag (isAddToTop=false)
      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task', 'task1'] }),
        action,
        testState,
      );
    });

    it('should update planner days but not Today tag when task is not in Today and planned for different day', () => {
      const testState = createStateWithExistingTasks([], [], [], ['other-task']);
      const task = createMockTask({ id: 'task1' });
      const action = createPlanTaskForDayAction(task, 'tomorrow', false);

      expectStateUpdate(
        {
          // Today tag should be unchanged
          ...expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
          // Planner days should have the task added to 'tomorrow'
          [plannerFeatureKey]: jasmine.objectContaining({
            days: jasmine.objectContaining({
              tomorrow: ['task1'],
            }),
          }),
        },
        action,
        testState,
      );
    });
  });

  describe('PlannerActions.moveBeforeTask action', () => {
    const createMoveBeforeTaskAction = (fromTask: Task, toTaskId: string) =>
      PlannerActions.moveBeforeTask({
        fromTask,
        toTaskId,
      });

    it('should move task before target task in Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['task1', 'middle-task', 'target-task', 'last-task'],
      );
      const fromTask = createMockTask({ id: 'task1' });
      const action = createMoveBeforeTaskAction(fromTask, 'target-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['middle-task', 'task1', 'target-task', 'last-task'],
        }),
        action,
        testState,
      );
    });

    it('should remove task from Today when moving to task not in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['task1', 'other-task']);
      const fromTask = createMockTask({ id: 'task1' });
      const action = createMoveBeforeTaskAction(fromTask, 'non-today-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['other-task'] }),
        action,
        testState,
      );
    });

    it('should handle unique task IDs when moving task', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'target-task', 'last-task'],
      );
      const fromTask = createMockTask({ id: 'move-task' });
      const action = createMoveBeforeTaskAction(fromTask, 'target-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'move-task', 'target-task', 'last-task'],
        }),
        action,
        testState,
      );
    });

    it('should not change state when fromTask is not in Today and toTask is not in Today', () => {
      const testState = createStateWithExistingTasks([], [], [], ['other-task']);
      const fromTask = createMockTask({ id: 'not-in-today' });
      const action = createMoveBeforeTaskAction(fromTask, 'also-not-in-today');

      metaReducer(testState, action);
      expect(mockReducer).toHaveBeenCalledWith(testState, action);
    });
  });

  describe('TaskSharedActions.moveTaskInTodayTagList action', () => {
    const createMoveTaskInTodayTagListAction = (toTaskId: string, fromTaskId: string) =>
      TaskSharedActions.moveTaskInTodayTagList({
        toTaskId,
        fromTaskId,
      });

    it('should move task before target task in Today tag', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'move-task', 'middle-task', 'target-task', 'last-task'],
      );
      const action = createMoveTaskInTodayTagListAction('target-task', 'move-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['first-task', 'middle-task', 'move-task', 'target-task', 'last-task'],
        }),
        action,
        testState,
      );
    });

    it('should handle moving task to beginning of list', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['first-task', 'move-task', 'last-task'],
      );
      const action = createMoveTaskInTodayTagListAction('first-task', 'move-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['move-task', 'first-task', 'last-task'],
        }),
        action,
        testState,
      );
    });

    it('should handle moving task to end of list', () => {
      const testState = createStateWithExistingTasks(
        [],
        [],
        [],
        ['move-task', 'middle-task', 'last-task'],
      );
      const action = createMoveTaskInTodayTagListAction('last-task', 'move-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['middle-task', 'move-task', 'last-task'],
        }),
        action,
        testState,
      );
    });

    it('should handle single task in Today list', () => {
      const testState = createStateWithExistingTasks([], [], [], ['only-task']);
      const action = createMoveTaskInTodayTagListAction('only-task', 'only-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: ['only-task'],
        }),
        action,
        testState,
      );
    });

    it('should handle empty Today list gracefully', () => {
      const testState = createStateWithExistingTasks([], [], [], []);
      const action = createMoveTaskInTodayTagListAction('target-task', 'move-task');

      expectStateUpdate(
        expectTagUpdate('TODAY', {
          taskIds: [],
        }),
        action,
        testState,
      );
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
