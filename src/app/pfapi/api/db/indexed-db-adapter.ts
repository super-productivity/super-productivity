import { IDBPDatabase } from 'idb/build';
import { DBSchema, openDB } from 'idb';
import { DatabaseAdapter } from './database-adapter.model';
import { MiniObservable } from '../util/mini-observable';
import { PFLog } from '../../../core/log';

// otherwise the typing of idb dependency won't work
const FAKE = 'FAAAAAKE' as const;

interface MyDb extends DBSchema {
  [storeName: string]: any;

  [FAKE]: any;
}

// TODO fix all the typing
export class IndexedDbAdapter implements DatabaseAdapter {
  private _db!: IDBPDatabase<MyDb>;
  private _isReady$: MiniObservable<boolean> = new MiniObservable<boolean>(false);

  private readonly _dbName: string;
  private readonly _dbMainName: string;
  private readonly _dbVersion: number;

  constructor(readonly cfg: { dbName: string; dbMainName: string; version: number }) {
    this._dbName = cfg.dbName;
    this._dbMainName = cfg.dbMainName;
    this._dbVersion = cfg.version;
  }

  public async init(): Promise<IDBPDatabase<MyDb>> {
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const that = this;
    try {
      this._db = await openDB<MyDb>(this._dbName, this._dbVersion, {
        // upgrade(db: IDBPDatabase<MyDb>, oldVersion: number, newVersion: number | null, transaction: IDBPTransaction<MyDb>) {
        // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
        upgrade(db: IDBPDatabase<MyDb>, oldVersion: number, newVersion: number | null) {
          PFLog.log('IDB UPGRADE', oldVersion, newVersion);
          // TODO
          db.createObjectStore(that._dbMainName as typeof FAKE);
          // db.createObjectStore(FAKE_DB_MAIN_NAME);
        },
        // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
        blocked(): void {
          alert('IDB BLOCKED');
        },
        // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
        blocking(): void {
          alert('IDB BLOCKING');
        },
        // eslint-disable-next-line prefer-arrow/prefer-arrow-functions
        terminated(): void {
          alert('IDB TERMINATED');
        },
      });
    } catch (e) {
      this._isReady$.next(false);
      throw new Error(e as any);
    }

    this._isReady$.next(true);
    return this._db;
  }

  async teardown(): Promise<void> {
    this._db?.close();
  }

  async load<T>(key: string): Promise<T> {
    await this._afterReady();
    return await this._db.get(this._dbMainName as typeof FAKE, key);
  }

  async save<T>(key: string, data: T): Promise<void> {
    await this._afterReady();
    return await this._db.put(this._dbMainName as typeof FAKE, data, key);
  }

  async remove(key: string): Promise<unknown> {
    await this._afterReady();
    return await this._db.delete(this._dbMainName as typeof FAKE, key);
  }

  async loadAll<A extends Record<string, unknown>>(): Promise<A> {
    await this._afterReady();
    const data = await this._db.getAll(this._dbMainName as typeof FAKE);
    const keys = await this._db.getAllKeys(this._dbMainName as typeof FAKE);

    return keys.reduce<Record<string, unknown>>((acc, key, idx) => {
      acc[key as string] = data[idx]; // Ensure key is a string
      return acc;
    }, {}) as A;
  }

  async clearDatabase(): Promise<void> {
    await this._afterReady();
    await this._db.clear(this._dbMainName as typeof FAKE);
  }

  private async _afterReady(): Promise<void> {
    if (this._isReady$.value) {
      return;
    }
    // if (!this._db) {
    //   throw new DBNotInitialized();
    // }
    return new Promise<void>((resolve) => {
      const unsubscribe = this._isReady$.subscribe((isReady) => {
        if (isReady) {
          resolve();
          unsubscribe();
        }
      });
    });
  }
}
