import { Injectable } from '@angular/core';
import { getDbDateStr } from '../../util/get-db-date-str';

const parseTimeStringToMinutes = (time: string | number): number => {
  if (typeof time === 'number') {
    // Legacy: treat as hours
    return time * 60;
  }
  const [h, m] = time.split(':').map(Number);
  const MINUTES_PER_HOUR = 60;
  const hoursInMinutes = (h || 0) * MINUTES_PER_HOUR;
  const extraMinutes = m || 0;

  return hoursInMinutes + extraMinutes;
};

@Injectable({ providedIn: 'root' })
export class DateService {
  private startOfNextDayDiff: number = 0;

  setStartOfNextDayDiff(startOfNextDay: string | number): void {
    const minutes = parseTimeStringToMinutes(startOfNextDay);
    const clamped = Math.max(0, Math.min(1439, minutes)); // 0 to 23*60+59
    this.startOfNextDayDiff = clamped * 60 * 1000;
  }

  /**
   * Returns a Date representing "logical today" — Date.now() shifted backwards by
   * the start-of-next-day offset, so callers can ask "what day does this moment belong to?".
   * The returned Date's local-date components (year/month/day) are the logical day.
   */
  getLogicalTodayDate(): Date {
    return new Date(Date.now() - this.startOfNextDayDiff);
  }

  /**
   * Returns a timestamp on "logical tomorrow" (logical today + 1 calendar day).
   * Uses local-date arithmetic (setDate) so day advancement is correct across DST
   * transitions — a naive +24h would stay on the same local date during a fall-back.
   */
  getLogicalTomorrowMs(): number {
    const d = new Date(Date.now() - this.startOfNextDayDiff);
    d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  /**
   * Read-only accessor for the raw offset in ms.
   * Pure utilities (reducers, selectors) need this value as an argument.
   */
  getStartOfNextDayDiffMs(): number {
    return this.startOfNextDayDiff;
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
