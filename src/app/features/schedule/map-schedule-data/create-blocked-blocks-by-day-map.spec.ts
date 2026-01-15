import { createBlockedBlocksByDayMap } from './create-blocked-blocks-by-day-map';
import { TaskCopy, TaskWithDueTime } from '../../tasks/task.model';

const NDS = '1970-01-01';
const H = 60 * 60 * 1000;
const TZ_OFFSET = new Date(NDS).getTimezoneOffset() * 60000;

const FAKE_TASK: Partial<TaskCopy> = {
  tagIds: [],
  subTaskIds: [],
  timeSpent: 0,
  timeEstimate: H,
};

const h = (hr: number): number => hr * 60 * 1000 * 60;
// const hTz = (hr: number): number => h(hr) + TZ_OFFSET;
// eslint-disable-next-line no-mixed-operators
const dh = (d: number = 0, hr: number): number => hr * H + d * h(24);
const dhTz = (d: number = 0, hr: number): number => dh(d, hr) + TZ_OFFSET;

const fakeTaskEntry = (id = 'XXX', add?: Partial<TaskCopy>): TaskCopy => {
  return {
    ...FAKE_TASK,
    ...add,
    id,
  } as TaskCopy;
};

const fakePlannedTaskEntry = (
  id = 'XXX',
  planedAt: Date,
  add?: Partial<TaskWithDueTime>,
): TaskWithDueTime => {
  return {
    ...fakeTaskEntry(id, add),
    dueWithTime: planedAt.getTime(),
    reminderId: 'R_ID',
  } as TaskWithDueTime;
};

describe('createBlockedBlocksByDayMap()', () => {
  it('should work for empty case', () => {
    const r = createBlockedBlocksByDayMap([], [], [], undefined, undefined, 0);
    expect(r).toEqual({});
  });

  it('should work for basic case', () => {
    const r = createBlockedBlocksByDayMap(
      [],
      [],
      [],
      { startTime: '9:00', endTime: '17:00' },
      undefined,
      0,
      1,
    );

    // The result structure depends on timezone, but we can verify the essential properties
    const dates = Object.keys(r).sort();
    expect(dates.length).toBeGreaterThanOrEqual(1);
    expect(dates.length).toBeLessThanOrEqual(3); // Could span 3 days in extreme timezones

    // Verify that all entries are WorkdayStartEnd blocks
    for (const date of dates) {
      const blocks = r[date];
      expect(blocks.length).toBeGreaterThan(0);
      for (const block of blocks) {
        expect(block.entries.length).toBeGreaterThan(0);
        for (const entry of block.entries) {
          expect(entry.type).toBe('WorkdayStartEnd');
          expect(entry.data).toEqual({ endTime: '17:00', startTime: '9:00' });
        }
      }
    }
  });

  it('should work filter out entries beyond bounds', () => {
    const plannedTask = fakePlannedTaskEntry('1', new Date(dhTz(1, 18)), {
      timeEstimate: h(1),
    });
    const r = createBlockedBlocksByDayMap(
      [plannedTask],
      [],
      [],
      { startTime: '9:00', endTime: '17:00' },
      undefined,
      0,
      2,
    );

    // Should create blocks for 3 days (can vary by timezone)
    const dates = Object.keys(r).sort();
    expect(dates.length).toBe(3);

    // Find the day that contains the scheduled task (day 1 + 18 hours)
    const taskTimestamp = dhTz(1, 18);
    let taskDayFound = false;

    for (const date of dates) {
      const blocks = r[date];
      expect(blocks.length).toBeGreaterThan(0);

      // Check if any block contains the scheduled task
      for (const block of blocks) {
        const hasScheduledTask = block.entries.some(
          (entry) => entry.type === 'ScheduledTask',
        );
        if (hasScheduledTask) {
          taskDayFound = true;
          // Verify the scheduled task properties
          const scheduledTaskEntry = block.entries.find(
            (entry) => entry.type === 'ScheduledTask',
          );
          expect(scheduledTaskEntry).toBeDefined();
          if (scheduledTaskEntry) {
            expect((scheduledTaskEntry.data as any).id).toBe('1');
            expect((scheduledTaskEntry.data as any).timeEstimate).toBe(h(1));
            expect((scheduledTaskEntry.data as any).reminderId).toBe('R_ID');
            expect(scheduledTaskEntry.start).toBe(taskTimestamp);
            expect(scheduledTaskEntry.end).toBe(taskTimestamp + h(1));
          }
        }

        // All blocks should have at least one entry, verify WorkdayStartEnd entries have correct data
        expect(block.entries.length).toBeGreaterThan(0);
        const workdayEntries = block.entries.filter(
          (entry) => entry.type === 'WorkdayStartEnd',
        );
        for (const entry of workdayEntries) {
          expect(entry.data).toEqual({ startTime: '9:00', endTime: '17:00' });
        }
      }
    }

    expect(taskDayFound).toBe(true);
  });

  it('should work for very long scheduled tasks', () => {
    const plannedTask = fakePlannedTaskEntry('S1', new Date(dhTz(1, 18)), {
      timeEstimate: h(48),
    });
    const r = createBlockedBlocksByDayMap(
      [plannedTask],
      [],
      [],
      { startTime: '9:00', endTime: '17:00' },
      undefined,
      0,
      2,
    );

    // 48-hour task should span 4 or 5 days depending on timezone
    const dates = Object.keys(r).sort();
    expect(dates.length).toBeGreaterThanOrEqual(4);
    expect(dates.length).toBeLessThanOrEqual(5);

    // Verify the task structure and types
    let scheduledTaskFound = false;
    let scheduledTaskSplitFound = false;
    const taskStartTime = dhTz(1, 18);
    const taskDuration = h(48);

    for (const date of dates) {
      const blocks = r[date];
      expect(blocks.length).toBeGreaterThan(0);

      for (const block of blocks) {
        for (const entry of block.entries) {
          if (entry.type === 'ScheduledTask') {
            scheduledTaskFound = true;
            expect((entry.data as any).id).toBe('S1');
            expect((entry.data as any).timeEstimate).toBe(taskDuration);
            expect((entry.data as any).reminderId).toBe('R_ID');
            expect(entry.start).toBe(taskStartTime);
          } else if (entry.type === 'ScheduledTaskSplit') {
            scheduledTaskSplitFound = true;
            expect((entry.data as any).id).toBe('S1');
            expect((entry.data as any).timeEstimate).toBe(taskDuration);
            expect((entry.data as any).reminderId).toBe('R_ID');
          } else if (entry.type === 'WorkdayStartEnd') {
            expect(entry.data).toEqual({ startTime: '9:00', endTime: '17:00' });
          }
        }
      }
    }

    // Long task should have both initial scheduled task and split parts
    expect(scheduledTaskFound).toBe(true);
    expect(scheduledTaskSplitFound).toBe(true);
  });
});
