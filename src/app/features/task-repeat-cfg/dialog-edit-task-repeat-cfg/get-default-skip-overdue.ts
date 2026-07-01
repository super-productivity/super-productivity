import { TaskRepeatCfgCopy } from '../task-repeat-cfg.model';

/**
 * Default value for `skipOverdue` ("Don't let overdue instances pile up") when a
 * NEW recurring config is created.
 *
 * It is ON only for near-daily schedules — the plain "Daily" preset and the
 * "Every workday (Mon–Fri)" preset — because that is where skipping is both
 * useful and safe:
 * - Useful: these are the schedules that actually pile up. Opening the app
 *   across several scheduled days without finishing leaves one empty overdue
 *   copy per day; collapsing those into a single current instance is the calm
 *   default. (A weekly/monthly task has at most one missed occurrence — nothing
 *   piles up, so the default buys nothing there.)
 * - Safe: the next scheduled day is at most a weekend away, so a missed instance
 *   reliably regenerates — it never silently vanishes for a meaningful stretch.
 *   (For "Daily" today is always scheduled, so it can never even drop to zero.)
 *
 * Everything else stays OFF: weekly/monthly/yearly (and sparser custom)
 * schedules keep at most one missed occurrence visible as overdue, so a real
 * obligation — "pay rent on the 1st", "renew the domain" — never silently
 * disappears until its next occurrence. Custom is intentionally limited to the
 * every-single-day case so the rule needs no weekday-count or interval
 * threshold. Users can still flip the option per config either way.
 *
 * Existing configs are unaffected — this only seeds the default for new ones.
 */
export const getDefaultSkipOverdue = (
  cfg: Pick<TaskRepeatCfgCopy, 'quickSetting' | 'repeatCycle'> & {
    repeatEvery?: number;
  },
): boolean => {
  // CUSTOM has no preset; derive from the raw cycle: every single day only.
  // (Deliberately no weekday-count / interval heuristic — see doc above.)
  if (cfg.quickSetting === 'CUSTOM') {
    return cfg.repeatCycle === 'DAILY' && (cfg.repeatEvery ?? 1) === 1;
  }
  // Presets: "Daily" and "Every workday (Mon–Fri)" are the near-daily ones.
  return cfg.quickSetting === 'DAILY' || cfg.quickSetting === 'MONDAY_TO_FRIDAY';
};
