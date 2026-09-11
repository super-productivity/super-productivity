import { AddTaskBarRepeat } from './add-task-bar.const';
import { skipExcludedWeekend } from '../short-syntax';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDbDateStr, isValidDBDateStr } from '../../../util/get-db-date-str';

/**
 * The day a workday recurrence really starts on, given the day it was asked to
 * start on.
 *
 * MONDAY_TO_FRIDAY is the only preset with an excluded-day set, so it is the
 * only one whose picked date can name a day the recurrence never lands on.
 * DAILY has no exclusions, and the weekly/monthly/yearly presets derive their
 * own anchor from the date rather than excluding days. (The two that ignore
 * the date entirely — MONTHLY_FIRST_DAY and MONTHLY_LAST_DAY — diverge from it
 * in a different way, unrelated to excluded days and not handled here.)
 *
 * Total over its input: returns `dateStr` unchanged for every other schedule,
 * for no schedule at all, and for anything that is not a `YYYY-MM-DD` calendar
 * day — so a caller can use the result unconditionally.
 */
export const rollWeekendDateForRepeat = (
  dateStr: string,
  repeat: AddTaskBarRepeat | null,
): string => {
  if (repeat?.type !== 'PRESET' || repeat.quickSetting !== 'MONDAY_TO_FRIDAY') {
    return dateStr;
  }
  // Validated before the parse rather than after it: `dateStrToUtcDate` reports
  // a malformed string through `devError`, which throws outside production — so
  // a guard on the Invalid Date it returns would be unreachable in dev and in
  // test, the builds that would surface the bug. Unguarded, `getDbDateStr`
  // renders that Invalid Date as the literal "NaN-NaN-NaN", and every caller
  // here persists and syncs what it gets back.
  if (!isValidDBDateStr(dateStr)) {
    return dateStr;
  }
  const date = dateStrToUtcDate(dateStr);
  skipExcludedWeekend(date);
  return getDbDateStr(date);
};
