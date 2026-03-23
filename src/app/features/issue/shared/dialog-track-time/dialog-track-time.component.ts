import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  inject,
  OnDestroy,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { SnackService } from '../../../../core/snack/snack.service';
import { T } from '../../../../t.const';
import { JiraWorklogExportDefaultTime } from '../../providers/jira/jira.model';
import {
  JIRA_WORK_LOG_EXPORT_CHECKBOXES,
  JIRA_WORK_LOG_EXPORT_FORM_OPTIONS,
} from '../../providers/jira/jira-cfg-form.const';
import { firstValueFrom, Observable, of, Subject } from 'rxjs';
import { expandFadeAnimation } from '../../../../ui/animations/expand.ani';
import { DateService } from 'src/app/core/date/date.service';
import { map, takeUntil } from 'rxjs/operators';
import { Store } from '@ngrx/store';
import { IssueProviderActions } from '../../store/issue-provider.actions';
import { FormsModule } from '@angular/forms';
import { AsyncPipe } from '@angular/common';
import { TaskService } from '../../../tasks/task.service';
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
import { InputDurationDirective } from '../../../../ui/duration/input-duration.directive';
import { MatInput } from '@angular/material/input';
import { MatButton, MatIconButton } from '@angular/material/button';
import { MsToStringPipe } from '../../../../ui/duration/ms-to-string.pipe';
import { MatCheckbox } from '@angular/material/checkbox';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { MatOption, MatSelect } from '@angular/material/select';
import { formatLocalIsoWithoutSeconds } from '../../../../util/format-local-iso-without-seconds';
import { TrackTimeDialogData } from './track-time-dialog.model';

@Component({
  selector: 'dialog-track-time',
  templateUrl: './dialog-track-time.component.html',
  styleUrls: ['./dialog-track-time.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  animations: [expandFadeAnimation],
  imports: [
    FormsModule,
    AsyncPipe,
    MatDialogTitle,
    MatIcon,
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
    MatSelect,
    MatOption,
    MatDialogActions,
    MatButton,
    MsToStringPipe,
    TranslatePipe,
  ],
})
export class DialogTrackTimeComponent implements OnDestroy {
  private _matDialogRef = inject<MatDialogRef<DialogTrackTimeComponent>>(MatDialogRef);
  private _snackService = inject(SnackService);
  private _store = inject(Store);
  private _taskService = inject(TaskService);
  private _cdr = inject(ChangeDetectorRef);
  private _dateService = inject(DateService);
  data = inject<TrackTimeDialogData>(MAT_DIALOG_DATA);

  T: typeof T = T;
  timeSpent: number;
  started: string;
  comment: string;
  timeLogged: number;
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

  private _onDestroy$ = new Subject<void>();

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

  constructor() {
    this.timeSpent = this.data.task.timeSpent;
    this.timeLogged = this.data.timeLogged;
    this.started = formatLocalIsoWithoutSeconds(this.data.task.created);
    this.comment = this.data.task.parentId ? this.data.task.title : '';
    this.timeSpentToday = this.data.task.timeSpentOnDay[this._dateService.todayStr()];
    this.timeSpentLoggedDelta = Math.max(0, this.data.task.timeSpent - this.timeLogged);

    if (this.data.timeLoggedUpdate$) {
      this.data.timeLoggedUpdate$.pipe(takeUntil(this._onDestroy$)).subscribe((val) => {
        this.timeLogged = val;
        this.timeSpentLoggedDelta = Math.max(0, this.data.task.timeSpent - val);
        if (
          this.selectedDefaultTimeMode === JiraWorklogExportDefaultTime.AllTimeMinusLogged
        ) {
          this.timeSpent = this.timeSpentLoggedDelta;
        }
        this._cdr.markForCheck();
      });
    }

    if (this.data.defaultTime) {
      this.selectedDefaultTimeMode = this.data.defaultTime;
      this.timeSpent = this.getTimeToLogForMode(this.data.defaultTime);
      this.started = this._fillInStarted(this.data.defaultTime);
    }
  }

  ngOnDestroy(): void {
    this._onDestroy$.next();
    this._onDestroy$.complete();
  }

  close(): void {
    this._matDialogRef.close();
  }

  async submit(): Promise<void> {
    const ipId = await firstValueFrom(this._issueProviderIdOnce$);
    if (!ipId || !this.started || !this.timeSpent) {
      return;
    }

    if (this.defaultTimeCheckboxContent?.isChecked === true) {
      this._store.dispatch(
        IssueProviderActions.updateIssueProvider({
          issueProvider: {
            id: ipId,
            changes: {
              [this.data.configTimeKey]: this.defaultTimeCheckboxContent.value,
            },
          },
        }),
      );
    }

    this.data
      .onSubmit({
        timeSpent: this.timeSpent,
        started: this.started,
        comment: this.comment,
        activityId: this.activityId,
      })
      .pipe(takeUntil(this._onDestroy$))
      .subscribe({
        next: () => {
          this._snackService.open({
            type: 'SUCCESS',
            msg: this.data.successMsg,
            translateParams: this.data.successTranslateParams,
          });
          this.close();
        },
        // Error snack is already shown by the provider API service.
        // Dialog stays open so the user can retry.
        error: () => {},
      });
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

  private _fillInStarted(mode: JiraWorklogExportDefaultTime): string {
    if (mode === JiraWorklogExportDefaultTime.TimeToday) {
      return formatLocalIsoWithoutSeconds(Date.now());
    } else if (mode === JiraWorklogExportDefaultTime.TimeYesterday) {
      const oneDay = 24 * 60 * 60 * 1000;
      return formatLocalIsoWithoutSeconds(Date.now() - oneDay);
    } else {
      return formatLocalIsoWithoutSeconds(this.data.task.created);
    }
  }
}
