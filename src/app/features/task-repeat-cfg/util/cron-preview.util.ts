import cronstrue from 'cronstrue';
import { CronExpressionParser } from 'cron-parser';
import { isCronExpressionValid } from '../store/cron-occurrence.util';
import { naturalLanguageToCron } from './parse-natural-cron.util';

export interface CronPreview {
  /** Canonical cron expression the input resolved to. */
  cron: string;
  /** Humanized English reading (via cronstrue). */
  human: string;
  /** Fires more than once on the same calendar day. */
  subDaily: boolean;
  /** Fires at a specific time other than midnight. */
  timed: boolean;
}

// The recurrence engine is day-granular: a task is created at most once a day,
// when the app opens or the day rolls over — never at a cron's time-of-day. So
// any time component (a specific hour/minute, or a sub-daily cron firing many
// times a day) is informational only; detect it to warn the user.
const cronTimeInfo = (expr: string): { subDaily: boolean; timed: boolean } => {
  try {
    const it = CronExpressionParser.parse(expr);
    const a = it.next().toDate();
    const b = it.next().toDate();
    const subDaily =
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate();
    const timed =
      a.getHours() !== 0 || a.getMinutes() !== 0 || a.getSeconds() !== 0 || subDaily;
    return { subDaily, timed };
  } catch {
    return { subDaily: false, timed: false };
  }
};

/**
 * Resolves a (possibly natural-language) value to its canonical cron + a
 * humanized English reading so the dialog can show a live preview below the
 * input. Returns null when the value is empty or unrecognized.
 */
export const getCronPreview = (val: unknown): CronPreview | null => {
  if (typeof val !== 'string' || !val.trim()) return null;
  const canonical = isCronExpressionValid(val) ? val.trim() : naturalLanguageToCron(val);
  if (!canonical) return null;
  try {
    const human = cronstrue.toString(canonical, { use24HourTimeFormat: false });
    return { cron: canonical, human, ...cronTimeInfo(canonical) };
  } catch {
    return null;
  }
};
