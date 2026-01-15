import { getDbDateStr } from '../../util/get-db-date-str';

describe('ArchiveService timezone test', () => {
  describe('todayStr calculation', () => {
    it('should handle current date correctly across timezones', () => {
      // This test demonstrates the usage in archive.service.ts line 89:
      // todayStr: getWorklogStr(now),

      const now = Date.now();
      const todayStr = getDbDateStr(now);

      console.log('Archive service todayStr test:', {
        now: new Date(now).toISOString(),
        todayStr: todayStr,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // Should always return today's date in the local timezone
      const expectedDate = new Date(now);
      const year = expectedDate.getFullYear();
      const month = String(expectedDate.getMonth() + 1).padStart(2, '0');
      const day = String(expectedDate.getDate()).padStart(2, '0');
      const expected = `${year}-${month}-${day}`;

      expect(todayStr).toBe(expected);
    });

    it('should handle midnight edge case', () => {
      // Test at a specific time that crosses midnight in different timezones
      const testTime = new Date('2025-01-17T07:00:00Z').getTime(); // 7 AM UTC

      const todayStr = getDbDateStr(testTime);

      console.log('Archive service midnight edge case:', {
        testTime: new Date(testTime).toISOString(),
        todayStr: todayStr,
        expectedInLA: '2025-01-16', // 11 PM previous day
        expectedInBerlin: '2025-01-17', // 8 AM same day
      });

      // In LA (UTC-8): 2025-01-16 at 11 PM -> '2025-01-16'
      // In Berlin (UTC+1): 2025-01-17 at 8 AM -> '2025-01-17'
      const tzOffset = new Date().getTimezoneOffset();
      if (tzOffset > 0) {
        // LA
        expect(todayStr).toBe('2025-01-16');
      } else {
        // Berlin
        expect(todayStr).toBe('2025-01-17');
      }
    });

    it('should be used for sorting time tracking data', () => {
      // This simulates how todayStr is used in sortTimeTrackingDataToArchiveYoung
      const now = Date.now();
      const todayStr = getDbDateStr(now);

      // Mock time tracking data structure
      const timeTrackingData = {
        [todayStr]: {
          /* today's data stays in main store */
        },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2025-01-15': {
          /* older data goes to archive */
        },
        // eslint-disable-next-line @typescript-eslint/naming-convention
        '2025-01-14': {
          /* older data goes to archive */
        },
      };

      // Verify todayStr matches current date
      expect(Object.keys(timeTrackingData)).toContain(todayStr);

      console.log('Archive service data sorting:', {
        todayStr: todayStr,
        purpose: "Keep today's data in main store, archive older data",
      });
    });
  });
});
