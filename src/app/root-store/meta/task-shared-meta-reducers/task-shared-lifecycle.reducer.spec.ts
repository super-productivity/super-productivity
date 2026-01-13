/* eslint-disable @typescript-eslint/explicit-function-return-type */
import { taskSharedLifecycleMetaReducer } from './task-shared-lifecycle.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import {
  createBaseState,
  createMockProject,
  createMockTag,
  createMockTask,
  createStateWithExistingTasks,
  expectProjectUpdate,
  expectStateUpdate,
  expectTagUpdate,
  expectTagUpdates,
} from './test-utils';

describe('taskSharedLifecycleMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  // Helper to create TaskWithSubTasks from mock tasks
  const createTaskWithSubTasks = (
    taskOverrides: Partial<Task>,
    subTasks: Task[] = [],
  ): TaskWithSubTasks => ({
    ...createMockTask(taskOverrides),
    subTasks,
  });

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = taskSharedLifecycleMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('moveToArchive action', () => {
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

      metaReducer(testState, action);
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
        mockReducer,
        testState,
      );
    });

    it('should handle empty tasks array', () => {
      const action = createArchiveAction([]);

      metaReducer(baseState, action);
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
        mockReducer,
        baseState,
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

      // Update task entities to have the correct tagIds (current state must match)
      testState[TASK_FEATURE_NAME].entities['subtask2'] = createMockTask({
        id: 'subtask2',
        projectId: 'project1',
        tagIds: ['tag1', 'tag2'], // Must have tag2 in current state
        parentId: 'parent-task',
      });

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

      metaReducer(testState, action);
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
        mockReducer,
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

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTagUpdates({
            tag1: { taskIds: ['task2'] },
            TODAY: { taskIds: [] },
          }),
        },
        action,
        mockReducer,
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

      metaReducer(testState, action);
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
        mockReducer,
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

      metaReducer(testState, action);
      expectStateUpdate(
        {
          ...expectTagUpdates({
            tag1: { taskIds: [] },
            TODAY: { taskIds: [] }, // Should still be updated
          }),
        },
        action,
        mockReducer,
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

      // Update task2 entity to have projectId: 'project2' in current state
      testState[TASK_FEATURE_NAME].entities['task2'] = createMockTask({
        id: 'task2',
        projectId: 'project2',
        tagIds: ['tag1'],
      });

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

      metaReducer(testState, action);
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
        mockReducer,
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

      metaReducer(testState, action);
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
        mockReducer,
        testState,
      );
    });

    describe('remote sync scenarios', () => {
      it('should clean up tags from current state even if payload has different tag associations', () => {
        // Scenario: Client A archived task with tagIds: ['tag1']
        // But on Client B (this client), the task has tagIds: ['tag1', 'tag2']
        // The cleanup should use Client B's current state, not the payload
        const testState = createStateWithExistingTasks(
          ['task1'],
          [],
          ['task1'], // tag1 has task1
          [],
        );

        // Add tag2 which also has the task (but payload won't know about it)
        testState[TAG_FEATURE_NAME].entities.tag2 = createMockTag({
          id: 'tag2',
          title: 'Tag 2',
          taskIds: ['task1'],
        });
        (testState[TAG_FEATURE_NAME].ids as string[]) = [
          ...(testState[TAG_FEATURE_NAME].ids as string[]),
          'tag2',
        ];

        // Update the task entity in current state to have both tags
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          projectId: 'project1',
          tagIds: ['tag1', 'tag2'], // Current state has both tags
        });

        // Payload from remote client only knows about tag1
        const tasksToArchive: TaskWithSubTasks[] = [
          createTaskWithSubTasks({
            id: 'task1',
            projectId: 'project1',
            tagIds: ['tag1'], // Payload only has tag1 (from originating client)
          }),
        ];

        const action = createArchiveAction(tasksToArchive);

        metaReducer(testState, action);
        // Both tags should be cleaned up based on current state
        expectStateUpdate(
          {
            ...expectProjectUpdate('project1', {
              taskIds: [],
            }),
            ...expectTagUpdates({
              tag1: { taskIds: [] },
              tag2: { taskIds: [] }, // tag2 should also be cleaned up
              TODAY: { taskIds: [] },
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });

      it('should clean up project from current state even if payload has different project', () => {
        // Scenario: Client A archived task with projectId: 'project1'
        // But on Client B, the task was moved to 'project2'
        const testState = createStateWithExistingTasks([], [], ['task1'], []);

        // Add project2 which has the task in current state
        testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
          id: 'project2',
          title: 'Project 2',
          taskIds: ['task1'],
        });
        (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
          ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
          'project2',
        ];

        // Update task entity to be in project2 (current state)
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          projectId: 'project2', // Current state has project2
          tagIds: ['tag1'],
        });

        // Payload from remote client says task was in project1
        const tasksToArchive: TaskWithSubTasks[] = [
          createTaskWithSubTasks({
            id: 'task1',
            projectId: 'project1', // Payload has project1 (from originating client)
            tagIds: ['tag1'],
          }),
        ];

        const action = createArchiveAction(tasksToArchive);

        metaReducer(testState, action);
        // project2 should be cleaned up based on current state
        expectStateUpdate(
          {
            ...expectProjectUpdate('project2', {
              taskIds: [],
            }),
            ...expectTagUpdates({
              tag1: { taskIds: [] },
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });

      it('should handle tasks that do not exist in current state (already deleted/archived)', () => {
        // Scenario: Task was already deleted on this client before receiving the archive op
        const testState = createStateWithExistingTasks(
          ['other-task'],
          [],
          ['other-task'],
          [],
        );

        // Payload references a task that doesn't exist in current state
        const tasksToArchive: TaskWithSubTasks[] = [
          createTaskWithSubTasks({
            id: 'nonexistent-task',
            projectId: 'project1',
            tagIds: ['tag1'],
          }),
        ];

        const action = createArchiveAction(tasksToArchive);

        // Should not throw, should gracefully handle missing task
        expect(() => metaReducer(testState, action)).not.toThrow();

        // State should remain unchanged for existing tasks
        expectStateUpdate(
          {
            ...expectProjectUpdate('project1', {
              taskIds: ['other-task'],
            }),
            ...expectTagUpdates({
              tag1: { taskIds: ['other-task'] },
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });

      it('should handle payload referencing non-existent project', () => {
        // Scenario: Payload references a project that doesn't exist on this client
        const testState = createStateWithExistingTasks([], [], ['task1'], []);

        // Task exists but with no project in current state
        testState[TASK_FEATURE_NAME].entities.task1 = createMockTask({
          id: 'task1',
          projectId: undefined,
          tagIds: ['tag1'],
        });

        // Payload says task was in a project that doesn't exist here
        const tasksToArchive: TaskWithSubTasks[] = [
          createTaskWithSubTasks({
            id: 'task1',
            projectId: 'nonexistent-project',
            tagIds: ['tag1'],
          }),
        ];

        const action = createArchiveAction(tasksToArchive);

        // Should not throw
        expect(() => metaReducer(testState, action)).not.toThrow();

        // tag1 should still be cleaned up
        expectStateUpdate(
          {
            ...expectTagUpdates({
              tag1: { taskIds: [] },
            }),
          },
          action,
          mockReducer,
          testState,
        );
      });
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

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1'] }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should handle task with subtasks', () => {
      const subTasks = [createMockTask({ id: 'subtask1' })];
      const action = createRestoreAction({ subTaskIds: ['subtask1'] }, subTasks);

      metaReducer(baseState, action);
      expectStateUpdate(
        {
          ...expectProjectUpdate('project1', { taskIds: ['task1'] }),
          ...expectTagUpdate('tag1', { taskIds: ['task1', 'subtask1'] }),
        },
        action,
        mockReducer,
        baseState,
      );
    });

    it('should add tasks to existing taskIds', () => {
      const testState = createStateWithExistingTasks(
        ['existing-task'],
        [],
        ['existing-task'],
      );
      const action = createRestoreAction();

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
  });

  describe('other actions', () => {
    it('should pass through other actions to the reducer', () => {
      const action = { type: 'SOME_OTHER_ACTION' };
      metaReducer(baseState, action);

      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });
});
