import { getDbDateStr } from '../../../../util/get-db-date-str';
import { isToday } from '../../../../util/is-today.util';

describe('TaskContextMenuInnerComponent timezone test', () => {
  describe('_schedule method same-day detection for tasks with dueWithTime (issue #5872)', () => {
    // This tests the fix for issue #5872 comment:
    // When a task is scheduled for today with a time-based reminder, clicking the "today"
    // quick access button should clear the reminder (via addToMyDay) instead of
    // rescheduling with a new reminder.
    //
    // The condition in _schedule method (lines 618-622):
    // if (this.task.dueWithTime && isToday(this.task.dueWithTime) && newDay === getDbDateStr())

    it('should detect same-day scheduling when task has dueWithTime for today', () => {
      // Simulate: task is scheduled for today at 3 PM, user clicks "today" button
      const todayAt3pm = new Date();
      todayAt3pm.setHours(15, 0, 0, 0);
      const dueWithTime = todayAt3pm.getTime();

      // User selects "today" via quick access button
      const selectedDate = new Date();
      const newDay = getDbDateStr(new Date(selectedDate));

      // The condition that triggers addToMyDay instead of scheduleTask
      const shouldCallAddToMyDay =
        dueWithTime && isToday(dueWithTime) && newDay === getDbDateStr();

      expect(shouldCallAddToMyDay).toBe(true);
    });

    it('should NOT detect same-day when task has dueWithTime for tomorrow', () => {
      // Simulate: task is scheduled for tomorrow at 3 PM, user clicks "today" button
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(15, 0, 0, 0);
      const dueWithTime = tomorrow.getTime();

      // User selects "today" via quick access button
      const selectedDate = new Date();
      const newDay = getDbDateStr(new Date(selectedDate));

      // This should NOT trigger addToMyDay - should go through scheduleTask path
      const shouldCallAddToMyDay =
        dueWithTime && isToday(dueWithTime) && newDay === getDbDateStr();

      expect(shouldCallAddToMyDay).toBe(false);
    });

    it('should NOT detect same-day when task has dueWithTime for today but scheduling for tomorrow', () => {
      // Simulate: task is scheduled for today at 3 PM, user clicks "tomorrow" button
      const todayAt3pm = new Date();
      todayAt3pm.setHours(15, 0, 0, 0);
      const dueWithTime = todayAt3pm.getTime();

      // User selects "tomorrow" via quick access button
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      const newDay = getDbDateStr(tomorrow);

      // This should NOT trigger addToMyDay - different day selected
      const shouldCallAddToMyDay =
        dueWithTime && isToday(dueWithTime) && newDay === getDbDateStr();

      expect(shouldCallAddToMyDay).toBe(false);
    });

    it('should handle task scheduled near midnight today, clicking today button', () => {
      // Simulate: task is scheduled for today at 11:30 PM, user clicks "today" button
      const todayAt1130pm = new Date();
      todayAt1130pm.setHours(23, 30, 0, 0);
      const dueWithTime = todayAt1130pm.getTime();

      // User selects "today" via quick access button
      const selectedDate = new Date();
      const newDay = getDbDateStr(new Date(selectedDate));

      const shouldCallAddToMyDay =
        dueWithTime && isToday(dueWithTime) && newDay === getDbDateStr();

      expect(shouldCallAddToMyDay).toBe(true);
    });

    it('should NOT trigger for tasks without dueWithTime (null)', () => {
      // Simulate: task has no time-based schedule
      const dueWithTime = null;

      const selectedDate = new Date();
      const newDay = getDbDateStr(new Date(selectedDate));

      // @ts-ignore - testing null case
      const shouldCallAddToMyDay =
        dueWithTime && isToday(dueWithTime) && newDay === getDbDateStr();

      expect(shouldCallAddToMyDay).toBeFalsy();
    });

    it('should NOT trigger for tasks without dueWithTime (undefined)', () => {
      // Simulate: task has no time-based schedule
      const dueWithTime = undefined;

      const selectedDate = new Date();
      const newDay = getDbDateStr(new Date(selectedDate));

      const shouldCallAddToMyDay =
        dueWithTime && isToday(dueWithTime) && newDay === getDbDateStr();

      expect(shouldCallAddToMyDay).toBeFalsy();
    });
  });

  describe('_schedule method date handling', () => {
    it('should handle scheduled date correctly across timezones', () => {
      // This test demonstrates the usage in task-context-menu-inner.component.ts line 590:
      // const newDay = getWorklogStr(newDayDate);

      // Test case: Scheduling a task for a specific date using local date constructor
      const selectedDate = new Date(2025, 0, 17, 15, 0, 0); // Jan 17, 2025 at 3 PM local time
      const newDayDate = new Date(selectedDate);
      const newDay = getDbDateStr(newDayDate);

      console.log('Task scheduling test:', {
        selectedDate: selectedDate.toISOString(),
        newDay: newDay,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // When using local date constructor, the date should always be the same regardless of timezone
      expect(newDay).toBe('2025-01-17');
    });

    it('should handle edge case when scheduling near midnight', () => {
      // Test case: Scheduling near midnight using local date constructor
      const selectedDate = new Date(2025, 0, 16, 23, 30, 0); // Jan 16, 2025 at 11:30 PM local time
      const newDayDate = new Date(selectedDate);
      const newDay = getDbDateStr(newDayDate);

      console.log('Midnight edge case test:', {
        selectedDate: selectedDate.toISOString(),
        newDay: newDay,
      });

      // When using local date constructor, the date should always be Jan 16 regardless of timezone
      expect(newDay).toBe('2025-01-16');
    });
  });

  describe('moveToBacklog today check', () => {
    it('should correctly check if task is due today', () => {
      // This test demonstrates the usage in line 523:
      // if (this.task.dueDay === getWorklogStr() || ...)

      const todayStr = getDbDateStr();

      // Test various task due days
      const taskDueToday = { dueDay: todayStr };
      const taskDueTomorrow = { dueDay: '2025-01-18' };
      const taskDueYesterday = { dueDay: '2025-01-16' };

      console.log('Today check test:', {
        todayStr: todayStr,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // Check if task is due today
      expect(taskDueToday.dueDay === getDbDateStr()).toBe(true);
      expect(taskDueTomorrow.dueDay === getDbDateStr()).toBe(false);
      expect(taskDueYesterday.dueDay === getDbDateStr()).toBe(false);
    });

    it('should handle getWorklogStr() without parameters correctly', () => {
      // When called without parameters, getWorklogStr() returns today's date
      const now = Date.now();
      const todayStr = getDbDateStr();
      const expectedDate = new Date(now);

      const year = expectedDate.getFullYear();
      const month = String(expectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(expectedDate.getDate()).padStart(2, '0');
      const expected = `${year}-${month}-${day}`;

      expect(todayStr).toBe(expected);

      console.log('getWorklogStr() without params:', {
        todayStr: todayStr,
        expected: expected,
        purpose: "Returns today's date in local timezone",
      });
    });
  });
});
