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
 * For sources that keep re-emitting the same state (a repeating timer tick),
 * that's fine — the next emission retries. But for sparse or edge-triggered
 * sources, a dropped emission means the effect never runs at all: for a
 * day-change observable, not for that day (#6192); for `selectIsIdle`, not for
 * that idle episode — and there the store stays latched at `isIdle: true`, so
 * the producer short-circuits and idle handling dies for the session (#9348).
 *
 * ⚠️ Do not assume a store selector is safe to drop. `store.select()` ends in
 * `distinctUntilChanged()`, so a dropped emission is NOT retried until the
 * value changes again — and the emissions this guard drops are precisely the
 * ones caused by remote ops, which have already settled by the time the window
 * closes. Judge the source, not its type.
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
    // `value` is the caller's `T` and may be a whole entity — the log is
    // exportable, and `context` already identifies the stream.
    Log.log(`[${context}] Emission during sync window, waiting...`);
    return hydrationState.isInSyncWindow$.pipe(
      filter((inWindow) => !inWindow),
      first(),
      timeout(SYNC_WINDOW_TIMEOUT_MS),
      tap(() => Log.log(`[${context}] Sync window ended, proceeding`)),
      map(() => value),
      catchError(() => {
        Log.err(`[${context}] Timed out waiting for sync window, proceeding anyway`);
        return of(value);
      }),
    );
  });
