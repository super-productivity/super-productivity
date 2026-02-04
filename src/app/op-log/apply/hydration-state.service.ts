import { computed, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { setIsApplyingRemoteOps } from '../capture/operation-capture.meta-reducer';
import { POST_SYNC_COOLDOWN_MS } from '../core/operation-log.const';

/**
 * Tracks whether the application is currently applying remote operations
 * (hydration replay or sync). This allows selector-based effects to skip
 * processing during these phases.
 *
 * ## Why This Exists
 *
 * Action-based effects use `LOCAL_ACTIONS` to filter out remote operations.
 * However, selector-based effects (which subscribe to store selectors directly)
 * don't have this filtering - they fire whenever the store changes.
 *
 * During hydration/sync replay, we dispatch many actions rapidly. Without
 * suppression, selector-based effects would:
 * 1. Fire for each state change
 * 2. Create new operations (captured by OperationCaptureService)
 * 3. Cause performance issues and duplicate operations
 *
 * ## Usage
 *
 * ```typescript
 * @Injectable()
 * export class MyEffects {
 *   private hydrationState = inject(HydrationStateService);
 *
 *   mySelectorBasedEffect$ = createEffect(() =>
 *     this.store.select(mySelector).pipe(
 *       filter(() => !this.hydrationState.isApplyingRemoteOps()),
 *       // ... rest of effect
 *     )
 *   );
 * }
 * ```
 *
 * ## Preventing Superseded Operations During Sync
 *
 * This service also notifies the operation capture meta-reducer to skip
 * capturing user interactions during sync. This prevents the "slow device
 * cascade" problem where user actions during sync create operations with
 * superseded vector clocks that immediately conflict.
 *
 * ## Post-Sync Cooldown
 *
 * When effects use `skipDuringSyncWindow()` operator, they are suppressed not
 * only during op application but also for a short cooldown period after sync.
 * This prevents the timing gap where selectors re-evaluate with new state and
 * effects fire immediately, creating conflicting operations. See `isInSyncWindow`.
 */
@Injectable({ providedIn: 'root' })
export class HydrationStateService {
  private _isApplyingRemoteOps = signal(false);
  private _isInPostSyncCooldown = signal(false);
  private _cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * Computed signal: true when in the extended sync window where selector-based
   * effects that modify shared state (like TODAY_TAG) should be suppressed.
   *
   * This includes:
   * - During remote op application (isApplyingRemoteOps)
   * - During post-sync cooldown period
   *
   * Use `skipDuringSyncWindow()` operator for effects that should be
   * suppressed during this extended window.
   */
  isInSyncWindow = computed(
    () => this._isApplyingRemoteOps() || this._isInPostSyncCooldown(),
  );

  /**
   * Observable that emits whenever the sync window state changes.
   * Emits `true` while in the sync window, `false` when it ends.
   * Use with `waitForSyncWindow()` operator for effects that must
   * defer (not drop) emissions during sync.
   */
  isInSyncWindow$ = toObservable(this.isInSyncWindow);

  /**
   * Returns true if remote operations are currently being applied.
   * Use this to guard selector-based effects.
   */
  isApplyingRemoteOps(): boolean {
    return this._isApplyingRemoteOps();
  }

  /**
   * Marks the start of remote operation application.
   * Called by OperationApplierService before applying operations.
   *
   * Also notifies the meta-reducer to skip capturing local operations
   * during this time to prevent superseded vector clocks.
   */
  startApplyingRemoteOps(): void {
    this._isApplyingRemoteOps.set(true);
    setIsApplyingRemoteOps(true);
  }

  /**
   * Marks the end of remote operation application.
   * Called by OperationApplierService after applying operations.
   *
   * Re-enables operation capturing for local operations.
   */
  endApplyingRemoteOps(): void {
    this._isApplyingRemoteOps.set(false);
    setIsApplyingRemoteOps(false);
  }

  /**
   * Starts a cooldown period after sync completes.
   * During this window, `isInSyncWindow` signal returns true.
   *
   * This prevents the timing gap where:
   * 1. Sync finishes, isApplyingRemoteOps = false
   * 2. Selectors immediately re-evaluate with new state
   * 3. Effects fire and create operations conflicting with just-synced state
   *
   * The cooldown ensures effects don't fire until state has stabilized.
   */
  startPostSyncCooldown(durationMs: number = POST_SYNC_COOLDOWN_MS): void {
    this._isInPostSyncCooldown.set(true);

    if (this._cooldownTimer) {
      clearTimeout(this._cooldownTimer);
    }

    this._cooldownTimer = setTimeout(() => {
      this._isInPostSyncCooldown.set(false);
      this._cooldownTimer = null;
    }, durationMs);
  }

  /**
   * Clears the post-sync cooldown timer.
   * Used for cleanup during testing.
   */
  clearPostSyncCooldown(): void {
    if (this._cooldownTimer) {
      clearTimeout(this._cooldownTimer);
      this._cooldownTimer = null;
    }
    this._isInPostSyncCooldown.set(false);
  }
}
