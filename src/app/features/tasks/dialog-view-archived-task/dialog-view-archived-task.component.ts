import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogRef,
  MatDialogTitle,
} from '@angular/material/dialog';
import { Task } from '../task.model';
import { T } from '../../../t.const';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { MatIcon } from '@angular/material/icon';
import { MatButton } from '@angular/material/button';
import { MarkdownComponent } from 'ngx-markdown';
import { MsToStringPipe } from '../../../ui/duration/ms-to-string.pipe';
import { LocaleDatePipe } from '../../../ui/pipes/locale-date.pipe';
import { TaskAttachmentListComponent } from '../task-attachment/task-attachment-list/task-attachment-list.component';
// eslint-disable-next-line local-rules/no-sibling-feature-ui -- grandfathered feature-boundary debt (#8299)
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { IssueService } from '../../issue/issue.service';
// eslint-disable-next-line local-rules/no-sibling-feature-ui -- grandfathered feature-boundary debt (#8299)
import { DialogEditTaskRepeatCfgComponent } from '../../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component';
import { getDbDateStr } from '../../../util/get-db-date-str';
import { TaskRepeatCfgService } from '../../task-repeat-cfg/task-repeat-cfg.service';
import { getTaskRepeatInfoText } from '../task-detail-panel/get-task-repeat-info-text.util';
import { DateTimeFormatService } from '../../../core/date-time-format/date-time-format.service';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { from } from 'rxjs';
import { first } from 'rxjs/operators';
import { TaskArchiveService } from '../../archive/task-archive.service';
import { Log } from '../../../core/log';
import { RestoreArchivedTaskService } from '../restore-archived-task.service';
import { NavigateToTaskService } from '../../../core-ui/navigate-to-task/navigate-to-task.service';

export interface ViewArchivedTaskData {
  task: Task;
}

@Component({
  selector: 'dialog-view-archived-task',
  templateUrl: './dialog-view-archived-task.component.html',
  styleUrl: './dialog-view-archived-task.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    TranslatePipe,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatDialogTitle,
    MatIcon,
    MatButton,
    MarkdownComponent,
    MsToStringPipe,
    LocaleDatePipe,
    TaskAttachmentListComponent,
    IssueIconPipe,
  ],
})
export class DialogViewArchivedTaskComponent {
  private _matDialog = inject(MatDialog);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _translateService = inject(TranslateService);
  private _dateTimeFormatService = inject(DateTimeFormatService);
  private _issueService = inject(IssueService);
  private _taskArchiveService = inject(TaskArchiveService);
  private _restoreArchivedTaskService = inject(RestoreArchivedTaskService);
  private _navigateToTaskService = inject(NavigateToTaskService);
  private _matDialogRef = inject(MatDialogRef<DialogViewArchivedTaskComponent>);
  readonly data = inject<ViewArchivedTaskData>(MAT_DIALOG_DATA);

  // Exposed so the template can pass the reactive locale to the now-pure
  // `localeDate` pipe, preserving re-render on a locale change.
  readonly locale = this._dateTimeFormatService.currentLocale;

  T: typeof T = T;
  subTasks = signal<Task[]>([]);
  repeatCfgLabel = signal<string | null>(null);
  issueUrl = signal<string | null>(null);
  // What Restore brings back: this task, or its parent for a sub task. Stays
  // null (no Restore action) for the active tasks this dialog is also opened
  // for, e.g. from the daily summary.
  restorableTask = signal<Task | null>(null);

  get task(): Task {
    return this.data.task;
  }

  constructor() {
    if (
      this.task.subTaskIds?.length ||
      !this._restoreArchivedTaskService.isActive(this.task)
    ) {
      this._taskArchiveService
        .load()
        .then((archive) => {
          this.restorableTask.set(
            this._restoreArchivedTaskService.findRestorableTask(this.task, archive),
          );
          this.subTasks.set(
            (this.task.subTaskIds ?? [])
              .map((id) => archive.entities[id])
              .filter((sub): sub is Task => !!sub),
          );
        })
        .catch((e) => Log.warn('Failed to load archived task details', e));
    }

    if (this.task.issueId && this.task.issueType && this.task.issueProviderId) {
      from(
        this._issueService.issueLink(
          this.task.issueType,
          this.task.issueId,
          this.task.issueProviderId,
        ),
      )
        .pipe(takeUntilDestroyed())
        .subscribe({
          next: (url) => {
            if (url) {
              this.issueUrl.set(url);
            }
          },
          error: (e) => Log.warn('Failed to resolve issue link', e),
        });
    }

    if (this.task.repeatCfgId) {
      this._taskRepeatCfgService
        .getTaskRepeatCfgByIdAllowUndefined$(this.task.repeatCfgId)
        .pipe(first(), takeUntilDestroyed())
        .subscribe((repeatCfg) => {
          if (repeatCfg) {
            const [key, params] = getTaskRepeatInfoText(
              repeatCfg,
              this._dateTimeFormatService.currentLocale(),
              this._dateTimeFormatService,
              this._translateService,
            );
            this.repeatCfgLabel.set(this._translateService.instant(key, params));
          }
        });
    }
  }

  openRepeatCfg(): void {
    this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
      restoreFocus: true,
      data: {
        task: this.task,
        targetDate: this.task.dueDay || getDbDateStr(new Date(this.task.created)),
      },
    });
  }

  async restore(): Promise<void> {
    const task = this.restorableTask();
    if (!task || !(await this._restoreArchivedTaskService.confirmAndRestore(task))) {
      return;
    }
    this._matDialogRef.close();
    // Go to the task rather than the active list: Search can be open over a
    // project the restored task is not part of.
    await this._navigateToTaskService.navigate(task.id);
  }
}
