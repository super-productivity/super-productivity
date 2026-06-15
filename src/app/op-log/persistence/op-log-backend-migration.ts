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

const maxSeq = (rows: ReadonlyArray<{ seq?: number }>): number =>
  rows.reduce((m, r) => (typeof r.seq === 'number' && r.seq > m ? r.seq : m), 0);

/** Count a store's rows via a streaming scan — never materialises the rows. */
const countRows = async (tx: OpLogTx, store: string): Promise<number> => {
  let n = 0;
  await tx.iterate(store, {}, () => {
    n++;
    return 'continue';
  });
  return n;
};

/** Highest `seq` across a store's rows, via a streaming scan. */
const maxSeqInStore = async (tx: OpLogTx, store: string): Promise<number> => {
  let m = 0;
  await tx.iterate<{ seq?: number }>(store, {}, (value) => {
    if (typeof value?.seq === 'number' && value.seq > m) {
      m = value.seq;
    }
    return 'continue';
  });
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

  // Refuse a non-empty destination — C1 runs only when SQLite is empty.
  // Merging into existing data would risk seq/clock corruption.
  if ((await dest.count(STORE_NAMES.OPS)) > 0) {
    throw new OpLogBackendMigrationError(
      'destination already has ops; refusing to merge',
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
      await source.iterate<unknown>(store, { mode: 'readonly' }, (value, key) => {
        rows.push({ value, key: key as number | string });
        return 'continue';
      });
      for (const { value, key } of rows) {
        // `put` preserves the ops `seq` (the value carries it via ON CONFLICT)
        // and writes singletons at their out-of-line key — uniform across all
        // store kinds, so no per-store special-casing is needed.
        await tx.put(store, value, key);
      }
      copiedCounts[store] = rows.length;
      if (store === STORE_NAMES.OPS) {
        srcLastSeq = maxSeq(rows.map((r) => r.value as { seq?: number }));
      }
    }

    // Verify-before-commit: per-store row counts, the ops high-water seq, and the
    // vector clock must all reproduce the source exactly. Any mismatch throws ->
    // the whole copy rolls back, leaving `dest` empty. Counts are scanned (not
    // materialised) so verification stays as low-memory as the copy.
    for (const store of ALL_STORES) {
      const destCount = await countRows(tx, store);
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
