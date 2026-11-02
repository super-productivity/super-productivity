import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  MatDialog,
  MatDialogActions,
  MatDialogClose,
  MatDialogContent,
  MatDialogTitle,
} from '@angular/material/dialog';
import { MatButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { Store } from '@ngrx/store';
import { TranslatePipe, TranslateService, TranslateStore } from '@ngx-translate/core';
import { BehaviorSubject, from } from 'rxjs';
import { switchMap } from 'rxjs/operators';
import { T } from '../../../../t.const';
import { selectTaskEntities } from '../../store/task.selectors';
import { RecentlyDeletedService } from '../recently-deleted.service';
import {
  RECENTLY_DELETED_RETENTION_DAYS,
  RecentlyDeletedEntry,
} from '../recently-deleted.util';
import { DialogConfirmComponent } from '../../../../ui/dialog-confirm/dialog-confirm.component';
import { DateTimeFormatService } from '../../../../core/date-time-format/date-time-format.service';
import { LocaleDatePipe } from '../../../../ui/pipes/locale-date.pipe';
import { getPluralKey } from '../../../../util/get-plural-key';

interface RecentlyDeletedRow {
  entry: RecentlyDeletedEntry;
  /** Plural-aware key for the subtask count; undefined without subtasks. */
  subTasksKey?: string;
}

@Component({
  selector: 'dialog-recently-deleted',
  templateUrl: './dialog-recently-deleted.component.html',
  styleUrl: './dialog-recently-deleted.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    MatDialogTitle,
    MatDialogContent,
    MatDialogActions,
    MatDialogClose,
    MatButton,
    MatIcon,
    TranslatePipe,
    LocaleDatePipe,
  ],
})
export class DialogRecentlyDeletedComponent {
  private readonly _recentlyDeletedService = inject(RecentlyDeletedService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskEntities = inject(Store).selectSignal(selectTaskEntities);
  private readonly _translateService = inject(TranslateService);
  private readonly _translateStore = inject(TranslateStore);
  private readonly _reload$ = new BehaviorSubject<void>(undefined);
  private readonly _storedEntries = toSignal(
    this._reload$.pipe(switchMap(() => from(this._recentlyDeletedService.getEntries()))),
  );

  readonly locale = inject(DateTimeFormatService).currentLocale;
  readonly T: typeof T = T;
  readonly retentionParams = { days: RECENTLY_DELETED_RETENTION_DAYS };

  // Families that are live again (restored on another device, or recreated by
  // a concurrent edit that won over the delete) are not "deleted" any more.
  readonly rows = computed<RecentlyDeletedRow[] | undefined>(() => {
    const stored = this._storedEntries();
    if (!stored) return undefined;
    const taskEntities = this._taskEntities();
    return stored
      .filter((entry) => !taskEntities[entry.id])
      .map((entry) => ({
        entry,
        subTasksKey: entry.subTasks.length
          ? getPluralKey(
              this._translateService,
              this._translateStore,
              entry.subTasks.length,
              'F.TASK.D_RECENTLY_DELETED.SUB_TASKS',
            )
          : undefined,
      }));
  });

  async restore(entry: RecentlyDeletedEntry): Promise<void> {
    await this._recentlyDeletedService.restore(entry);
    this._reload$.next();
  }

  emptyTrash(): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          okTxt: T.F.TASK.D_RECENTLY_DELETED.EMPTY,
          message: T.F.TASK.D_RECENTLY_DELETED.CONFIRM_EMPTY,
        },
      })
      .afterClosed()
      .subscribe(async (isConfirm: boolean) => {
        if (isConfirm) {
          await this._recentlyDeletedService.empty();
          this._reload$.next();
        }
      });
  }
}
