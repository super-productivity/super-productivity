import { Operation, VectorClock } from '../core/operation.types';
import { encodeOperation } from './compact/operation-codec.service';
import { OPS_INDEXES, SINGLETON_KEY, STORE_NAMES } from './db-keys.const';
import { OpLogTx } from './op-log-db-adapter';
import type { MixedSourceWrittenOperation } from './operation-log-store.service';
import { rebaseLocalClockOnDurable } from './operation-log-clock.util';
import {
  StateCacheEntry,
  StoredOperationLogEntry,
  VectorClockEntry,
  decodeStoredEntry,
  isPendingLocalEntryOf,
} from './operation-log-store-rows';

/**
 * Moves pending local ops past `clockToDominate` IN PLACE inside `tx`, in seq
 * order, and writes the durable clock. Needs OPS, VECTOR_CLOCK, STATE_CACHE and
 * META. Writes nothing and returns undefined if any row is no longer pending
 * for this client.
 */
export const rebasePendingLocalOpsInTx = async (
  tx: OpLogTx,
  args: {
    opIds: readonly string[];
    clockToDominate: VectorClock;
    clientId: string;
    /** Store-owned pruning with the in-transaction preserve set (#9096). */
    boundClock: (clock: VectorClock) => Promise<VectorClock>;
  },
): Promise<{ rebased: Operation[]; committedClock: VectorClock } | undefined> => {
  const { clientId, clockToDominate } = args;
  const entries: StoredOperationLogEntry[] = [];
  for (const opId of args.opIds) {
    const entry = await tx.getFromIndex<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      opId,
    );
    if (!isPendingLocalEntryOf(entry, clientId)) {
      return undefined;
    }
    entries.push(entry);
  }
  const cache = await tx.get<StateCacheEntry>(STORE_NAMES.STATE_CACHE, SINGLETON_KEY);
  let clock =
    (await tx.get<VectorClockEntry>(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY))?.clock ??
    {};
  const rebased: Operation[] = [];
  let coveredCounter = 0;
  for (const entry of entries.sort((a, b) => a.seq - b.seq)) {
    clock = rebaseLocalClockOnDurable(clock, clockToDominate, clientId);
    const op: Operation = { ...decodeStoredEntry(entry).op, vectorClock: clock };
    await tx.put(STORE_NAMES.OPS, { ...entry, op: encodeOperation(op) });
    rebased.push(op);
    if (cache && entry.seq <= cache.lastAppliedOpSeq) coveredCounter = clock[clientId];
  }
  // Boot rebuilds the durable clock from the cache clock plus the op tail.
  if (cache && coveredCounter > (cache.vectorClock[clientId] ?? 0)) {
    await tx.put(STORE_NAMES.STATE_CACHE, {
      ...cache,
      vectorClock: { ...cache.vectorClock, [clientId]: coveredCounter },
    });
  }
  const committedClock = await args.boundClock(clock);
  await tx.put(
    STORE_NAMES.VECTOR_CLOCK,
    { clock: committedClock, lastUpdate: Date.now() } satisfies VectorClockEntry,
    SINGLETON_KEY,
  );
  return { rebased, committedClock };
};

/**
 * Rebases the still-pending `opIds` plus the written `successorOpIds` inside the
 * append transaction, swapping the re-clocked ops into `written`. Returns the
 * committed clock, or undefined when nothing was rebased.
 */
export const rebaseKeptOpsInTx = async (
  tx: OpLogTx,
  args: {
    opIds: Iterable<string>;
    successorOpIds: ReadonlySet<string>;
    clockToDominate: VectorClock;
    written: MixedSourceWrittenOperation[];
    clientId: string;
    boundClock: (clock: VectorClock) => Promise<VectorClock>;
  },
): Promise<VectorClock | undefined> => {
  const pendingIds: string[] = [];
  for (const opId of args.opIds) {
    const entry = await tx.getFromIndex<StoredOperationLogEntry>(
      STORE_NAMES.OPS,
      OPS_INDEXES.BY_ID,
      opId,
    );
    if (isPendingLocalEntryOf(entry, args.clientId)) pendingIds.push(opId);
  }
  if (pendingIds.length === 0) return undefined;
  const successorIds = args.written
    .filter((w) => w.source === 'local' && args.successorOpIds.has(w.op.id))
    .map((w) => w.op.id);
  const result = await rebasePendingLocalOpsInTx(tx, {
    ...args,
    opIds: [...pendingIds, ...successorIds],
  });
  if (!result) return undefined;
  const byId = new Map(result.rebased.map((op) => [op.id, op]));
  for (const w of args.written) w.op = byId.get(w.op.id) ?? w.op;
  return result.committedClock;
};
