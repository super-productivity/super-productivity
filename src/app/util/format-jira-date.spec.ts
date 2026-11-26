import { formatJiraDate } from './format-jira-date';

describe('formatJiraDate', () => {
  it('should format date in Jira format', () => {
    const testDate = '2024-01-15T10:30:00.000Z';
    const result = formatJiraDate(testDate);

    // Should match YYYY-MM-DDTHH:mm:ss.SSZZ format
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}[+-]\d{4}$/);
  });

  it('should format various dates consistently', () => {
    const testDates = [
      '2024-01-15T10:30:00.000Z',
      '2024-06-01T00:00:00.000Z',
      '2024-12-31T23:59:59.999Z',
      new Date().toISOString(),
    ];

    testDates.forEach((date) => {
      const result = formatJiraDate(date);
      // Should match the Jira datetime format
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}[+-]\d{4}$/);
    });
  });

  it('should handle Date objects', () => {
    const date = new Date(2024, 0, 15, 10, 30, 0);
    const result = formatJiraDate(date);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}[+-]\d{4}$/);
  });

  it('should handle timestamps', () => {
    const timestamp = new Date(2024, 0, 15, 10, 30, 0).getTime();
    const result = formatJiraDate(timestamp);
    expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}[+-]\d{4}$/);
  });

  it('should correctly format timezone offset without colon', () => {
    const date = new Date(2024, 0, 15, 10, 30, 0);
    const result = formatJiraDate(date);

    // Extract timezone part
    const timezonePart = result.substring(result.length - 5);
    expect(timezonePart).toMatch(/^[+-]\d{4}$/); // e.g., +0100 or -0500
  });

  describe('timezone offset', () => {
    let timezoneOffsetSpy: jasmine.Spy;

    beforeEach(() => {
      timezoneOffsetSpy = spyOn(Date.prototype, 'getTimezoneOffset');
    });

    const offsetFor = (timezoneOffset: number): string => {
      timezoneOffsetSpy.and.returnValue(timezoneOffset);
      return formatJiraDate(new Date(2024, 0, 15, 10, 30, 0)).slice(-5);
    };

    it('should keep the hour of half-hour zones east of UTC', () => {
      expect(offsetFor(-330)).toBe('+0530');
      expect(offsetFor(-345)).toBe('+0545');
    });

    it('should format whole-hour zones and zones west of UTC', () => {
      expect(offsetFor(-60)).toBe('+0100');
      expect(offsetFor(210)).toBe('-0330');
      expect(offsetFor(480)).toBe('-0800');
    });
  });
});
