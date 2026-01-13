/* eslint-disable @typescript-eslint/explicit-function-return-type,@typescript-eslint/naming-convention */
import { projectSharedMetaReducer } from './project-shared.reducer';
import { TaskSharedActions } from '../task-shared.actions';
import { RootState } from '../../root-state';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { TIME_TRACKING_FEATURE_KEY } from '../../../features/time-tracking/store/time-tracking.reducer';
import { TimeTrackingState } from '../../../features/time-tracking/time-tracking.model';
import { Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import {
  createBaseState,
  createMockProject,
  createMockTask,
  createStateWithExistingTasks,
  expectStateUpdate,
  expectTagUpdates,
} from './test-utils';
import { TASK_REPEAT_CFG_FEATURE_NAME } from '../../../features/task-repeat-cfg/store/task-repeat-cfg.selectors';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfg,
  TaskRepeatCfgState,
} from '../../../features/task-repeat-cfg/task-repeat-cfg.model';

const createMockTaskRepeatCfg = (
  overrides: Partial<TaskRepeatCfg> = {},
): TaskRepeatCfg => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  id: 'cfg1',
  title: 'Repeat Config',
  projectId: null,
  tagIds: [],
  ...overrides,
});

describe('projectSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = projectSharedMetaReducer(mockReducer);
    baseState = createBaseState();
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

      metaReducer(testState, action);
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
        mockReducer,
        testState,
      );
    });

    it('should remove task from actual source project even if payload is stale', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []);

      testState[PROJECT_FEATURE_NAME].entities.project2 = createMockProject({
        id: 'project2',
        title: 'Target Project',
      });
      (testState[PROJECT_FEATURE_NAME].ids as string[]) = [
        ...(testState[PROJECT_FEATURE_NAME].ids as string[]),
        'project2',
      ];

      const stalePayload: TaskWithSubTasks = {
        ...createMockTask({ id: 'task1', projectId: 'project2' }),
        subTasks: [],
        subTaskIds: [],
      };

      const action = createMoveToOtherProjectAction(stalePayload, 'project2');

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      expect(updatedState[PROJECT_FEATURE_NAME].entities.project1.taskIds).toEqual([]);
      expect(updatedState[PROJECT_FEATURE_NAME].entities.project2.taskIds).toEqual([
        'task1',
      ]);
      expect(updatedState[TASK_FEATURE_NAME].entities.task1.projectId).toBe('project2');
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

      metaReducer(testState, action);
      expectStateUpdate(
        {
          [PROJECT_FEATURE_NAME]: jasmine.objectContaining({
            entities: jasmine.objectContaining({
              project1: jasmine.objectContaining({
                taskIds: [],
              }),
              project2: jasmine.objectContaining({
                // Only parent task should be in taskIds, not subtasks
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
        mockReducer,
        testState,
      );
    });

    it('should not duplicate subtasks in target project taskIds', () => {
      // This test specifically verifies the fix for issue #4882
      const testState = createStateWithExistingTasks(
        ['parent-task', 'subtask1', 'subtask2', 'subtask3'],
        [],
        [],
      );

      // Setup parent-child relationships
      testState[TASK_FEATURE_NAME].entities['parent-task'] = {
        ...testState[TASK_FEATURE_NAME].entities['parent-task'],
        subTaskIds: ['subtask1', 'subtask2', 'subtask3'],
      } as Task;
      testState[TASK_FEATURE_NAME].entities['subtask1'] = {
        ...testState[TASK_FEATURE_NAME].entities['subtask1'],
        parentId: 'parent-task',
      } as Task;
      testState[TASK_FEATURE_NAME].entities['subtask2'] = {
        ...testState[TASK_FEATURE_NAME].entities['subtask2'],
        parentId: 'parent-task',
      } as Task;
      testState[TASK_FEATURE_NAME].entities['subtask3'] = {
        ...testState[TASK_FEATURE_NAME].entities['subtask3'],
        parentId: 'parent-task',
      } as Task;

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
        ...createMockTask({ id: 'parent-task', projectId: 'project1' }),
        subTasks: [
          createMockTask({
            id: 'subtask1',
            projectId: 'project1',
            parentId: 'parent-task',
          }),
          createMockTask({
            id: 'subtask2',
            projectId: 'project1',
            parentId: 'parent-task',
          }),
          createMockTask({
            id: 'subtask3',
            projectId: 'project1',
            parentId: 'parent-task',
          }),
        ],
        subTaskIds: ['subtask1', 'subtask2', 'subtask3'],
      };

      const action = createMoveToOtherProjectAction(task, 'project2');

      metaReducer(testState, action);

      // Get the updated state
      const updatedState = mockReducer.calls.mostRecent().args[0];
      const targetProjectTaskIds =
        updatedState[PROJECT_FEATURE_NAME].entities.project2.taskIds;

      // Verify only parent task is in taskIds
      expect(targetProjectTaskIds).toEqual(['parent-task']);
      expect(targetProjectTaskIds.length).toBe(1);

      // Verify subtasks are NOT in taskIds
      expect(targetProjectTaskIds).not.toContain('subtask1');
      expect(targetProjectTaskIds).not.toContain('subtask2');
      expect(targetProjectTaskIds).not.toContain('subtask3');

      // But all tasks should have updated projectId
      expect(updatedState[TASK_FEATURE_NAME].entities['parent-task'].projectId).toBe(
        'project2',
      );
      expect(updatedState[TASK_FEATURE_NAME].entities['subtask1'].projectId).toBe(
        'project2',
      );
      expect(updatedState[TASK_FEATURE_NAME].entities['subtask2'].projectId).toBe(
        'project2',
      );
      expect(updatedState[TASK_FEATURE_NAME].entities['subtask3'].projectId).toBe(
        'project2',
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

      metaReducer(testState, action);
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
        mockReducer,
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

      metaReducer(testState, action);
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
        mockReducer,
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

      metaReducer(testState, action);
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
        mockReducer,
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

      metaReducer(testState, action);
      expectStateUpdate(
        expectTagUpdates({
          tag1: { taskIds: ['keep-task'] },
          TODAY: { taskIds: ['keep-task'] },
        }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should remove the project entity from state', () => {
      const projectToDelete = createMockProject({ id: 'project-to-delete' });
      const testState = {
        ...createStateWithExistingTasks(['task1'], [], []),
        [PROJECT_FEATURE_NAME]: {
          ...createStateWithExistingTasks(['task1'], [], [])[PROJECT_FEATURE_NAME],
          ids: ['default-project', 'project-to-delete'],
          entities: {
            'default-project': createMockProject({ id: 'default-project' }),
            'project-to-delete': projectToDelete,
          },
        },
      };

      const action = TaskSharedActions.deleteProject({
        projectId: projectToDelete.id,
        noteIds: projectToDelete.noteIds,
        allTaskIds: ['task1'],
      });

      metaReducer(testState, action);
      const updatedState = mockReducer.calls.mostRecent().args[0];

      expect(updatedState[PROJECT_FEATURE_NAME].ids).toEqual(['default-project']);
      expect(
        updatedState[PROJECT_FEATURE_NAME].entities['project-to-delete'],
      ).toBeUndefined();
      expect(
        updatedState[PROJECT_FEATURE_NAME].entities['default-project'],
      ).toBeDefined();
    });

    it('should handle empty project task lists', () => {
      const mockProject = createMockProject();
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: [],
      });

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

    it('should cleanup time tracking state for deleted project', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []) as any;

      // Add time tracking state
      testState[TIME_TRACKING_FEATURE_KEY] = {
        tag: {},
        project: {
          project1: { timeSpent: 3600 },
          'other-project': { timeSpent: 7200 },
        },
      } as TimeTrackingState;

      const mockProject = createMockProject({ id: 'project1' });
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1'],
      });

      metaReducer(testState, action);

      const passedState = mockReducer.calls.mostRecent().args[0];
      expect(passedState[TIME_TRACKING_FEATURE_KEY].project.project1).toBeUndefined();
      expect(
        passedState[TIME_TRACKING_FEATURE_KEY].project['other-project'],
      ).toBeDefined();
    });

    it('should handle deleting project without time tracking state', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []) as any;

      // No time tracking state set
      testState[TIME_TRACKING_FEATURE_KEY] = undefined;

      const mockProject = createMockProject({ id: 'project1' });
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1'],
      });

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();
    });

    it('should delete orphaned task repeat configs when project is deleted', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []) as any;

      // Add task repeat configs: one linked to the project (no tags = orphaned), one not
      testState[TASK_REPEAT_CFG_FEATURE_NAME] = {
        ids: ['cfg-project', 'cfg-other'],
        entities: {
          'cfg-project': createMockTaskRepeatCfg({
            id: 'cfg-project',
            projectId: 'project1',
            tagIds: [],
          }),
          'cfg-other': createMockTaskRepeatCfg({
            id: 'cfg-other',
            projectId: 'other-project',
            tagIds: [],
          }),
        },
      } as TaskRepeatCfgState;

      const mockProject = createMockProject({ id: 'project1' });
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1'],
      });

      metaReducer(testState, action);
      const passedState = mockReducer.calls.mostRecent().args[0];

      // cfg-project should be deleted (orphaned: no tags, project deleted)
      expect(
        passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities['cfg-project'],
      ).toBeUndefined();
      // cfg-other should remain
      expect(
        passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities['cfg-other'],
      ).toBeDefined();
    });

    it('should delete task repeat config even if it has tags', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []) as any;

      // Add task repeat config linked to project AND has tags
      testState[TASK_REPEAT_CFG_FEATURE_NAME] = {
        ids: ['cfg-with-tags'],
        entities: {
          'cfg-with-tags': createMockTaskRepeatCfg({
            id: 'cfg-with-tags',
            projectId: 'project1',
            tagIds: ['tag1', 'tag2'],
          }),
        },
      } as TaskRepeatCfgState;

      const mockProject = createMockProject({ id: 'project1' });
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1'],
      });

      metaReducer(testState, action);
      const passedState = mockReducer.calls.mostRecent().args[0];

      // cfg-with-tags should be deleted (repeat configs are always deleted with project)
      expect(
        passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities['cfg-with-tags'],
      ).toBeUndefined();
    });

    it('should delete all project repeat configs but leave unrelated configs', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []) as any;

      // Mix of configs: some linked to project (with/without tags), some unrelated
      testState[TASK_REPEAT_CFG_FEATURE_NAME] = {
        ids: ['cfg-no-tags', 'cfg-with-tags', 'cfg-unrelated'],
        entities: {
          'cfg-no-tags': createMockTaskRepeatCfg({
            id: 'cfg-no-tags',
            projectId: 'project1',
            tagIds: [],
          }),
          'cfg-with-tags': createMockTaskRepeatCfg({
            id: 'cfg-with-tags',
            projectId: 'project1',
            tagIds: ['tag1'],
          }),
          'cfg-unrelated': createMockTaskRepeatCfg({
            id: 'cfg-unrelated',
            projectId: 'other-project',
            tagIds: ['tag2'],
          }),
        },
      } as TaskRepeatCfgState;

      const mockProject = createMockProject({ id: 'project1' });
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1'],
      });

      metaReducer(testState, action);
      const passedState = mockReducer.calls.mostRecent().args[0];

      // All project1 configs should be deleted
      expect(
        passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities['cfg-no-tags'],
      ).toBeUndefined();
      expect(
        passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities['cfg-with-tags'],
      ).toBeUndefined();
      // cfg-unrelated should remain unchanged
      expect(
        passedState[TASK_REPEAT_CFG_FEATURE_NAME].entities['cfg-unrelated'].projectId,
      ).toBe('other-project');
    });

    it('should handle deleting project without task repeat cfg state', () => {
      const testState = createStateWithExistingTasks(['task1'], [], []) as any;

      // No task repeat cfg state set
      testState[TASK_REPEAT_CFG_FEATURE_NAME] = undefined;

      const mockProject = createMockProject({ id: 'project1' });
      const action = TaskSharedActions.deleteProject({
        projectId: mockProject.id,
        noteIds: mockProject.noteIds,
        allTaskIds: ['task1'],
      });

      // Should not throw
      expect(() => metaReducer(testState, action)).not.toThrow();
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
