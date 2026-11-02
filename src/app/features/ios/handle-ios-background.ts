import { Log } from '../../core/log';

export type IosBackgroundDeps = {
  flushAccumulatedTimeSpent: () => void;
  pushPendingOps: () => Promise<void>;
  finish: () => void;
};

/**
 * Body of main.ts' iOS background listener, effect-free so the spec can pin
 * it: the push (which persists pending ops first) follows the time flush so it
 * includes the time-spent op, runs even when that flush throws, and
 * `finish()` runs on every path so iOS can end the background task.
 */
export const handleIosBackground = async (deps: IosBackgroundDeps): Promise<void> => {
  try {
    deps.flushAccumulatedTimeSpent();
  } catch (e) {
    // Still push: ops persisted earlier are worth sending (as on Android).
    Log.err('iOS background: time flush failed', e);
  }
  try {
    await deps.pushPendingOps();
  } catch (e) {
    Log.err('iOS background: push failed', e);
  }
  deps.finish();
};
