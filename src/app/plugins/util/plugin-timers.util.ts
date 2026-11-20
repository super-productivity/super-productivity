/** Timer functions handed to plugin code in place of the window globals. */
export interface PluginTimers {
  setTimeout: typeof setTimeout;
  setInterval: typeof setInterval;
  clearTimeout: typeof clearTimeout;
  clearInterval: typeof clearInterval;
}

/**
 * Create timer functions that remember what a plugin scheduled, so `dispose()`
 * can stop every pending timer when the plugin is unloaded — plugin code runs
 * in the renderer and its timers outlive the unload otherwise (#8281).
 * After `dispose()` nothing new is scheduled.
 *
 * shortcut: only covers the shadowed globals — `window.setInterval` and
 * listeners bypass it; full containment needs plugins in a worker/iframe.
 */
export const createPluginTimers = (): { timers: PluginTimers; dispose: () => void } => {
  const pending = new Set<number>();
  let isDisposed = false;

  const clear = (id?: number): void => {
    if (id !== undefined) {
      pending.delete(id);
    }
    window.clearTimeout(id);
  };

  const timers = {
    setTimeout: (handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (isDisposed) {
        return 0;
      }
      const id = window.setTimeout(
        typeof handler === 'function'
          ? (...cbArgs: unknown[]) => {
              pending.delete(id);
              handler(...cbArgs);
            }
          : handler,
        ms,
        ...args,
      );
      pending.add(id);
      return id;
    },
    setInterval: (handler: TimerHandler, ms?: number, ...args: unknown[]) => {
      if (isDisposed) {
        return 0;
      }
      const id = window.setInterval(handler, ms, ...args);
      pending.add(id);
      return id;
    },
    clearTimeout: clear,
    clearInterval: clear,
    // cast: the DOM/Node overloads of the globals can't be matched structurally
  } as unknown as PluginTimers;

  const dispose = (): void => {
    isDisposed = true;
    pending.forEach((id) => window.clearTimeout(id));
    pending.clear();
  };

  return { timers, dispose };
};
