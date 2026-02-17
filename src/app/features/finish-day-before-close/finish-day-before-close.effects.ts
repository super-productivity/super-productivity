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
import { EMPTY, Observable } from 'rxjs';
import { WorkContextService } from '../work-context/work-context.service';
import { TaskService } from '../tasks/task.service';
import { Router } from '@angular/router';
import { TODAY_TAG } from '../tag/tag.const';
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
  private _router = inject(Router);
  private _translateService = inject(TranslateService);

  isEnabled$: Observable<boolean> =
    this._dataInitStateService.isAllDataLoadedInitially$.pipe(
      concatMap(() => this._globalConfigService.misc$),
      map((misc) => misc.isConfirmBeforeExitWithoutFinishDay),
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
            const doneTasks = todayMainTasks.filter((t) => t.isDone);
            if (doneTasks.length) {
              if (
                !confirmDialog(
                  this._translateService.instant(
                    T.F.FINISH_DAY_BEFORE_EXIT.C.FINISH_DAY_BEFORE_EXIT,
                    {
                      nr: doneTasks.length,
                    },
                  ),
                )
              ) {
                // User wants to finish day first - navigate them there
                this._router.navigate([`tag/${TODAY_TAG.id}/daily-summary`]);
                return; // Don't signal done — keep app open
              }
            }
            this._execBeforeCloseService.setDone(EXEC_BEFORE_CLOSE_ID);
          }),
        ),
      { dispatch: false },
    );
}
