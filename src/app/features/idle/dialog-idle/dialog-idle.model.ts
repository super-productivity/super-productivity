import { Task } from '../../tasks/task.model';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';

export interface SimpleCounterIdleBtn {
  id: string;
  icon: string | null;
  isTrackTo: boolean;
  isWasEnabledBefore: boolean;
  title: string;
}

export interface DialogIdleReturnData {
  trackItems: IdleTrackItem[];
  simpleCounterToggleBtnsWhenNoTrackItems?: SimpleCounterIdleBtn[];
  isResetBreakTimer: boolean;
  wasFocusSessionRunning: boolean;
}

export interface DialogIdlePassedData {
  enabledSimpleStopWatchCounters: SimpleCounter[];
  lastCurrentTaskId: string | null;
  wasFocusSessionRunning: boolean;
}

export interface IdleTrackItem {
  type: 'BREAK' | 'TASK';
  time: number | 'IDLE_TIME';
  simpleCounterToggleBtns: SimpleCounterIdleBtn[];
  task?: Task;
  title?: string;
}
