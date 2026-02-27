import { getDbDateStr } from '../../util/get-db-date-str';

/**
 * Helper service for calculating rescheduling dates for various time periods.
 * Used by keyboard shortcuts and task actions to reschedule tasks efficiently.
 */

export type RescheduleType = 
  | 'tomorrow' 
  | 'thisWeek' 
  | 'nextWeek' 
  | 'thisMonth' 
  | 'nextMonth';

/**
 * Calculates the target date for rescheduling a task
 * @param type The reschedule type (tomorrow, thisWeek, nextWeek, thisMonth, nextMonth)
 * @param baseDate Optional base date to calculate from (defaults to today)
 * @returns The Unix timestamp (in milliseconds) for the target date at 9 AM
 */
export const calculateRescheduleDate = (
  type: RescheduleType,
  baseDate: Date = new Date(),
): number => {
  const targetDate = new Date(baseDate);

  switch (type) {
    case 'tomorrow':
      // Tomorrow at 9 AM
      targetDate.setDate(targetDate.getDate() + 1);
      targetDate.setHours(9, 0, 0, 0);
      break;

    case 'thisWeek': {
      // End of this week (Sunday) at 9 AM
      const day = targetDate.getDay();
      const daysUntilSunday = (7 - day) % 7 || 7;
      targetDate.setDate(targetDate.getDate() + daysUntilSunday);
      targetDate.setHours(9, 0, 0, 0);
      break;
    }

    case 'nextWeek': {
      // Start of next week (Monday) at 9 AM
      const day = targetDate.getDay();
      const daysUntilMonday = ((8 - day) % 7) || 1;
      targetDate.setDate(targetDate.getDate() + daysUntilMonday);
      targetDate.setHours(9, 0, 0, 0);
      break;
    }

    case 'thisMonth': {
      // End of this month at 9 AM
      targetDate.setMonth(targetDate.getMonth() + 1);
      targetDate.setDate(0);
      targetDate.setHours(9, 0, 0, 0);
      break;
    }

    case 'nextMonth': {
      // First day of next month at 9 AM
      targetDate.setMonth(targetDate.getMonth() + 1);
      targetDate.setDate(1);
      targetDate.setHours(9, 0, 0, 0);
      break;
    }

    default:
      const _exhaustiveCheck: never = type;
      return _exhaustiveCheck;
  }

  return targetDate.getTime();
};

/**
 * Gets a descriptive label for the reschedule type
 * @param type The reschedule type
 * @returns Human-readable description
 */
export const getRescheduleLabel = (type: RescheduleType): string => {
  const labels: Record<RescheduleType, string> = {
    tomorrow: 'Tomorrow',
    thisWeek: 'End of This Week',
    nextWeek: 'Start of Next Week',
    thisMonth: 'End of This Month',
    nextMonth: 'Start of Next Month',
  };
  return labels[type];
};
