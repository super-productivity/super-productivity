import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { merge } from 'rxjs';
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
import { androidInterface } from '../android-interface';
import { WidgetDataService } from '../widget-data.service';
import { TaskService } from '../../tasks/task.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DroidLog } from '../../../core/log';
import { T } from '../../../t.const';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { DataInitStateService } from '../../../core/data-init/data-init-state.service';
import { selectAndroidWidgetData } from './android-widget.selectors';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { Dictionary } from '@ngrx/entity';
import { Task } from '../../tasks/task.model';

/**
 * Decides which queued widget done-taps become setDone() calls: dedupes and
 * skips missing (deleted since the tap) or already-done tasks so stale queue
 * entries never produce redundant update ops. Exported for direct testing —
 * the effect itself is gated by IS_ANDROID_WEB_VIEW.
 */
export const getTaskIdsToMarkDone = (
  queueJson: string,
  taskEntities: Dictionary<Task>,
): string[] => {
  let taskIds: string[];
  try {
    taskIds = JSON.parse(queueJson);
  } catch (e) {
    DroidLog.err('Failed to parse widget done queue', e);
    return [];
  }
  if (!Array.isArray(taskIds)) {
    return [];
  }
  return [...new Set(taskIds)].filter((id) => {
    const task = taskEntities[id];
    return !!task && !task.isDone;
  });
};

@Injectable()
export class AndroidWidgetEffects {
  private _store = inject(Store);
  private _widgetDataService = inject(WidgetDataService);
  private _taskService = inject(TaskService);
  private _snackService = inject(SnackService);
  private _hydrationState = inject(HydrationStateService);
  private _dataInitState = inject(DataInitStateService);

  // The selector emission is only a change trigger; pushCurrent() re-reads the
  // store at push time (fresher than debounce-stale data) and dedupes itself.
  pushOnStateChange$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        this._store.select(selectAndroidWidgetData).pipe(
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
    IS_ANDROID_WEB_VIEW &&
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
  // be frozen or killed in the background — deliberately not debounced.
  pushOnPause$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onPause$.pipe(tap(() => this._widgetDataService.pushCurrent())),
      { dispatch: false },
    );

  // Single delivery path for widget done-taps: cold start and background→
  // foreground are covered by onResume$ (ReplaySubject(1)), taps while the app
  // is alive by the contentless native drain signal. The queue read is
  // get-and-clear, so overlapping triggers drain at most once.
  drainWidgetDoneQueue$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        merge(
          androidInterface.onResume$,
          androidInterface.onWidgetDoneDrainRequest$,
        ).pipe(
          concatMap(() =>
            this._dataInitState.isAllDataLoadedInitially$.pipe(
              first(),
              switchMap(() => this._store.select(selectTaskEntities).pipe(first())),
            ),
          ),
          tap((taskEntities) => this._drainDoneQueue(taskEntities)),
        ),
      { dispatch: false },
    );

  private _drainDoneQueue(taskEntities: Dictionary<Task>): void {
    const queueJson = androidInterface.getWidgetDoneQueue?.();
    if (!queueJson) {
      return;
    }
    const idsToMarkDone = getTaskIdsToMarkDone(queueJson, taskEntities);
    for (const taskId of idsToMarkDone) {
      this._taskService.setDone(taskId);
    }
    DroidLog.log('Drained widget done queue', { doneCount: idsToMarkDone.length });

    if (idsToMarkDone.length > 0) {
      this._snackService.open({
        type: 'SUCCESS',
        msg: T.F.ANDROID.WIDGET_TASKS_DONE,
        translateParams: { count: idsToMarkDone.length },
      });
    }
  }
}
