import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';

import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { SnackService } from '../../core/snack/snack.service';
import { UndoRedoActions } from './undo-redo.actions';
import { UndoRedoService } from './undo-redo.service';
import { T } from '../../t.const';

@Injectable()
/**
 * Handles snack bar notifications for undo/redo results.
 *
 * NOTE: The success snack offers the inverse action (undo ↔ redo) so the user
 * can quickly revert the last undo/redo without navigating the history UI.
 */
export class UndoRedoSnackEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _snackService = inject(SnackService);
  private readonly _undoRedoService = inject(UndoRedoService);

  /** Shows a success snack after undo/redo and wires the opposite action. */
  undoRedoSuccess$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(UndoRedoActions.undoRedoSuccess),
        tap(({ label, performedAction }) =>
          this._snackService.open({
            type: 'SUCCESS',
            msg: label,
            isSkipTranslate: true,
            actionStr: performedAction === 'undo' ? T.G.REDO : T.G.UNDO,
            actionFn:
              performedAction === 'undo'
                ? () => {
                    void this._undoRedoService.redo();
                  }
                : () => {
                    void this._undoRedoService.undo();
                  },
          }),
        ),
      ),
    { dispatch: false },
  );

  /** Shows an error snack when undo/redo fails. */
  undoRedoFailed$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(UndoRedoActions.undoRedoFailed),
        tap(({ error }) =>
          this._snackService.open({
            type: 'ERROR',
            msg: error.message,
            isSkipTranslate: true,
          }),
        ),
      ),
    { dispatch: false },
  );
}
