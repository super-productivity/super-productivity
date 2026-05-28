import { Injectable, inject } from '@angular/core';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { ActionType, Operation } from '../../op-log/core/operation.types';
import { RootState } from '../root-state';
import { UndoRedoActions } from './undo-redo.actions';
import { selectLastRedoOperation, selectLastUndoOperation } from './undo-redo.selectors';
import {
  UndoRedoErrorCode,
  UndoRedoOperation,
  UndoRedoResult,
  UndoRedoOperationType,
} from './undo-redo.types';
import { CompensatingOperationsRegistry } from './compensating-operations-registry.service';
import { UndoValidatorService } from './undo-validator.service';

interface UndoCandidate {
  operation: Operation;
}

type ActionWithMeta = Action & {
  meta?: {
    isCompensating?: boolean;
    [key: string]: unknown;
  };
};

/**
 * Service responsible for orchestrating undo/redo flow.
 * Coordinates between validator, registry, and store to execute compensating operations.
 *
 * NOTE: Undo/Redo maintains strict linear history. Only the topmost operation can be undone
 * or redone. Intermediate operations cannot be skipped to prevent replay fidelity issues.
 */
@Injectable({
  providedIn: 'root',
})
export class UndoRedoService {
  private readonly _store = inject<Store<RootState>>(Store);
  private readonly _registry = inject(CompensatingOperationsRegistry);
  private readonly _validator = inject(UndoValidatorService);

  /** Attempts to undo the last operation on the undo stack.
   * IMPORTANT: Only the topmost operation can be undone to maintain linear history.
   */
  async undo(): Promise<UndoRedoResult> {
    const candidate = await this._getLastStackCandidate(selectLastUndoOperation);
    const lastOp = candidate?.operation;

    // Only the top operation can be undone. Skipping unsupported operations would
    // break the linear history and could replay redo without intermediate updates.
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

    const result = await this._registry.getCompensatingOp(lastOp);
    if ('code' in result) {
      this._store.dispatch(UndoRedoActions.undoRedoFailed({ error: result }));
      return {
        success: false,
        error: result,
        operation: lastOp,
      };
    }

    this._store.dispatch(UndoRedoActions.undo());
    this._store.dispatch(this._markAsCompensating(result.compensatingOp.action));
    this._store.dispatch(
      UndoRedoActions.undoRedoSuccess({
        label: result.compensatingOp.label,
        performedAction: 'undo',
      }),
    );

    return {
      success: true,
      operation: result.operation,
      compensatingOp: result.compensatingOp,
    };
  }

  /** Attempts to redo the last operation on the redo stack.
   * IMPORTANT: Only the topmost operation can be redone to maintain linear history.
   */
  async redo(): Promise<UndoRedoResult> {
    const candidate = await this._getLastStackCandidate(selectLastRedoOperation);
    const lastRedoOp = candidate?.operation;

    if (!lastRedoOp) {
      return {
        success: false,
        error: {
          code: UndoRedoErrorCode.NoOperation,
          message: 'No operation available to redo.',
        },
      };
    }

    const redoAction = await this._registry.convertOpToAction(lastRedoOp);
    if ('code' in redoAction) {
      this._store.dispatch(UndoRedoActions.undoRedoFailed({ error: redoAction }));
      return {
        success: false,
        error: redoAction,
        operation: lastRedoOp,
      };
    }

    const undoRedoOperation = this._buildUndoRedoOperation(lastRedoOp);

    this._store.dispatch(UndoRedoActions.redo());
    this._store.dispatch(this._markAsCompensating(redoAction));
    this._store.dispatch(
      UndoRedoActions.undoRedoSuccess({
        label: undoRedoOperation.label,
        performedAction: 'redo',
      }),
    );

    return {
      success: true,
      operation: undoRedoOperation,
      compensatingOp: {
        originalOperationId: lastRedoOp.id,
        label: undoRedoOperation.label,
        action: redoAction,
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
      label: `Redo ${operation.actionType}`,
    };
  }

  /** Retrieves the topmost operation from either undo or redo stack. */
  private async _getLastStackCandidate(
    selector: typeof selectLastUndoOperation | typeof selectLastRedoOperation,
  ): Promise<UndoCandidate | undefined> {
    const stackOp = await firstValueFrom(this._store.select(selector).pipe(take(1)));
    if (stackOp) {
      return { operation: stackOp };
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
}
