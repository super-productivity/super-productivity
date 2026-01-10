export const cssSelectors = {
  // ============================================================================
  // NAVIGATION SELECTORS
  // ============================================================================
  SIDENAV: 'magic-side-nav',
  NAV_LIST: 'magic-side-nav .nav-list',
  NAV_ITEM: 'magic-side-nav nav-item',
  NAV_ITEM_BUTTON: 'magic-side-nav nav-item button',
  // nav-list-tree is the Angular component for tree items (Projects, Tags)
  NAV_LIST_TREE: 'magic-side-nav nav-list-tree',
  NAV_GROUP_HEADER: 'magic-side-nav nav-list-tree .g-multi-btn-wrapper nav-item button',
  NAV_GROUP_CHILDREN: 'magic-side-nav nav-list-tree .nav-children',
  NAV_CHILD_ITEM: 'magic-side-nav nav-list-tree .nav-child-item nav-item',
  NAV_CHILD_BUTTON: 'magic-side-nav nav-list-tree .nav-child-item nav-item button',

  // Main navigation items (direct children of .nav-list > li.nav-item)
  MAIN_NAV_ITEMS: 'magic-side-nav .nav-list > li.nav-item nav-item button',

  // Settings and other buttons - improved selector with fallbacks
  SETTINGS_BTN:
    'magic-side-nav .tour-settingsMenuBtn, magic-side-nav nav-item:has([icon="settings"]) button, magic-side-nav button[aria-label*="Settings"]',

  // Legacy selectors for backward compatibility
  OLD_SIDENAV: 'side-nav',
  OLD_NAV_ITEM: 'side-nav-item',

  // ============================================================================
  // LAYOUT & ROUTING SELECTORS
  // ============================================================================
  ROUTE_WRAPPER: '.route-wrapper',
  BACKDROP: '.backdrop',
  MAIN: 'main',
  PAGE_TITLE: 'main .page-title, .route-wrapper .page-title',

  // ============================================================================
  // TASK SELECTORS
  // ============================================================================
  TASK: 'task',
  FIRST_TASK: 'task:first-child',
  SECOND_TASK: 'task:nth-child(2)',
  TASK_TITLE: 'task task-title',
  TASK_DONE_BTN: '.task-done-btn',
  TASK_LIST: 'task-list',
  TASK_TEXTAREA: 'task textarea',
  SUB_TASKS_CONTAINER: '.sub-tasks',
  SUB_TASK: '.sub-tasks task',

  // ============================================================================
  // ADD TASK BAR SELECTORS
  // ============================================================================
  ADD_TASK_INPUT: 'add-task-bar.global input',
  ADD_TASK_SUBMIT: '.e2e-add-task-submit',
  ADD_BTN: '.tour-addBtn',
  SWITCH_ADD_TO_BTN: '.switch-add-to-btn',

  // ============================================================================
  // DIALOG SELECTORS
  // ============================================================================
  MAT_DIALOG: 'mat-dialog-container',
  DIALOG_FULLSCREEN_MARKDOWN: 'dialog-fullscreen-markdown',
  DIALOG_CREATE_PROJECT: 'dialog-create-project',
  DIALOG_SCHEDULE_TASK: 'dialog-schedule-task',
  DIALOG_ACTIONS: 'mat-dialog-actions',
  DIALOG_SUBMIT: 'mat-dialog-actions button:last-child',

  // ============================================================================
  // REMINDER DIALOG SELECTORS
  // ============================================================================
  REMINDER_DIALOG: 'dialog-view-task-reminder',
  REMINDER_DIALOG_TASKS: 'dialog-view-task-reminder .tasks',
  REMINDER_DIALOG_TASK: 'dialog-view-task-reminder .task',
  REMINDER_DIALOG_TASK_1: 'dialog-view-task-reminder .task:first-of-type',
  REMINDER_DIALOG_TASK_2: 'dialog-view-task-reminder .task:nth-of-type(2)',
  REMINDER_DIALOG_TASK_3: 'dialog-view-task-reminder .task:nth-of-type(3)',

  // ============================================================================
  // SETTINGS PAGE SELECTORS
  // ============================================================================
  PAGE_SETTINGS: '.page-settings',
  PLUGIN_SECTION: '.plugin-section',
  PLUGIN_MANAGEMENT: 'plugin-management',
  COLLAPSIBLE: 'collapsible',
  COLLAPSIBLE_HEADER: '.collapsible-header',

  // Plugin selectors
  PLUGIN_CARD: 'plugin-management mat-card',
  PLUGIN_TOGGLE: 'mat-slide-toggle button[role="switch"]',
  PLUGIN_FILE_INPUT: 'input[type="file"][accept=".zip"]',

  // ============================================================================
  // PROJECT SELECTORS
  // ============================================================================
  PAGE_PROJECT: '.page-project',
  CREATE_PROJECT_BTN:
    'button[aria-label="Create New Project"], button:has-text("Create Project")',
  PROJECT_NAME_INPUT: '[name="projectName"]',
  WORK_CONTEXT_MENU: 'work-context-menu',
  MOVE_TO_ARCHIVE_BTN: '.e2e-move-done-to-archive',

  // ============================================================================
  // NOTES SELECTORS
  // ============================================================================
  NOTES: 'notes',
  TOGGLE_NOTES_BTN: '.e2e-toggle-notes-btn',
  ADD_NOTE_BTN: '#add-note-btn',
  SAVE_NOTE_BTN: '#T-save-note',

  // ============================================================================
  // PLANNER SELECTORS
  // ============================================================================
  PLANNER_VIEW: 'planner',

  // ============================================================================
  // COMMON UI ELEMENTS
  // ============================================================================
  GLOBAL_ERROR_ALERT: '.global-error-alert',
  MAT_CARD: 'mat-card',
  MAT_CARD_TITLE: 'mat-card-title',

  // ============================================================================
  // DATE/TIME SELECTORS
  // ============================================================================
  EDIT_DATE_INFO: '.edit-date-info',
  TIME_INPUT: 'input[type="time"]',
  MAT_TIME_INPUT: 'mat-form-field input[type="time"]',

  // ============================================================================
  // TASK DETAIL PANEL SELECTORS
  // ============================================================================
  RIGHT_PANEL: '.right-panel',
  DETAIL_PANEL: 'dialog-task-detail-panel, task-detail-panel',
  DETAIL_PANEL_BTN: '.show-additional-info-btn',
  SCHEDULE_TASK_ITEM:
    'task-detail-item:has(mat-icon:text("alarm")), task-detail-item:has(mat-icon:text("today")), task-detail-item:has(mat-icon:text("schedule"))',
  TASK_SCHEDULE_BTN: '.ico-btn.schedule-btn',
} as const;

export type SelectorKey = keyof typeof cssSelectors;
