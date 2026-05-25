// Avoids the performance issues caused by normal setInterval when the user
// is not at the computer for some time. Schedules the next tick only after
// the current callback (sync or async) completes, preventing overlapping
// invocations.
export const lazySetInterval = (
  func: () => void | Promise<void>,
  intervalDuration: number,
): (() => void) => {
  let lastTimeoutId: ReturnType<typeof setTimeout>;
  let stopped = false;

  const tick = async (): Promise<void> => {
    try {
      await func();
    } catch (err) {
      console.error('[lazy-set-interval] callback error:', err);
    } finally {
      if (!stopped) {
        lastTimeoutId = setTimeout(tick, intervalDuration);
      }
    }
  };

  lastTimeoutId = setTimeout(tick, intervalDuration);

  return () => {
    stopped = true;
    clearTimeout(lastTimeoutId);
  };
};
