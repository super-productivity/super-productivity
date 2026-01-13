import { ActionType } from '../../../../op-log/core/action-types.enum';

/**
 * Short codes for action types in the compact operation format.
 *
 * Naming convention:
 * - First char = entity type prefix
 * - Second char = operation (A=Add, U=Update, D=Delete, M=Move)
 * - Optional third char = modifier
 *
 * Entity prefixes:
 * - T = Task
 * - P = Project
 * - G = taG (T already used)
 * - N = Note
 * - S = SimpleCounter
 * - R = TaskRepeatCfg
 * - K = TimeTracking
 * - A = Archive
 * - L = Planner
 * - C = GlobalConfig
 * - B = Board
 * - M = MenuTree
 * - I = IssueProvider
 * - X = TaskAttachment
 * - E = Metric
 * - W = WorkContextMeta
 * - U = Plugin
 * - H = Task Shared (multi-entity actions)
 *
 * IMPORTANT: Never change assigned codes - add new codes for new actions.
 */

export const ACTION_TYPE_TO_CODE: Record<ActionType, string> = {
  // Archive actions (A)
  [ActionType.ARCHIVE_COMPRESS]: 'AC',
  [ActionType.ARCHIVE_FLUSH_YOUNG_TO_OLD]: 'AF',
  [ActionType.ARCHIVE_REMOTE_DATA_APPLIED]: 'AR',

  // Board actions (B)
  [ActionType.BOARDS_ADD]: 'BA',
  [ActionType.BOARDS_REMOVE]: 'BD',
  [ActionType.BOARDS_UPDATE]: 'BU',
  [ActionType.BOARDS_UPDATE_PANEL_CFG]: 'BP',
  [ActionType.BOARDS_UPDATE_PANEL_TASK_IDS]: 'BT',

  // GlobalConfig actions (C)
  [ActionType.GLOBAL_CONFIG_UPDATE_SECTION]: 'CU',

  // Metric actions (E)
  [ActionType.METRIC_ADD]: 'EA',
  [ActionType.METRIC_DELETE]: 'ED',
  [ActionType.METRIC_UPDATE]: 'EU',
  [ActionType.METRIC_UPSERT]: 'EX',
  [ActionType.METRIC_LOG_FOCUS_SESSION]: 'EL',

  // Tag actions (G)
  [ActionType.TAG_ADD]: 'GA',
  [ActionType.TAG_UPDATE]: 'GU',
  [ActionType.TAG_DELETE]: 'GD',
  [ActionType.TAG_DELETE_MULTIPLE]: 'GDM',
  [ActionType.TAG_UPDATE_ORDER]: 'GO',
  [ActionType.TAG_UPDATE_ADVANCED_CONFIG]: 'GC',

  // Task Shared actions (H) - multi-entity
  [ActionType.TASK_SHARED_ADD]: 'HA',
  [ActionType.TASK_SHARED_UPDATE]: 'HU',
  [ActionType.TASK_SHARED_DELETE]: 'HD',
  [ActionType.TASK_SHARED_DELETE_MULTIPLE]: 'HDM',
  [ActionType.TASK_SHARED_MOVE_TO_ARCHIVE]: 'HX',
  [ActionType.TASK_SHARED_RESTORE]: 'HR',
  [ActionType.TASK_SHARED_RESTORE_DELETED]: 'HRD',
  [ActionType.TASK_SHARED_CONVERT_TO_MAIN]: 'HC',
  [ActionType.TASK_SHARED_SCHEDULE_WITH_TIME]: 'HS',
  [ActionType.TASK_SHARED_RESCHEDULE_WITH_TIME]: 'HSR',
  [ActionType.TASK_SHARED_UNSCHEDULE]: 'HSX',
  [ActionType.TASK_SHARED_DISMISS_REMINDER]: 'HRX',
  [ActionType.TASK_SHARED_UPDATE_MULTIPLE]: 'HUM',
  [ActionType.TASK_SHARED_MOVE_TO_PROJECT]: 'HMP',
  [ActionType.TASK_SHARED_DELETE_PROJECT]: 'HPD',
  [ActionType.TASK_SHARED_PLAN_FOR_TODAY]: 'HPT',
  [ActionType.TASK_SHARED_REMOVE_FROM_TODAY]: 'HRT',
  [ActionType.TASK_SHARED_ADD_TAG]: 'HGT',
  [ActionType.TASK_SHARED_REMOVE_TAGS_ALL]: 'HGR',
  [ActionType.TASK_SHARED_MOVE_IN_TODAY]: 'HMT',
  [ActionType.TASK_SHARED_BATCH_UPDATE_PROJECT]: 'HBP',
  [ActionType.TASK_SHARED_DELETE_ISSUE_PROVIDER]: 'HID',
  [ActionType.TASK_SHARED_DELETE_ISSUE_PROVIDERS]: 'HIM',
  [ActionType.TASK_SHARED_DELETE_REPEAT_CFG]: 'HRC',
  [ActionType.TASK_SHARED_APPLY_SHORT_SYNTAX]: 'HSS',

  // IssueProvider actions (I)
  [ActionType.ISSUE_PROVIDER_ADD]: 'IA',
  [ActionType.ISSUE_PROVIDER_UPDATE]: 'IU',
  [ActionType.ISSUE_PROVIDER_SORT_FIRST]: 'IS',

  // TimeTracking actions (K)
  [ActionType.TIME_TRACKING_SYNC_SESSIONS]: 'KS',
  [ActionType.TIME_TRACKING_SYNC_TIME_SPENT]: 'KT',
  [ActionType.TIME_TRACKING_UPDATE_CONTEXT_DATA]: 'KW',

  // Planner actions (L)
  [ActionType.PLANNER_UPSERT_DAY]: 'LU',
  [ActionType.PLANNER_TRANSFER_TASK]: 'LT',
  [ActionType.PLANNER_MOVE_IN_LIST]: 'LM',
  [ActionType.PLANNER_MOVE_BEFORE_TASK]: 'LB',
  [ActionType.PLANNER_PLAN_TASK_FOR_DAY]: 'LP',

  // MenuTree actions (M)
  [ActionType.MENU_TREE_UPDATE_PROJECT]: 'MP',
  [ActionType.MENU_TREE_UPDATE_TAG]: 'MG',
  [ActionType.MENU_TREE_UPDATE_FOLDER]: 'MU',
  [ActionType.MENU_TREE_DELETE_FOLDER]: 'MD',

  // Note actions (N)
  [ActionType.NOTE_ADD]: 'NA',
  [ActionType.NOTE_UPDATE]: 'NU',
  [ActionType.NOTE_DELETE]: 'ND',
  [ActionType.NOTE_UPDATE_ORDER]: 'NO',
  [ActionType.NOTE_MOVE_TO_PROJECT]: 'NM',

  // Project actions (P)
  [ActionType.PROJECT_ADD]: 'PA',
  [ActionType.PROJECT_UPDATE]: 'PU',
  [ActionType.PROJECT_UPDATE_ORDER]: 'PO',
  [ActionType.PROJECT_UPDATE_ADVANCED_CFG]: 'PC',
  [ActionType.PROJECT_ARCHIVE]: 'PX',
  [ActionType.PROJECT_UNARCHIVE]: 'PR',
  [ActionType.PROJECT_TOGGLE_HIDE]: 'PH',
  [ActionType.PROJECT_MOVE_TASK_IN_BACKLOG]: 'PM',
  [ActionType.PROJECT_MOVE_TASK_UP_BACKLOG]: 'PMU',
  [ActionType.PROJECT_MOVE_TASK_DOWN_BACKLOG]: 'PMD',
  [ActionType.PROJECT_MOVE_TASK_TOP_BACKLOG]: 'PMT',
  [ActionType.PROJECT_MOVE_TASK_BOTTOM_BACKLOG]: 'PMB',
  [ActionType.PROJECT_MOVE_TO_BACKLOG]: 'PRB',
  [ActionType.PROJECT_MOVE_FROM_BACKLOG]: 'PBR',
  [ActionType.PROJECT_AUTO_MOVE_TO_BACKLOG]: 'PAB',
  [ActionType.PROJECT_AUTO_MOVE_FROM_BACKLOG]: 'PAR',
  [ActionType.PROJECT_MOVE_ALL_BACKLOG]: 'PBA',

  // TaskRepeatCfg actions (R)
  [ActionType.REPEAT_CFG_ADD]: 'RA',
  [ActionType.REPEAT_CFG_UPDATE]: 'RU',
  [ActionType.REPEAT_CFG_UPDATE_MULTIPLE]: 'RUM',
  [ActionType.REPEAT_CFG_DELETE]: 'RD',
  [ActionType.REPEAT_CFG_DELETE_MULTIPLE]: 'RDM',
  [ActionType.REPEAT_CFG_DELETE_INSTANCE]: 'RDI',
  [ActionType.REPEAT_CFG_UPSERT]: 'RX',

  // SimpleCounter actions (S)
  [ActionType.COUNTER_ADD]: 'SA',
  [ActionType.COUNTER_UPDATE]: 'SU',
  [ActionType.COUNTER_UPSERT]: 'SUS',
  [ActionType.COUNTER_DELETE]: 'SD',
  [ActionType.COUNTER_DELETE_MULTIPLE]: 'SDM',
  [ActionType.COUNTER_UPDATE_ALL]: 'SUA',
  [ActionType.COUNTER_SET_TODAY]: 'ST',
  [ActionType.COUNTER_INCREASE_TODAY]: 'SI',
  [ActionType.COUNTER_DECREASE_TODAY]: 'SX',
  [ActionType.COUNTER_TOGGLE]: 'SG',
  [ActionType.COUNTER_TURN_OFF_ALL]: 'SO',
  [ActionType.COUNTER_SET_OFF]: 'SF',
  [ActionType.COUNTER_SET_ON]: 'SN',
  [ActionType.COUNTER_SET_FOR_DATE]: 'SFD',
  [ActionType.COUNTER_SYNC_TIME]: 'SC',

  // Task actions (T)
  [ActionType.TASK_UPDATE_MULTIPLE_SIMPLE]: 'TU',
  [ActionType.TASK_ADD_SUB]: 'TA',
  [ActionType.TASK_MOVE_SUB]: 'TMS',
  [ActionType.TASK_MOVE_UP]: 'TMU',
  [ActionType.TASK_MOVE_DOWN]: 'TMD',
  [ActionType.TASK_MOVE_TOP]: 'TMT',
  [ActionType.TASK_MOVE_BOTTOM]: 'TMB',
  [ActionType.TASK_REMOVE_TIME_SPENT]: 'TR',
  [ActionType.TASK_ROUND_TIME_SPENT]: 'TRD',
  [ActionType.TASK_ADD_TAGS_SHORT_SYNTAX]: 'TGS',

  // Plugin actions (U)
  [ActionType.PLUGIN_UPSERT_USER_DATA]: 'UU',
  [ActionType.PLUGIN_DELETE_USER_DATA]: 'UD',
  [ActionType.PLUGIN_UPSERT_METADATA]: 'UM',
  [ActionType.PLUGIN_DELETE_METADATA]: 'UDM',

  // WorkContextMeta actions (W)
  [ActionType.WORK_CONTEXT_MOVE_UP]: 'WMU',
  [ActionType.WORK_CONTEXT_MOVE_DOWN]: 'WMD',
  [ActionType.WORK_CONTEXT_MOVE_TOP]: 'WMT',
  [ActionType.WORK_CONTEXT_MOVE_BOTTOM]: 'WMB',
  [ActionType.WORK_CONTEXT_MOVE]: 'WM',

  // TaskAttachment actions (X)
  [ActionType.ATTACHMENT_ADD]: 'XA',
  [ActionType.ATTACHMENT_UPDATE]: 'XU',
  [ActionType.ATTACHMENT_DELETE]: 'XD',

  // System-level actions (Y)
  [ActionType.LOAD_ALL_DATA]: 'YL',
  [ActionType.LOAD_BACKUP_DATA]: 'YB',
  [ActionType.MIGRATION_GENESIS_IMPORT]: 'YM',
  [ActionType.RECOVERY_DATA_IMPORT]: 'YR',

  // Repair actions (Z)
  [ActionType.REPAIR_AUTO]: 'ZR',
};

// Reverse mapping: code -> action type
export const CODE_TO_ACTION_TYPE: Record<string, ActionType> = Object.fromEntries(
  Object.entries(ACTION_TYPE_TO_CODE).map(([k, v]) => [v, k as ActionType]),
);

/**
 * Encode an action type to its short code.
 * Returns the original action type as-is if no short code is registered.
 * This allows the system to work with unknown action types while still
 * compressing known ones.
 */
export const encodeActionType = (actionType: ActionType | string): string => {
  const code = ACTION_TYPE_TO_CODE[actionType as ActionType];
  // Return the code if found, otherwise return the original action type
  return code ?? actionType;
};

/**
 * Decode a short code back to the full action type.
 * If the code is not found in the mapping, it's assumed to be a full
 * action type that was stored as-is (for unknown/future action types).
 */
export const decodeActionType = (code: string): ActionType | string => {
  const actionType = CODE_TO_ACTION_TYPE[code];
  // Return the decoded action type if found, otherwise return the code as-is
  // (it's likely already a full action type that wasn't compressed)
  return actionType ?? code;
};
