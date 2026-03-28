export interface CalendarIntegrationEvent {
  id: string;
  calProviderId: string;
  title: string;
  description?: string;
  start: number;
  duration: number;
  /**
   * True if this is an all-day event (has VALUE=DATE instead of VALUE=DATE-TIME).
   * All-day events should be treated as "due on a day" rather than scheduled at a specific time.
   */
  isAllDay?: boolean;
  /**
   * Previous IDs this event was known by. Used for backward compatibility
   * when event ID format changes (e.g., recurring event instances).
   */
  legacyIds?: string[];
  /**
   * URL linking to the original calendar event (e.g. Google Calendar, Outlook web).
   * Extracted from the iCal URL property.
   */
  url?: string;
}
