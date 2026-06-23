import { Injectable, inject } from '@angular/core';
import { Operation } from '../../op-log/core/operation.types';
import { UndoRedoError, UndoRedoErrorCode } from './undo-redo.types';
import { CompensatingOperationsRegistry } from './compensating-operations-registry.service';

@Injectable({
  providedIn: 'root',
})
export class UndoValidatorService {
  private readonly _registry = inject(CompensatingOperationsRegistry);

  validateLastOperation(op: Operation | undefined): UndoRedoError | null {
    if (!op) {
      return {
        code: UndoRedoErrorCode.NoOperation,
        message: 'No operation to undo.',
      };
    }

    if (!this._registry.isUndoableActionType(op.actionType)) {
      return {
        code: UndoRedoErrorCode.UnsupportedOperation,
        message: `Undo is not supported for ${op.actionType}.`,
      };
    }

    return null;
  }
}
