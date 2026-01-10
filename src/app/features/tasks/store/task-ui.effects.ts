import { inject, Injectable } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { undoDeleteTask } from './task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { select, Store } from '@ngrx/store';
import {
  distinctUntilChanged,
  filter,
  first,
  map,
  skip,
  switchMap,
  tap,
  throttleTime,
  withLatestFrom,
} from 'rxjs/operators';
import { selectCurrentTask, selectCurrentTaskId } from './task.selectors';
import { NotifyService } from '../../../core/notify/notify.service';
import { TaskService } from '../task.service';
import { selectConfigFeatureState } from '../../config/store/global-config.reducer';
import { truncate } from '../../../util/truncate';
import { BannerService } from '../../../core/banner/banner.service';
import { BannerId } from '../../../core/banner/banner.model';
import { T } from '../../../t.const';
import { SnackService } from '../../../core/snack/snack.service';
import { WorkContextService } from '../../work-context/work-context.service';
import { GlobalConfigService } from '../../config/global-config.service';
import { playDoneSound } from '../util/play-done-sound';
import { Task } from '../task.model';
import { EMPTY } from 'rxjs';
import { selectProjectById } from '../../project/store/project.selectors';
import { Router } from '@angular/router';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';

@Injectable()
export class TaskUiEffects {
  private _actions$ = inject(Actions);
  private _store$ = inject<Store<any>>(Store);
  private _notifyService = inject(NotifyService);
  private _taskService = inject(TaskService);
  private _router = inject(Router);
  private _bannerService = inject(BannerService);
  private _snackService = inject(SnackService);
  private _globalConfigService = inject(GlobalConfigService);
  private _workContextService = inject(WorkContextService);
  private _navigateToTaskService = inject(NavigateToTaskService);

  taskCreatedSnack$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.addTask),
        withLatestFrom(this._workContextService.mainListTaskIds$),
        switchMap(([{ task }, activeContextTaskIds]) => {
          if (task.projectId) {
            return this._store$
              .select(selectProjectById, { id: task.projectId as string })
              .pipe(
                first(),
                map((project) => ({ project, task, activeContextTaskIds })),
              );
          } else {
            return [{ project: null, task, activeContextTaskIds }];
          }
        }),
        tap(({ project, task, activeContextTaskIds }) => {
          const isTaskVisibleOnCurrentPage = activeContextTaskIds.includes(task.id);

          this._snackService.open({
            type: 'SUCCESS',
            translateParams: {
              taskTitle: truncate(task.title),
              projectTitle: project ? truncate(project.title) : '',
            },
            msg:
              task.projectId && !isTaskVisibleOnCurrentPage
                ? T.F.TASK.S.CREATED_FOR_PROJECT
                : T.F.TASK.S.TASK_CREATED,
            ico: 'add',
            actionStr: T.F.TASK.S.GO_TO_TASK,
            actionFn: () => {
              if (isTaskVisibleOnCurrentPage) {
                this._taskService.setSelectedId(task.id);
              } else {
                this._navigateToTaskService.navigate(task.id, false);
              }
            },
          });
        }),
      ),
    { dispatch: false },
  );

  snackDelete$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.deleteTask),
        tap(({ task }) => {
          this._snackService.open({
            translateParams: {
              title: truncate(task.title),
            },
            msg: T.F.TASK.S.DELETED,
            config: { duration: 5000 },
            actionStr: T.G.UNDO,
            actionId: undoDeleteTask.type,
          });
        }),
      ),
    { dispatch: false },
  );

  timeEstimateExceeded$ = createEffect(
    () =>
      this._store$.pipe(select(selectConfigFeatureState)).pipe(
        switchMap((globalCfg) =>
          globalCfg && globalCfg.timeTracking.isNotifyWhenTimeEstimateExceeded
            ? // reset whenever the current taskId changes (but no the task data, which is polled afterwards)
              this._store$.pipe(select(selectCurrentTaskId)).pipe(
                distinctUntilChanged(),
                switchMap(() =>
                  this._store$.pipe(
                    select(selectCurrentTask),
                    filter(
                      (currentTask) =>
                        !!currentTask &&
                        currentTask.timeEstimate > 0 &&
                        currentTask.timeSpent > currentTask.timeEstimate,
                    ),
                    // refresh every 10 minute max
                    throttleTime(10 * 60 * 1000),
                    tap((currentTask) => {
                      this._notifyAboutTimeEstimateExceeded(currentTask as Task);
                    }),
                  ),
                ),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );

  timeEstimateExceededDismissBanner$ = createEffect(
    () =>
      this._store$.pipe(select(selectConfigFeatureState)).pipe(
        switchMap((globalCfg) =>
          globalCfg && globalCfg.timeTracking.isNotifyWhenTimeEstimateExceeded
            ? this._bannerService.activeBanner$.pipe(
                switchMap((activeBanner) =>
                  activeBanner?.id === BannerId.TimeEstimateExceeded
                    ? this._store$.pipe(
                        select(selectCurrentTaskId),
                        distinctUntilChanged(),
                        skip(1),
                      )
                    : EMPTY,
                ),
                tap(() => {
                  this._bannerService.dismiss(BannerId.TimeEstimateExceeded);
                }),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );

  taskDoneSound$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task: { changes } }) => !!changes.isDone),
        withLatestFrom(
          this._workContextService.flatDoneTodayNr$,
          this._globalConfigService.sound$,
        ),
        filter(([, , soundCfg]) => !!soundCfg.doneSound),
        tap(([, doneToday, soundCfg]) => playDoneSound(soundCfg, doneToday)),
      ),
    { dispatch: false },
  );

  goToProjectSnack$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.moveToOtherProject),
        filter(
          ({ targetProjectId }) =>
            targetProjectId !== this._workContextService.activeWorkContextId,
        ),
        withLatestFrom(this._workContextService.mainListTaskIds$),
        filter(
          ([{ task }, activeContextTaskIds]) => !activeContextTaskIds.includes(task.id),
        ),
        switchMap(([{ targetProjectId, task }]) =>
          this._store$.select(selectProjectById, { id: targetProjectId }).pipe(
            first(),
            map((project) => ({ project, task })),
          ),
        ),
        tap(({ project, task }) =>
          this._snackService.open({
            type: 'SUCCESS',
            translateParams: {
              taskTitle: truncate(task.title),
              projectTitle: truncate(project.title),
            },
            msg: T.F.TASK.S.MOVED_TO_PROJECT,
            ico: 'add',
            actionFn: () => {
              this._navigateToTaskService.navigate(task.id, false);
            },
            actionStr: T.F.TASK.S.GO_TO_TASK,
          }),
        ),
      ),
    { dispatch: false },
  );

  private _notifyAboutTimeEstimateExceeded(currentTask: Task): void {
    const title = truncate(currentTask.title);

    this._notifyService.notify({
      title: T.F.TASK.N.ESTIMATE_EXCEEDED,
      body: T.F.TASK.N.ESTIMATE_EXCEEDED_BODY,
      translateParams: { title },
    });

    this._bannerService.open({
      msg: T.F.TASK.B.ESTIMATE_EXCEEDED,
      id: BannerId.TimeEstimateExceeded,
      ico: 'timer',
      translateParams: { title },
      action: {
        label: T.F.TASK.B.ADD_HALF_HOUR,
        fn: () =>
          this._taskService.update(currentTask.id, {
            // prettier-ignore
            timeEstimate: currentTask.timeSpent + (30 * 60000),
          }),
      },
      hideWhen$: this._taskService.currentTaskId$.pipe(
        filter((id) => id !== currentTask.id),
      ),
    });
  }
}
