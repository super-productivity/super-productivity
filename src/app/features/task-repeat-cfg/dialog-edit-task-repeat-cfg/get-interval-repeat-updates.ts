import { RepeatCycleOption, TaskRepeatCfg } from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { buildWeeklyForDay, MONTHLY_ANCHOR_RESET } from './get-quick-setting-updates';

/**
 * Returns partial TaskRepeatCfg updates for an "every N <cycle>" recurrence —
 * the counterpart of `getQuickSettingUpdates` for schedules no preset can
 * express, since every preset hardcodes `repeatEvery: 1`.
 *
 * `referenceDate` is the first occurrence and becomes the phase anchor: the
 * occurrence utils accept a date only when its distance from `startDate` is a
 * whole multiple of `repeatEvery` (see get-next-repeat-occurrence.util).
 *
 * WEEKLY intervals must also restrict the weekday flags to `referenceDate`'s
 * weekday. The flags are an independent filter in the WEEKLY branch, and
 * DEFAULT_TASK_REPEAT_CFG ships with Mon–Fri enabled, so returning only the
 * cycle and interval would mean "every other week, Monday through Friday"
 * instead of "every other week, on this weekday".
 */
export const getIntervalRepeatUpdates = (
  repeatCycle: RepeatCycleOption,
  repeatEvery: number,
  referenceDate: Date,
): Partial<TaskRepeatCfg> => {
  const startDate = getDbDateStr(referenceDate);

  switch (repeatCycle) {
    case 'DAILY':
      return { quickSetting: 'CUSTOM', repeatCycle, repeatEvery, startDate };

    case 'WEEKLY':
      return {
        quickSetting: 'CUSTOM',
        ...buildWeeklyForDay(referenceDate),
        repeatEvery,
        startDate,
      };

    case 'MONTHLY':
      return {
        quickSetting: 'CUSTOM',
        repeatCycle,
        repeatEvery,
        startDate,
        ...MONTHLY_ANCHOR_RESET,
      };

    case 'YEARLY':
      return { quickSetting: 'CUSTOM', repeatCycle, repeatEvery, startDate };
  }
};
