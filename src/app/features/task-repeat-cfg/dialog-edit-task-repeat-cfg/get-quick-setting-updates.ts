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

// Switching between monthly presets must clear every monthly anchor —
// anchor presence is the discriminator, so a stale Nth-weekday or last-day
// field would silently take effect.
const MONTHLY_ANCHOR_RESET: Partial<TaskRepeatCfg> = {
  monthlyWeekOfMonth: undefined,
  monthlyWeekday: undefined,
  monthlyLastDay: undefined,
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
        ...MONTHLY_ANCHOR_RESET,
      };
    }

    case 'MONTHLY_FIRST_DAY': {
      // Anchor to the next 1st-of-month that is today or later, so the first
      // generated instance is never backdated (#7726). `month + 1` rolls the
      // year over correctly in December.
      const firstDay =
        today.getDate() === 1
          ? new Date(today.getFullYear(), today.getMonth(), 1)
          : new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(firstDay),
        ...MONTHLY_ANCHOR_RESET,
      };
    }

    case 'MONTHLY_LAST_DAY': {
      // First occurrence = the upcoming last day of the current month, which
      // is always today or later. The `monthlyLastDay` flag tells the
      // occurrence engine to clamp to month-end every month, so `startDate`'s
      // day-of-month no longer needs to be a hardcoded 31 (#7726).
      const lastDayThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return {
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(lastDayThisMonth),
        ...MONTHLY_ANCHOR_RESET,
        monthlyLastDay: true,
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
        monthlyLastDay: undefined,
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
