import { Action, ActionReducer } from '@ngrx/store';
import { bulkApplyOperations } from './bulk-hydration.action';
import { convertOpToAction } from './operation-converter.util';

/**
 * Meta-reducer that applies multiple operations in a single reducer pass.
 *
 * Used for:
 * - Local hydration: Apply tail operations at startup
 * - Remote sync: Apply operations from other clients
 *
 * Instead of dispatching 500 individual actions (which causes 500 store updates),
 * this meta-reducer applies all operations in one dispatch.
 *
 * The approach works because:
 * 1. Each operation is converted to its NgRx action via convertOpToAction()
 * 2. Each action goes through the full reducer chain (including meta-reducers)
 * 3. Final state is returned after all operations are applied
 *
 * Key benefit for remote sync: Effects don't see individual actions because they
 * only see the bulk action type, which no effect listens for. This eliminates
 * the need for LOCAL_ACTIONS filtering on action-based effects.
 *
 * Performance impact: 500 dispatches → 1 dispatch = ~10-50x faster
 *
 * IMPORTANT considerations:
 * - Meta-reducer order is critical: this MUST be positioned AFTER
 *   operationCaptureMetaReducer in the metaReducers array (see main.ts).
 *   This ensures converted actions don't get re-captured.
 * - The synchronous loop could block the main thread for 10,000+ operations.
 *   Not tested at that scale. If needed, consider chunking with requestIdleCallback.
 */
export const bulkOperationsMetaReducer = <T>(
  reducer: ActionReducer<T>,
): ActionReducer<T> => {
  return (state: T | undefined, action: Action): T => {
    if (action.type === bulkApplyOperations.type) {
      const { operations } = action as ReturnType<typeof bulkApplyOperations>;

      let currentState = state;
      for (const op of operations) {
        const opAction = convertOpToAction(op);
        currentState = reducer(currentState, opAction);
      }
      return currentState as T;
    }
    return reducer(state, action);
  };
};

/**
 * @deprecated Use bulkOperationsMetaReducer instead. Kept for backwards compatibility.
 */
export const bulkHydrationMetaReducer = bulkOperationsMetaReducer;
