import { OPS_INDEXES, STORE_NAMES } from './db-keys.const';
import { OpLogTx } from './op-log-db-adapter';
import { StoredOperationLogEntry } from './operation-log-store-rows';

/**
 * Settles the pending local ops a file-snapshot baseline replaces, inside the
 * baseline transaction so their fate commits with the state replacement.
 *
 * - `rejectOpIds` are marked rejected: they belong to the superseded state.
 * - `keepOpIds` (#10972) are deleted and returned without their seq, in seq
 *   order, for the caller to re-append past the snapshot ops with ids and
 *   clocks unchanged (the caller owns the append so it can report the seqs to
 *   the tab frontier, #9438). The new state cache stops before them, so a
 *   restart replays them on top of the snapshot and they still upload.
 *
 * Call after the snapshot's included ops are appended.
 */
export const settleSupersededLocalOpsInTx = async (
  tx: OpLogTx,
  args: {
    rejectOpIds?: readonly string[];
    keepOpIds?: readonly string[];
    rejectedAt: number;
  },
): Promise<Omit<StoredOperationLogEntry, 'seq'>[]> => {
  for (const opId of args.rejectOpIds ?? []) {
    const rejectEntry = await getEntryById(tx, opId);
    if (rejectEntry) {
      rejectEntry.rejectedAt = args.rejectedAt;
      await tx.put(STORE_NAMES.OPS, rejectEntry);
    }
  }

  const kept: StoredOperationLogEntry[] = [];
  for (const opId of args.keepOpIds ?? []) {
    const entry = await getEntryById(tx, opId);
    if (entry) kept.push(entry);
  }
  const toReappend: Omit<StoredOperationLogEntry, 'seq'>[] = [];
  for (const { seq, ...entry } of kept.sort((a, b) => a.seq - b.seq)) {
    // The id index is unique, so the old row must go before its copy lands.
    await tx.delete(STORE_NAMES.OPS, seq);
    toReappend.push(entry);
  }
  return toReappend;
};

const getEntryById = (
  tx: OpLogTx,
  opId: string,
): Promise<StoredOperationLogEntry | undefined> =>
  tx.getFromIndex<StoredOperationLogEntry>(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, opId);
