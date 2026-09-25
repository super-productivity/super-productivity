import { inject, Injectable } from '@angular/core';
import { createEffect } from '@ngrx/effects';
import { filter, tap } from 'rxjs/operators';
import { ALL_ACTIONS } from '../../util/local-actions.token';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { isReducerRejectedAction } from './reducer-failure-guard.meta-reducer';

/**
 * Tells the user when `reducerFailureGuardMetaReducer` discarded an action
 * (#10195). In production `devError` only logs, so without this the rejected
 * change would vanish silently.
 *
 * Uses ALL_ACTIONS on purpose: LOCAL_ACTIONS filters rejected actions out so
 * ordinary effects never run side effects for them, which is exactly the
 * signal this effect needs. Only the action type is inspected; the payload is
 * never logged or shown.
 */
@Injectable()
export class ReducerFailureSnackEffects {
  private _actions$ = inject(ALL_ACTIONS);
  private _snackService = inject(SnackService);

  notifyRejectedAction$ = createEffect(
    () =>
      this._actions$.pipe(
        filter(isReducerRejectedAction),
        tap(() => {
          this._snackService.open({
            type: 'ERROR',
            msg: T.GLOBAL_SNACK.ACTION_REJECTED,
          });
        }),
      ),
    { dispatch: false },
  );
}
