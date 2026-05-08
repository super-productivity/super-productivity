import { CalendarIntegrationEvent } from './calendar-integration.model';

export const passesCalendarEventRegexFilter = (
  calEv: CalendarIntegrationEvent,
  filterIncludeRegex: string | null | undefined,
  filterExcludeRegex: string | null | undefined,
): boolean => {
  if (filterIncludeRegex) {
    try {
      if (!new RegExp(filterIncludeRegex, 'i').test(calEv.title)) {
        return false;
      }
    } catch {
      // invalid regex — ignore filter
    }
  }

  if (filterExcludeRegex) {
    try {
      if (new RegExp(filterExcludeRegex, 'i').test(calEv.title)) {
        return false;
      }
    } catch {
      // invalid regex — ignore filter
    }
  }

  return true;
};
