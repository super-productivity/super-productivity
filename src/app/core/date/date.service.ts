import { Injectable } from '@angular/core';
import { getDbDateStr } from '../../util/get-db-date-str';

@Injectable({ providedIn: 'root' })
export class DateService {
  private startOfNextDayDiff: number = 0;

  setStartOfNextDayDiff(startOfNextDay: number): void {
    const clamped = Math.max(0, Math.min(23, startOfNextDay || 0));
    this.startOfNextDayDiff = clamped * 60 * 60 * 1000;
  }

  /**
   * Logical "now" — Date.now() shifted backwards by the start-of-next-day offset.
   * Use this to answer: "what day does this moment belong to for bucketing/scheduling?"
   * Do NOT use for wall-clock display, durations, or user-facing timestamps.
   * The returned number is in the logical-day coordinate system, not real time.
   */
  getLogicalNowMs(): number {
    return Date.now() - this.startOfNextDayDiff;
  }

  /** Logical today as a Date. Same coordinate system as getLogicalNowMs. */
  getLogicalTodayDate(): Date {
    return new Date(this.getLogicalNowMs());
  }

  /**
   * Logical tomorrow = getLogicalNowMs() + 24h (in ms).
   * NOTE: this is wall-clock +24h, not "same local time next calendar day".
   * Across DST boundaries the local hour of the result may shift by ±1h;
   * for date-string bucketing that is the correct behavior.
   */
  getLogicalTomorrowMs(): number {
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    return this.getLogicalNowMs() + ONE_DAY_MS;
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
