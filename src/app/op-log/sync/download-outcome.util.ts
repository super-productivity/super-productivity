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

/**
 * #9256: whether the decrypt error of a kept prefix no longer needs reporting
 * because the cycle already ended in a state that supersedes it:
 * - `cancelled`: the user declined the prefix, so nothing was applied;
 * - `blocked_incompatible`: "update the app" is the actionable state (and a
 *   newer client is a plausible cause of the undecryptable page);
 * - cursor past the prefix: a conflict resolution in this cycle (USE_LOCAL)
 *   replaced the server, whose seqs keep counting up, so the failing page is
 *   gone. A cursor BEHIND the prefix (e.g. a deferred REPAIR skipped the
 *   persist) still reports the error.
 */
export const isKeptPrefixDecryptErrorSuperseded = (
  outcome: DownloadOutcome,
  cursors: { prefixCursor: number | undefined; persistedCursor: number },
): boolean =>
  outcome.kind === 'cancelled' ||
  outcome.kind === 'blocked_incompatible' ||
  (cursors.prefixCursor !== undefined && cursors.persistedCursor > cursors.prefixCursor);
