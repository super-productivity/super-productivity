import { mapSimpleMetrics } from './metric.util';
import { Worklog } from '../worklog/worklog.model';
import { Task } from '../tasks/task.model';
import { BreakNr, BreakTime } from '../work-context/work-context.model';

describe('metric.util timezone test', () => {
  describe('mapSimpleMetrics', () => {
    it('should handle start date conversion correctly across timezones', () => {
      // Test data
      const breakNr: BreakNr = {};
      const breakTime: BreakTime = {};
      const worklog: Worklog = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2025': {
          daysWorked: 1,
          // ... other properties would be here in real data
        } as any,
      };
      const totalTimeSpent = 3600000; // 1 hour

      // Task created at a specific UTC time
      const taskCreatedTime = new Date('2025-01-17T06:00:00Z').getTime(); // 6 AM UTC
      const allTasks: Task[] = [
        {
          id: 'task1',
          created: taskCreatedTime,
          isDone: true,
          timeEstimate: 0,
          // ... other required properties
        } as Task,
      ];

      const result = mapSimpleMetrics([
        breakNr,
        breakTime,
        worklog,
        totalTimeSpent,
        allTasks,
      ]);

      console.log('Metric start date test:', {
        taskCreatedTime: new Date(taskCreatedTime).toISOString(),
        resultStart: result.start,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // The start should be the local date when the task was created
      // In LA (UTC-8): 2025-01-16 at 10 PM local -> '2025-01-16'
      // In Berlin (UTC+1): 2025-01-17 at 7 AM local -> '2025-01-17'
      const tzOffset = new Date().getTimezoneOffset();
      if (tzOffset > 0) {
        // LA
        expect(result.start).toBe('2025-01-16');
      } else {
        // Berlin
        expect(result.start).toBe('2025-01-17');
      }
    });

    it('should find earliest task creation time', () => {
      const breakNr: BreakNr = {};
      const breakTime: BreakTime = {};
      const worklog: Worklog = {
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2025': {
          daysWorked: 2,
        } as any,
      };
      const totalTimeSpent = 7200000; // 2 hours

      // Multiple tasks with different creation times
      const task1Created = new Date('2025-01-17T15:00:00Z').getTime();
      const task2Created = new Date('2025-01-16T08:00:00Z').getTime(); // Earlier
      const task3Created = new Date('2025-01-18T12:00:00Z').getTime();

      const allTasks: Task[] = [
        { id: 'task1', created: task1Created, isDone: true, timeEstimate: 0 } as Task,
        { id: 'task2', created: task2Created, isDone: false, timeEstimate: 0 } as Task,
        { id: 'task3', created: task3Created, isDone: true, timeEstimate: 0 } as Task,
      ];

      const result = mapSimpleMetrics([
        breakNr,
        breakTime,
        worklog,
        totalTimeSpent,
        allTasks,
      ]);

      console.log('Metric earliest task test:', {
        earliestTask: new Date(task2Created).toISOString(),
        resultStart: result.start,
        expectedBehavior: 'Should use earliest task creation time',
      });

      // Should use the earliest task (task2Created)
      const tzOffset = new Date().getTimezoneOffset();
      if (tzOffset > 0) {
        // LA
        expect(result.start).toBe('2025-01-16'); // Jan 16 at midnight UTC is Jan 15 in LA
      } else {
        // Berlin
        expect(result.start).toBe('2025-01-16');
      }
    });
  });
});
