import { ChangeDetectionStrategy, Component, OnDestroy, inject } from '@angular/core';
import { JiraApiService } from '../../jira-api.service';
import {
  MAT_DIALOG_DATA,
  MatDialogRef,
  MatDialogTitle,
  MatDialogContent,
  MatDialogActions,
} from '@angular/material/dialog';
import { SnackService } from '../../../../../../core/snack/snack.service';
import { JiraIssue } from '../../jira-issue.model';
import { Task } from '../../../../../tasks/task.model';
import { T } from '../../../../../../t.const';
import { expandFadeAnimation } from '../../../../../../ui/animations/expand.ani';
import {
  JIRA_WORK_LOG_EXPORT_CHECKBOXES,
  JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
} from '../../jira.const';
import { JiraWorklogExportDefaultTime } from '../../jira.model';
import { Observable, of, Subscription } from 'rxjs';
import { DateService } from 'src/app/core/date/date.service';
import { IssueProviderService } from '../../../../issue-provider.service';
import { Store } from '@ngrx/store';
import { IssueProviderActions } from '../../../../store/issue-provider.actions';
import { TaskService } from '../../../../../tasks/task.service';
import { first, map, switchMap } from 'rxjs/operators';
import { FormsModule } from '@angular/forms';
import { MatIcon } from '@angular/material/icon';
import { CdkScrollable } from '@angular/cdk/scrolling';
import {
  MatLabel,
  MatFormField,
  MatSuffix,
  MatError,
} from '@angular/material/form-field';
import { InputDurationDirective } from '../../../../../../ui/duration/input-duration.directive';
import { MatInput } from '@angular/material/input';
import {
  MatMenuTrigger,
  MatMenu,
  MatMenuContent,
  MatMenuItem,
} from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { MatIconButton, MatButton } from '@angular/material/button';
import { MatCheckbox } from '@angular/material/checkbox';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { MsToStringPipe } from '../../../../../../ui/duration/ms-to-string.pipe';
import { TranslatePipe } from '@ngx-translate/core';
import { formatLocalIsoWithoutSeconds } from '../../../../../../util/format-local-iso-without-seconds';

@Component({
  selector: 'dialog-jira-add-worklog',
  templateUrl: './dialog-jira-add-worklog.component.html',
  styleUrls: ['./dialog-jira-add-worklog.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation],
  imports: [
    FormsModule,
    MatDialogTitle,
    MatIcon,
    CdkScrollable,
    MatDialogContent,
    MatLabel,
    MatFormField,
    InputDurationDirective,
    MatInput,
    MatSuffix,
    MatMenuTrigger,
    MatTooltip,
    MatIconButton,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MatCheckbox,
    MatError,
    CdkTextareaAutosize,
    MatDialogActions,
    MatButton,
    MsToStringPipe,
    TranslatePipe,
  ],
})
export class DialogJiraAddWorklogComponent implements OnDestroy {
  private _jiraApiService = inject(JiraApiService);
  private _matDialogRef =
    inject<MatDialogRef<DialogJiraAddWorklogComponent>>(MatDialogRef);
  private _snackService = inject(SnackService);
  private _taskService = inject(TaskService);
  private _issueProviderService = inject(IssueProviderService);
  private _store = inject(Store);
  data = inject<{
    issue: JiraIssue;
    task: Task;
  }>(MAT_DIALOG_DATA);
  private _dateService = inject(DateService);

  T: typeof T = T;
  timeSpent: number;
  timeLogged: number;
  started: string;
  comment: string;
  issue: JiraIssue;
  selectedDefaultTimeMode?: JiraWorklogExportDefaultTime;
  defaultTimeOptions = JIRA_WORK_LOG_EXPORT_FORM_OPTIONS;
  defaultTimeCheckboxContent?: {
    label: string;
    value: JiraWorklogExportDefaultTime;
    isChecked: boolean;
  };
  timeSpentToday: number;
  timeSpentLoggedDelta: number;

  issueProviderId$: Observable<string> = this.data.task.issueProviderId
    ? of(this.data.task.issueProviderId)
    : this._taskService.getByIdOnce$(this.data.task.parentId as string).pipe(
        map((parentTask) => {
          if (!parentTask.issueProviderId) {
            throw new Error('No issue provider id found');
          }
          return parentTask.issueProviderId;
        }),
      );

  private _subs = new Subscription();

  constructor() {
    this.timeSpent = this.data.task.timeSpent;
    this.issue = this.data.issue;
    this.timeLogged = this.issue.timespent * 1000;
    this.started = this._convertTimestamp(this.data.task.created);
    this.comment = this.data.task.parentId ? this.data.task.title : '';
    this.timeSpentToday = this.data.task.timeSpentOnDay[this._dateService.todayStr()];
    this.timeSpentLoggedDelta = Math.max(0, this.data.task.timeSpent - this.timeLogged);

    this._subs.add(
      this.issueProviderId$
        .pipe(
          first(),
          switchMap((issueProviderId) =>
            this._issueProviderService.getCfgOnce$(issueProviderId, 'JIRA'),
          ),
        )
        .subscribe((cfg) => {
          if (cfg.worklogDialogDefaultTime) {
            this.timeSpent = this.getTimeToLogForMode(cfg.worklogDialogDefaultTime);
            this.started = this._fillInStarted(cfg.worklogDialogDefaultTime);
          }
        }),
    );
  }

  ngOnDestroy(): void {
    this._subs.unsubscribe();
  }

  close(): void {
    this._matDialogRef.close();
  }

  async submitWorklog(): Promise<void> {
    const issueProviderId = await this.issueProviderId$.pipe(first()).toPromise();
    if (this.issue.id && this.started && this.timeSpent && issueProviderId) {
      const cfg = await this._issueProviderService
        .getCfgOnce$(issueProviderId, 'JIRA')
        .toPromise();

      if (this.defaultTimeCheckboxContent?.isChecked === true) {
        this._store.dispatch(
          IssueProviderActions.updateIssueProvider({
            issueProvider: {
              id: issueProviderId,
              changes: {
                worklogDialogDefaultTime: this.defaultTimeCheckboxContent.value,
              },
            },
          }),
        );
      }

      this._jiraApiService
        .addWorklog$({
          issueId: this.issue.id,
          started: this.started,
          timeSpent: this.timeSpent,
          comment: this.comment,
          cfg,
        })
        .subscribe((res) => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.JIRA.S.ADDED_WORKLOG_FOR,
            translateParams: { issueKey: this.issue.key },
          });
          this.close();
        });
    }
  }

  fill(mode: JiraWorklogExportDefaultTime): void {
    this.selectedDefaultTimeMode = mode;
    this.timeSpent = this.getTimeToLogForMode(mode);
    const matchingCheckboxCfg = JIRA_WORK_LOG_EXPORT_CHECKBOXES.find(
      (checkCfg) => checkCfg.value === mode,
    );
    this.defaultTimeCheckboxContent = matchingCheckboxCfg
      ? { ...matchingCheckboxCfg, isChecked: false }
      : undefined;
    this.started = this._fillInStarted(mode);
  }

  getTimeToLogForMode(mode: JiraWorklogExportDefaultTime): number {
    switch (mode) {
      case JiraWorklogExportDefaultTime.AllTime:
        return this.data.task.timeSpent;
      case JiraWorklogExportDefaultTime.TimeToday:
        return this.timeSpentToday;
      case JiraWorklogExportDefaultTime.AllTimeMinusLogged:
        return this.timeSpentLoggedDelta;
    }
    return 0;
  }

  private _convertTimestamp(timestamp: number): string {
    return formatLocalIsoWithoutSeconds(timestamp);
  }

  private _fillInStarted(mode: JiraWorklogExportDefaultTime): string {
    if (mode === JiraWorklogExportDefaultTime.TimeToday) {
      return this._convertTimestamp(Date.now());
    } else if (mode === JiraWorklogExportDefaultTime.TimeYesterday) {
      const oneDay = 24 * 60 * 60 * 1000;
      return this._convertTimestamp(Date.now() - oneDay);
    } else {
      return this._convertTimestamp(this.data.task.created);
    }
  }
}
