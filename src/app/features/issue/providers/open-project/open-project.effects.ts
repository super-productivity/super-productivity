import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { concatMap, filter, map, switchMap, take, tap } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { OPEN_PROJECT_TYPE } from '../../issue.const';
import { MatDialog } from '@angular/material/dialog';
import { Task, TaskCopy } from '../../../tasks/task.model';
import { isWontDoTask } from '../../../tasks/util/is-wont-do-task';
import { OpenProjectOriginalStatus } from './open-project-api-responses';
import { OpenProjectCfg } from './open-project.model';
import { EMPTY, from, Observable, of } from 'rxjs';
import { OpenProjectApiService } from './open-project-api.service';
import { TaskService } from '../../../tasks/task.service';
import { isOpenProjectEnabled } from './is-open-project-enabled.util';
import { IssueLocalState } from 'src/app/features/issue/issue.model';
import { SnackService } from 'src/app/core/snack/snack.service';
import { OpenProjectWorkPackage } from './open-project-issue.model';
import { IssueService } from 'src/app/features/issue/issue.service';
import { T } from 'src/app/t.const';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { parseOpenProjectDuration } from './open-project-view-components/parse-open-project-duration.util';
import { formatOpenProjectWorkPackageSubjectForSnack } from './format-open-project-work-package-subject.util';
import { msToIsoDuration } from '../../../../util/ms-to-iso-duration';
import { getDbDateStr } from 'src/app/util/get-db-date-str';
import { TrackTimeSubmitParams } from '../../shared/dialog-track-time/track-time-dialog.model';
import {
  createDoneIssueTransitionStream$,
  createStartIssueTransitionStream$,
  IssueTransitionAdapter,
} from '../../shared/issue-transition-helper';

@Injectable()
export class OpenProjectEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _store$ = inject(Store);
  private readonly _snackService = inject(SnackService);
  private readonly _openProjectApiService = inject(OpenProjectApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);
  private readonly _issueService = inject(IssueService);

  postTime$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(TaskSharedActions.updateTask),
        filter(({ task }) => task.changes.isDone === true),
        concatMap(({ task }) => this._taskService.getByIdOnce$(task.id as string)),
        filter((task) => !!task && !isWontDoTask(task)),
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

  checkForStartTransition$ = createEffect(
    () => createStartIssueTransitionStream$(this._getTransitionAdapter()),
    { dispatch: false },
  );

  checkForDoneTransition$ = createEffect(
    () => createDoneIssueTransitionStream$(this._getTransitionAdapter()),
    { dispatch: false },
  );

  private _getTransitionAdapter(): IssueTransitionAdapter<
    OpenProjectCfg,
    OpenProjectWorkPackage,
    OpenProjectOriginalStatus
  > {
    return {
      issueType: OPEN_PROJECT_TYPE,
      providerLabel: 'OpenProject',
      actions$: this._actions$,
      store$: this._store$,
      taskService: this._taskService,
      snackService: this._snackService,
      issueService: this._issueService,
      getCfgOnce$: (issueProviderId) => this._getCfgOnce$(issueProviderId),
      isTransitionEnabled: (openProjectCfg) =>
        isOpenProjectEnabled(openProjectCfg) && openProjectCfg.isTransitionIssuesEnabled,
      getChosenTransition: (openProjectCfg, localState) =>
        openProjectCfg.transitionConfig?.[localState],
      fetchIssue$: (issueId, openProjectCfg) =>
        this._openProjectApiService.getById$(
          issueId as unknown as number,
          openProjectCfg,
        ),
      isAlreadyInTargetStatus: (issue, transition) =>
        !!issue._embedded.status && issue._embedded.status.name === transition.name,
      transitionIssue$: (issue, transition, openProjectCfg) =>
        this._openProjectApiService.transitionIssue$(
          { ...issue, percentageDone: openProjectCfg.progressOnDone ?? 0 },
          transition,
          openProjectCfg,
        ),
      openTransitionDialog$: (issue, localState, task) =>
        this._openTransitionDialog(issue, localState, task),
      transitionSuccessMsg: T.F.OPEN_PROJECT.S.TRANSITION_SUCCESS,
      getIssueKey: (issue) => issue.subject,
    };
  }

  private _openTrackTimeDialog(
    task: Task,
    workPackageId: number,
    openProjectCfg: OpenProjectCfg,
  ): void {
    this._openProjectApiService
      .getById$(workPackageId, openProjectCfg)
      .pipe(take(1))
      .subscribe(async (workPackage) => {
        const { DialogTrackTimeComponent } =
          await import('../../shared/dialog-track-time/dialog-track-time.component');
        const timeLogged = parseOpenProjectDuration(workPackage.spentTime);
        this._matDialog.open(DialogTrackTimeComponent, {
          restoreFocus: true,
          data: {
            task,
            issueIcon: 'open_project',
            issueLabel: `${workPackage.id} ${workPackage.subject}`,
            issueUrl: workPackage.url,
            timeLogged,
            activities$: this._openProjectApiService.getActivitiesForTrackTime$(
              workPackage.id,
              openProjectCfg,
            ),
            defaultTime: openProjectCfg.timeTrackingDialogDefaultTime,
            configTimeKey: 'timeTrackingDialogDefaultTime',
            onSubmit: (params: TrackTimeSubmitParams) =>
              this._openProjectApiService.trackTime$({
                workPackage,
                spentOn: getDbDateStr(params.started),
                hours: msToIsoDuration(params.timeSpent),
                comment: params.comment,
                activityId: params.activityId ?? 1,
                cfg: openProjectCfg,
              }),
            successMsg: T.F.OPEN_PROJECT.S.POST_TIME_SUCCESS,
            successTranslateParams: {
              issueTitle: formatOpenProjectWorkPackageSubjectForSnack(workPackage),
            },
            t: {
              title: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.TITLE,
              submitFor: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.SUBMIT_TIME_FOR,
              currentlyLogged: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.CURRENTLY_LOGGED,
              submit: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.POST_TIME,
              timeSpent: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.TIME_SPENT,
              timeSpentTooltip: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT_TOOLTIP,
              started: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.STARTED,
              invalidDate: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.INVALID_DATE,
              comment: T.G.COMMENT,
              activity: T.F.OPEN_PROJECT.DIALOG_TRACK_TIME.ACTIVITY,
            },
          },
        });
      });
  }

  private _getCfgOnce$(issueProviderId: string): Observable<OpenProjectCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'OPEN_PROJECT');
  }

  private _openTransitionDialog(
    issue: OpenProjectWorkPackage,
    localState: IssueLocalState,
    task: TaskCopy,
  ): Observable<unknown> {
    return from(
      import('./open-project-view-components/dialog-openproject-transition/dialog-open-project-transition.component'),
    ).pipe(
      switchMap(({ DialogOpenProjectTransitionComponent }) =>
        this._matDialog
          .open(DialogOpenProjectTransitionComponent, {
            restoreFocus: true,
            data: { issue, localState, task },
          })
          .afterClosed(),
      ),
    );
  }
}
