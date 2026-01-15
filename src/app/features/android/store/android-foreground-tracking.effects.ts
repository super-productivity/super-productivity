import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  distinctUntilChanged,
  filter,
  map,
  pairwise,
  startWith,
  tap,
  withLatestFrom,
} from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import { TaskService } from '../../tasks/task.service';
import { selectCurrentTask } from '../../tasks/store/task.selectors';
import { DroidLog } from '../../../core/log';
import { DateService } from '../../../core/date/date.service';
import { Task } from '../../tasks/task.model';
import { selectTimer } from '../../focus-mode/store/focus-mode.selectors';
import { combineLatest, firstValueFrom } from 'rxjs';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';

@Injectable()
export class AndroidForegroundTrackingEffects {
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _dateService = inject(DateService);
  private _hydrationState = inject(HydrationStateService);
  private _snackService = inject(SnackService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _operationWriteFlush = inject(OperationWriteFlushService);

  /**
   * Start/stop the native foreground service when the current task changes.
   * Also handles syncing time when switching tasks directly.
   * NOTE: When focus mode is active, we hide the tracking notification
   * to avoid showing two notifications (focus mode notification takes priority).
   */
  syncTrackingToService$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        combineLatest([
          this._store.select(selectCurrentTask),
          this._store.select(selectTimer),
        ]).pipe(
          // PERF: Skip during hydration/sync to avoid unnecessary processing
          filter(() => !this._hydrationState.isApplyingRemoteOps()),
          map(([currentTask, timer]) => ({
            currentTask,
            isFocusModeActive: timer.purpose !== null,
          })),
          distinctUntilChanged(
            (a, b) =>
              a.currentTask?.id === b.currentTask?.id &&
              a.isFocusModeActive === b.isFocusModeActive,
          ),
          startWith({ currentTask: null as Task | null, isFocusModeActive: false }),
          pairwise(),
          tap(([prev, curr]) => {
            const { currentTask, isFocusModeActive } = curr;
            const prevTask = prev.currentTask;
            const wasFocusModeActive = prev.isFocusModeActive;

            // If switching from one task to another (or stopping), sync the previous task's time first
            // Also sync when focus mode just started (to capture time tracked before focus mode)
            const focusModeJustStarted = isFocusModeActive && !wasFocusModeActive;
            if (prevTask && (!wasFocusModeActive || focusModeJustStarted)) {
              this._syncElapsedTimeForTask(prevTask.id);
            }

            // Don't show tracking notification when focus mode is active
            // (focus mode notification takes priority)
            if (isFocusModeActive) {
              DroidLog.log(
                'Focus mode active, stopping tracking service to avoid duplicate notification',
              );
              this._safeNativeCall(
                () => androidInterface.stopTrackingService?.(),
                'Failed to stop tracking service',
              );
              return;
            }

            if (currentTask) {
              DroidLog.log('Starting tracking service', {
                taskId: currentTask.id,
                title: currentTask.title,
                timeSpent: currentTask.timeSpent,
              });
              this._safeNativeCall(
                () =>
                  androidInterface.startTrackingService?.(
                    currentTask.id,
                    currentTask.title,
                    currentTask.timeSpent || 0,
                  ),
                'Failed to start tracking notification',
                true,
              );
            } else {
              DroidLog.log('Stopping tracking service');
              this._safeNativeCall(
                () => androidInterface.stopTrackingService?.(),
                'Failed to stop tracking service',
              );
            }
          }),
        ),
      { dispatch: false },
    );

  /**
   * When the app resumes from background, sync the elapsed time from the native service.
   */
  syncOnResume$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onResume$.pipe(
          withLatestFrom(this._store.select(selectCurrentTask)),
          filter(([, currentTask]) => !!currentTask),
          tap(async ([, currentTask]) => {
            await this._syncElapsedTimeForTask(currentTask!.id);
          }),
        ),
      { dispatch: false },
    );

  /**
   * Update the native service when timeSpent changes for the current task.
   * This handles the case where the user manually edits the time spent.
   */
  syncTimeSpentChanges$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        combineLatest([
          this._store.select(selectCurrentTask),
          this._store.select(selectTimer),
        ]).pipe(
          // PERF: Skip during hydration/sync to avoid unnecessary processing
          filter(() => !this._hydrationState.isApplyingRemoteOps()),
          map(([currentTask, timer]) => ({
            taskId: currentTask?.id || null,
            timeSpent: currentTask?.timeSpent || 0,
            isFocusModeActive: timer.purpose !== null,
          })),
          // Only react when timeSpent changes for the same task
          distinctUntilChanged(
            (a, b) =>
              a.taskId === b.taskId &&
              a.timeSpent === b.timeSpent &&
              a.isFocusModeActive === b.isFocusModeActive,
          ),
          // Provide initial state so pairwise can emit on first actual change
          startWith({ taskId: null, timeSpent: 0, isFocusModeActive: false }),
          pairwise(),
          filter(([prev, curr]) => {
            // Only update if:
            // 1. Same task (not switching tasks - that's handled by syncTrackingToService$)
            // 2. Task exists
            // 3. Focus mode is not active (notification is hidden during focus mode)
            // 4. timeSpent actually changed
            return (
              prev.taskId === curr.taskId &&
              curr.taskId !== null &&
              !curr.isFocusModeActive &&
              prev.timeSpent !== curr.timeSpent
            );
          }),
          tap(([, curr]) => {
            DroidLog.log('Time spent changed for current task, updating service', {
              taskId: curr.taskId,
              timeSpent: curr.timeSpent,
            });
            this._safeNativeCall(
              () => androidInterface.updateTrackingService?.(curr.timeSpent),
              'Failed to update tracking service',
            );
          }),
        ),
      { dispatch: false },
    );

  /**
   * Handle pause action from the notification.
   * Immediately saves to DB to prevent data loss if app is closed quickly.
   */
  handlePauseAction$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onPauseTracking$.pipe(
          withLatestFrom(this._store.select(selectCurrentTask)),
          filter(([, currentTask]) => !!currentTask),
          tap(async ([, currentTask]) => {
            DroidLog.log('Pause action from notification');
            // Sync elapsed time first and wait for completion
            await this._syncElapsedTimeForTask(currentTask!.id);
            this._taskService.pauseCurrent();
            // Flush pending operations to IndexedDB to prevent data loss
            this._flushPendingOperations();
          }),
        ),
      { dispatch: false },
    );

  /**
   * Handle done action from the notification.
   * Immediately saves to DB to prevent data loss if app is closed quickly.
   */
  handleDoneAction$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onMarkTaskDone$.pipe(
          withLatestFrom(this._store.select(selectCurrentTask)),
          filter(([, currentTask]) => !!currentTask),
          tap(async ([, currentTask]) => {
            DroidLog.log('Done action from notification', { taskId: currentTask!.id });
            // Sync elapsed time and wait for completion
            await this._syncElapsedTimeForTask(currentTask!.id);
            this._taskService.setDone(currentTask!.id);
            this._taskService.pauseCurrent();
            // Flush pending operations to IndexedDB to prevent data loss
            this._flushPendingOperations();
          }),
        ),
      { dispatch: false },
    );

  private _safeNativeCall(fn: () => void, errorMsg: string, showSnackbar = false): void {
    try {
      fn();
    } catch (e) {
      DroidLog.err(errorMsg, e);
      if (showSnackbar) {
        this._snackService.open({ msg: errorMsg, type: 'ERROR' });
      }
    }
  }

  /**
   * Force immediate flush of pending operations to IndexedDB.
   * This ensures all dispatched NgRx actions are persisted to the operation log
   * before the app can be closed (e.g., after notification button clicks).
   */
  private _flushPendingOperations(): void {
    this._operationWriteFlush.flushPendingWrites().catch((e) => {
      DroidLog.err('Failed to flush pending operations', e);
    });
    DroidLog.log('Triggered immediate flush of pending operations');
  }

  /**
   * Sync elapsed time from native service to the task.
   * Only syncs if the native service is tracking the specified task.
   * Uses async/await with firstValueFrom for reliable observable handling.
   */
  private async _syncElapsedTimeForTask(taskId: string): Promise<void> {
    const elapsedJson = androidInterface.getTrackingElapsed?.();
    DroidLog.log('Syncing elapsed time for task', { taskId, elapsedJson });

    if (!elapsedJson || elapsedJson === 'null') {
      return;
    }

    try {
      const nativeData = JSON.parse(elapsedJson) as {
        taskId: string;
        elapsedMs: number;
      };

      // Only sync if native is tracking the same task
      if (nativeData.taskId !== taskId) {
        DroidLog.log('Native tracking different task, skipping sync', {
          nativeTaskId: nativeData.taskId,
          expectedTaskId: taskId,
        });
        return;
      }

      // Get the task to find its current timeSpent
      const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
      if (!task) {
        DroidLog.log('Task not found for sync', { taskId });
        return;
      }

      const currentTimeSpent = task.timeSpent || 0;
      const duration = nativeData.elapsedMs - currentTimeSpent;

      DroidLog.log('Calculated sync duration', {
        taskId,
        nativeElapsed: nativeData.elapsedMs,
        currentTimeSpent,
        duration,
      });

      if (duration > 0) {
        this._taskService.addTimeSpent(task, duration, this._dateService.todayStr());
        // Reset the tracking interval to prevent double-counting
        // The native service has the authoritative time, so we reset the app's
        // interval timer to avoid adding the same time again from tick$
        this._globalTrackingIntervalService.resetTrackingStart();
      }
    } catch (e) {
      DroidLog.err('Failed to sync elapsed time', e);
    }
  }
}
