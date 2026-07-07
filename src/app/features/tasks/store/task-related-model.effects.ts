import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  concatMap,
  distinctUntilChanged,
  filter,
  first,
  map,
  switchMap,
} from 'rxjs/operators';
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
        // PERF: Skip during hydration/sync before any further work.
        filter(() => !this._hydrationState.isApplyingRemoteOps()),
        // Cheap field checks first: a task with its own due date is already
        // handled by dueDay-based TODAY membership, so it can never need
        // auto-adding here. Running these before any store read means the
        // common "already-scheduled" tick short-circuits immediately.
        filter(({ task }) => !task.dueDay && typeof task.dueWithTime !== 'number'),
        // addTimeSpent fires every second while tracking; only (re)evaluate when
        // the tracked task actually changes, not per tick.
        distinctUntilChanged((a, b) => a.task.id === b.task.id),
        // PERF: read TODAY membership lazily on-demand for the rare qualifying
        // action instead of a continuously-subscribed withLatestFrom, which would
        // recompute the O(n) selectTodayTaskIds scan every tick as task entities
        // churn. Semantics are identical: the current value is read synchronously.
        concatMap((action) =>
          this._store.select(selectTodayTaskIds).pipe(
            first(),
            filter(
              (todayTaskIds) =>
                !todayTaskIds.includes(action.task.id) &&
                (!action.task.parentId || !todayTaskIds.includes(action.task.parentId)),
            ),
            map(() =>
              TaskSharedActions.planTasksForToday({
                taskIds: [action.task.id],
                today: this._dateService.todayStr(),
                startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
              }),
            ),
          ),
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
