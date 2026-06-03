/**
 * Shared flag indicating that a `bulkApplyOperations` pass is mid-flight, i.e. a
 * batch of ops is being applied in a single synchronous reducer pass (startup
 * hydration replay or remote-sync apply).
 *
 * While the flag is set, the action logger skips its per-op console line.
 * Without this, one bulk dispatch prints one `[a]<type>` line per op — e.g. 344
 * lines for a single hydration replay — which reads as "hundreds of dispatches"
 * when it is really one reducer pass. The callers (hydrator / applier) already
 * log a single "applying N ops" summary, so nothing is lost.
 *
 * The flag is set synchronously around the bulk loop, so it is always accurate
 * by the time the inner reducer chain (including the action logger) runs.
 *
 * Intentionally separate from HydrationStateService.isApplyingRemoteOps: that flag
 * stays set across the whole (async) remote-apply window, so reusing it here would
 * also suppress logging for unrelated actions dispatched in that wider window. This
 * flag is scoped to the synchronous bulk reducer loop only, so it suppresses exactly
 * the per-op replay lines and nothing else.
 */
let isSuppressed = false;

/**
 * Runs `fn` with bulk-replay log suppression active. Restores the previous value
 * afterwards (reentrancy-safe), so nested bulk passes behave correctly.
 */
export const runWithBulkReplayLoggingSuppressed = <T>(fn: () => T): T => {
  const prev = isSuppressed;
  isSuppressed = true;
  try {
    return fn();
  } finally {
    isSuppressed = prev;
  }
};

export const isBulkReplayLoggingSuppressed = (): boolean => isSuppressed;
