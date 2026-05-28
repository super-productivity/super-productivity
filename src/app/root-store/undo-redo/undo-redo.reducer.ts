import { createReducer, on } from '@ngrx/store';
import { ActionType } from '../../op-log/core/operation.types';
import { UndoRedoState, initialUndoRedoState } from './undo-redo.state';
import { UndoRedoActions } from './undo-redo.actions';

/**
 * Extracts the action payload from an operation payload structure.
 * Handles both wrapped format (MultiEntityPayload with actionPayload field)
 * and direct payload format (raw action properties).
 */
const extractActionPayload = (payload: unknown): Record<string, unknown> => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const payloadRecord = payload as Record<string, unknown>;
  const nestedActionPayload = payloadRecord['actionPayload'];
  if (nestedActionPayload && typeof nestedActionPayload === 'object') {
    return nestedActionPayload as Record<string, unknown>;
  }

  return payloadRecord;
};

/**
 * Merges initial subtask update changes into the create operation payload.
 * When a subtask is created with an immediate update (e.g., setting the title),
 * we fuse both operations into one create payload. This ensures redo reconstructs
 * the subtask with full field data instead of replaying create + update separately.
 *
 * IMPORTANT: This preserves all fields (title, description, etc.) during redo.
 */
const mergeInitialSubTaskUpdateIntoCreatePayload = (
  createOperation: { payload: unknown },
  updateOperation: { payload: unknown },
): unknown => {
  const createActionPayload = extractActionPayload(createOperation.payload);
  const updateActionPayload = extractActionPayload(updateOperation.payload);

  const createTask = createActionPayload['task'];
  const updateTask = updateActionPayload['task'];
  if (!createTask || typeof createTask !== 'object') {
    return createOperation.payload;
  }
  if (!updateTask || typeof updateTask !== 'object') {
    return createOperation.payload;
  }

  const updateChanges = (updateTask as Record<string, unknown>)['changes'];
  if (!updateChanges || typeof updateChanges !== 'object') {
    return createOperation.payload;
  }

  const mergedTask = {
    ...(createTask as Record<string, unknown>),
    ...(updateChanges as Record<string, unknown>),
  };
  const mergedActionPayload = {
    ...createActionPayload,
    task: mergedTask,
  };

  if (
    createOperation.payload &&
    typeof createOperation.payload === 'object' &&
    'actionPayload' in (createOperation.payload as Record<string, unknown>)
  ) {
    return {
      ...(createOperation.payload as Record<string, unknown>),
      actionPayload: mergedActionPayload,
    };
  }

  return mergedActionPayload;
};

/**
 * Reducer managing undo/redo stacks and operation coalescing.
 *
 * Key Pattern: Coalescing of TASK_ADD_SUB + immediate TASK_SHARED_UPDATE.
 * When a subtask is created and immediately updated in the same interaction,
 * we merge the operations to simplify undo/redo logic and ensure full fidelity on replay.
 */
export const undoRedoReducer = createReducer(
  initialUndoRedoState,
  on(UndoRedoActions.addToUndoStack, (state: UndoRedoState, { operation }) => {
    const previousTop = state.undoStack[0];
    const isInitialSubTaskUpdate =
      operation.actionType === ActionType.TASK_SHARED_UPDATE &&
      previousTop?.actionType === ActionType.TASK_ADD_SUB &&
      !!operation.entityId &&
      operation.entityId === previousTop.entityId;

    if (isInitialSubTaskUpdate) {
      const [top, ...rest] = state.undoStack;
      if (!top) {
        return state;
      }

      const mergedTop = {
        ...top,
        payload: mergeInitialSubTaskUpdateIntoCreatePayload(top, operation),
      };

      return {
        ...state,
        undoStack: [mergedTop, ...rest],
      };
    }

    const undoStack = [operation, ...state.undoStack];

    if (undoStack.length > state.maxHistorySize) {
      undoStack.pop();
    }

    return {
      ...state,
      undoStack,
      redoStack: [],
    };
  }),

  on(UndoRedoActions.undo, (state) => {
    if (state.undoStack.length === 0) return state;

    const [operation, ...remainingUndo] = state.undoStack;
    const redoStack = [operation, ...state.redoStack].slice(0, state.maxHistorySize);

    return { ...state, undoStack: remainingUndo, redoStack };
  }),

  on(UndoRedoActions.redo, (state) => {
    if (state.redoStack.length === 0) return state;

    const [operation, ...remainingRedo] = state.redoStack;
    const undoStack = [operation, ...state.undoStack].slice(0, state.maxHistorySize);

    return { ...state, redoStack: remainingRedo, undoStack };
  }),
);
