import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { T } from 'src/app/t.const';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { DateService } from '../../../../../core/date/date.service';
import { IssueTaskTimeTracked, Task, TimeSpentOnDay } from '../../../../tasks/task.model';
import { BehaviorSubject, Observable } from 'rxjs';
import { GitlabApiService } from '../gitlab-api/gitlab-api.service';
import { first, map, tap } from 'rxjs/operators';
import { throttle } from '../../../../../util/decorators';
import { SnackService } from '../../../../../core/snack/snack.service';
import { Store } from '@ngrx/store';
import { IssueProviderService } from '../../../issue-provider.service';
import { msToString, MsToStringPipe } from '../../../../../ui/duration/ms-to-string.pipe';
import { TaskSharedActions } from '../../../../../root-store/meta/task-shared.actions';
import { assertTruthy } from '../../../../../util/assert-truthy';
import { MatIcon } from '@angular/material/icon';
import { MatProgressSpinner } from '@angular/material/progress-spinner';
import {
  MatCell,
  MatCellDef,
  MatColumnDef,
  MatHeaderCell,
  MatHeaderCellDef,
  MatHeaderRow,
  MatHeaderRowDef,
  MatRow,
  MatRowDef,
  MatTable,
} from '@angular/material/table';
import { TranslatePipe } from '@ngx-translate/core';
import { AsyncPipe } from '@angular/common';
import { MsToClockStringPipe } from '../../../../../ui/duration/ms-to-clock-string.pipe';
import { MatTooltip } from '@angular/material/tooltip';
import { InlineInputComponent } from '../../../../../ui/inline-input/inline-input.component';
import { MatButton } from '@angular/material/button';
import { IssueLog } from '../../../../../core/log';

interface TmpTask {
  id: string;
  issueId: string;
  title: string;
  timeToSubmit: number;
  timeSpentOnDay: TimeSpentOnDay;
  issueTimeTracked: IssueTaskTimeTracked | null;
  timeTrackedAlreadyRemote: number;
  isPastTrackedData: boolean;
}

@Component({
  selector: 'dialog-gitlab-submit-worklog-for-day',
  templateUrl: './dialog-gitlab-submit-worklog-for-day.component.html',
  styleUrls: ['./dialog-gitlab-submit-worklog-for-day.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogContent,
    MatDialogTitle,
    MatIcon,
    MatProgressSpinner,
    MatTable,
    MatColumnDef,
    MatHeaderCell,
    MatCell,
    MatHeaderCellDef,
    MatCellDef,
    TranslatePipe,
    AsyncPipe,
    MsToClockStringPipe,
    MatTooltip,
    InlineInputComponent,
    MatHeaderRowDef,
    MatRowDef,
    MatHeaderRow,
    MatRow,
    MatDialogActions,
    MatButton,
    MsToStringPipe,
  ],
})
export class DialogGitlabSubmitWorklogForDayComponent {
  readonly data = inject<{
    issueProviderId: string;
    tasksForIssueProvider: Task[];
  }>(MAT_DIALOG_DATA);
  private readonly _matDialogRef =
    inject<MatDialogRef<DialogGitlabSubmitWorklogForDayComponent>>(MatDialogRef);
  private readonly _dateService = inject(DateService);
  private readonly _gitlabApiService = inject(GitlabApiService);
  private readonly _snackService = inject(SnackService);
  private readonly _issueProviderService = inject(IssueProviderService);
  private readonly _store = inject(Store);

  isLoading = false;
  day: string = this._dateService.todayStr();

  tmpTasks$: BehaviorSubject<TmpTask[]> = new BehaviorSubject<TmpTask[]>(
    this.data.tasksForIssueProvider.map((t) => ({
      id: t.id,
      issueId: assertTruthy(t.issueId),
      title: t.title,
      issueTimeTracked: t.issueTimeTracked || null,
      timeSpentOnDay: t.timeSpentOnDay,
      timeTrackedAlreadyRemote: 0,
      isPastTrackedData: !!Object.keys(t.timeSpentOnDay || {}).find(
        (dayStr) =>
          dayStr !== this.day &&
          (t.timeSpentOnDay?.[dayStr] ?? 0) >
            ((t.issueTimeTracked && t.issueTimeTracked[dayStr]) || 0),
      ),
      timeToSubmit: Object.keys(t.timeSpentOnDay || {}).reduce((acc, dayStr) => {
        if (t.issueTimeTracked && t.issueTimeTracked[dayStr]) {
          const diff = (t.timeSpentOnDay?.[dayStr] ?? 0) - t.issueTimeTracked[dayStr];
          return diff > 0 ? diff + acc : acc;
        } else {
          return acc + (t.timeSpentOnDay?.[dayStr] ?? 0);
        }
      }, 0),
    })),
  );
  tmpTasksToTrack$: Observable<TmpTask[]> = this.tmpTasks$.pipe(
    map((tasks) => tasks.filter((t) => t.timeToSubmit >= 60000)),
  );
  issueProviderCfg$ = this._issueProviderService.getCfgOnce$(
    this.data.issueProviderId,
    'GITLAB',
  );

  totalTimeToSubmit$: Observable<number> = this.tmpTasksToTrack$.pipe(
    map((tmpTasks) =>
      tmpTasks.reduce((acc, tmpTask) => acc + (tmpTask.timeToSubmit || 0), 0),
    ),
  );
  T: typeof T = T;

  constructor() {
    const _matDialogRef = this._matDialogRef;

    _matDialogRef.disableClose = true;
    void this._loadAlreadyTrackedData();
  }

  updateTimeSpentTodayForTask(task: TmpTask, newVal: number | string): void {
    this.updateTmpTask(task.id, {
      timeToSubmit: +newVal,
      isPastTrackedData: false,
    });
  }

  // quick way to prevent multiple submits
  @throttle(2000, { leading: true, trailing: false })
  async submit(): Promise<void> {
    this.isLoading = true;
    try {
      const tasksToTrack = await this.tmpTasksToTrack$.pipe(first()).toPromise();
      if (tasksToTrack.length === 0) {
        this._snackService.open({
          type: 'SUCCESS',
          // TODO translate
          msg: 'Gitlab: No time tracking data submitted for GitLab tasks',
        });
        this.close();
        return;
      }

      const gitlabCfg = await this._issueProviderService
        .getCfgOnce$(this.data.issueProviderId, 'GITLAB')
        .toPromise();
      if (!gitlabCfg) {
        throw new Error('No gitlab cfg');
      }

      await Promise.all(
        tasksToTrack.map((t) =>
          this._gitlabApiService
            .addTimeSpentToIssue$(
              t.issueId as string,
              msToString(t.timeToSubmit).replace(' ', ''),
              gitlabCfg,
            )
            .pipe(
              first(),
              tap(() =>
                this._store.dispatch(
                  TaskSharedActions.updateTask({
                    task: {
                      id: t.id,
                      changes: {
                        // null all diffs as clean afterward (regardless of amount of time submitted)
                        issueTimeTracked: { ...t.timeSpentOnDay },
                      },
                    },
                  }),
                ),
              ),
            )
            .toPromise(),
        ),
      );

      this._snackService.open({
        type: 'SUCCESS',
        ico: 'file_upload',
        // TODO translate
        msg: 'Gitlab: Successfully posted time tracking data for GitLab tasks',
      });
      this.close();
    } catch (e) {
      IssueLog.err(e);
      this._snackService.open({
        type: 'ERROR',
        // TODO translate
        translateParams: {
          errorMsg: 'Error while submitting data to GitLab',
        },
        msg: T.F.GITLAB.S.ERR_UNKNOWN,
      });
    }
    this.isLoading = false;
  }

  close(): void {
    this._matDialogRef.close();
  }

  updateTmpTask(taskId: string, changes: Partial<TmpTask>): void {
    const tasks = this.tmpTasks$.getValue();
    const taskToUpdateIndex = tasks.findIndex((t) => t.id === taskId);
    tasks[taskToUpdateIndex] = {
      ...tasks[taskToUpdateIndex],
      ...changes,
    };
    this.tmpTasks$.next([...tasks]);
  }

  private async _loadAlreadyTrackedData(): Promise<void> {
    const tmpTasks = this.tmpTasks$.getValue();
    const gitlabCfg = await this.issueProviderCfg$.pipe(first()).toPromise();
    const dataForAll = await Promise.all(
      tmpTasks.map((t) =>
        this._gitlabApiService
          .getTimeTrackingStats$(t.issueId, gitlabCfg)
          .pipe(first())
          .toPromise(),
      ),
    );
    this.tmpTasks$.next(
      tmpTasks.map((t, i) => ({
        ...t,
        timeTrackedAlreadyRemote:
          typeof dataForAll[i].total_time_spent === 'number'
            ? (dataForAll[i].total_time_spent as number) * 1000
            : 0 || 0,
      })),
    );
  }
}
