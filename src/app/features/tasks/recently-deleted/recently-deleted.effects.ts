import { inject, Injectable } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';
import { LOCAL_ACTIONS } from '../../../util/local-actions.token';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { RecentlyDeletedService } from './recently-deleted.service';

/**
 * Records local deletes and restores in the device-local trash. Remote ones are
 * recorded via OperationApplierService, which has the op timestamps.
 */
@Injectable()
export class RecentlyDeletedEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _recentlyDeletedService = inject(RecentlyDeletedService);

  recordLocalDeleteAndRestore$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(
          TaskSharedActions.deleteTask,
          TaskSharedActions.deleteTasks,
          // Also History, REST API and issue restores. For the trash's own
          // restore this repeats restore()'s idempotent delete.
          TaskSharedActions.restoreTask,
          // The undo snack's restore.
          TaskSharedActions.restoreDeletedTask,
        ),
        tap((action) => {
          void this._recentlyDeletedService.recordAction(action, Date.now());
        }),
      ),
    { dispatch: false },
  );
}
