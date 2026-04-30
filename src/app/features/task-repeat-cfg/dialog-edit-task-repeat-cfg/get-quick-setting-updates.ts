import {
  MonthlyWeekOfMonth,
  MonthlyWeekday,
  RepeatQuickSetting,
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfg,
} from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';

const _buildWeeklyForDay = (date: Date): Partial<TaskRepeatCfg> => {
  const weekdayStr = TASK_REPEAT_WEEKDAY_MAP[date.getDay()];
  return {
    repeatCycle: 'WEEKLY',
    repeatEvery: 1,
    monday: false,
    tuesday: false,
    wednesday: false,
    thursday: false,
    friday: false,
    saturday: false,
    sunday: false,
    [weekdayStr as keyof TaskRepeatCfg]: true,
  };
};

// Switching from a day-of-week preset to a day-of-month preset must clear the
// Nth-weekday anchor — anchor presence is the discriminator, so stale fields
// would silently take effect.
const DAY_OF_MONTH_RESET: Partial<TaskRepeatCfg> = {
  monthlyWeekOfMonth: undefined,
  monthlyWeekday: undefined,
};

/**
 * Returns partial TaskRepeatCfg updates based on the quick setting.
 * @param quickSetting The quick setting to apply
 * @param referenceDate Optional date to use for weekday calculation (fixes #5806).
 *                      If not provided, uses current date.
 */
export const getQuickSettingUpdates = (
  quickSetting: RepeatQuickSetting,
  referenceDate?: Date,
): Partial<TaskRepeatCfg> | undefined => {
  const today = new Date();

  switch (quickSetting) {
    case 'DAILY': {
      return {
        repeatCycle: 'DAILY',
        repeatEvery: 1,
      };
    }

    case 'WEEKLY_CURRENT_WEEKDAY': {
      return _buildWeeklyForDay(referenceDate || today);
    }

    case 'MONDAY_TO_FRIDAY': {
      return {
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      };
    }

    case 'MONTHLY_CURRENT_DATE': {
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
        ...DAY_OF_MONTH_RESET,
      };
    }

    case 'MONTHLY_FIRST_DAY': {
      const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(firstDay),
        ...DAY_OF_MONTH_RESET,
      };
    }

    case 'MONTHLY_LAST_DAY': {
      // Always use day=31 so the occurrence calculator clamps via
      // Math.min(31, lastDayOfMonth), producing true "last day" behavior.
      // Using the current month's last day would fail in short months (e.g. Feb=28).
      const day31 = new Date(today.getFullYear(), 0, 31);
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(day31),
        ...DAY_OF_MONTH_RESET,
      };
    }

    case 'MONTHLY_NTH_WEEKDAY': {
      // Anchors monthly recurrence to "the same Nth weekday of the month"
      // implied by the reference date — e.g. 2026-04-29 is the 5th Wednesday,
      // capped to 4 → "4th Wednesday of every month".
      const ref = referenceDate || today;
      const rawWeekOfMonth = Math.floor((ref.getDate() - 1) / 7) + 1;
      const weekOfMonth = Math.min(rawWeekOfMonth, 4) as MonthlyWeekOfMonth;
      const weekday = ref.getDay() as MonthlyWeekday;
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(ref),
        monthlyWeekOfMonth: weekOfMonth,
        monthlyWeekday: weekday,
      };
    }

    case 'YEARLY_CURRENT_DATE': {
      return {
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
      };
    }

    case 'CUSTOM':
    default:
  }
  return undefined;
};
