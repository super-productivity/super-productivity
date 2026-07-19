import { OperationCaptureService } from './operation-capture.service';
import { getDeferredActions } from './operation-capture.meta-reducer';

/**
 * Guard for every writer that snapshots the LIVE NgRx store into state_cache
 * (#8751). Live state may contain "phantom changes" — reducer-applied changes
 * that no durable operation represents (yet). Baking one into state_cache
 * makes it durable locally with no op behind it: other devices never receive
 * it and replay-from-log no longer reproduces local state.
 *
 * Returns the reason snapshotting is unsafe right now, or null when safe:
 * - unrecovered persist failure: a write failed for good (lagging indicator;
 *   sticky until reload, which rebuilds state from durable data only);
 * - pending writes: actions whose state change is already in the store but
 *   whose write attempt has not completed (leading indicator — the counter is
 *   incremented synchronously in the same reducer pass that applies the
 *   change, closing the in-flight-write window the sticky flag cannot cover);
 * - deferred actions: applied during a sync window, persisted only after the
 *   drain (the buffer self-clears on a successful drain).
 *
 * MUST be called synchronously immediately before reading the store snapshot —
 * any await between check and read reopens the race this guard closes.
 */
export const getPhantomChangeRisk = (
  operationCapture: OperationCaptureService,
): string | null => {
  if (operationCapture.hasUnrecoveredPersistFailure()) {
    return 'an unrecovered persist failure left live state ahead of the op log';
  }
  if (operationCapture.getPendingCount() > 0) {
    return 'captured actions are still awaiting persistence';
  }
  if (getDeferredActions().length > 0) {
    return 'deferred actions from a sync window are not yet persisted';
  }
  return null;
};
