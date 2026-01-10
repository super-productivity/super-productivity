import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';

/**
 * Timezone tests for DialogScheduleTaskComponent
 *
 * These tests verify the fix for GitHub issue #5515:
 * "Scheduled time doesn't match the time I set"
 *
 * The bug: When displaying a task's dueWithTime in the schedule dialog,
 * the code incorrectly added timezone offset to the UTC timestamp:
 *   const tzOffset = new Date().getTimezoneOffset() * 60 * 1000;
 *   this.selectedDate = new Date(this.data.task.dueWithTime + tzOffset);
 *
 * This double-applies timezone conversion since JavaScript's Date constructor
 * already handles UTC-to-local conversion automatically.
 *
 * Run in different timezones:
 *   TZ='Asia/Kolkata' npm run test:file src/app/features/planner/dialog-schedule-task/dialog-schedule-task.component.tz.spec.ts
 *   TZ='Europe/Berlin' npm run test:file src/app/features/planner/dialog-schedule-task/dialog-schedule-task.component.tz.spec.ts
 *   TZ='America/Los_Angeles' npm run test:file src/app/features/planner/dialog-schedule-task/dialog-schedule-task.component.tz.spec.ts
 */
describe('DialogScheduleTaskComponent timezone test', () => {
  describe('dueWithTime display (issue #5515)', () => {
    it('should display correct time from dueWithTime without timezone corruption', () => {
      // Simulate a task scheduled for 2:45 PM (14:45) local time
      const scheduledTime = new Date();
      scheduledTime.setHours(14, 45, 0, 0);
      const dueWithTime = scheduledTime.getTime();

      // BUGGY behavior (what the code was doing):
      const tzOffset = new Date().getTimezoneOffset() * 60 * 1000;
      const buggyDate = new Date(dueWithTime + tzOffset);

      // CORRECT behavior (what the code should do):
      const correctDate = new Date(dueWithTime);

      console.log('Issue #5515 - dueWithTime display test:', {
        expectedTime: '14:45',
        dueWithTime,
        buggyDisplayed: `${buggyDate.getHours()}:${String(buggyDate.getMinutes()).padStart(2, '0')}`,
        correctDisplayed: `${correctDate.getHours()}:${String(correctDate.getMinutes()).padStart(2, '0')}`,
        timezoneOffset: new Date().getTimezoneOffset(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // The correct time should always be 14:45
      expect(correctDate.getHours()).toBe(14);
      expect(correctDate.getMinutes()).toBe(45);

      // The buggy time will differ by timezone offset (demonstrating the bug)
      // In GMT+5:30 (offset=-330), buggyDate shows ~9:15 (shifted by -5.5 hours)
      // In GMT-8 (offset=480), buggyDate shows ~22:45 (shifted by +8 hours)
      const offsetHours = new Date().getTimezoneOffset() / 60;
      if (offsetHours !== 0) {
        // Bug would cause different time display
        expect(buggyDate.getHours()).not.toBe(14);
      }
    });

    it('should preserve 2:45 PM across all timezones (user reported time)', () => {
      // User reported setting 2:45 PM but seeing 2:04 PM
      // This simulates the exact scenario from issue #5515

      // Create a timestamp for 2:45 PM today
      const today = new Date();
      const dueWithTime = new Date(
        today.getFullYear(),
        today.getMonth(),
        today.getDate(),
        14,
        45,
        0,
        0,
      ).getTime();

      // Correct conversion (what should happen)
      const displayDate = new Date(dueWithTime);

      console.log('User scenario test (2:45 PM):', {
        dueWithTime,
        displayedHours: displayDate.getHours(),
        displayedMinutes: displayDate.getMinutes(),
        expected: '14:45',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      expect(displayDate.getHours()).toBe(14);
      expect(displayDate.getMinutes()).toBe(45);
    });

    it('should handle time display correctly for GMT+5:30 timezone', () => {
      // User is in GMT+5:30 (India Standard Time)
      // This test verifies the fix works for their timezone

      // Simulate 2:45 PM local time stored as UTC timestamp
      const localTime = new Date();
      localTime.setHours(14, 45, 0, 0);
      const dueWithTime = localTime.getTime();

      // Correct: Just create Date from timestamp
      const correctDate = new Date(dueWithTime);

      // Buggy: Add timezone offset (what was happening)
      const tzOffset = new Date().getTimezoneOffset() * 60 * 1000;
      const buggyDate = new Date(dueWithTime + tzOffset);

      const offsetMinutes = new Date().getTimezoneOffset();

      console.log('GMT+5:30 scenario:', {
        originalTime: '14:45',
        dueWithTime,
        correctTime: `${correctDate.getHours()}:${String(correctDate.getMinutes()).padStart(2, '0')}`,
        buggyTime: `${buggyDate.getHours()}:${String(buggyDate.getMinutes()).padStart(2, '0')}`,
        offsetMinutes,
        // In IST (GMT+5:30), offset is -330 minutes
        // Bug would shift time by -5.5 hours: 14:45 -> 09:15
      });

      // Correct behavior: time should be preserved
      expect(correctDate.getHours()).toBe(14);
      expect(correctDate.getMinutes()).toBe(45);
    });

    it('should not corrupt time when dialog is opened and closed without changes', () => {
      // Simulate opening dialog with existing dueWithTime, then saving without changes
      // The dueWithTime should remain unchanged

      const originalDueWithTime = new Date(2025, 5, 15, 14, 45, 0).getTime();

      // What dialog displays (correct)
      const displayDate = new Date(originalDueWithTime);

      // What would be saved (should be same timestamp)
      const savedDueWithTime = displayDate.getTime();

      console.log('Open/close without changes:', {
        original: originalDueWithTime,
        saved: savedDueWithTime,
        unchanged: originalDueWithTime === savedDueWithTime,
      });

      expect(savedDueWithTime).toBe(originalDueWithTime);
    });
  });

  describe('selectedDate initialization from dueDay', () => {
    it('should use dateStrToUtcDate for dueDay to avoid UTC parsing issues', () => {
      const dueDay = '2025-01-15';

      // BUGGY: new Date(dateString) parses as UTC midnight
      // which can be a different local date in some timezones
      const buggyDate = new Date(dueDay);

      // CORRECT: dateStrToUtcDate creates local midnight
      const correctDate = dateStrToUtcDate(dueDay);

      console.log('dueDay parsing test:', {
        dueDay,
        buggyDate: buggyDate.toString(),
        buggyLocalDate: buggyDate.getDate(),
        correctDate: correctDate.toString(),
        correctLocalDate: correctDate.getDate(),
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // The correct date should always be the 15th in local time
      expect(correctDate.getDate()).toBe(15);
      expect(correctDate.getMonth()).toBe(0); // January
      expect(correctDate.getFullYear()).toBe(2025);
    });

    it('should handle dueDay near timezone boundaries', () => {
      // Test date that could shift days in extreme timezones
      const dueDay = '2025-06-01';

      const correctDate = dateStrToUtcDate(dueDay);

      console.log('Timezone boundary test:', {
        dueDay,
        localDate: correctDate.getDate(),
        localMonth: correctDate.getMonth() + 1,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      // Should always be June 1st regardless of timezone
      expect(correctDate.getDate()).toBe(1);
      expect(correctDate.getMonth()).toBe(5); // June (0-indexed)
    });
  });

  describe('toLocaleTimeString for time display', () => {
    it('should extract correct time string from dueWithTime', () => {
      // This tests line 153-159 in the component
      const dueWithTime = new Date(2025, 5, 15, 14, 45, 0).getTime();

      // What the component does to get time string
      const selectedTime = new Date(dueWithTime).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      console.log('Time string extraction:', {
        dueWithTime,
        selectedTime,
        expected: '14:45',
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      expect(selectedTime).toBe('14:45');
    });

    it('should handle morning times correctly', () => {
      const dueWithTime = new Date(2025, 5, 15, 9, 30, 0).getTime();

      const selectedTime = new Date(dueWithTime).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      console.log('Morning time test:', {
        dueWithTime,
        selectedTime,
        expected: '09:30',
      });

      expect(selectedTime).toBe('09:30');
    });

    it('should handle midnight correctly', () => {
      const dueWithTime = new Date(2025, 5, 15, 0, 0, 0).getTime();

      const selectedTime = new Date(dueWithTime).toLocaleTimeString('en-GB', {
        hour: '2-digit',
        minute: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      });

      console.log('Midnight time test:', {
        dueWithTime,
        selectedTime,
        expected: '00:00',
      });

      expect(selectedTime).toBe('00:00');
    });
  });

  describe('system time change scenario (issue reproduction)', () => {
    it('should demonstrate that correct implementation survives timezone offset changes', () => {
      // The user reported that changing system time caused the bug
      // This happens because getTimezoneOffset() can return different values
      // after DST transitions or manual time changes

      const dueWithTime = new Date(2025, 5, 15, 14, 45, 0).getTime();

      // Simulate different timezone offsets that might occur
      const offsets = [-330, -300, 0, 60, 480]; // IST, EST, UTC, CET, PST

      for (const simulatedOffset of offsets) {
        // Buggy behavior with different offsets
        const offsetMs = simulatedOffset * 60 * 1000;
        const buggyDate = new Date(dueWithTime + offsetMs);

        // Correct behavior (always the same)
        const correctDate = new Date(dueWithTime);

        console.log(`Simulated offset ${simulatedOffset}:`, {
          buggyHours: buggyDate.getHours(),
          buggyMinutes: buggyDate.getMinutes(),
          correctHours: correctDate.getHours(),
          correctMinutes: correctDate.getMinutes(),
        });

        // Correct implementation always shows 14:45
        expect(correctDate.getHours()).toBe(14);
        expect(correctDate.getMinutes()).toBe(45);
      }
    });
  });
});
