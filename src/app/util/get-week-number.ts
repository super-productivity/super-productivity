export const getWeekNumber = (
  d: Date,
  firstDayOfWeek: number = 1,
  weekNumberSystem: 'iso' | 'us' = 'iso',
): number => {
  // Copy date so don't modify original
  const date = new Date(d);

  if (weekNumberSystem === 'us') {
    // US Week Number: Week 1 is the week containing January 1
    // Use UTC for consistent calculation to avoid timezone/DST issues

    // Convert to UTC date first (matching the ISO branch pattern)
    const utcDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );

    // Calculate week 1 start date for the year containing the date
    const year = utcDate.getUTCFullYear();
    const jan1 = new Date(Date.UTC(year, 0, 1));

    // Get the day of week for Jan 1 (0=Sunday, 1=Monday, ..., 6=Saturday)
    const jan1DayOfWeek = jan1.getUTCDay();

    // Calculate days from the start of the week containing Jan 1 to Jan 1
    // The week starts on: Jan 1 - (days from start of week to Jan 1)
    // days from start of week to Jan 1 = (jan1DayOfWeek - firstDayOfWeek + 7) % 7
    const daysFromWeekStartToJan1 = (jan1DayOfWeek - firstDayOfWeek + 7) % 7;
    const week1Start = new Date(jan1);
    week1Start.setUTCDate(jan1.getUTCDate() - daysFromWeekStartToJan1);

    // Calculate days from week 1 start to the target date (in UTC days)
    const daysDiff = (utcDate.getTime() - week1Start.getTime()) / 86400000;

    // Week number = (days / 7) + 1
    const weekNumber = Math.floor(daysDiff / 7) + 1;

    // Handle edge case: if week number is 0 or negative, it belongs to previous year's last week
    if (weekNumber <= 0) {
      // Recalculate for previous year
      const prevYearJan1 = new Date(Date.UTC(year - 1, 0, 1));
      const prevYearJan1DayOfWeek = prevYearJan1.getUTCDay();
      const prevYearDaysFromWeekStartToJan1 =
        (prevYearJan1DayOfWeek - firstDayOfWeek + 7) % 7;
      const prevYearWeek1Start = new Date(prevYearJan1);
      prevYearWeek1Start.setUTCDate(
        prevYearJan1.getUTCDate() - prevYearDaysFromWeekStartToJan1,
      );
      const prevYearDaysDiff =
        (utcDate.getTime() - prevYearWeek1Start.getTime()) / 86400000;
      return Math.floor(prevYearDaysDiff / 7) + 1;
    }

    // Handle edge case: if week number is too large, it belongs to next year's week 1
    // Check if the week containing the date includes Jan 1 of the next year
    // The week contains Jan 1 if: weekStart <= Jan1 < weekStart + 7 days
    const dateDayOfWeek = utcDate.getUTCDay();
    const daysFromWeekStartToDate = (dateDayOfWeek - firstDayOfWeek + 7) % 7;
    const weekStart = new Date(utcDate);
    weekStart.setUTCDate(utcDate.getUTCDate() - daysFromWeekStartToDate);
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekStart.getUTCDate() + 6); // weekStart + 6 days = end of week

    const nextYearJan1 = new Date(Date.UTC(year + 1, 0, 1));
    if (weekStart <= nextYearJan1 && weekEnd >= nextYearJan1) {
      // This week contains Jan 1 of the next year, so use next year's week 1
      const nextYearJan1DayOfWeek = nextYearJan1.getUTCDay();
      const nextYearDaysFromWeekStartToJan1 =
        (nextYearJan1DayOfWeek - firstDayOfWeek + 7) % 7;
      const nextYearWeek1Start = new Date(nextYearJan1);
      nextYearWeek1Start.setUTCDate(
        nextYearJan1.getUTCDate() - nextYearDaysFromWeekStartToJan1,
      );
      // Calculate days from next year's week 1 start to this week's start
      const nextYearDaysDiff =
        (weekStart.getTime() - nextYearWeek1Start.getTime()) / 86400000;
      return Math.floor(nextYearDaysDiff / 7) + 1;
    }

    return weekNumber;
  } else {
    // ISO Week Number: Week 1 is the week containing the first Thursday
    // ISO weeks always start on Monday (firstDayOfWeek parameter is ignored per ISO 8601)
    // Use UTC for consistent calculation to avoid timezone/DST issues

    // Copy date so don't modify original
    const isoDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );

    // ISO 8601: Thursday is the anchor day (week containing first Thursday = week 1)
    // JavaScript getUTCDay(): Sunday=0, Monday=1, ..., Saturday=6
    // Thursday = day 4, so days to Thursday = 4 - currentDay
    const daysToThursday = 4 - isoDate.getUTCDay();
    isoDate.setUTCDate(isoDate.getUTCDate() + daysToThursday);

    // Get first day of year
    const yearStart = new Date(Date.UTC(isoDate.getUTCFullYear(), 0, 1));

    // Calculate full weeks to Thursday
    // prettier-ignore
    const weekNo = Math.ceil((((+isoDate - +yearStart) / 86400000) + 1) / 7);

    return weekNo;
  }
};
