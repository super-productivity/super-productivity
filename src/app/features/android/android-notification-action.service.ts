import { inject, Injectable, InjectionToken } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { androidInterface, AndroidInterface } from './android-interface';
import { TaskService } from '../tasks/task.service';
import { selectCurrentTaskId } from '../tasks/store/task.selectors';
import {
  selectPausedTaskId,
  selectTimer,
} from '../focus-mode/store/focus-mode.selectors';
import * as focusModeActions from '../focus-mode/store/focus-mode.actions';
import { getTimerRemainingMs, TimerState } from '../focus-mode/focus-mode.model';
import { GlobalTrackingIntervalService } from '../../core/global-tracking-interval/global-tracking-interval.service';
import { OperationWriteFlushService } from '../../op-log/sync/operation-write-flush.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { ANDROID_BACKGROUND_TICK_CAP_MS } from '../../app.constants';
import { DroidLog } from '../../core/log';

/**
 * A Pause/Done tap on the tracking notification. The native side already
 * stopped its counter at `at`; `elapsedMs` is the task total it had reached.
 */
export type AndroidTrackingAction = {
  type: 'PAUSE' | 'DONE';
  taskId: string;
  elapsedMs: number;
  at: number;
};

/**
 * A tap on the focus-mode notification. PAUSE (and SKIP/COMPLETE, which also
 * freeze the timer) and RESUME were already applied to the native countdown.
 */
export type AndroidFocusAction = {
  type: 'PAUSE' | 'RESUME' | 'SKIP' | 'COMPLETE';
  at: number;
};

const isFiniteNumber = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v);

const parseQueue = <T>(
  raw: string | null | undefined,
  isValid: (entry: Record<string, unknown>) => boolean,
): T[] => {
  if (!raw) {
    return [];
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    DroidLog.err('Failed to parse notification action queue', e);
    return [];
  }
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter(
    (entry): entry is T =>
      !!entry && typeof entry === 'object' && isValid(entry as Record<string, unknown>),
  );
};

export const parseTrackingActionQueue = (
  raw: string | null | undefined,
): AndroidTrackingAction[] =>
  parseQueue<AndroidTrackingAction>(
    raw,
    (e) =>
      (e.type === 'PAUSE' || e.type === 'DONE') &&
      typeof e.taskId === 'string' &&
      !!e.taskId &&
      isFiniteNumber(e.elapsedMs) &&
      isFiniteNumber(e.at),
  );

export const parseFocusActionQueue = (
  raw: string | null | undefined,
): AndroidFocusAction[] =>
  parseQueue<AndroidFocusAction>(
    raw,
    (e) =>
      (e.type === 'PAUSE' ||
        e.type === 'RESUME' ||
        e.type === 'SKIP' ||
        e.type === 'COMPLETE') &&
      isFiniteNumber(e.at),
  );

export const NOTIFICATION_ACTION_ANDROID_INTERFACE = new InjectionToken<AndroidInterface>(
  'NOTIFICATION_ACTION_ANDROID_INTERFACE',
  { providedIn: 'root', factory: () => androidInterface },
);

/**
 * Applies tracking and focus-mode notification actions queued by the native
 * NotificationActionReceiver (#10683). The buttons are broadcasts, so a tap
 * works without the WebView; the native side stops/freezes its own timer at
 * tap time, and this service brings the store in line once the app is (or
 * becomes) able to: on startup, on resume, and on the live drain signal.
 *
 * Every queued action is read destructively and applied at most once, as one
 * local user intent. Triggers are native signals, never store actions, so
 * replayed or remote ops cannot re-run anything here.
 */
@Injectable({ providedIn: 'root' })
export class AndroidNotificationActionService {
  private _androidInterface = inject(NOTIFICATION_ACTION_ANDROID_INTERFACE);
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _globalTrackingInterval = inject(GlobalTrackingIntervalService);
  private _operationWriteFlush = inject(OperationWriteFlushService);

  private _timer = this._store.selectSignal(selectTimer);
  private _currentTaskId = this._store.selectSignal(selectCurrentTaskId);
  private _pausedTaskId = this._store.selectSignal(selectPausedTaskId);
  // Snapshot AND tail ops: a task total from the snapshot alone would overstate
  // the time still to credit.
  private _isAllDataLoaded = toSignal(
    inject(DataInitStateService).isAllDataLoadedInitially$,
    {
      initialValue: false,
    },
  );

  /**
   * Drains both queues. The synchronous part (stopping the current task and
   * crediting its ticks up to the tap) is done before this returns, so a caller
   * crediting the background gap right after — the resume handler — can't
   * hand the post-tap time to a task that was paused by the tap.
   */
  drain(): Promise<void> {
    if (!this._isAllDataLoaded()) {
      return Promise.resolve();
    }
    const trackingDone = this._drainTracking();
    this.drainFocus();
    return trackingDone;
  }

  /**
   * @param isAfterRecovery the store was just restored from the native session,
   * which already reflects any PAUSE/RESUME taps, so only SKIP/COMPLETE apply.
   */
  drainFocus(isAfterRecovery = false): void {
    if (!this._isAllDataLoaded()) {
      return;
    }
    if (this._timer().purpose === null) {
      if (this._androidInterface.getFocusModeElapsed?.() !== 'null') {
        // A native session the store hasn't adopted yet: leave the queue for
        // recoverFocusSession$, which drains it right after restoring.
        return;
      }
      // No session anywhere: the actions are stale; drop them so they can't
      // hit a session started later.
      this._androidInterface.getFocusActionQueue?.();
      return;
    }
    let actions = parseFocusActionQueue(this._androidInterface.getFocusActionQueue?.());
    if (isAfterRecovery) {
      // Skip/Complete freeze the native timer; a Resume tapped after that
      // restarted it, and the restored session already reflects that.
      const lastResume = actions.map((a) => a.type).lastIndexOf('RESUME');
      actions = actions.slice(lastResume + 1);
    }
    for (const action of actions) {
      DroidLog.log('Applying focus notification action', { type: action.type });
      this._applyFocusAction(action, isAfterRecovery);
    }
  }

  private async _drainTracking(): Promise<void> {
    const actions = parseTrackingActionQueue(
      this._androidInterface.getTrackingActionQueue?.(),
    );
    if (!actions.length) {
      return;
    }
    // Synchronous phase: settle the live tracking state first.
    for (const action of actions) {
      if (this._currentTaskId() === action.taskId) {
        // Ticks run until the tap and not beyond; the native total below
        // covers whatever the capped tick leaves out.
        this._globalTrackingInterval.triggerWakeUpTickUntil(
          action.at,
          ANDROID_BACKGROUND_TICK_CAP_MS,
        );
        this._taskService.flushAccumulatedTimeSpent();
        this._taskService.pauseCurrent();
      }
    }
    try {
      for (const action of actions) {
        DroidLog.log('Applying tracking notification action', {
          type: action.type,
          taskId: action.taskId,
        });
        const task = await firstValueFrom(this._taskService.getByIdOnce$(action.taskId));
        if (!task) {
          DroidLog.warn('Task for tracking notification action not found', {
            taskId: action.taskId,
          });
          continue;
        }
        // The native counter started from the task total, so whatever it is
        // ahead by is time recorded only natively. Behind (e.g. time added on
        // another device meanwhile) means nothing is missing.
        const missingMs = action.elapsedMs - task.timeSpent;
        if (missingMs > 0) {
          this._taskService.addTimeSpentAndSync(task, missingMs);
        }
        if (action.type === 'DONE' && !task.isDone) {
          this._taskService.setDone(task.id);
        }
      }
      await this._operationWriteFlush.flushPendingWrites();
    } catch (e) {
      DroidLog.err('Failed to apply tracking notification actions', e);
    }
  }

  private _applyFocusAction(action: AndroidFocusAction, isAfterRecovery: boolean): void {
    const timer = this._timer();
    switch (action.type) {
      case 'PAUSE':
        if (!isAfterRecovery && timer.purpose !== null && timer.isRunning) {
          if (timer.purpose === 'work') {
            this._creditFocusTicksUntil(action.at, timer);
          }
          this._store.dispatch(
            focusModeActions.pauseFocusSession({ pausedTaskId: this._currentTaskId() }),
          );
        }
        return;
      case 'RESUME':
        if (!isAfterRecovery && timer.purpose !== null && !timer.isRunning) {
          this._store.dispatch(focusModeActions.unPauseFocusSession());
        }
        return;
      case 'SKIP':
        if (timer.purpose === 'break') {
          this._store.dispatch(
            focusModeActions.skipBreak({ pausedTaskId: this._pausedTaskId() }),
          );
        }
        return;
      case 'COMPLETE':
        // The native timer froze at the tap, so a recovered session is paused.
        if (timer.purpose === 'work') {
          const credited = timer.isRunning
            ? this._creditFocusTicksUntil(action.at, timer)
            : 0;
          const elapsed = timer.elapsed + credited;
          this._store.dispatch(
            focusModeActions.completeFocusSession({
              isManual: true,
              completedDuration:
                timer.duration > 0 ? Math.min(timer.duration, elapsed) : elapsed,
            }),
          );
        }
        return;
    }
  }

  private _creditFocusTicksUntil(at: number, timer: TimerState): number {
    const cap = timer.duration > 0 ? getTimerRemainingMs(timer) : undefined;
    return this._globalTrackingInterval.triggerWakeUpTickUntil(at, cap).duration;
  }
}
