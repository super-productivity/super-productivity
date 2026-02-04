import { OperatorFunction, of } from 'rxjs';
import { catchError, filter, first, map, switchMap, tap, timeout } from 'rxjs/operators';
import { HydrationStateService } from '../op-log/apply/hydration-state.service';
import { Log } from '../core/log';

const SYNC_WINDOW_TIMEOUT_MS = 30000;

/**
 * RxJS operator that **waits** for the sync window to end instead of dropping
 * the emission. Use this for effects where a dropped emission would be
 * permanently lost (e.g., day-change triggers from `todayDateStr$` which
 * emits at most once per day via `distinctUntilChanged` + `shareReplay`).
 *
 * ## Why This Exists
 *
 * `skipDuringSyncWindow()` silently drops emissions during hydration/sync.
 * For frequently-emitting sources (e.g., store selectors), that's fine —
 * the next emission will retry. But for sparse, one-shot sources like
 * day-change observables, a dropped emission means the effect never runs
 * for that day (#6192).
 *
 * This operator subscribes to `isInSyncWindow$` (a reactive observable
 * derived from Angular signals) and proceeds once the window closes.
 * A 30-second timeout ensures the pipeline never stalls permanently.
 *
 * ## Concurrency Note
 *
 * This operator uses `switchMap` internally, so if a **new** value arrives
 * while an earlier value is still waiting for the sync window to close, the
 * earlier wait is cancelled and only the latest value proceeds. This is
 * intentional for the current use case (day-change strings), where only the
 * most recent date matters. Do **not** reuse this operator for sources where
 * every emission must be preserved — use `concatMap` semantics instead.
 *
 * ## When to Use
 *
 * Use this operator instead of `skipDuringSyncWindow()` for stream-based effects
 * where the trigger source emits rarely and a missed emission cannot be recovered.
 *
 * ## Usage
 *
 * ```typescript
 * todayDateStr$.pipe(
 *   waitForSyncWindow(hydrationState, 'myEffect'),
 *   switchMap(...),
 * )
 * ```
 */
export const waitForSyncWindow = <T>(
  hydrationState: HydrationStateService,
  context: string,
): OperatorFunction<T, T> =>
  switchMap((value: T) => {
    if (!hydrationState.isInSyncWindow()) {
      return of(value);
    }
    Log.log(`[${context}] Emission during sync window, waiting...`, value);
    return hydrationState.isInSyncWindow$.pipe(
      filter((inWindow) => !inWindow),
      first(),
      timeout(SYNC_WINDOW_TIMEOUT_MS),
      tap(() => Log.log(`[${context}] Sync window ended, proceeding for:`, value)),
      map(() => value),
      catchError(() => {
        Log.err(
          `[${context}] Timed out waiting for sync window, proceeding anyway for:`,
          value,
        );
        return of(value);
      }),
    );
  });
