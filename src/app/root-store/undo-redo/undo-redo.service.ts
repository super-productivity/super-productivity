import { Injectable, inject } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { ActionType, Operation } from '../../op-log/core/operation.types';
import { RootState } from '../root-state';
import { UndoRedoActions } from './undo-redo.actions';
import {
  selectLastUndoOperationPayload,
  selectLastUndoneOperation,
  selectLastUndoOperation,
} from './undo-redo.selectors';
import {
  UndoRedoErrorCode,
  UndoRedoOperation,
  UndoRedoResult,
  UndoRedoOperationType,
} from './undo-redo.types';
import { CompensatingOperationsRegistry } from './compensating-operations-registry.service';
import { UndoValidatorService } from './undo-validator.service';
import { T } from '../../t.const';

interface UndoCandidate {
  operation: Operation;
  undoPayload?: unknown;
}

type ActionWithMeta = Action & {
  meta?: {
    isCompensating?: boolean;
    isRemote?: boolean;
    [key: string]: unknown;
  };
};

/**
 * Service responsible for orchestrating undo and snackbar restore flow.
 * Coordinates between validator, registry, and store to execute compensating operations.
 *
 * NOTE: Undo maintains strict linear history. Only the topmost operation can be undone.
 * The snackbar can restore only the single most recently undone operation.
 */
@Injectable({
  providedIn: 'root',
})
export class UndoRedoService {
  private readonly _store = inject<Store<RootState>>(Store);
  private readonly _registry = inject(CompensatingOperationsRegistry);
  private readonly _validator = inject(UndoValidatorService);
  private _isUndoRedoInFlight = false;

  /** Attempts to undo the last operation on the undo stack.
   * IMPORTANT: Only the topmost operation can be undone to maintain linear history.
   */
  async undo(): Promise<UndoRedoResult> {
    // Extra Guard against rapid shortcut repeats
    if (this._isUndoRedoInFlight) {
      return this._createInFlightResult('undo');
    }

    this._isUndoRedoInFlight = true;
    try {
      return await this._undo();
    } finally {
      this._isUndoRedoInFlight = false;
    }
  }

  private async _undo(): Promise<UndoRedoResult> {
    const candidate = await this._getLastStackCandidate(selectLastUndoOperation);
    const lastOp = candidate?.operation;

    // Only the top operation can be undone. Skipping unsupported operations would
    // break the linear history.
    if (!lastOp) {
      return {
        success: false,
        error: {
          code: UndoRedoErrorCode.NoOperation,
          message: 'No operation available to undo.',
        },
      };
    }

    const validationError = this._validator.validateLastOperation(lastOp);
    if (validationError) {
      this._store.dispatch(UndoRedoActions.undoRedoFailed({ error: validationError }));
      return {
        success: false,
        error: validationError,
        operation: lastOp,
      };
    }

    const result = await this._registry.getCompensatingOp(lastOp, candidate.undoPayload);
    if ('code' in result) {
      this._store.dispatch(UndoRedoActions.undoRedoFailed({ error: result }));
      return {
        success: false,
        error: result,
        operation: lastOp,
      };
    }

    this._store.dispatch(this._markAsCompensating(result.compensatingOp.action));
    this._store.dispatch(UndoRedoActions.undo());
    this._store.dispatch(
      UndoRedoActions.undoRedoSuccess({
        label: result.compensatingOp.label,
        canRestore: true,
      }),
    );

    return {
      success: true,
      operation: result.operation,
      compensatingOp: result.compensatingOp,
    };
  }

  async restoreLastUndoneOperation(): Promise<UndoRedoResult> {
    if (this._isUndoRedoInFlight) {
      return this._createInFlightResult('restore');
    }

    this._isUndoRedoInFlight = true;
    try {
      return await this._restoreLastUndoneOperation();
    } finally {
      this._isUndoRedoInFlight = false;
    }
  }

  private async _restoreLastUndoneOperation(): Promise<UndoRedoResult> {
    const candidate = await this._getLastStackCandidate(selectLastUndoneOperation);
    const lastUndoneOp = candidate?.operation;

    if (!lastUndoneOp) {
      return {
        success: false,
        error: {
          code: UndoRedoErrorCode.NoOperation,
          message: 'No operation available to restore.',
        },
      };
    }

    const restoreAction = await this._registry.convertOpToAction(lastUndoneOp);
    if ('code' in restoreAction) {
      this._store.dispatch(UndoRedoActions.undoRedoFailed({ error: restoreAction }));
      return {
        success: false,
        error: restoreAction,
        operation: lastUndoneOp,
      };
    }

    const undoRedoOperation = this._buildUndoRedoOperation(lastUndoneOp);
    // convertOpToAction() marks actions as remote because it is primarily used
    // for sync replay. Redo is a new local user action and must be captured as
    // a fresh operation, so explicitly clear that replay marker.
    const redoAction = this._markAsLocalForRedo(restoreAction);

    this._store.dispatch(redoAction);
    this._store.dispatch(UndoRedoActions.clearLastUndoneOperation());
    this._store.dispatch(
      UndoRedoActions.undoRedoSuccess({
        label: undoRedoOperation.label,
        canRestore: false,
      }),
    );

    return {
      success: true,
      operation: undoRedoOperation,
      compensatingOp: {
        originalOperationId: lastUndoneOp.id,
        label: undoRedoOperation.label,
        action: redoAction,
      },
    };
  }

  private _createInFlightResult(action: 'undo' | 'restore'): UndoRedoResult {
    return {
      success: false,
      error: {
        code: UndoRedoErrorCode.NoOperation,
        message: `Cannot ${action} while undo is already in progress.`,
      },
    };
  }

  /** Builds operation metadata from raw operation based on action type. */
  private _buildUndoRedoOperation(operation: Operation): UndoRedoOperation {
    return {
      originalOperation: operation,
      operationType:
        operation.actionType === ActionType.TASK_SHARED_DELETE
          ? UndoRedoOperationType.Delete
          : operation.actionType === ActionType.TASK_SHARED_UPDATE
            ? UndoRedoOperationType.Update
            : UndoRedoOperationType.Create,
      actionType: operation.actionType,
      label: T.G.REDO_COMPLETE,
    };
  }

  /** Retrieves an operation from the undo state. */
  private async _getLastStackCandidate(
    selector: typeof selectLastUndoOperation | typeof selectLastUndoneOperation,
  ): Promise<UndoCandidate | undefined> {
    const stackOp = await firstValueFrom(this._store.select(selector).pipe(take(1)));
    if (stackOp) {
      const undoPayload =
        selector === selectLastUndoOperation
          ? await firstValueFrom(
              this._store.select(selectLastUndoOperationPayload).pipe(take(1)),
            )
          : undefined;

      return { operation: stackOp, undoPayload };
    }

    return undefined;
  }

  /** Marks action with compensating flag so it won't be re-logged to operation-log. */
  private _markAsCompensating(action: Action): ActionWithMeta {
    const actionWithMeta = action as ActionWithMeta;

    return {
      ...actionWithMeta,
      meta: {
        ...actionWithMeta.meta,
        isCompensating: true,
      },
    };
  }

  /** Converts a replay-shaped action into a new local action for redo persistence. */
  private _markAsLocalForRedo(action: Action): ActionWithMeta {
    const actionWithMeta = action as ActionWithMeta;

    return {
      ...actionWithMeta,
      meta: {
        ...actionWithMeta.meta,
        isRemote: false,
      },
    };
  }
}
