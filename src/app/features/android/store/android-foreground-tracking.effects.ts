import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import {
  distinctUntilChanged,
  exhaustMap,
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
import {
  selectCurrentTask,
  selectIsTaskDataLoaded,
} from '../../tasks/store/task.selectors';
import { DroidLog } from '../../../core/log';
import { DateService } from '../../../core/date/date.service';
import { Task } from '../../tasks/task.model';
import { selectTimer } from '../../focus-mode/store/focus-mode.selectors';
import { combineLatest, firstValueFrom, Subject } from 'rxjs';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { GlobalTrackingIntervalService } from '../../../core/global-tracking-interval/global-tracking-interval.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { syncTimeSpent } from '../../time-tracking/store/time-tracking.actions';

export type NativeTrackingData = {
  taskId: string;
  elapsedMs: number;
};

type RecoveryRequest = {
  data: NativeTrackingData;
  // Diagnostic label for issue #7390 field triage; kept narrow so callers
  // can't accidentally pass user-derived data into the log.
  source: 'cold-start' | 'resume';
};

/**
 * Parse the JSON string returned by `androidInterface.getTrackingElapsed()`.
 * Returns null for any falsy/`'null'` input or shape mismatch — the caller
 * treats null as "native is not tracking anything".
 *
 * Exported so unit tests can exercise it without instantiating the effect
 * (which is gated behind IS_ANDROID_WEB_VIEW).
 */
export const parseNativeTrackingData = (
  elapsedJson: string | null | undefined,
): NativeTrackingData | null => {
  if (!elapsedJson || elapsedJson === 'null') {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(elapsedJson);
  } catch (e) {
    DroidLog.err('Failed to parse native tracking data', e);
    return null;
  }

  // Log a length-only fingerprint instead of the raw payload — the native
  // contract today is shape-only (taskId/elapsedMs), but we don't want to
  // burn user content into the exportable log if that ever changes.
  if (!parsed || typeof parsed !== 'object') {
    DroidLog.warn('Native service returned non-object tracking data', {
      length: elapsedJson.length,
    });
    return null;
  }

  const { taskId, elapsedMs } = parsed as Partial<NativeTrackingData>;
  if (
    typeof taskId !== 'string' ||
    typeof elapsedMs !== 'number' ||
    !Number.isFinite(elapsedMs)
  ) {
    DroidLog.warn('Native service returned invalid tracking data', {
      length: elapsedJson.length,
    });
    return null;
  }

  return { taskId, elapsedMs };
};

@Injectable()
export class AndroidForegroundTrackingEffects {
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _dateService = inject(DateService);
  private _hydrationState = inject(HydrationStateService);
  private _snackService = inject(SnackService);
  private _globalTrackingIntervalService = inject(GlobalTrackingIntervalService);
  private _operationWriteFlush = inject(OperationWriteFlushService);

  // Recovery requests funnel through this Subject for the cold-start path.
  //   Producers: syncTrackingToService$ tap (cold-start), syncOnResume$ tap.
  //   Consumer:  processRecovery$ (with exhaustMap → coalescing).
  // exhaustMap intentionally drops concurrent requests while one is in-flight;
  // this is safe because the native counter is the source of truth and any
  // in-flight recovery will reconcile it. A dropped trigger represents at
  // most a few-hundred-ms staleness which self-heals on the next user action.
  private _recoveryRequest$ = new Subject<RecoveryRequest>();

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
          this._store.select(selectIsTaskDataLoaded),
        ]).pipe(
          // PERF: Skip during hydration/sync to avoid unnecessary processing
          filter(
            ([, , isTaskDataLoaded]) =>
              isTaskDataLoaded && !this._hydrationState.isApplyingRemoteOps(),
          ),
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
              // null → task transition can be either a fresh user start or
              // the post-recovery setCurrentId re-emission. If native is
              // already tracking the same task, just push the synced
              // timeSpent via update — calling startTrackingService here
              // would reset accumulatedMs and clobber the native counter
              // recovery just reconciled.
              if (!prevTask) {
                const nativeData = this._getNativeTrackingData();
                if (nativeData?.taskId === currentTask.id) {
                  DroidLog.log(
                    'Native already tracking this task; updating notification only',
                    { taskId: currentTask.id },
                  );
                  this._safeNativeCall(
                    () =>
                      androidInterface.updateTrackingService?.(
                        currentTask.timeSpent || 0,
                      ),
                    'Failed to update tracking service',
                  );
                  return;
                }
              }

              DroidLog.log('Starting tracking service', {
                taskId: currentTask.id,
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
              if (!prevTask) {
                const nativeData = this._getNativeTrackingData();
                if (nativeData) {
                  this._recoveryRequest$.next({ data: nativeData, source: 'cold-start' });
                  return;
                }
              }

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
   * Drains recovery requests with exhaustMap so concurrent triggers coalesce
   * onto a single in-flight recovery. The inner promise has its own catch so
   * a rejected recovery resolves the inner observable cleanly — exhaustMap
   * stays subscribed and ready for the next request.
   */
  processRecovery$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._recoveryRequest$.pipe(
          exhaustMap(({ data, source }) =>
            this._doRecover(data, source).catch((e) => {
              DroidLog.err('Recovery failed', e);
            }),
          ),
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
          withLatestFrom(
            this._store.select(selectCurrentTask),
            this._store.select(selectIsTaskDataLoaded),
          ),
          filter(([, , isTaskDataLoaded]) => isTaskDataLoaded),
          tap(async ([, currentTask]) => {
            if (currentTask) {
              await this._syncElapsedTimeForTask(currentTask.id);
            } else {
              const nativeData = this._getNativeTrackingData();
              if (nativeData) {
                this._recoveryRequest$.next({ data: nativeData, source: 'resume' });
              }
            }
          }),
        ),
      { dispatch: false },
    );

  /**
   * When the app goes to background, flush accumulated time to prevent data loss.
   * This ensures all tracked time is persisted to IndexedDB before the app
   * potentially gets terminated by the OS.
   */
  flushOnPause$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onPause$.pipe(
          withLatestFrom(this._store.select(selectCurrentTask)),
          tap(async ([, currentTask]) => {
            DroidLog.log('App going to background, flushing time tracking data');

            // If there's a current task, sync elapsed time from native service first
            if (currentTask) {
              await this._syncElapsedTimeForTask(currentTask.id);
            }

            // Flush accumulated time from TaskService (dispatches syncTimeSpent)
            this._taskService.flushAccumulatedTimeSpent();

            // Flush pending operations to IndexedDB to prevent data loss
            await this._flushPendingOperations();

            DroidLog.log('Time tracking data flushed successfully');
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
            await this._flushPendingOperations();
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
            await this._flushPendingOperations();
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

  private _getNativeTrackingData(): NativeTrackingData | null {
    return parseNativeTrackingData(androidInterface.getTrackingElapsed?.());
  }

  /**
   * Recovery pipeline body. Must only be invoked via `_recoveryRequest$.next`
   * — calling directly bypasses the exhaustMap coalescing in processRecovery$
   * and would re-introduce the concurrent-recovery race.
   */
  private async _doRecover(
    nativeData: NativeTrackingData,
    source: RecoveryRequest['source'],
  ): Promise<void> {
    // Issue #7390 diagnostic: `source` distinguishes the cold-start path
    // (combineLatest fires before onResume) from the resume path. Used to
    // triage future re-reports — keep this log.
    DroidLog.log('Recovering active tracking from native service', {
      source,
      ...nativeData,
    });

    const didSync = await this._syncElapsedTimeForTask(nativeData.taskId, nativeData);
    if (!didSync) {
      DroidLog.warn('Stopping stale native tracking service after failed recovery', {
        taskId: nativeData.taskId,
      });
      this._safeNativeCall(
        () => androidInterface.stopTrackingService?.(),
        'Failed to stop stale tracking service',
      );
      return;
    }

    // setCurrentId synchronously re-runs the syncTrackingToService$ tap.
    // The null → task transition there checks native data and calls
    // updateTrackingService instead of startTrackingService when native is
    // already tracking this task — so the native counter is preserved.
    this._taskService.setCurrentId(nativeData.taskId);
    await this._flushPendingOperations();
  }

  /**
   * Force immediate flush of pending operations to IndexedDB.
   * This ensures all dispatched NgRx actions are persisted to the operation log
   * before the app can be closed (e.g., after notification button clicks).
   * CRITICAL: Must be awaited to prevent data loss if app closes quickly.
   */
  private async _flushPendingOperations(): Promise<void> {
    try {
      DroidLog.log('Starting immediate flush of pending operations');
      await this._operationWriteFlush.flushPendingWrites();
      DroidLog.log('Successfully flushed pending operations');
    } catch (e) {
      DroidLog.err('Failed to flush pending operations', e);
      this._snackService.open({
        msg: 'Failed to save time tracking data - please try again',
        type: 'ERROR',
      });
      throw e;
    }
  }

  /**
   * Sync elapsed time from native service to the task.
   * Only syncs if the native service is tracking the specified task.
   * Uses async/await with firstValueFrom for reliable observable handling.
   */
  private async _syncElapsedTimeForTask(
    taskId: string,
    nativeTrackingData?: NativeTrackingData,
  ): Promise<boolean> {
    const nativeData = nativeTrackingData ?? this._getNativeTrackingData();
    DroidLog.log('Syncing elapsed time for task', { taskId, nativeData });

    if (!nativeData) {
      DroidLog.warn('Native service has no tracking data', { taskId });
      return false;
    }

    try {
      // Only sync if native is tracking the same task
      if (nativeData.taskId !== taskId) {
        DroidLog.warn('Native tracking different task, skipping sync', {
          nativeTaskId: nativeData.taskId,
          expectedTaskId: taskId,
        });
        return false;
      }

      // Get the task to find its current timeSpent
      const task = await firstValueFrom(this._taskService.getByIdOnce$(taskId));
      if (!task) {
        DroidLog.err('Task not found for sync - data may be corrupted', { taskId });
        this._snackService.open({
          msg: 'Time tracking sync failed - task not found',
          type: 'WARNING',
        });
        return false;
      }

      const currentTimeSpent = task.timeSpent || 0;
      const duration = nativeData.elapsedMs - currentTimeSpent;

      DroidLog.log('Calculated sync duration', {
        taskId,
        nativeElapsed: nativeData.elapsedMs,
        currentTimeSpent,
        duration,
      });

      // Handle negative duration (clock skew or service crash)
      // When native has less time than app, keep the app's value to prevent data loss.
      // This can happen if the native service crashed and restarted.
      if (duration < 0) {
        DroidLog.warn(
          'Native time less than app time - keeping app value to prevent data loss',
          {
            taskId,
            nativeElapsed: nativeData.elapsedMs,
            currentTimeSpent,
            duration,
          },
        );
        // Don't update time - app has more accurate/higher value
        // Update native service to show correct time in notification
        this._safeNativeCall(
          () => androidInterface.updateTrackingService?.(currentTimeSpent),
          'Failed to update tracking service after negative duration',
        );
        // Reset tracking interval to prevent double-counting
        this._globalTrackingIntervalService.resetTrackingStart();
        return true;
      }

      if (duration > 0) {
        this._taskService.addTimeSpent(task, duration, this._dateService.todayStr());
        // Also dispatch syncTimeSpent to capture in operation log
        // addTimeSpent only updates local state, syncTimeSpent creates the operation
        this._store.dispatch(
          syncTimeSpent({
            taskId: task.id,
            date: this._dateService.todayStr(),
            duration,
          }),
        );
        // Reset the tracking interval to prevent double-counting
        // The native service has the authoritative time, so we reset the app's
        // interval timer to avoid adding the same time again from tick$
        this._globalTrackingIntervalService.resetTrackingStart();
      }

      return true;
    } catch (e) {
      DroidLog.err('Failed to sync elapsed time', e);
      this._snackService.open({
        msg: 'Time tracking sync failed - please check your tracked time',
        type: 'WARNING',
      });
      return false;
    }
  }
}
