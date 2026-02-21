import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { RedmineApiService } from '../redmine-api.service';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { SnackService } from '../../../../../core/snack/snack.service';
import { Task } from '../../../../tasks/task.model';
import { T } from '../../../../../t.const';
import { RedmineIssue } from '../redmine-issue.model';
import { JiraWorklogExportDefaultTime } from '../../jira/jira.model';
import {
  JIRA_WORK_LOG_EXPORT_CHECKBOXES,
  JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
} from '../../jira/jira.const';
import { Observable, of, Subject } from 'rxjs';
import { expandFadeAnimation } from '../../../../../ui/animations/expand.ani';
import { DateService } from 'src/app/core/date/date.service';
import { IssueProviderService } from '../../../issue-provider.service';
import { RedmineCfg } from '../redmine.model';
import { concatMap, map, shareReplay, switchMap, takeUntil } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { IssueProviderActions } from '../../../store/issue-provider.actions';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { TaskService } from '../../../../tasks/task.service';
import { MatIcon } from '@angular/material/icon';
import {
  MatError,
  MatFormField,
  MatLabel,
  MatSuffix,
} from '@angular/material/form-field';
import {
  MatMenu,
  MatMenuContent,
  MatMenuItem,
  MatMenuTrigger,
} from '@angular/material/menu';
import { MatTooltip } from '@angular/material/tooltip';
import { TranslatePipe } from '@ngx-translate/core';
import { InputDurationDirective } from '../../../../../ui/duration/input-duration.directive';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MsToStringPipe } from '../../../../../ui/duration/ms-to-string.pipe';
import { MatCheckbox } from '@angular/material/checkbox';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { formatLocalIsoWithoutSeconds } from '../../../../../util/format-local-iso-without-seconds';
import { IssueLog } from '../../../../../core/log';
import { getDbDateStr } from 'src/app/util/get-db-date-str';

const MS_PER_HOUR = 3600000;

@Component({
  selector: 'dialog-redmine-track-time',
  templateUrl: './dialog-redmine-track-time.component.html',
  styleUrls: ['./dialog-redmine-track-time.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation],
  imports: [
    FormsModule,
    AsyncPipe,
    MatIcon,
    MatDialogContent,
    MatFormField,
    MatSuffix,
    MatMenuTrigger,
    MatTooltip,
    TranslatePipe,
    InputDurationDirective,
    MatInput,
    MatIconButton,
    MatMenu,
    MatMenuContent,
    MatMenuItem,
    MsToStringPipe,
    MatCheckbox,
    CdkTextareaAutosize,
    MatSelect,
    MatOption,
    MatDialogActions,
    MatDialogTitle,
    MatLabel,
    MatError,
    MatButton,
  ],
})
export class DialogRedmineTrackTimeComponent implements OnDestroy {
  private _redmineApiService = inject(RedmineApiService);
  private _matDialogRef =
    inject<MatDialogRef<DialogRedmineTrackTimeComponent>>(MatDialogRef);
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _issueProviderService = inject(IssueProviderService);
  private _taskService = inject(TaskService);
  data = inject<{
    redmineIssue: RedmineIssue;
    task: Task;
  }>(MAT_DIALOG_DATA);
  private _dateService = inject(DateService);

  T: typeof T = T;
  timeSpent: number;
  started: string;
  comment: string;
  redmineIssue: RedmineIssue;
  selectedDefaultTimeMode?: JiraWorklogExportDefaultTime;
  defaultTimeOptions = JIRA_WORK_LOG_EXPORT_FORM_OPTIONS;
  defaultTimeCheckboxContent?: {
    label: string;
    value: JiraWorklogExportDefaultTime;
    isChecked: boolean;
  };
  timeSpentToday: number;

  activityId: number = 1;

  private _onDestroy$ = new Subject();

  private _issueProviderIdOnce$: Observable<string> = this.data.task.issueProviderId
    ? of(this.data.task.issueProviderId)
    : this._taskService.getByIdOnce$(this.data.task.parentId as string).pipe(
        map((parentTask) => {
          if (!parentTask.issueProviderId) {
            throw new Error('No issue provider id found');
          }
          return parentTask.issueProviderId;
        }),
      );

  private _cfgOnce$: Observable<RedmineCfg> = this._issueProviderIdOnce$.pipe(
    switchMap((issueProviderId) =>
      this._issueProviderService.getCfgOnce$(issueProviderId, 'REDMINE'),
    ),
    takeUntil(this._onDestroy$),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  activities$ = this._cfgOnce$.pipe(
    concatMap((cfg) => {
      return this._redmineApiService.getActivitiesForTrackTime$(cfg);
    }),
  );

  constructor() {
    this._issueProviderIdOnce$.subscribe((v) => IssueLog.log(`_issueProviderIdOnce$`, v));

    this.timeSpent = this.data.task.timeSpent;
    this.redmineIssue = this.data.redmineIssue;
    this.started = this._convertTimestamp(this.data.task.created);
    this.comment = this.data.task.parentId ? this.data.task.title : '';

    this.timeSpentToday = this.data.task.timeSpentOnDay[this._dateService.todayStr()];

    this._cfgOnce$.subscribe((cfg) => {
      if (cfg.timeTrackingDialogDefaultTime) {
        this.timeSpent = this.getTimeToLogForMode(cfg.timeTrackingDialogDefaultTime);
        this.started = this._fillInStarted(cfg.timeTrackingDialogDefaultTime);
      }
    });
  }

  ngOnDestroy(): void {
    this._onDestroy$.next(undefined);
  }

  close(): void {
    this._matDialogRef.close();
  }

  async postTime(): Promise<void> {
    IssueLog.log({
      issue: this.redmineIssue,
      started: this.started,
      timeSpent: this.timeSpent,
      comment: this.comment,
      activityId: this.activityId,
      ipid: this.data.task.issueProviderId,
    });

    const ipId = await this._issueProviderIdOnce$.toPromise();

    if (this.redmineIssue.id && this.started && this.timeSpent && ipId) {
      const cfg = await this._cfgOnce$.toPromise();
      if (this.defaultTimeCheckboxContent?.isChecked === true) {
        this._store.dispatch(
          IssueProviderActions.updateIssueProvider({
            issueProvider: {
              id: ipId,
              changes: {
                timeTrackingDialogDefaultTime: this.defaultTimeCheckboxContent.value,
              },
            },
          }),
        );
      }
      this._redmineApiService
        .trackTime$({
          cfg: cfg!,
          issueId: this.redmineIssue.id,
          spentOn: getDbDateStr(this.started),
          hours: this.timeSpent / MS_PER_HOUR,
          comment: this.comment,
          activityId: this.activityId,
        })
        .pipe(takeUntil(this._onDestroy$))
        .subscribe(() => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.REDMINE.S.POST_TIME_SUCCESS,
            translateParams: {
              issueTitle: `#${this.redmineIssue.id} ${this.redmineIssue.subject}`,
            },
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
        return this.data.task.timeSpent;
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
