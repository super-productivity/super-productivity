/**
 * Generates a deterministic task ID from a calendar provider ID and event ID.
 * This ensures that the same calendar event produces the same task ID on all
 * devices, preventing duplicates when multiple devices auto-import events.
 *
 * Uses the raw inputs as a natural key — zero collision risk.
 */
export const generateCalendarTaskId = (
  issueProviderId: string,
  calendarEventId: string,
): string => {
  return `cal_${issueProviderId}_${calendarEventId}`;
};
