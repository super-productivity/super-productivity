const FRIDAY = 5;
const MONDAY = 1;
const WORK_DAYS_COUNT = 5;

/**
 * On the last work day, Finish day also wraps up the week.
 */
// shortcut: Friday hardcoded, since there is no workdays setting and firstDayOfWeek
// is not the workweek (US weeks start on Sunday) — derive it from a workdays
// setting if Sun–Thu workweeks are reported
export const isFinishWeekDay = (logicalToday: Date): boolean =>
  logicalToday.getDay() === FRIDAY;

/**
 * Monday to Friday of the week after `logicalToday`. On a Monday this is the
 * following Monday, never today.
 */
export const getNextWorkWeekDays = (logicalToday: Date): Date[] => {
  const daysUntilMonday = (MONDAY - logicalToday.getDay() + 7) % 7 || 7;
  return Array.from({ length: WORK_DAYS_COUNT }, (_, i) => {
    // local-date arithmetic keeps the day correct across DST transitions
    const d = new Date(logicalToday);
    d.setDate(d.getDate() + daysUntilMonday + i);
    return d;
  });
};
