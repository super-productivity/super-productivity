/** Represents a range of a week, including start and end dates */
export interface WeekRange {
  /** Start date of the week */
  start: Date;
  /** End date of the week */
  end: Date;
}

/**
 * Calculates the start and end dates of a week based on a given date and a specified starting day of the week.
 *
 * @param relativeDate - The date relative to which the weekly range is calculated.
 * @param firstDayOfWeek - The day of the week that defines the start of the week (0 = Sunday, 1 = Monday, etc.).
 * @returns An object containing the start and end dates of the week.
 */
export const getWeekRange = (relativeDate: Date, firstDayOfWeek: number): WeekRange => {
  // Get timezone offset in minutes
  const timezoneOffsetInMinutes = relativeDate.getTimezoneOffset();
  const timezoneOffsetInMilliseconds = timezoneOffsetInMinutes * 60000; // Convert to milliseconds

  // Adjust the date by the timezone offset
  const adjustedDate = new Date(relativeDate.getTime() + timezoneOffsetInMilliseconds);

  // Get the day of the week from the adjusted date
  const dayOfWeek = adjustedDate.getDay();

  // Calculate the shift to determine the start of the week
  const shift =
    dayOfWeek >= firstDayOfWeek
      ? dayOfWeek - firstDayOfWeek
      : 7 - (firstDayOfWeek - dayOfWeek);

  // Set the start of the week
  const startOfWeek = new Date(adjustedDate);
  startOfWeek.setDate(adjustedDate.getDate() - shift);
  startOfWeek.setHours(0, 0, 0, 0); // Set time to the start of the day

  // Set the end of the week (6 days later)
  const endOfWeek = new Date(startOfWeek);
  endOfWeek.setDate(startOfWeek.getDate() + 6);
  endOfWeek.setHours(23, 59, 59, 999); // Set time to the end of the day

  return {
    start: startOfWeek,
    end: endOfWeek,
  };
};
