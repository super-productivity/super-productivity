import { InjectionToken } from '@angular/core';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { IndexedDbOpLogAdapter } from './indexed-db-op-log-adapter';
import {
  createNativeSqliteOpLogAdapterFactory,
  shouldUseNativeSqliteOpLogBackend,
} from './native-sqlite-backend';

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
 * DI seam for the op-log persistence backend (Phase B of the SQLite migration;
 * see docs/sync-and-op-log/sqlite-migration.md).
 *
 * Defaults to IndexedDB. On Android ({@link shouldUseNativeSqliteOpLogBackend})
 * it returns the SQLite-backed factory instead — one shared SQLite connection
 * across both stores, with the one-time IDB→SQLite migration run on first init
 * and an in-session fallback to IndexedDB if that bootstrap fails recoverably.
 * iOS and web/PWA/Electron stay on IndexedDB. The stores are untouched; they
 * only know `OpLogDbAdapter`.
 */
export const OP_LOG_DB_ADAPTER_FACTORY = new InjectionToken<OpLogDbAdapterFactory>(
  'OP_LOG_DB_ADAPTER_FACTORY',
  {
    providedIn: 'root',
    factory: () =>
      shouldUseNativeSqliteOpLogBackend()
        ? createNativeSqliteOpLogAdapterFactory()
        : () => new IndexedDbOpLogAdapter(),
  },
);
