import {
  DownloadOutcome,
  DownloadResultForRejection,
} from '../core/types/sync-results.types';

/**
 * Maps the outcome of a nested download, run while resolving rejected
 * uploads, to the shape `RejectedOpsHandlerService` consumes. `latestServerSeq`
 * is the cursor persisted after that download applied its ops.
 *
 * Validation failure (if any during the nested download) is on the
 * session-validation latch — no need to thread the boolean back. (#7330)
 */
export const toDownloadResultForRejection = (
  outcome: DownloadOutcome,
  latestServerSeq: number,
): DownloadResultForRejection => {
  switch (outcome.kind) {
    case 'ops_processed':
      return {
        kind: 'completed',
        newOpsCount: outcome.newOpsCount,
        localWinOpsCreated: outcome.localWinOpsCreated,
        allOpClocks: outcome.allOpClocks,
        snapshotVectorClock: outcome.snapshotVectorClock,
        latestServerSeq,
      };
    case 'no_new_ops':
    case 'snapshot_hydrated':
      return {
        kind: 'completed',
        newOpsCount: 0,
        allOpClocks: outcome.allOpClocks,
        snapshotVectorClock: outcome.snapshotVectorClock,
        latestServerSeq,
      };
    case 'server_migration_handled':
    case 'server_migration_skipped':
      return { kind: 'completed', newOpsCount: 0 };
    case 'cancelled':
      return { kind: 'cancelled' };
    case 'blocked_incompatible':
      throw new Error('Nested download blocked by an incompatible remote operation.');
  }
};
