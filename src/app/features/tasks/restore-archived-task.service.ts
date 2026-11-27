import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { Task, TaskArchive } from './task.model';
import { T } from '../../t.const';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { TaskArchiveService } from '../archive/task-archive.service';
import { DateService } from '../../core/date/date.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { selectTaskEntities } from './store/task.selectors';
import { Log } from '../../core/log';

/**
 * The one user-facing "restore from archive" flow, shared by History and the
 * archived-task details dialog: confirm, collect the archived sub tasks and
 * write a single `restoreTask` op that plans the task for today.
 */
@Injectable({
  providedIn: 'root',
})
export class RestoreArchivedTaskService {
  private readonly _matDialog = inject(MatDialog);
  private readonly _store = inject(Store);
  private readonly _activeTasks = this._store.selectSignal(selectTaskEntities);
  private readonly _taskArchiveService = inject(TaskArchiveService);
  private readonly _dateService = inject(DateService);

  isActive(task: Task): boolean {
    return !!this._activeTasks()[task.parentId || task.id];
  }

  /**
   * The archived task a restore of `task` brings back: the task itself, or its
   * parent for a sub task, which cannot be active without its parent (History
   * offers no restore on sub task rows for the same reason). `null` when there
   * is nothing to restore: not in the archive, or already active.
   */
  findRestorableTask(task: Task, archive: TaskArchive): Task | null {
    const rootId = task.parentId || task.id;
    return this.isActive(task) ? null : (archive.entities[rootId] ?? null);
  }

  /** Resolves true when the confirmed task is active and can be opened. */
  async confirmAndRestore(displayedTask: Task): Promise<boolean> {
    const isConfirm = await firstValueFrom(
      this._matDialog
        .open(DialogConfirmComponent, {
          restoreFocus: true,
          data: {
            okTxt: T.G.DO_IT,
            message: T.F.WORKLOG.D_CONFIRM_RESTORE,
            translateParams: { title: displayedTask.title },
          },
        })
        .afterClosed(),
      { defaultValue: false },
    );
    if (!isConfirm) {
      return false;
    }

    // Sync can restore or edit this task while the confirmation is open.
    // Check the live store after the archive read, immediately before dispatch.
    if (this.isActive(displayedTask)) {
      return true;
    }
    const archive = await this._taskArchiveService.load();
    if (this.isActive(displayedTask)) {
      return true;
    }
    const task = archive.entities[displayedTask.id];
    if (!task) {
      return false;
    }
    const subTasks = (task.subTaskIds ?? [])
      .map((id) => archive.entities[id])
      .filter((sub): sub is Task => !!sub);
    // Read after the archive load so a restore confirmed across midnight still
    // lands on the logical today.
    const restoreToToday = {
      today: this._dateService.todayStr(),
      startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
    };

    Log.log('RESTORE', { taskId: task.id, subTaskCount: subTasks.length });
    this._store.dispatch(
      TaskSharedActions.restoreTask({ task, subTasks, restoreToToday }),
    );
    return true;
  }
}
