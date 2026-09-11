import {
  getEndOfTodayTime,
  isInLaterTodayWindow,
  isLaterTodayEntryUpcoming,
} from './later-today-window';
import { TaskWithSubTasks } from '../task.model';

describe('later-today-window', () => {
  const HOUR = 60 * 60 * 1000;
  const todayStr = '2023-06-13';
  const todayAt = (hours: number, minutes: number = 0): number =>
    new Date(2023, 5, 13, hours, minutes, 0, 0).getTime();
  const now = todayAt(10, 0);

  describe('getEndOfTodayTime', () => {
    it('ends at the last ms of the day without an offset', () => {
      expect(getEndOfTodayTime(todayStr, 0)).toBe(
        new Date(2023, 5, 13, 23, 59, 59, 999).getTime(),
      );
    });

    it('extends into the next day by the start-of-next-day offset', () => {
      const endOfDay = new Date(2023, 5, 13, 23, 59, 59, 999).getTime();
      const fourHours = 4 * HOUR;
      expect(getEndOfTodayTime(todayStr, fourHours)).toBe(endOfDay + fourHours);
    });
  });

  describe('isInLaterTodayWindow', () => {
    const endOfToday = getEndOfTodayTime(todayStr, 0);

    it('includes a start time still ahead of now', () => {
      expect(isInLaterTodayWindow(todayAt(14, 0), now, endOfToday)).toBe(true);
    });

    it('excludes an appointment that already started', () => {
      expect(isInLaterTodayWindow(todayAt(8, 0), now, endOfToday)).toBe(false);
    });

    it('still includes an appointment starting exactly now', () => {
      expect(isInLaterTodayWindow(now, now, endOfToday)).toBe(true);
      expect(isInLaterTodayWindow(now - 1, now, endOfToday)).toBe(false);
    });

    it('excludes tomorrow', () => {
      const tomorrow = new Date(2023, 5, 14, 10, 0, 0, 0).getTime();
      expect(isInLaterTodayWindow(tomorrow, now, endOfToday)).toBe(false);
    });

    it('excludes tasks without a start time', () => {
      expect(isInLaterTodayWindow(null, now, endOfToday)).toBe(false);
      expect(isInLaterTodayWindow(undefined, now, endOfToday)).toBe(false);
    });

    it('includes an early-morning task that the offset keeps on today', () => {
      const oneAmTomorrow = new Date(2023, 5, 14, 1, 0, 0, 0).getTime();
      const fourHours = 4 * HOUR;
      expect(isInLaterTodayWindow(oneAmTomorrow, now, endOfToday)).toBe(false);
      expect(
        isInLaterTodayWindow(oneAmTomorrow, now, getEndOfTodayTime(todayStr, fourHours)),
      ).toBe(true);
    });
  });

  describe('isLaterTodayEntryUpcoming', () => {
    const endOfToday = getEndOfTodayTime(todayStr, 0);
    const task = (
      dueWithTime: number | null,
      subTasks: unknown[] = [],
    ): TaskWithSubTasks => ({ id: 'T', dueWithTime, subTasks }) as TaskWithSubTasks;

    it('keeps an entry whose own start time is ahead', () => {
      expect(isLaterTodayEntryUpcoming(task(todayAt(14, 0)), now, endOfToday)).toBe(true);
    });

    it('drops an entry that already started', () => {
      expect(isLaterTodayEntryUpcoming(task(todayAt(9, 0)), now, endOfToday)).toBe(false);
    });

    it('keeps a parent while a subtask is still ahead', () => {
      const parent = task(null, [
        { dueWithTime: todayAt(9, 0) },
        { dueWithTime: todayAt(14, 0) },
      ]);
      expect(isLaterTodayEntryUpcoming(parent, now, endOfToday)).toBe(true);
    });

    it('drops a parent once all its scheduled subtasks started', () => {
      const parent = task(null, [{ dueWithTime: todayAt(9, 0) }]);
      expect(isLaterTodayEntryUpcoming(parent, now, endOfToday)).toBe(false);
    });

    it('ignores done subtasks like the selector does', () => {
      const parent = task(null, [{ dueWithTime: todayAt(14, 0), isDone: true }]);
      expect(isLaterTodayEntryUpcoming(parent, now, endOfToday)).toBe(false);
    });
  });
});
