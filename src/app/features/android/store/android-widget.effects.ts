import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { Store } from '@ngrx/store';
import { combineLatest } from 'rxjs';
import { debounceTime, distinctUntilChanged, filter, map, tap } from 'rxjs/operators';
import { IS_ANDROID_WEB_VIEW } from '../../../util/is-android-web-view';
import { androidInterface } from '../android-interface';
import { WidgetDataService } from '../widget-data.service';
import { TaskService } from '../../tasks/task.service';
import { SnackService } from '../../../core/snack/snack.service';
import { DroidLog } from '../../../core/log';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { selectTaskEntities } from '../../tasks/store/task.selectors';
import { selectAllProjectColorsAndTitles } from '../../project/store/project.selectors';

@Injectable()
export class AndroidWidgetEffects {
  private _store = inject(Store);
  private _widgetDataService = inject(WidgetDataService);
  private _taskService = inject(TaskService);
  private _snackService = inject(SnackService);
  private _hydrationState = inject(HydrationStateService);

  pushOnStateChange$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        combineLatest([
          this._store.select(selectTodayTaskIds),
          this._store.select(selectTaskEntities),
          this._store.select(selectAllProjectColorsAndTitles),
        ]).pipe(
          filter(() => !this._hydrationState.isApplyingRemoteOps()),
          map(([todayIds, entities, _projects]) => {
            const relevant = todayIds.map((id) => {
              const t = entities[id];
              return t ? `${t.id}:${t.isDone}:${t.title}` : '';
            });
            return relevant.join('|');
          }),
          distinctUntilChanged(),
          debounceTime(500),
          tap(() => {
            this._widgetDataService.serialize();
          }),
        ),
      { dispatch: false },
    );

  pushOnPause$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onPause$.pipe(
          tap(() => {
            this._widgetDataService.serialize();
          }),
        ),
      { dispatch: false },
    );

  drainWidgetDoneQueueOnResume$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onResume$.pipe(
          tap(() => {
            try {
              const doneQueue = androidInterface.getWidgetDoneQueue?.();
              if (doneQueue) {
                const taskIds: string[] = JSON.parse(doneQueue);
                DroidLog.log('Resume: found widget done queue', taskIds);
                for (const id of taskIds) {
                  androidInterface.onWidgetDone$.next(id);
                }
              }
            } catch (e) {
              DroidLog.err('Failed to process widget done queue on resume', e);
            }
          }),
        ),
      { dispatch: false },
    );

  handleWidgetDone$ =
    IS_ANDROID_WEB_VIEW &&
    createEffect(
      () =>
        androidInterface.onWidgetDone$.pipe(
          tap((taskId: string) => {
            DroidLog.log('Widget done action for task', { id: taskId });
            this._taskService.setDone(taskId);
            this._snackService.open({
              type: 'SUCCESS',
              msg: 'Task marked done from widget',
            });
          }),
        ),
      { dispatch: false },
    );
}
