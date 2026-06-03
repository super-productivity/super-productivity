import { LS } from '../core/persistence/storage-keys.const';

/**
 * Device-local, content-free "the app failed the user" signal: written on an
 * unhandled error (see GlobalErrorHandler) or any detected data damage (failed
 * state validation / data repair). Read by the rating prompt so we never ask
 * for a review right after a crash or data loss. Stores only a timestamp — no
 * error text, no user data — and lives in localStorage, which is excluded from
 * sync exports.
 */
export const recordCriticalErrorTime = (): void => {
  try {
    localStorage.setItem(LS.LAST_CRITICAL_ERROR_TIME, Date.now().toString());
  } catch {
    // localStorage may be unavailable (private mode / quota). This is a
    // best-effort UX signal and must never throw from an error/repair path.
  }
};

/**
 * Ms elapsed since the last recorded critical error, or +Infinity if none.
 * A missing/garbage/future timestamp is treated as "no recent error" so a
 * corrupt value can never permanently suppress the rating prompt.
 */
export const getMsSinceLastCriticalError = (): number => {
  const raw = localStorage.getItem(LS.LAST_CRITICAL_ERROR_TIME);
  const time = raw ? +raw : 0;
  if (!Number.isFinite(time) || time <= 0) return Number.POSITIVE_INFINITY;
  const elapsed = Date.now() - time;
  return elapsed >= 0 ? elapsed : Number.POSITIVE_INFINITY;
};
