/**
 * Declarative schema descriptor for the op-log database (`SUP_OPS`).
 *
 * Phase A of the SQLite migration (see docs/sync-and-op-log/sqlite-migration.md).
 * Replaces the imperative `runDbUpgrade()` (createObjectStore/createIndex calls)
 * with data that BOTH backends consume:
 * - the IndexedDB adapter turns each {@link DbStoreSchema} into object stores +
 *   indexes inside its `upgrade` callback;
 * - the SQLite adapter turns each into a `CREATE TABLE` + `CREATE INDEX`.
 *
 * This is the single source of truth for store structure; keep it in sync with
 * `db-keys.const.ts` (names) and `db-upgrade.ts` (until that is retired).
 */

import { STORE_NAMES, OPS_INDEXES, DB_NAME, DB_VERSION } from './db-keys.const';

export interface DbIndexSchema {
  name: string;
  /** Property path(s) on the stored value. Array = compound index. */
  keyPath: string | string[];
  unique?: boolean;
}

export interface DbStoreSchema {
  name: string;
  /**
   * Property used as the primary key. Omitted = keyless store written with an
   * explicit out-of-line key (the singleton stores).
   */
  keyPath?: string;
  /** Auto-incrementing integer primary key (the `ops` store's `seq`). */
  autoIncrement?: boolean;
  indexes?: DbIndexSchema[];
}

export interface OpLogDbSchema {
  name: string;
  version: number;
  stores: DbStoreSchema[];
}

/**
 * Current `SUP_OPS` schema, mirroring db-upgrade.ts (currently v6).
 *
 * `name`/`version` are reused from `db-keys.const.ts` (not re-literaled) so the
 * adapter opens at exactly the version `runDbUpgrade` migrates to — a future
 * `DB_VERSION` bump can't silently desync this descriptor. The store/index shape
 * below is guarded against drift from `runDbUpgrade` by `op-log-db-schema.spec.ts`.
 *
 * NOTE: the IndexedDB adapter must still apply this via versioned upgrade steps
 * for existing users (it cannot simply create the final shape). The declarative
 * form here describes the *target* shape; per-version migration deltas continue
 * to live next to the adapter until Phase A fully replaces `runDbUpgrade`.
 */
export const OP_LOG_DB_SCHEMA: OpLogDbSchema = {
  name: DB_NAME,
  version: DB_VERSION,
  stores: [
    {
      name: STORE_NAMES.OPS,
      keyPath: 'seq',
      autoIncrement: true,
      indexes: [
        { name: OPS_INDEXES.BY_ID, keyPath: 'op.id', unique: true },
        { name: OPS_INDEXES.BY_SYNCED_AT, keyPath: 'syncedAt' },
        {
          name: OPS_INDEXES.BY_SOURCE_AND_STATUS,
          keyPath: ['source', 'applicationStatus'],
        },
      ],
    },
    { name: STORE_NAMES.STATE_CACHE, keyPath: 'id' },
    { name: STORE_NAMES.IMPORT_BACKUP, keyPath: 'id' },
    // keyless singleton: written with explicit out-of-line key SINGLETON_KEY
    { name: STORE_NAMES.VECTOR_CLOCK },
    { name: STORE_NAMES.ARCHIVE_YOUNG, keyPath: 'id' },
    { name: STORE_NAMES.ARCHIVE_OLD, keyPath: 'id' },
    { name: STORE_NAMES.PROFILE_DATA, keyPath: 'id' },
    // keyless singleton: clientId stored under SINGLETON_KEY
    { name: STORE_NAMES.CLIENT_ID },
  ],
};
