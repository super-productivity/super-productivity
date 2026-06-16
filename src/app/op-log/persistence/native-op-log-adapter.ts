/**
 * Delegating {@link OpLogDbAdapter} for the native backend. Its `init()` resolves
 * the backend to use ONCE — the native SQLite adapter on success, or the legacy
 * IndexedDB adapter when SQLite bootstrap fails recoverably (see
 * {@link createNativeSqliteOpLogAdapterFactory}) — then every other method
 * forwards to that delegate.
 *
 * Why a delegating wrapper rather than returning the chosen adapter directly: the
 * store/archive services capture their adapter reference once (at construction)
 * and branch on `adapter.adoptConnection` to decide whether THEY own the
 * connection. This wrapper deliberately does NOT expose `adoptConnection`, so the
 * services always take the self-managing branch (`await adapter.init()`) and let
 * `init()` pick the real backend underneath — including the in-session fallback
 * to a self-opening IndexedDB adapter, which the services never observe.
 */
import {
  DbCursorVisitor,
  DbIterateOptions,
  DbKey,
  DbKeyRange,
  DbTxMode,
  OpLogDbAdapter,
  OpLogTx,
} from './op-log-db-adapter';

export class NativeOpLogAdapter implements OpLogDbAdapter {
  private _delegate?: OpLogDbAdapter;

  /**
   * @param _resolveBackend memoized, shared across every adapter the factory
   * vends, so the bootstrap + fallback decision runs exactly once per app. It
   * resolves to an already-`init()`-ed delegate.
   */
  constructor(private readonly _resolveBackend: () => Promise<OpLogDbAdapter>) {}

  async init(): Promise<void> {
    // The resolved delegate is already initialized (SQLite bootstrapped, or the
    // IDB fallback self-opened) — do not re-init it here.
    this._delegate = await this._resolveBackend();
  }

  close(): void {
    this._delegate?.close();
  }

  // `adoptConnection` is intentionally absent — see the class doc.

  private _d(): OpLogDbAdapter {
    if (!this._delegate) {
      throw new Error('NativeOpLogAdapter: init() must be awaited before use');
    }
    return this._delegate;
  }

  add(store: string, value: unknown): Promise<number> {
    return this._d().add(store, value);
  }

  put(store: string, value: unknown, key?: DbKey): Promise<void> {
    return this._d().put(store, value, key);
  }

  get<T>(store: string, key: DbKey): Promise<T | undefined> {
    return this._d().get<T>(store, key);
  }

  getAll<T>(store: string, range?: DbKeyRange): Promise<T[]> {
    return this._d().getAll<T>(store, range);
  }

  delete(store: string, key: DbKey): Promise<void> {
    return this._d().delete(store, key);
  }

  clear(store: string): Promise<void> {
    return this._d().clear(store);
  }

  count(store: string, range?: DbKeyRange): Promise<number> {
    return this._d().count(store, range);
  }

  getFromIndex<T>(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<T | undefined> {
    return this._d().getFromIndex<T>(store, index, key);
  }

  getKeyFromIndex(
    store: string,
    index: string,
    key: DbKey | DbKey[],
  ): Promise<DbKey | undefined> {
    return this._d().getKeyFromIndex(store, index, key);
  }

  getAllFromIndex<T>(store: string, index: string, range?: DbKeyRange): Promise<T[]> {
    return this._d().getAllFromIndex<T>(store, index, range);
  }

  countFromIndex(store: string, index: string, range?: DbKeyRange): Promise<number> {
    return this._d().countFromIndex(store, index, range);
  }

  iterate<T>(
    store: string,
    options: DbIterateOptions,
    visit: DbCursorVisitor<T>,
  ): Promise<void> {
    return this._d().iterate<T>(store, options, visit);
  }

  transaction<T>(
    stores: string[],
    mode: DbTxMode,
    fn: (tx: OpLogTx) => Promise<T>,
  ): Promise<T> {
    return this._d().transaction<T>(stores, mode, fn);
  }
}
