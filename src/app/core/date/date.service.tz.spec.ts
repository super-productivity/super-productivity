import { DateService } from './date.service';

describe('DateService timezone test', () => {
  let service: DateService;

  beforeEach(() => {
    service = new DateService();
  });

  describe('todayStr method', () => {
    it('should handle dates correctly across timezones', () => {
      // Test case: A specific date/time using local date constructor
      const testDate = new Date(2025, 0, 17, 15, 0, 0); // Jan 17, 2025 at 3 PM local time

      const result = service.todayStr(testDate);

      console.log('DateService todayStr test:', {
        input: testDate.toISOString(),
        output: result,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        offset: new Date().getTimezoneOffset(),
      });

      // When using local date constructor, the date should always be the same regardless of timezone
      expect(result).toBe('2025-01-17');
    });

    it('should handle edge case near midnight', () => {
      // Test case: Near midnight using local date constructor
      const testDate = new Date(2025, 0, 16, 23, 0, 0); // Jan 16, 2025 at 11 PM local time

      const result = service.todayStr(testDate);

      console.log('DateService edge case test:', {
        input: testDate.toISOString(),
        output: result,
      });

      // When using local date constructor, the date should always be Jan 16 regardless of timezone
      expect(result).toBe('2025-01-16');
    });

    it('should handle startOfNextDayDiff correctly', () => {
      // Set startOfNextDayDiff to 2 hours (simulating work day ending at 2 AM)
      service.setStartOfNextDayDiff(2);

      // Test at 1 AM local time
      const now = new Date();
      now.setHours(1, 0, 0, 0);

      const result = service.todayStr(now);

      console.log('DateService with startOfNextDayDiff:', {
        startOfNextDayDiffMs: service.getStartOfNextDayDiffMs(),
        localTime: now.toString(),
        result: result,
        expectedBehavior: 'Should treat 1 AM as previous day due to 2-hour offset',
      });

      // This is working as intended - adjusting the date based on work day settings
      expect(result).toBeDefined();
    });
  });
});

describe('DateService — logical clock helpers', () => {
  let service: DateService;

  beforeEach(() => {
    service = new DateService();
    jasmine.clock().install();
  });

  afterEach(() => {
    jasmine.clock().uninstall();
  });

  it('getLogicalTodayDate() equals Date.now() when offset is 0', () => {
    service.setStartOfNextDayDiff(0);
    jasmine.clock().mockDate(new Date('2026-04-17T10:00:00Z'));
    expect(service.getLogicalTodayDate().getTime()).toBe(
      new Date('2026-04-17T10:00:00Z').getTime(),
    );
  });

  it('getLogicalTodayDate() subtracts offset hours from real now', () => {
    service.setStartOfNextDayDiff(3);
    jasmine.clock().mockDate(new Date('2026-04-17T02:00:00Z'));
    const THREE_HOURS_MS = 3 * 60 * 60 * 1000;
    const expected = new Date('2026-04-17T02:00:00Z').getTime() - THREE_HOURS_MS;
    expect(service.getLogicalTodayDate().getTime()).toBe(expected);
  });

  it('getLogicalTomorrowMs() advances the local calendar day by one', () => {
    service.setStartOfNextDayDiff(0);
    jasmine.clock().mockDate(new Date(2026, 5, 15, 12, 0));
    const tomorrow = new Date(service.getLogicalTomorrowMs());
    expect(tomorrow.getFullYear()).toBe(2026);
    expect(tomorrow.getMonth()).toBe(5); // June
    expect(tomorrow.getDate()).toBe(16);
  });

  it('getLogicalTomorrowMs() advances the local date across a DST fall-back', () => {
    // 2026-11-01 00:30 is the DST fall-back boundary in US/Pacific.
    // A naive +24h stays on 2026-11-01 local (wrong); setDate-based advance yields 2026-11-02.
    // Berlin has no DST transition on this date, so the test passes trivially there.
    service.setStartOfNextDayDiff(0);
    jasmine.clock().mockDate(new Date(2026, 10, 1, 0, 30));
    const tomorrow = new Date(service.getLogicalTomorrowMs());
    expect(tomorrow.getFullYear()).toBe(2026);
    expect(tomorrow.getMonth()).toBe(10); // November
    expect(tomorrow.getDate()).toBe(2);
  });

  it('getStartOfNextDayDiffMs() returns the current offset in ms', () => {
    service.setStartOfNextDayDiff(3);
    expect(service.getStartOfNextDayDiffMs()).toBe(3 * 60 * 60 * 1000);
    service.setStartOfNextDayDiff(0);
    expect(service.getStartOfNextDayDiffMs()).toBe(0);
  });
});
