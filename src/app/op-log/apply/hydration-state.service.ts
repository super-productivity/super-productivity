import { computed, Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { setIsApplyingRemoteOps } from '../capture/operation-capture.meta-reducer';
import { POST_SYNC_COOLDOWN_MS } from '../core/operation-log.const';

/**
 * Failsafe for the explicit sync window. Triggers can be debounced, throttled,
 * or dropped (e.g. exhaustMap busy) before reaching `SyncWrapperService.sync()`,
 * meaning `closeSyncWindow()` may never run. The timer guarantees the window
 * cannot stay open indefinitely. 2s is well past the typical handoff to
 * `_isApplyingRemoteOps` while keeping the silent-drop window short.
 */
const SYNC_WINDOW_FAILSAFE_MS = 2000;

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
  private _isSyncWindowOpen = signal(false);
  private _cooldownTimer: ReturnType<typeof setTimeout> | null = null;
  private _syncWindowFailsafeTimer: ReturnType<typeof setTimeout> | null = null;
  /**
   * True when selector-based effects that modify shared state (e.g. TODAY_TAG
   * repair) should be suppressed. Three phases contribute:
   *
   * 1. **Open**: `openSyncWindow()` is called by `SyncTriggerService` the
   *    moment a sync is triggered (e.g. `I_RESUME_APP`), *before* the trigger
   *    pipeline's `debounceTime(100)`. Closes the race on app resume where
   *    the visibility-change → DAY_CHANGE → TODAY_TAG-repair cascade fires
   *    inside that debounce window and emits ops on stale local state.
   * 2. **Applying**: remote ops are being replayed into the store.
   * 3. **Cooldown**: short post-sync window for state to settle.
   *
   * Use `skipDuringSyncWindow()` (drop) or `waitForSyncWindow()` (defer).
   */
  isInSyncWindow = computed(
    () =>
      this._isSyncWindowOpen() ||
      this._isApplyingRemoteOps() ||
      this._isInPostSyncCooldown(),
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

  /**
   * Opens the sync window. Restartable: each call resets the failsafe timer.
   *
   * Failsafe ensures the window auto-closes if no `closeSyncWindow()` follows
   * (e.g. trigger debounced, throttled, or dropped before reaching `sync()`).
   *
   * Pass `failsafeMs: 0` to skip the timer entirely. Use this when the caller
   * has its own deterministic close path (`SyncWrapperService.sync()`'s
   * `finally` block) and the timer would otherwise close the window
   * prematurely during a slow sync (longer than the default 2s).
   */
  openSyncWindow(failsafeMs: number = SYNC_WINDOW_FAILSAFE_MS): void {
    this._isSyncWindowOpen.set(true);

    if (this._syncWindowFailsafeTimer) {
      clearTimeout(this._syncWindowFailsafeTimer);
      this._syncWindowFailsafeTimer = null;
    }
    if (failsafeMs > 0) {
      this._syncWindowFailsafeTimer = setTimeout(() => {
        this._isSyncWindowOpen.set(false);
        this._syncWindowFailsafeTimer = null;
      }, failsafeMs);
    }
  }

  /** Closes the sync window and clears the failsafe timer. */
  closeSyncWindow(): void {
    if (this._syncWindowFailsafeTimer) {
      clearTimeout(this._syncWindowFailsafeTimer);
      this._syncWindowFailsafeTimer = null;
    }
    this._isSyncWindowOpen.set(false);
  }
}
