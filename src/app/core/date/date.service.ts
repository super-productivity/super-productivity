import { Injectable } from '@angular/core';
import { getDbDateStr } from '../../util/get-db-date-str';

@Injectable({ providedIn: 'root' })
export class DateService {
  startOfNextDayDiff: number = 0;

  setStartOfNextDayDiff(startOfNextDay: number): void {
    const clamped = Math.max(0, Math.min(23, startOfNextDay || 0));
    this.startOfNextDayDiff = clamped * 60 * 60 * 1000;
  }

  /**
   * Returns today's date string with offset applied.
   * NOTE: When a date argument is provided, the offset is NOT applied to it —
   * the caller is responsible for adjusting the date if needed.
   */
  todayStr(date?: Date | number): string {
    if (!date) {
      date = new Date(Date.now() - this.startOfNextDayDiff);
    }
    return getDbDateStr(date);
  }

  isToday(date: number | Date): boolean {
    const ts = typeof date === 'number' ? date : date.getTime();
    return getDbDateStr(new Date(ts - this.startOfNextDayDiff)) === this.todayStr();
  }

  isYesterday(date: number | Date): boolean {
    const ts = typeof date === 'number' ? date : date.getTime();
    const yesterday = new Date(Date.now() - this.startOfNextDayDiff);
    yesterday.setDate(yesterday.getDate() - 1);
    return (
      getDbDateStr(new Date(ts - this.startOfNextDayDiff)) === getDbDateStr(yesterday)
    );
  }
}
