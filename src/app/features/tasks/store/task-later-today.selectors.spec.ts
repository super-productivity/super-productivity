import { selectLaterTodayTasksWithSubTasks } from './task.selectors';
import { Task, TaskState } from '../task.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

describe('selectLaterTodayTasksWithSubTasks', () => {
  const now = new Date();
  const todayStr = getDbDateStr(now); // Virtual tag pattern: use dueDay for TODAY membership
  const tomorrow = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate() + 1,
  ).toISOString();

  // Current time for testing (e.g., 10:00 AM)
  const currentTime = new Date();
  currentTime.setHours(10, 0, 0, 0);
  const currentTimeMs = currentTime.getTime();

  // Helper to create timestamps for today at specific times
  const todayAt = (hours: number, minutes: number = 0): number => {
    const date = new Date(now);
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  };

  // Helper to create TaskState from array of tasks
  const createTaskState = (tasks: Task[]): TaskState => {
    const entities = tasks.reduce((acc, task) => ({ ...acc, [task.id]: task }), {});
    const ids = tasks.map((t) => t.id);
    return {
      entities,
      ids,
      currentTaskId: null,
      selectedTaskId: null,
      lastCurrentTaskId: null,
      taskDetailTargetPanel: 'Default' as any,
      isDataLoaded: true,
    } as TaskState;
  };

  const createMockTask = (overrides: Partial<Task>): Task =>
    ({
      id: 'MOCK_TASK_ID',
      title: 'Mock Task',
      isDone: false,
      tagIds: [],
      parentId: null,
      subTaskIds: [],
      timeSpentOnDay: {},
      timeSpent: 0,
      timeEstimate: 0,
      reminderId: null,
      dueWithTime: null,
      dueDay: null,
      hasPlannedTime: false,
      repeatCfgId: null,
      notes: '',
      issueId: null,
      issueType: null,
      issueWasUpdated: null,
      issueLastUpdated: null,
      issueTimeTracked: null,
      attachments: [],
      projectId: null,
      _showSubTasksMode: 0,
      _currentTab: 0,
      _isTaskPlaceHolder: false,
      ...overrides,
    }) as Task;

  // Virtual tag pattern: Tasks are "in TODAY" because of dueDay, not tagIds
  // TODAY_TAG should NEVER be in task.tagIds
  const mockAllTasks: Task[] = [
    // Task scheduled for later today (2 PM)
    createMockTask({
      id: 'LATER_TODAY_1',
      title: 'Meeting at 2 PM',
      dueWithTime: todayAt(14, 0),
      dueDay: todayStr,
    }),

    // Task scheduled for even later today (6 PM)
    createMockTask({
      id: 'LATER_TODAY_2',
      title: 'Exercise at 6 PM',
      dueWithTime: todayAt(18, 0),
      dueDay: todayStr,
    }),

    // Task scheduled for earlier today (already passed - 8 AM)
    createMockTask({
      id: 'EARLIER_TODAY',
      title: 'Morning standup',
      dueWithTime: todayAt(8, 0),
      dueDay: todayStr,
    }),

    // Task scheduled for tomorrow
    createMockTask({
      id: 'TOMORROW_TASK',
      title: 'Tomorrow task',
      dueWithTime: new Date(tomorrow).setHours(10, 0, 0, 0),
      dueDay: todayStr, // Still in today list even though scheduled for tomorrow
    }),

    // Task in TODAY but without dueWithTime
    createMockTask({
      id: 'UNSCHEDULED_TODAY',
      title: 'Unscheduled today task',
      dueWithTime: undefined,
      dueDay: todayStr,
    }),

    // Task scheduled for later but already done
    createMockTask({
      id: 'DONE_LATER_TODAY',
      title: 'Done task',
      dueWithTime: todayAt(15, 0),
      isDone: true,
      dueDay: todayStr,
    }),

    // Task scheduled for later today via dueWithTime (no dueDay)
    // With the virtual tag pattern, this IS in TODAY because dueWithTime is for today
    createMockTask({
      id: 'VIA_TIME_ONLY',
      title: 'Scheduled via time only',
      dueWithTime: todayAt(16, 0),
      dueDay: null, // No dueDay, but still in TODAY via dueWithTime
    }),

    // Parent task with subtasks
    createMockTask({
      id: 'PARENT_LATER',
      title: 'Parent task for later',
      dueWithTime: todayAt(17, 0),
      dueDay: todayStr,
      subTaskIds: ['SUB_1', 'SUB_2'],
    }),

    // Subtasks
    createMockTask({
      id: 'SUB_1',
      title: 'Subtask 1',
      parentId: 'PARENT_LATER',
      dueDay: todayStr,
    }),

    createMockTask({
      id: 'SUB_2',
      title: 'Subtask 2',
      parentId: 'PARENT_LATER',
      dueDay: todayStr,
    }),
  ];

  beforeEach(() => {
    // Mock current time to be 10 AM for consistent testing
    jasmine.clock().install();
    jasmine.clock().mockDate(currentTime);
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('should select tasks scheduled for later today', () => {
    // Virtual tag pattern: tasks are "in TODAY" because of dueDay or dueWithTime for today
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    // The result includes main tasks and their subtasks (for display purposes)
    // SUB_1 and SUB_2 should NOT appear as top-level items because their parent is included
    // Only scheduled parent tasks appear as top-level items
    expect(taskIds).toContain('LATER_TODAY_1');
    expect(taskIds).toContain('LATER_TODAY_2');
    expect(taskIds).toContain('PARENT_LATER');
    expect(taskIds).toContain('VIA_TIME_ONLY'); // Task with dueWithTime only (no dueDay)
    expect(taskIds).not.toContain('SUB_1');
    expect(taskIds).not.toContain('SUB_2');
    expect(result.length).toBe(4);

    // Verify that PARENT_LATER has its subtasks
    const parentTask = result.find((t) => t.id === 'PARENT_LATER');
    expect(parentTask?.subTasks?.length).toBe(2);
    expect(parentTask?.subTasks?.map((st) => st.id)).toEqual(['SUB_1', 'SUB_2']);
  });

  it('should not include tasks scheduled for earlier today', () => {
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    expect(taskIds).not.toContain('EARLIER_TODAY');
  });

  it('should not include tasks scheduled for tomorrow', () => {
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    expect(taskIds).not.toContain('TOMORROW_TASK');
  });

  it('should not include unscheduled tasks', () => {
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    expect(taskIds).not.toContain('UNSCHEDULED_TODAY');
  });

  it('should not include done tasks', () => {
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    expect(taskIds).not.toContain('DONE_LATER_TODAY');
  });

  it('should only include tasks that are in TODAY (via dueDay or dueWithTime)', () => {
    // Create a task for tomorrow that should NOT be included
    const tomorrowDate = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate() + 1,
    );
    const tomorrowStr = getDbDateStr(tomorrowDate);
    const taskForTomorrow = createMockTask({
      id: 'SCHEDULED_FOR_TOMORROW',
      title: 'Scheduled for tomorrow',
      // Use Date constructor to avoid timezone issues with date string parsing
      dueWithTime: new Date(
        tomorrowDate.getFullYear(),
        tomorrowDate.getMonth(),
        tomorrowDate.getDate(),
        14,
        0,
        0,
      ).getTime(),
      dueDay: tomorrowStr,
    });

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState([...mockAllTasks, taskForTomorrow]),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    expect(taskIds).not.toContain('SCHEDULED_FOR_TOMORROW');
  });

  it('should include parent tasks with all their subtasks (not as separate items)', () => {
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      todayStr,
      0,
    );

    const parentIndex = result.findIndex((t) => t.id === 'PARENT_LATER');
    expect(parentIndex).toBeGreaterThan(-1);

    // Check that subtasks do NOT appear as separate top-level items
    const taskIds = result.map((t) => t.id);
    expect(taskIds).not.toContain('SUB_1');
    expect(taskIds).not.toContain('SUB_2');

    // But they should be available in the parent's subTasks array
    const parentTask = result[parentIndex];
    expect(parentTask.subTasks?.length).toBe(2);
    expect(parentTask.subTasks?.map((st) => st.id)).toEqual(['SUB_1', 'SUB_2']);
  });

  it('should handle edge case of task scheduled exactly at current time', () => {
    const taskAtCurrentTime = createMockTask({
      id: 'CURRENT_TIME_TASK',
      title: 'Task at current time',
      dueWithTime: currentTimeMs,
      dueDay: todayStr,
    });

    const tasksWithCurrent = [...mockAllTasks, taskAtCurrentTime];
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(tasksWithCurrent),
      todayStr,
      0,
    );

    // Task scheduled at exactly current time should be included
    const taskIds = result.map((t) => t.id);
    expect(taskIds).toContain('CURRENT_TIME_TASK');
  });

  it('should handle midnight edge case', () => {
    // Test at 11:59 PM
    const lateTime = new Date(currentTime);
    lateTime.setHours(23, 59, 0, 0);
    jasmine.clock().mockDate(lateTime);

    const taskAtMidnight = createMockTask({
      id: 'MIDNIGHT_TASK',
      title: 'Task at midnight',
      dueWithTime: todayAt(23, 59),
      dueDay: todayStr,
    });

    const tasksWithMidnight = [...mockAllTasks, taskAtMidnight];
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(tasksWithMidnight),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    expect(taskIds).toContain('MIDNIGHT_TASK');
  });

  it('should return empty array when no tasks match criteria', () => {
    const noMatchingTasks: Task[] = [
      createMockTask({
        id: 'PAST_TASK',
        dueWithTime: todayAt(8, 0),
        dueDay: todayStr,
      }),
      createMockTask({
        id: 'TOMORROW_TASK_2',
        dueWithTime: new Date(tomorrow).getTime(),
        dueDay: todayStr,
      }),
    ];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(noMatchingTasks),
      todayStr,
      0,
    );

    expect(result.length).toBe(0);
  });

  it('should return empty array when todayStr is null', () => {
    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockAllTasks),
      null as any,
      0,
    );

    expect(result.length).toBe(0);
  });

  it('should include parent task when only subtask is scheduled for later', () => {
    const parentWithScheduledSubtask = createMockTask({
      id: 'PARENT_UNSCHEDULED',
      title: 'Parent without schedule',
      dueWithTime: undefined,
      dueDay: todayStr,
      subTaskIds: ['SUB_SCHEDULED'],
    });

    const scheduledSubtask = createMockTask({
      id: 'SUB_SCHEDULED',
      title: 'Subtask scheduled for later',
      dueWithTime: todayAt(15, 0),
      parentId: 'PARENT_UNSCHEDULED',
      dueDay: todayStr,
    });

    const mockTasks = [parentWithScheduledSubtask, scheduledSubtask];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Should include parent (because it has scheduled subtask) - not the subtask as separate item
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('PARENT_UNSCHEDULED');
    expect(result[0].subTasks?.length).toBe(1);
    expect(result[0].subTasks?.[0].id).toBe('SUB_SCHEDULED');
  });

  it('should include parent when subtask is scheduled even if parent is not', () => {
    const parentTask = createMockTask({
      id: 'PARENT_NOT_SCHEDULED',
      title: 'Parent not scheduled for later',
      dueWithTime: undefined, // Parent not scheduled
      dueDay: todayStr,
      subTaskIds: ['SUB_SCHEDULED'],
    });

    const scheduledSubtask = createMockTask({
      id: 'SUB_SCHEDULED',
      title: 'Scheduled subtask',
      dueWithTime: todayAt(14, 0), // Subtask is scheduled
      parentId: 'PARENT_NOT_SCHEDULED',
      dueDay: todayStr,
    });

    const mockTasks = [parentTask, scheduledSubtask];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    // Parent SHOULD be included because it has scheduled subtask
    expect(taskIds).toContain('PARENT_NOT_SCHEDULED');
    expect(taskIds).not.toContain('SUB_SCHEDULED');
    expect(result.length).toBe(1);

    // The parent should have the scheduled subtask
    const parentResult = result.find((t) => t.id === 'PARENT_NOT_SCHEDULED');
    expect(parentResult?.subTasks?.length).toBe(1);
    expect(parentResult?.subTasks?.[0].id).toBe('SUB_SCHEDULED');
  });

  it('should sort by earliest scheduled time (parent or subtask)', () => {
    // Parent scheduled at 4 PM with subtask at 2 PM
    const parent1 = createMockTask({
      id: 'PARENT_1',
      title: 'Parent 1',
      dueWithTime: todayAt(16, 0),
      dueDay: todayStr,
      subTaskIds: ['SUB_1_1'],
    });

    const sub1 = createMockTask({
      id: 'SUB_1_1',
      title: 'Subtask 1-1',
      dueWithTime: todayAt(14, 0),
      parentId: 'PARENT_1',
      dueDay: todayStr,
    });

    // Parent unscheduled with subtask at 3 PM
    const parent2 = createMockTask({
      id: 'PARENT_2',
      title: 'Parent 2',
      dueWithTime: undefined,
      dueDay: todayStr,
      subTaskIds: ['SUB_2_1'],
    });

    const sub2 = createMockTask({
      id: 'SUB_2_1',
      title: 'Subtask 2-1',
      dueWithTime: todayAt(15, 0),
      parentId: 'PARENT_2',
      dueDay: todayStr,
    });

    const mockTasks = [parent1, sub1, parent2, sub2];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Should be sorted by earliest time: Parent 1 (has subtask at 2 PM), then Parent 2 (has subtask at 3 PM)
    expect(result.length).toBe(2);
    expect(result[0].id).toBe('PARENT_1'); // Earliest is subtask at 2 PM
    expect(result[1].id).toBe('PARENT_2'); // Next is subtask at 3 PM

    // Verify both parents have their subtasks
    expect(result[0].subTasks?.length).toBe(1);
    expect(result[0].subTasks?.[0].id).toBe('SUB_1_1');
    expect(result[1].subTasks?.length).toBe(1);
    expect(result[1].subTasks?.[0].id).toBe('SUB_2_1');
  });

  it('should not include parent task if neither parent nor subtasks are scheduled for later', () => {
    const parentUnscheduled = createMockTask({
      id: 'PARENT_NO_SCHEDULE',
      title: 'Parent without schedule',
      dueWithTime: undefined,
      dueDay: todayStr,
      subTaskIds: ['SUB_NO_SCHEDULE', 'SUB_PAST'],
    });

    const subUnscheduled = createMockTask({
      id: 'SUB_NO_SCHEDULE',
      title: 'Subtask without schedule',
      dueWithTime: undefined,
      parentId: 'PARENT_NO_SCHEDULE',
      dueDay: todayStr,
    });

    const subPast = createMockTask({
      id: 'SUB_PAST',
      title: 'Subtask in past',
      dueWithTime: todayAt(8, 0),
      parentId: 'PARENT_NO_SCHEDULE',
      dueDay: todayStr,
    });

    const mockTasks = [parentUnscheduled, subUnscheduled, subPast];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Should not include any tasks
    expect(result.length).toBe(0);
  });

  it('should not show subtasks as top-level when parent is scheduled', () => {
    const parentTask = createMockTask({
      id: 'PARENT_SCHEDULED',
      title: 'Parent scheduled',
      dueWithTime: todayAt(16, 0),
      dueDay: todayStr,
      subTaskIds: ['SUB_ALSO_SCHEDULED'],
    });

    const subtask = createMockTask({
      id: 'SUB_ALSO_SCHEDULED',
      title: 'Subtask also scheduled',
      dueWithTime: todayAt(14, 0),
      parentId: 'PARENT_SCHEDULED',
      dueDay: todayStr,
    });

    const mockTasks = [parentTask, subtask];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    const taskIds = result.map((t) => t.id);
    // Only parent should appear as top-level
    expect(result.length).toBe(1);
    expect(taskIds).toContain('PARENT_SCHEDULED');
    expect(taskIds).not.toContain('SUB_ALSO_SCHEDULED');

    // Subtask should be in parent's subTasks
    const parent = result[0];
    expect(parent.subTasks?.length).toBe(1);
    expect(parent.subTasks?.[0].id).toBe('SUB_ALSO_SCHEDULED');
  });

  it('should show orphaned subtask when parent is not in TODAY', () => {
    // Parent scheduled for tomorrow - not in TODAY at all
    const tomorrowTimestamp = new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      new Date().getDate() + 1,
      15,
      0,
      0,
    ).getTime();
    const tomorrowStr = getDbDateStr(new Date(tomorrowTimestamp));

    const parentNotToday = createMockTask({
      id: 'PARENT_NOT_TODAY',
      title: 'Parent scheduled for tomorrow',
      dueWithTime: tomorrowTimestamp,
      dueDay: tomorrowStr, // Scheduled for tomorrow, not today
      subTaskIds: ['SUB_IN_TODAY'],
    });

    const orphanedSubtask = createMockTask({
      id: 'SUB_IN_TODAY',
      title: 'Subtask in today',
      dueWithTime: todayAt(14, 0),
      parentId: 'PARENT_NOT_TODAY',
      dueDay: todayStr,
    });

    const mockTasks = [parentNotToday, orphanedSubtask];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Only orphaned subtask should appear (parent is for tomorrow)
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('SUB_IN_TODAY');
    expect(result[0].subTasks?.length).toBe(0);
  });

  it('should include parent with mixed scheduled/unscheduled subtasks', () => {
    const parentTask = createMockTask({
      id: 'PARENT_MIXED',
      title: 'Parent with mixed subtasks',
      dueWithTime: undefined, // Parent not scheduled
      dueDay: todayStr,
      subTaskIds: ['SUB_SCHEDULED_M', 'SUB_UNSCHEDULED_M'],
    });

    const scheduledSubtask = createMockTask({
      id: 'SUB_SCHEDULED_M',
      title: 'Scheduled subtask',
      dueWithTime: todayAt(14, 0),
      parentId: 'PARENT_MIXED',
      dueDay: todayStr,
    });

    const unscheduledSubtask = createMockTask({
      id: 'SUB_UNSCHEDULED_M',
      title: 'Unscheduled subtask',
      dueWithTime: undefined,
      parentId: 'PARENT_MIXED',
      dueDay: todayStr,
    });

    const mockTasks = [parentTask, scheduledSubtask, unscheduledSubtask];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Parent should be included because it has a scheduled subtask
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('PARENT_MIXED');

    // Both subtasks should be in parent's subTasks array
    expect(result[0].subTasks?.length).toBe(2);
    const subTaskIds = result[0].subTasks?.map((st) => st.id) || [];
    expect(subTaskIds).toContain('SUB_SCHEDULED_M');
    expect(subTaskIds).toContain('SUB_UNSCHEDULED_M');
  });

  // TODO: This test expects multi-level hierarchy support which is not currently implemented
  // The current implementation only considers direct parent-child relationships
  xit('should handle complex hierarchy with multiple levels', () => {
    // This tests that we only look at direct parent-child relationships
    const grandparent = createMockTask({
      id: 'GRANDPARENT',
      title: 'Grandparent',
      dueWithTime: undefined,
      dueDay: todayStr,
      subTaskIds: ['PARENT_MIDDLE'],
    });

    const parent = createMockTask({
      id: 'PARENT_MIDDLE',
      title: 'Parent in middle',
      dueWithTime: undefined,
      parentId: 'GRANDPARENT',
      dueDay: todayStr,
      subTaskIds: ['CHILD_SCHEDULED'],
    });

    const child = createMockTask({
      id: 'CHILD_SCHEDULED',
      title: 'Scheduled child',
      dueWithTime: todayAt(15, 0),
      parentId: 'PARENT_MIDDLE',
      dueDay: todayStr,
    });

    const mockTasks = [grandparent, parent, child];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Only grandparent should appear as top-level
    // (because it has descendant with scheduled task)
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('GRANDPARENT');
    expect(result[0].subTasks?.length).toBe(1);
    expect(result[0].subTasks?.[0].id).toBe('PARENT_MIDDLE');
  });

  it('should include task with dueWithTime for today but no dueDay (virtual tag pattern)', () => {
    // This is the key bug fix test: when scheduling with time, dueDay is cleared
    // but the task should still appear in Later Today via dueWithTime
    const taskWithTimeOnly = createMockTask({
      id: 'TIME_ONLY_TASK',
      title: 'Task scheduled via dueWithTime only',
      dueWithTime: todayAt(15, 0),
      dueDay: undefined, // No dueDay set - this was the bug scenario
    });

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState([taskWithTimeOnly]),
      todayStr,
      0,
    );

    // Task should be included because dueWithTime is for today
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('TIME_ONLY_TASK');
  });

  it('should properly handle done tasks exclusion', () => {
    const parentTask = createMockTask({
      id: 'PARENT_WITH_DONE',
      title: 'Parent task',
      dueWithTime: todayAt(15, 0),
      dueDay: todayStr,
      subTaskIds: ['SUB_DONE', 'SUB_NOT_DONE'],
    });

    const doneSubtask = createMockTask({
      id: 'SUB_DONE',
      title: 'Done subtask',
      dueWithTime: todayAt(14, 0),
      isDone: true,
      parentId: 'PARENT_WITH_DONE',
      dueDay: todayStr,
    });

    const notDoneSubtask = createMockTask({
      id: 'SUB_NOT_DONE',
      title: 'Not done subtask',
      dueWithTime: todayAt(16, 0),
      isDone: false,
      parentId: 'PARENT_WITH_DONE',
      dueDay: todayStr,
    });

    const mockTasks = [parentTask, doneSubtask, notDoneSubtask];

    const result = selectLaterTodayTasksWithSubTasks.projector(
      createTaskState(mockTasks),
      todayStr,
      0,
    );

    // Parent should be included
    expect(result.length).toBe(1);
    expect(result[0].id).toBe('PARENT_WITH_DONE');

    // Both subtasks should be in subTasks array (done status doesn't affect inclusion in subTasks)
    expect(result[0].subTasks?.length).toBe(2);
  });

  describe('with startOfNextDayDiff offset', () => {
    // Use a fixed date: Feb 15, 2026 at 10:00 AM
    const feb15 = new Date(2026, 1, 15, 10, 0, 0, 0);
    const feb15Str = '2026-02-15';
    const FOUR_HOURS_MS = 4 * 3600000;

    // Helper to create timestamps for a specific date at specific times
    const dateAt = (
      year: number,
      month: number,
      day: number,
      hours: number,
      minutes: number = 0,
    ): number => {
      return new Date(year, month - 1, day, hours, minutes, 0, 0).getTime();
    };

    beforeEach(() => {
      jasmine.clock().mockDate(feb15);
    });

    it('should include task at 2 AM next day when offset extends today past midnight', () => {
      // With 4h offset and todayStr "2026-02-15", a task at 2 AM Feb 16 is still "today"
      // because isTodayWithOffset subtracts offset: 2 AM - 4h = 10 PM Feb 15 => "2026-02-15"
      // And todayEndTime = Feb 15 23:59:59.999 + 4h = Feb 16 ~3:59:59.999 AM
      // So 2 AM Feb 16 < 3:59:59.999 AM Feb 16 => within range
      const taskAt2amFeb16 = createMockTask({
        id: 'TASK_2AM_FEB16',
        title: 'Task at 2 AM Feb 16',
        dueWithTime: dateAt(2026, 2, 16, 2, 0),
        dueDay: null,
      });

      const result = selectLaterTodayTasksWithSubTasks.projector(
        createTaskState([taskAt2amFeb16]),
        feb15Str,
        FOUR_HOURS_MS,
      );

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('TASK_2AM_FEB16');
    });

    it('should not include task at 5 AM next day when offset does not extend that far', () => {
      // With 4h offset and todayStr "2026-02-15", a task at 5 AM Feb 16
      // isTodayWithOffset: 5 AM - 4h = 1 AM Feb 16 => "2026-02-16" != "2026-02-15"
      // So it is NOT today
      const taskAt5amFeb16 = createMockTask({
        id: 'TASK_5AM_FEB16',
        title: 'Task at 5 AM Feb 16',
        dueWithTime: dateAt(2026, 2, 16, 5, 0),
        dueDay: null,
      });

      const result = selectLaterTodayTasksWithSubTasks.projector(
        createTaskState([taskAt5amFeb16]),
        feb15Str,
        FOUR_HOURS_MS,
      );

      expect(result.length).toBe(0);
    });

    it('should include task at 3:59 AM next day (just within end-of-day boundary)', () => {
      // With 4h offset, todayEndTime = Feb 15 23:59:59.999 + 4h = Feb 16 03:59:59.999
      // Task at 3:59 AM Feb 16:
      //   isTodayWithOffset: 3:59 AM - 4h = 11:59 PM Feb 15 => "2026-02-15" == todayStr
      //   dueWithTime (3:59 AM) <= todayEndTime (3:59:59.999 AM) => within range
      const taskAt359amFeb16 = createMockTask({
        id: 'TASK_359AM_FEB16',
        title: 'Task at 3:59 AM Feb 16',
        dueWithTime: dateAt(2026, 2, 16, 3, 59),
        dueDay: null,
      });

      const result = selectLaterTodayTasksWithSubTasks.projector(
        createTaskState([taskAt359amFeb16]),
        feb15Str,
        FOUR_HOURS_MS,
      );

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('TASK_359AM_FEB16');
    });

    it('should not include task at 4:01 AM next day (just past end-of-day boundary)', () => {
      // With 4h offset, todayEndTime = Feb 15 23:59:59.999 + 4h = Feb 16 03:59:59.999
      // Task at 4:01 AM Feb 16:
      //   isTodayWithOffset: 4:01 AM - 4h = 12:01 AM Feb 16 => "2026-02-16" != "2026-02-15"
      //   Not today => excluded
      const taskAt401amFeb16 = createMockTask({
        id: 'TASK_401AM_FEB16',
        title: 'Task at 4:01 AM Feb 16',
        dueWithTime: dateAt(2026, 2, 16, 4, 1),
        dueDay: null,
      });

      const result = selectLaterTodayTasksWithSubTasks.projector(
        createTaskState([taskAt401amFeb16]),
        feb15Str,
        FOUR_HOURS_MS,
      );

      expect(result.length).toBe(0);
    });

    it('should still include normal later-today tasks when offset is set', () => {
      // A task at 3 PM Feb 15 should still be included with the offset
      const taskAt3pmFeb15 = createMockTask({
        id: 'TASK_3PM_FEB15',
        title: 'Task at 3 PM Feb 15',
        dueWithTime: dateAt(2026, 2, 15, 15, 0),
        dueDay: feb15Str,
      });

      const result = selectLaterTodayTasksWithSubTasks.projector(
        createTaskState([taskAt3pmFeb15]),
        feb15Str,
        FOUR_HOURS_MS,
      );

      expect(result.length).toBe(1);
      expect(result[0].id).toBe('TASK_3PM_FEB15');
    });

    it('should not include past tasks even with offset', () => {
      // A task at 8 AM Feb 15 is in the past (clock is mocked to 10 AM Feb 15)
      const taskAt8amFeb15 = createMockTask({
        id: 'TASK_8AM_FEB15',
        title: 'Task at 8 AM Feb 15',
        dueWithTime: dateAt(2026, 2, 15, 8, 0),
        dueDay: feb15Str,
      });

      const result = selectLaterTodayTasksWithSubTasks.projector(
        createTaskState([taskAt8amFeb15]),
        feb15Str,
        FOUR_HOURS_MS,
      );

      expect(result.length).toBe(0);
    });
  });
});
