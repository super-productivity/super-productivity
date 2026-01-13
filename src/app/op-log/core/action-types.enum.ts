/**
 * CRITICAL: These string values are IMMUTABLE.
 *
 * They are used for:
 * - Encoding/decoding operations in IndexedDB
 * - Sync between clients
 * - Action matching in reducers
 *
 * NEVER change a string value. To rename an action:
 * 1. Add the new enum member with the OLD string value
 * 2. Update ACTION_TYPE_ALIASES if needed for gradual migration
 *
 * The enum values must match exactly what NgRx action creators produce.
 */
export enum ActionType {
  // Archive actions (A)
  ARCHIVE_COMPRESS = '[Archive] Compress Archive',
  ARCHIVE_FLUSH_YOUNG_TO_OLD = '[Archive] Flush Young to Old',
  ARCHIVE_REMOTE_DATA_APPLIED = '[Archive] Remote Archive Data Applied',

  // Board actions (B)
  BOARDS_ADD = '[Boards] Add Board',
  BOARDS_REMOVE = '[Boards] Remove Board',
  BOARDS_UPDATE = '[Boards] Update Board',
  BOARDS_UPDATE_PANEL_CFG = '[Boards] Update Panel Cfg',
  BOARDS_UPDATE_PANEL_TASK_IDS = '[Boards] Update Panel Cfg TaskIds',

  // GlobalConfig actions (C)
  GLOBAL_CONFIG_UPDATE_SECTION = '[Global Config] Update Global Config Section',

  // Metric actions (E)
  METRIC_ADD = '[Metric] Add Metric',
  METRIC_DELETE = '[Metric] Delete Metric',
  METRIC_UPDATE = '[Metric] Update Metric',
  METRIC_UPSERT = '[Metric] Upsert Metric',
  METRIC_LOG_FOCUS_SESSION = '[Metric] Log Focus Session',

  // Tag actions (G)
  TAG_ADD = '[Tag] Add Tag',
  TAG_UPDATE = '[Tag] Update Tag',
  TAG_DELETE = '[Tag] Delete Tag',
  TAG_DELETE_MULTIPLE = '[Tag] Delete multiple Tags',
  TAG_UPDATE_ORDER = '[Tag] Update Tag Order',
  TAG_UPDATE_ADVANCED_CONFIG = '[Tag] Update Advanced Config',

  // Task Shared actions (H) - multi-entity
  TASK_SHARED_ADD = '[Task Shared] addTask',
  TASK_SHARED_UPDATE = '[Task Shared] updateTask',
  TASK_SHARED_DELETE = '[Task Shared] deleteTask',
  TASK_SHARED_DELETE_MULTIPLE = '[Task Shared] deleteTasks',
  TASK_SHARED_MOVE_TO_ARCHIVE = '[Task Shared] moveToArchive',
  TASK_SHARED_RESTORE = '[Task Shared] restoreTask',
  TASK_SHARED_RESTORE_DELETED = '[Task Shared] restoreDeletedTask',
  TASK_SHARED_CONVERT_TO_MAIN = '[Task Shared] convertToMainTask',
  TASK_SHARED_SCHEDULE_WITH_TIME = '[Task Shared] scheduleTaskWithTime',
  TASK_SHARED_RESCHEDULE_WITH_TIME = '[Task Shared] reScheduleTaskWithTime',
  TASK_SHARED_UNSCHEDULE = '[Task Shared] unscheduleTask',
  TASK_SHARED_DISMISS_REMINDER = '[Task Shared] dismissReminderOnly',
  TASK_SHARED_UPDATE_MULTIPLE = '[Task Shared] updateTasks',
  TASK_SHARED_MOVE_TO_PROJECT = '[Task Shared] moveToOtherProject',
  TASK_SHARED_DELETE_PROJECT = '[Task Shared] deleteProject',
  TASK_SHARED_PLAN_FOR_TODAY = '[Task Shared] planTasksForToday',
  TASK_SHARED_REMOVE_FROM_TODAY = '[Task Shared] removeTasksFromTodayTag',
  TASK_SHARED_ADD_TAG = '[Task Shared] addTagToTask',
  TASK_SHARED_REMOVE_TAGS_ALL = '[Task Shared] removeTagsForAllTasks',
  TASK_SHARED_MOVE_IN_TODAY = '[Task Shared] moveTaskInTodayTagList',
  TASK_SHARED_BATCH_UPDATE_PROJECT = '[Task Shared] batchUpdateForProject',
  TASK_SHARED_DELETE_ISSUE_PROVIDER = '[Task Shared] deleteIssueProvider',
  TASK_SHARED_DELETE_ISSUE_PROVIDERS = '[Task Shared] deleteIssueProviders',
  TASK_SHARED_DELETE_REPEAT_CFG = '[Task Shared] deleteTaskRepeatCfg',
  TASK_SHARED_APPLY_SHORT_SYNTAX = '[Task Shared] applyShortSyntax',

  // IssueProvider actions (I)
  ISSUE_PROVIDER_ADD = '[IssueProvider/API] Add IssueProvider',
  ISSUE_PROVIDER_UPDATE = '[IssueProvider/API] Update IssueProvider',
  ISSUE_PROVIDER_SORT_FIRST = '[IssueProvider/API] Sort IssueProviders First',

  // TimeTracking actions (K)
  TIME_TRACKING_SYNC_SESSIONS = '[TimeTracking] Sync sessions',
  TIME_TRACKING_SYNC_TIME_SPENT = '[TimeTracking] Sync time spent',
  TIME_TRACKING_UPDATE_CONTEXT_DATA = '[TimeTracking] Update Work Context Data',

  // Planner actions (L)
  PLANNER_UPSERT_DAY = '[Planner] Upsert Planner Day',
  PLANNER_TRANSFER_TASK = '[Planner] Transfer Task',
  PLANNER_MOVE_IN_LIST = '[Planner] Move In List',
  PLANNER_MOVE_BEFORE_TASK = '[Planner] Move Before Task',
  PLANNER_PLAN_TASK_FOR_DAY = '[Planner] Plan Task for Day',

  // MenuTree actions (M)
  MENU_TREE_UPDATE_PROJECT = '[MenuTree] Update Project Tree',
  MENU_TREE_UPDATE_TAG = '[MenuTree] Update Tag Tree',
  MENU_TREE_UPDATE_FOLDER = '[MenuTree] Update Folder',
  MENU_TREE_DELETE_FOLDER = '[MenuTree] Delete Folder',

  // Note actions (N)
  NOTE_ADD = '[Note] Add Note',
  NOTE_UPDATE = '[Note] Update Note',
  NOTE_DELETE = '[Note] Delete Note',
  NOTE_UPDATE_ORDER = '[Note] Update Note Order',
  NOTE_MOVE_TO_PROJECT = '[Note] Move to other project',

  // Project actions (P)
  PROJECT_ADD = '[Project] Add Project',
  PROJECT_UPDATE = '[Project] Update Project',
  PROJECT_UPDATE_ORDER = '[Project] Update Project Order',
  PROJECT_UPDATE_ADVANCED_CFG = '[Project] Update Project Advanced Cfg',
  PROJECT_ARCHIVE = '[Project] Archive Project',
  PROJECT_UNARCHIVE = '[Project] Unarchive Project',
  PROJECT_TOGGLE_HIDE = '[Project] Toggle hide from menu',
  PROJECT_MOVE_TASK_IN_BACKLOG = '[Project] Move Task in Backlog',
  PROJECT_MOVE_TASK_UP_BACKLOG = '[Project] Move Task Up in Backlog',
  PROJECT_MOVE_TASK_DOWN_BACKLOG = '[Project] Move Task Down in Backlog',
  PROJECT_MOVE_TASK_TOP_BACKLOG = '[Project] Move Task to Top in Backlog',
  PROJECT_MOVE_TASK_BOTTOM_BACKLOG = '[Project] Move Task to Bottom in Backlog',
  PROJECT_MOVE_TO_BACKLOG = '[Project] Move Task from regular to backlog',
  PROJECT_MOVE_FROM_BACKLOG = '[Project] Move Task from backlog to regular',
  PROJECT_AUTO_MOVE_TO_BACKLOG = '[Project] Auto Move Task from regular to backlog',
  PROJECT_AUTO_MOVE_FROM_BACKLOG = '[Project] Auto Move Task from backlog to regular',
  PROJECT_MOVE_ALL_BACKLOG = '[Project] Move all backlog tasks to regular',

  // TaskRepeatCfg actions (R)
  REPEAT_CFG_ADD = '[TaskRepeatCfg][Task] Add TaskRepeatCfg to Task',
  REPEAT_CFG_UPDATE = '[TaskRepeatCfg] Update TaskRepeatCfg',
  REPEAT_CFG_UPDATE_MULTIPLE = '[TaskRepeatCfg] Update multiple TaskRepeatCfgs',
  REPEAT_CFG_DELETE = '[TaskRepeatCfg] Delete TaskRepeatCfg',
  REPEAT_CFG_DELETE_MULTIPLE = '[TaskRepeatCfg] Delete multiple TaskRepeatCfgs',
  REPEAT_CFG_DELETE_INSTANCE = '[TaskRepeatCfg] Delete Single Instance',
  REPEAT_CFG_UPSERT = '[TaskRepeatCfg] Upsert TaskRepeatCfg',

  // SimpleCounter actions (S)
  COUNTER_ADD = '[SimpleCounter] Add SimpleCounter',
  COUNTER_UPDATE = '[SimpleCounter] Update SimpleCounter',
  COUNTER_UPSERT = '[SimpleCounter] Upsert SimpleCounter',
  COUNTER_DELETE = '[SimpleCounter] Delete SimpleCounter',
  COUNTER_DELETE_MULTIPLE = '[SimpleCounter] Delete multiple SimpleCounters',
  COUNTER_UPDATE_ALL = '[SimpleCounter] Update all SimpleCounters',
  COUNTER_SET_TODAY = '[SimpleCounter] Set SimpleCounter Counter Today',
  COUNTER_INCREASE_TODAY = '[SimpleCounter] Increase SimpleCounter Counter Today',
  COUNTER_DECREASE_TODAY = '[SimpleCounter] Decrease SimpleCounter Counter Today',
  COUNTER_TOGGLE = '[SimpleCounter] Toggle SimpleCounter Counter',
  COUNTER_TURN_OFF_ALL = '[SimpleCounter] Turn off all simple counters',
  COUNTER_SET_OFF = '[SimpleCounter] Set SimpleCounter Counter Off',
  COUNTER_SET_ON = '[SimpleCounter] Set SimpleCounter Counter On',
  // Note: Inconsistent spacing in source - '[Simple Counter]' vs '[SimpleCounter]'
  COUNTER_SET_FOR_DATE = '[Simple Counter] Set SimpleCounter Counter For Date',
  COUNTER_SYNC_TIME = '[SimpleCounter] Sync counter time',

  // Task actions (T)
  TASK_UPDATE_MULTIPLE_SIMPLE = '[Task] Update multiple Tasks (simple)',
  TASK_ADD_SUB = '[Task] Add SubTask',
  TASK_MOVE_SUB = '[Task] Move sub task',
  TASK_MOVE_UP = '[Task] Move up',
  TASK_MOVE_DOWN = '[Task] Move down',
  TASK_MOVE_TOP = '[Task] Move to top',
  TASK_MOVE_BOTTOM = '[Task] Move to bottom',
  TASK_REMOVE_TIME_SPENT = '[Task] Remove time spent',
  TASK_ROUND_TIME_SPENT = '[Task] RoundTimeSpentForDay',
  TASK_ADD_TAGS_SHORT_SYNTAX = '[Task] Add new tags from short syntax',

  // Plugin actions (U)
  PLUGIN_UPSERT_USER_DATA = '[Plugin] Upsert User Data',
  PLUGIN_DELETE_USER_DATA = '[Plugin] Delete User Data',
  PLUGIN_UPSERT_METADATA = '[Plugin] Upsert Metadata',
  PLUGIN_DELETE_METADATA = '[Plugin] Delete Metadata',

  // WorkContextMeta actions (W)
  WORK_CONTEXT_MOVE_UP = '[WorkContextMeta] Move Task Up in Today',
  WORK_CONTEXT_MOVE_DOWN = '[WorkContextMeta] Move Task Down in Today',
  WORK_CONTEXT_MOVE_TOP = '[WorkContextMeta] Move Task To Top in Today',
  WORK_CONTEXT_MOVE_BOTTOM = '[WorkContextMeta] Move Task To Bottom in Today',
  WORK_CONTEXT_MOVE = '[WorkContextMeta] Move Task in Today',

  // TaskAttachment actions (X)
  ATTACHMENT_ADD = '[TaskAttachment] Add TaskAttachment',
  ATTACHMENT_UPDATE = '[TaskAttachment] Update TaskAttachment',
  ATTACHMENT_DELETE = '[TaskAttachment] Delete TaskAttachment',

  // System-level actions (Y)
  LOAD_ALL_DATA = '[SP_ALL] Load(import) all data',
  LOAD_BACKUP_DATA = '[SP_ALL] Load(import) backup file',
  MIGRATION_GENESIS_IMPORT = '[Migration] Genesis Import',
  RECOVERY_DATA_IMPORT = '[Recovery] Data Recovery Import',

  // Repair actions (Z)
  REPAIR_AUTO = '[Repair] Auto Repair',
}
