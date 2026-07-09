import * as fromSelectors from './task.selectors';
import { DEFAULT_TASK, Task, TaskState } from '../task.model';
import { TASK_FEATURE_NAME } from './task.reducer';
import { taskAdapter } from './task.adapter';
import { TODAY_TAG } from '../../tag/tag.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { PROJECT_FEATURE_NAME } from '../../project/store/project.reducer';
import {
  selectAllProjects,
  selectArchivedProjectIds,
  selectArchivedProjects,
  selectArrayOfArchivedProjectIds,
  selectProjectFeatureState,
} from '../../project/store/project.selectors';
import { TAG_FEATURE_NAME } from '../../tag/store/tag.reducer';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';
import {
  selectStartOfNextDayDiffMs,
  selectTodayStr,
} from '../../../root-store/app-state/app-state.selectors';

describe('Task Selectors', () => {
  // Define mock tasks
  const today = getDbDateStr();
  const yesterday = getDbDateStr(new Date(Date.now() - 86400000));
  const tomorrow = getDbDateStr(new Date(Date.now() + 86400000));

  const mockTasks: { [id: string]: Task } = {
    task1: {
      id: 'task1',
      title: 'Task 1',
      created: Date.now(),
      isDone: false,
      subTaskIds: ['subtask1', 'subtask2'],
      tagIds: ['tag1'],
      projectId: 'project1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task2: {
      id: 'task2',
      title: 'Task 2',
      created: Date.now(),
      isDone: true,
      subTaskIds: [],
      // Note: TODAY_TAG should NOT be in tagIds (virtual tag pattern)
      // Task is on today list via TODAY_TAG.taskIds for ordering
      tagIds: [],
      projectId: 'project2',
      timeSpentOnDay: { [today]: 3600 },
      dueDay: today, // Virtual tag: membership determined by dueDay
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task3: {
      id: 'task3',
      title: 'Due Today',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      dueDay: today,
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task4: {
      id: 'task4',
      title: 'Due Tomorrow',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      dueDay: tomorrow,
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task5: {
      id: 'task5',
      title: 'Due With Time',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      dueWithTime: Date.now() + 3600000,
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task6: {
      id: 'task6',
      title: 'Overdue',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      dueDay: yesterday,
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task7: {
      id: 'task7',
      title: 'Repeatable Task',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      repeatCfgId: 'repeat1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task8: {
      id: 'task8',
      title: 'Issue Task',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      issueId: 'ISSUE-123',
      issueType: 'ICAL',
      issueProviderId: 'provider1',
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    task9: {
      id: 'task9',
      title: 'Task With Deadline',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      timeSpentOnDay: {},
      deadlineDay: tomorrow,
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    subtask1: {
      id: 'subtask1',
      title: 'Subtask 1',
      created: Date.now(),
      isDone: false,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      parentId: 'task1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
    subtask2: {
      id: 'subtask2',
      title: 'Subtask 2',
      created: Date.now(),
      isDone: true,
      subTaskIds: [],
      tagIds: [],
      projectId: 'project1',
      parentId: 'task1',
      timeSpentOnDay: {},
      timeEstimate: 0,
      timeSpent: 0,
      attachments: [],
    },
  };

  const mockTaskState: TaskState = {
    ids: Object.keys(mockTasks),
    entities: mockTasks,
    currentTaskId: 'task1',
    selectedTaskId: 'task2',
    lastCurrentTaskId: 'task3',
    isDataLoaded: true,
    taskDetailTargetPanel: null,
  };

  const mockState = {
    [appStateFeatureKey]: {
      todayStr: today,
      startOfNextDayDiffMs: 0,
    },
    [TASK_FEATURE_NAME]: mockTaskState,
    [PROJECT_FEATURE_NAME]: {
      ids: ['project1', 'project2', 'project3'],
      entities: {
        project1: { id: 'project1', title: 'Project 1', isHiddenFromMenu: false },
        project2: { id: 'project2', title: 'Project 2', isHiddenFromMenu: false },
        project3: { id: 'project3', title: 'Project 3', isHiddenFromMenu: true },
      },
    },
    [TAG_FEATURE_NAME]: {
      ids: [TODAY_TAG.id],
      entities: {
        [TODAY_TAG.id]: {
          id: TODAY_TAG.id,
          title: 'Today',
          taskIds: ['task2'],
          isHiddenFromMenu: false,
        },
      },
    },
  };

  beforeEach(() => {
    // Clear any overrideResult set by MockStore.overrideSelector in other spec files
    // (e.g., provideMockStore). overrideSelector calls setResult() which persists
    // across tests and is NOT cleared by release() — only clearResult() clears it.
    fromSelectors.selectTaskFeatureState.clearResult();
    fromSelectors.selectTaskById.clearResult();
    fromSelectors.selectAllTasksWithSubTasks.clearResult();
    fromSelectors.selectAllRepeatableTaskWithSubTasks.clearResult();
    fromSelectors.selectTaskByIdWithSubTaskData.clearResult();
    fromSelectors.selectOverdueTasksWithSubTasks.clearResult();
    fromSelectors.selectLaterTodayTasksWithSubTasks.clearResult();
    fromSelectors.selectAllTasks.clearResult();
    fromSelectors.selectAllTasksInActiveProjects.clearResult();
    fromSelectors.selectOverdueTasks.clearResult();
    // dialog-schedule-task.* and time-block-sync.effects specs overrideSelector
    // selectAllTasksWithDueTimeSorted (setResult persists across files), which
    // would leak into selectAllTasksWithDueTimeSorted(mockState) here.
    fromSelectors.selectAllTasksWithDueTimeSorted.clearResult();
    // work-view.component.spec overrides these via overrideSelector (setResult);
    // selectOverdueTasks reads them, so the leaked "today"/offset must be cleared too.
    selectTodayStr.clearResult();
    selectStartOfNextDayDiffMs.clearResult();
    selectProjectFeatureState.clearResult();
    selectAllProjects.clearResult();
    selectArchivedProjects.clearResult();
    selectArrayOfArchivedProjectIds.clearResult();
    selectArchivedProjectIds.clearResult();
    fromSelectors.selectTaskFeatureState.release();
    fromSelectors.selectTaskById.release();
    fromSelectors.selectAllTasksWithSubTasks.release();
    fromSelectors.selectAllRepeatableTaskWithSubTasks.release();
    fromSelectors.selectTaskByIdWithSubTaskData.release();
    fromSelectors.selectOverdueTasksWithSubTasks.release();
    fromSelectors.selectLaterTodayTasksWithSubTasks.release();
    fromSelectors.selectAllTasks.release();
    fromSelectors.selectAllTasksInActiveProjects.release();
    fromSelectors.selectOverdueTasks.release();
    fromSelectors.selectAllTasksWithDueTimeSorted.release();
    selectTodayStr.release();
    selectStartOfNextDayDiffMs.release();
    selectProjectFeatureState.release();
    selectAllProjects.release();
    selectArchivedProjects.release();
    selectArrayOfArchivedProjectIds.release();
    selectArchivedProjectIds.release();
  });

  // Basic selectors
  describe('Basic selectors', () => {
    it('should select task feature state', () => {
      const result = fromSelectors.selectTaskFeatureState(mockState);
      expect(result).toBe(mockTaskState);
    });

    it('should select task entities', () => {
      const result = fromSelectors.selectTaskEntities(mockState);
      expect(result).toBe(mockTaskState.entities);
    });

    it('should select current task ID', () => {
      const result = fromSelectors.selectCurrentTaskId(mockState);
      expect(result).toBe('task1');
    });

    it('should select if task data is loaded', () => {
      const result = fromSelectors.selectIsTaskDataLoaded(mockState);
      expect(result).toBe(true);
    });

    it('should select current task', () => {
      const result = fromSelectors.selectCurrentTask(mockState);
      expect(result).toEqual(mockTasks.task1);
    });

    it('should select last current task', () => {
      const result = fromSelectors.selectLastCurrentTask(mockState);
      expect(result).toEqual(mockTasks.task3);
    });

    it('should select all tasks', () => {
      const result = fromSelectors.selectAllTasks(mockState);
      expect(result.length).toBe(11);
    });
  });

  // Task with subtasks selectors
  describe('Task with subtasks selectors', () => {
    it('should select current task with subtasks data', () => {
      const result = fromSelectors.selectCurrentTaskOrParentWithData(mockState);
      expect(result?.id).toBe('task1');
      expect(result?.subTasks.length).toBe(2);
    });

    it('should map subtasks to tasks', () => {
      const result = fromSelectors.selectAllTasksWithSubTasks(mockState);
      const task1 = result.find((t) => t.id === 'task1');
      expect(task1?.subTasks.length).toBe(2);
      expect(task1?.subTasks[0].id).toBe('subtask1');
    });

    it('should flatten tasks', () => {
      const tasksWithSubTasks = fromSelectors.selectAllTasksWithSubTasks(mockState);
      const result = fromSelectors.flattenTasks(tasksWithSubTasks);
      expect(result.length).toBe(11);
    });

    it('should select task by ID with subtask data', () => {
      const result = fromSelectors.selectTaskByIdWithSubTaskData(mockState, {
        id: 'task1',
      });
      expect(result.id).toBe('task1');
      expect(result.subTasks.length).toBe(2);
    });
  });

  describe('selectAllTasksInActiveProjects', () => {
    it('should return all tasks when no archived projects (fast path)', () => {
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectAllTasksInActiveProjects.projector(
        allTasks,
        new Set<string>(),
      );
      expect(result).toBe(allTasks);
    });

    it('should exclude tasks belonging to archived project', () => {
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectAllTasksInActiveProjects.projector(
        allTasks,
        new Set<string>(['project1']),
      );
      expect(result.every((t) => t.projectId !== 'project1')).toBe(true);
    });

    it('should keep tasks from non-archived projects', () => {
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectAllTasksInActiveProjects.projector(
        allTasks,
        new Set<string>(['project2']),
      );
      expect(result.some((t) => t.projectId === 'project1')).toBe(true);
      expect(result.every((t) => t.projectId !== 'project2')).toBe(true);
    });

    it('should return identity reference when archivedIds is empty (fast path)', () => {
      const allTasks = Object.values(mockTasks);
      const emptySet = new Set<string>();
      const result = fromSelectors.selectAllTasksInActiveProjects.projector(
        allTasks,
        emptySet,
      );
      // Same reference — no copy, no filter
      expect(result).toBe(allTasks);
    });
  });

  // Startable tasks selectors
  describe('Startable tasks selectors', () => {
    it('should select startable tasks', () => {
      const result = fromSelectors.selectStartableTasks(mockState);
      expect(result.length).toBe(8);
    });
  });

  // Overdue tasks selectors
  describe('Overdue tasks selectors', () => {
    it('should select overdue tasks', () => {
      const result = fromSelectors.selectOverdueTasks(mockState);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task6');
    });

    it('should select undone overdue tasks', () => {
      const result = fromSelectors.selectUndoneOverdue(mockState);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task6');
    });

    it('selectOverdueTasksWithSubTasks should include overdue tasks regardless of TODAY_TAG.taskIds', () => {
      // This tests the virtual TODAY_TAG architecture:
      // Overdue tasks (dueDay < today) should ALWAYS be shown, even if their ID
      // is in TODAY_TAG.taskIds (which may contain stale data)
      const stateWithOverdueInTodayTag = {
        ...mockState,
        [TAG_FEATURE_NAME]: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: {
              id: TODAY_TAG.id,
              title: 'Today',
              // task6 is overdue but its ID is in TODAY_TAG.taskIds (stale data)
              taskIds: ['task2', 'task6'],
              isHiddenFromMenu: false,
            },
          },
        },
      };

      const result = fromSelectors.selectOverdueTasksWithSubTasks(
        stateWithOverdueInTodayTag,
      );
      // task6 should still be shown as overdue
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task6');
    });

    it('selectOverdueTasksWithSubTasks should exclude done tasks', () => {
      const doneOverdueTask: Task = {
        id: 'doneOverdue',
        title: 'Done Overdue',
        created: Date.now(),
        isDone: true, // Done
        subTaskIds: [],
        tagIds: [],
        projectId: 'project1',
        timeSpentOnDay: {},
        dueDay: yesterday, // Overdue
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };

      const stateWithDoneOverdue = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: [...mockTaskState.ids, 'doneOverdue'],
          entities: {
            ...mockTaskState.entities,
            doneOverdue: doneOverdueTask,
          },
        },
      };

      const result = fromSelectors.selectOverdueTasksWithSubTasks(stateWithDoneOverdue);
      // Only task6 (undone overdue) should be shown
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task6');
    });

    it('selectOverdueTasksWithSubTasks should not show subtasks if parent is also overdue', () => {
      const overdueParent: Task = {
        id: 'overdueParent',
        title: 'Overdue Parent',
        created: Date.now(),
        isDone: false,
        subTaskIds: ['overdueSubtask'],
        tagIds: [],
        projectId: 'project1',
        timeSpentOnDay: {},
        dueDay: yesterday,
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };

      const overdueSubtask: Task = {
        id: 'overdueSubtask',
        title: 'Overdue Subtask',
        created: Date.now(),
        isDone: false,
        subTaskIds: [],
        tagIds: [],
        projectId: 'project1',
        parentId: 'overdueParent',
        timeSpentOnDay: {},
        dueDay: yesterday,
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };

      const stateWithOverdueHierarchy = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: [...mockTaskState.ids, 'overdueParent', 'overdueSubtask'],
          entities: {
            ...mockTaskState.entities,
            overdueParent,
            overdueSubtask,
          },
        },
      };

      const result = fromSelectors.selectOverdueTasksWithSubTasks(
        stateWithOverdueHierarchy,
      );
      // Should show task6 and overdueParent (with subtask mapped), but NOT overdueSubtask as top-level
      const ids = result.map((t) => t.id);
      expect(ids).toContain('task6');
      expect(ids).toContain('overdueParent');
      expect(ids).not.toContain('overdueSubtask');
      // overdueParent should have its subtask mapped
      const parent = result.find((t) => t.id === 'overdueParent');
      expect(parent?.subTasks.length).toBe(1);
      expect(parent?.subTasks[0].id).toBe('overdueSubtask');
    });

    it('selectOverdueTasksWithSubTasks should sort by due date chronologically', () => {
      const twoDaysMs = 2 * 86400000;
      const twoDaysAgo = getDbDateStr(new Date(Date.now() - twoDaysMs));

      const olderOverdue: Task = {
        id: 'olderOverdue',
        title: 'Older Overdue',
        created: Date.now(),
        isDone: false,
        subTaskIds: [],
        tagIds: [],
        projectId: 'project1',
        timeSpentOnDay: {},
        dueDay: twoDaysAgo, // Older than task6 (yesterday)
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };

      const stateWithMultipleOverdue = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: [...mockTaskState.ids, 'olderOverdue'],
          entities: {
            ...mockTaskState.entities,
            olderOverdue,
          },
        },
      };

      const result = fromSelectors.selectOverdueTasksWithSubTasks(
        stateWithMultipleOverdue,
      );
      expect(result.length).toBe(2);
      // Older overdue should come first (chronological order)
      expect(result[0].id).toBe('olderOverdue');
      expect(result[1].id).toBe('task6');
    });

    it('selectOverdueTasksWithSubTasks should keep a stable order for calendar-invalid dueDay values', () => {
      const twoDaysMs = 2 * 86400000;
      const twoDaysAgo = getDbDateStr(new Date(Date.now() - twoDaysMs));

      // Passes the lexical isDBDateStr guard but parses to Invalid Date (NaN)
      const invalidDueDay: Task = {
        id: 'invalidDueDay',
        title: 'Invalid Due Day',
        created: Date.now(),
        isDone: false,
        subTaskIds: [],
        tagIds: [],
        projectId: 'project1',
        timeSpentOnDay: {},
        dueDay: '2024-02-30',
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };
      const olderOverdue: Task = {
        ...invalidDueDay,
        id: 'olderOverdue',
        title: 'Older Overdue',
        dueDay: twoDaysAgo,
      };

      const stateWithInvalidDueDay = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: [...mockTaskState.ids, 'invalidDueDay', 'olderOverdue'],
          entities: {
            ...mockTaskState.entities,
            invalidDueDay,
            olderOverdue,
          },
        },
      };

      // the invalid date string triggers devError, which throws when the globally
      // mocked confirm() returns true (see src/test.ts) — opt out for this test
      const confirmSpy = window.confirm as unknown as jasmine.Spy;
      confirmSpy.and.returnValue(false);
      try {
        const result =
          fromSelectors.selectOverdueTasksWithSubTasks(stateWithInvalidDueDay);
        expect(result.length).toBe(3);
        // NaN-parsing dueDay is pinned to the front; valid tasks stay chronological
        expect(result[0].id).toBe('invalidDueDay');
        expect(result[1].id).toBe('olderOverdue');
        expect(result[2].id).toBe('task6');
      } finally {
        confirmSpy.and.returnValue(true);
      }
    });
    describe('selectOverdueTasks with startOfNextDayDiffMs offset', () => {
      const FOUR_HOURS = 4 * 3600 * 1000;

      // Helper to create a date at a specific hour/minute on a given day string
      const makeTime = (dayStr: string, hours: number, minutes = 0): number => {
        const d = new Date(dayStr + 'T00:00:00');
        d.setHours(hours, minutes, 0, 0);
        return d.getTime();
      };

      it('should NOT consider a task overdue if dueWithTime is within offset-adjusted today', () => {
        // With 4h offset and todayStr='2026-02-15', "today" runs from Feb 15 4AM to Feb 16 4AM
        // A task at Feb 15 5AM is within today => not overdue
        const stateWithOffset = {
          ...mockState,
          [appStateFeatureKey]: {
            todayStr: '2026-02-15',
            startOfNextDayDiffMs: FOUR_HOURS,
          },
          [TASK_FEATURE_NAME]: taskAdapter.setAll(
            [
              {
                ...DEFAULT_TASK,
                id: 'timeTask1',
                dueWithTime: makeTime('2026-02-15', 5),
              } as Task,
            ],
            taskAdapter.getInitialState(),
          ),
        };
        const result = fromSelectors.selectOverdueTasks(stateWithOffset as any);
        expect(result.length).toBe(0);
      });

      it('should consider a task overdue if dueWithTime is before offset-adjusted today start', () => {
        // With 4h offset and todayStr='2026-02-15', today starts at Feb 15 4AM
        // A task at Feb 15 3:59AM is before today start => overdue
        const stateWithOffset = {
          ...mockState,
          [appStateFeatureKey]: {
            todayStr: '2026-02-15',
            startOfNextDayDiffMs: FOUR_HOURS,
          },
          [TASK_FEATURE_NAME]: taskAdapter.setAll(
            [
              {
                ...DEFAULT_TASK,
                id: 'timeTask2',
                dueWithTime: makeTime('2026-02-15', 3, 59),
              } as Task,
            ],
            taskAdapter.getInitialState(),
          ),
        };
        const result = fromSelectors.selectOverdueTasks(stateWithOffset as any);
        expect(result.length).toBe(1);
        expect(result[0].id).toBe('timeTask2');
      });

      it('should handle exact boundary: task at exactly todayStart is NOT overdue', () => {
        // A task at exactly Feb 15 4:00AM (= todayStart) is NOT overdue
        const stateWithOffset = {
          ...mockState,
          [appStateFeatureKey]: {
            todayStr: '2026-02-15',
            startOfNextDayDiffMs: FOUR_HOURS,
          },
          [TASK_FEATURE_NAME]: taskAdapter.setAll(
            [
              {
                ...DEFAULT_TASK,
                id: 'timeTask3',
                dueWithTime: makeTime('2026-02-15', 4),
              } as Task,
            ],
            taskAdapter.getInitialState(),
          ),
        };
        const result = fromSelectors.selectOverdueTasks(stateWithOffset as any);
        expect(result.length).toBe(0);
      });
    });
  });

  // Due date and time selectors
  describe('Due date and time selectors', () => {
    it('should select tasks due for day', () => {
      // For parameterized selectors, projector expects (result1, result2, props)
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectTasksDueForDay.projector(allTasks, {
        day: today,
      });
      // Both task2 and task3 have dueDay: today
      expect(result.length).toBe(2);
      expect(result.map((r) => r.id)).toEqual(
        jasmine.arrayContaining(['task2', 'task3']),
      );
    });

    it('should select tasks due and overdue for day', () => {
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectTasksDueAndOverdueForDay.projector(allTasks, {
        day: today,
      });
      // task2 (today), task3 (today), task6 (yesterday - overdue)
      expect(result.map((r) => r.id)).toEqual(
        jasmine.arrayContaining(['task2', 'task3', 'task6']),
      );
    });

    it('should select tasks with due time for range', () => {
      const start = Date.now();
      const end = Date.now() + 7200000; // 2 hours
      const allTasks = Object.values(mockTasks);
      const params = { start, end };
      const result = fromSelectors.selectTasksWithDueTimeForRange.projector(
        allTasks,
        params,
      );
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task5');
    });

    it('should select tasks with due time until', () => {
      const end = Date.now() + 7200000; // 2 hours
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectTasksWithDueTimeUntil.projector(allTasks, {
        end,
      });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task5');
    });
  });

  // Selected task selectors
  describe('Selected task selectors', () => {
    it('should select selected task ID', () => {
      const result = fromSelectors.selectSelectedTaskId(mockState);
      expect(result).toBe('task2');
    });

    it('should select task detail target panel', () => {
      const result = fromSelectors.selectTaskDetailTargetPanel(mockState);
      expect(result).toBe(null);
    });

    it('should select selected task', () => {
      const result = fromSelectors.selectSelectedTask(mockState);
      expect(result?.id).toBe('task2');
    });
  });

  // Dynamic selectors
  describe('Dynamic selectors', () => {
    it('should select task by ID', () => {
      const result = fromSelectors.selectTaskById(mockState, { id: 'task4' });
      expect(result).toEqual(mockTasks.task4);
    });

    it('should select task by issue ID', () => {
      const result = fromSelectors.selectTaskByIssueId(mockState, {
        issueId: 'ISSUE-123',
      });
      expect(result?.id).toBe('task8');
    });

    it('should select tasks by IDs', () => {
      const result = fromSelectors.selectTasksById(mockState, {
        ids: ['task1', 'task3'],
      });
      expect(result.length).toBe(2);
      expect(result[0].id).toBe('task1');
      expect(result[1].id).toBe('task3');
    });

    it('should select tasks with subtasks by IDs', () => {
      const result = fromSelectors.selectTasksWithSubTasksByIds(mockState, {
        ids: ['task1'],
      });
      expect(result.length).toBe(1);
      expect(result[0].subTasks.length).toBe(2);
    });

    it('should select main tasks without tag', () => {
      const result = fromSelectors.selectMainTasksWithoutTag(mockState, {
        tagId: TODAY_TAG.id,
      });
      // Virtual tag pattern: TODAY_TAG not in task.tagIds, so all 8 main tasks are returned
      expect(result.length).toBe(9);
    });

    it('should select all calendar task event IDs', () => {
      const result = fromSelectors.selectAllCalendarTaskEventIds(mockState);
      expect(result.length).toBe(1);
      expect(result[0]).toBe('ISSUE-123');
    });

    it('should select all calendar issue tasks', () => {
      const result = fromSelectors.selectAllCalendarIssueTasks(mockState);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task8');
      expect(result[0].issueType).toBe('ICAL');
    });

    it('should select all calendar issue tasks from multiple projects', () => {
      // Create a state with multiple calendar tasks across different projects
      const multiCalendarTasks: { [id: string]: Task } = {
        ...mockTasks,
        calTask1: {
          id: 'calTask1',
          title: 'Calendar Task 1',
          created: Date.now(),
          isDone: false,
          subTaskIds: [],
          tagIds: [],
          projectId: 'project1',
          timeSpentOnDay: {},
          issueId: 'CAL-001',
          issueType: 'ICAL',
          issueProviderId: 'cal-provider-1',
          timeEstimate: 3600000,
          timeSpent: 0,
          attachments: [],
        },
        calTask2: {
          id: 'calTask2',
          title: 'Calendar Task 2',
          created: Date.now(),
          isDone: false,
          subTaskIds: [],
          tagIds: [],
          projectId: 'project2', // Different project
          timeSpentOnDay: {},
          issueId: 'CAL-002',
          issueType: 'ICAL',
          issueProviderId: 'cal-provider-1',
          timeEstimate: 1800000,
          timeSpent: 0,
          attachments: [],
        },
        calTask3: {
          id: 'calTask3',
          title: 'Calendar Task 3',
          created: Date.now(),
          isDone: false,
          subTaskIds: [],
          tagIds: [],
          projectId: 'project3', // Third project (hidden)
          timeSpentOnDay: {},
          issueId: 'CAL-003',
          issueType: 'ICAL',
          issueProviderId: 'cal-provider-2', // Different provider
          timeEstimate: 7200000,
          timeSpent: 0,
          attachments: [],
        },
      };

      const multiCalendarState = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: Object.keys(multiCalendarTasks),
          entities: multiCalendarTasks,
        },
      };

      const result = fromSelectors.selectAllCalendarIssueTasks(multiCalendarState);
      // Should return all 4 ICAL tasks (task8 + 3 new ones)
      expect(result.length).toBe(4);
      // All should have issueType ICAL
      expect(result.every((t) => t.issueType === 'ICAL')).toBe(true);
      // Should include tasks from all projects
      const projectIds = result.map((t) => t.projectId);
      expect(projectIds).toContain('project1');
      expect(projectIds).toContain('project2');
      expect(projectIds).toContain('project3');
    });
  });

  // Repeatable task selectors
  describe('Repeatable task selectors', () => {
    it('should select all repeatable tasks with subtasks', () => {
      const result = fromSelectors.selectAllRepeatableTaskWithSubTasks(mockState);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task7');
    });

    it('should select tasks by repeat config ID', () => {
      const result = fromSelectors.selectTasksByRepeatConfigId(mockState, {
        repeatCfgId: 'repeat1',
      });
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task7');
    });
  });

  // Performance-optimized selectors (Set-based lookups)
  describe('Set-based lookup optimizations', () => {
    it('selectOverdueTasksOnToday should correctly filter with Set lookup', () => {
      // Create state with overdue task that IS on today list
      // Note: Task is overdue (dueDay = yesterday) but displayed on today via TODAY_TAG.taskIds
      // TODAY_TAG should NOT be in tagIds (virtual tag pattern)
      const overdueOnTodayTask: Task = {
        id: 'overdueOnToday',
        title: 'Overdue on Today',
        created: Date.now(),
        isDone: false,
        subTaskIds: [],
        tagIds: [], // Virtual tag: TODAY should not be in tagIds
        projectId: 'project1',
        timeSpentOnDay: {},
        dueDay: yesterday, // Overdue because dueDay is in the past
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };

      const stateWithOverdueOnToday = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: [...mockTaskState.ids, 'overdueOnToday'],
          entities: {
            ...mockTaskState.entities,
            overdueOnToday: overdueOnTodayTask,
          },
        },
        [TAG_FEATURE_NAME]: {
          ids: [TODAY_TAG.id],
          entities: {
            [TODAY_TAG.id]: {
              id: TODAY_TAG.id,
              title: 'Today',
              taskIds: ['task2', 'overdueOnToday'],
              isHiddenFromMenu: false,
            },
          },
        },
      };

      const result = fromSelectors.selectOverdueTasksOnToday(stateWithOverdueOnToday);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('overdueOnToday');
    });
  });

  // mapSubTasksToTasks optimization tests
  describe('mapSubTasksToTasks optimization', () => {
    it('should correctly map subtasks to parent tasks using Map lookup', () => {
      const result = fromSelectors.selectAllTasksWithSubTasks(mockState);
      const parentTask = result.find((t) => t.id === 'task1');

      expect(parentTask).toBeDefined();
      expect(parentTask!.subTasks.length).toBe(2);
      expect(parentTask!.subTasks.map((st) => st.id)).toEqual(['subtask1', 'subtask2']);
    });

    it('should handle tasks without subtasks', () => {
      const result = fromSelectors.selectAllTasksWithSubTasks(mockState);
      const taskWithoutSubtasks = result.find((t) => t.id === 'task2');

      expect(taskWithoutSubtasks).toBeDefined();
      expect(taskWithoutSubtasks!.subTasks).toEqual([]);
    });

    it('should not include subtasks as top-level tasks', () => {
      const result = fromSelectors.selectAllTasksWithSubTasks(mockState);
      const subtaskAsParent = result.find((t) => t.id === 'subtask1');

      expect(subtaskAsParent).toBeUndefined();
    });

    it('should handle missing subtask references gracefully', () => {
      // Create a task that references a non-existent subtask
      const badState = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          entities: {
            ...mockTaskState.entities,
            task1: {
              ...mockTasks.task1,
              subTaskIds: ['subtask1', 'nonExistentSubtask', 'subtask2'],
            },
          },
        },
      };

      const result = fromSelectors.selectAllTasksWithSubTasks(badState);
      const parentTask = result.find((t) => t.id === 'task1');

      // Should only include existing subtasks
      expect(parentTask!.subTasks.length).toBe(2);
      expect(parentTask!.subTasks.map((st) => st.id)).toEqual(['subtask1', 'subtask2']);
    });

    it('should handle missing subtask references in selectTaskByIdWithSubTaskData', () => {
      (window.confirm as jasmine.Spy).and.returnValue(false);
      const badState = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          entities: {
            ...mockTaskState.entities,
            task1: {
              ...mockTasks.task1,
              subTaskIds: ['subtask1', 'nonExistentSubtask', 'subtask2'],
            },
          },
        },
      };

      const result = fromSelectors.selectTaskByIdWithSubTaskData(badState, {
        id: 'task1',
      });
      expect(result.subTasks.length).toBe(2);
      expect(result.subTasks.map((st) => st.id)).toEqual(['subtask1', 'subtask2']);
      (window.confirm as jasmine.Spy).and.returnValue(true);
    });
  });

  // SPAP-20: these selectors were split into a snapshot-based decision (ids) +
  // a live-entity re-map, so `.projector(tasks)` no longer applies. Exercise the
  // full public selectors against real state instead (same observable behavior).
  const withArchivedProject1 = (): any => ({
    ...mockState,
    [PROJECT_FEATURE_NAME]: {
      ...mockState[PROJECT_FEATURE_NAME],
      entities: {
        ...mockState[PROJECT_FEATURE_NAME].entities,
        project1: {
          id: 'project1',
          title: 'Project 1',
          isHiddenFromMenu: false,
          isArchived: true,
        },
      },
    },
  });

  describe('selectAllTasksWithDueTimeSorted', () => {
    it('should return only tasks with dueWithTime, sorted ascending', () => {
      const result = fromSelectors.selectAllTasksWithDueTimeSorted(mockState);
      expect(result.map((t) => t.id)).toContain('task5');
      expect(result.every((t) => typeof t.dueWithTime === 'number')).toBe(true);
    });
  });

  describe('selectAllUndoneTasksWithDueDay', () => {
    it('should exclude tasks from archived projects', () => {
      const result = fromSelectors.selectAllUndoneTasksWithDueDay(withArchivedProject1());
      // task3 lives in project1 which is now archived
      expect(result.map((t) => t.id)).not.toContain('task3');
    });

    it('should include tasks when project is not archived', () => {
      const result = fromSelectors.selectAllUndoneTasksWithDueDay(mockState);
      expect(result.map((t) => t.id)).toContain('task3');
    });

    it('should exclude done tasks', () => {
      const result = fromSelectors.selectAllUndoneTasksWithDueDay(mockState);
      expect(result.every((t) => !t.isDone)).toBeTrue();
    });

    it('should sort results by dueDay chronologically', () => {
      const result = fromSelectors.selectAllUndoneTasksWithDueDay(mockState);
      const dueDays = result.map((t) => t.dueDay);
      for (let i = 1; i < dueDays.length; i++) {
        expect(dueDays[i - 1].localeCompare(dueDays[i])).toBeLessThanOrEqual(0);
      }
    });

    it('should include subtasks with dueDay', () => {
      const subtaskWithDueDay: Task = {
        id: 'subtaskWithDue',
        title: 'Subtask with Due',
        created: Date.now(),
        isDone: false,
        subTaskIds: [],
        tagIds: [],
        projectId: 'project1',
        parentId: 'task1',
        timeSpentOnDay: {},
        dueDay: tomorrow,
        timeEstimate: 0,
        timeSpent: 0,
        attachments: [],
      };
      const stateWithSubtask: any = {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          ids: [...mockTaskState.ids, 'subtaskWithDue'],
          entities: { ...mockTaskState.entities, subtaskWithDue: subtaskWithDueDay },
        },
      };
      const result = fromSelectors.selectAllUndoneTasksWithDueDay(stateWithSubtask);
      expect(result.map((t) => t.id)).toContain('subtaskWithDue');
    });
  });

  describe('selectAllUndoneTasksWithDeadlineSorted', () => {
    it('should return only undone tasks with deadline, sorted', () => {
      const result = fromSelectors.selectAllUndoneTasksWithDeadlineSorted(mockState);
      expect(result.map((t) => t.id)).toContain('task9');
      expect(result.every((t) => !t.isDone)).toBe(true);
    });
  });

  it('selectOverdueTasks excludes tasks from archived projects', () => {
    const archivedOverdueTask: Task = {
      ...DEFAULT_TASK,
      id: 'overdueInArchived',
      title: 'Overdue in archived project',
      projectId: 'projectArchived',
      dueDay: yesterday,
      created: Date.now(),
      subTaskIds: [],
      tagIds: [],
      timeSpentOnDay: {},
    };
    const archivedState = {
      ...mockState,
      [TASK_FEATURE_NAME]: {
        ...mockTaskState,
        ids: [...mockTaskState.ids, archivedOverdueTask.id],
        entities: {
          ...mockTaskState.entities,
          [archivedOverdueTask.id]: archivedOverdueTask,
        },
      },
      [PROJECT_FEATURE_NAME]: {
        ...mockState[PROJECT_FEATURE_NAME],
        ids: [...mockState[PROJECT_FEATURE_NAME].ids, 'projectArchived'],
        entities: {
          ...mockState[PROJECT_FEATURE_NAME].entities,
          projectArchived: {
            id: 'projectArchived',
            title: 'Archived Project',
            isHiddenFromMenu: false,
            isArchived: true,
          },
        },
      },
    };
    const ids = fromSelectors.selectOverdueTasks(archivedState as any).map((t) => t.id);
    expect(ids).not.toContain('overdueInArchived');
    expect(ids).toContain('task6');
  });

  // -------------------------------------------------------------------------
  describe('SPAP-19 stable selector factories', () => {
    const makeTask = (id: string, over: Partial<Task> = {}): Task =>
      ({
        ...DEFAULT_TASK,
        id,
        title: id,
        created: 0,
        subTaskIds: [],
        tagIds: [],
        timeSpentOnDay: {},
        ...over,
      }) as Task;

    const makeTaskState = (tasks: Task[]): TaskState => ({
      ids: tasks.map((t) => t.id),
      entities: tasks.reduce(
        (acc, t) => {
          acc[t.id] = t;
          return acc;
        },
        {} as Record<string, Task>,
      ),
      currentTaskId: null,
      selectedTaskId: null,
      lastCurrentTaskId: null,
      isDataLoaded: true,
      taskDetailTargetPanel: null,
    });

    // Selectors only read the TASK feature slice, so a minimal root is enough.
    const wrap = (ts: TaskState): any => ({ [TASK_FEATURE_NAME]: ts });

    describe('selectTasksWithSubTasksByIdsFactory', () => {
      it('returns identical refs for tasks whose entity ref did not change (only C changed)', () => {
        const a = makeTask('A');
        const b = makeTask('B');
        const c = makeTask('C');
        const sel = fromSelectors.selectTasksWithSubTasksByIdsFactory(['A', 'B', 'C']);

        const r1 = sel(wrap(makeTaskState([a, b, c])));
        // Only C's entity ref changes (e.g. a time-tracking tick bumping timeSpent)
        const c2 = { ...c, timeSpent: 999 };
        const r2 = sel(wrap(makeTaskState([a, b, c2])));

        expect(r2[0]).toBe(r1[0]); // A: same object
        expect(r2[1]).toBe(r1[1]); // B: same object
        expect(r2[2]).not.toBe(r1[2]); // C: rebuilt
        expect(r2[2].timeSpent).toBe(999);
      });

      it('rebuilds a parent when only one of its subtask entities changed', () => {
        const p = makeTask('P', { subTaskIds: ['S'] });
        const s = makeTask('S', { parentId: 'P', timeSpent: 0 });
        const sel = fromSelectors.selectTasksWithSubTasksByIdsFactory(['P']);

        const r1 = sel(wrap(makeTaskState([p, s])));
        const s2 = { ...s, timeSpent: 500 };
        const r2 = sel(wrap(makeTaskState([p, s2])));

        expect(r2[0]).not.toBe(r1[0]); // parent rebuilt
        expect(r2[0].subTasks[0]).toBe(s2); // reflects the changed subtask entity
        expect(r2[0].subTasks[0].timeSpent).toBe(500);
      });

      it('keeps two concurrent factory instances independent (no cross-eviction)', () => {
        const a = makeTask('A');
        const b = makeTask('B');
        const c = makeTask('C');
        const d = makeTask('D');
        const selAB = fromSelectors.selectTasksWithSubTasksByIdsFactory(['A', 'B']);
        const selCD = fromSelectors.selectTasksWithSubTasksByIdsFactory(['C', 'D']);

        const ab1 = selAB(wrap(makeTaskState([a, b, c, d])));
        const cd1 = selCD(wrap(makeTaskState([a, b, c, d])));
        // New state objects (same task refs) force the projectors to re-run;
        // each instance's own cache must still return identical results.
        const ab2 = selAB(wrap(makeTaskState([a, b, c, d])));
        const cd2 = selCD(wrap(makeTaskState([a, b, c, d])));

        expect(ab2[0]).toBe(ab1[0]);
        expect(ab2[1]).toBe(ab1[1]);
        expect(cd2[0]).toBe(cd1[0]);
        expect(cd2[1]).toBe(cd1[1]);
      });

      it('produces output deep-equal to the legacy selectTasksWithSubTasksByIds (shape parity)', () => {
        const p = makeTask('P', { subTaskIds: ['S1', 'S2'] });
        const s1 = makeTask('S1', { parentId: 'P' });
        const s2 = makeTask('S2', { parentId: 'P' });
        const state = wrap(makeTaskState([p, s1, s2]));

        const legacy = fromSelectors.selectTasksWithSubTasksByIds(state, {
          ids: ['P'],
        });
        const viaFactory = fromSelectors.selectTasksWithSubTasksByIdsFactory(['P'])(
          state,
        );

        expect(viaFactory).toEqual(legacy);
      });

      it('filters out missing/deleted top-level entities exactly like the legacy selector', () => {
        const a = makeTask('A');
        const state = wrap(makeTaskState([a]));
        const res = fromSelectors.selectTasksWithSubTasksByIdsFactory(['A', 'gone'])(
          state,
        );
        expect(res.length).toBe(1);
        expect(res[0].id).toBe('A');
      });

      // Documents WHY the factory is needed: the legacy module-level props-selector
      // shares ONE memo slot, so interleaving different id-sets forces a full
      // recompute (new refs) — the exact thrash this ticket fixes.
      it('CONTRAST: legacy shared props-selector thrashes across interleaved id-sets', () => {
        const a = makeTask('A');
        const b = makeTask('B');
        const c = makeTask('C');
        const d = makeTask('D');
        const state = wrap(makeTaskState([a, b, c, d]));

        const first1 = fromSelectors.selectTasksWithSubTasksByIds(state, {
          ids: ['A', 'B'],
        });
        // a "different subscriber" reads a different id-set against the same state
        fromSelectors.selectTasksWithSubTasksByIds(state, { ids: ['C', 'D'] });
        const first2 = fromSelectors.selectTasksWithSubTasksByIds(state, {
          ids: ['A', 'B'],
        });

        // Interleaving evicted the memo → recomputed → brand-new object refs
        expect(first2[0]).not.toBe(first1[0]);
      });
    });

    describe('selectTasksByIdFactory', () => {
      it('returns raw entities in order and filters out missing ids', () => {
        const a = makeTask('A');
        const b = makeTask('B');
        const state = wrap(makeTaskState([a, b]));
        const res = fromSelectors.selectTasksByIdFactory(['A', 'gone', 'B'])(state);

        expect(res.length).toBe(2);
        expect(res[0]).toBe(a);
        expect(res[1]).toBe(b);
      });
    });
  });

  // SPAP-20: content-stable scheduling snapshot boundary.
  describe('SPAP-20 scheduling snapshot', () => {
    // Simulate a real "time tracking tick": replace ONLY the ticked task's entity
    // (bump timeSpent), keeping every other task's ref intact.
    const bumpTimeSpent = (taskId: string): any => {
      const prev = mockTaskState.entities[taskId] as Task;
      return {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          entities: {
            ...mockTaskState.entities,
            [taskId]: { ...prev, timeSpent: (prev.timeSpent || 0) + 1000 },
          },
        },
      };
    };
    const patchTask = (taskId: string, patch: Partial<Task>): any => {
      const prev = mockTaskState.entities[taskId] as Task;
      return {
        ...mockState,
        [TASK_FEATURE_NAME]: {
          ...mockTaskState,
          entities: {
            ...mockTaskState.entities,
            [taskId]: { ...prev, ...patch },
          },
        },
      };
    };

    describe('selectTaskSchedulingSnapshot', () => {
      it('returns the IDENTICAL array ref (and element refs) on a timeSpent-only tick', () => {
        const r1 = fromSelectors.selectTaskSchedulingSnapshot(mockState);
        // task3 is a member (due today); its timeSpent bump must not change the snapshot
        const r2 = fromSelectors.selectTaskSchedulingSnapshot(bumpTimeSpent('task3'));
        expect(r2).toBe(r1);
        r1.forEach((el, i) => expect(r2[i]).toBe(el));
      });

      it('returns a NEW array + changed element when a scheduling field (dueDay) changes', () => {
        const r1 = fromSelectors.selectTaskSchedulingSnapshot(mockState);
        const idx = r1.findIndex((s) => s.id === 'task4');
        const r2 = fromSelectors.selectTaskSchedulingSnapshot(
          patchTask('task4', { dueDay: today }),
        );
        expect(r2).not.toBe(r1);
        expect(r2[idx]).not.toBe(r1[idx]);
        expect(r2[idx].dueDay).toBe(today);
      });
    });

    describe('decision selectors skipped on a timeSpent tick (identical output ref)', () => {
      it('selectOverdueTaskIds + selectOverdueTasks are referentially stable', () => {
        const ids1 = fromSelectors.selectOverdueTaskIds(mockState);
        const r1 = fromSelectors.selectOverdueTasks(mockState);
        // task3 is due today (NOT overdue) → not a member of overdue
        const ticked = bumpTimeSpent('task3');
        expect(fromSelectors.selectOverdueTaskIds(ticked)).toBe(ids1);
        expect(fromSelectors.selectOverdueTasks(ticked)).toBe(r1);
      });

      it('selectAllTasksWithDueTimeSorted is referentially stable', () => {
        const r1 = fromSelectors.selectAllTasksWithDueTimeSorted(mockState);
        // task3 has no dueWithTime → not a member
        expect(
          fromSelectors.selectAllTasksWithDueTimeSorted(bumpTimeSpent('task3')),
        ).toBe(r1);
      });

      it('selectTimeConflictTaskIds is stable when a non-due-time task ticks', () => {
        const r1 = fromSelectors.selectTimeConflictTaskIds(mockState);
        expect(fromSelectors.selectTimeConflictTaskIds(bumpTimeSpent('task3'))).toBe(r1);
      });

      it('selectAllUndoneTasksWithDeadlineSorted is referentially stable', () => {
        const r1 = fromSelectors.selectAllUndoneTasksWithDeadlineSorted(mockState);
        // task3 has no deadline → not a member
        expect(
          fromSelectors.selectAllUndoneTasksWithDeadlineSorted(bumpTimeSpent('task3')),
        ).toBe(r1);
      });

      it('selectAllUndoneTasksWithDueDay is referentially stable', () => {
        const r1 = fromSelectors.selectAllUndoneTasksWithDueDay(mockState);
        // bump task5 (dueWithTime, not dueDay) → not a dueDay member
        expect(fromSelectors.selectAllUndoneTasksWithDueDay(bumpTimeSpent('task5'))).toBe(
          r1,
        );
      });
    });

    describe('selectAllTasksWithSubTasks (per-id live re-map)', () => {
      it('keeps unchanged parents identical but updates the ticked member with live data', () => {
        const r1 = fromSelectors.selectAllTasksWithSubTasks(mockState);
        const r2 = fromSelectors.selectAllTasksWithSubTasks(bumpTimeSpent('task3'));
        // task1 (unchanged parent) → exact same object
        expect(r2.find((t) => t.id === 'task1')).toBe(r1.find((t) => t.id === 'task1'));
        // task3 (ticked, top-level) → new object reflecting LIVE timeSpent
        const t3a = r1.find((t) => t.id === 'task3')!;
        const t3b = r2.find((t) => t.id === 'task3')!;
        expect(t3b).not.toBe(t3a);
        expect(t3b.timeSpent).toBe((mockTasks.task3.timeSpent || 0) + 1000);
      });

      it('rebuilds a parent when its subtask ref changes', () => {
        const r1 = fromSelectors.selectAllTasksWithSubTasks(mockState);
        // subtask1's parent is task1 → task1 must get a new object with live subtask
        const r2 = fromSelectors.selectAllTasksWithSubTasks(bumpTimeSpent('subtask1'));
        expect(r2.find((t) => t.id === 'task1')).not.toBe(
          r1.find((t) => t.id === 'task1'),
        );
      });
    });

    describe('recompute + live-ref correctness on a real scheduling change', () => {
      it('selectOverdueTasks recomputes and reflects a newly-overdue task', () => {
        const r1 = fromSelectors.selectOverdueTasks(mockState);
        expect(r1.map((t) => t.id)).not.toContain('task4');
        const r2 = fromSelectors.selectOverdueTasks(
          patchTask('task4', { dueDay: yesterday }),
        );
        expect(r2).not.toBe(r1);
        expect(r2.map((t) => t.id)).toContain('task4');
      });

      it('a member task with a non-scheduling change is served with its LIVE ref', () => {
        // task6 is overdue. Change its title only (not a scheduling field): the
        // decision (ids) is unchanged, but the public selector re-maps live so the
        // returned task6 carries the new title.
        const r2 = fromSelectors.selectOverdueTasks(
          patchTask('task6', { title: 'renamed' }),
        );
        const t6 = r2.find((t) => t.id === 'task6')!;
        expect(t6.title).toBe('renamed');
      });
    });

    describe('shape parity with the pre-refactor logic', () => {
      it('selectAllUndoneTasksWithDueDay returns the expected ids in the expected order', () => {
        const result = fromSelectors.selectAllUndoneTasksWithDueDay(mockState);
        // undone + has dueDay, sorted lexically: task6 (yesterday) < task3 (today) < task4 (tomorrow)
        expect(result.map((t) => t.id)).toEqual(['task6', 'task3', 'task4']);
      });

      it('selectOverdueTasks returns exactly the overdue members', () => {
        const result = fromSelectors.selectOverdueTasks(mockState);
        expect(result.map((t) => t.id)).toEqual(['task6']);
      });
    });
  });
});
