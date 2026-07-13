import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { firstValueFrom, merge, of } from 'rxjs';
import {
  concatMap,
  debounceTime,
  filter,
  first,
  pairwise,
  switchMap,
  tap,
} from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { IS_IOS_NATIVE } from '../../../util/is-native-platform';
import { androidInterface } from '../../android/android-interface';
import { iosInterface } from '../../ios/ios-interface';
import { WidgetDataService, WidgetDoneQueueLease } from '../widget-data.service';
import { TaskService } from '../../tasks/task.service';
import { SnackService } from '../../../core/snack/snack.service';
import { Log } from '../../../core/log';
import { T } from '../../../t.const';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { selectWidgetData } from './widget.selectors';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { Dictionary } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';
import { SyncTriggerService } from '../../../imex/sync/sync-trigger.service';
import { OperationWriteFlushService } from '../../../op-log/sync/operation-write-flush.service';
import { OperationCaptureService } from '../../../op-log/capture/operation-capture.service';

/**
 * Whether the current platform has a native home screen widget wired to the
 * `widget_data` contract (Android legacy-bridge WebView or iOS Capacitor).
 */
export const IS_WIDGET_PLATFORM = IS_ANDROID_WEB_VIEW || IS_IOS_NATIVE;

/**
 * Decides which queued widget checkbox taps become setDone()/setUnDone() calls.
 * The queue is a last-wins map `{taskId: targetIsDone}`; missing tasks (deleted
 * since the tap) and tasks already in the target state are skipped so stale
 * queue entries never produce redundant update ops. Exported for direct
 * testing — the effect itself is gated by IS_WIDGET_PLATFORM.
 */
export const getTaskDoneChangesToApply = (
  queueJson: string,
  taskEntities: Dictionary<Task>,
): { id: string; isDone: boolean }[] => {
  let targets: unknown;
  try {
    targets = JSON.parse(queueJson);
  } catch (e) {
    Log.err('Failed to parse widget done queue', e);
    return [];
  }
  if (typeof targets !== 'object' || targets === null || Array.isArray(targets)) {
    return [];
  }
  return Object.entries(targets as Record<string, unknown>)
    .filter(([id, isDone]) => {
      const task = taskEntities[id];
      return typeof isDone === 'boolean' && !!task && task.isDone !== isDone;
    })
    .map(([id, isDone]) => ({ id, isDone: isDone as boolean }));
};

interface DrainWidgetDoneQueueDependencies {
  readQueue: () => Promise<WidgetDoneQueueLease | null>;
  readTaskEntities: () => Promise<Dictionary<Task>>;
  setDone: (taskId: string) => void;
  setUnDone: (taskId: string) => void;
  flushPendingWrites: () => Promise<void>;
  hasUnrecoveredPersistFailure: () => boolean;
  isInSyncWindow: () => boolean;
  waitUntilOutsideSyncWindow: () => Promise<void>;
  pushSnapshot: () => Promise<boolean>;
  acknowledgeQueue: (lease: WidgetDoneQueueLease) => Promise<void>;
}

/**
 * Applies a leased native queue snapshot and acknowledges it only after every
 * emitted task operation is durable and the updated native snapshot is saved.
 * Reading task entities after the native bridge returns prevents the async
 * handoff from making the no-op decision on stale state.
 */
export const drainWidgetDoneQueue = async (
  dependencies: DrainWidgetDoneQueueDependencies,
): Promise<number> => {
  await dependencies.waitUntilOutsideSyncWindow();
  const lease = await dependencies.readQueue();
  if (!lease) {
    return 0;
  }

  let taskEntities: Dictionary<Task>;
  do {
    await dependencies.waitUntilOutsideSyncWindow();
    taskEntities = await dependencies.readTaskEntities();
  } while (dependencies.isInSyncWindow());

  // A swallowed write failure leaves live NgRx state ahead of the durable
  // op-log. Even a target that now looks like a no-op is unsafe to acknowledge:
  // reload must first restore durable state, then the retained lease can retry.
  if (dependencies.hasUnrecoveredPersistFailure()) {
    throw new Error('Cannot drain widget queue after an op-log persistence failure');
  }

  const changes = getTaskDoneChangesToApply(lease.queueJson, taskEntities);
  for (const change of changes) {
    if (change.isDone) {
      dependencies.setDone(change.id);
    } else {
      dependencies.setUnDone(change.id);
    }
  }

  await dependencies.flushPendingWrites();
  if (dependencies.hasUnrecoveredPersistFailure()) {
    throw new Error('Widget task operation failed to persist');
  }
  if (!(await dependencies.pushSnapshot())) {
    throw new Error('Failed to persist widget snapshot after draining done queue');
  }
  await dependencies.acknowledgeQueue(lease);
  return changes.length;
};

@Injectable()
export class WidgetEffects {
  private _store = inject(Store);
  private _widgetDataService = inject(WidgetDataService);
  private _taskService = inject(TaskService);
  private _snackService = inject(SnackService);
  private _hydrationState = inject(HydrationStateService);
  private _syncTriggerService = inject(SyncTriggerService);
  private _operationWriteFlushService = inject(OperationWriteFlushService);
  private _operationCaptureService = inject(OperationCaptureService);

  // The selector emission is only a change trigger; pushCurrent() re-reads the
  // store at push time (fresher than debounce-stale data) and dedupes itself.
  pushOnStateChange$ =
    IS_WIDGET_PLATFORM &&
    createEffect(
      () =>
        this._store.select(selectWidgetData).pipe(
          filter(() => !this._hydrationState.isApplyingRemoteOps()),
          debounceTime(500),
          tap(() => this._widgetDataService.pushCurrent()),
        ),
      { dispatch: false },
    );

  // The guard above drops ALL emissions while remote ops are applied and nothing
  // re-emits afterwards, so without this the widget would miss synced changes
  // until the next local edit. Push once whenever the sync window closes.
  pushOnSyncWindowEnd$ =
    IS_WIDGET_PLATFORM &&
    createEffect(
      () =>
        this._hydrationState.isInSyncWindow$.pipe(
          pairwise(),
          filter(([wasInWindow, isInWindow]) => wasInWindow && !isInWindow),
          tap(() => this._widgetDataService.pushCurrent()),
        ),
      { dispatch: false },
    );

  // Last chance to hand the freshest state to the widget before the WebView may
  // be frozen or killed in the background — deliberately not debounced. On iOS
  // the App Group write is fast enough to fit the background grace period
  // alongside the op-log flush in main.ts.
  pushOnPause$ =
    IS_WIDGET_PLATFORM &&
    createEffect(
      () =>
        (IS_ANDROID_WEB_VIEW ? androidInterface.onPause$ : iosInterface.onPause$).pipe(
          tap(() => this._widgetDataService.pushCurrent()),
        ),
      { dispatch: false },
    );

  // Single delivery path for widget done-taps. Android: cold start and
  // background→foreground are covered by onResume$ (ReplaySubject(1)), taps
  // while the app is alive by the contentless native drain signal. iOS:
  // appStateChange fires on transitions only — never at cold start — so an
  // initial emission stands in for the missing first resume; taps while the
  // app is foregrounded apply on the next resume (no LocalBroadcast
  // equivalent, see the iOS widget plan doc). concatMap serializes overlapping
  // triggers; iOS queue reads are leases acknowledged after durable writes,
  // while Android retains its legacy destructive read.
  drainWidgetDoneQueue$ =
    IS_WIDGET_PLATFORM &&
    createEffect(
      () =>
        (IS_ANDROID_WEB_VIEW
          ? merge(androidInterface.onResume$, androidInterface.onWidgetDoneDrainRequest$)
          : merge(of(undefined), iosInterface.onResume$)
        ).pipe(
          concatMap(() =>
            this._syncTriggerService.afterInitialSyncDoneStrict$.pipe(
              first(),
              switchMap(() => this._drainDoneQueue()),
            ),
          ),
        ),
      { dispatch: false },
    );

  private async _drainDoneQueue(): Promise<void> {
    let changeCount: number;
    try {
      changeCount = await drainWidgetDoneQueue({
        readQueue: () => this._widgetDataService.readDoneQueue(),
        readTaskEntities: () =>
          firstValueFrom(this._store.select(selectTaskEntities).pipe(first())),
        setDone: (taskId) => this._taskService.setDone(taskId),
        setUnDone: (taskId) => this._taskService.setUnDone(taskId),
        flushPendingWrites: () => this._operationWriteFlushService.flushPendingWrites(),
        hasUnrecoveredPersistFailure: () =>
          this._operationCaptureService.hasUnrecoveredPersistFailure(),
        isInSyncWindow: () => this._hydrationState.isInSyncWindow(),
        waitUntilOutsideSyncWindow: async () => {
          if (this._hydrationState.isInSyncWindow()) {
            await firstValueFrom(
              this._hydrationState.isInSyncWindow$.pipe(
                filter((isInSyncWindow) => !isInSyncWindow),
                first(),
              ),
            );
          }
        },
        pushSnapshot: () => this._widgetDataService.pushCurrent(),
        acknowledgeQueue: (lease) => this._widgetDataService.acknowledgeDoneQueue(lease),
      });
    } catch (e) {
      Log.err('Failed to drain widget done queue', e);
      return;
    }
    Log.log('Drained widget done queue', { changeCount });

    if (changeCount > 0) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.ANDROID.WIDGET_TASKS_UPDATED,
        translateParams: { count: changeCount },
      });
    }
  }
}
