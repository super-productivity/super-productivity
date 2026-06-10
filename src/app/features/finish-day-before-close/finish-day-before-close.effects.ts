import { Injectable, inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { MatDialog } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ExecBeforeCloseService } from '../../core/electron/exec-before-close.service';
import { GlobalConfigService } from '../config/global-config.service';
import {
  concatMap,
  distinctUntilChanged,
  first,
  map,
  switchMap,
  tap,
} from 'rxjs/operators';
import { IS_ELECTRON } from '../../app.constants';
import { combineLatest, EMPTY, Observable } from 'rxjs';
import { WorkContextService } from '../work-context/work-context.service';
import { Task } from '../tasks/task.model';
import { TaskService } from '../tasks/task.service';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import {
  DialogFinishDayBeforeCloseComponent,
  FinishDayBeforeCloseChoice,
  FinishDayBeforeCloseDialogData,
} from './dialog-finish-day-before-close/dialog-finish-day-before-close.component';

const EXEC_BEFORE_CLOSE_ID = 'FINISH_DAY_BEFORE_CLOSE_EFFECT';

@Injectable()
export class FinishDayBeforeCloseEffects {
  private _execBeforeCloseService = inject(ExecBeforeCloseService);
  private _globalConfigService = inject(GlobalConfigService);
  private _dataInitStateService = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _matDialog = inject(MatDialog);
  private _router = inject(Router);

  isEnabled$: Observable<boolean> =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() =>
        combineLatest([
          this._globalConfigService.misc$,
          this._globalConfigService.appFeatures$,
        ]),
      ),
      map(
        ([misc, appFeatures]) =>
          appFeatures.isFinishDayEnabled && misc.isConfirmBeforeExitWithoutFinishDay,
      ),
      distinctUntilChanged(),
    );

  scheduleUnscheduleFinishDayBeforeClose$ =
    IS_ELECTRON &&
    createEffect(
      () =>
        this.isEnabled$.pipe(
          tap((isEnabled) =>
            isEnabled
              ? this._execBeforeCloseService.schedule(EXEC_BEFORE_CLOSE_ID)
              : this._execBeforeCloseService.unschedule(EXEC_BEFORE_CLOSE_ID),
          ),
        ),
      { dispatch: false },
    );

  warnToFinishDayBeforeClose$ =
    IS_ELECTRON &&
    createEffect(
      () =>
        this.isEnabled$.pipe(
          switchMap((isEnabled) =>
            isEnabled ? this._execBeforeCloseService.onBeforeClose$ : EMPTY,
          ),
          switchMap(() =>
            this._workContextService.mainWorkContext$.pipe(
              first(),
              switchMap((workContext) =>
                this._taskService.getByIdsLive$(workContext.taskIds).pipe(first()),
              ),
            ),
          ),
          tap((todayMainTasks) => {
            this._handleCloseDecision(todayMainTasks).catch(() => {
              // Don't let a dialog/router failure trap the user in close-pending state
              this._execBeforeCloseService.setDone(EXEC_BEFORE_CLOSE_ID);
            });
          }),
        ),
      { dispatch: false },
    );

  async _handleCloseDecision(todayMainTasks: Task[]): Promise<void> {
    const doneCount = todayMainTasks.filter((t) => t.isDone).length;
    if (doneCount === 0) {
      this._execBeforeCloseService.setDone(EXEC_BEFORE_CLOSE_ID);
      return;
    }

    const choice = await this._showDialog(doneCount);
    if (choice === 'quit') {
      this._execBeforeCloseService.setDone(EXEC_BEFORE_CLOSE_ID);
    } else if (choice === 'finish-day') {
      this._router.navigateByUrl('/daily-summary');
    }
  }

  async _showDialog(doneTaskCount: number): Promise<FinishDayBeforeCloseChoice> {
    const dialogRef = this._matDialog.open<
      DialogFinishDayBeforeCloseComponent,
      FinishDayBeforeCloseDialogData,
      FinishDayBeforeCloseChoice
    >(DialogFinishDayBeforeCloseComponent, {
      data: { doneTaskCount },
      autoFocus: true,
      restoreFocus: true,
    });
    const result = await firstValueFrom(dialogRef.afterClosed());
    return result ?? 'cancel';
  }
}
