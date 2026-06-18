import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { filter, map, switchMap, withLatestFrom } from 'rxjs/operators';
import { moveTaskInTodayList } from '../../work-context/store/work-context-meta.actions';
import { GlobalConfigService } from '../../config/global-config.service';
import { EMPTY, Observable } from 'rxjs';
import { moveProjectTaskToRegularList } from '../../project/store/project.actions';
import { TimeTrackingActions } from '../../time-tracking/store/time-tracking.actions';
import { Store } from '@ngrx/store';
import { selectTodayTaskIds } from '../../work-context/store/work-context.selectors';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { HydrationStateService } from '../../../op-log/apply/hydration-state.service';
import { DateService } from '../../../core/date/date.service';

@Injectable()
export class TaskRelatedModelEffects {
  private _actions$ = inject(LOCAL_ACTIONS);
  private _globalConfigService = inject(GlobalConfigService);
  private _store = inject(Store);
  private _hydrationState = inject(HydrationStateService);
  private _dateService = inject(DateService);

  // EFFECTS ===> EXTERNAL
  // ---------------------

  ifAutoAddTodayEnabled$ = <T>(obs: Observable<T>): Observable<T> =>
    this._globalConfigService.tasks$.pipe(
      switchMap((tasks) => (tasks.isAutoAddWorkedOnToToday ? obs : EMPTY)),
    );

  autoAddTodayTagOnTracking = createEffect(() =>
    this.ifAutoAddTodayEnabled$(
      this._actions$.pipe(
        ofType(TimeTrackingActions.addTimeSpent),
        // PERF: Skip during hydration/sync to avoid selector evaluation overhead
        filter(() => !this._hydrationState.isApplyingRemoteOps()),
        withLatestFrom(this._store.select(selectTodayTaskIds)),
        filter(
          ([{ task }, todayTaskIds]) =>
            !task.dueDay &&
            typeof task.dueWithTime !== 'number' &&
            !todayTaskIds.includes(task.id) &&
            (!task.parentId || !todayTaskIds.includes(task.parentId)),
        ),
        map(([{ task }]) =>
          TaskSharedActions.planTasksForToday({
            taskIds: [task.id],
            today: this._dateService.todayStr(),
            startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
          }),
        ),
      ),
    ),
  );

  // NOTE: Completing a task no longer auto-dates it. Completion records only
  // `doneOn`; it never synthesizes or freezes a `dueDay`. The Today "Done" list
  // is driven by `isDone`/`doneOn`, so completed tasks still show there without a
  // schedule. The `isAutoAddWorkedOnToToday` setting now gates ONLY the
  // time-tracking auto-add path above (`autoAddTodayTagOnTracking`).

  // EXTERNAL ===> TASKS
  // -------------------

  moveTaskToUnDone$ = createEffect(() =>
    this._actions$.pipe(
      ofType(moveTaskInTodayList, moveProjectTaskToRegularList),
      filter(
        ({ src, target }) => (src === 'DONE' || src === 'BACKLOG') && target === 'UNDONE',
      ),
      map(({ taskId }) =>
        TaskSharedActions.updateTask({
          task: {
            id: taskId,
            changes: {
              isDone: false,
            },
          },
        }),
      ),
    ),
  );

  moveTaskToDone$ = createEffect(() =>
    this._actions$.pipe(
      ofType(moveTaskInTodayList, moveProjectTaskToRegularList),
      filter(
        ({ src, target }) => (src === 'UNDONE' || src === 'BACKLOG') && target === 'DONE',
      ),
      map(({ taskId }) =>
        TaskSharedActions.updateTask({
          task: {
            id: taskId,
            changes: {
              isDone: true,
            },
          },
        }),
      ),
    ),
  );

  // NOTE: This effect is temporarily disabled as we migrate away from updateTaskTags
  // The tag exclusion logic for parent/child tasks needs to be revisited
  // excludeNewTagsFromParentOrChildren$: any = createEffect(() =>
  //   this._actions$.pipe(
  //     ofType(TaskSharedActions.updateTask),
  //     // TODO: Need to handle the isSkipExcludeCheck logic differently
  //     // filter(({ isSkipExcludeCheck }) => !isSkipExcludeCheck),
  //     switchMap(({ task }) => {
  //       // Implementation needs to be updated to work with updateTask action
  //       return EMPTY;
  //     }),
  //   ),
  // );
}
