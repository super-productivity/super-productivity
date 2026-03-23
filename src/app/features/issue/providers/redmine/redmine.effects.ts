import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { catchError, concatMap, filter, map, take, tap } from 'rxjs/operators';
import { REDMINE_TYPE } from '../../issue.const';
import { MatDialog } from '@angular/material/dialog';
import { Task } from '../../../tasks/task.model';
import { RedmineCfg } from './redmine.model';
import { EMPTY, Observable, of } from 'rxjs';
import { RedmineApiService } from './redmine-api.service';
import { TaskService } from '../../../tasks/task.service';
import { IssueProviderService } from '../../issue-provider.service';
import { assertTruthy } from '../../../../util/assert-truthy';
import { LOCAL_ACTIONS } from '../../../../util/local-actions.token';
import { T } from '../../../../t.const';
import { getDbDateStr } from 'src/app/util/get-db-date-str';
import { TrackTimeSubmitParams } from '../../shared/dialog-track-time/track-time-dialog.model';

@Injectable()
export class RedmineEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _redmineApiService = inject(RedmineApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);

  postTime$ = createEffect(
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
          mainTask.issueType === REDMINE_TYPE &&
          mainTask.issueId &&
          mainTask.issueProviderId
            ? this._getCfgOnce$(mainTask.issueProviderId).pipe(
                tap((redmineCfg) => {
                  if (
                    subTask &&
                    redmineCfg.isShowTimeTrackingDialogForEachSubTask &&
                    redmineCfg.isShowTimeTrackingDialog
                  ) {
                    this._openTrackTimeDialog(
                      subTask,
                      +assertTruthy(mainTask.issueId),
                      redmineCfg,
                    );
                  } else if (
                    redmineCfg.isShowTimeTrackingDialog &&
                    !subTask &&
                    (!redmineCfg.isShowTimeTrackingDialogForEachSubTask ||
                      !mainTask.subTaskIds.length)
                  ) {
                    this._openTrackTimeDialog(
                      mainTask,
                      +assertTruthy(mainTask.issueId),
                      redmineCfg,
                    );
                  }
                }),
              )
            : EMPTY,
        ),
      ),
    { dispatch: false },
  );

  private _openTrackTimeDialog(
    task: Task,
    issueId: number,
    redmineCfg: RedmineCfg,
  ): void {
    const MS_PER_HOUR = 3600000;
    this._redmineApiService
      .getById$(issueId, redmineCfg)
      .pipe(take(1))
      .subscribe(async (redmineIssue) => {
        const { DialogTrackTimeComponent } =
          await import('../../shared/dialog-track-time/dialog-track-time.component');
        this._matDialog.open(DialogTrackTimeComponent, {
          restoreFocus: true,
          data: {
            task,
            issueIcon: 'redmine',
            issueLabel: `#${redmineIssue.id} ${redmineIssue.subject}`,
            issueUrl: redmineIssue.url,
            timeLogged: 0,
            timeLoggedUpdate$: this._redmineApiService
              .getTimeEntriesForCurrentUser$(redmineIssue.id, redmineCfg)
              .pipe(
                map((hours) => hours * MS_PER_HOUR),
                catchError(() => of(0)),
              ),
            activities$: this._redmineApiService.getActivitiesForTrackTime$(redmineCfg),
            defaultTime: redmineCfg.timeTrackingDialogDefaultTime,
            configTimeKey: 'timeTrackingDialogDefaultTime',
            onSubmit: (params: TrackTimeSubmitParams) =>
              this._redmineApiService.trackTime$({
                cfg: redmineCfg,
                issueId: redmineIssue.id,
                spentOn: getDbDateStr(params.started),
                hours: params.timeSpent / MS_PER_HOUR,
                comment: params.comment,
                activityId: params.activityId ?? 1,
              }),
            successMsg: T.F.REDMINE.S.POST_TIME_SUCCESS,
            successTranslateParams: {
              issueTitle: `#${redmineIssue.id} ${redmineIssue.subject}`,
            },
            t: {
              title: T.F.REDMINE.DIALOG_TRACK_TIME.TITLE,
              submitFor: T.F.REDMINE.DIALOG_TRACK_TIME.SUBMIT_TIME_FOR,
              submit: T.F.REDMINE.DIALOG_TRACK_TIME.POST_TIME,
              timeSpent: T.F.REDMINE.DIALOG_TRACK_TIME.TIME_SPENT,
              timeSpentTooltip: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT_TOOLTIP,
              started: T.F.REDMINE.DIALOG_TRACK_TIME.STARTED,
              invalidDate: T.F.REDMINE.DIALOG_TRACK_TIME.INVALID_DATE,
              comment: T.G.COMMENT,
              activity: T.F.REDMINE.DIALOG_TRACK_TIME.ACTIVITY,
            },
          },
        });
      });
  }

  private _getCfgOnce$(issueProviderId: string): Observable<RedmineCfg> {
    return this._issueProviderService.getCfgOnce$(issueProviderId, 'REDMINE');
  }
}
