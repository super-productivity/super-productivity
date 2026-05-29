import { createActionGroup, emptyProps, props } from '@ngrx/store';
import { Operation } from '../../op-log/core/operation.types';

/**
 * Undo/Redo Actions
 *
 * These actions are dispatched to manage undo/redo history.
 */
export const UndoRedoActions = createActionGroup({
  source: 'Undo Redo',
  events: {
    /**
     * Add an operation to the undo stack.
     * Called when a user-initiated action is completed.
     * This clears the redo stack since a new action invalidates redo history.
     */
    addToUndoStack: props<{ operation: Operation }>(),

    /**
     * Perform an undo operation.
     * Pops from undo stack and pushes to redo stack.
     * UndoRedoService dispatches the compensating action.
     */
    undo: emptyProps(),

    /**
     * Perform a redo operation.
     * Pops from redo stack and pushes to undo stack.
     * UndoRedoService dispatches the original persisted action.
     */
    redo: emptyProps(),

    /**
     * Notify that undo/redo succeeded.
     */
    undoRedoSuccess: props<{ label: string; performedAction: 'undo' | 'redo' }>(),

    /**
     * Notify that undo/redo failed.
     */
    undoRedoFailed: props<{ error: { message: string } }>(),
  },
});
