import { deepEqual } from '@sp/sync-core';
import { ActionType, Operation } from '../core/operation.types';
import { compareVectorClocks, VectorClockComparison } from '../../core/util/vector-clock';
import { OpLogTx } from './op-log-db-adapter';
import { STORE_NAMES } from './db-keys.const';
import {
  decodeStoredEntry,
  getOpId,
  StoredOperationLogEntry,
} from './operation-log-store-rows';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import { encodeOperation } from './compact/operation-codec.service';

const sameAuthoredTimeDelta = (local: Operation, original: Operation): boolean => {
  const canonical = (op: Operation): unknown => ({
    ...op,
    vectorClock: undefined,
    entityIds: getOpEntityIds(op).sort(),
  });
  return (
    local.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT &&
    deepEqual(canonical(local), canonical(original))
  );
};

/** A server receipt may undo a local rebase, never a change to authored content. */
export const isRebasedTimeDeltaReceipt = (
  local: Operation,
  original: Operation,
): boolean =>
  sameAuthoredTimeDelta(local, original) &&
  compareVectorClocks(local.vectorClock, original.vectorClock) ===
    VectorClockComparison.GREATER_THAN;

export const acknowledgeOperations = async (
  tx: OpLogTx,
  seqs: number[],
  originals?: ReadonlyMap<string, Operation>,
): Promise<void> => {
  const now = Date.now();
  for (const seq of seqs) {
    const entry = await tx.get<StoredOperationLogEntry>(STORE_NAMES.OPS, seq);
    if (!entry) continue;
    const original = originals?.get(getOpId(entry.op));
    if (original) {
      const local = decodeStoredEntry(entry).op;
      const isUnrejectedLocal =
        entry.source === 'local' &&
        entry.rejectedAt === undefined &&
        entry.reducerRejectedAt === undefined;
      // Another tab may have committed this deferred receipt first.
      if (
        isUnrejectedLocal &&
        entry.syncedAt !== undefined &&
        sameAuthoredTimeDelta(local, original) &&
        deepEqual(local.vectorClock, original.vectorClock)
      )
        continue;
      // Recheck inside the write transaction: another tab may have changed it
      // during the receipt download. Never alter replay order (seq) or state.
      if (!isUnrejectedLocal || !isRebasedTimeDeltaReceipt(local, original)) {
        throw new Error('Time delta changed while recovering its upload receipt');
      }
      entry.op = encodeOperation({ ...local, vectorClock: original.vectorClock });
    }
    entry.syncedAt = now;
    await tx.put(STORE_NAMES.OPS, entry);
  }
};
