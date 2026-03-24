// avoids the performance issues caused by normal set interval, when the user
// is not at the computer for some time
export const lazySetInterval = (
  func: () => void | Promise<void>,
  intervalDuration: number,
): (() => void) => {
  let lastTimeoutId: any;
  let running = false;

  const interval = (): void => {
    if (running) {
      // Previous invocation still running; skip this tick and schedule next
      lastTimeoutId = setTimeout(interval, intervalDuration);
      return;
    }

    running = true;
    try {
      const result = func.call(null);
      // If the callback is async, wait for it to finish before scheduling next
      if (result && typeof (result as Promise<void>).then === 'function') {
        (result as Promise<void>)
          .catch((err) => console.error('[lazy-set-interval] async callback error:', err))
          .finally(() => {
            running = false;
            lastTimeoutId = setTimeout(interval, intervalDuration);
          });
      } else {
        running = false;
        lastTimeoutId = setTimeout(interval, intervalDuration);
      }
    } catch (err) {
      console.error('[lazy-set-interval] sync callback error:', err);
      running = false;
      lastTimeoutId = setTimeout(interval, intervalDuration);
    }
  };

  lastTimeoutId = setTimeout(interval, intervalDuration);

  return () => {
    clearTimeout(lastTimeoutId);
  };
};
