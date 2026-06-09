import { mapArchiveToWorklog } from './map-archive-to-worklog';
import { EntityState } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';
import { taskAdapter } from '../../tasks/store/task.adapter';

describe('mapArchiveToWorklog timezone test', () => {
  describe('_getTimeSpentOnDay function behavior', () => {
    it('should handle task doneOn date correctly across timezones', () => {
      // Test case: Task done at a specific UTC time
      const taskDoneTime = new Date('2025-01-17T06:00:00Z').getTime(); // 6 AM UTC
      const taskCreatedTime = new Date('2025-01-15T12:00:00Z').getTime(); // Created 2 days earlier

      const taskState: EntityState<Task> = taskAdapter.addOne(
        {
          id: 'task1',
          created: taskCreatedTime,
          doneOn: taskDoneTime,
          isDone: true,
          timeSpentOnDay: {}, // Empty, so it will use doneOn date
          subTaskIds: [],
          title: 'Test Task',
          projectId: null,
          attachments: [],
          timeEstimate: 0,
          _showSubTasksMode: 2,
        } as any,
        taskAdapter.getInitialState(),
      );

      const result = mapArchiveToWorklog(
        taskState,
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      );

      console.log('mapArchiveToWorklog doneOn test:', {
        taskDoneTime: new Date(taskDoneTime).toISOString(),
        taskCreatedTime: new Date(taskCreatedTime).toISOString(),
        resultYears: Object.keys(result.worklog),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // The task should be placed on the local date when it was done
      // In LA (UTC-8): 2025-01-16 at 10 PM local -> worklog for Jan 16
      // In Berlin (UTC+1): 2025-01-17 at 7 AM local -> worklog for Jan 17
      const tzOffset = new Date().getTimezoneOffset();
      const year2025 = result.worklog['2025'];

      if (tzOffset > 0) {
        // LA
        // Should have entry for Jan 16
        const foundEntry = year2025?.ent[1]?.ent[16];
        expect(foundEntry).toBeDefined();
        expect(foundEntry?.dateStr).toBe('2025-01-16');
      } else {
        // Berlin
        // Should have entry for Jan 17
        const foundEntry = year2025?.ent[1]?.ent[17];
        expect(foundEntry).toBeDefined();
        expect(foundEntry?.dateStr).toBe('2025-01-17');
      }
    });

    it('should fall back to created date when doneOn is not set', () => {
      // Test case: Task without doneOn date
      const taskCreatedTime = new Date(2025, 0, 16, 23, 0, 0).getTime(); // Jan 16, 2025 at 11 PM local time

      const taskState: EntityState<Task> = taskAdapter.addOne(
        {
          id: 'task1',
          created: taskCreatedTime,
          doneOn: null,
          isDone: false,
          timeSpentOnDay: {}, // Empty, so it will use created date
          subTaskIds: [],
          title: 'Test Task',
          projectId: null,
          attachments: [],
          timeEstimate: 0,
          _showSubTasksMode: 2,
        } as any,
        taskAdapter.getInitialState(),
      );

      const result = mapArchiveToWorklog(
        taskState,
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      );

      console.log('mapArchiveToWorklog created fallback test:', {
        taskCreatedTime: new Date(taskCreatedTime).toISOString(),
        expectedBehavior: 'Should use created date when doneOn is not set',
      });

      // When using local date constructor, the worklog should always be for Jan 16
      const year2025 = result.worklog['2025'];
      const foundEntry = year2025?.ent[1]?.ent[16];
      expect(foundEntry).toBeDefined();
      expect(foundEntry?.dateStr).toBe('2025-01-16');
    });

    it('should handle parent task doneOn for subtasks', () => {
      // Test case: Parent done, subtask uses parent's doneOn using local date constructors
      const parentDoneTime = new Date(2025, 0, 17, 5, 0, 0).getTime(); // Jan 17, 2025 at 5 AM local time
      const parentCreatedTime = new Date(2025, 0, 15, 12, 0, 0).getTime(); // Jan 15, 2025 at 12 PM local time
      const subtaskCreatedTime = new Date(2025, 0, 16, 12, 0, 0).getTime(); // Jan 16, 2025 at 12 PM local time

      const taskState: EntityState<Task> = taskAdapter.addMany(
        [
          {
            id: 'parent1',
            created: parentCreatedTime,
            doneOn: parentDoneTime,
            isDone: true,
            timeSpentOnDay: {},
            subTaskIds: ['subtask1'],
            title: 'Parent Task',
            projectId: null,
            attachments: [],
            timeEstimate: 0,
            _showSubTasksMode: 2,
          } as any,
          {
            id: 'subtask1',
            parentId: 'parent1',
            created: subtaskCreatedTime,
            doneOn: null,
            isDone: false,
            timeSpentOnDay: {}, // Empty, so it will use parent's doneOn
            subTaskIds: [],
            title: 'Subtask',
            projectId: null,
            attachments: [],
            timeEstimate: 0,
            _showSubTasksMode: 2,
          } as any,
        ],
        taskAdapter.getInitialState(),
      );

      const result = mapArchiveToWorklog(
        taskState,
        [],
        { workStart: {}, workEnd: {} },
        1,
        'en-US',
      );

      console.log('mapArchiveToWorklog parent doneOn test:', {
        parentDoneTime: new Date(parentDoneTime).toISOString(),
        subtaskCreatedTime: new Date(subtaskCreatedTime).toISOString(),
        expectedBehavior: 'Subtask should use parent doneOn date when no timeSpentOnDay',
      });

      // When using local date constructor, the parent is done on Jan 17 regardless of timezone
      const year2025 = result.worklog['2025'];
      const foundEntry = year2025?.ent[1]?.ent[17];
      expect(foundEntry).toBeDefined();
      // Parent should be in the log entries
      const hasParent = foundEntry?.logEntries.some(
        (entry) => entry.task.id === 'parent1',
      );
      expect(hasParent).toBe(true);
    });
  });
});
