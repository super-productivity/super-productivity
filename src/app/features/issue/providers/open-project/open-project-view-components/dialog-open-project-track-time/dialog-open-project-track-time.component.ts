import { ChangeDetectionStrategy, Component, inject, OnDestroy } from '@angular/core';
import { OpenProjectApiService } from '../../open-project-api.service';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { SnackService } from '../../../../../../core/snack/snack.service';
import { Task } from '../../../../../tasks/task.model';
import { T } from '../../../../../../t.const';
import { OpenProjectWorkPackage } from '../../open-project-issue.model';
import { parseOpenProjectDuration } from '../parse-open-project-duration.util';
import { JiraWorklogExportDefaultTime } from '../../../jira/jira.model';
import {
  JIRA_WORK_LOG_EXPORT_CHECKBOXES,
  JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
} from '../../../jira/jira.const';
import { Observable, of, Subject } from 'rxjs';
import { expandFadeAnimation } from '../../../../../../ui/animations/expand.ani';
import { DateService } from 'src/app/core/date/date.service';
import { IssueProviderService } from '../../../../issue-provider.service';
import { OpenProjectCfg } from '../../open-project.model';
import { formatOpenProjectWorkPackageSubjectForSnack } from '../../format-open-project-work-package-subject.util';
import { concatMap, map, shareReplay, switchMap, takeUntil } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { IssueProviderActions } from '../../../../store/issue-provider.actions';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { TaskService } from '../../../../../tasks/task.service';
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
import { InputDurationDirective } from '../../../../../../ui/duration/input-duration.directive';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MsToStringPipe } from '../../../../../../ui/duration/ms-to-string.pipe';
import { MatCheckbox } from '@angular/material/checkbox';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { formatLocalIsoWithoutSeconds } from '../../../../../../util/format-local-iso-without-seconds';
import { msToIsoDuration } from '../../../../../../util/ms-to-iso-duration';
import { IssueLog } from '../../../../../../core/log';
import { getDbDateStr } from 'src/app/util/get-db-date-str';

@Component({
  selector: 'dialog-open-project-track-time',
  templateUrl: './dialog-open-project-track-time.component.html',
  styleUrls: ['./dialog-open-project-track-time.component.scss'],
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
export class DialogOpenProjectTrackTimeComponent implements OnDestroy {
  private _openProjectApiService = inject(OpenProjectApiService);
  private _matDialogRef =
    inject<MatDialogRef<DialogOpenProjectTrackTimeComponent>>(MatDialogRef);
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _issueProviderService = inject(IssueProviderService);
  private _taskService = inject(TaskService);
  data = inject<{
    workPackage: OpenProjectWorkPackage;
    task: Task;
  }>(MAT_DIALOG_DATA);
  private _dateService = inject(DateService);

  T: typeof T = T;
  timeSpent: number;
  started: string;
  comment: string;
  workPackage: OpenProjectWorkPackage;
  timeLoggedForWorkPackage: number = 0;
  selectedDefaultTimeMode?: JiraWorklogExportDefaultTime;
  defaultTimeOptions = JIRA_WORK_LOG_EXPORT_FORM_OPTIONS;
  defaultTimeCheckboxContent?: {
    label: string;
    value: JiraWorklogExportDefaultTime;
    isChecked: boolean;
  };
  timeSpentToday: number;
  timeSpentLoggedDelta: number;

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

  private _cfgOnce$: Observable<OpenProjectCfg> = this._issueProviderIdOnce$.pipe(
    switchMap((issueProviderId) =>
      this._issueProviderService.getCfgOnce$(issueProviderId, 'OPEN_PROJECT'),
    ),
    takeUntil(this._onDestroy$),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  activities$ = this._cfgOnce$.pipe(
    concatMap((cfg) => {
      return this._openProjectApiService.getActivitiesForTrackTime$(
        this.workPackage.id,
        cfg,
      );
    }),
  );

  constructor() {
    this._issueProviderIdOnce$.subscribe((v) => IssueLog.log(`_issueProviderIdOnce$`, v));

    this.timeSpent = this.data.task.timeSpent;
    this.workPackage = this.data.workPackage;
    this.started = this._convertTimestamp(this.data.task.created);
    this.comment = this.data.task.parentId ? this.data.task.title : '';

    this.timeLoggedForWorkPackage = parseOpenProjectDuration(this.workPackage.spentTime);
    this.timeSpentToday = this.data.task.timeSpentOnDay[this._dateService.todayStr()];
    this.timeSpentLoggedDelta = Math.max(
      0,
      this.data.task.timeSpent - this.timeLoggedForWorkPackage,
    );

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
      wp: this.workPackage,
      started: this.started,
      timeSpent: this.timeSpent,
      comment: this.comment,
      activityId: this.activityId,
      ipid: this.data.task.issueProviderId,
    });

    const ipId = await this._issueProviderIdOnce$.toPromise();

    if (this.workPackage.id && this.started && this.timeSpent && ipId) {
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
      this._openProjectApiService
        .trackTime$({
          workPackage: this.workPackage,
          spentOn: getDbDateStr(this.started),
          hours: msToIsoDuration(this.timeSpent),
          comment: this.comment,
          activityId: this.activityId,
          cfg,
        })
        .pipe(takeUntil(this._onDestroy$))
        .subscribe((res) => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: T.F.OPEN_PROJECT.S.POST_TIME_SUCCESS,
            translateParams: {
              issueTitle: formatOpenProjectWorkPackageSubjectForSnack(this.workPackage),
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
