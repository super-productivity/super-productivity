import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { take, tap } from 'rxjs/operators';
import { JiraApiService } from './jira-api.service';
import { IssueProviderService } from '../../issue-provider.service';
import { TaskService } from '../../../tasks/task.service';
import { Task } from '../../../tasks/task.model';
import { JIRA_TYPE } from '../../issue.const';
import { T } from '../../../../t.const';
import { TrackTimeSubmitParams } from '../../shared/dialog-track-time/track-time-dialog.model';
import { IssueProviderJira } from '../../issue.model';
import { JiraWorklogExportDefaultTime } from './jira.model';

@Injectable({ providedIn: 'root' })
export class JiraWorklogService {
  private readonly _jiraApiService = inject(JiraApiService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);

  openWorklogDialogForTask(task: Task): void {
    if (task.issueType !== JIRA_TYPE || !task.issueId || !task.issueProviderId) {
      return;
    }
    this._issueProviderService
      .getCfgOnce$(task.issueProviderId, 'JIRA')
      .pipe(take(1))
      .subscribe((jiraCfg) => this._openDialog(task, jiraCfg));
  }

  openWorklogDialogForExternalTask(
    task: Task,
    issueId: string,
    issueProviderId: string,
    issueLabel: string,
  ): void {
    this._issueProviderService
      .getCfgOnce$(issueProviderId, 'JIRA')
      .pipe(take(1))
      .subscribe((jiraCfg) =>
        this._openDialogForExternalTask(task, issueId, jiraCfg, issueLabel),
      );
  }

  private _openDialog(task: Task, jiraCfg: IssueProviderJira): void {
    this._jiraApiService
      .getReducedIssueById$(task.issueId as string, jiraCfg)
      .pipe(take(1))
      .subscribe(async (issue) => {
        const { DialogTrackTimeComponent } =
          await import('../../shared/dialog-track-time/dialog-track-time.component');
        const timeLoggedToJira = task.timeLoggedToJira ?? 0;
        this._matDialog.open(DialogTrackTimeComponent, {
          restoreFocus: true,
          data: {
            task,
            issueIcon: 'jira',
            issueLabel: `${issue.key} ${issue.summary}`,
            timeLogged: timeLoggedToJira,
            defaultTime:
              jiraCfg.worklogDialogDefaultTime ??
              JiraWorklogExportDefaultTime.AllTimeMinusLogged,
            configTimeKey: 'worklogDialogDefaultTime',
            onSubmit: (params: TrackTimeSubmitParams) =>
              this._jiraApiService
                .addWorklog$({
                  issueId: issue.id,
                  started: params.started,
                  timeSpent: params.timeSpent,
                  comment: params.comment,
                  cfg: jiraCfg,
                })
                .pipe(
                  tap(() =>
                    this._taskService.update(task.id, {
                      timeLoggedToJira: timeLoggedToJira + params.timeSpent,
                    }),
                  ),
                ),
            successMsg: T.F.JIRA.S.ADDED_WORKLOG_FOR,
            successTranslateParams: { issueKey: issue.key },
            t: {
              title: T.F.JIRA.DIALOG_WORKLOG.TITLE,
              submitFor: T.F.JIRA.DIALOG_WORKLOG.SUBMIT_WORKLOG_FOR,
              currentlyLogged: T.F.JIRA.DIALOG_WORKLOG.CURRENTLY_LOGGED,
              submit: T.F.JIRA.DIALOG_WORKLOG.SAVE_WORKLOG,
              timeSpent: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT,
              timeSpentTooltip: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT_TOOLTIP,
              started: T.F.JIRA.DIALOG_WORKLOG.STARTED,
              invalidDate: T.F.JIRA.DIALOG_WORKLOG.INVALID_DATE,
              comment: T.G.COMMENT,
            },
          },
        });
      });
  }

  private _openDialogForExternalTask(
    task: Task,
    issueId: string,
    jiraCfg: IssueProviderJira,
    issueLabel: string,
  ): void {
    this._jiraApiService
      .getReducedIssueById$(issueId, jiraCfg)
      .pipe(take(1))
      .subscribe(async (issue) => {
        const { DialogTrackTimeComponent } =
          await import('../../shared/dialog-track-time/dialog-track-time.component');
        this._matDialog.open(DialogTrackTimeComponent, {
          restoreFocus: true,
          data: {
            task,
            issueIcon: 'jira',
            issueLabel,
            timeLogged: 0,
            defaultTime:
              jiraCfg.worklogDialogDefaultTime ??
              JiraWorklogExportDefaultTime.AllTimeMinusLogged,
            configTimeKey: 'worklogDialogDefaultTime',
            onSubmit: (params: TrackTimeSubmitParams) =>
              this._jiraApiService.addWorklog$({
                issueId: issue.id,
                started: params.started,
                timeSpent: params.timeSpent,
                comment: params.comment,
                cfg: jiraCfg,
              }),
            successMsg: T.F.JIRA.S.ADDED_WORKLOG_FOR,
            successTranslateParams: { issueKey: issue.key },
            t: {
              title: T.F.JIRA.DIALOG_WORKLOG.TITLE,
              submitFor: T.F.JIRA.DIALOG_WORKLOG.SUBMIT_WORKLOG_FOR,
              currentlyLogged: T.F.JIRA.DIALOG_WORKLOG.CURRENTLY_LOGGED,
              submit: T.F.JIRA.DIALOG_WORKLOG.SAVE_WORKLOG,
              timeSpent: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT,
              timeSpentTooltip: T.F.JIRA.DIALOG_WORKLOG.TIME_SPENT_TOOLTIP,
              started: T.F.JIRA.DIALOG_WORKLOG.STARTED,
              invalidDate: T.F.JIRA.DIALOG_WORKLOG.INVALID_DATE,
              comment: T.G.COMMENT,
            },
          },
        });
      });
  }
}
