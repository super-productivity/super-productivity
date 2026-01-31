import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { setCurrentTask } from '../../../tasks/store/task.actions';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { concatMap, filter, map, take, tap, withLatestFrom } from 'rxjs/operators';
import { select, Store } from '@ngrx/store';
import { OPEN_PROJECT_TYPE } from '../../issue.const';
import { MatDialog } from '@angular/material/dialog';
import { Task, TaskCopy } from '../../../tasks/task.model';
import { OpenProjectCfg, OpenProjectTransitionOption } from './open-project.model';
import { EMPTY, Observable, of, timer } from 'rxjs';
import { DialogOpenProjectTrackTimeComponent } from './open-project-view-components/dialog-open-project-track-time/dialog-open-project-track-time.component';
import { OpenProjectApiService } from './open-project-api.service';
import { TaskService } from '../../../tasks/task.service';
import { selectCurrentTaskParentOrCurrent } from 'src/app/features/tasks/store/task.selectors';
import { isOpenProjectEnabled } from './is-open-project-enabled.util';
import { IssueLocalState } from 'src/app/features/issue/issue.model';
import { SnackService } from 'src/app/core/snack/snack.service';
import { OpenProjectWorkPackage } from './open-project-issue.model';
import { IssueService } from 'src/app/features/issue/issue.service';
import { T } from 'src/app/t.const';
import { DialogOpenProjectTransitionComponent } from './open-project-view-components/dialog-openproject-transition/dialog-open-project-transition.component';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';

@Injectable()
export class OpenProjectEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store$ = inject<Store<any>>(Store);
  private readonly _snackService = inject(SnackService);
  private readonly _openProjectApiService = inject(OpenProjectApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);
  private readonly _issueService = inject(IssueService);

  postTime$: any = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => !!task),
        concatMap((task) =>
          task.parentId
            ? this._taskService
                .getByIdOnce$(task.parentId)
                .pipe(map((parent) => ({ mainTask: parent, subTask: task })))
            : of({ mainTask: task, subTask: undefined }),
        ),
        filter(({ mainTask }) => !!mainTask),
        concatMap(({ mainTask, subTask }) =>
          mainTask.issueType === OPEN_PROJECT_TYPE &&
          mainTask.issueId &&
          mainTask.issueProviderId
            ? this._getCfgOnce$(mainTask.issueProviderId).pipe(
                tap((openProjectCfg) => {
                  if (
                    subTask &&
                    openProjectCfg.isShowTimeTrackingDialogForEachSubTask &&
                    openProjectCfg.isShowTimeTrackingDialog
                  ) {
                    this._openTrackTimeDialog(
                      subTask,
                      // TODO looks fishy???
                      +assertTruthy(mainTask.issueId),
                      openProjectCfg,
                    );
                  } else if (
                    openProjectCfg.isShowTimeTrackingDialog &&
                    !subTask &&
                    (!openProjectCfg.isShowTimeTrackingDialogForEachSubTask ||
                      !mainTask.subTaskIds.length)
                  ) {
                    this._openTrackTimeDialog(
                      mainTask,
                      // TODO looks fishy???
                      +assertTruthy(mainTask.issueId),
                      openProjectCfg,
                    );
                  }
                }),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );

  checkForStartTransition$: Observable<any> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(setCurrentTask),
        // only if a task is started
        filter(({ id }) => !!id),
        withLatestFrom(this._store$.pipe(select(selectCurrentTaskParentOrCurrent))),
        filter(
          (input): input is [(typeof input)[0], Readonly<TaskCopy>] =>
            input[1] != null && input[1].issueType === OPEN_PROJECT_TYPE,
        ),
        concatMap(([, currentTaskOrParent]) => {
          if (!currentTaskOrParent.issueProviderId) {
            throw new Error('No issueProviderId for task');
          }
          return this._getCfgOnce$(currentTaskOrParent.issueProviderId).pipe(
            map((openProjectCfg) => ({ openProjectCfg, currentTaskOrParent })),
          );
        }),
        filter(
          ({ openProjectCfg, currentTaskOrParent }) =>
            isOpenProjectEnabled(openProjectCfg) &&
            openProjectCfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ openProjectCfg, currentTaskOrParent }) =>
          this._handleTransitionForIssue(
            IssueLocalState.IN_PROGRESS,
            openProjectCfg,
            currentTaskOrParent,
          ),
        ),
      ),
    { dispatch: false },
  );

  checkForDoneTransition$: Observable<any> = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }): boolean => !!task.changes.isDone),
        // NOTE: as this is only a partial object we need to get the full one
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id.toString())),
        filter((task: Task) => task && task.issueType === OPEN_PROJECT_TYPE),
        concatMap((task: Task) => {
          if (!task.issueProviderId) {
            throw new Error('No issueProviderId for task');
          }
          return this._getCfgOnce$(task.issueProviderId).pipe(
            map((openProjectCfg) => ({ openProjectCfg, task })),
          );
        }),
        filter(
          ({ openProjectCfg, task }) =>
            isOpenProjectEnabled(openProjectCfg) &&
            openProjectCfg.isTransitionIssuesEnabled,
        ),
        concatMap(({ openProjectCfg, task }) => {
          return this._handleTransitionForIssue(
            IssueLocalState.DONE,
            openProjectCfg,
            task,
          );
        }),
      ),
    { dispatch: false },
  );

  private _openTrackTimeDialog(
    task: Task,
    workPackageId: number,
    openProjectCfg: OpenProjectCfg,
  ): void {
    this._openProjectApiService
      .getById$(workPackageId, openProjectCfg)
      .pipe(take(1))
      .subscribe((workPackage) => {
        this._matDialog.open(DialogOpenProjectTrackTimeComponent, {
          restoreFocus: true,
          data: {
            workPackage,
            task,
          },
        });
      });
  }

  private _getCfgOnce$(issueProviderId: string): Observable<OpenProjectCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'OPEN_PROJECT');
  }

  private _handleTransitionForIssue(
    localState: IssueLocalState,
    openProjectCfg: OpenProjectCfg,
    task: Task,
  ): Observable<any> {
    const chosenTransition: OpenProjectTransitionOption | undefined =
      openProjectCfg.transitionConfig?.[localState];

    if (!task.issueId) {
      throw new Error('No issueId for task');
    }

    switch (chosenTransition) {
      case 'DO_NOT':
        return EMPTY;
      case 'ALWAYS_ASK':
        return this._openProjectApiService
          .getById$(task.issueId as unknown as number, openProjectCfg)
          .pipe(
            concatMap((issue) => this._openTransitionDialog(issue, localState, task)),
          );
      default:
        if (!chosenTransition || !chosenTransition.id) {
          this._snackService.open({
            msg: T.F.JIRA.S.NO_VALID_TRANSITION,
            type: 'ERROR',
          });
          // NOTE: we would kill the whole effect chain if we do this
          // return throwError({[HANDLED_ERROR_PROP_STR]: 'Jira: No valid transition configured'});
          return timer(2000).pipe(
            concatMap(() =>
              this._openProjectApiService.getById$(
                task.issueId as unknown as number,
                openProjectCfg,
              ),
            ),
            concatMap((issue: OpenProjectWorkPackage) =>
              this._openTransitionDialog(issue, localState, task),
            ),
          );
        }

        return this._openProjectApiService
          .getById$(task.issueId as unknown as number, openProjectCfg)
          .pipe(
            concatMap((issue) => {
              if (
                !issue._embedded.status ||
                issue._embedded.status.name !== chosenTransition.name
              ) {
                return this._openProjectApiService
                  .transitionIssue$(
                    { ...issue, percentageDone: openProjectCfg.progressOnDone ?? 0 },
                    chosenTransition,
                    openProjectCfg,
                  )
                  .pipe(
                    concatMap(() => {
                      this._snackService.open({
                        type: 'SUCCESS',
                        msg: T.F.OPEN_PROJECT.S.TRANSITION_SUCCESS,
                        translateParams: {
                          issueKey: `${issue.subject}`,
                          chosenTransition: `${chosenTransition.name}`,
                        },
                      });
                      return this._issueService.refreshIssueTask(task, false, false);
                    }),
                  );
              } else {
                // no transition required
                return EMPTY;
              }
            }),
          );
    }
  }

  private _openTransitionDialog(
    issue: OpenProjectWorkPackage,
    localState: IssueLocalState,
    task: Task,
  ): Observable<any> {
    return this._matDialog
      .open(DialogOpenProjectTransitionComponent, {
        restoreFocus: true,
        data: {
          issue,
          localState,
          task,
        },
      })
      .afterClosed();
  }
}
