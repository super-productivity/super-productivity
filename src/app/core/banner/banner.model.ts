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
  FocusMode = 'FocusMode',
  SimpleCounterCountdownComplete = 'SimpleCounterCountdownComplete',
  StartupNote = 'StartupNote',
}

export const BANNER_SORT_PRIO_MAP = {
  [BannerId.TakeABreak]: 6,
  [BannerId.CalendarEvent]: 5,
  [BannerId.SimpleCounterCountdownComplete]: 5,
  [BannerId.ReminderCountdown]: 4,
  [BannerId.JiraUnblock]: 4,
  [BannerId.TimeEstimateExceeded]: 3,
  [BannerId.StartTrackingReminder]: 2,
  [BannerId.StartupNote]: 2,
  [BannerId.FocusMode]: 1,
  [BannerId.Offline]: 0,
  [BannerId.InstallWebApp]: 0,
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
  isHideDismissBtn?: boolean;
  progress$?: Observable<number>;
  timer$?: Observable<number>;
  hideWhen$?: Observable<unknown>;
  img?: string;
}
