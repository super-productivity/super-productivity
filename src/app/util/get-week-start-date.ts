/**
 * Local date of the first day of the week containing `date`.
 * `firstDayOfWeek` uses `Date.getDay()` numbering (0 = Sunday).
 */
export const getWeekStartDate = (date: Date, firstDayOfWeek: number): Date => {
  const normalizedFirstDayOfWeek = ((firstDayOfWeek % 7) + 7) % 7;
  const weekStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  weekStart.setDate(
    weekStart.getDate() - ((weekStart.getDay() - normalizedFirstDayOfWeek + 7) % 7),
  );
  return weekStart;
};
