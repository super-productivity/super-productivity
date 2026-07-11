/**
 * C1 — one-time op-log backend migration (see
 * docs/sync-and-op-log/sqlite-migration.md). Copies the ENTIRE op-log database
 * from `source` (the legacy IndexedDB backend) to `dest` (SQLite) in a single
 * `dest` transaction with **verify-before-commit**: if any store's row count,
 * the ops high-water `seq`, or the vector clock do not match the source, the
 * transaction throws and rolls back, leaving `dest` empty and the `source`
 * untouched. The copy streams one store at a time (and verifies by scanning,
 * not materialising) so the multi-MB archive/state/backup blobs are never all
 * held in memory at once — avoiding an OOM on heavy installs / low-end devices.
 *
 * Adapter-agnostic by design — it talks only to the {@link OpLogDbAdapter} port,
 * so it is validated in CI with a real IndexedDB source + a sql.js SQLite dest;
 * the native `@capacitor-community/sqlite` dest behaves identically through the
 * same port. The CALLER (Phase B3/C2) decides WHEN to run it — only when the
 * SQLite DB is empty and a legacy `SUP_OPS` IndexedDB exists — and keeps the IDB
 * copy as a fallback for >= 1 release. Mirrors the proven legacy `pf` -> SUP_OPS
 * migration pattern.
 */
import { OpLogDbAdapter, OpLogTx } from './op-log-db-adapter';
import { SINGLETON_KEY, STORE_NAMES } from './db-keys.const';

/** Every store is copied — fully evacuating the source, not just the hot ones. */
const ALL_STORES: readonly string[] = Object.values(STORE_NAMES);

export interface OpLogBackendMigrationResult {
  /** Rows copied per store. */
  readonly copiedCounts: Readonly<Record<string, number>>;
  /** Highest ops `seq` carried across (0 when there are no ops). */
  readonly lastSeq: number;
}

export class OpLogBackendMigrationError extends Error {
  constructor(message: string) {
    super(`OpLogBackendMigration: ${message}`);
    this.name = 'OpLogBackendMigrationError';
  }
}

interface StoredRow {
  readonly value: unknown;
  readonly key: number | string;
}

/** Whether any user-data store already contains a row. */
export const hasAnyOpLogData = async (adapter: OpLogDbAdapter): Promise<boolean> => {
  for (const store of ALL_STORES) {
    if ((await adapter.count(store)) > 0) {
      return true;
    }
  }
  return false;
};

/** Highest `seq` via the same one-row descending read as getLastSeq(). */
const maxSeqInStore = async (tx: OpLogTx, store: string): Promise<number> => {
  let m = 0;
  await tx.iterate<{ seq?: number }>(
    store,
    { direction: 'prev', mode: 'readonly', limit: 1 },
    (value, key) => {
      m = typeof key === 'number' ? key : (value.seq ?? 0);
      return 'stop';
    },
  );
  return m;
};

/**
 * Copy the whole op-log from `source` to `dest`. Both adapters are `init()`-ed
 * here. Throws {@link OpLogBackendMigrationError} (and rolls `dest` back) on a
 * non-empty destination or any verification mismatch.
 */
export const migrateOpLogBackend = async (
  source: OpLogDbAdapter,
  dest: OpLogDbAdapter,
): Promise<OpLogBackendMigrationResult> => {
  await source.init();
  await dest.init();

  // Refuse data in ANY destination store — C1 runs only when SQLite is empty.
  // Checking only ops can overwrite a newer snapshot/archive after compaction.
  if (await hasAnyOpLogData(dest)) {
    throw new OpLogBackendMigrationError(
      'destination already has data; refusing to merge',
    );
  }

  // The vector clock is a single small row — read it up front for the verify.
  const srcClock = await source.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
  const copiedCounts: Record<string, number> = {};
  let srcLastSeq = 0;

  await dest.transaction([...ALL_STORES], 'readwrite', async (tx) => {
    // Copy ONE store at a time. IndexedDB's cursor visitor must stay synchronous
    // (awaiting real I/O mid-walk lets the source transaction auto-commit), so we
    // buffer a store's rows and then write them — but only ONE store's worth at a
    // time, never the whole database resident at once. This matters because the
    // singleton blob stores (state_cache, import_backup, archive_*, profile_data)
    // each hold a full serialized state/archive that can run to many MB; holding
    // them all together risked an OOM on heavy installs / low-end devices. Each
    // `rows` array falls out of scope before the next store is read.
    for (const store of ALL_STORES) {
      const rows: StoredRow[] = [];
      await source.iterate<{ seq?: number }>(
        store,
        { mode: 'readonly' },
        (value, key) => {
          rows.push({ value, key: key as number | string });
          if (store === STORE_NAMES.OPS) {
            const seq = typeof key === 'number' ? key : (value.seq ?? 0);
            if (seq > srcLastSeq) {
              srcLastSeq = seq;
            }
          }
          return 'continue';
        },
      );
      // `putBatch` preserves the ops `seq` (the value carries it via ON CONFLICT)
      // and writes singletons at their out-of-line key — uniform across all store
      // kinds, no per-store special-casing. On SQLite the whole store's rows cross
      // the native bridge in a few `executeSet` calls instead of one per row (the
      // dominant migration cost); on IndexedDB it just loops. Atomic either way:
      // it runs inside this single `dest.transaction`.
      await tx.putBatch(store, rows);
      copiedCounts[store] = rows.length;
    }

    // Verify-before-commit: per-store row counts, the ops high-water seq, and the
    // vector clock must all reproduce the source exactly. Any mismatch throws ->
    // the whole copy rolls back, leaving `dest` empty. Counts use the engine's own
    // aggregate (`tx.count`) rather than a cursor scan, so verification never
    // re-transfers the (multi-MB) blob-store values it just wrote.
    for (const store of ALL_STORES) {
      const destCount = await tx.count(store);
      if (destCount !== copiedCounts[store]) {
        throw new OpLogBackendMigrationError(
          `row count mismatch for '${store}': source ${copiedCounts[store]}, dest ${destCount}`,
        );
      }
    }
    const destLastSeq = await maxSeqInStore(tx, STORE_NAMES.OPS);
    if (destLastSeq !== srcLastSeq) {
      throw new OpLogBackendMigrationError(
        `last seq mismatch: source ${srcLastSeq}, dest ${destLastSeq}`,
      );
    }
    const destClock = await tx.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);
    // Both values come from the same source object through a JSON round-trip,
    // so key order is preserved and a string compare is sufficient.
    if (JSON.stringify(srcClock ?? null) !== JSON.stringify(destClock ?? null)) {
      throw new OpLogBackendMigrationError('vector clock mismatch');
    }
  });

  return { copiedCounts, lastSeq: srcLastSeq };
};
