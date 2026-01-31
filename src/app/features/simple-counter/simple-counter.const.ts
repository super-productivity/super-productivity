import { SimpleCounter, SimpleCounterType } from './simple-counter.model';

export const EMPTY_SIMPLE_COUNTER: SimpleCounter = {
  id: '',

  // basic cfg
  title: '',
  isEnabled: false,
  icon: null,
  type: SimpleCounterType.ClickCounter,

  // dynamic
  countOnDay: {},
  isOn: false,
  isTrackStreaks: true,
  streakMinValue: 1,
  streakMode: 'specific-days',
  // eslint-disable-next-line @typescript-eslint/naming-convention
  streakWeekDays: { 1: true, 2: true, 3: true, 4: true, 5: true, 6: false, 0: false },
};

export const DEFAULT_SIMPLE_COUNTERS: SimpleCounter[] = [
  {
    ...EMPTY_SIMPLE_COUNTER,
    id: 'STANDING_DESK_ID',
    title: 'Standing Desk Timer',
    type: SimpleCounterType.StopWatch,
    icon: 'directions_walk',
    isTrackStreaks: true,
    streakMinValue: 30 * 60 * 1000,
  },
  {
    ...EMPTY_SIMPLE_COUNTER,
    id: 'COFFEE_COUNTER',
    title: 'Coffee Counter',
    type: SimpleCounterType.ClickCounter,
    icon: 'free_breakfast',
    isTrackStreaks: false,
    streakMinValue: 2,
  },
  {
    ...EMPTY_SIMPLE_COUNTER,
    id: 'STRETCHING_COUNTER',
    title: 'Stretching Counter',
    type: SimpleCounterType.RepeatedCountdownReminder,
    icon: 'fitness_center',
    countdownDuration: 30 * 60 * 1000,
    isTrackStreaks: true,
    streakMinValue: 8,
  },
];
