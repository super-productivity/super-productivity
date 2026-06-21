import { Action, ActionReducer } from '@ngrx/store';

import { RootState } from '../root-state';
import { isCompensatingAction } from '../../op-log/core/persistent-action.interface';
import { taskDeleteUndoPayloadBuilder } from './undo-task-delete.meta-reducer';
import { taskUpdateUndoPayloadBuilder } from './undo-task-update.meta-reducer';

export const UNDO_OPERATION_PAYLOAD_KEY = 'undoPayload';

export interface UndoPayloadBuilder {
  actionType: string;
  build: (state: RootState, action: Action) => unknown | null;
}

const undoPayloadBuilders: ReadonlyArray<UndoPayloadBuilder> = [
  taskDeleteUndoPayloadBuilder,
  taskUpdateUndoPayloadBuilder,
];
const undoPayloadByAction = new WeakMap<Action, unknown>();

export const getUndoPayloadForAction = (action: Action): unknown | null =>
  undoPayloadByAction.get(action) ?? null;

export const clearUndoPayloadForAction = (action: Action): void => {
  undoPayloadByAction.delete(action);
};

/**
 * Captures operation-specific undo payloads before reducers mutate the state.
 *
 * Builders keep operation-specific knowledge isolated. OperationLogEffects later
 * stores the captured payload only in the in-memory undo state.
 */
export const undoOperationPayloadMetaReducer = <T, V extends Action = Action>(
  reducer: ActionReducer<T, V>,
): ActionReducer<T, V> => {
  return (state: T | undefined, action: V): T => {
    const builder = undoPayloadBuilders.find(
      ({ actionType }) => actionType === action.type,
    );

    if (builder && state && !isCompensatingAction(action)) {
      const payload = builder.build(state as unknown as RootState, action);
      if (payload !== null) {
        undoPayloadByAction.set(action, payload);
      }
    }

    return reducer(state, action);
  };
};
