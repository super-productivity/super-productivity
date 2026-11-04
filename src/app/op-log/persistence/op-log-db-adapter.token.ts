import { InjectionToken } from '@angular/core';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';

/**
 * Factory that produces a fresh {@link OpLogDbAdapter}.
 *
 * Each persistence service (OperationLogStoreService, ArchiveStoreService)
 * needs its OWN adapter instance because each adopts its own IndexedDB
 * connection via `adoptConnection()`. A shared singleton adapter would have its
 * `_db` clobbered by whichever service initialised last — so the token vends a
 * factory, not an instance.
 */
export type OpLogDbAdapterFactory = () => OpLogDbAdapter;

/**
 * DI seam for the op-log persistence backend. The stores only know
 * `OpLogDbAdapter`, so a backend swap would not touch them.
 *
 * Always IndexedDB: the native SQLite backend is parked and its adapter was
 * removed (see docs/sync-and-op-log/sqlite-migration.md).
 */
export const OP_LOG_DB_ADAPTER_FACTORY = new InjectionToken<OpLogDbAdapterFactory>(
  'OP_LOG_DB_ADAPTER_FACTORY',
  {
    providedIn: 'root',
    factory: () => () => new IndexedDbOpLogAdapter(),
  },
);
