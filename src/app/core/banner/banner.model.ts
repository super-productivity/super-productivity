import { Observable } from 'rxjs';

export enum BannerId {
  TakeABreak = 'TakeABreak',
  StartTrackingReminder = 'StartTrackingReminder',
  JiraUnblock = 'JiraUnblock',
  InstallWebApp = 'InstallWebApp',
  Offline = 'Offline',
  TimeEstimateExceeded = 'TimeEstimateExceeded',
  CalendarEvent = 'CalendarEvent',
  ReminderCountdown = 'ReminderCountdown',
  SimpleCounterCountdownComplete = 'SimpleCounterCountdownComplete',
  FocusModeSessionDone = 'FocusModeSessionDone',
  StartupNote = 'StartupNote',
  DeadlinesToday = 'DeadlinesToday',
  SyncSafetyReminder = 'SyncSafetyReminder',
  SuperSyncEncryptionMigration = 'SuperSyncEncryptionMigration',
  RatePrompt = 'RatePrompt',
  SyncConflictContentResolved = 'SyncConflictContentResolved',
  SyncConflictsAutoResolved = 'SyncConflictsAutoResolved',
  UpdateAvailable = 'UpdateAvailable',
}

export const BANNER_SORT_PRIO_MAP = {
  [BannerId.TakeABreak]: 6,
  [BannerId.CalendarEvent]: 5,
  [BannerId.SimpleCounterCountdownComplete]: 5,
  [BannerId.FocusModeSessionDone]: 5,
  [BannerId.ReminderCountdown]: 4,
  [BannerId.JiraUnblock]: 4,
  [BannerId.DeadlinesToday]: 3,
  [BannerId.TimeEstimateExceeded]: 3,
  [BannerId.StartTrackingReminder]: 2,
  [BannerId.StartupNote]: 2,
  [BannerId.Offline]: 0,
  [BannerId.InstallWebApp]: 0,
  [BannerId.SyncSafetyReminder]: 0,
  [BannerId.SuperSyncEncryptionMigration]: 0,
  [BannerId.RatePrompt]: 0,
  [BannerId.SyncConflictContentResolved]: 1,
  [BannerId.SyncConflictsAutoResolved]: 0,
  [BannerId.UpdateAvailable]: 0,
} as const;

export interface BannerAction {
  label: string;
  fn: () => void;
  icon?: string;
}

export interface Banner {
  id: BannerId;
  msg: string;
  ico?: string;
  svgIco?: string;
  translateParams?: { [key: string]: string | number };
  action?: BannerAction;
  action2?: BannerAction;
  action3?: BannerAction;
  isKeepVisibleAfterAction?: boolean;
  isHideDismissBtn?: boolean;
  progress$?: Observable<number>;
  timer$?: Observable<number>;
  hideWhen$?: Observable<unknown>;
  img?: string;
}
