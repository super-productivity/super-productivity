import { FormlyFieldConfig } from '@ngx-formly/core';

import { LanguageCode, DateTimeLocale } from '../../core/locale.constants';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';
import { ProjectCfgFormKey } from '../project/project.model';
import { KeyboardConfig } from './keyboard-config.model';
import { TaskReminderOptionId } from '../tasks/task.model';

export type AppFeaturesConfig = Readonly<{
  isTimeTrackingEnabled: boolean;
  isFocusModeEnabled: boolean;
  isSchedulerEnabled: boolean;
  isPlannerEnabled: boolean;
  isBoardsEnabled: boolean;
  isScheduleDayPanelEnabled: boolean;
  isIssuesPanelEnabled: boolean;
  isProjectNotesEnabled: boolean;
  isSyncIconEnabled: boolean;
  isSearchEnabled: boolean;
  isDonatePageEnabled: boolean;
  isEnableUserProfiles: boolean;
  isHabitsEnabled: boolean;
}>;

export type MiscConfig = Readonly<{
  isConfirmBeforeExit: boolean;
  isConfirmBeforeExitWithoutFinishDay: boolean;
  isMinimizeToTray: boolean;
  startOfNextDay: number;
  isDisableAnimations: boolean;
  // optional because it was added later
  isDisableCelebration?: boolean;
  isShowProductivityTipLonger?: boolean;
  isTrayShowCurrentCountdown?: boolean;
  isOverlayIndicatorEnabled?: boolean;
  isUseCustomWindowTitleBar?: boolean;
  customTheme?: string;
  defaultStartPage?: number;
  unsplashApiKey?: string | null;

  // @todo: remove deprecated items in future major releases, after giving users time to migrate
  isConfirmBeforeTaskDelete?: boolean; // Deprecated
  isAutoAddWorkedOnToToday?: boolean; // Deprecated
  isAutMarkParentAsDone?: boolean; // Deprecated
  isTrayShowCurrentTask?: boolean; // Deprecated
  isTurnOffMarkdown?: boolean; // Deprecated
  defaultProjectId?: string | null | false; // Deprecated
  taskNotesTpl?: string; // Deprecated
}>;

export type TasksConfig = Readonly<{
  isAutoMarkParentAsDone: boolean;
  isAutoAddWorkedOnToToday: boolean;
  isConfirmBeforeDelete?: boolean;
  isTrayShowCurrent: boolean;
  isMarkdownFormattingInNotesEnabled: boolean;
  defaultProjectId?: string | null | false; // allow 'false' because of #569
  notesTemplate: string;
}>;

export type ShortSyntaxConfig = Readonly<{
  isEnableProject: boolean;
  isEnableDue: boolean;
  isEnableTag: boolean;
  urlBehavior?: 'keep' | 'extract' | 'keep-and-attach';
}>;

export type TimeTrackingConfig = Readonly<{
  defaultEstimate?: number | null;
  defaultEstimateSubTasks?: number | null;
  isAutoStartNextTask: boolean;
  isNotifyWhenTimeEstimateExceeded: boolean;
  isTrackingReminderEnabled: boolean;
  isTrackingReminderShowOnMobile: boolean;
  trackingReminderMinTime: number;
  isTrackingReminderNotify?: boolean;
  isTrackingReminderFocusWindow?: boolean;
}>;

export type EvaluationConfig = Readonly<{
  isHideEvaluationSheet: boolean;
}>;

export type IdleConfig = Readonly<{
  isEnableIdleTimeTracking: boolean;
  minIdleTime: number;
  isOnlyOpenIdleWhenCurrentTask: boolean;
}>;

export type TakeABreakConfig = Readonly<{
  isTakeABreakEnabled: boolean;
  isLockScreen: boolean;
  isTimedFullScreenBlocker: boolean;
  timedFullScreenBlockerDuration: number;
  isFocusWindow: boolean;
  takeABreakMessage: string;
  takeABreakMinWorkingTime: number;
  takeABreakSnoozeTime: number;
  // due to ngx-formly inconsistency they also can be undefined or null even
  motivationalImgs: (string | undefined | null)[];
}>;

export type PomodoroConfig = Readonly<{
  // due to formly not being reliable here we need to be more lenient
  duration?: number | null;
  breakDuration?: number | null;
  longerBreakDuration?: number | null;
  cyclesBeforeLongerBreak: number;
}>;

// NOTE: needs to be writable due to how we use it
// export type DropboxSyncConfig = object;

export interface WebDavConfig {
  baseUrl?: string | null;
  userName?: string | null;
  password?: string | null;
  // TODO remove and migrate
  syncFilePath?: string | null;
  syncFolderPath?: string | null;
}

export interface SuperSyncConfig extends WebDavConfig {
  accessToken?: string | null;
  /** Whether E2E encryption is enabled (SuperSync-specific setting) */
  isEncryptionEnabled?: boolean;
  /** Encryption password (SuperSync-specific, stored in private config) */
  encryptKey?: string | null;
}

export interface LocalFileSyncConfig {
  // TODO remove and migrate
  syncFilePath?: string | null;
  syncFolderPath?: string | null;
}

export type LocalBackupConfig = Readonly<{
  isEnabled: boolean;
}>;

/**
 * App localization section
 * If property value is:
 * - `undefined` - that indicates value not been setted manually yet
 * - `null` - that indicates value manually reseted to app/system default
 *
 */
export type LocalizationConfig = Readonly<{
  lng?: LanguageCode | null;
  firstDayOfWeek?: number | null;
  dateTimeLocale?: DateTimeLocale | null;
}>;

export type SoundConfig = Readonly<{
  isIncreaseDoneSoundPitch: boolean;
  doneSound: string | null;
  breakReminderSound: string | null;
  trackTimeSound?: string | null;
  volume: number;
}>;

export type SyncConfig = Readonly<{
  isEnabled: boolean;
  isEncryptionEnabled?: boolean;
  isCompressionEnabled?: boolean;
  syncProvider: SyncProviderId | null;
  syncInterval: number;
  isManualSyncOnly?: boolean;

  /* NOTE: view model for form only*/
  encryptKey?: string | null;
  /* NOTE: view model for form only*/
  webDav?: WebDavConfig;
  /* NOTE: view model for form only*/
  superSync?: SuperSyncConfig;
  /* NOTE: view model for form only*/
  localFileSync?: LocalFileSyncConfig;
}>;

export type ScheduleConfig = Readonly<{
  isWorkStartEndEnabled: boolean;
  workStart: string;
  workEnd: string;
  isLunchBreakEnabled: boolean;
  lunchBreakStart: string;
  lunchBreakEnd: string;
}>;

export type ReminderConfig = Readonly<{
  isCountdownBannerEnabled: boolean;
  countdownDuration: number;
  defaultTaskRemindOption?: TaskReminderOptionId;
  disableReminders?: boolean;
  isFocusWindow?: boolean;
  // Android only: use alarm-style notifications (louder, more intrusive)
  useAlarmStyleReminders?: boolean;
}>;

export type TrackingReminderConfigOld = Readonly<{
  isEnabled: boolean;
  isShowOnMobile: boolean;
  minTime: number;
}>;

// @todo - rename to VoiceReminderConfig
// @todo - but save DominaModeConfig for backward compatibility
// @todo - and make migration when loading old config
export type DominaModeConfig = Readonly<{
  isEnabled: boolean;
  text: string;
  interval: number;
  volume: number;
  voice?: string | null;
}>;

export type FocusModeConfig = Readonly<{
  isSkipPreparation: boolean;
  isPlayTick?: boolean;
  isPauseTrackingDuringBreak?: boolean;
  isSyncSessionWithTracking?: boolean;
  isStartInBackground?: boolean;
  isManualBreakStart?: boolean;
}>;

export type ClipboardImagesConfig = Readonly<{
  imagePath?: string | null;
}>;

export type DailySummaryNote = Readonly<{
  txt?: string;
  lastUpdateDayStr?: string;
}>;

// NOTE: config properties being undefined always means that they should be overwritten with the default value
export type GlobalConfigState = Readonly<{
  appFeatures: AppFeaturesConfig;
  localization: LocalizationConfig;
  misc: MiscConfig;
  tasks: TasksConfig;
  shortSyntax: ShortSyntaxConfig;
  evaluation: EvaluationConfig;
  idle: IdleConfig;
  takeABreak: TakeABreakConfig;
  pomodoro: PomodoroConfig;
  keyboard: KeyboardConfig;
  localBackup: LocalBackupConfig;
  sound: SoundConfig;
  timeTracking: TimeTrackingConfig;
  reminder: ReminderConfig;
  schedule: ScheduleConfig;
  dominaMode: DominaModeConfig;
  focusMode: FocusModeConfig;
  clipboardImages?: ClipboardImagesConfig;

  sync: SyncConfig;
  dailySummaryNote?: DailySummaryNote;
}>;

export type GlobalConfigSectionKey = keyof GlobalConfigState | 'EMPTY';

export type GlobalSectionConfig =
  | MiscConfig
  | TasksConfig
  | PomodoroConfig
  | KeyboardConfig
  | ScheduleConfig
  | ReminderConfig
  | DailySummaryNote
  | SyncConfig
  | ClipboardImagesConfig;
type Omit<T, K extends keyof T> = Pick<T, Exclude<keyof T, K>>;

export interface LimitedFormlyFieldConfig<FormModel> extends Omit<
  FormlyFieldConfig,
  'key'
> {
  key?: keyof FormModel;
}

export type CustomCfgSection =
  | 'FILE_IMPORT_EXPORT'
  | 'JIRA_CFG'
  | 'OPENPROJECT_CFG'
  | 'CLICKUP_CFG'
  | 'CLIPBOARD_IMAGES_CFG';

// Intermediate model
export interface ConfigFormSection<FormModel> {
  title: string;
  key: GlobalConfigSectionKey | ProjectCfgFormKey;
  help?: string;
  helpArr?: { h?: string; p: string; p2?: string; p3?: string; p4?: string }[];
  customSection?: CustomCfgSection;
  items?: LimitedFormlyFieldConfig<FormModel>[];
  isElectronOnly?: boolean;
  isHideForAndroidApp?: boolean;
}

export interface GenericConfigFormSection extends Omit<
  ConfigFormSection<unknown>,
  'items'
> {
  items?: FormlyFieldConfig[];
}

export type ConfigFormConfig = Readonly<GenericConfigFormSection[]>;
