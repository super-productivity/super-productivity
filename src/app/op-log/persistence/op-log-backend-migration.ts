/**
 * C1 — one-time op-log backend migration (see
 * docs/sync-and-op-log/sqlite-migration.md). Copies the ENTIRE op-log database
 * from `source` (the legacy IndexedDB backend) to `dest` (SQLite) in a single
 * `dest` transaction with **verify-before-commit**: if the copied op count,
 * last `seq`, or vector clock do not match the source, the transaction throws
 * and rolls back, leaving `dest` empty and the `source` untouched.
 *
 * Adapter-agnostic by design — it talks only to the {@link OpLogDbAdapter} port,
 * so it is validated in CI with a real IndexedDB source + a sql.js SQLite dest;
 * the native `@capacitor-community/sqlite` dest behaves identically through the
 * same port. The CALLER (Phase B3/C2) decides WHEN to run it — only when the
 * SQLite DB is empty and a legacy `SUP_OPS` IndexedDB exists — and keeps the IDB
 * copy as a fallback for >= 1 release. Mirrors the proven legacy `pf` -> SUP_OPS
 * migration pattern.
 */
import { OpLogDbAdapter } from './op-log-db-adapter';
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

  // Snapshot every store from the source (value + primary key) via a readonly
  // cursor. The visitor key is the `seq` for ops, the out-of-line key for
  // singletons (vector clock, client id), and the keyPath key for keyed stores.
  const snapshot = new Map<string, StoredRow[]>();
  for (const store of ALL_STORES) {
    const rows: StoredRow[] = [];
    await source.iterate<unknown>(store, { mode: 'readonly' }, (value, key) => {
      rows.push({ value, key: key as number | string });
      return 'continue';
    });
    snapshot.set(store, rows);
  }

  // Source invariants the copy must reproduce exactly.
  const srcOps = snapshot.get(STORE_NAMES.OPS) ?? [];
  const srcOpCount = srcOps.length;
  const srcLastSeq = maxSeq(srcOps.map((r) => r.value as { seq?: number }));
  const srcClock = await source.get(STORE_NAMES.VECTOR_CLOCK, SINGLETON_KEY);

  await dest.transaction([...ALL_STORES], 'readwrite', async (tx) => {
    for (const store of ALL_STORES) {
      for (const { value, key } of snapshot.get(store) ?? []) {
        // `put` preserves the ops `seq` (the value carries it via ON CONFLICT)
        // and writes singletons at their out-of-line key — uniform across all
        // store kinds, so no per-store special-casing is needed.
        await tx.put(store, value, key);
      }
    }

    // Verify-before-commit: any mismatch throws -> the whole copy rolls back.
    const destOps = await tx.getAll<{ seq?: number }>(STORE_NAMES.OPS);
    if (destOps.length !== srcOpCount) {
      throw new OpLogBackendMigrationError(
        `op count mismatch: source ${srcOpCount}, dest ${destOps.length}`,
      );
    }
    const destLastSeq = maxSeq(destOps);
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

  const copiedCounts: Record<string, number> = {};
  for (const store of ALL_STORES) {
    copiedCounts[store] = (snapshot.get(store) ?? []).length;
  }
  return { copiedCounts, lastSeq: srcLastSeq };
};
