import type { TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getFirstRepeatOccurrence } from '../store/get-first-repeat-occurrence.util';
import { getNextRepeatOccurrence } from '../store/get-next-repeat-occurrence.util';
import { getDbDateStr } from '../../../util/get-db-date-str';

// A few skipped dates in a row must not end the preview early, but an
// exhausted rule must not loop.
const MAX_STEPS = 30;

/**
 * The next dates a fixed schedule falls on, for the repeat dialog's "Falls on"
 * line. A preview of the rule, not a forecast of created copies: waiting for
 * completion or a pause can hold a date back, and after-completion schedules
 * have no fixed dates, so callers don't show it for those.
 *
 * A new config starts from its first occurrence (the task itself becomes that
 * copy); an existing one from `from`, inclusive (the dialog passes the logical
 * tomorrow, since today already has its copy). Skipped dates are left out,
 * and the rule's end date is respected by the occurrence helpers.
 */
export const getRulePreviewDates = (
  cfg: TaskRepeatCfg,
  from: Date,
  isNewCfg: boolean,
  count = 3,
): Date[] => {
  const skipped = new Set(cfg.deletedInstanceDates ?? []);
  const dates: Date[] = [];
  let next = isNewCfg
    ? getFirstRepeatOccurrence(cfg)
    : getNextRepeatOccurrence(cfg, from, { inclusive: true });
  for (let step = 0; next && dates.length < count && step < MAX_STEPS; step++) {
    if (!skipped.has(getDbDateStr(next))) {
      dates.push(next);
    }
    // From the following day, inclusive: the exclusive lookup can return the
    // same day again for monthly rules.
    const dayAfter = new Date(next);
    dayAfter.setDate(dayAfter.getDate() + 1);
    next = getNextRepeatOccurrence(cfg, dayAfter, { inclusive: true });
  }
  return dates;
};
