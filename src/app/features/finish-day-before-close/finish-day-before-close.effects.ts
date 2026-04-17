import { Injectable, inject } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { LOCAL_ACTIONS } from '../../util/local-actions.token';
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
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../t.const';
import { DataInitStateService } from '../../core/data-init/data-init-state.service';
import { confirmDialog } from '../../util/native-dialogs';

const EXEC_BEFORE_CLOSE_ID = 'FINISH_DAY_BEFORE_CLOSE_EFFECT';

@Injectable()
export class FinishDayBeforeCloseEffects {
  private actions$ = inject(LOCAL_ACTIONS);
  private _execBeforeCloseService = inject(ExecBeforeCloseService);
  private _globalConfigService = inject(GlobalConfigService);
  private _dataInitStateService = inject(DataInitStateService);
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);
  private _translateService = inject(TranslateService);

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
          tap((todayMainTasks) => this._handleCloseDecision(todayMainTasks)),
        ),
      { dispatch: false },
    );

  _handleCloseDecision(todayMainTasks: Task[]): void {
    const doneTasks = todayMainTasks.filter((t) => t.isDone);
    if (
      doneTasks.length &&
      !this._confirm(
        this._translateService.instant(
          T.F.FINISH_DAY_BEFORE_EXIT.C.FINISH_DAY_BEFORE_EXIT,
          {
            nr: doneTasks.length,
          },
        ),
      )
    ) {
      // User clicked Cancel — stay on the current page, do not close
      return;
    }
    // User clicked OK or there are no done tasks — allow the app to close
    this._execBeforeCloseService.setDone(EXEC_BEFORE_CLOSE_ID);
  }

  _confirm(message: string): boolean {
    return confirmDialog(message);
  }
}
