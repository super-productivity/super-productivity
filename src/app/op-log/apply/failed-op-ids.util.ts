import { Operation } from '../core/operation.types';

/**
 * Given the ops handed to a single `applyOperations()` batch in causal (seq)
 * order and the op whose archive side effect threw, return the ids of every op
 * that stays unapplied: the failed op plus everything after it.
 *
 * The batch applier (`replayOperationBatch`) stops at the first failing archive
 * side effect, so ops after `failedOp` were never processed and must be retried
 * together with it. This is the slice-from-failure handling shared by every
 * caller that applies a batch and then marks the remainder failed (the remote
 * apply path, conflict resolution, and the failed-op retry on hydration).
 *
 * The `-1` guard is defensive: `failedOp` always originates from `opsToApply`,
 * but if it somehow isn't found we mark only the failed op rather than letting
 * `slice(-1)` wrongly select just the last op.
 */
export const getFailedOpIdsFromBatch = (
  opsToApply: Operation[],
  failedOp: Operation,
): string[] => {
  const failedIndex = opsToApply.findIndex((op) => op.id === failedOp.id);
  const stillFailed = failedIndex === -1 ? [failedOp] : opsToApply.slice(failedIndex);
  return stillFailed.map((op) => op.id);
};
