import type { TaskRepeatCfgCopy } from '../task-repeat-cfg.model';

/**
 * Default value for `skipOverdue` ("Don't let overdue instances pile up") when a
 * NEW recurring config is created.
 *
 * ON only for a plain everyday schedule — reached via the "Daily" preset or a
 * CUSTOM every-single-day cycle (both are literally the same schedule, so they
 * get the same default; no "same schedule, different default" surprise). That is
 * the one case where the option is both useful and provably safe:
 * - Useful: everyday tasks are the only ones that actually pile up — one empty
 *   overdue copy per day you fall behind. Collapsing those into a single current
 *   instance is the calm default.
 * - Safe: today is always a scheduled day, so a missed instance regenerates the
 *   same day and can never silently vanish (it cannot even drop to zero).
 *
 * Everything else stays OFF — weekly/monthly/yearly and any every-N-days custom
 * cycle keep their one missed occurrence visible, so a real obligation ("pay
 * rent on the 1st", "renew the domain") never disappears until its next
 * occurrence. Users can still flip the option per config either way.
 *
 * Existing configs are unaffected — this only seeds the default for new ones.
 */
export const getDefaultSkipOverdue = (
  cfg: Pick<TaskRepeatCfgCopy, 'quickSetting' | 'repeatCycle'> & {
    repeatEvery?: number;
  },
): boolean =>
  cfg.quickSetting === 'DAILY' ||
  (cfg.quickSetting === 'CUSTOM' &&
    cfg.repeatCycle === 'DAILY' &&
    (cfg.repeatEvery ?? 1) === 1);
