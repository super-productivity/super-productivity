import { inject } from '@angular/core';
import { MonoTypeOperatorFunction, of, timer } from 'rxjs';
import { debounce } from 'rxjs/operators';
import { SyncTriggerService } from '../imex/sync/sync-trigger.service';

/**
 * RxJS operator that debounces emissions during startup, then passes through immediately.
 *
 * ## Why This Exists
 *
 * Unlike `skipDuringSyncWindow()` which completely skips emissions during startup,
 * this operator allows emissions through after a debounce period. Use this for
 * effects that:
 * - Should eventually run during startup (not be skipped entirely)
 * - But should wait for state to settle before firing
 *
 * ## How It Works
 *
 * - Before `setInitialSyncDone(true)`: Emissions are debounced by `debounceMs`
 * - After `setInitialSyncDone(true)`: Emissions pass through immediately (0ms debounce)
 *
 * ## When to Use
 *
 * Use `debounceDuringStartup()` for effects that:
 * - Need to run during startup but can wait
 * - Should let state settle before reacting
 * - Are not sync-sensitive (won't conflict with remote operations)
 *
 * Use `skipDuringSyncWindow()` instead for effects that:
 * - Modify shared entities (TODAY_TAG, etc.)
 * - Could create operations that conflict with sync
 * - Should never run before sync completes
 *
 * ## Usage
 *
 * ```typescript
 * import { debounceDuringStartup } from '../../../util/debounce-during-startup.operator';
 *
 * @Injectable()
 * export class MyEffects {
 *   startupEffect$ = createEffect(() =>
 *     this.store.select(mySelector).pipe(
 *       debounceDuringStartup(500),  // Debounce 500ms during startup
 *       // ... effect logic
 *     )
 *   );
 * }
 * ```
 *
 * @param debounceMs Debounce time in milliseconds during startup (default: 500ms)
 */
export const debounceDuringStartup = <T>(
  debounceMs = 500,
): MonoTypeOperatorFunction<T> => {
  const syncTrigger = inject(SyncTriggerService);

  return debounce(() =>
    syncTrigger.isInitialSyncDoneSync() ? of(0) : timer(debounceMs),
  );
};
