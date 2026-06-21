import { Injectable, inject } from '@angular/core';
import { createEffect, ofType } from '@ngrx/effects';
import { tap } from 'rxjs/operators';

import { LOCAL_ACTIONS } from '../../util/local-actions.token';
import { SnackService } from '../../core/snack/snack.service';
import { UndoRedoActions } from './undo-redo.actions';
import { UndoRedoService } from './undo-redo.service';
import { T } from '../../t.const';
import { UndoRedoErrorCode } from './undo-redo.types';

const undoRedoErrorMessageByCode: Record<UndoRedoErrorCode, string> = {
  [UndoRedoErrorCode.NoOperation]: T.G.UNDO_REDO_NO_OPERATION,
  [UndoRedoErrorCode.UnsupportedOperation]: T.G.UNDO_REDO_UNSUPPORTED_OPERATION,
  [UndoRedoErrorCode.MissingPayload]: T.G.UNDO_REDO_MISSING_PAYLOAD,
  [UndoRedoErrorCode.MissingEntity]: T.G.UNDO_REDO_MISSING_ENTITY,
  [UndoRedoErrorCode.MissingSnapshot]: T.G.UNDO_REDO_MISSING_SNAPSHOT,
  [UndoRedoErrorCode.ValidationFailed]: T.G.UNDO_REDO_VALIDATION_FAILED,
};

@Injectable()
/**
 * Handles snack bar notifications for undo results.
 *
 * NOTE: The success snack offers a single restore action for the latest undo.
 */
export class UndoRedoSnackEffects {
  private readonly _actions$ = inject(LOCAL_ACTIONS);
  private readonly _snackService = inject(SnackService);
  private readonly _undoRedoService = inject(UndoRedoService);

  /** Shows a success snack after undo and wires the one-shot restore action. */
  undoRedoSuccess$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(UndoRedoActions.undoRedoSuccess),
        tap(({ label, canRestore }) =>
          this._snackService.open({
            type: 'SUCCESS',
            msg: label,
            actionStr: canRestore ? T.G.REDO : undefined,
            actionFn: canRestore
              ? () => {
                  void this._undoRedoService.restoreLastUndoneOperation();
                }
              : undefined,
          }),
        ),
      ),
    { dispatch: false },
  );

  /** Shows an error snack when undo or restore fails. */
  undoRedoFailed$ = createEffect(
    () =>
      this._actions$.pipe(
        ofType(UndoRedoActions.undoRedoFailed),
        tap(({ error }) =>
          this._snackService.open({
            type: 'ERROR',
            msg: undoRedoErrorMessageByCode[error.code],
          }),
        ),
      ),
    { dispatch: false },
  );
}
