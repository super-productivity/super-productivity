import { ConfigFormSection, LimitedFormlyFieldConfig } from '../global-config.model';
import { T } from '../../../t.const';
import { IS_ELECTRON } from '../../../app.constants';
import { KeyboardConfig } from '../keyboard-config.model';

/** Builds a single keyboard-shortcut form field (the dominant, repeated shape). */
const kbField = (
  key: keyof KeyboardConfig,
  label: string,
): LimitedFormlyFieldConfig<KeyboardConfig> => ({
  key,
  type: 'keyboard',
  templateOptions: {
    label,
  },
});

/** A `<h3>` sub-section divider between groups of shortcuts. */
const subSectionHeading = (text: string): LimitedFormlyFieldConfig<KeyboardConfig> => ({
  type: 'tpl',
  className: 'tpl',
  templateOptions: {
    tag: 'h3',
    class: 'sub-section-heading',
    text,
  },
});

export const KEYBOARD_SETTINGS_FORM_CFG: ConfigFormSection<KeyboardConfig> = {
  title: T.GCF.KEYBOARD.TITLE,
  key: 'keyboard',
  help: T.GCF.KEYBOARD.HELP,
  isHideForAndroidApp: true,
  items: [
    // SYSTEM WIDE
    ...(IS_ELECTRON
      ? [
          subSectionHeading(T.GCF.KEYBOARD.SYSTEM_SHORTCUTS),
          kbField('globalShowHide', T.GCF.KEYBOARD.GLOBAL_SHOW_HIDE),
          kbField('globalToggleTaskStart', T.GCF.KEYBOARD.GLOBAL_TOGGLE_TASK_START),
          kbField('globalAddNote', T.GCF.KEYBOARD.GLOBAL_ADD_NOTE),
          kbField('globalAddTask', T.GCF.KEYBOARD.GLOBAL_ADD_TASK),
          kbField('globalToggleTaskWidget', T.GCF.KEYBOARD.GLOBAL_TOGGLE_TASK_WIDGET),
        ]
      : []),
    // APP WIDE
    subSectionHeading(T.GCF.KEYBOARD.APP_WIDE_SHORTCUTS),
    kbField('addNewTask', T.GCF.KEYBOARD.ADD_NEW_TASK),
    kbField('addNewProject', T.GCF.KEYBOARD.ADD_NEW_PROJECT),
    kbField('addNewNote', T.GCF.KEYBOARD.ADD_NEW_NOTE),
    kbField('focusSideNav', T.GCF.KEYBOARD.TOGGLE_SIDE_NAV),
    kbField('toggleSideNavMode', T.GCF.KEYBOARD.TOGGLE_SIDE_NAV_MODE),
    kbField('openProjectNotes', T.GCF.KEYBOARD.OPEN_PROJECT_NOTES),
    kbField(
      'toggleTaskViewCustomizerPanel',
      T.GCF.KEYBOARD.TOGGLE_TASK_VIEW_CUSTOMIZER_PANEL,
    ),
    kbField('toggleIssuePanel', T.GCF.KEYBOARD.TOGGLE_ISSUE_PANEL),
    // {
    //   key: 'showHelp',
    //   type: 'keyboard',
    //   templateOptions: {
    //     label: T.GCF.KEYBOARD.SHOW_HELP
    //   },
    // },
    kbField('showSearchBar', T.GCF.KEYBOARD.SHOW_SEARCH_BAR),
    kbField('toggleBacklog', T.GCF.KEYBOARD.TOGGLE_BACKLOG),
    kbField('goToWorkView', T.GCF.KEYBOARD.GO_TO_WORK_VIEW),
    kbField('goToFocusMode', T.GCF.KEYBOARD.GO_TO_FOCUS_MODE),
    kbField('goToTimeline', T.GCF.KEYBOARD.GO_TO_SCHEDULE),
    kbField('goToScheduledView', T.GCF.KEYBOARD.GO_TO_SCHEDULED_VIEW),
    // {
    //   key: 'goToDailyAgenda',
    //   type: 'keyboard',
    //   templateOptions: {
    //     label: T.GCF.KEYBOARD.GO_TO_DAILY_AGENDA
    //   },
    // },
    kbField('goToSettings', T.GCF.KEYBOARD.GO_TO_SETTINGS),
    kbField('zoomIn', T.GCF.KEYBOARD.ZOOM_IN),
    kbField('zoomOut', T.GCF.KEYBOARD.ZOOM_OUT),
    kbField('zoomDefault', T.GCF.KEYBOARD.ZOOM_DEFAULT),
    kbField('triggerSync', T.GCF.KEYBOARD.TRIGGER_SYNC),

    // TASKS
    subSectionHeading(T.GCF.KEYBOARD.TASK_SHORTCUTS),
    {
      type: 'tpl',
      className: 'tpl',
      templateOptions: {
        tag: 'p',
        text: T.GCF.KEYBOARD.TASK_SHORTCUTS_INFO,
      },
    },
    kbField('taskEditTitle', T.GCF.KEYBOARD.TASK_EDIT_TITLE),
    kbField('taskToggleDetailPanelOpen', T.GCF.KEYBOARD.TASK_TOGGLE_DETAIL_PANEL_OPEN),
    kbField('taskOpenNotesPanel', T.GCF.KEYBOARD.TASK_OPEN_NOTES_PANEL),
    kbField('taskOpenEstimationDialog', T.GCF.KEYBOARD.TASK_OPEN_ESTIMATION_DIALOG),
    kbField('taskSchedule', T.GCF.KEYBOARD.TASK_SCHEDULE),
    kbField('taskScheduleToday', T.GCF.KEYBOARD.TASK_SCHEDULE_TODAY),
    kbField('taskScheduleTomorrow', T.GCF.KEYBOARD.TASK_SCHEDULE_TOMORROW),
    kbField('taskScheduleNextWeek', T.GCF.KEYBOARD.TASK_SCHEDULE_NEXT_WEEK),
    kbField('taskScheduleNextMonth', T.GCF.KEYBOARD.TASK_SCHEDULE_NEXT_MONTH),
    kbField('taskScheduleDeadline', T.GCF.KEYBOARD.TASK_SCHEDULE_DEADLINE),
    kbField('taskUnschedule', T.GCF.KEYBOARD.TASK_UNSCHEDULE),
    kbField('taskToggleDone', T.GCF.KEYBOARD.TASK_TOGGLE_DONE),
    kbField('taskAddSubTask', T.GCF.KEYBOARD.TASK_ADD_SUB_TASK),
    kbField('taskAddAttachment', T.GCF.KEYBOARD.TASK_ADD_ATTACHMENT),
    kbField('taskDelete', T.GCF.KEYBOARD.TASK_DELETE),
    kbField('taskMoveToProject', T.GCF.KEYBOARD.TASK_MOVE_TO_PROJECT),
    kbField('taskOpenContextMenu', T.GCF.KEYBOARD.TASK_OPEN_CONTEXT_MENU),
    kbField('taskOpenNotesFullscreen', T.GCF.KEYBOARD.TASK_OPEN_NOTES_FULLSCREEN),
    kbField('selectPreviousTask', T.GCF.KEYBOARD.SELECT_PREVIOUS_TASK),
    kbField('selectNextTask', T.GCF.KEYBOARD.SELECT_NEXT_TASK),
    kbField('moveTaskUp', T.GCF.KEYBOARD.MOVE_TASK_UP),
    kbField('moveTaskDown', T.GCF.KEYBOARD.MOVE_TASK_DOWN),
    kbField('moveTaskToTop', T.GCF.KEYBOARD.MOVE_TASK_TO_TOP),
    kbField('moveTaskToBottom', T.GCF.KEYBOARD.MOVE_TASK_TO_BOTTOM),
    kbField('moveToBacklog', T.GCF.KEYBOARD.MOVE_TO_BACKLOG),
    kbField('expandSubTasks', T.GCF.KEYBOARD.EXPAND_SUB_TASKS),
    kbField('collapseSubTasks', T.GCF.KEYBOARD.COLLAPSE_SUB_TASKS),
    kbField('togglePlay', T.GCF.KEYBOARD.TOGGLE_PLAY),
    kbField('taskEditTags', T.GCF.KEYBOARD.TASK_EDIT_TAGS),
  ],
};
