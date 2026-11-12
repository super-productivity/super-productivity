import { OpLog } from '../../core/log';
import { OperationLogEntry } from '../core/operation.types';
import { describeOpForLog } from '../util/describe-op-for-log.util';

/** One log arg per op, so the exported log stays bounded when many are quarantined. */
export const MAX_LOGGED_REDUCER_REJECTED = 5;

/**
 * Drops the ops replay must skip forever (`reducerRejectedAt`).
 *
 * Such an op still counts as seen, so no later sync re-delivers it and the
 * change it carried is missing on this device for good. The failure itself is
 * logged once, in memory, in the session it happened; naming the skipped ops
 * again at boot puts that fact in a log exported after a restart (#11184).
 * Only until the next snapshot: replay then starts past these ops, and no
 * later boot reads them.
 */
export const withoutReducerRejected = (
  entries: OperationLogEntry[],
): OperationLogEntry[] => {
  const rejected = entries.filter((entry) => entry.reducerRejectedAt !== undefined);
  if (rejected.length === 0) {
    return entries;
  }
  OpLog.warn(
    `Hydration: skipping ${rejected.length} op(s) that failed to apply earlier; their changes are missing on this device`,
    ...rejected.slice(0, MAX_LOGGED_REDUCER_REJECTED).map((entry) => ({
      ...describeOpForLog(entry.op),
      source: entry.source,
      reducerRejectedAt: entry.reducerRejectedAt,
    })),
  );
  return entries.filter((entry) => entry.reducerRejectedAt === undefined);
};
