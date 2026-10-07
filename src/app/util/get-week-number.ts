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
    const year = date.getUTCFullYear();
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
    const daysDiff = (date.getTime() - week1Start.getTime()) / 86400000;

    // Week number = (days / 7) + 1
    const weekNumber = Math.floor(daysDiff / 7) + 1;

    return weekNumber;
  } else {
    // ISO Week Number: Week 1 is the week containing the first Thursday
    // Copy date so don't modify original
    const isoDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );

    // Set to nearest middle of week based on first day of week
    // (if first day of week is default it will be Thursday):
    // current date + 4 - current day number
    // Make end of week day number 7
    const diff = (7 - (firstDayOfWeek - 1)) % 7;
    isoDate.setUTCDate(
      isoDate.getUTCDate() + 4 - ((isoDate.getUTCDay() + diff) % 7 || 7),
    );

    // Get first day of year
    const yearStart = new Date(Date.UTC(isoDate.getUTCFullYear(), 0, 1));

    // Calculate full weeks to nearest middle of week
    // prettier-ignore
    const weekNo = Math.ceil((((+isoDate - +yearStart) / 86400000) + 1) / 7);

    return weekNo;
  }
};
