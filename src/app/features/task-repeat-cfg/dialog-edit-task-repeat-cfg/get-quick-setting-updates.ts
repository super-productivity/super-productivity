import {
  RepeatQuickSetting,
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfg,
} from '../task-repeat-cfg.model';

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
  switch (quickSetting) {
    case 'DAILY': {
      return {
        repeatCycle: 'DAILY',
        repeatEvery: 1,
      };
    }

    case 'WEEKLY_CURRENT_WEEKDAY': {
      const dateToUse = referenceDate || new Date();
      const weekdayStr = TASK_REPEAT_WEEKDAY_MAP[dateToUse.getDay()];
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
      };
    }

    case 'YEARLY_CURRENT_DATE': {
      return {
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
      };
    }

    case 'CUSTOM':
    default:
  }
  return undefined;
};
