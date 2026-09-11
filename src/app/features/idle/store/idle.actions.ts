import { createAction, props } from '@ngrx/store';
import { SimpleCounter } from '../../simple-counter/simple-counter.model';
import { IdleTrackItem, SimpleCounterIdleBtn } from '../dialog-idle/dialog-idle.model';

export const triggerIdle = createAction(
  '[Idle] Trigger Idle',
  props<{ idleTime: number }>(),
);
export const resetIdle = createAction('[Idle] Reset');

export const openIdleDialog = createAction(
  '[Idle] Open dialog',
  props<{
    lastCurrentTaskId: string | null;
    enabledSimpleStopWatchCounters: SimpleCounter[];
    wasFocusSessionRunning: boolean;
  }>(),
);

export const setIdleTime = createAction(
  '[Idle] Set idle time',
  props<{ idleTime: number }>(),
);

export const idleDialogResult = createAction(
  '[Idle] Dialog result',
  props<{
    idleTime: number;
    isResetBreakTimer: boolean;
    wasFocusSessionRunning: boolean;
    trackItems: IdleTrackItem[];
    simpleCounterToggleBtnsWhenNoTrackItems?: SimpleCounterIdleBtn[];
  }>(),
);
