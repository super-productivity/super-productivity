/**
 * iOS brackets each keyboard animation with a `will…`/`did…` pair and drops the
 * `did` half often enough that nothing may hang on it alone: with
 * `keyboardDidShow` missing, the fixed add-task bar stayed behind the keyboard
 * for the rest of the session rather than for a few frames (#9779).
 *
 * So the `will` event arms a one-shot action and the `did` event runs it — but
 * a timeout runs it too, and whichever gets there first wins. Exactly once
 * either way, so a late `did` after the timeout is a no-op.
 */
export interface OneShotSettle {
  /** Animation starting: `action` runs on the next `run()`, or after the timeout. */
  arm(action: () => void): void;
  /** The `did` event arrived — run the armed action now, if it has not run. */
  run(): void;
  /** Animation superseded or cancelled — drop the armed action without running it. */
  cancel(): void;
}

export const createOneShotSettle = (timeoutMs: number): OneShotSettle => {
  let timeout: number | undefined;
  let action: (() => void) | null = null;

  /** Disarms and hands back whatever was armed, so every path runs at most once. */
  const take = (): (() => void) | null => {
    window.clearTimeout(timeout);
    timeout = undefined;
    const armed = action;
    action = null;
    return armed;
  };

  return {
    arm: (next: () => void): void => {
      take();
      action = next;
      timeout = window.setTimeout(() => take()?.(), timeoutMs);
    },
    run: (): void => take()?.(),
    cancel: (): void => void take(),
  };
};
