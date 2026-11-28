import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialogActions,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';
import { Store } from '@ngrx/store';
import { TranslatePipe } from '@ngx-translate/core';
import { T } from '../../../../t.const';
import { TimeSpentOnDay } from '../../../tasks/task.model';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { SnackService } from '../../../../core/snack/snack.service';
import { InlineInputComponent } from '../../../../ui/inline-input/inline-input.component';
import { MsToClockStringPipe } from '../../../../ui/duration/ms-to-clock-string.pipe';
import { MsToStringPipe } from '../../../../ui/duration/ms-to-string.pipe';
import { SubmitWorklogForDayDialogData } from './submit-worklog-for-day-dialog.model';
import { getUnloggedTimeMs, hasUnloggedTimeOnOtherDays } from './unlogged-time.util';
import { IssueLog } from '../../../../core/log';

// entries below a minute are dropped; most providers log in whole minutes
const MIN_TIME_TO_SUBMIT_MS = 60000;

interface WorklogRow {
  taskId: string;
  issueId: string;
  title: string;
  timeSpentOnDay: TimeSpentOnDay;
  timeToSubmit: number;
  hasOtherDays: boolean;
  timeLoggedRemote?: number;
}

/** Submits the unlogged time of a provider's tasks when a day is finished. */
@Component({
  selector: 'dialog-submit-worklog-for-day',
  templateUrl: './dialog-submit-worklog-for-day.component.html',
  styleUrls: ['./dialog-submit-worklog-for-day.component.scss'],
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatButton,
    MatIcon,
    MatTooltip,
    TranslatePipe,
    InlineInputComponent,
    MsToClockStringPipe,
    MsToStringPipe,
  ],
})
export class DialogSubmitWorklogForDayComponent {
  readonly data = inject<SubmitWorklogForDayDialogData>(MAT_DIALOG_DATA);
  private readonly _matDialogRef = inject(
    MatDialogRef<DialogSubmitWorklogForDayComponent>,
  );
  private readonly _store = inject(Store);
  private readonly _snackService = inject(SnackService);

  readonly T = T;
  readonly isSubmitting = signal(false);
  readonly rows = signal<WorklogRow[]>(
    this.data.tasks
      .filter((t): t is typeof t & { issueId: string } => !!t.issueId)
      .map((t) => ({
        taskId: t.id,
        issueId: t.issueId,
        title: t.title,
        timeSpentOnDay: t.timeSpentOnDay,
        timeToSubmit: getUnloggedTimeMs(t.timeSpentOnDay, t.issueTimeTracked),
        hasOtherDays: hasUnloggedTimeOnOtherDays(
          t.timeSpentOnDay,
          t.issueTimeTracked,
          this.data.day,
        ),
      })),
  );
  readonly rowsToSubmit = computed(() =>
    this.rows().filter((r) => r.timeToSubmit >= MIN_TIME_TO_SUBMIT_MS),
  );
  readonly totalTimeToSubmit = computed(() =>
    this.rowsToSubmit().reduce((acc, r) => acc + r.timeToSubmit, 0),
  );

  constructor() {
    void this._loadTimeLoggedRemote();
  }

  updateTimeToSubmit(taskId: string, value: string | number): void {
    this._patchRow(taskId, { timeToSubmit: +value, hasOtherDays: false });
  }

  async submit(): Promise<void> {
    if (this.isSubmitting()) {
      return;
    }
    const rows = this.rowsToSubmit();
    if (!rows.length) {
      this.close();
      return;
    }
    this.isSubmitting.set(true);
    const results = await Promise.allSettled(
      rows.map((r) => this.data.logTime(r.issueId, r.timeToSubmit)),
    );
    const submitted = rows.filter((_, i) => results[i].status === 'fulfilled');
    submitted.forEach((r) => this._markLogged(r));
    this.isSubmitting.set(false);

    if (submitted.length === rows.length) {
      this._snackService.open({
        type: 'SUCCESS',
        ico: 'file_upload',
        msg: T.F.ISSUE.S.WORKLOG_FOR_DAY_SUCCESS,
        translateParams: {
          providerName: this.data.providerName,
          nrOfIssues: submitted.length,
        },
      });
      this.close();
      return;
    }
    // keep failed rows for a retry; the caller's `logTime` reports the error
    const submittedIds = new Set(submitted.map((r) => r.taskId));
    this.rows.update((all) => all.filter((r) => !submittedIds.has(r.taskId)));
  }

  close(): void {
    this._matDialogRef.close();
  }

  private _markLogged(row: WorklogRow): void {
    this._store.dispatch(
      TaskSharedActions.updateTask({
        task: {
          id: row.taskId,
          // marks every tracked day as logged, even when the submitted amount was edited
          changes: { issueTimeTracked: { ...row.timeSpentOnDay } },
        },
      }),
    );
  }

  private async _loadTimeLoggedRemote(): Promise<void> {
    const getTimeLogged = this.data.getTimeLogged;
    if (!getTimeLogged) {
      return;
    }
    await Promise.all(
      this.rows().map(async (r) => {
        try {
          this._patchRow(r.taskId, { timeLoggedRemote: await getTimeLogged(r.issueId) });
        } catch (e) {
          // informational column only; the cell stays empty
          IssueLog.warn('Loading logged time failed', e);
        }
      }),
    );
  }

  private _patchRow(taskId: string, changes: Partial<WorklogRow>): void {
    this.rows.update((all) =>
      all.map((r) => (r.taskId === taskId ? { ...r, ...changes } : r)),
    );
  }
}
