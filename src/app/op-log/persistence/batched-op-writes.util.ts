import { isFullStateOpType, Operation } from '../core/operation.types';
import { chunkArray } from '../../util/chunk-array';
import { OPS_INDEXES, STORE_NAMES } from './db-keys.const';
import { OpLogTx } from './op-log-db-adapter';
import { StoredOperationLogEntry } from './operation-log-store-rows';

// The requests of one chunk go to IndexedDB together instead of one awaited
// round trip each: a fresh client's first sync spent ~90% of its time waiting
// on those round trips (measured 2026-11, 69k ops). The chunk bounds how many
// cloned rows are queued at once.
// shortcut: fixed chunk size — tune it if low-memory devices struggle.
const REQUESTS_PER_CHUNK = 500;

type ApplicationStatus = NonNullable<StoredOperationLogEntry['applicationStatus']>;

// One range read costs about half of a lookup per row (measured 2026-11, 20k
// rows, same machine). A downloaded batch has consecutive seqs; a chunk whose
// seqs are spread out keeps per-row lookups so the read stays bounded.
const getEntries = async (
  tx: OpLogTx,
  seqs: number[],
): Promise<(StoredOperationLogEntry | undefined)[]> => {
  const lower = Math.min(...seqs);
  const upper = Math.max(...seqs);
  if (upper - lower + 1 > 2 * seqs.length) {
    return Promise.all(
      seqs.map((seq) => tx.get<StoredOperationLogEntry>(STORE_NAMES.OPS, seq)),
    );
  }
  const rows = await tx.getAll<StoredOperationLogEntry>(STORE_NAMES.OPS, {
    lower,
    upper,
  });
  const bySeq = new Map(rows.map((row) => [row.seq, row]));
  return seqs.map((seq) => bySeq.get(seq));
};

const putWithStatus = async (
  tx: OpLogTx,
  entries: StoredOperationLogEntry[],
  applicationStatus: ApplicationStatus,
): Promise<void> => {
  await Promise.all(
    entries.map((entry) => tx.put(STORE_NAMES.OPS, { ...entry, applicationStatus })),
  );
};

const hasStatus =
  (statuses: readonly ApplicationStatus[]) =>
  (entry: StoredOperationLogEntry | undefined): entry is StoredOperationLogEntry =>
    entry?.applicationStatus !== undefined && statuses.includes(entry.applicationStatus);

/** Marks the stored ops at `seqs` applied; missing or already applied ones stay as they are. */
export const markAppliedInTx = async (tx: OpLogTx, seqs: number[]): Promise<void> => {
  // Reducer-committed/failed ops can be retried and cleared when successful.
  const isRetryable = hasStatus(['pending', 'archive_pending', 'failed']);
  for (const chunk of chunkArray(seqs, REQUESTS_PER_CHUNK)) {
    const entries = await getEntries(tx, chunk);
    await putWithStatus(tx, entries.filter(isRetryable), 'applied');
  }
};

/**
 * Marks the pending remote ops at `seqs` `archive_pending`. Throws, aborting
 * the transaction, if any of them is missing or not pending.
 */
export const markReducersCommittedInTx = async (
  tx: OpLogTx,
  seqs: number[],
): Promise<void> => {
  // A chunk's lookups all run before its writes, so a repeated seq would pass
  // the pending check twice; the one-at-a-time loop this replaced rejected it.
  if (new Set(seqs).size !== seqs.length) {
    throw new Error('Reducer checkpoint requires distinct operation sequences.');
  }
  const isPending = hasStatus(['pending']);
  for (const chunk of chunkArray(seqs, REQUESTS_PER_CHUNK)) {
    const entries = await getEntries(tx, chunk);
    const pending = entries.filter(isPending);
    if (pending.length !== chunk.length) {
      const seq = chunk[entries.findIndex((entry) => !isPending(entry))];
      throw new Error(
        `Reducer checkpoint requires pending remote operation at seq ${seq}.`,
      );
    }
    await putWithStatus(tx, pending, 'archive_pending');
  }
};

/** What {@link appendMissingOpsInTx} wrote and skipped. */
export interface AppendMissingOpsResult {
  seqs: number[];
  writtenOps: Operation[];
  skippedCount: number;
  /** Highest seq of the given ops, whether written now or already stored. */
  lastIncludedSeq: number;
}

/**
 * How {@link appendMissingOpsInTx} writes rows. The add stays with the caller,
 * which must report the committed seqs to TabSeqFrontierService (#9438).
 */
export interface AppendMissingOpsDeps {
  /** Issues the add of `op`'s row in the transaction; resolves to its seq. */
  addOp: (op: Operation) => Promise<number>;
  /** Records a full-state op once every add before it has landed. */
  recordFullStateOp: (op: Operation, seq: number) => Promise<void>;
}

// Adds are issued in order, so IndexedDB assigns seqs in `ops` order. A
// full-state op first waits for every add before it, so its meta ref is
// recorded against the log a one-at-a-time loop would have seen.
const addInOrder = async (
  ops: Operation[],
  deps: AppendMissingOpsDeps,
): Promise<number[]> => {
  const seqs: Promise<number>[] = [];
  for (const op of ops) {
    seqs.push(deps.addOp(op));
    if (isFullStateOpType(op.opType)) {
      const settled = await Promise.all(seqs);
      await deps.recordFullStateOp(op, settled[settled.length - 1]);
    }
  }
  return Promise.all(seqs);
};

const appendChunk = async (
  tx: OpLogTx,
  chunk: Operation[],
  deps: AppendMissingOpsDeps,
): Promise<AppendMissingOpsResult> => {
  const existingKeys = await Promise.all(
    chunk.map((op) => tx.getKeyFromIndex(STORE_NAMES.OPS, OPS_INDEXES.BY_ID, op.id)),
  );
  const toAdd: Operation[] = [];
  // The lookups above all ran before any add, so they miss an id repeated
  // within this chunk; earlier chunks are already in the index.
  const addedIds = new Set<string>();
  const result: AppendMissingOpsResult = {
    seqs: [],
    writtenOps: toAdd,
    skippedCount: 0,
    lastIncludedSeq: 0,
  };
  chunk.forEach((op, i) => {
    const existingKey = existingKeys[i];
    if (existingKey === undefined && !addedIds.has(op.id)) {
      addedIds.add(op.id);
      toAdd.push(op);
      return;
    }
    if (existingKey !== undefined && typeof existingKey !== 'number') {
      throw new Error('Operation sequence key is not numeric');
    }
    result.lastIncludedSeq = Math.max(result.lastIncludedSeq, existingKey ?? 0);
    result.skippedCount++;
  });
  const seqs = await addInOrder(toAdd, deps);
  return { ...result, seqs, lastIncludedSeq: Math.max(result.lastIncludedSeq, ...seqs) };
};

/**
 * Appends, in order, the ops not yet in the log, skipping ids already stored
 * or repeated within `ops`.
 */
export const appendMissingOpsInTx = async (
  tx: OpLogTx,
  ops: Operation[],
  deps: AppendMissingOpsDeps,
): Promise<AppendMissingOpsResult> => {
  const total: AppendMissingOpsResult = {
    seqs: [],
    writtenOps: [],
    skippedCount: 0,
    lastIncludedSeq: 0,
  };
  for (const chunk of chunkArray(ops, REQUESTS_PER_CHUNK)) {
    const part = await appendChunk(tx, chunk, deps);
    total.seqs.push(...part.seqs);
    total.writtenOps.push(...part.writtenOps);
    total.skippedCount += part.skippedCount;
    total.lastIncludedSeq = Math.max(total.lastIncludedSeq, part.lastIncludedSeq);
  }
  return total;
};
