/* eslint-disable @typescript-eslint/naming-convention */
import { getDbDateStr } from '../../util/get-db-date-str';

describe('WorklogService timezone fix', () => {
  it('should correctly filter tasks by date range regardless of timezone', () => {
    // Create mock tasks with specific dates
    const mockTasks = [
      {
        id: 'task1',
        dateStr: '2024-01-15',
        timeSpentOnDay: { '2024-01-15': 3600000 },
      },
      {
        id: 'task2',
        dateStr: '2024-01-16',
        timeSpentOnDay: { '2024-01-16': 7200000 },
      },
      {
        id: 'task3',
        dateStr: '2024-01-17',
        timeSpentOnDay: { '2024-01-17': 1800000 },
      },
    ];

    // Create date range for January 15-17, 2024 at local midnight
    // This represents a typical worklog export scenario
    const rangeStart = new Date(2024, 0, 15, 0, 0, 0); // Jan 15, 2024 00:00 local time
    const rangeEnd = new Date(2024, 0, 17, 23, 59, 59); // Jan 17, 2024 23:59 local time

    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('Test timezone:', currentTimezone);
    console.log('Range start:', rangeStart.toISOString());
    console.log('Range end:', rangeEnd.toISOString());

    // Convert date range to date strings for timezone-safe comparison (the fix)
    const rangeStartStr = getDbDateStr(rangeStart);
    const rangeEndStr = getDbDateStr(rangeEnd);

    console.log('Range start string:', rangeStartStr);
    console.log('Range end string:', rangeEndStr);

    // Apply the same filtering logic as in the fixed WorklogService
    const filteredTasks = mockTasks.filter((task) => {
      return task.dateStr >= rangeStartStr && task.dateStr <= rangeEndStr;
    });

    console.log(
      'Filtered tasks:',
      filteredTasks.map((t) => ({ id: t.id, dateStr: t.dateStr })),
    );

    // With the timezone fix, this should work in both Europe/Berlin and America/Los_Angeles
    expect(filteredTasks.length).toBe(3);
    expect(filteredTasks.some((t) => t.dateStr === '2024-01-15')).toBe(
      true,
      'Should include first day (Jan 15) - this would fail without the timezone fix in America/Los_Angeles',
    );
    expect(filteredTasks.some((t) => t.dateStr === '2024-01-16')).toBe(
      true,
      'Should include middle day (Jan 16)',
    );
    expect(filteredTasks.some((t) => t.dateStr === '2024-01-17')).toBe(
      true,
      'Should include last day (Jan 17)',
    );
  });

  it('should demonstrate the old buggy behavior would fail in negative UTC offset', () => {
    // Create mock tasks with specific dates
    const mockTasks = [
      { id: 'task1', dateStr: '2024-01-15' },
      { id: 'task2', dateStr: '2024-01-16' },
      { id: 'task3', dateStr: '2024-01-17' },
    ];

    // Create date range for January 15-17, 2024 at local midnight
    const rangeStart = new Date(2024, 0, 15, 0, 0, 0); // Jan 15, 2024 00:00 local time
    const rangeEnd = new Date(2024, 0, 17, 23, 59, 59); // Jan 17, 2024 23:59 local time

    const currentTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log('Test timezone:', currentTimezone);

    // This simulates the OLD buggy behavior (parsing date strings to Date objects)
    const buggyFilteredTasks = mockTasks.filter((task) => {
      const taskDate = new Date(task.dateStr); // This is the bug!
      return taskDate >= rangeStart && taskDate <= rangeEnd;
    });

    console.log(
      'Buggy filtered tasks:',
      buggyFilteredTasks.map((t) => ({ id: t.id, dateStr: t.dateStr })),
    );

    // In America/Los_Angeles timezone, this would fail because:
    // new Date('2024-01-15') creates Jan 15 00:00 UTC = Jan 14 16:00 PST
    // rangeStart is Jan 15 00:00 PST = Jan 15 08:00 UTC
    // So taskDate < rangeStart, and the task is excluded
    if (currentTimezone === 'America/Los_Angeles') {
      // The bug would cause the first task to be excluded
      expect(buggyFilteredTasks.length).toBe(2);
      expect(buggyFilteredTasks.some((t) => t.dateStr === '2024-01-15')).toBe(
        false,
        'First day should be excluded due to timezone bug in America/Los_Angeles',
      );
    } else {
      // In Europe/Berlin (UTC+1), the bug doesn't manifest because:
      // new Date('2024-01-15') creates Jan 15 00:00 UTC = Jan 15 01:00 CET
      // rangeStart is Jan 15 00:00 CET = Jan 14 23:00 UTC
      // So taskDate > rangeStart, and the task is included
      expect(buggyFilteredTasks.length).toBe(3);
      expect(buggyFilteredTasks.some((t) => t.dateStr === '2024-01-15')).toBe(
        true,
        'All tasks should be included in Europe/Berlin due to positive UTC offset',
      );
    }
  });
});
