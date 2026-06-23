import { createSelector } from '@ngrx/store';
import { RootState, UNDO_REDO_FEATURE_KEY } from '../root-state';
import { UndoRedoState } from './undo-redo.state';

export const selectUndoRedoState = (state: RootState): UndoRedoState =>
  state[UNDO_REDO_FEATURE_KEY];

export const selectUndoStack = createSelector(
  selectUndoRedoState,
  (state) => state.undoStack,
);

export const selectLastUndoneOperation = createSelector(
  selectUndoRedoState,
  (state) => state.lastUndoneOperation,
);

export const selectCanUndo = createSelector(selectUndoStack, (stack) => stack.length > 0);

export const selectLastUndoOperation = createSelector(selectUndoStack, (stack) =>
  stack.length > 0 ? stack[0] : null,
);

export const selectLastUndoOperationPayload = createSelector(
  selectUndoRedoState,
  selectLastUndoOperation,
  (state, operation) =>
    operation ? state.undoPayloadByOperationId[operation.id] : undefined,
);
