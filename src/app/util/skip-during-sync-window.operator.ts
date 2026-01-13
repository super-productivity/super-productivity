import { inject } from '@angular/core';
import { MonoTypeOperatorFunction } from 'rxjs';
import { filter } from 'rxjs/operators';
import { HydrationStateService } from '../op-log/apply/hydration-state.service';
import { SyncTriggerService } from '../imex/sync/sync-trigger.service';

/**
 * RxJS operator that skips emissions during the full sync window,
 * including:
 * - Initial app startup (before first sync completes)
 * - While remote operations are being applied
 * - Post-sync cooldown period
 *
 * ## Why This Exists
 *
 * There are two timing gaps where selector-based effects could fire and
 * create operations that conflict with sync:
 *
 * ### Gap 1: Initial Startup
 * 1. App loads → data loaded from IndexedDB
 * 2. Selectors evaluate → effects fire before sync happens
 * 3. Operations created with stale vector clocks
 * 4. First sync happens → conflicts with remote operations
 *
 * ### Gap 2: Post-Sync
 * 1. Tab gains focus → sync triggers
 * 2. Remote ops applied (isApplyingRemoteOps = true)
 * 3. Sync finishes, isApplyingRemoteOps = false
 * 4. Selectors immediately re-evaluate with new state
 * 5. Effects fire and create operations that conflict with just-synced state
 *
 * This operator blocks during both gaps.
 *
 * ## When to Use
 *
 * Use this operator instead of `skipWhileApplyingRemoteOps()` for selector-based effects that:
 * - Modify frequently-synced entities (TODAY_TAG, etc.)
 * - Perform "repair" or "consistency" operations
 * - Could create operations that immediately conflict with remote changes
 *
 * ## Usage
 *
 * ```typescript
 * import { skipDuringSyncWindow } from '../../../util/skip-during-sync-window.operator';
 *
 * @Injectable()
 * export class MyEffects {
 *   repairEffect$ = createEffect(() =>
 *     this.store.select(mySelector).pipe(
 *       skipDuringSyncWindow(),  // Extended suppression window
 *       // ... effect logic
 *     )
 *   );
 * }
 * ```
 *
 * ## Comparison with skipWhileApplyingRemoteOps()
 *
 * | Operator | Suppresses during | Use case |
 * |----------|-------------------|----------|
 * | skipWhileApplyingRemoteOps() | isApplyingRemoteOps only | General selector-based effects |
 * | skipDuringSyncWindow() | startup + isApplyingRemoteOps + cooldown | Effects that modify shared entities |
 */
export const skipDuringSyncWindow = <T>(): MonoTypeOperatorFunction<T> => {
  const hydrationState = inject(HydrationStateService);
  const syncTrigger = inject(SyncTriggerService);
  return filter(
    () => syncTrigger.isInitialSyncDoneSync() && !hydrationState.isInSyncWindow(),
  );
};
