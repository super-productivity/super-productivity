import { runDbUpgrade } from './db-upgrade';
import {
  DB_VERSION,
  FULL_STATE_OPS_META_KEY,
  STORE_NAMES,
  OPS_INDEXES,
} from './db-keys.const';
import { deleteDB, openDB } from 'idb';
import { OpType } from '../core/operation.types';

describe('runDbUpgrade', () => {
  // Mock store with index tracking
  const createMockStore = (): any => {
    const indexes: Map<string, { keyPath: string | string[]; options?: any }> = new Map();
    return {
      createIndex: jasmine
        .createSpy('createIndex')
        .and.callFake((name: string, keyPath: string | string[], options?: any) => {
          indexes.set(name, { keyPath, options });
        }),
      _indexes: indexes,
    };
  };

  // Creates linked mock db and transaction that share the same stores map
  const createMocks = (
    preExistingStores?: Map<string, any>,
  ): { db: any; tx: any; stores: Map<string, any> } => {
    const stores = preExistingStores || new Map();

    const db = {
      createObjectStore: jasmine
        .createSpy('createObjectStore')
        .and.callFake((name: string, options?: any) => {
          const store = createMockStore();
          stores.set(name, { store, options });
          return store;
        }),
      _stores: stores,
    };

    const tx = {
      objectStore: jasmine.createSpy('objectStore').and.callFake((name: string) => {
        const storeInfo = stores.get(name);
        if (!storeInfo) {
          throw new Error(`Store ${name} not found`);
        }
        return storeInfo.store;
      }),
    };

    return { db, tx, stores };
  };

  describe('version 1 upgrade (from version 0)', () => {
    it('should create ops store with keyPath and autoIncrement', () => {
      const { db, tx } = createMocks();

      runDbUpgrade(db, 0, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.OPS, {
        keyPath: 'seq',
        autoIncrement: true,
      });
    });

    it('should create byId index on ops store', () => {
      const { db, tx, stores } = createMocks();

      runDbUpgrade(db, 0, tx);

      const opsStore = stores.get(STORE_NAMES.OPS)?.store;
      expect(opsStore.createIndex).toHaveBeenCalledWith(OPS_INDEXES.BY_ID, 'op.id', {
        unique: true,
      });
    });

    it('should create bySyncedAt index on ops store', () => {
      const { db, tx, stores } = createMocks();

      runDbUpgrade(db, 0, tx);

      const opsStore = stores.get(STORE_NAMES.OPS)?.store;
      expect(opsStore.createIndex).toHaveBeenCalledWith(
        OPS_INDEXES.BY_SYNCED_AT,
        'syncedAt',
      );
    });

    it('should create state_cache store', () => {
      const { db, tx } = createMocks();

      runDbUpgrade(db, 0, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.STATE_CACHE, {
        keyPath: 'id',
      });
    });

    it('should create import_backup store', () => {
      const { db, tx } = createMocks();

      runDbUpgrade(db, 0, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.IMPORT_BACKUP, {
        keyPath: 'id',
      });
    });
  });

  describe('version 2 upgrade (from version 1)', () => {
    it('should create vector_clock store', () => {
      // Pre-existing stores from version 1
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 1, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.VECTOR_CLOCK);
    });

    it('should not recreate version 1 stores', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 1, tx);

      expect(db.createObjectStore).not.toHaveBeenCalledWith(
        STORE_NAMES.OPS,
        jasmine.anything(),
      );
      expect(db.createObjectStore).not.toHaveBeenCalledWith(
        STORE_NAMES.STATE_CACHE,
        jasmine.anything(),
      );
    });
  });

  describe('version 3 upgrade (from version 2)', () => {
    it('should add bySourceAndStatus index to existing ops store', () => {
      const existingOpsStore = createMockStore();
      const preExisting = new Map([[STORE_NAMES.OPS, { store: existingOpsStore }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 2, tx);

      expect(tx.objectStore).toHaveBeenCalledWith(STORE_NAMES.OPS);
      expect(existingOpsStore.createIndex).toHaveBeenCalledWith(
        OPS_INDEXES.BY_SOURCE_AND_STATUS,
        ['source', 'applicationStatus'],
      );
    });

    it('should not recreate version 1 or 2 stores', () => {
      const existingOpsStore = createMockStore();
      const preExisting = new Map([[STORE_NAMES.OPS, { store: existingOpsStore }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 2, tx);

      // Version 2 upgrade doesn't create any stores (only version 3+ run)
      // Version 3 only adds an index, doesn't create stores
      // Version 4 creates archive stores, version 5 profile_data,
      // version 6 client_id, version 7 meta.
      expect(db.createObjectStore).toHaveBeenCalledTimes(5);
      expect(db.createObjectStore).not.toHaveBeenCalledWith(
        STORE_NAMES.OPS,
        jasmine.anything(),
      );
      expect(db.createObjectStore).not.toHaveBeenCalledWith(STORE_NAMES.VECTOR_CLOCK);
    });
  });

  describe('version 4 upgrade (from version 3)', () => {
    it('should create archive_young store', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 3, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.ARCHIVE_YOUNG, {
        keyPath: 'id',
      });
    });

    it('should create archive_old store', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 3, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.ARCHIVE_OLD, {
        keyPath: 'id',
      });
    });
  });

  describe('version 5 upgrade (from version 4)', () => {
    it('should create profile_data store', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 4, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.PROFILE_DATA, {
        keyPath: 'id',
      });
    });
  });

  describe('version 6 upgrade (from version 5)', () => {
    it('should create client_id store', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 5, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.CLIENT_ID);
    });

    it('should not recreate stores before version 6', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 5, tx);

      expect(db.createObjectStore).toHaveBeenCalledTimes(2); // client_id, meta
      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.CLIENT_ID);
      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.META);
    });
  });

  describe('version 7 upgrade (from version 6)', () => {
    it('should create meta store', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 6, tx);

      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.META);
    });

    it('should not recreate earlier stores', () => {
      const preExisting = new Map([[STORE_NAMES.OPS, { store: createMockStore() }]]);
      const { db, tx } = createMocks(preExisting);

      runDbUpgrade(db, 6, tx);

      expect(db.createObjectStore).toHaveBeenCalledTimes(1);
    });

    it('should populate full-state metadata from existing ops', async () => {
      const dbName = `SUP_OPS_upgrade_meta_${Date.now()}_${Math.random()}`;
      await deleteDB(dbName);

      const v6Db = await openDB(dbName, 6, {
        upgrade: (db) => {
          const opStore = db.createObjectStore(STORE_NAMES.OPS, {
            keyPath: 'seq',
            autoIncrement: true,
          });
          opStore.createIndex(OPS_INDEXES.BY_ID, 'op.id', { unique: true });
          opStore.createIndex(OPS_INDEXES.BY_SYNCED_AT, 'syncedAt');
          opStore.createIndex(OPS_INDEXES.BY_SOURCE_AND_STATUS, [
            'source',
            'applicationStatus',
          ]);
        },
      });
      await v6Db.add(STORE_NAMES.OPS, {
        op: { id: '01900000-0000-7000-8000-000000000041', o: OpType.SyncImport },
        appliedAt: Date.now(),
        source: 'local',
      });
      await v6Db.add(STORE_NAMES.OPS, {
        op: { id: '01900000-0000-7000-8000-000000000043', o: OpType.Update },
        appliedAt: Date.now(),
        source: 'local',
      });
      await v6Db.add(STORE_NAMES.OPS, {
        op: { id: '01900000-0000-7000-8000-000000000042', o: OpType.BackupImport },
        appliedAt: Date.now(),
        source: 'remote',
        syncedAt: Date.now(),
      });
      v6Db.close();

      const v7Db = await openDB(dbName, 7, {
        upgrade: (db, oldVersion, _newVersion, tx) => runDbUpgrade(db, oldVersion, tx),
      });

      const meta = await v7Db.get(STORE_NAMES.META, FULL_STATE_OPS_META_KEY);
      expect(meta).toEqual({
        refs: [
          { opId: '01900000-0000-7000-8000-000000000041', seq: 1 },
          { opId: '01900000-0000-7000-8000-000000000042', seq: 3 },
        ],
        latest: { opId: '01900000-0000-7000-8000-000000000042', seq: 3 },
      });

      v7Db.close();
      await deleteDB(dbName);
    });
  });

  describe('version 9 downgrade barrier', () => {
    it('should reject a v8 reader after the v9 database has been opened', async () => {
      const dbName = `SUP_OPS_v9_barrier_${Date.now()}_${Math.random()}`;

      try {
        const currentDb = await openDB(dbName, DB_VERSION, {
          upgrade: (db, oldVersion, _newVersion, tx) => runDbUpgrade(db, oldVersion, tx),
        });
        currentDb.close();

        await expectAsync(openDB(dbName, 8)).toBeRejectedWith(
          jasmine.objectContaining({ name: 'VersionError' }),
        );
      } finally {
        await deleteDB(dbName);
      }
    });
  });

  describe('full upgrade path (from version 0)', () => {
    it('should create all stores and indexes when upgrading from version 0', () => {
      const { db, tx } = createMocks();

      runDbUpgrade(db, 0, tx);

      // Version 1 stores
      expect(db.createObjectStore).toHaveBeenCalledWith(
        STORE_NAMES.OPS,
        jasmine.anything(),
      );
      expect(db.createObjectStore).toHaveBeenCalledWith(
        STORE_NAMES.STATE_CACHE,
        jasmine.anything(),
      );
      expect(db.createObjectStore).toHaveBeenCalledWith(
        STORE_NAMES.IMPORT_BACKUP,
        jasmine.anything(),
      );

      // Version 2 store
      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.VECTOR_CLOCK);

      // Version 4 stores
      expect(db.createObjectStore).toHaveBeenCalledWith(
        STORE_NAMES.ARCHIVE_YOUNG,
        jasmine.anything(),
      );
      expect(db.createObjectStore).toHaveBeenCalledWith(
        STORE_NAMES.ARCHIVE_OLD,
        jasmine.anything(),
      );

      // Version 5 store
      expect(db.createObjectStore).toHaveBeenCalledWith(
        STORE_NAMES.PROFILE_DATA,
        jasmine.anything(),
      );

      // Version 6 store
      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.CLIENT_ID);

      // Version 7 store
      expect(db.createObjectStore).toHaveBeenCalledWith(STORE_NAMES.META);

      // Total: 9 stores created
      expect(db.createObjectStore).toHaveBeenCalledTimes(9);
    });

    it('should create all indexes on ops store when upgrading from version 0', () => {
      const { db, tx, stores } = createMocks();

      runDbUpgrade(db, 0, tx);

      const opsStore = stores.get(STORE_NAMES.OPS)?.store;

      // Version 1 indexes
      expect(opsStore.createIndex).toHaveBeenCalledWith(
        OPS_INDEXES.BY_ID,
        'op.id',
        jasmine.anything(),
      );
      expect(opsStore.createIndex).toHaveBeenCalledWith(
        OPS_INDEXES.BY_SYNCED_AT,
        'syncedAt',
      );

      // Version 3 index
      expect(opsStore.createIndex).toHaveBeenCalledWith(
        OPS_INDEXES.BY_SOURCE_AND_STATUS,
        ['source', 'applicationStatus'],
      );

      // Total: 3 indexes created
      expect(opsStore.createIndex).toHaveBeenCalledTimes(3);
    });
  });
});
