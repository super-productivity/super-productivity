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
  // Issue #6040.
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
  // When true, opening the app after missing several scheduled occurrences creates a
  // task for EACH missed occurrence (capped at the 30 most recent) instead of only
  // the newest. Mutually exclusive with skipOverdue/waitForCompletion.
  createForEachMissed?: boolean;

  // Advanced recurrence: an RFC 5545 RRULE body (e.g. `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO`),
  // stored WITHOUT the `RRULE:` prefix. When set it wins over the legacy schedule
  // fields (repeatEvery, weekday flags, monthly anchors) — the occurrence engine
  // routes on its presence. Stored as an opaque string so it never grows the
  // `repeatCycle` enum, keeping older sync clients forward-compatible: they ignore
  // the unknown field and fall back to `repeatCycle` (kept populated with the
  // FREQ-derived legacy cycle as a best-effort approximation). Lets users express
  // "every other Saturday, March–November, 10 times" in one config.
  rrule?: string;

  // "Ends after N times completed": stop materializing new instances once this
  // many instances have been COMPLETED (done). Distinct from RRULE COUNT, which
  // caps tasks CREATED and lives in the `rrule` string. App-level and optional:
  // absent → open-ended; older sync clients ignore the unknown field (they keep
  // creating, so the cap is only enforced on clients that support it — a soft,
  // self-healing divergence, never data corruption). Enforced in
  // TaskRepeatCfgService._getActionsForTaskRepeatCfg by counting done instances
  // (live + archive) per repeatCfgId.
  endsAfterCompletions?: number;

  // --- Due-date derivation for generated instances ---------------------------
  // Each instance has an "appears" day (the RRULE occurrence, = `created`) and a
  // "due" day. By default Due = appears; these fields let Due be derived from the
  // appears day instead. All optional & app-level (not in the rrule string), so
  // absent → ON_OCCURRENCE (legacy behavior); old sync clients ignore them.
  // Resolved by `getRecurringInstanceDueDate` (recompute-on-read for previews,
  // set on the task at creation). See `util/recurring-due-date.util.ts`.
  dueType?: RepeatDueType;
  // OFFSET only: APPEARS (default) → Due = appears + offset; DUE → the RRULE day
  // IS the due day and the task appears `offset` earlier (lead time).
  dueAnchor?: RepeatDueAnchor;
  // OFFSET / FROM_COMPLETION: explicit gap. Takes precedence over the gap
  // inherited from the template task's own created→due distance.
  dueOffset?: number;
  dueOffsetUnit?: RepeatDueOffsetUnit;
  // FIXED: every instance due on this calendar day (YYYY-MM-DD).
  dueFixedDate?: string;
  // PERIOD_END: which period's end the due day snaps to.
  duePeriod?: RepeatDuePeriod;

  // --- Per-occurrence overrides (RFC 5545 RECURRENCE-ID) ---------------------
  // Keyed by the ORIGINAL occurrence day (YYYY-MM-DD) = the RECURRENCE-ID. Each
  // entry overrides that one instance — move it to another day, or change its
  // time / title / notes / estimate — without touching the rest of the series.
  // `deletedInstanceDates` (EXDATE) still handles a pure skip. A move stays
  // consistent across every projection because it is surfaced to the occurrence
  // engine as EXDATE(original) + RDATE(movedToDay). App-level & optional; older
  // sync clients ignore the field. See `get-repeat-instance-exceptions.util.ts`.
  instanceOverrides?: { [occurrenceDateStr: string]: RepeatInstanceOverride };
}

/** A single RECURRENCE-ID override (see `instanceOverrides`). */
export interface RepeatInstanceOverride {
  movedToDay?: string; // YYYY-MM-DD — reschedule this occurrence (RFC DTSTART override)
  startTime?: string | null; // 'HH:MM', or null to clear the time for this one
  title?: string;
  notes?: string;
  timeEstimate?: number;
}

/** The due-date derivation fields, grouped for the builder in/out. */
export type RepeatDueConfig = Pick<
  TaskRepeatCfgCopy,
  'dueType' | 'dueAnchor' | 'dueOffset' | 'dueOffsetUnit' | 'dueFixedDate' | 'duePeriod'
>;
export type RepeatDueType =
  | 'ON_OCCURRENCE' // Due = the appears day (default)
  | 'OFFSET' // Due = appears ± offset (explicit, or inherited from template)
  | 'UNTIL_NEXT' // Due = day before the next occurrence (rolling deadline)
  | 'FIXED' // Due = a fixed calendar date for every instance
  | 'PERIOD_END' // Due = end of the week/month/quarter/year containing the appears day
  | 'FROM_COMPLETION' // Due = completion day + offset (needs repeatFromCompletionDate)
  | 'NONE'; // no due date
export type RepeatDueAnchor = 'APPEARS' | 'DUE';
export type RepeatDueOffsetUnit = 'DAY' | 'BUSINESS_DAY' | 'WEEK';
export type RepeatDuePeriod = 'WEEK' | 'MONTH' | 'QUARTER' | 'YEAR';

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
  createForEachMissed: false,
};
