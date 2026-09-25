import { Action, ActionReducer } from '@ngrx/store';
import { devError } from '../../util/dev-error';
import { Log } from '../../core/log';

/**
 * Actions whose reducer pass threw. Keyed by action instance (WeakSet, so
 * nothing is retained) rather than by mutating the action, which would break
 * NgRx action serializability.
 */
const rejectedActions = new WeakSet<Action>();

/**
 * True when the reducer chain threw for this action instance (#10195). No
 * state change was committed, so the persist effect must not build an
 * operation from its payload and `LOCAL_ACTIONS` must not feed it to effects.
 */
export const isReducerRejectedAction = (action: Action): boolean =>
  rejectedActions.has(action);

/**
 * Boxes every reducer pass so one throwing reducer cannot freeze the store
 * (#10195).
 *
 * NgRx runs reducers inside the State pipeline's `scan`; rxjs diverts a throw
 * into the observable error channel, `store.dispatch()` returns normally, the
 * State subscription is torn down and EVERY later dispatch is silently dropped
 * — including bulk-applied remote ops that the op log already marks applied.
 * Catching inside the reducer chain is the only place the failure can be
 * observed while keeping the pipeline alive.
 *
 * Must be the OUTERMOST meta-reducer: `operationCaptureMetaReducer` calls the
 * inner chain before `incrementPending`, so a throw passes through it without
 * touching the pending counter, and the inner `loadAllData` / bulk-hydration
 * failure collectors catch first and keep their own semantics.
 *
 * This is not a repair mechanism: the action is dropped, the user sees an
 * error (devError: dialog in dev, logged in prod), the pre-dispatch state is
 * kept. Nothing is retried.
 */
export const reducerFailureGuardMetaReducer = <S>(
  reducer: ActionReducer<S>,
): ActionReducer<S> => {
  return (state: S | undefined, action: Action): S => {
    try {
      return reducer(state, action);
    } catch (error) {
      if (state === undefined) {
        // Reachable, not dead: NgRx normalises `state ?? initialState` OUTSIDE
        // the meta-reducer chain, and main.ts calls StoreModule.forRoot with no
        // initialState — so `@ngrx/store/init` reaches this guard with
        // undefined. There is no previous state to keep, and handing the app
        // `undefined` as root state would make every selector misread it, so a
        // failure to build the initial state stays fatal.
        throw error;
      }
      rejectedActions.add(action);
      // Never log the payload: log history is exportable (no user content).
      Log.err('reducerFailureGuardMetaReducer: reducer threw, action rejected', {
        actionType: action.type,
      });
      try {
        devError(error);
      } catch (devModeThrow) {
        // devError's dev-only "Throw an error?" prompt throws when confirmed.
        // From here that throw would escape the box and tear down the State
        // scan — the exact freeze this guard exists to prevent. The developer
        // still gets it, just off the reducer stack (window.onerror →
        // Angular's ErrorHandler).
        setTimeout(() => {
          throw devModeThrow;
        });
      }
      // A throwing reducer produces no state update, so the pre-dispatch state
      // is the correct result.
      return state;
    }
  };
};
