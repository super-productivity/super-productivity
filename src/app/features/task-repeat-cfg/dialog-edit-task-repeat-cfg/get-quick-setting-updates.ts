import {
  MonthlyWeekOfMonth,
  MonthlyWeekday,
  RepeatQuickSetting,
  TASK_REPEAT_WEEKDAY_MAP,
  TaskRepeatCfg,
} from '../task-repeat-cfg.model';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { legacyTaskRepeatCfgToRRule } from '../util/legacy-cfg-to-rrule.util';

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
// field would silently take effect. The numeric anchors clear via `undefined`
// (NOT `null` — released clients' typia schema only allows absent-or-numeric,
// so null must never reach the wire); remote clients keep a stale anchor on
// the update path (JSON drops the key) — inert on rrule-aware clients (the
// engine routes on the `rrule` every preset also carries), an inherent and
// unfixable gap on PRE-rrule clients (see the op-log round-trip spec).
// `monthlyLastDay` clears via `false`, a master-safe value that DOES survive
// the JSON wire.
const MONTHLY_ANCHOR_RESET: Partial<TaskRepeatCfg> = {
  monthlyWeekOfMonth: undefined,
  monthlyWeekday: undefined,
  monthlyLastDay: false,
};

/**
 * Returns partial TaskRepeatCfg updates based on the quick setting.
 *
 * Every preset is now an RRULE preset: it sets the legacy fields (kept populated
 * for old-client forward-compat) AND a canonical `rrule` derived from them via
 * `legacyTaskRepeatCfgToRRule`, so new configs are rrule-backed and run on the
 * single rrule engine path. The 'RRULE' builder mode assembles its own rrule, so
 * it returns the legacy baseline only (no rrule here).
 *
 * @param quickSetting The quick setting to apply
 * @param referenceDate Optional date to use for weekday calculation (fixes #5806).
 *                      If not provided, uses current date.
 */
export const getQuickSettingUpdates = (
  quickSetting: RepeatQuickSetting,
  referenceDate?: Date,
): Partial<TaskRepeatCfg> | undefined => {
  const today = new Date();

  // Attach the canonical rrule derived from the same legacy fields the preset sets.
  const withRRule = (u: Partial<TaskRepeatCfg>): Partial<TaskRepeatCfg> => ({
    ...u,
    rrule: legacyTaskRepeatCfgToRRule(u as TaskRepeatCfg),
  });

  switch (quickSetting) {
    case 'DAILY': {
      return withRRule({
        repeatCycle: 'DAILY',
        repeatEvery: 1,
      });
    }

    case 'EVERY_OTHER_DAY': {
      return withRRule({
        repeatCycle: 'DAILY',
        repeatEvery: 2,
      });
    }

    case 'WEEKLY_CURRENT_WEEKDAY': {
      return withRRule(_buildWeeklyForDay(referenceDate || today));
    }

    case 'BIWEEKLY_CURRENT_WEEKDAY': {
      // Same single-weekday anchor as WEEKLY_CURRENT_WEEKDAY, but every 2nd week.
      return withRRule({
        ..._buildWeeklyForDay(referenceDate || today),
        repeatEvery: 2,
      });
    }

    case 'WEEKENDS': {
      return withRRule({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        monday: false,
        tuesday: false,
        wednesday: false,
        thursday: false,
        friday: false,
        saturday: true,
        sunday: true,
      });
    }

    case 'MONDAY_TO_FRIDAY': {
      return withRRule({
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: false,
        sunday: false,
      });
    }

    case 'MONTHLY_CURRENT_DATE': {
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
        ...MONTHLY_ANCHOR_RESET,
      });
    }

    case 'QUARTERLY_CURRENT_DATE': {
      // Same day-of-month anchor as MONTHLY_CURRENT_DATE, every 3rd month.
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 3,
        startDate: getDbDateStr(referenceDate || today),
        ...MONTHLY_ANCHOR_RESET,
      });
    }

    case 'SEMIANNUALLY_CURRENT_DATE': {
      // Day-of-month anchor, every 6th month.
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 6,
        startDate: getDbDateStr(referenceDate || today),
        ...MONTHLY_ANCHOR_RESET,
      });
    }

    case 'MONTHLY_FIRST_DAY': {
      // Anchor to the next 1st-of-month that is today or later, so the first
      // generated instance is never backdated (#7726). `month + 1` rolls the
      // year over correctly in December.
      const firstDay =
        today.getDate() === 1
          ? new Date(today.getFullYear(), today.getMonth(), 1)
          : new Date(today.getFullYear(), today.getMonth() + 1, 1);
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(firstDay),
        ...MONTHLY_ANCHOR_RESET,
      });
    }

    case 'MONTHLY_LAST_DAY': {
      // First occurrence = the upcoming last day of the current month, which
      // is always today or later. The `monthlyLastDay` flag tells the
      // occurrence engine to clamp to month-end every month, so `startDate`'s
      // day-of-month no longer needs to be a hardcoded 31 (#7726).
      const lastDayThisMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(lastDayThisMonth),
        ...MONTHLY_ANCHOR_RESET,
        monthlyLastDay: true,
      });
    }

    case 'MONTHLY_NTH_WEEKDAY': {
      // Anchors monthly recurrence to "the same Nth weekday of the month"
      // implied by the reference date — e.g. 2026-04-29 is the 5th Wednesday,
      // capped to 4 → "4th Wednesday of every month".
      const ref = referenceDate || today;
      const rawWeekOfMonth = Math.floor((ref.getDate() - 1) / 7) + 1;
      const weekOfMonth = Math.min(rawWeekOfMonth, 4) as MonthlyWeekOfMonth;
      const weekday = ref.getDay() as MonthlyWeekday;
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(ref),
        monthlyWeekOfMonth: weekOfMonth,
        monthlyWeekday: weekday,
        monthlyLastDay: false,
      });
    }

    case 'MONTHLY_LAST_WEEKDAY': {
      // "Last <weekday> of every month" for the reference date's weekday, e.g.
      // 2026-06-26 (a Friday) → last Friday each month (monthlyWeekOfMonth -1).
      const ref = referenceDate || today;
      return withRRule({
        repeatCycle: 'MONTHLY',
        repeatEvery: 1,
        startDate: getDbDateStr(ref),
        monthlyWeekOfMonth: -1,
        monthlyWeekday: ref.getDay() as MonthlyWeekday,
        monthlyLastDay: false,
      });
    }

    case 'YEARLY_CURRENT_DATE': {
      return withRRule({
        repeatCycle: 'YEARLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
      });
    }

    case 'EVERY_OTHER_YEAR_CURRENT_DATE': {
      // Same day/month anchor as YEARLY_CURRENT_DATE, every 2nd year.
      return withRRule({
        repeatCycle: 'YEARLY',
        repeatEvery: 2,
        startDate: getDbDateStr(referenceDate || today),
      });
    }

    case 'RRULE': {
      // Advanced RRULE builder. The opaque `rrule` string is assembled by the
      // dialog from the builder dropdowns; here we just set a clean baseline —
      // a default WEEKLY repeatCycle (older-client fallback) and a start date.
      return {
        repeatCycle: 'WEEKLY',
        repeatEvery: 1,
        startDate: getDbDateStr(referenceDate || today),
        ...MONTHLY_ANCHOR_RESET,
      };
    }

    default:
  }
  return undefined;
};
