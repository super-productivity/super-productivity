import { inject, InjectionToken } from '@angular/core';
import { Actions } from '@ngrx/effects';
import { Action } from '@ngrx/store';
import { Observable } from 'rxjs';
import { filter, share } from 'rxjs/operators';
import { isReducerRejectedAction } from '../root-store/meta/reducer-failure-guard.meta-reducer';

/**
 * DEFAULT: Injection token for Actions stream filtered to local user actions only.
 *
 * This should be used by ALL effects as the standard replacement for `inject(Actions)`.
 *
 * ## How It Works
 *
 * Remote sync operations are applied via `bulkApplyOperations`, which is intercepted
 * by `bulkOperationsMetaReducer`. This means:
 * - Effects don't see individual remote actions (they only see `bulkApplyOperations`)
 * - Most effects naturally don't trigger because they filter by specific action types
 *
 * However, some effects might still be triggered by `bulkApplyOperations` itself
 * (if they listen for that action type), so this token provides an additional
 * safety layer by filtering out actions marked with `meta.isRemote`.
 *
 * ## Why Filter Rejected Actions? (#10195)
 *
 * `reducerFailureGuardMetaReducer` boxes reducer throws and returns the previous
 * state. NgRx still emits the action on `Actions`, so without this filter an
 * `ofType` effect would run side effects (snacks, follow-up dispatches,
 * persistence derived from the payload) for a state change that never happened.
 *
 * ## Why Filter Remote Actions?
 *
 * When actions come from remote sync or hydration:
 * - Reducers should run (to update state) ✓
 * - Effects should NOT run because:
 *   1. UI side effects (snacks, sounds) already happened on original client
 *   2. Cascading actions are already in the operation log as separate entries
 *
 * @example
 * ```typescript
 * @Injectable()
 * export class MyEffects {
 *   private _actions$ = inject(LOCAL_ACTIONS); // Use this as default
 *
 *   myEffect$ = createEffect(() =>
 *     this._actions$.pipe(
 *       ofType(SomeAction),
 *       // This effect only runs for local user actions
 *     )
 *   );
 * }
 * ```
 */
export const LOCAL_ACTIONS = new InjectionToken<Observable<Action>>('LOCAL_ACTIONS', {
  providedIn: 'root',
  factory: () => {
    const actions$ = inject(Actions);
    return actions$.pipe(
      filter(
        (action: Action) =>
          !(action as any).meta?.isRemote && !isReducerRejectedAction(action),
      ),
      share(),
    );
  },
});

/**
 * SPECIAL CASE: Unfiltered Actions stream including remote sync operations.
 *
 * Only use this for effects that MUST see what LOCAL_ACTIONS filters out:
 * - operation-log.effects.ts: Captures and persists all actions (handles isRemote internally)
 * - reducer-failure-snack.effects.ts: Surfaces actions the reducer rejected (#10195)
 *
 * For all other effects, use LOCAL_ACTIONS instead. Note: remote-client
 * archive side effects are NOT an ALL_ACTIONS case — they are driven by
 * OperationApplierService -> ArchiveOperationHandler, and
 * archive-operation-handler.effects.ts itself uses LOCAL_ACTIONS.
 */
export const ALL_ACTIONS = new InjectionToken<Observable<Action>>('ALL_ACTIONS', {
  providedIn: 'root',
  factory: () => inject(Actions),
});
