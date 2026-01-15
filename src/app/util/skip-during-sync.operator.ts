import { inject } from '@angular/core';
import { MonoTypeOperatorFunction } from 'rxjs';
import { filter } from 'rxjs/operators';
import { HydrationStateService } from '../op-log/apply/hydration-state.service';

/**
 * RxJS operator that skips emissions while remote operations are being applied
 * to the store (during hydration/sync replay).
 *
 * ## Why This Exists
 *
 * Selector-based effects (those using `this.store.select(...)`) fire whenever
 * the store changes, including during hydration and sync replay. This can cause:
 *
 * 1. **Ghost Operations**: Creating new operations based on intermediate states
 * 2. **Unwanted Side Effects**: Banners, sounds, or notifications during background sync
 * 3. **Performance Issues**: Unnecessary processing during bulk updates
 *
 * Unlike action-based effects (which use `LOCAL_ACTIONS` to filter remote actions),
 * selector-based effects need explicit guarding.
 *
 * ## Usage
 *
 * ```typescript
 * import { skipWhileApplyingRemoteOps } from '../../../util/skip-during-sync.operator';
 *
 * @Injectable()
 * export class MyEffects {
 *   myEffect$ = createEffect(() =>
 *     this.store.select(mySelector).pipe(
 *       skipWhileApplyingRemoteOps(),  // <-- Add this to guard selector-based effects
 *       tap(...),
 *     )
 *   );
 * }
 * ```
 *
 * ## When to Use
 *
 * Use this operator on selector-based effects that:
 * - Dispatch actions (would create duplicate operations during sync)
 * - Trigger UI side effects (banners, sounds, notifications)
 * - Start timers or async processes
 *
 * ## Implementation Note
 *
 * This operator uses Angular's `inject()` function internally. It works because
 * `createEffect()` is called during class field initialization, which is still
 * within an injection context.
 */
export const skipWhileApplyingRemoteOps = <T>(): MonoTypeOperatorFunction<T> => {
  const hydrationState = inject(HydrationStateService);
  return filter(() => !hydrationState.isApplyingRemoteOps());
};

/**
 * @deprecated Use `skipWhileApplyingRemoteOps` instead. This alias exists for backwards compatibility.
 */
export const skipDuringSync = skipWhileApplyingRemoteOps;
