/* eslint-env es6, node */
/**
 * Removes specified unused translation keys from all language files.
 * After running this, run `npm run int` to regenerate t.const.ts.
 *
 * Usage: node tools/cleanup-unused-translations.js
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const I18N_DIR = path.join(__dirname, '../src/assets/i18n');

// Top-level sections to completely remove
const SECTIONS_TO_REMOVE = ['ANDROID', 'THEMES'];

// Nested paths to remove (will remove the last key in the path)
// Format: array of path segments, e.g., ['F', 'CALDAV', 'ISSUE_CONTENT'] removes F.CALDAV.ISSUE_CONTENT
const NESTED_PATHS_TO_REMOVE = [
  // === Previously removed ===
  ['F', 'CALDAV', 'ISSUE_CONTENT'],
  ['F', 'SAFETY_BACKUP'],
  ['F', 'PROCRASTINATION'],
  ['GCF', 'PAST'],
  ['GCF', 'TIMELINE'],
  ['WW', 'HELP_PROCRASTINATION'],

  // === Entire subsections - never implemented ===
  ['F', 'JIRA', 'STEPPER'], // Setup wizard never implemented
  ['F', 'SYNC', 'D_PERMISSION'], // Permission dialog never implemented
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_CALDAV'],
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_GIT'],
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_GITEA_PROJECT'],
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_GITLAB'],
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_JIRA'],
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_OPEN_PROJECT'],
  ['F', 'PROJECT', 'D_CREATE', 'SETUP_REDMINE_PROJECT'],

  // === F.FOCUS_MODE - planned features never implemented ===
  ['F', 'FOCUS_MODE', 'B', 'END_BREAK'],
  ['F', 'FOCUS_MODE', 'COMPLETE_SESSION'],
  ['F', 'FOCUS_MODE', 'CONGRATS'],
  ['F', 'FOCUS_MODE', 'CONTINUE_FOCUS_SESSION'],
  ['F', 'FOCUS_MODE', 'CONTINUE_SESSION'],
  ['F', 'FOCUS_MODE', 'CURRENT_SESSION_TIME_TOOLTIP'],
  ['F', 'FOCUS_MODE', 'FOR_TASK'],
  ['F', 'FOCUS_MODE', 'GO_TO_PROCRASTINATION'],
  ['F', 'FOCUS_MODE', 'NEXT'],
  ['F', 'FOCUS_MODE', 'SELECT_ANOTHER_TASK'],
  ['F', 'FOCUS_MODE', 'SET_FOCUS_SESSION_DURATION'],
  ['GCF', 'FOCUS_MODE', 'L_ALWAYS_OPEN_FOCUS_MODE'],

  // === F.METRIC - planned features ===
  ['F', 'METRIC', 'BANNER', 'CHECK'],
  ['F', 'METRIC', 'CMP', 'MOOD_PRODUCTIVITY_OVER_TIME'],
  ['F', 'METRIC', 'EVAL_FORM', 'ADD_NOTE_FOR_TOMORROW'],
  ['F', 'METRIC', 'EVAL_FORM', 'DISABLE_REPEAT_EVERY_DAY'],
  ['F', 'METRIC', 'EVAL_FORM', 'ENABLE_REPEAT_EVERY_DAY'],
  ['F', 'METRIC', 'EVAL_FORM', 'HELP_H1'],
  ['F', 'METRIC', 'EVAL_FORM', 'HELP_LINK_TXT'],
  ['F', 'METRIC', 'EVAL_FORM', 'HELP_P1'],
  ['F', 'METRIC', 'EVAL_FORM', 'HELP_P2'],
  ['F', 'METRIC', 'EVAL_FORM', 'IMPROVEMENTS'],
  ['F', 'METRIC', 'EVAL_FORM', 'IMPROVEMENTS_TOMORROW'],
  ['F', 'METRIC', 'EVAL_FORM', 'MOOD'],
  ['F', 'METRIC', 'EVAL_FORM', 'MOOD_HINT'],
  ['F', 'METRIC', 'EVAL_FORM', 'OBSTRUCTIONS'],
  ['F', 'METRIC', 'EVAL_FORM', 'PRODUCTIVITY_HINT'],
  ['F', 'METRIC', 'REFLECTION', 'REMIND_LABEL'],
  ['F', 'METRIC', 'REFLECTION', 'REMINDER_CREATED'],
  ['F', 'METRIC', 'REFLECTION', 'REMINDER_ERROR'],
  ['F', 'METRIC', 'REFLECTION', 'REMINDER_NEEDS_TEXT'],
  ['F', 'METRIC', 'REFLECTION', 'REMINDER_TASK_TITLE'],
  ['F', 'METRIC', 'S', 'SAVE_METRIC'],

  // === F.SYNC - unused error states and dialogs ===
  ['F', 'SYNC', 'A', 'ARCHIVE_ONLY_UPLOADED'],
  ['F', 'SYNC', 'A', 'POSSIBLE_LEGACY_DATA'],
  ['F', 'SYNC', 'C', 'EMPTY_SYNC'],
  ['F', 'SYNC', 'C', 'FORCE_UPLOAD_AFTER_ERROR'],
  ['F', 'SYNC', 'C', 'MIGRATE_LEGACY'],
  ['F', 'SYNC', 'C', 'NO_REMOTE_DATA'],
  ['F', 'SYNC', 'C', 'TRY_LOAD_REMOTE_AGAIN'],
  ['F', 'SYNC', 'C', 'UNABLE_TO_LOAD_REMOTE_DATA'],
  ['F', 'SYNC', 'D_CONFLICT', 'LAMPORT_CLOCK'],
  ['F', 'SYNC', 'D_CONFLICT', 'LAST_CHANGE'],
  ['F', 'SYNC', 'D_INCOMPLETE_SYNC', 'P3'],
  ['F', 'SYNC', 'D_INCOMPLETE_SYNC', 'P4'],
  ['F', 'SYNC', 'D_INCOMPLETE_SYNC', 'P5'],
  ['F', 'SYNC', 'D_INCOMPLETE_SYNC', 'P6'],
  ['F', 'SYNC', 'FORM', 'DROPBOX', 'L_ACCESS_TOKEN'],
  ['F', 'SYNC', 'FORM', 'GOOGLE', 'L_SYNC_FILE_NAME'],
  ['F', 'SYNC', 'FORM', 'LOCAL_FILE', 'L_SYNC_FILE_PATH_PERMISSION_VALIDATION'],
  ['F', 'SYNC', 'S', 'ALREADY_IN_SYNC_NO_LOCAL_CHANGES'],
  ['F', 'SYNC', 'S', 'ERROR_FALLBACK_TO_BACKUP'],
  ['F', 'SYNC', 'S', 'ERROR_INVALID_DATA'],
  ['F', 'SYNC', 'S', 'ERROR_NO_REV'],
  ['F', 'SYNC', 'S', 'ERROR_UNABLE_TO_READ_REMOTE_DATA'],
  ['F', 'SYNC', 'S', 'IMPORTING'],
  ['F', 'SYNC', 'S', 'INITIAL_SYNC_ERROR'],
  ['F', 'SYNC', 'S', 'SUCCESS_IMPORT'],
  ['F', 'SYNC', 'S', 'UPLOAD_ERROR'],
  ['F', 'SYNC', 'SAFETY_BACKUP', 'BACKUP_NOT_FOUND'],
  ['F', 'SYNC', 'SAFETY_BACKUP', 'INVALID_ID_ERROR'],
  ['F', 'SYNC', 'SAFETY_BACKUP', 'RESTORE_CONFIRM_MSG'],
  ['F', 'SYNC', 'SAFETY_BACKUP', 'RESTORE_CONFIRM_TITLE'],
  ['F', 'SYNC', 'SAFETY_BACKUP', 'RESTORE_FAILED'],
  ['F', 'SYNC', 'SAFETY_BACKUP', 'TITLE'],

  // === F.ISSUE - unused keys ===
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'CHANGED'],
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'COMMENTS'],
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'DONE_RATIO'],
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'LIST_OF_CHANGES'],
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'LOAD_DESCRIPTION_AND_ALL_COMMENTS'],
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'ON'],
  ['F', 'ISSUE', 'ISSUE_CONTENT', 'WRITE_A_COMMENT'],
  ['F', 'ISSUE', 'S', 'ISSUE_DELETED_OR_CLOSED'],
  ['F', 'ISSUE', 'S', 'MANUAL_UPDATE_ISSUE_SUCCESS'],
  ['F', 'ISSUE', 'S', 'MISSING_ISSUE_DATA'],
  ['F', 'ISSUE', 'S', 'NEW_COMMENT'],

  // === F.JIRA - unused keys ===
  ['F', 'JIRA', 'DIALOG_TRANSITION', 'UPDATE_STATUS'],
  ['F', 'JIRA', 'FORM_CRED', 'WONKY_COOKIE_MODE'],
  ['F', 'JIRA', 'S', 'ISSUE_NO_UPDATE_REQUIRED'],
  ['F', 'JIRA', 'S', 'MANUAL_UPDATE_ISSUE_SUCCESS'],
  ['F', 'JIRA', 'S', 'MISSING_ISSUE_DATA'],
  ['F', 'JIRA', 'S', 'UNABLE_TO_REASSIGN'],

  // === Issue provider dialogs - never implemented ===
  ['F', 'CALDAV', 'DIALOG_INITIAL', 'TITLE'],
  ['F', 'CALDAV', 'FORM_SECTION', 'TITLE'],
  ['F', 'GITEA', 'DIALOG_INITIAL', 'TITLE'],
  ['F', 'GITEA', 'FORM', 'FILTER_USER'],
  ['F', 'GITEA', 'FORM_SECTION', 'TITLE'],
  ['F', 'GITEA', 'ISSUE_CONTENT', 'AT'],
  ['F', 'GITEA', 'S', 'ERR_UNKNOWN'],
  ['F', 'GITHUB', 'DIALOG_INITIAL', 'TITLE'],
  ['F', 'GITHUB', 'FORM_SECTION', 'TITLE'],
  ['F', 'GITLAB', 'DIALOG_INITIAL', 'TITLE'],
  ['F', 'GITLAB', 'FORM_SECTION', 'TITLE'],
  ['F', 'OPEN_PROJECT', 'DIALOG_INITIAL', 'TITLE'],
  ['F', 'OPEN_PROJECT', 'DIALOG_TRANSITION', 'UPDATE_STATUS'],
  ['F', 'OPEN_PROJECT', 'FORM_SECTION', 'TITLE'],
  ['F', 'REDMINE', 'DIALOG_INITIAL', 'TITLE'],
  ['F', 'REDMINE', 'S', 'ERR_UNKNOWN'],

  // === F.DROPBOX - unused error states ===
  ['F', 'DROPBOX', 'S', 'ACCESS_TOKEN_ERROR'],
  ['F', 'DROPBOX', 'S', 'ACCESS_TOKEN_GENERATED'],
  ['F', 'DROPBOX', 'S', 'AUTH_ERROR'],
  ['F', 'DROPBOX', 'S', 'AUTH_ERROR_ACTION'],

  // === F.TASK - unused keys ===
  ['F', 'TASK', 'ADD_TASK_BAR', 'ADD_ISSUE_TASK'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'ADD_TASK_TO_BOTTOM_OF_BACKLOG'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'ADD_TASK_TO_BOTTOM_OF_TODAY'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'ADD_TASK_TO_TOP_OF_BACKLOG'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'ADD_TASK_TO_TOP_OF_TODAY'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'CREATE_TASK'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'EXAMPLE'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'NO_DATE'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'NO_TIME'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'START'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'TOGGLE_ADD_TO_BACKLOG_TODAY'],
  ['F', 'TASK', 'ADD_TASK_BAR', 'TOGGLE_ADD_TOP_OR_BOTTOM'],
  ['F', 'TASK', 'ADDITIONAL_INFO', 'FROM_PARENT'],
  ['F', 'TASK', 'ADDITIONAL_INFO', 'REMINDER'],
  ['F', 'TASK', 'CMP', 'EDIT_TAGS'],
  ['F', 'TASK', 'CMP', 'EDIT_TASK_TITLE'],
  ['F', 'TASK', 'CMP', 'MARK_UNDONE'],
  ['F', 'TASK', 'CMP', 'REPEAT_EDIT'],
  ['F', 'TASK', 'CMP', 'SHOW_UPDATES'],
  ['F', 'TASK', 'D_REMINDER_VIEW', 'FOR_CURRENT'],
  ['F', 'TASK', 'D_REMINDER_VIEW', 'FOR_OTHER'],
  ['F', 'TASK', 'D_REMINDER_VIEW', 'FROM_PROJECT'],
  ['F', 'TASK', 'D_REMINDER_VIEW', 'FROM_TAG'],
  ['F', 'TASK', 'D_REMINDER_VIEW', 'SWITCH_CONTEXT_START'],
  ['F', 'TASK', 'D_SCHEDULE_TASK', 'MOVE_TO_BACKLOG'],
  ['F', 'TASK', 'D_SCHEDULE_TASK', 'QA_REMOVE_TODAY'],
  ['F', 'TASK', 'S', 'CREATED_FOR_PROJECT_ACTION'],
  ['F', 'TASK', 'S', 'LAST_TAG_DELETION_WARNING'],
  ['F', 'TASK', 'S', 'MOVED_TO_PROJECT_ACTION'],

  // === F.TASK_REPEAT - hardcoded strings in code ===
  ['F', 'TASK_REPEAT', 'F', 'IS_ADD_TO_BOTTOM'],
  ['F', 'TASK_REPEAT', 'F', 'REPEAT_FROM_COMPLETION_DATE'],
  ['F', 'TASK_REPEAT', 'F', 'REPEAT_FROM_COMPLETION_DATE_DESCRIPTION'],
  ['F', 'TASK_REPEAT', 'F', 'SCHEDULE_TYPE_FIXED'],
  ['F', 'TASK_REPEAT', 'F', 'SCHEDULE_TYPE_FLEXIBLE'],

  // === Other unused individual keys ===
  ['APP', 'UPDATE_MAIN_MODEL'],
  ['APP', 'UPDATE_MAIN_MODEL_NO_UPDATE'],
  ['BN', 'SHOW_TASK_VIEW_CUSTOMIZER_PANEL'],
  ['DATETIME_SCHEDULE', 'LATER_TODAY'],
  ['DATETIME_SCHEDULE', 'NEXT_WEEK'],
  ['DATETIME_SCHEDULE', 'PLACEHOLDER'],
  ['DATETIME_SCHEDULE', 'TOMORROW'],
  ['F', 'ATTACHMENT', 'DIALOG_EDIT', 'LABELS', 'FILE'],
  ['F', 'BOARDS', 'DEFAULT', 'IMPORTANT'],
  ['F', 'CALENDARS', 'BANNER', 'FOCUS_TASK'],
  ['F', 'NOTE', 'D_ADD', 'NOTE_LABEL'],
  ['F', 'PLANNER', 'D', 'ADD_PLANNED', 'ADD_TO_TODAY'],
  ['F', 'PLANNER', 'D', 'ADD_PLANNED', 'TITLE'],
  ['F', 'PLANNER', 'TASK_DRAWER'],
  ['F', 'PROJECT', 'FORM_THEME', 'D_IS_DARK_THEME'],
  ['F', 'PROJECT', 'FORM_THEME', 'L_IS_REDUCED_THEME'],
  ['F', 'PROJECT', 'FORM_THEME', 'L_TITLE'],
  ['F', 'PROJECT', 'S', 'E_EXISTS'],
  ['F', 'PROJECT', 'S', 'E_INVALID_FILE'],
  ['F', 'PROJECT', 'S', 'ISSUE_PROVIDER_UPDATED'],
  ['F', 'REMINDER', 'COUNTDOWN_BANNER', 'HIDE'],
  ['F', 'SCHEDULE', 'CONTINUED'],
  ['F', 'SCHEDULE', 'LUNCH_BREAK'],
  ['F', 'SCHEDULE', 'MONTH'],
  ['F', 'SCHEDULE', 'NO_TASKS'],
  ['F', 'SCHEDULE', 'NOW'],
  ['F', 'SCHEDULE', 'TASK_PROJECTION_INFO'],
  ['F', 'SCHEDULE', 'WEEK'],
  ['F', 'SEARCH_BAR', 'INFO_ARCHIVED'],
  ['F', 'SEARCH_BAR', 'PLACEHOLDER_ARCHIVED'],
  ['F', 'SEARCH_BAR', 'TOO_MANY_RESULTS'],
  ['F', 'SIMPLE_COUNTER', 'FORM', 'L_ICON_ON'],
  ['F', 'TAG', 'D_CREATE', 'EDIT'],
  ['F', 'TASK_VIEW', 'CUSTOMIZER', 'SORT_BY'],
  ['F', 'TASK_VIEW', 'CUSTOMIZER', 'TITLE'],
  ['F', 'TIME_TRACKING', 'D_TRACKING_REMINDER', 'IDLE_FOR'],
  ['F', 'WORKLOG', 'CMP', 'RESTORE_TASK_FROM_ARCHIVE'],
  ['G', 'DONT_SHOW_AGAIN'],
  ['G', 'LOGIN'],
  ['G', 'LOGOUT'],
  ['G', 'NEXT'],
  ['G', 'PREVIOUS'],
  ['G', 'RESET'],
  ['G', 'UPDATE'],
  ['GCF', 'CALENDARS', 'CAL_PROVIDERS'],
  ['GCF', 'CALENDARS', 'DEFAULT_PROJECT'],
  ['GCF', 'KEYBOARD', 'TASK_PLAN_FORDAY'],
  ['GCF', 'KEYBOARD', 'TOGGLE_BOOKMARKS'],
  ['GCF', 'MISC', 'IS_HIDE_NAV'],
  ['GCF', 'MISC', 'IS_USE_MINIMAL_SIDE_NAV'],
  ['GCF', 'MISC', 'USER_PROFILES'],
  ['GCF', 'MISC', 'USER_PROFILES_HINT'],
  ['GCF', 'SCHEDULE', 'MONTH'],
  ['GCF', 'SCHEDULE', 'WEEK'],
  ['GLOBAL_SNACK', 'ERR_COMPRESSION'],
  ['GLOBAL_SNACK', 'SHORTCUT_WARN_OPEN_BOOKMARKS_FROM_TAG'],
  ['MH', 'NO_PROJECT_INFO'],
  ['MH', 'NO_TAG_INFO'],
  ['MH', 'NOTES'],
  ['MH', 'NOTES_PANEL_INFO'],
  ['MH', 'PROCRASTINATE'],
  ['MH', 'PROJECT_SETTINGS'],
  ['MH', 'SHOW_SEARCH_BAR'],
  ['MH', 'TASK_LIST'],
  ['MH', 'TASKS'],
  ['MH', 'TOGGLE_SHOW_BOOKMARKS'],
  ['PDS', 'BACK'],
  ['PLUGINS', 'DISABLED'],
  ['PLUGINS', 'ENABLED'],
  ['PLUGINS', 'INDEX_HTML_NOT_LOADED'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_ACTION'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_HEADER_BUTTON'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_LOADING'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_MENU_ENTRY'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_NODE'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_PERSISTENCE'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_SHORTCUT'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_SIDE_PANEL'],
  ['PLUGINS', 'NO_PLUGIN_CONTEXT_SYNC'],
  ['PLUGINS', 'NO_PLUGIN_ID_PROVIDED_FOR_HTML'],
  ['PLUGINS', 'PLUGIN_DOES_NOT_SUPPORT_IFRAME'],
  ['PLUGINS', 'PLUGIN_ID_NOT_PROVIDED'],
  ['PLUGINS', 'PLUGIN_NOT_FOUND'],
  ['PLUGINS', 'PLUGIN_SYSTEM_FAILED_INIT'],
  ['PLUGINS', 'USER_DECLINED_NODE_PERMISSION'],
  ['PS', 'ISSUE_INTEGRATION'],
  ['PS', 'RELOAD'],
  ['PS', 'TOGGLE_DARK_MODE'],
  ['SCHEDULE', 'START_TASK'],
  ['USER_PROFILES', 'OPEN_PROFILES_FOLDER'],
  ['V', 'E_1TO10'],
  ['V', 'E_PATTERN'],
  ['WW', 'FINISH_DAY_FOR_PROJECT'],
  ['WW', 'FINISH_DAY_FOR_TAG'],
];

/**
 * Recursively remove a nested key from an object
 */
function removeNestedKey(obj, pathParts) {
  if (pathParts.length === 0) return false;

  if (pathParts.length === 1) {
    if (obj && pathParts[0] in obj) {
      delete obj[pathParts[0]];
      return true;
    }
    return false;
  }

  const [first, ...rest] = pathParts;
  if (obj && typeof obj[first] === 'object') {
    return removeNestedKey(obj[first], rest);
  }
  return false;
}

/**
 * Remove specified keys from a JSON object
 */
function removeKeys(obj) {
  let removedCount = 0;

  // Remove top-level sections
  for (const section of SECTIONS_TO_REMOVE) {
    if (obj[section]) {
      delete obj[section];
      removedCount++;
    }
  }

  // Remove nested keys
  for (const pathParts of NESTED_PATHS_TO_REMOVE) {
    if (removeNestedKey(obj, pathParts)) {
      removedCount++;
    }
  }

  return removedCount;
}

/**
 * Process all JSON language files
 */
function processJsonFiles() {
  const files = globSync('*.json', { cwd: I18N_DIR, absolute: true });

  console.log(`Processing ${files.length} language files...\n`);

  let totalRemoved = 0;
  for (const file of files) {
    const filename = path.basename(file);
    const content = JSON.parse(fs.readFileSync(file, 'utf8'));
    const removed = removeKeys(content);

    if (removed > 0) {
      fs.writeFileSync(file, JSON.stringify(content, null, 2) + '\n', 'utf8');
      console.log(`${filename}: removed ${removed} key(s)`);
      totalRemoved += removed;
    } else {
      console.log(`${filename}: no changes needed`);
    }
  }

  return totalRemoved;
}

// Main
console.log('=== Cleaning up unused translations ===\n');
console.log(`Configured to remove ${NESTED_PATHS_TO_REMOVE.length} nested paths`);
console.log(`and ${SECTIONS_TO_REMOVE.length} top-level sections\n`);

const total = processJsonFiles();

console.log(`\n=== Done! Removed ${total} total keys across all files ===`);
console.log('\nNow run `npm run int` to regenerate t.const.ts');
