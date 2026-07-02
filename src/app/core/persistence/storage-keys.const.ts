import { AppDataCompleteLegacy } from '../../imex/sync/sync.model';

export type AllowedDBKeys = keyof AppDataCompleteLegacy | 'SUP_COMPLETE_BACKUP';

// INDEXEDDB
export enum DB {
  BACKUP = 'SUP_COMPLETE_BACKUP',
  // and lots of non hard-coded AppDataComplete keys
}

// REAL LS
export enum LS {
  APP_START_COUNT = 'APP_START_COUNT',
  APP_START_COUNT_LAST_START_DAY = 'APP_START_COUNT_LAST_START_DAY',
  // Epoch ms first observed by SyncSafetyBannerService (seeded once, lazily, on
  // its first run). Used only to tell "used for a while" by wall-clock time for
  // the sync-setup nudge. NOT a true install date: for installs that predate
  // this feature it is seeded at upgrade time, so don't reuse it as one.
  SYNC_SAFETY_FIRST_SEEN = 'SUP_SYNC_SAFETY_FIRST_SEEN',
  RATE_DIALOG_STATE = 'SUP_RATE_DIALOG_STATE',
  // Set on an unhandled error or any detected data damage; read by the rating
  // prompt to hold off for a cooldown after a bad experience. Time only.
  LAST_CRITICAL_ERROR_TIME = 'SUP_LAST_CRITICAL_ERROR_TIME',
  LAST_LOCAL_SYNC_MODEL_CHANGE = 'SUP_LAST_LOCAL_SYNC_MODEL_CHANGE',
  // Epoch ms of the last successful local (auto-)backup write. Recorded by
  // LocalBackupService._backup() only when a platform writer actually wrote (past
  // the meaningful-data and A3 near-empty guards), so it never advances on a
  // skipped/empty/degraded write. Surfaced in Settings so users can see they're
  // protected (#7901).
  LAST_LOCAL_BACKUP = 'SUP_LAST_LOCAL_BACKUP',
  LOCAL_UI_HELPER = 'SUP_UI_HELPER',

  ACTION_LOG = 'SUP_ACTION_LOG',
  ACTION_BEFORE_LAST_ERROR_LOG = 'SUP_LAST_ERROR_ACTION_LOG',
  CHECK_STRAY_PERSISTENCE_BACKUP = 'SUP_CHECK_STRAY_PERSISTENCE_BACKUP',
  IS_PROJECT_LIST_EXPANDED = 'SUP_IS_PROJECT_LIST_EXPANDED',
  IS_TAG_LIST_EXPANDED = 'SUP_IS_TAG_LIST_EXPANDED',

  LAST_NOTE_BANNER_DAY = 'SUP_LAST_NOTE_BANNER_DAY',

  // Set once the user acts on or dismisses the "set up sync to keep your data
  // safe" startup banner, so the nudge is shown at most once ever.
  SYNC_SAFETY_NUDGE_DISMISSED = 'SUP_SYNC_SAFETY_NUDGE_DISMISSED',

  // Epoch ms until which the "encrypt your SuperSync account" migration banner
  // stays hidden. Set when the user picks "Later" (or opens the flow), so — unlike
  // a permanent dismiss — an unencrypted E2EE-intended account is re-nudged calmly
  // rather than nagged every sync or forgotten forever. Device-local, no telemetry.
  SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL = 'SUP_SUPER_SYNC_ENCRYPTION_MIGRATION_SNOOZE_UNTIL',

  SELECTED_TIME_VIEW = 'SELECTED_TIME_VIEW',
  SCHEDULE_WEEK_ROW_HEIGHT = 'SUP_SCHEDULE_WEEK_ROW_HEIGHT',

  CAL_EVENTS_CACHE = 'SUP_CAL_EVENTS_CACHE',
  CALENDER_EVENTS_SKIPPED_TODAY = 'SUP_CALENDER_EVENTS_SKIPPED_TODAY',
  CALENDER_EVENTS_LAST_SKIP_DAY = 'SUP_CALENDER_EVENTS_LAST_SKIP_DAY',
  HIDDEN_CALENDAR_EVENT_IDS = 'SUP_HIDDEN_CALENDAR_EVENT_IDS',
  HIDDEN_CALENDAR_PROVIDER_IDS = 'SUP_HIDDEN_CALENDAR_PROVIDER_IDS',

  ISSUE_SEARCH_CACHE = 'SUP_ISSUE_SEARCH_CACHE',

  // NOTE: key is different, but we keep it to avoid showing it again
  IS_SKIP_TOUR = 'SUP_IS_SHOW_TOUR',

  ONBOARDING_PRESET_DONE = 'SUP_ONBOARDING_PRESET_DONE',
  ONBOARDING_HINTS_DONE = 'SUP_ONBOARDING_HINTS_DONE',

  LAST_FULLSCREEN_EDIT_VIEW_MODE = 'SUP_LAST_FULLSCREEN_EDIT_VIEW_MODE',

  // Remembers the last-used idle-dialog mode so it pre-selects next time
  LAST_IDLE_DIALOG_MODE = 'SUP_LAST_IDLE_DIALOG_MODE',

  WEB_APP_INSTALL = 'WEB_APP_INSTALL',

  IS_ADD_TO_BOTTOM = 'SUP_IS_ADD_TO_BOTTOM',

  FOCUS_MODE_MODE = 'FOCUS_MODE_MODE',
  LAST_COUNTDOWN_DURATION = 'LAST_COUNTDOWN_DURATION',

  DARK_MODE = 'DARK_MODE',
  CUSTOM_THEME = 'CUSTOM_THEME',

  SELECTED_BOARD = 'SELECTED_BOARD',
  DONE_TASKS_HIDDEN = 'DONE_TASKS_HIDDEN',
  EXAMPLE_TASKS_CREATED = 'SUP_EXAMPLE_TASKS_CREATED',
  LATER_TODAY_TASKS_HIDDEN = 'LATER_TODAY_TASKS_HIDDEN',
  OVERDUE_TASKS_HIDDEN = 'OVERDUE_TASKS_HIDDEN',
  REPEAT_CFGS_HIDDEN = 'REPEAT_CFGS_HIDDEN',
  PLAINSPACE_CLAIM_POOL_HIDDEN = 'PLAINSPACE_CLAIM_POOL_HIDDEN',
  // Plainspace account/identity — local-only, never synced (device identity).
  PLAINSPACE_ACCOUNT = 'SUP_PLAINSPACE_ACCOUNT',

  // Magic side nav
  NAV_SIDEBAR_EXPANDED = 'SUP_NAV_SIDEBAR_EXPANDED',
  NAV_SIDEBAR_WIDTH = 'SUP_NAV_SIDEBAR_WIDTH',
  RIGHT_PANEL_WIDTH = 'SUP_RIGHT_PANEL_WIDTH',

  // Task view customizer
  TASK_VIEW_CUSTOMIZER_BY_CONTEXT = 'SUP_TASK_VIEW_CUSTOMIZER_BY_CONTEXT',
}

// SESSION STORAGE
export enum SS {
  NOTE_TMP = 'NOTE_TMP_EDIT',
  PROJECT_TMP = 'PROJECT_TMP_EDIT',
  JIRA_WONKY_COOKIE = 'JIRA_WONKY_COOKIE',
  TODO_TMP = 'TODO_TMP_EDIT',
  ADD_TASK_BAR_TXT = 'ADD_TASK_BAR_TXT',
  ADD_TASK_BAR_NOTE = 'ADD_TASK_BAR_NOTE',
}

// LEGACY KEYS
export const DB_LEGACY_PROJECT_PREFIX = 'SUP_P_';
