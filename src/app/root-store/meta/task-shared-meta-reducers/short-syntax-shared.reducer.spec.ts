import { shortSyntaxSharedMetaReducer } from './short-syntax-shared.reducer';
import { RootState } from '../../root-state';
import { Task } from '../../../features/tasks/task.model';
import { Action, ActionReducer } from '@ngrx/store';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TaskSharedActions } from '../task-shared.actions';
import {
  createBaseState,
  createMockProject,
  createMockTask,
  createStateWithExistingTasks,
  expectStateUpdate,
  expectTagUpdate,
  expectTaskUpdate,
  expectProjectUpdate,
} from './test-utils';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../../features/project/store/project.reducer';
import { plannerFeatureKey } from '../../../features/planner/store/planner.reducer';

describe('shortSyntaxSharedMetaReducer', () => {
  let mockReducer: jasmine.Spy;
  let metaReducer: ActionReducer<any, Action>;
  let baseState: RootState;

  beforeEach(() => {
    mockReducer = jasmine.createSpy('reducer').and.callFake((state, action) => state);
    metaReducer = shortSyntaxSharedMetaReducer(mockReducer);
    baseState = createBaseState();
  });

  describe('applyShortSyntax action - task updates', () => {
    it('should apply basic task changes', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', projectId: 'project1' });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: { title: 'Updated Title', timeEstimate: 3600000 },
      });

      metaReducer(testState, action);
      expectStateUpdate(
        expectTaskUpdate('task1', { title: 'Updated Title', timeEstimate: 3600000 }),
        action,
        mockReducer,
        testState,
      );
    });

    it('should not change state if task does not exist', () => {
      const action = TaskSharedActions.applyShortSyntax({
        task: createMockTask({ id: 'non-existent' }),
        taskChanges: { title: 'Updated' },
      });

      metaReducer(baseState, action);
      expect(mockReducer).toHaveBeenCalledWith(baseState, action);
    });
  });

  describe('applyShortSyntax action - project move', () => {
    it('should move task to target project', () => {
      // Create state with task in project1 and a project2
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      // Add project2 to the state
      const project2 = createMockProject({
        id: 'project2',
        title: 'Project 2',
        taskIds: [],
        backlogTaskIds: [],
      });
      const stateWithProject2 = {
        ...testState,
        [PROJECT_FEATURE_NAME]: {
          ...testState[PROJECT_FEATURE_NAME],
          ids: [...(testState[PROJECT_FEATURE_NAME].ids as string[]), 'project2'],
          entities: {
            ...testState[PROJECT_FEATURE_NAME].entities,
            project2,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', projectId: 'project1' });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        targetProjectId: 'project2',
      });

      metaReducer(stateWithProject2, action);

      // Verify task was removed from project1 and added to project2
      expectStateUpdate(
        expectProjectUpdate('project1', { taskIds: [] }),
        action,
        mockReducer,
        stateWithProject2,
      );
      expectStateUpdate(
        expectProjectUpdate('project2', { taskIds: ['task1'] }),
        action,
        mockReducer,
        stateWithProject2,
      );
      expectStateUpdate(
        expectTaskUpdate('task1', { projectId: 'project2' }),
        action,
        mockReducer,
        stateWithProject2,
      );
    });

    it('should not move if targetProjectId is same as current', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', projectId: 'project1' });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        targetProjectId: 'project1',
      });

      metaReducer(testState, action);

      // Project should remain unchanged
      expect(mockReducer).toHaveBeenCalled();
      const calledState = mockReducer.calls.mostRecent().args[0];
      expect(calledState[PROJECT_FEATURE_NAME].entities.project1.taskIds).toEqual([
        'task1',
      ]);
    });
  });

  describe('applyShortSyntax action - scheduling with day', () => {
    it('should add task to today tag when scheduling for today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(
        ['task1'],
        [],
        [],
        ['existing-task'],
      );
      const task = createMockTask({ id: 'task1', projectId: 'project1', tagIds: [] });

      // Update task entity to have empty tagIds
      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: todayStr, isAddToTop: false },
      });

      metaReducer(stateWithTask, action);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['existing-task', 'task1'] }),
        action,
        mockReducer,
        stateWithTask,
      );
      // Virtual tag pattern: TODAY should NOT be in task.tagIds
      // Membership is determined by task.dueDay, not tagIds
      expectStateUpdate(
        expectTaskUpdate('task1', { dueDay: todayStr }),
        action,
        mockReducer,
        stateWithTask,
      );
      // Verify TODAY is NOT in tagIds
      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      expect(calledState[TASK_FEATURE_NAME].entities.task1!.tagIds).not.toContain(
        'TODAY',
      );
    });

    it('should add task to top of today when isAddToTop is true', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(
        ['task1'],
        [],
        [],
        ['existing-task'],
      );
      const task = createMockTask({ id: 'task1', projectId: 'project1', tagIds: [] });

      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: todayStr, isAddToTop: true },
      });

      metaReducer(stateWithTask, action);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: ['task1', 'existing-task'] }),
        action,
        mockReducer,
        stateWithTask,
      );
    });

    it('should remove task from today when scheduling for different day', () => {
      const futureDay = '2099-12-31';
      const testState = createStateWithExistingTasks(['task1'], [], [], ['task1']);
      const task = createMockTask({ id: 'task1', tagIds: ['TODAY'] });

      // Update task entity to include TODAY in tagIds
      const stateWithTodayTag = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: ['TODAY'],
            } as Task,
          },
        },
      } as RootState;

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: futureDay },
      });

      metaReducer(stateWithTodayTag, action);

      expectStateUpdate(
        expectTagUpdate('TODAY', { taskIds: [] }),
        action,
        mockReducer,
        stateWithTodayTag,
      );
      expectStateUpdate(
        expectTaskUpdate('task1', { dueDay: futureDay, tagIds: [] }),
        action,
        mockReducer,
        stateWithTodayTag,
      );
    });

    it('should add task to planner days when scheduling for future day', () => {
      const futureDay = '2099-12-31';
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', tagIds: [] });

      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: futureDay },
      });

      metaReducer(stateWithTask, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      expect(calledState[plannerFeatureKey as keyof RootState]).toEqual(
        jasmine.objectContaining({
          days: jasmine.objectContaining({
            [futureDay]: ['task1'],
          }),
        }),
      );
    });
  });

  describe('applyShortSyntax action - scheduling with time', () => {
    it('should schedule task with dueWithTime and update today tag for today', () => {
      const now = Date.now();
      const todayTimestamp = now + 3600000; // 1 hour from now (same day)
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', tagIds: [] });

      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: {
          dueWithTime: todayTimestamp,
          remindAt: todayTimestamp - 900000, // 15 min before
        },
      });

      metaReducer(stateWithTask, action);

      expectStateUpdate(
        expectTaskUpdate('task1', {
          dueWithTime: todayTimestamp,
          remindAt: todayTimestamp - 900000,
        }),
        action,
        mockReducer,
        stateWithTask,
      );
    });
  });

  describe('applyShortSyntax action - combined operations', () => {
    it('should handle project move + scheduling atomically', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(['task1'], [], [], []);

      // Add project2 to the state
      const project2 = createMockProject({
        id: 'project2',
        title: 'Project 2',
        taskIds: [],
        backlogTaskIds: [],
      });
      const stateWithProject2 = {
        ...testState,
        [PROJECT_FEATURE_NAME]: {
          ...testState[PROJECT_FEATURE_NAME],
          ids: [...(testState[PROJECT_FEATURE_NAME].ids as string[]), 'project2'],
          entities: {
            ...testState[PROJECT_FEATURE_NAME].entities,
            project2,
          },
        },
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', projectId: 'project1', tagIds: [] });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: { title: 'Updated Title' },
        targetProjectId: 'project2',
        schedulingInfo: { day: todayStr },
      });

      metaReducer(stateWithProject2, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;

      // Verify all changes happened atomically
      // Virtual tag pattern: TODAY should NOT be in task.tagIds
      expect(calledState[TASK_FEATURE_NAME].entities.task1).toEqual(
        jasmine.objectContaining({
          title: 'Updated Title',
          projectId: 'project2',
          dueDay: todayStr,
        }),
      );
      // Verify TODAY is NOT in tagIds (virtual tag pattern)
      expect(calledState[TASK_FEATURE_NAME].entities.task1!.tagIds).not.toContain(
        'TODAY',
      );
      expect(calledState[PROJECT_FEATURE_NAME].entities.project1!.taskIds).toEqual([]);
      expect(calledState[PROJECT_FEATURE_NAME].entities.project2!.taskIds).toEqual([
        'task1',
      ]);
    });

    it('should handle task changes + tag updates atomically', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(['task1'], [], [], []);

      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: ['tag1'],
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', tagIds: ['tag1'] });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          title: 'New Title',
          timeEstimate: 7200000,
          tagIds: ['tag1', 'tag2'],
        },
        schedulingInfo: { day: todayStr },
      });

      metaReducer(stateWithTask, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.title).toBe('New Title');
      expect(updatedTask.timeEstimate).toBe(7200000);
      // Virtual tag pattern: TODAY should NOT be in task.tagIds
      // tagIds from taskChanges are preserved, but TODAY is never added
      expect(updatedTask.tagIds).not.toContain('TODAY');
      expect(updatedTask.tagIds).toEqual(['tag1', 'tag2']);
    });
  });

  // Virtual tag pattern: TODAY_TAG membership is determined by task.dueDay,
  // NOT by task.tagIds. TODAY_TAG.taskIds only stores ordering.
  // See: docs/ai/today-tag-architecture.md
  describe('applyShortSyntax action - virtual tag pattern consistency', () => {
    it('should update tag.taskIds for ordering but NOT task.tagIds when adding to today', () => {
      const todayStr = getDbDateStr();
      const testState = createStateWithExistingTasks(['task1'], [], [], []);

      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', tagIds: [] });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: todayStr },
      });

      metaReducer(stateWithTask, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;

      // Virtual tag pattern: TODAY_TAG.taskIds is updated for ordering,
      // but task.tagIds should NOT contain TODAY
      expect(calledState[TASK_FEATURE_NAME].entities.task1!.tagIds).not.toContain(
        'TODAY',
      );
      expect((calledState as any).tag.entities.TODAY.taskIds as string[]).toContain(
        'task1',
      );
    });

    it('should clean up legacy TODAY in task.tagIds when removing from today', () => {
      const futureDay = '2099-12-31';
      const testState = createStateWithExistingTasks(['task1'], [], [], ['task1']);

      const stateWithTodayTag = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: ['TODAY'],
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', tagIds: ['TODAY'] });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: futureDay },
      });

      metaReducer(stateWithTodayTag, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;

      // Both sides should be updated
      expect(calledState[TASK_FEATURE_NAME].entities.task1!.tagIds).not.toContain(
        'TODAY',
      );
      expect((calledState as any).tag.entities.TODAY.taskIds as string[]).not.toContain(
        'task1',
      );
    });
  });

  describe('applyShortSyntax action - planner integration', () => {
    it('should remove task from planner days when scheduling for today', () => {
      const todayStr = getDbDateStr();
      const futureDay = '2099-12-31';

      // Create state with task in planner for future day
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const stateWithPlanner = {
        ...testState,
        [plannerFeatureKey]: {
          days: {
            [futureDay]: ['task1', 'other-task'],
          },
          addPlannedTasksDialogLastShown: undefined,
        },
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', tagIds: [] });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: todayStr },
      });

      metaReducer(stateWithPlanner, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      expect(
        (calledState[plannerFeatureKey as keyof RootState] as any).days[futureDay],
      ).toEqual(['other-task']);
    });

    it('should move task between planner days', () => {
      const day1 = '2099-12-30';
      const day2 = '2099-12-31';

      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const stateWithPlanner = {
        ...testState,
        [plannerFeatureKey]: {
          days: {
            [day1]: ['task1'],
          },
          addPlannedTasksDialogLastShown: undefined,
        },
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [],
            },
          },
        },
      };

      const task = createMockTask({ id: 'task1', tagIds: [] });
      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {},
        schedulingInfo: { day: day2 },
      });

      metaReducer(stateWithPlanner, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const plannerState = calledState[plannerFeatureKey as keyof RootState] as any;
      expect(plannerState.days[day1]).toEqual([]);
      expect(plannerState.days[day2]).toContain('task1');
    });
  });

  describe('applyShortSyntax action - timeSpent calculation', () => {
    it('should calculate timeSpent from timeSpentOnDay', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', projectId: 'project1' });
      const today = getDbDateStr();

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          title: 'Updated Title',
          timeSpentOnDay: { [today]: 3600000 }, // 1 hour
        },
      });

      metaReducer(testState, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.timeSpentOnDay[today]).toBe(3600000);
      expect(updatedTask.timeSpent).toBe(3600000);
    });

    it('should merge timeSpentOnDay with existing values and recalculate timeSpent', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const yesterday = '2023-12-05';
      const today = getDbDateStr();

      // Set up task with existing timeSpentOnDay
      const stateWithExistingTime = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              timeSpentOnDay: { [yesterday]: 1800000 }, // 30 min from yesterday
              timeSpent: 1800000,
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({
        id: 'task1',
        projectId: 'project1',
        timeSpentOnDay: { [yesterday]: 1800000 },
        timeSpent: 1800000,
      });

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          timeSpentOnDay: { [today]: 3600000 }, // Add 1 hour today
        },
      });

      metaReducer(stateWithExistingTime, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      // Should have both days' time
      expect(updatedTask.timeSpentOnDay[yesterday]).toBe(1800000);
      expect(updatedTask.timeSpentOnDay[today]).toBe(3600000);
      // Total should be sum of both days
      expect(updatedTask.timeSpent).toBe(5400000); // 1.5 hours total
    });

    it('should update parent task timeSpent when subtask time is set', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const today = getDbDateStr();

      // Create parent-subtask relationship
      const stateWithSubtask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          ids: ['parent1', 'subtask1'],
          entities: {
            parent1: {
              ...createMockTask({ id: 'parent1' }),
              subTaskIds: ['subtask1'],
              timeSpentOnDay: {},
              timeSpent: 0,
            } as Task,
            subtask1: {
              ...createMockTask({ id: 'subtask1' }),
              parentId: 'parent1',
              subTaskIds: [],
              timeSpentOnDay: {},
              timeSpent: 0,
            } as Task,
          },
        },
      } as RootState;

      const subtask = createMockTask({
        id: 'subtask1',
        parentId: 'parent1',
      });

      const action = TaskSharedActions.applyShortSyntax({
        task: subtask,
        taskChanges: {
          timeSpentOnDay: { [today]: 3600000 }, // 1 hour
        },
      });

      metaReducer(stateWithSubtask, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedSubtask = calledState[TASK_FEATURE_NAME].entities.subtask1 as Task;
      const updatedParent = calledState[TASK_FEATURE_NAME].entities.parent1 as Task;

      // Subtask should have the time
      expect(updatedSubtask.timeSpentOnDay[today]).toBe(3600000);
      expect(updatedSubtask.timeSpent).toBe(3600000);

      // Parent should aggregate subtask time
      expect(updatedParent.timeSpentOnDay[today]).toBe(3600000);
      expect(updatedParent.timeSpent).toBe(3600000);
    });

    it('should handle timeSpentOnDay with other task changes', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', projectId: 'project1' });
      const today = getDbDateStr();

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          title: 'Updated Title',
          timeEstimate: 7200000, // 2 hours estimate
          timeSpentOnDay: { [today]: 3600000 }, // 1 hour spent
        },
      });

      metaReducer(testState, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.title).toBe('Updated Title');
      expect(updatedTask.timeEstimate).toBe(7200000);
      expect(updatedTask.timeSpentOnDay[today]).toBe(3600000);
      expect(updatedTask.timeSpent).toBe(3600000);
    });

    it('should handle timeSpentOnDay with scheduling', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const today = getDbDateStr();

      const stateWithTask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              tagIds: [] as string[],
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({ id: 'task1', projectId: 'project1', tagIds: [] });

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          title: 'Scheduled task',
          timeSpentOnDay: { [today]: 1800000 }, // 30 min
        },
        schedulingInfo: { day: today },
      });

      metaReducer(stateWithTask, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.title).toBe('Scheduled task');
      expect(updatedTask.timeSpentOnDay[today]).toBe(1800000);
      expect(updatedTask.timeSpent).toBe(1800000);
      expect(updatedTask.dueDay).toBe(today);
    });

    it('should overwrite timeSpentOnDay for same day and recalculate total', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const today = getDbDateStr();

      // Set up task with existing timeSpentOnDay for today
      const stateWithExistingTime = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          entities: {
            ...testState[TASK_FEATURE_NAME].entities,
            task1: {
              ...testState[TASK_FEATURE_NAME].entities.task1,
              timeSpentOnDay: { [today]: 1800000 }, // 30 min existing
              timeSpent: 1800000,
            } as Task,
          },
        },
      } as RootState;

      const task = createMockTask({
        id: 'task1',
        projectId: 'project1',
        timeSpentOnDay: { [today]: 1800000 },
        timeSpent: 1800000,
      });

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          timeSpentOnDay: { [today]: 7200000 }, // Overwrite with 2 hours
        },
      });

      metaReducer(stateWithExistingTime, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      // Should overwrite, not add
      expect(updatedTask.timeSpentOnDay[today]).toBe(7200000);
      expect(updatedTask.timeSpent).toBe(7200000);
    });

    it('should handle empty timeSpentOnDay gracefully', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);
      const task = createMockTask({ id: 'task1', projectId: 'project1' });

      const action = TaskSharedActions.applyShortSyntax({
        task,
        taskChanges: {
          title: 'Updated Title',
          // No timeSpentOnDay - should not affect existing values
        },
      });

      metaReducer(testState, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedTask = calledState[TASK_FEATURE_NAME].entities.task1 as Task;

      expect(updatedTask.title).toBe('Updated Title');
      // timeSpent should remain unchanged (default 0)
      expect(updatedTask.timeSpent).toBe(0);
    });

    it('should update parent task timeEstimate when subtask estimate is set', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);

      // Create parent-subtask relationship
      const stateWithSubtask = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          ids: ['parent1', 'subtask1'],
          entities: {
            parent1: {
              ...createMockTask({ id: 'parent1' }),
              subTaskIds: ['subtask1'],
              timeEstimate: 0,
              timeSpent: 0,
            } as Task,
            subtask1: {
              ...createMockTask({ id: 'subtask1' }),
              parentId: 'parent1',
              subTaskIds: [],
              timeEstimate: 0,
              timeSpent: 0,
              isDone: false,
            } as Task,
          },
        },
      } as RootState;

      const subtask = createMockTask({
        id: 'subtask1',
        parentId: 'parent1',
      });

      const action = TaskSharedActions.applyShortSyntax({
        task: subtask,
        taskChanges: {
          timeEstimate: 7200000, // 2 hours
        },
      });

      metaReducer(stateWithSubtask, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedSubtask = calledState[TASK_FEATURE_NAME].entities.subtask1 as Task;
      const updatedParent = calledState[TASK_FEATURE_NAME].entities.parent1 as Task;

      // Subtask should have the estimate
      expect(updatedSubtask.timeEstimate).toBe(7200000);

      // Parent should have aggregated estimate (remaining = estimate - timeSpent)
      expect(updatedParent.timeEstimate).toBe(7200000);
    });

    it('should calculate parent timeEstimate as remaining time across subtasks', () => {
      const testState = createStateWithExistingTasks(['task1'], [], [], []);

      // Create parent with two subtasks, one partially done
      const stateWithSubtasks = {
        ...testState,
        [TASK_FEATURE_NAME]: {
          ...testState[TASK_FEATURE_NAME],
          ids: ['parent1', 'subtask1', 'subtask2'],
          entities: {
            parent1: {
              ...createMockTask({ id: 'parent1' }),
              subTaskIds: ['subtask1', 'subtask2'],
              timeEstimate: 0,
            } as Task,
            subtask1: {
              ...createMockTask({ id: 'subtask1' }),
              parentId: 'parent1',
              subTaskIds: [],
              timeEstimate: 3600000, // 1 hour estimate
              timeSpent: 1800000, // 30 min spent
              isDone: false,
            } as Task,
            subtask2: {
              ...createMockTask({ id: 'subtask2' }),
              parentId: 'parent1',
              subTaskIds: [],
              timeEstimate: 0,
              timeSpent: 0,
              isDone: false,
            } as Task,
          },
        },
      } as RootState;

      const subtask2 = createMockTask({
        id: 'subtask2',
        parentId: 'parent1',
      });

      const action = TaskSharedActions.applyShortSyntax({
        task: subtask2,
        taskChanges: {
          timeEstimate: 7200000, // 2 hours for subtask2
        },
      });

      metaReducer(stateWithSubtasks, action);

      const calledState = mockReducer.calls.mostRecent().args[0] as RootState;
      const updatedParent = calledState[TASK_FEATURE_NAME].entities.parent1 as Task;

      // Parent estimate = (subtask1 remaining) + (subtask2 remaining)
      // subtask1: max(0, 3600000 - 1800000) = 1800000 (30 min remaining)
      // subtask2: max(0, 7200000 - 0) = 7200000 (2 hours remaining)
      // Total: 9000000 (2.5 hours)
      expect(updatedParent.timeEstimate).toBe(9000000);
    });
  });
});
