/**
 * Generic retry helper for "ping until ready" semantics.
 *
 * Used by PluginService to wait for the Node.js IPC bridge to come up on cold
 * boot before firing plugin onReady callbacks. Pure function — no Angular DI,
 * no side effects beyond the supplied pingFn.
 *
 * Returns true if any attempt succeeds, false if all attempts fail.
 *
 * @param pingFn function that performs a single ping (returns true on success)
 * @param retryDelays milliseconds to wait between attempts; total attempt count
 *   is retryDelays.length + 1 (one immediate attempt + one per delay)
 */
export const pingWithRetry = async (
  pingFn: () => Promise<boolean>,
  retryDelays: readonly number[] = [1000, 2000],
): Promise<boolean> => {
  const maxAttempts = retryDelays.length + 1;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (await pingFn()) {
      return true;
    }
    if (attempt < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelays[attempt - 1]));
    }
  }
  return false;
};
