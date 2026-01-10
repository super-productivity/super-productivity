import * as fromSelectors from './task.selectors';
import { Task, TaskState } from '../task.model';
import { TASK_FEATURE_NAME } from './task.reducer';
import { TODAY_TAG } from '../../tag/tag.const';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { PROJECT_FEATURE_NAME } from '../../project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../tag/store/tag.reducer';
import { appStateFeatureKey } from '../../../root-store/app-state/app-state.reducer';

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
      tagIds: [TODAY_TAG.id],
      projectId: 'project2',
      timeSpentOnDay: { [today]: 3600 },
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
      ids: ['SOME_TAG_ID'],
      entities: {
        SOME_TAG_ID: {
          id: 'SOME_TAG_ID',
          title: 'Today',
          taskIds: ['task2'],
          isHiddenFromMenu: false,
        },
      },
    },
  };

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
      expect(result.length).toBe(10);
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
      expect(result.length).toBe(10);
    });

    it('should select task by ID with subtask data', () => {
      const result = fromSelectors.selectTaskByIdWithSubTaskData(mockState, {
        id: 'task1',
      });
      expect(result.id).toBe('task1');
      expect(result.subTasks.length).toBe(2);
    });
  });

  // Startable tasks selectors
  describe('Startable tasks selectors', () => {
    it('should select startable tasks', () => {
      const result = fromSelectors.selectStartableTasks(mockState);
      expect(result.length).toBe(7);
    });
  });

  // Overdue tasks selectors
  describe('Overdue tasks selectors', () => {
    it('should select overdue tasks', () => {
      const result = fromSelectors.selectOverdueTasks(mockState);
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task6');
    });

    it('should select all tasks due and overdue', () => {
      const result = fromSelectors.selectAllTasksDueAndOverdue(mockState);
      expect(result.length).toBe(2); // task3 (due today) and task6 (overdue)
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
      expect(result.length).toBe(1);
      expect(result[0].id).toBe('task3');
    });

    it('should select tasks due and overdue for day', () => {
      const allTasks = Object.values(mockTasks);
      const result = fromSelectors.selectTasksDueAndOverdueForDay.projector(allTasks, {
        day: today,
      });
      expect(result.map((r) => r.id)).toEqual(['task3', 'task6']); // task3 (today), task6 (yesterday)
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
      expect(result.length).toBe(7); // All main tasks except task2
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

    it('should select tasks worked on or done for a day', () => {
      const result = fromSelectors.selectTasksWorkedOnOrDoneFlat(mockState, {
        day: today,
      });
      expect(result?.length).toBe(2); // task2 (done and worked on) and subtask2 (done)
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

  // Project-related selectors
  describe('Project-related selectors', () => {
    it('should select all tasks without hidden projects', () => {
      const result = fromSelectors.selectAllTasksWithoutHiddenProjects(mockState);
      // All tasks should still be returned since none belong to hidden project3
      expect(result.length).toBe(10);
    });
  });
});
