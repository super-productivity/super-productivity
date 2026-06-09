import { getDbDateStr } from '../../../util/get-db-date-str';

describe('DialogEditTaskRepeatCfgComponent timezone test', () => {
  describe('startDate calculation from dueWithTime', () => {
    it('should handle task dueWithTime correctly across timezones', () => {
      // This test demonstrates the issue with line 109 in dialog-edit-task-repeat-cfg.component.ts:
      // startDate: getWorklogStr(this._data.task.dueWithTime || undefined),

      // Test case: Task scheduled for midnight on 2025-01-17 in LA timezone
      const taskDueWithTime = new Date('2025-01-17T00:00:00-08:00').getTime();

      // This is what the component does:
      const startDate = getDbDateStr(taskDueWithTime);

      console.log('Task repeat config startDate:', {
        dueWithTime: taskDueWithTime,
        startDate: startDate,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // In LA timezone, this should be 2025-01-17
      // In Berlin timezone, this should also be 2025-01-17 because getWorklogStr uses local date
      const tzOffset = new Date().getTimezoneOffset();
      if (tzOffset > 0) {
        // LA
        expect(startDate).toBe('2025-01-17');
      } else {
        // Berlin
        expect(startDate).toBe('2025-01-17');
      }
    });

    it('should demonstrate potential issue with cross-timezone boundaries', () => {
      // Test case: Task scheduled for 11 PM on 2025-01-16 in LA (which is 7 AM on 2025-01-17 in UTC)
      const taskDueWithTime = new Date('2025-01-16T23:00:00-08:00').getTime();

      const startDate = getDbDateStr(taskDueWithTime);

      console.log('Cross-timezone task repeat config:', {
        dueWithTime: taskDueWithTime,
        startDate: startDate,
        expectedInLA: '2025-01-16',
        expectedInBerlin: '2025-01-17',
      });

      // This creates a repeat config based on local interpretation of the timestamp
      // In LA: starts on 2025-01-16
      // In Berlin: starts on 2025-01-17
      const tzOffset = new Date().getTimezoneOffset();
      if (tzOffset > 0) {
        // LA
        expect(startDate).toBe('2025-01-16');
      } else {
        // Berlin
        expect(startDate).toBe('2025-01-17');
      }
    });
  });
});
