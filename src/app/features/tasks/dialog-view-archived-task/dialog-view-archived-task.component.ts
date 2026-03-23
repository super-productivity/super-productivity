import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import {
  MAT_DIALOG_DATA,
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
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
import { IssueIconPipe } from '../../issue/issue-icon/issue-icon.pipe';
import { IssueService } from '../../issue/issue.service';
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
  readonly data = inject<ViewArchivedTaskData>(MAT_DIALOG_DATA);

  T: typeof T = T;
  subTasks = signal<Task[]>([]);
  repeatCfgLabel = signal<string | null>(null);
  issueUrl = signal<string | null>(null);

  get task(): Task {
    return this.data.task;
  }

  constructor() {
    if (this.task.subTaskIds?.length) {
      this._taskArchiveService
        .load()
        .then((archiveState) => {
          this.subTasks.set(
            this.task.subTaskIds
              .map((id) => archiveState.entities[id])
              .filter((v): v is Task => !!v),
          );
        })
        .catch((e) => Log.warn('Failed to load subtasks from archive', e));
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
}
