import { environment } from '../../../environments/environment';
import { TRACKING_INTERVAL } from '../../app.constants';
import { getDefaultVoice } from '../voice-reminder/getAvailableVoices';
import { TaskReminderOptionId } from '../tasks/task.model';
import { GlobalConfigState } from './global-config.model';

const minute = 60 * 1000;
const defaultVoice = getDefaultVoice();

const defaultTaskNotesTemplate = `**How can I best achieve it now?**

**What do I want?**

**Why do I want it?**
`;

export const DEFAULT_DAY_START = '9:00';
export const DEFAULT_GLOBAL_CONFIG: GlobalConfigState = {
  appFeatures: {
    isTimeTrackingEnabled: true,
    isFocusModeEnabled: true,
    isSchedulerEnabled: true,
    isPlannerEnabled: true,
    isBoardsEnabled: true,
    isScheduleDayPanelEnabled: true,
    isIssuesPanelEnabled: true,
    isProjectNotesEnabled: true,
    isSyncIconEnabled: true,
    isDonatePageEnabled: true,
    isEnableUserProfiles: false,
    isHabitsEnabled: true,
  },
  localization: {
    lng: undefined,
    dateTimeLocale: undefined,
    firstDayOfWeek: undefined,
  },
  tasks: {
    isConfirmBeforeDelete: true,
    isAutoAddWorkedOnToToday: true,
    isAutoMarkParentAsDone: false,
    isTrayShowCurrent: true,
    defaultProjectId: null,
    isMarkdownFormattingInNotesEnabled: true,
    notesTemplate: defaultTaskNotesTemplate,
  },
  misc: {
    isConfirmBeforeExit: false,
    isConfirmBeforeExitWithoutFinishDay: true,
    isMinimizeToTray: false,
    isTrayShowCurrentCountdown: true,
    startOfNextDay: 0,
    isDisableAnimations: false,
    isDisableCelebration: false,
    isShowProductivityTipLonger: false,
    isOverlayIndicatorEnabled: false,
    customTheme: 'default',
    defaultStartPage: 0,
  },
  shortSyntax: {
    isEnableProject: true,
    isEnableDue: true,
    isEnableTag: true,
  },
  evaluation: {
    isHideEvaluationSheet: false,
  },
  idle: {
    isOnlyOpenIdleWhenCurrentTask: false,
    isEnableIdleTimeTracking: true,
    minIdleTime: 5 * minute,
  },
  takeABreak: {
    isTakeABreakEnabled: true,
    isLockScreen: false,
    isTimedFullScreenBlocker: false,
    timedFullScreenBlockerDuration: 8000,
    isFocusWindow: false,

    takeABreakMessage:
      'You have been working for ${duration} without one. Go away from the computer! Take a short walk! Makes you more productive in the long run!',
    takeABreakMinWorkingTime: 60 * minute,
    takeABreakSnoozeTime: 15 * minute,
    motivationalImgs: [],
  },
  dominaMode: {
    isEnabled: false,
    interval: 5 * minute,
    volume: 75,
    text: 'Your current task is: ${currentTaskTitle}',
    voice: defaultVoice,
  },
  focusMode: {
    isSkipPreparation: false,
    isPlayTick: false,
    isPauseTrackingDuringBreak: false,
    isSyncSessionWithTracking: false,
    isStartInBackground: false,
  },
  clipboardImages: {
    imagePath: null,
  },
  pomodoro: {
    duration: 25 * minute,
    breakDuration: 5 * minute,
    longerBreakDuration: 15 * minute,
    cyclesBeforeLongerBreak: 4,
  },
  keyboard: {
    globalShowHide: 'Ctrl+Shift+X',
    globalToggleTaskStart: null,
    globalAddNote: null,
    globalAddTask: null,
    addNewTask: 'Shift+A',
    addNewProject: 'Shift+P',
    addNewNote: 'N',
    openProjectNotes: 'Shift+N',
    toggleTaskViewCustomizerPanel: 'C',
    toggleIssuePanel: 'P',
    focusSideNav: 'Shift+D',
    showHelp: '?',
    showSearchBar: 'Shift+F',
    toggleBacklog: 'B',
    goToFocusMode: 'F',
    goToWorkView: 'W',
    goToScheduledView: 'Shift+S',
    goToTimeline: 'Shift+T',
    // goToDailyAgenda: null,
    // goToFocusMode: 'Shift+F',
    goToSettings: null,
    zoomIn: 'Ctrl++',
    zoomOut: 'Ctrl+-',
    zoomDefault: 'Ctrl+0',
    saveNote: 'Ctrl+S',
    triggerSync: 'Ctrl+S',
    taskEditTitle: null,
    taskToggleDetailPanelOpen: 'I',
    taskOpenEstimationDialog: 'T',
    taskSchedule: 'S',
    taskUnschedule: 'U',
    taskToggleDone: 'D',
    taskAddSubTask: 'A',
    taskAddAttachment: 'L',
    taskDelete: 'Backspace',
    taskMoveToProject: 'E',
    taskOpenContextMenu: 'Q',
    selectPreviousTask: 'K',
    selectNextTask: 'J',
    moveTaskUp: 'Ctrl+Shift+ArrowUp',
    moveTaskDown: 'Ctrl+Shift+ArrowDown',
    moveTaskToTop: 'Ctrl+Alt+ArrowUp',
    moveTaskToBottom: 'Ctrl+Alt+ArrowDown',
    moveToBacklog: 'Shift+B',
    moveToTodaysTasks: 'Shift+T',
    expandSubTasks: null,
    collapseSubTasks: null,
    togglePlay: 'Y',
    taskEditTags: 'G',
  },
  localBackup: {
    isEnabled: true,
  },
  sound: {
    volume: 75,
    isIncreaseDoneSoundPitch: true,
    doneSound: 'ding-small-bell.mp3',
    breakReminderSound: null,
    trackTimeSound: null,
  },
  timeTracking: {
    trackingInterval: TRACKING_INTERVAL,
    defaultEstimate: 0,
    defaultEstimateSubTasks: 0,
    isNotifyWhenTimeEstimateExceeded: true,
    isAutoStartNextTask: false,
    isTrackingReminderEnabled: false,
    isTrackingReminderShowOnMobile: false,
    trackingReminderMinTime: 5 * minute,
    isTrackingReminderNotify: false, // Show desktop notification when tracking reminder is triggered
    isTrackingReminderFocusWindow: false, // Focus the application window when tracking reminder is triggered
  },
  reminder: {
    isCountdownBannerEnabled: true,
    countdownDuration: minute * 10,
    defaultTaskRemindOption: TaskReminderOptionId.AtStart, // The hard-coded default prior to this changeable setting
    isFocusWindow: false,
    useAlarmStyleReminders: false,
  },
  schedule: {
    isWorkStartEndEnabled: true,
    workStart: DEFAULT_DAY_START,
    workEnd: '17:00',
    isLunchBreakEnabled: false,
    lunchBreakStart: '13:00',
    lunchBreakEnd: '14:00',
  },

  sync: {
    isEnabled: false,
    // TODO maybe enable later if it works well
    isCompressionEnabled: false,
    isEncryptionEnabled: false,
    encryptKey: null,
    syncProvider: null,
    syncInterval: minute,
    isManualSyncOnly: false,

    webDav: {
      baseUrl: null,
      userName: null,
      password: null,
      syncFolderPath: 'super-productivity',
    },

    superSync: {
      baseUrl: environment.production
        ? 'https://sync.super-productivity.com'
        : 'http://localhost:1901',
      userName: null,
      password: null,
      accessToken: null,
      syncFolderPath: null,
    },

    localFileSync: {
      syncFolderPath: '',
    },
  },
} as const;
