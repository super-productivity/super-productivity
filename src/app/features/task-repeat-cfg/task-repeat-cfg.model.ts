import { EntityState } from '@ngrx/entity';
import { TaskReminderOptionId } from '../tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';

export const TASK_REPEAT_WEEKDAY_MAP: (keyof TaskRepeatCfg)[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];

export type RepeatCycleOption = 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
export type RepeatQuickSetting =
  | 'DAILY'
  | 'EVERY_OTHER_DAY'
  | 'WEEKLY_CURRENT_WEEKDAY'
  | 'BIWEEKLY_CURRENT_WEEKDAY'
  | 'WEEKENDS'
  | 'MONTHLY_CURRENT_DATE'
  | 'MONTHLY_FIRST_DAY'
  | 'MONTHLY_LAST_DAY'
  | 'MONTHLY_NTH_WEEKDAY'
  | 'MONTHLY_LAST_WEEKDAY'
  | 'QUARTERLY_CURRENT_DATE'
  | 'SEMIANNUALLY_CURRENT_DATE'
  | 'MONDAY_TO_FRIDAY'
  | 'YEARLY_CURRENT_DATE'
  | 'EVERY_OTHER_YEAR_CURRENT_DATE'
  | 'RRULE'
  // Legacy persisted value only — the "Custom" UI was removed; such cfgs are
  // migrated to 'RRULE' on open (legacyTaskRepeatCfgToRRule). Kept in the union
  // because existing stored data and data-repair still produce it.
  | 'CUSTOM';

// Every concrete preset, in menu order — excludes the 'RRULE' builder mode and
// the legacy 'CUSTOM' persistence value. Single source for preset-driven logic
// (dialog preset detection + preset inference); a preset missing here would
// silently reopen as the generic RRULE builder.
export const QUICK_SETTING_PRESETS: readonly RepeatQuickSetting[] = [
  'DAILY',
  'EVERY_OTHER_DAY',
  'MONDAY_TO_FRIDAY',
  'WEEKENDS',
  'WEEKLY_CURRENT_WEEKDAY',
  'BIWEEKLY_CURRENT_WEEKDAY',
  'MONTHLY_CURRENT_DATE',
  'MONTHLY_FIRST_DAY',
  'MONTHLY_LAST_DAY',
  'MONTHLY_NTH_WEEKDAY',
  'MONTHLY_LAST_WEEKDAY',
  'QUARTERLY_CURRENT_DATE',
  'SEMIANNUALLY_CURRENT_DATE',
  'YEARLY_CURRENT_DATE',
  'EVERY_OTHER_YEAR_CURRENT_DATE',
];

// The quickSetting values present in the RELEASED (master) RepeatQuickSetting
// union — the ONLY values safe to PERSIST/sync. typia sync-validation on an
// older/mobile client rejects any out-of-union value on this required field, so
// the newer literals (incl. 'RRULE' and the extra presets) must never reach a
// stored cfg. They drive the dialog UI in-memory only; persisted cfgs use
// 'CUSTOM' and the builder reconstructs from the `rrule` string on open.
export const MASTER_SAFE_QUICK_SETTINGS: ReadonlySet<RepeatQuickSetting> =
  new Set<RepeatQuickSetting>([
    'DAILY',
    'WEEKLY_CURRENT_WEEKDAY',
    'MONTHLY_CURRENT_DATE',
    'MONTHLY_FIRST_DAY',
    'MONTHLY_LAST_DAY',
    'MONTHLY_NTH_WEEKDAY',
    'MONDAY_TO_FRIDAY',
    'YEARLY_CURRENT_DATE',
    'CUSTOM',
  ]);

/** Map a quick-setting to a value safe to persist (non-master → 'CUSTOM'). */
export const toSyncSafeQuickSetting = (qs: RepeatQuickSetting): RepeatQuickSetting =>
  MASTER_SAFE_QUICK_SETTINGS.has(qs) ? qs : 'CUSTOM';

// MONTHLY Nth-weekday anchor (issue #6040). Both fields together form an
// anchor like "first Thursday" or "last Monday"; either field absent /
// out-of-range falls back to legacy day-of-month recurrence.
// 1..4 = 1st through 4th occurrence; -1 = last occurrence in the month
export type MonthlyWeekOfMonth = 1 | 2 | 3 | 4 | -1;
// 0 = Sunday … 6 = Saturday (matches Date.getDay() and TASK_REPEAT_WEEKDAY_MAP)
export type MonthlyWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

export interface TaskRepeatCfgCopy {
  id: string;
  projectId: string | null;
  // TODO remove at some point
  lastTaskCreation?: number;
  lastTaskCreationDay?: string;
  title: string | null;
  tagIds: string[];
  /**
   * @deprecated No longer configurable via UI. Kept for backwards compatibility.
   * order<=0 → task inserted at top; order>0 → task inserted at bottom.
   */
  order: number;
  defaultEstimate?: number;
  startTime?: string;
  remindAt?: TaskReminderOptionId;

  // actual repeat cfg fields
  isPaused: boolean;
  // has no direct effect, but is used to update values inside form
  quickSetting: RepeatQuickSetting;
  repeatCycle: RepeatCycleOption;
  // worklog string; only in effect for monthly/yearly
  startDate?: string;
  repeatEvery: number;
  monday?: boolean;
  tuesday?: boolean;
  wednesday?: boolean;
  thursday?: boolean;
  friday?: boolean;
  saturday?: boolean;
  sunday?: boolean;

  // MONTHLY-only: when both fields are set and in range, the recurrence
  // anchors to the Nth weekday of each month instead of the numeric day.
  // Anchor presence is the discriminator — there is no separate mode field.
  // ONLY absent-or-numeric is sync-safe: released clients' typia schema has no
  // `null` here, so a null must never be persisted (clearing happens via
  // `undefined`; a stale anchor on remote clients is inert once `rrule` is
  // set, since the occurrence engine routes on it). Issue #6040.
  // INHERENT GAP (not fixable, don't try): an `undefined` clear is dropped by
  // the op-log's JSON partial-update merge, so a remote PRE-rrule client (which
  // ignores `rrule`) keeps scheduling from a stale anchor after an nth-weekday →
  // day-of-month switch. There is no in-schema value meaning "no anchor" to send
  // instead (0 is a valid weekday; null/0 trip released clients' repair dialog).
  // A `| null` migration would NOT help: it only benefits a client that is
  // null-aware yet rrule-UNAWARE, but null can only ship with-or-after rrule, so
  // that band is empty — any client new enough to accept the null clear already
  // routes on `rrule`, where the stale anchor is inert. Only the UPDATE path is
  // affected (ADD sends the field absent → no anchor remotely). See the op-log
  // JSON round-trip spec pinning this behavior.
  monthlyWeekOfMonth?: MonthlyWeekOfMonth;
  monthlyWeekday?: MonthlyWeekday;

  // MONTHLY-only: when true, the recurrence anchors to the last calendar day
  // of every month (28/29/30/31) regardless of `startDate`'s day-of-month.
  // Decouples the anchor from `startDate` so the first occurrence is never
  // backdated. Mutually exclusive with the Nth-weekday anchor above; if a
  // malformed payload sets both, the Nth-weekday anchor wins (checked first
  // by all recurrence calc utils). Issue #7726.
  monthlyLastDay?: boolean;

  // advanced
  notes: string | undefined;
  // ... possible sub tasks & attachments
  shouldInheritSubtasks?: boolean;
  // Base new start date on completion date
  repeatFromCompletionDate?: boolean;
  // Only create next task after current one is completed (prevents pile-up of uncompleted recurring tasks)
  waitForCompletion?: boolean;
  // new UX: disable auto update checkbox (auto-update is default)
  disableAutoUpdateSubtasks?: boolean;
  subTaskTemplates?: {
    title: string;
    timeEstimate?: number;
    notes?: string;
  }[];
  // Exception list for deleted instances (ISO date strings YYYY-MM-DD)
  deletedInstanceDates?: string[];
  // When true, missed/overdue instances are silently skipped instead of being created
  skipOverdue?: boolean;

  // Advanced recurrence: an RFC 5545 RRULE body (e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO`),
  // stored WITHOUT the `RRULE:` prefix. When set it wins over the legacy schedule
  // fields (repeatEvery, weekday flags, monthly anchors) — the occurrence engine
  // routes on its presence. Stored as an opaque string so it never grows the
  // `repeatCycle` enum, keeping older sync clients forward-compatible: they ignore
  // the unknown field and fall back to `repeatCycle` (kept populated with the
  // FREQ-derived legacy cycle as a best-effort approximation). Lets users express
  // "every other Saturday, March–November, 10 times" in one config.
  rrule?: string;
}

export type TaskRepeatCfg = Readonly<TaskRepeatCfgCopy>;

export type TaskRepeatCfgState = EntityState<TaskRepeatCfg>;

export const DEFAULT_TASK_REPEAT_CFG: Omit<TaskRepeatCfgCopy, 'id'> = {
  lastTaskCreation: Date.now(),
  lastTaskCreationDay: getDbDateStr(),
  title: null,
  defaultEstimate: undefined,

  // id: undefined,
  projectId: null,

  startTime: undefined,
  startDate: undefined,
  repeatEvery: 1,
  remindAt: undefined,
  isPaused: false,
  quickSetting: 'DAILY',
  repeatCycle: 'WEEKLY',
  repeatFromCompletionDate: false,
  waitForCompletion: false,
  monday: true,
  tuesday: true,
  wednesday: true,
  thursday: true,
  friday: true,
  saturday: false,
  sunday: false,
  tagIds: [],
  order: 0,

  notes: undefined,
  shouldInheritSubtasks: false,
  disableAutoUpdateSubtasks: false,
  skipOverdue: false,
};
