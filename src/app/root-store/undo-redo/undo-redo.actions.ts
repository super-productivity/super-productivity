import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Operation } from '../../op-log/core/operation.types';
import { UndoRedoError } from './undo-redo.types';

/**
 * Undo Actions
 *
 * These actions are dispatched to manage undo history.
 */
export const UndoRedoActions = createActionGroup({
  source: 'Undo Redo',
  events: {
    /**
     * Add an operation to the undo stack.
     * Called when a user-initiated action is completed.
     * This clears the last undone operation since a new action invalidates snackbar restore.
     */
    addToUndoStack: props<{ operation: Operation; undoPayload?: unknown }>(),

    /**
     * Perform an undo operation.
     * Pops from undo stack and stores the operation for one snackbar restore.
     * UndoRedoService dispatches the compensating action.
     */
    undo: emptyProps(),

    /**
     * Restore the last undone operation from the snackbar action.
     * UndoRedoService dispatches the original persisted action.
     */
    restoreLastUndoneOperation: emptyProps(),

    /**
     * Clear the one-shot snackbar restore operation without adding it back
     * to undoStack. Redo is captured as a fresh op by OperationLogEffects.
     */
    clearLastUndoneOperation: emptyProps(),

    /**
     * Notify that undo or snackbar restore succeeded.
     */
    undoRedoSuccess: props<{ label: string; canRestore: boolean }>(),

    /**
     * Notify that undo or snackbar restore failed.
     */
    undoRedoFailed: props<{ error: UndoRedoError }>(),
  },
});
