import { Injectable } from '@angular/core';
import { ActionType, Operation } from '../../op-log/core/operation.types';
import { UndoRedoError, UndoRedoErrorCode } from './undo-redo.types';

const SUPPORTED_UNDO_ACTIONS = new Set<ActionType>([
  ActionType.TASK_SHARED_ADD,
  ActionType.TASK_SHARED_DELETE,
  ActionType.TASK_ADD_SUB,
  ActionType.TASK_SHARED_UPDATE,
]);

@Injectable({
  providedIn: 'root',
})
export class UndoValidatorService {
  validateLastOperation(op: Operation | undefined): UndoRedoError | null {
    if (!op) {
      return {
        code: UndoRedoErrorCode.NoOperation,
        message: 'No operation to undo.',
      };
    }

    if (!SUPPORTED_UNDO_ACTIONS.has(op.actionType)) {
      return {
        code: UndoRedoErrorCode.UnsupportedOperation,
        message: `Undo is not supported for ${op.actionType}.`,
      };
    }

    return null;
  }
}
