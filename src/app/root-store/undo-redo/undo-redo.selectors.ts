import { createSelector } from '@ngrx/store';
import { RootState, UNDO_REDO_FEATURE_KEY } from '../root-state';
import { UndoRedoState } from './undo-redo.state';

export const selectUndoRedoState = (state: RootState): UndoRedoState =>
  state[UNDO_REDO_FEATURE_KEY];

export const selectUndoStack = createSelector(
  selectUndoRedoState,
  (state) => state.undoStack,
);

export const selectRedoStack = createSelector(
  selectUndoRedoState,
  (state) => state.redoStack,
);

export const selectCanUndo = createSelector(selectUndoStack, (stack) => stack.length > 0);

export const selectCanRedo = createSelector(selectRedoStack, (stack) => stack.length > 0);

export const selectLastUndoOperation = createSelector(selectUndoStack, (stack) =>
  stack.length > 0 ? stack[0] : null,
);

export const selectLastRedoOperation = createSelector(selectRedoStack, (stack) =>
  stack.length > 0 ? stack[0] : null,
);
