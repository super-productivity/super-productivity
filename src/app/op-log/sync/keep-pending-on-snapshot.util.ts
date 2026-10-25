import type { OperationApplierService } from '../apply/operation-applier.service';
import type { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { isFullStateOpType, OperationLogEntry } from '../core/operation.types';
import type { SnackService } from '../../core/snack/snack.service';
import type { TabSeqFrontierService } from '../persistence/tab-seq-frontier.service';
import { OpLog } from '../../core/log';
import { T } from '../../t.const';

/**
 * #10972: a concurrent snapshot of a file that only grew since this client
 * last synced is a catch-up past trimmed ops, not a replacement. The pending
 * ops can then stay on top of it: receivers resolve any crossing with their
 * own edits on the normal LWW path. A pending full-state op still needs the
 * user's decision, as does a client that never completed a sync.
 */
export const canKeepPendingOnSnapshot = (
  result: { snapshotExtendsLastSeen?: boolean },
  unsyncedOps: readonly OperationLogEntry[],
  hasCompletedSyncBaseline: boolean,
): boolean =>
  result.snapshotExtendsLastSeen === true &&
  hasCompletedSyncBaseline &&
  !unsyncedOps.some((entry) => isFullStateOpType(entry.op.opType));

/**
 * #10972: replays the pending ops a catch-up file snapshot kept, on top of the
 * freshly loaded snapshot state, in seq order and without capturing them
 * again; they stay pending for the normal upload. Archive side effects are
 * left to the caller's archive-restore pass.
 */
export const reapplyKeptPendingOps = async (deps: {
  opLogStore: Pick<
    OperationLogStoreService,
    'getUnsynced' | 'markReducersCommittedAndMergeClocks'
  >;
  operationApplier: Pick<OperationApplierService, 'applyOperations'>;
  snackService: Pick<SnackService, 'open'>;
  tabSeqFrontier: Pick<TabSeqFrontierService, 'establishFrontier'>;
}): Promise<void> => {
  const kept = (await deps.opLogStore.getUnsynced()).sort((a, b) => a.seq - b.seq);
  const keptOps = kept.map((entry) => entry.op);
  const applyResult = await deps.operationApplier.applyOperations(keptOps, {
    isLocalHydration: true,
    skipDeferredLocalActions: true,
    remoteApplyWindowAlreadyOpen: true,
  });
  const failedIds = (applyResult.reducerFailures ?? []).map((f) => f.op.id);
  if (
    applyResult.failedOp ||
    applyResult.appliedOps.length + failedIds.length !== keptOps.length
  ) {
    throw new Error('Snapshot hydration incomplete: kept local changes not re-applied.');
  }
  // Only now does live state hold the kept rows; until then state-derived
  // cache saves must not anchor past them (#9438).
  if (kept.length) deps.tabSeqFrontier.establishFrontier(kept[kept.length - 1].seq);
  if (failedIds.length === 0) return;

  // A kept edit the adopted state cannot take (e.g. its project was deleted
  // remotely) is dropped, as receivers drop it. Left pending, startup replay
  // would throw on it as a failed local op.
  await deps.opLogStore.markReducersCommittedAndMergeClocks([], [], failedIds);
  OpLog.warn(
    `reapplyKeptPendingOps: dropped ${failedIds.length} kept op(s) the snapshot cannot apply`,
  );
  deps.snackService.open({
    msg: T.F.SYNC.S.LOCAL_CHANGES_DISCARDED_SNAPSHOT,
    translateParams: { count: failedIds.length },
  });
};
