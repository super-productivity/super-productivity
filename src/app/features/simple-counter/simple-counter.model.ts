import { EntityState } from '@ngrx/entity';

export enum SimpleCounterType {
  StopWatch = 'StopWatch',
  ClickCounter = 'ClickCounter',
  RepeatedCountdownReminder = 'RepeatedCountdownReminder',
}

export interface SimpleCounterCfgFields {
  id: string;

  // basic cfg
  title: string;
  isEnabled: boolean;
  isHideButton?: boolean;
  icon: string | null;
  type: SimpleCounterType;
  isTrackStreaks?: boolean;
  // can be undefined due to how form works :(
  streakMinValue?: number;
  streakMode?: 'specific-days' | 'weekly-frequency';
  streakWeekDays?: { [key: number]: boolean };
  streakWeeklyFrequency?: number;

  // adv cfg
  // repeated countdown reminder
  countdownDuration?: number;
}

export interface SimpleCounterCopy extends SimpleCounterCfgFields {
  // dynamic
  countOnDay: { [key: string]: number };
  isOn: boolean;
}

export type SimpleCounter = Readonly<SimpleCounterCopy>;

export type SimpleCounterConfig = Readonly<{
  counters: SimpleCounter[];
}>;

export interface SimpleCounterState extends EntityState<SimpleCounter> {
  ids: string[];
}
