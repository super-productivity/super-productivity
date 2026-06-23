import { createReducer, on } from '@ngrx/store';
import { ActionType, extractActionPayload } from '../../op-log/core/operation.types';
import { UndoRedoState, initialUndoRedoState } from './undo-redo.state';
import { UndoRedoActions } from './undo-redo.actions';
import { loadAllData } from '../meta/load-all-data.action';

/**
 * Merges initial subtask update changes into the create operation payload.
 * When a subtask is created with an immediate update (e.g., setting the title),
 * we fuse both operations into one create payload. This ensures snackbar restore
 * reconstructs the subtask with full field data.
 *
 * IMPORTANT: This preserves all fields (title, description, etc.) during restore.
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

const removeUndoPayload = (
  undoPayloadByOperationId: Record<string, unknown>,
  operationId: string,
): Record<string, unknown> => {
  return Object.fromEntries(
    Object.entries(undoPayloadByOperationId).filter(([id]) => id !== operationId),
  );
};

/**
 * Reducer managing undo history and operation coalescing.
 *
 * Key Pattern: Coalescing of TASK_ADD_SUB + immediate TASK_SHARED_UPDATE.
 * When a subtask is created and immediately updated in the same interaction,
 * we merge the operations to simplify undo logic and ensure full fidelity on restore.
 */
export const undoRedoReducer = createReducer(
  initialUndoRedoState,
  on(
    UndoRedoActions.addToUndoStack,
    (state: UndoRedoState, { operation, undoPayload }) => {
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

        const nextUndoPayloadByOperationId = state.lastUndoneOperation
          ? removeUndoPayload(
              state.undoPayloadByOperationId,
              state.lastUndoneOperation.id,
            )
          : state.undoPayloadByOperationId;

        return {
          ...state,
          undoStack: [mergedTop, ...rest],
          undoPayloadByOperationId: nextUndoPayloadByOperationId,
          lastUndoneOperation: null,
        };
      }

      const payloadsWithoutInvalidatedRestore = state.lastUndoneOperation
        ? removeUndoPayload(state.undoPayloadByOperationId, state.lastUndoneOperation.id)
        : state.undoPayloadByOperationId;
      const undoStack = [operation, ...state.undoStack];
      const nextUndoPayloadByOperationId =
        undoPayload !== undefined
          ? {
              ...payloadsWithoutInvalidatedRestore,
              [operation.id]: undoPayload,
            }
          : payloadsWithoutInvalidatedRestore;

      if (undoStack.length > state.maxHistorySize) {
        const removedOperation = undoStack.pop();
        if (removedOperation?.id && removedOperation.id in nextUndoPayloadByOperationId) {
          const remainingUndoPayloads = removeUndoPayload(
            nextUndoPayloadByOperationId,
            removedOperation.id,
          );

          return {
            ...state,
            undoStack,
            undoPayloadByOperationId: remainingUndoPayloads,
            lastUndoneOperation: null,
          };
        }
      }

      return {
        ...state,
        undoStack,
        undoPayloadByOperationId: nextUndoPayloadByOperationId,
        lastUndoneOperation: null,
      };
    },
  ),

  on(UndoRedoActions.undo, (state) => {
    if (state.undoStack.length === 0) return state;

    const [operation, ...remainingUndo] = state.undoStack;

    return {
      ...state,
      undoStack: remainingUndo,
      lastUndoneOperation: operation,
    };
  }),

  on(UndoRedoActions.restoreLastUndoneOperation, (state) => {
    if (!state.lastUndoneOperation) return state;

    const undoStack = [state.lastUndoneOperation, ...state.undoStack].slice(
      0,
      state.maxHistorySize,
    );

    return {
      ...state,
      undoStack,
      lastUndoneOperation: null,
    };
  }),

  on(UndoRedoActions.clearLastUndoneOperation, (state) => {
    if (!state.lastUndoneOperation) return state;

    return {
      ...state,
      undoPayloadByOperationId: removeUndoPayload(
        state.undoPayloadByOperationId,
        state.lastUndoneOperation.id,
      ),
      lastUndoneOperation: null,
    };
  }),

  on(loadAllData, (state) => ({
    ...state,
    undoStack: [],
    undoPayloadByOperationId: {},
    lastUndoneOperation: null,
  })),
);
