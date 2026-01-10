import { formatJiraDate } from '../../../../util/format-jira-date';

describe('JiraApiService', () => {
  describe('addWorklog$ date formatting', () => {
    it('should format date correctly using formatJiraDate', () => {
      const testDate = '2024-01-15T10:30:00.000Z';
      const result = formatJiraDate(testDate);

      // JIRA format: YYYY-MM-DDTHH:mm:ss.SSZZ produces timezone without colon
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{2}[+-]\d{4}$/);
    });

    it('should understand the Jira format ZZ (timezone without colon)', () => {
      const testDate = '2024-01-15T10:30:00.000Z';
      const result = formatJiraDate(testDate);

      expect(result).toMatch(/[+-]\d{4}$/); // Ends with +0100 format (no colon)
    });

    it('should format date for Jira worklog', () => {
      const testDate = '2024-01-15T10:30:00.000Z';
      const result = formatJiraDate(testDate);
      const date = new Date(testDate);

      // Build the format that matches the expected output with ZZ (no colon in timezone)
      const pad = (num: number, length = 2): string => String(num).padStart(length, '0');
      const year = date.getFullYear();
      const month = pad(date.getMonth() + 1);
      const day = pad(date.getDate());
      const hours = pad(date.getHours());
      const minutes = pad(date.getMinutes());
      const seconds = pad(date.getSeconds());
      const milliseconds = String(date.getMilliseconds())
        .padStart(3, '0')
        .substring(0, 2); // Jira uses 2 digits

      // Timezone offset without colon (to match ZZ format)
      const offsetMinutes = date.getTimezoneOffset();
      const offsetHours = Math.abs(Math.floor(offsetMinutes / 60));
      const offsetMinPart = Math.abs(offsetMinutes % 60);
      const offsetSign = offsetMinutes <= 0 ? '+' : '-';
      const offsetFormatted = `${offsetSign}${pad(offsetHours)}${pad(offsetMinPart)}`;

      const expectedResult = `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${milliseconds}${offsetFormatted}`;

      expect(result).toBe(expectedResult);
    });
  });
});
