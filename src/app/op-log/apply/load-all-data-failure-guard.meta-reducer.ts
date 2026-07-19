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
 * in old snapshot state does NOT surface at the dispatch call site: NgRx runs
 * reducers inside the State pipeline's `scan`, so rxjs diverts the throw into
 * the observable error channel — `store.dispatch()` returns normally, the
 * error resurfaces only as an ASYNC unhandled-error report, and the State
 * subscription is torn down. The store silently freezes: every later dispatch
 * (including any recovery replay) is dropped without a trace. Catching INSIDE
 * the reducer chain is the only place the failure can be observed while
 * keeping the pipeline alive.
 *
 * NOTE: because the guarded dispatch completes normally, `ofType(loadAllData)`
 * effects still fire with the REJECTED payload even though no state was
 * committed. Current listeners only seed runtime side state (DateService
 * start-of-day, shortcuts, polling) and are benign; a future loadAllData
 * effect must not persist anything derived from the action payload without
 * reading it back from the store.
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
