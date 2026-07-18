import { Action, ActionReducer } from '@ngrx/store';
import { loadAllData } from '../../root-store/meta/load-all-data.action';

type LoadAllDataFailureCollector = (error: Error) => void;

let activeFailureCollector: LoadAllDataFailureCollector | undefined;

/**
 * Scopes `loadAllData` reducer-failure reporting to one synchronous NgRx
 * dispatch (#9140). Mirrors `runWithBulkReplayFailureCollector`: keeping the
 * collector outside the action preserves NgRx action serializability, and
 * reducers run synchronously, so the collector is always restored before
 * dispatch returns.
 */
export const runWithLoadAllDataFailureCollector = <T>(
  collector: LoadAllDataFailureCollector,
  run: () => T,
): T => {
  const previousCollector = activeFailureCollector;
  activeFailureCollector = collector;
  try {
    return run();
  } finally {
    activeFailureCollector = previousCollector;
  }
};

export const reportLoadAllDataReducerFailure = (error: unknown): void => {
  activeFailureCollector?.(error instanceof Error ? error : new Error(String(error)));
};

/**
 * Converts a reducer throw on `loadAllData` into a collected failure while a
 * collector is active (#9140).
 *
 * Without this, a feature reducer that dereferences a missing required field
 * in old snapshot state throws THROUGH `store.dispatch()` during hydration,
 * which both escalates into disaster recovery (which refuses while a snapshot
 * exists on disk → empty store on every boot) and errors the NgRx state
 * observable, leaving a store that silently ignores every later dispatch.
 * Returning the previous state keeps the store alive so the hydrator can fall
 * back to replaying the op-log instead.
 *
 * Outside an active collector (every non-hydration dispatch) this is a pure
 * pass-through: reducer errors propagate exactly as before.
 */
export const loadAllDataFailureGuardMetaReducer = <T>(
  reducer: ActionReducer<T>,
): ActionReducer<T> => {
  return (state: T | undefined, action: Action): T => {
    if (activeFailureCollector === undefined || action.type !== loadAllData.type) {
      return reducer(state, action);
    }
    try {
      return reducer(state, action);
    } catch (error) {
      reportLoadAllDataReducerFailure(error);
      // A throwing reducer produces no state update, so the pre-dispatch state
      // (the NgRx initial state during boot hydration) is the correct result.
      return state as T;
    }
  };
};
