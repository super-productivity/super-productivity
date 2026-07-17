import { fakeAsync, TestBed, tick } from '@angular/core/testing';
import { IDBPDatabase, unwrap } from 'idb';
import { forceCloseDatabase } from 'fake-indexeddb';
import { OperationLogStoreService } from './operation-log-store.service';
import { VectorClockService } from '../sync/vector-clock.service';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
  EntityType,
  VectorClock,
} from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';
import {
  compareVectorClocks,
  incrementVectorClock,
  limitVectorClockSize,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { OP_LOG_DB_ADAPTER_FACTORY } from './op-log-db-adapter.token';
import { OpLogDbAdapter } from './op-log-db-adapter';
import { SqliteOpLogAdapter } from './sqlite-op-log-adapter';
import { createSqlJsDb } from './sql-js-db.test-helper';
import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRIES_NON_LOCK,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
  LOCK_NAMES,
  MAX_VECTOR_CLOCK_SIZE,
} from '../core/operation-log.const';
import { IndexedDBOpenError } from '../core/errors/indexed-db-open.error';
import {
  FULL_STATE_OPS_META_KEY,
  OPS_INDEXES,
  SINGLETON_KEY,
  STORE_NAMES,
} from './db-keys.const';
import { ArchiveModel } from '../../features/time-tracking/time-tracking.model';
import { LockService } from '../sync/lock.service';

describe('OperationLogStoreService', () => {
  let service: OperationLogStoreService;
  let vectorClockService: VectorClockService;
  let lockService: LockService;
  const mockClientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve('testClient'),
    getOrGenerateClientId: () => Promise.resolve('testClient'),
    clearCache: () => {},
  };

  // Helper to create test operations
  const createTestOperation = (overrides: Partial<Operation> = {}): Operation => ({
    id: uuidv7(),
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: 'task1',
    payload: { title: 'Test Task' },
    clientId: 'testClient',
    vectorClock: { testClient: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [
        OperationLogStoreService,
        VectorClockService,
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
      ],
    });
    service = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);
    lockService = TestBed.inject(LockService);
    await service.init();
    // Clear all data from previous tests to ensure test isolation
    await service._clearAllDataForTesting();
  });

  describe('initialization', () => {
    it('should initialize successfully', () => {
      expect(service).toBeTruthy();
    });

    it('should handle concurrent initialization calls safely', async () => {
      // Reset module to get a truly fresh (un-initialized) service instance
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          OperationLogStoreService,
          VectorClockService,
          { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        ],
      });
      const freshService = TestBed.inject(OperationLogStoreService);

      // Call init multiple times concurrently on a fresh instance
      const initPromises = [
        freshService.init(),
        freshService.init(),
        freshService.init(),
      ];

      // All should resolve without error
      await expectAsync(Promise.all(initPromises)).toBeResolved();
    });
  });

  describe('init backend selection (Phase B3)', () => {
    // Build a fresh service whose adapter comes from the given factory.
    const freshServiceWith = (adapter: OpLogDbAdapter): OperationLogStoreService => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          OperationLogStoreService,
          { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
          { provide: OP_LOG_DB_ADAPTER_FACTORY, useValue: () => adapter },
        ],
      });
      return TestBed.inject(OperationLogStoreService);
    };

    it('init()s a self-managing adapter (no adoptConnection) and opens NO IndexedDB', async () => {
      // SQLite-style backend: self-manages its handle, creates its schema via
      // init(), and never adopts a connection.
      const initSpy = jasmine.createSpy('init').and.resolveTo(undefined);
      const adapter = { init: initSpy } as unknown as OpLogDbAdapter;
      const svc = freshServiceWith(adapter);
      const openSpy = spyOn(
        svc as unknown as { _openDbOnce: () => Promise<unknown> },
        '_openDbOnce',
      );

      await svc.init();

      expect(initSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).not.toHaveBeenCalled();
      // No WebView IndexedDB connection is opened or cached on this path.
      expect((svc as unknown as { _db: unknown })._db).toBeUndefined();
    });

    it('opens + adopts a connection for an adopt-connection (IndexedDB) adapter', async () => {
      const initSpy = jasmine.createSpy('init').and.resolveTo(undefined);
      const adoptSpy = jasmine.createSpy('adoptConnection');
      const adapter = {
        init: initSpy,
        adoptConnection: adoptSpy,
      } as unknown as OpLogDbAdapter;
      const svc = freshServiceWith(adapter);
      const fakeDb = { addEventListener: (): void => {} };
      spyOn(
        svc as unknown as { _openDbOnce: () => Promise<unknown> },
        '_openDbOnce',
      ).and.resolveTo(fakeDb);

      await svc.init();

      expect(adoptSpy).toHaveBeenCalledWith(fakeDb);
      // The IndexedDB backend does NOT use the adapter's own init() (its schema
      // comes from the IDB upgrade on the adopted connection).
      expect(initSpy).not.toHaveBeenCalled();
      expect((svc as unknown as { _db: unknown })._db).toBe(fakeDb);
    });
  });

  describe('connection lifecycle handlers', () => {
    // Open the connection through the lazy `_ensureInit()` path so `_initPromise`
    // is genuinely populated (the `beforeEach` above uses a direct `init()`,
    // which leaves it unset — making an `_initPromise` assertion vacuous).
    const openViaLazyInit = async (): Promise<void> => {
      (service as any)._db = undefined;
      (service as any)._initPromise = undefined;
      await service.getLastSeq();
    };

    it('closes the connection and clears cached state on versionchange, then reopens', async () => {
      await openViaLazyInit();
      expect((service as any)._db).toBeDefined();
      expect((service as any)._initPromise).toBeDefined();

      const raw = unwrap((service as any)._db as IDBPDatabase);
      // fake-indexeddb's FakeEventTarget rejects native DOM `Event` (no
      // `initialized` flag), so dispatch its own `IDBVersionChangeEvent`
      // (installed globally by `fake-indexeddb/auto`) which derives from
      // the polyfill's `FakeEvent`.
      raw.dispatchEvent(
        new IDBVersionChangeEvent('versionchange', { oldVersion: 1, newVersion: 2 }),
      );

      // The handler runs synchronously: cached state cleared and the
      // connection actually closed (so it cannot block a schema upgrade).
      expect((service as any)._db).toBeUndefined();
      expect((service as any)._initPromise).toBeUndefined();
      let txError: unknown;
      try {
        raw.transaction(STORE_NAMES.OPS, 'readonly');
      } catch (e) {
        txError = e;
      }
      expect((txError as DOMException | undefined)?.name).toBe('InvalidStateError');

      // The next access transparently reopens the connection.
      await expectAsync(service.getLastSeq()).toBeResolved();
    });

    it('clears cached state on the browser close event, then reopens', async () => {
      await openViaLazyInit();

      const raw = unwrap((service as any)._db as IDBPDatabase);
      // Drive the spec-compliant forced-close path; fake-indexeddb fires a real
      // `close` event through its internal pipeline (unlike dispatchEvent of a
      // synthetic DOM Event, which its FakeEventTarget shim rejects). The cast
      // works around an incorrect `(db: typeof FDBDatabase)` type declaration
      // in fake-indexeddb's types.d.ts — the runtime expects an instance.
      forceCloseDatabase(raw as unknown as Parameters<typeof forceCloseDatabase>[0]);
      // Let queued tasks (connection bookkeeping) settle before reopening.
      await new Promise((r) => setTimeout(r, 0));

      expect((service as any)._db).toBeUndefined();
      expect((service as any)._initPromise).toBeUndefined();
      await expectAsync(service.getLastSeq()).toBeResolved();
    });
  });

  describe('unsynced/synced/rejected transitions', () => {
    it('should expose unsynced, synced, and rejected transitions through service methods', async () => {
      const port: Pick<
        OperationLogStoreService,
        'getUnsynced' | 'markSynced' | 'markRejected'
      > = service;
      const syncedOp = createTestOperation({ entityId: 'synced-task' });
      const rejectedOp = createTestOperation({ entityId: 'rejected-task' });

      await service.append(syncedOp);
      await service.append(rejectedOp);

      const initialUnsynced = await port.getUnsynced();
      expect(initialUnsynced.map((entry) => entry.op.id)).toEqual([
        syncedOp.id,
        rejectedOp.id,
      ]);

      const syncedEntry = initialUnsynced.find((entry) => entry.op.id === syncedOp.id);
      expect(syncedEntry).toBeDefined();
      if (!syncedEntry) {
        fail('Expected synced operation entry to exist');
        return;
      }

      await port.markSynced([syncedEntry.seq]);
      await port.markRejected([rejectedOp.id]);

      expect(await port.getUnsynced()).toEqual([]);
    });
  });

  describe('append', () => {
    it('should append operation to log', async () => {
      const op = createTestOperation();
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.id).toBe(op.id);
    });

    it('should auto-increment sequence number', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      const op3 = createTestOperation({ entityId: 'task3' });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(3);
      expect(ops[0].seq).toBeLessThan(ops[1].seq);
      expect(ops[1].seq).toBeLessThan(ops[2].seq);
    });

    it('should set appliedAt timestamp', async () => {
      const beforeTime = Date.now();
      const op = createTestOperation();
      await service.append(op);
      const afterTime = Date.now();

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].appliedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(ops[0].appliedAt).toBeLessThanOrEqual(afterTime);
    });

    it('should set source to local by default', async () => {
      const op = createTestOperation();
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].source).toBe('local');
      expect(ops[0].syncedAt).toBeUndefined();
    });

    it('should set syncedAt when source is remote', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote');

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].source).toBe('remote');
      expect(ops[0].syncedAt).toBeDefined();
    });

    it('should atomically append a legacy recovery with its snapshot and clock', async () => {
      const op = createTestOperation({
        id: 'legacy-recovery-op',
        vectorClock: { testClient: 7 },
      });
      const state = { task: { ids: ['task-1'] } };

      const seq = await service.appendRecoveryOperationAndSnapshot(op, state);

      expect((await service.getOpById(op.id))?.seq).toBe(seq);
      expect(await service.loadStateCache()).toEqual(
        jasmine.objectContaining({
          state,
          lastAppliedOpSeq: seq,
          vectorClock: op.vectorClock,
          schemaVersion: op.schemaVersion,
        }),
      );
      expect(await service.getVectorClock()).toEqual(op.vectorClock);
    });

    it('should roll back the recovery operation when its snapshot write fails', async () => {
      const op = createTestOperation({ id: 'failed-legacy-recovery-op' });
      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const originalTransaction = adapter.transaction.bind(adapter);
      spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
        originalTransaction(stores, mode, async (tx) => {
          const failingTx = new Proxy(tx, {
            get: (target, property): unknown => {
              if (property === 'put') {
                return async (store: string, value: unknown, key?: string | number) => {
                  if (store === STORE_NAMES.STATE_CACHE) {
                    throw new Error('injected recovery snapshot failure');
                  }
                  return target.put(store, value, key);
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(failingTx);
        }),
      );

      await expectAsync(
        service.appendRecoveryOperationAndSnapshot(op, { task: {} }),
      ).toBeRejectedWithError('injected recovery snapshot failure');

      expect(await service.getOpsAfterSeq(0)).toEqual([]);
      expect(await service.loadStateCache()).toBeNull();
    });

    it('should roll back the recovery operation and snapshot when its clock write fails', async () => {
      const op = createTestOperation({ id: 'failed-recovery-clock-op' });
      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const originalTransaction = adapter.transaction.bind(adapter);
      spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
        originalTransaction(stores, mode, async (tx) => {
          const failingTx = new Proxy(tx, {
            get: (target, property): unknown => {
              if (property === 'put') {
                return async (store: string, value: unknown, key?: string | number) => {
                  if (store === STORE_NAMES.VECTOR_CLOCK) {
                    throw new Error('injected recovery clock failure');
                  }
                  return target.put(store, value, key);
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(failingTx);
        }),
      );

      await expectAsync(
        service.appendRecoveryOperationAndSnapshot(op, { task: {} }),
      ).toBeRejectedWithError('injected recovery clock failure');

      expect(await service.getOpsAfterSeq(0)).toEqual([]);
      expect(await service.loadStateCache()).toBeNull();
      expect(await service.getVectorClock()).toBeNull();
    });
  });

  describe('hasOp', () => {
    it('should return true for existing operations', async () => {
      const op = createTestOperation();
      await service.append(op);

      expect(await service.hasOp(op.id)).toBe(true);
    });

    it('should return false for non-existing operations', async () => {
      expect(await service.hasOp('nonExistentId')).toBe(false);
    });
  });

  describe('filterNewOps', () => {
    it('should return all ops when none exist in store', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      const result = await service.filterNewOps([op1, op2]);

      expect(result.length).toBe(2);
      expect(result).toContain(op1);
      expect(result).toContain(op2);
    });

    it('should filter out ops that already exist', async () => {
      const existingOp = createTestOperation({ entityId: 'existing' });
      const newOp = createTestOperation({ entityId: 'new' });

      await service.append(existingOp);

      const result = await service.filterNewOps([existingOp, newOp]);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe(newOp.id);
    });

    it('should return empty array when all ops exist', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const result = await service.filterNewOps([op1, op2]);

      expect(result.length).toBe(0);
    });

    it('should return empty array for empty input', async () => {
      const result = await service.filterNewOps([]);
      expect(result.length).toBe(0);
    });
  });

  describe('getOpsAfterSeq', () => {
    it('should return all operations after given sequence', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      const op3 = createTestOperation({ entityId: 'task3' });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      const allOps = await service.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3);

      // Get ops after the first one
      const opsAfterFirst = await service.getOpsAfterSeq(allOps[0].seq);
      expect(opsAfterFirst.length).toBe(2);
    });

    it('should return empty array if no ops after sequence', async () => {
      const op = createTestOperation();
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      const opsAfterLast = await service.getOpsAfterSeq(ops[0].seq);
      expect(opsAfterLast.length).toBe(0);
    });
  });

  describe('getUnsynced', () => {
    it('should return only unsynced local operations', async () => {
      const localOp = createTestOperation({ entityId: 'localTask' });
      const remoteOp = createTestOperation({ entityId: 'remoteTask' });

      await service.append(localOp, 'local');
      await service.append(remoteOp, 'remote');

      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.entityId).toBe('localTask');
    });

    it('should exclude rejected operations', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);
      await service.markRejected([op1.id]);

      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(1);
      expect(unsynced[0].op.entityId).toBe('task2');
    });
  });

  describe('getUnsyncedByEntity', () => {
    it('should group unsynced ops by entity', async () => {
      const taskOp1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
      });
      const taskOp2 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
      });
      const projectOp = createTestOperation({
        entityType: 'PROJECT' as EntityType,
        entityId: 'proj1',
      });

      await service.append(taskOp1);
      await service.append(taskOp2);
      await service.append(projectOp);

      const unsyncedByEntity = await service.getUnsyncedByEntity();
      expect(unsyncedByEntity.get('TASK:task1')?.length).toBe(2);
      expect(unsyncedByEntity.get('PROJECT:proj1')?.length).toBe(1);
    });
  });

  describe('getAppliedOpIds', () => {
    it('should return set of all operation IDs', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const appliedIds = await service.getAppliedOpIds();
      expect(appliedIds.has(op1.id)).toBe(true);
      expect(appliedIds.has(op2.id)).toBe(true);
      expect(appliedIds.size).toBe(2);
    });
  });

  describe('markSynced', () => {
    it('should update syncedAt timestamp for given sequences', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].syncedAt).toBeUndefined();

      await service.markSynced([ops[0].seq]);

      const opsAfterMark = await service.getOpsAfterSeq(0);
      expect(opsAfterMark[0].syncedAt).toBeDefined();
      expect(opsAfterMark[1].syncedAt).toBeUndefined();
    });
  });

  describe('markRejected', () => {
    it('should update rejectedAt timestamp for given operation IDs', async () => {
      const op = createTestOperation();
      await service.append(op);

      const opsBefore = await service.getOpsAfterSeq(0);
      expect(opsBefore[0].rejectedAt).toBeUndefined();

      await service.markRejected([op.id]);

      const opsAfter = await service.getOpsAfterSeq(0);
      expect(opsAfter[0].rejectedAt).toBeDefined();
    });
  });

  describe('deleteOpsWhere', () => {
    it('should delete operations matching predicate', async () => {
      const op1 = createTestOperation({ actionType: '[Task] Create' as ActionType });
      const op2 = createTestOperation({ actionType: '[Task] Update' as ActionType });
      const op3 = createTestOperation({ actionType: '[Task] Create' as ActionType });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      await service.deleteOpsWhere(
        (entry) => entry.op.actionType === ('[Task] Create' as ActionType),
      );

      const remaining = await service.getOpsAfterSeq(0);
      expect(remaining.length).toBe(1);
      expect(remaining[0].op.actionType).toBe('[Task] Update' as ActionType);
    });

    it('should clear full-state metadata when deleting a full-state op', async () => {
      const syncImportOp = createTestOperation({
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await service.append(syncImportOp);
      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(syncImportOp.id);

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const transactionSpy = spyOn(adapter, 'transaction').and.callThrough();

      await service.deleteOpsWhere((entry) => entry.op.id === syncImportOp.id);

      spyOn(adapter, 'iterate').and.callThrough();

      expect(await service.getLatestFullStateOpEntry()).toBeUndefined();
      expect(transactionSpy).toHaveBeenCalledWith(
        [STORE_NAMES.OPS, STORE_NAMES.META],
        'readwrite',
        jasmine.any(Function),
      );
      expect(adapter.iterate).not.toHaveBeenCalled();
    });
  });

  describe('getLastSeq', () => {
    it('should return 0 when no operations exist', async () => {
      const lastSeq = await service.getLastSeq();
      expect(lastSeq).toBe(0);
    });

    it('should return last sequence number', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.append(op1);
      await service.append(op2);

      const allOps = await service.getOpsAfterSeq(0);
      const lastSeq = await service.getLastSeq();
      expect(lastSeq).toBe(allOps[allOps.length - 1].seq);
    });
  });

  describe('getLatestFullStateOpEntry', () => {
    it('should read latest full-state op via metadata without scanning ops', async () => {
      const oldImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000001',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const regularOp = createTestOperation({
        id: '01900000-0000-7000-8000-000000000002',
      });
      const latestImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000003',
        opType: OpType.BackupImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });

      await service.append(oldImport);
      await service.append(regularOp);
      await service.append(latestImport, 'remote');

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      const latestEntry = await service.getLatestFullStateOpEntry();

      expect(latestEntry?.op.id).toBe(latestImport.id);
      expect(latestEntry?.source).toBe('remote');
      expect(latestEntry?.syncedAt).toBeDefined();
      expect(adapter.iterate).not.toHaveBeenCalled();
    });

    it('should rebuild missing metadata once and use it for subsequent reads', async () => {
      const latestImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000011',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await service.append(
        createTestOperation({ id: '01900000-0000-7000-8000-000000000010' }),
      );
      await service.append(latestImport);

      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      await db.delete('meta', 'full_state_ops');

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(latestImport.id);
      expect(adapter.iterate).toHaveBeenCalledTimes(1);

      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(latestImport.id);
      expect(adapter.iterate).toHaveBeenCalledTimes(1);
    });

    it('should rebuild missing metadata inside a full-state append before recording the new ref', async () => {
      const latestExistingImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000032',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const lowerNewImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000031',
        opType: OpType.BackupImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });

      await service.append(latestExistingImport);
      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      await db.delete(STORE_NAMES.META, FULL_STATE_OPS_META_KEY);

      await service.append(lowerNewImport, 'remote');

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(lowerNewImport.id);
      expect(adapter.iterate).not.toHaveBeenCalled();
    });

    it('should ignore a rejected full-state op when choosing the active baseline', async () => {
      const priorImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000051',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const rejectedRepair = createTestOperation({
        id: '01900000-0000-7000-8000-000000000052',
        opType: OpType.Repair,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });

      await service.append(priorImport, 'remote');
      await service.append(rejectedRepair);
      await service.markRejected([rejectedRepair.id]);

      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(priorImport.id);
    });

    it('should expose the latest rejected local full-state operation as an upload barrier', async () => {
      const rejectedImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000053',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const rejectedRepair = createTestOperation({
        id: '01900000-0000-7000-8000-000000000054',
        opType: OpType.Repair,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const rejectedRemoteImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000055',
        opType: OpType.BackupImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });

      await service.append(rejectedImport);
      await service.append(rejectedRepair);
      await service.append(rejectedRemoteImport, 'remote');
      await service.markRejected([
        rejectedImport.id,
        rejectedRepair.id,
        rejectedRemoteImport.id,
      ]);

      expect((await service.getLatestRejectedFullStateOpEntry())?.op.id).toBe(
        rejectedRepair.id,
      );
    });

    it('should rebuild malformed metadata instead of throwing', async () => {
      const latestImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000041',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await service.append(latestImport);

      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      await db.put(STORE_NAMES.META, { refs: 'not-an-array' }, FULL_STATE_OPS_META_KEY);

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      await expectAsync(service.getLatestFullStateOpEntry()).toBeResolved();
      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(latestImport.id);
      expect(adapter.iterate).toHaveBeenCalledTimes(1);
    });

    it('should delete stale full-state ops via metadata and keep the excluded op', async () => {
      const staleImportA = createTestOperation({
        id: '01900000-0000-7000-8000-000000000021',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const staleImportB = createTestOperation({
        id: '01900000-0000-7000-8000-000000000022',
        opType: OpType.Repair,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const keepImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000023',
        opType: OpType.BackupImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });

      await service.append(staleImportA);
      await service.append(
        createTestOperation({ id: '01900000-0000-7000-8000-000000000024' }),
      );
      await service.append(staleImportB);
      await service.append(keepImport);

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      const deletedCount = await service.clearFullStateOpsExcept([keepImport.id]);

      expect(deletedCount).toBe(2);
      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(keepImport.id);
      expect((await service.getOpsAfterSeq(0)).map((entry) => entry.op.id)).toEqual([
        '01900000-0000-7000-8000-000000000024',
        keepImport.id,
      ]);
      expect(adapter.iterate).not.toHaveBeenCalled();
    });
  });

  // The full-state metadata pointer is adapter-agnostic, but the rest of this
  // suite drives it through the IndexedDB adapter. These tests pin the SAME
  // behavior through the SQLite adapter (Android default, #8389) against a real
  // engine (sql.js) — including the rebuild-on-read fallback, which is what
  // keeps the pointer correct on SQLite (the IndexedDB-only populate-on-upgrade
  // seed in db-upgrade.ts never runs there).
  describe('full-state metadata over the SQLite backend', () => {
    const freshSqliteService = async (): Promise<{
      svc: OperationLogStoreService;
      adapter: OpLogDbAdapter;
    }> => {
      const adapter = new SqliteOpLogAdapter(await createSqlJsDb());
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          OperationLogStoreService,
          { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
          { provide: OP_LOG_DB_ADAPTER_FACTORY, useValue: () => adapter },
        ],
      });
      const svc = TestBed.inject(OperationLogStoreService);
      await svc.init();
      return { svc, adapter };
    };

    it('tracks the latest full-state op by UUIDv7 without scanning', async () => {
      const { svc, adapter } = await freshSqliteService();
      await svc.append(
        createTestOperation({
          id: '01900000-0000-7000-8000-000000000001',
          opType: OpType.SyncImport,
          entityType: 'ALL' as EntityType,
          entityId: undefined,
        }),
      );
      await svc.append(
        createTestOperation({ id: '01900000-0000-7000-8000-000000000002' }),
      );
      const latestImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000003',
        opType: OpType.BackupImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await svc.append(latestImport, 'remote');

      const iterateSpy = spyOn(adapter, 'iterate').and.callThrough();

      const latestEntry = await svc.getLatestFullStateOpEntry();
      expect(latestEntry?.op.id).toBe(latestImport.id);
      expect(latestEntry?.source).toBe('remote');
      expect(iterateSpy).not.toHaveBeenCalled();
    });

    it('rebuilds the pointer on read when the meta row is absent', async () => {
      const { svc, adapter } = await freshSqliteService();
      await svc.append(
        createTestOperation({ id: '01900000-0000-7000-8000-000000000012' }),
      );
      const latestImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000013',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await svc.append(latestImport);

      // Simulate the SQLite/migration state where the pointer was never seeded
      // (the IndexedDB-only upgrade populate doesn't run on this backend).
      await adapter.delete(STORE_NAMES.META, FULL_STATE_OPS_META_KEY);

      const iterateSpy = spyOn(adapter, 'iterate').and.callThrough();
      expect((await svc.getLatestFullStateOpEntry())?.op.id).toBe(latestImport.id);
      expect(iterateSpy).toHaveBeenCalledTimes(1);

      // The rebuild persisted the pointer → the second read does not scan again.
      expect((await svc.getLatestFullStateOpEntry())?.op.id).toBe(latestImport.id);
      expect(iterateSpy).toHaveBeenCalledTimes(1);
    });

    it('clears full-state ops through the metadata pointer', async () => {
      const { svc, adapter } = await freshSqliteService();
      await svc.append(
        createTestOperation({
          id: '01900000-0000-7000-8000-000000000021',
          opType: OpType.SyncImport,
          entityType: 'ALL' as EntityType,
          entityId: undefined,
        }),
      );
      await svc.append(
        createTestOperation({ id: '01900000-0000-7000-8000-000000000022' }),
      );

      const iterateSpy = spyOn(adapter, 'iterate').and.callThrough();

      expect(await svc.clearFullStateOps()).toBe(1);
      expect(await svc.getLatestFullStateOpEntry()).toBeUndefined();
      expect((await svc.getOpsAfterSeq(0)).map((entry) => entry.op.id)).toEqual([
        '01900000-0000-7000-8000-000000000022',
      ]);
      expect(iterateSpy).not.toHaveBeenCalled();
    });
  });

  describe('state cache', () => {
    it('should save and load state cache', async () => {
      const testState = { task: { ids: ['1'], entities: { id1: { id: '1' } } } };
      const vectorClock: VectorClock = { client1: 5 };

      await service.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 100,
        vectorClock,
        compactedAt: Date.now(),
        schemaVersion: 1,
      });

      const loaded = await service.loadStateCache();
      expect(loaded).not.toBeNull();
      expect(loaded!.state).toEqual(testState);
      expect(loaded!.lastAppliedOpSeq).toBe(100);
      expect(loaded!.vectorClock).toEqual(vectorClock);
    });

    it('should return null when no state cache exists', async () => {
      const loaded = await service.loadStateCache();
      expect(loaded).toBeNull();
    });
  });

  describe('migration safety backup', () => {
    it('should save and restore backup', async () => {
      const testState = { task: { ids: ['1'], entities: {} } };

      await service.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 50,
        vectorClock: { client1: 3 },
        compactedAt: Date.now(),
        schemaVersion: 1,
      });

      await service.saveStateCacheBackup();
      expect(await service.hasStateCacheBackup()).toBe(true);

      // Modify current state
      await service.saveStateCache({
        state: { modified: true },
        lastAppliedOpSeq: 100,
        vectorClock: { client1: 10 },
        compactedAt: Date.now(),
        schemaVersion: 2,
      });

      // Restore backup
      await service.restoreStateCacheFromBackup();

      const restored = await service.loadStateCache();
      expect(restored!.lastAppliedOpSeq).toBe(50);
      expect(restored!.state).toEqual(testState);
    });

    it('should clear backup after successful operation', async () => {
      const testState = { task: { ids: [], entities: {} } };

      await service.saveStateCache({
        state: testState,
        lastAppliedOpSeq: 10,
        vectorClock: {},
        compactedAt: Date.now(),
      });

      await service.saveStateCacheBackup();
      expect(await service.hasStateCacheBackup()).toBe(true);

      await service.clearStateCacheBackup();
      expect(await service.hasStateCacheBackup()).toBe(false);
    });
  });

  describe('compaction counter', () => {
    it('should start at 0 when no state cache exists', async () => {
      const count = await service.getCompactionCounter();
      expect(count).toBe(0);
    });

    it('should increment counter', async () => {
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: Date.now(),
      });

      const count1 = await service.incrementCompactionCounter();
      expect(count1).toBe(1);

      const count2 = await service.incrementCompactionCounter();
      expect(count2).toBe(2);

      const count3 = await service.getCompactionCounter();
      expect(count3).toBe(2);
    });

    it('should persist counter when no state cache exists (regression test)', async () => {
      // This tests the fix for the bug where incrementCompactionCounter()
      // returned 1 without persisting when no cache existed.
      // Without the fix, each call would return 1 (counter never progressed).

      // No state cache exists yet - verify counter starts at 0
      expect(await service.getCompactionCounter()).toBe(0);

      // First increment should return 1 AND persist it
      const count1 = await service.incrementCompactionCounter();
      expect(count1).toBe(1);

      // Verify it was actually persisted
      const persistedCount1 = await service.getCompactionCounter();
      expect(persistedCount1).toBe(1);

      // Second increment should return 2 (not 1 again!)
      const count2 = await service.incrementCompactionCounter();
      expect(count2).toBe(2);

      // Verify it was persisted
      const persistedCount2 = await service.getCompactionCounter();
      expect(persistedCount2).toBe(2);

      // Third increment to be sure
      const count3 = await service.incrementCompactionCounter();
      expect(count3).toBe(3);
    });

    it('should reset counter', async () => {
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: Date.now(),
      });

      await service.incrementCompactionCounter();
      await service.incrementCompactionCounter();
      await service.resetCompactionCounter();

      const count = await service.getCompactionCounter();
      expect(count).toBe(0);
    });

    // =========================================================================
    // Regression test: incrementCompactionCounter counter-only cache handling
    // =========================================================================
    // When incrementCompactionCounter creates a cache entry just to track the
    // counter, loadStateCache should return null since there's no valid snapshot.
    // This prevents unnecessary recovery paths on startup.

    it('should not expose invalid snapshot when incrementCompactionCounter creates counter-only cache', async () => {
      // No state cache exists yet
      const beforeCache = await service.loadStateCache();
      expect(beforeCache).toBeNull();

      // Increment the compaction counter (simulating operation writes before first compaction)
      await service.incrementCompactionCounter();

      // Now check what loadStateCache returns
      const afterCache = await service.loadStateCache();

      // loadStateCache should return null since the cache has state: null
      // (counter-only entry, not a real snapshot)
      expect(afterCache).toBeNull();
    });

    it('should still track compaction counter even when loadStateCache returns null', async () => {
      // Increment counter without a real snapshot existing
      await service.incrementCompactionCounter();
      await service.incrementCompactionCounter();
      await service.incrementCompactionCounter();

      // loadStateCache returns null (no valid snapshot)
      const cache = await service.loadStateCache();
      expect(cache).toBeNull();

      // But the counter should still be tracked correctly
      const counter = await service.getCompactionCounter();
      expect(counter).toBe(3);
    });
  });

  describe('VectorClockService.getCurrentVectorClock', () => {
    it('should return empty clock when no data exists', async () => {
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({});
    });

    it('should merge clocks from snapshot and ops', async () => {
      // Save snapshot with initial clock
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { clientA: 5, clientB: 3 },
        compactedAt: Date.now(),
      });

      // Add ops with newer clocks
      const op1 = createTestOperation({
        clientId: 'clientA',
        vectorClock: { clientA: 6, clientB: 3 },
      });
      const op2 = createTestOperation({
        clientId: 'clientB',
        vectorClock: { clientA: 6, clientB: 4 },
      });

      await service.append(op1);
      await service.append(op2);

      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock.clientA).toBe(6);
      expect(clock.clientB).toBe(4);
    });
  });

  describe('VectorClockService.getEntityFrontier', () => {
    it('should return empty map when no ops exist', async () => {
      const frontier = await vectorClockService.getEntityFrontier();
      expect(frontier.size).toBe(0);
    });

    it('should return frontier per entity', async () => {
      const op1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        vectorClock: { clientA: 1 },
      });
      const op2 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        vectorClock: { clientA: 2 },
      });
      const op3 = createTestOperation({
        entityType: 'PROJECT' as EntityType,
        entityId: 'proj1',
        vectorClock: { clientA: 3 },
      });

      await service.append(op1);
      await service.append(op2);
      await service.append(op3);

      const frontier = await vectorClockService.getEntityFrontier();
      expect(frontier.get('TASK:task1')).toEqual({ clientA: 2 }); // Latest for task1
      expect(frontier.get('PROJECT:proj1')).toEqual({ clientA: 3 });
    });

    it('should filter by entity type and id when provided', async () => {
      const op1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task1',
        vectorClock: { clientA: 1 },
      });
      const op2 = createTestOperation({
        entityType: 'PROJECT' as EntityType,
        entityId: 'proj1',
        vectorClock: { clientA: 2 },
      });

      await service.append(op1);
      await service.append(op2);

      const taskFrontier = await vectorClockService.getEntityFrontier(
        'TASK' as EntityType,
      );
      expect(taskFrontier.size).toBe(1);
      expect(taskFrontier.has('TASK:task1')).toBe(true);
      expect(taskFrontier.has('PROJECT:proj1')).toBe(false);
    });
  });

  describe('transaction atomicity', () => {
    it('should maintain consistency after failed saveStateCache', async () => {
      const op = createTestOperation();
      await service.append(op);

      // Save initial state cache
      await service.saveStateCache({
        state: { initial: true },
        lastAppliedOpSeq: 1,
        vectorClock: { client: 1 },
        compactedAt: Date.now(),
        schemaVersion: 1,
      });

      // Operations should still be accessible
      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.id).toBe(op.id);
    });

    it('should handle concurrent append operations safely', async () => {
      const ops = Array.from({ length: 10 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );

      // Append all concurrently
      await Promise.all(ops.map((op) => service.append(op)));

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(10);

      // All should have unique sequence numbers
      const seqNumbers = storedOps.map((op) => op.seq);
      const uniqueSeqs = new Set(seqNumbers);
      expect(uniqueSeqs.size).toBe(10);
    });

    it('should handle concurrent markSynced operations safely', async () => {
      const ops = Array.from({ length: 5 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );

      for (const op of ops) {
        await service.append(op);
      }

      const storedOps = await service.getOpsAfterSeq(0);
      const seqNumbers = storedOps.map((op) => op.seq);

      // Mark synced concurrently
      await Promise.all(seqNumbers.map((seq) => service.markSynced([seq])));

      // All should be synced
      const afterSync = await service.getOpsAfterSeq(0);
      for (const entry of afterSync) {
        expect(entry.syncedAt).toBeDefined();
      }
    });
  });

  describe('appendBatch', () => {
    it('should append multiple operations in a single transaction', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
        createTestOperation({ entityId: 'task3' }),
      ];

      const seqs = await service.appendBatch(ops);

      expect(seqs.length).toBe(3);
      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(3);
    });

    it('should return sequential sequence numbers', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
      ];

      const seqs = await service.appendBatch(ops);

      expect(seqs[1]).toBe(seqs[0] + 1);
    });

    it('should set source and syncedAt for remote batch', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
      ];

      await service.appendBatch(ops, 'remote');

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps[0].source).toBe('remote');
      expect(storedOps[0].syncedAt).toBeDefined();
      expect(storedOps[1].source).toBe('remote');
      expect(storedOps[1].syncedAt).toBeDefined();
    });

    it('should set applicationStatus to pending when pendingApply is true', async () => {
      const ops = [createTestOperation({ entityId: 'task1' })];

      await service.appendBatch(ops, 'remote', { pendingApply: true });

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps[0].applicationStatus).toBe('pending');
    });

    it('should handle empty array', async () => {
      const seqs = await service.appendBatch([]);

      expect(seqs).toEqual([]);
    });

    it('should throw on duplicate operation IDs', async () => {
      const ops = [createTestOperation(), createTestOperation()];

      // Insert first time - should succeed
      const seqs1 = await service.appendBatch(ops, 'remote');
      expect(seqs1.length).toBe(2);

      // Insert same ops again - should throw
      await expectAsync(service.appendBatch(ops, 'remote')).toBeRejectedWithError(
        /Duplicate operation detected/,
      );

      // Original ops should still be in store
      const allOps = await service.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);
    });

    // =========================================================================
    // Regression test: appliedOpIds cache must be invalidated on ConstraintError
    // =========================================================================
    // Issue #6213: When appendBatch throws ConstraintError, the appliedOpIds cache
    // becomes stale (it doesn't know about ops from a previous failed sync).
    // The cache must be invalidated so filterNewOps returns correct results.

    it('should invalidate appliedOpIds cache on ConstraintError to fix sync retry (issue #6213)', async () => {
      // Setup: Insert some ops initially
      const existingOps = [createTestOperation(), createTestOperation()];
      await service.appendBatch(existingOps, 'remote');

      // Prime the appliedOpIds cache by calling filterNewOps
      const appliedIds1 = await service.getAppliedOpIds();
      expect(appliedIds1.size).toBe(2);

      // Now try to insert a batch that includes a duplicate (simulating stale cache scenario)
      const newOp = createTestOperation();
      const mixedOps = [existingOps[0], newOp]; // One duplicate, one new

      // This should throw ConstraintError
      await expectAsync(service.appendBatch(mixedOps, 'remote')).toBeRejectedWithError(
        /Duplicate operation detected/,
      );

      // After the error, filterNewOps should still work correctly
      // The cache should have been invalidated, so it will rebuild from IndexedDB
      const newOps = await service.filterNewOps(mixedOps);

      // Only the new op should be returned (the duplicate should be filtered out)
      expect(newOps.length).toBe(1);
      expect(newOps[0].id).toBe(newOp.id);
    });

    it('should allow successful retry after ConstraintError invalidates cache (issue #6213)', async () => {
      // Simulate: ops were written in a previous session but cache doesn't know about them
      const previouslyWrittenOps = [createTestOperation(), createTestOperation()];
      await service.appendBatch(previouslyWrittenOps, 'remote');

      // Prime cache
      await service.getAppliedOpIds();

      // First sync attempt: mix of duplicates and new ops - fails
      const newOp = createTestOperation();
      const firstAttemptOps = [previouslyWrittenOps[0], newOp];
      await expectAsync(
        service.appendBatch(firstAttemptOps, 'remote'),
      ).toBeRejectedWithError(/Duplicate operation detected/);

      // Retry: filter first, then append only new ops - should succeed
      const trulyNewOps = await service.filterNewOps(firstAttemptOps);
      expect(trulyNewOps.length).toBe(1);

      const seqs = await service.appendBatch(trulyNewOps, 'remote');
      expect(seqs.length).toBe(1);

      // Verify final state
      const allOps = await service.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3); // 2 original + 1 new
    });
  });

  describe('appendBatchSkipDuplicates', () => {
    it('should write new ops and return their seqs', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
      ];

      const result = await service.appendBatchSkipDuplicates(ops, 'remote');

      expect(result.seqs.length).toBe(2);
      expect(result.writtenOps.length).toBe(2);
      expect(result.skippedCount).toBe(0);

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(2);
    });

    it('should skip existing ops silently instead of throwing', async () => {
      const ops = [createTestOperation(), createTestOperation()];

      // Insert first time
      await service.appendBatch(ops, 'remote');

      // Insert same ops again with appendBatchSkipDuplicates - should NOT throw
      const result = await service.appendBatchSkipDuplicates(ops, 'remote');

      expect(result.seqs.length).toBe(0);
      expect(result.writtenOps.length).toBe(0);
      expect(result.skippedCount).toBe(2);

      // Original ops should still be in store (no duplicates)
      const allOps = await service.getOpsAfterSeq(0);
      expect(allOps.length).toBe(2);
    });

    it('should write new ops and skip duplicates in the same batch', async () => {
      const existingOps = [createTestOperation(), createTestOperation()];
      await service.appendBatch(existingOps, 'remote');

      const newOp = createTestOperation();
      const mixedOps = [existingOps[0], newOp, existingOps[1]];

      const result = await service.appendBatchSkipDuplicates(mixedOps, 'remote');

      expect(result.seqs.length).toBe(1);
      expect(result.writtenOps.length).toBe(1);
      expect(result.writtenOps[0].id).toBe(newOp.id);
      expect(result.skippedCount).toBe(2);

      const allOps = await service.getOpsAfterSeq(0);
      expect(allOps.length).toBe(3); // 2 original + 1 new
    });

    it('should handle empty array', async () => {
      const result = await service.appendBatchSkipDuplicates([]);

      expect(result.seqs).toEqual([]);
      expect(result.writtenOps).toEqual([]);
      expect(result.skippedCount).toBe(0);
    });

    it('should set source and syncedAt for remote ops', async () => {
      const ops = [createTestOperation()];

      await service.appendBatchSkipDuplicates(ops, 'remote');

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps[0].source).toBe('remote');
      expect(storedOps[0].syncedAt).toBeDefined();
    });

    it('should set applicationStatus to pending when pendingApply is true', async () => {
      const ops = [createTestOperation()];

      await service.appendBatchSkipDuplicates(ops, 'remote', { pendingApply: true });

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps[0].applicationStatus).toBe('pending');
    });

    it('should handle intra-batch duplicates (same op ID twice in one call)', async () => {
      const op = createTestOperation();
      const ops = [op, op]; // Same op twice

      const result = await service.appendBatchSkipDuplicates(ops, 'remote');

      expect(result.seqs.length).toBe(1);
      expect(result.writtenOps.length).toBe(1);
      expect(result.skippedCount).toBe(1);

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(1);
    });

    it('should append snapshot-included ops and atomically advance the state-cache frontier', async () => {
      const existingOp = createTestOperation({ id: 'snapshot-op-existing' });
      const newOp = createTestOperation({ id: 'snapshot-op-new' });
      await service.append(existingOp, 'remote');
      await service.saveStateCache({
        state: { task: { ids: ['task1'] } },
        lastAppliedOpSeq: 1,
        vectorClock: { testClient: 1 },
        compactedAt: 1,
      });

      const result = await service.appendSnapshotIncludedOps([existingOp, newOp]);

      expect(result.writtenOps).toEqual([newOp]);
      expect(result.skippedCount).toBe(1);
      expect((await service.loadStateCache())?.lastAppliedOpSeq).toBe(2);
    });

    it('should not append snapshot-included ops without an existing state cache', async () => {
      const snapshotOp = createTestOperation({ id: 'snapshot-op-without-cache' });

      await expectAsync(
        service.appendSnapshotIncludedOps([snapshotOp]),
      ).toBeRejectedWithError(
        'Cannot append snapshot-included operations without an existing state cache',
      );

      expect(await service.getOpsAfterSeq(0)).toEqual([]);
      expect(await service.loadStateCache()).toBeNull();
    });

    it('should reject a snapshot append when the state-cache frontier is behind the log tail', async () => {
      const existingOp = createTestOperation({ id: 'existing-unmaterialized-op' });
      const snapshotOp = createTestOperation({ id: 'snapshot-op-after-gap' });
      await service.append(existingOp, 'remote');
      await service.saveStateCache({
        state: { task: { ids: [] } },
        lastAppliedOpSeq: 0,
        vectorClock: {},
        compactedAt: 1,
      });

      await expectAsync(
        service.appendSnapshotIncludedOps([snapshotOp]),
      ).toBeRejectedWithError(
        'Cannot append snapshot-included operations when the state-cache frontier does not match the operation-log tail',
      );

      expect((await service.getOpsAfterSeq(0)).map((entry) => entry.op.id)).toEqual([
        existingOp.id,
      ]);
      expect((await service.loadStateCache())?.lastAppliedOpSeq).toBe(0);
    });

    it('should atomically commit file snapshot ops, cache, clock, and archives', async () => {
      const existingOp = createTestOperation({ id: 'file-snapshot-existing' });
      const includedOp = createTestOperation({ id: 'file-snapshot-new' });
      const archiveYoung = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
      } as unknown as ArchiveModel;
      const archiveOld = {
        task: { ids: [], entities: {} },
        timeTracking: { project: {}, tag: {} },
      } as unknown as ArchiveModel;
      await service.append(existingOp, 'remote');

      const result = await service.commitFileSnapshotBaseline({
        state: { task: { ids: ['remote-task'] } },
        lastAppliedOpSeq: 1,
        vectorClock: { remote: 7 },
        compactedAt: 123,
        snapshotIncludedOps: [existingOp, includedOp],
        archiveYoung,
        archiveOld,
      });

      expect(result).toEqual({
        seqs: [2],
        writtenOps: [includedOp],
        skippedCount: 1,
      });
      expect((await service.loadStateCache())?.lastAppliedOpSeq).toBe(2);
      expect(await service.getVectorClock()).toEqual({ remote: 7 });
      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      expect((await db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY)).data).toEqual(
        archiveYoung,
      );
      expect((await db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY)).data).toEqual(
        archiveOld,
      );
    });

    it('should roll back the whole file baseline when its vector-clock write fails', async () => {
      const priorOp = createTestOperation({ id: 'file-snapshot-prior-op' });
      const priorState = { sentinel: 'prior-state' };
      await service.append(priorOp, 'remote');
      await service.saveStateCache({
        state: priorState,
        lastAppliedOpSeq: 1,
        vectorClock: { testClient: 1 },
        compactedAt: 1,
      });
      await service.setVectorClock({ testClient: 1 });

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const originalTransaction = adapter.transaction.bind(adapter);
      spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
        originalTransaction(stores, mode, async (tx) => {
          const failingTx = new Proxy(tx, {
            get: (target, property): unknown => {
              if (property === 'put') {
                return async (
                  storeName: Parameters<typeof tx.put>[0],
                  ...args: unknown[]
                ): Promise<unknown> => {
                  if (storeName === STORE_NAMES.VECTOR_CLOCK) {
                    throw new Error('injected vector-clock write failure');
                  }
                  return (target.put as (...putArgs: unknown[]) => Promise<unknown>).call(
                    target,
                    storeName,
                    ...args,
                  );
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(failingTx);
        }),
      );

      await expectAsync(
        service.commitFileSnapshotBaseline({
          state: { sentinel: 'new-state' },
          lastAppliedOpSeq: 1,
          vectorClock: { remote: 2 },
          compactedAt: 2,
          snapshotIncludedOps: [
            createTestOperation({ id: 'file-snapshot-rolled-back-op' }),
          ],
        }),
      ).toBeRejectedWithError('injected vector-clock write failure');

      expect((await service.getOpsAfterSeq(0)).map(({ op }) => op.id)).toEqual([
        priorOp.id,
      ]);
      expect((await service.loadStateCache())?.state).toEqual(priorState);
      expect(await service.getVectorClock()).toEqual({ testClient: 1 });
    });

    it('marks rejectOpIds rejected atomically within the baseline commit', async () => {
      const supersededLocalOp = createTestOperation({ id: 'superseded-local' });
      await service.append(supersededLocalOp, 'local');
      expect((await service.getUnsynced()).map(({ op }) => op.id)).toEqual([
        'superseded-local',
      ]);

      await service.commitFileSnapshotBaseline({
        state: { sentinel: 'hydrated' },
        lastAppliedOpSeq: 1,
        vectorClock: { remote: 3 },
        compactedAt: 5,
        snapshotIncludedOps: [],
        rejectOpIds: [supersededLocalOp.id],
      });

      // Rejected in the same commit as the state replacement → no longer uploadable.
      expect(await service.getUnsynced()).toEqual([]);
      expect((await service.loadStateCache())?.state).toEqual({ sentinel: 'hydrated' });
    });

    it('does not reject rejectOpIds when the baseline commit rolls back (tail changed)', async () => {
      // The exact Finding #5 scenario: a standalone markRejected() would have
      // committed before this failing baseline, stranding the op as permanently
      // non-uploadable while the old state survived. Folding it into the commit
      // ties its fate to the rollback.
      const supersededLocalOp = createTestOperation({ id: 'superseded-local-2' });
      await service.append(supersededLocalOp, 'local');

      // Stale lastAppliedOpSeq (0 ≠ current tail 1) trips the tail-changed guard.
      await expectAsync(
        service.commitFileSnapshotBaseline({
          state: { sentinel: 'should-not-apply' },
          lastAppliedOpSeq: 0,
          vectorClock: { remote: 9 },
          compactedAt: 7,
          snapshotIncludedOps: [],
          rejectOpIds: [supersededLocalOp.id],
        }),
      ).toBeRejectedWithError(/operation-log tail changed/);

      // The op remains unsynced/uploadable — rejection never outlived the commit.
      expect((await service.getUnsynced()).map(({ op }) => op.id)).toEqual([
        'superseded-local-2',
      ]);
      expect((await service.loadStateCache())?.state).not.toEqual({
        sentinel: 'should-not-apply',
      });
    });
  });

  describe('appendMixedSourceBatchSkipDuplicates', () => {
    it('should atomically order remote losers before monotonically clocked local compensations', async () => {
      await service.setVectorClock({ testClient: 5, existingClient: 2 });
      const remoteLoser = createTestOperation({
        id: 'remote-loser',
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 7 },
      });
      const firstCompensation = createTestOperation({
        id: 'first-compensation',
        vectorClock: { testClient: 3, remoteClient: 7 },
      });
      const secondCompensation = createTestOperation({
        id: 'second-compensation',
        vectorClock: { testClient: 6, otherRemote: 4 },
      });

      const result = await service.appendMixedSourceBatchSkipDuplicates([
        { ops: [remoteLoser], source: 'remote' },
        { ops: [firstCompensation, secondCompensation], source: 'local' },
      ]);

      expect(result.written.map(({ op }) => op.id)).toEqual([
        'remote-loser',
        'first-compensation',
        'second-compensation',
      ]);
      expect(result.written.map(({ source }) => source)).toEqual([
        'remote',
        'local',
        'local',
      ]);
      expect(result.written[1].op.vectorClock).toEqual({
        testClient: 6,
        existingClient: 2,
        remoteClient: 7,
      });
      expect(result.written[2].op.vectorClock).toEqual({
        testClient: 7,
        existingClient: 2,
        remoteClient: 7,
        otherRemote: 4,
      });

      const stored = await service.getOpsAfterSeq(0);
      expect(stored.map(({ op }) => op.id)).toEqual([
        'remote-loser',
        'first-compensation',
        'second-compensation',
      ]);
      expect(stored[1].op.vectorClock).toEqual(result.written[1].op.vectorClock);
      expect(stored[2].op.vectorClock).toEqual(result.written[2].op.vectorClock);
      expect(await service.getVectorClock()).toEqual(result.written[2].op.vectorClock);
    });

    it('should skip existing and intra-batch duplicate IDs without allocating clocks for them', async () => {
      await service.setVectorClock({ testClient: 2 });
      const existingRemote = createTestOperation({
        id: 'existing-remote',
        clientId: 'remoteClient',
      });
      const newRemote = createTestOperation({
        id: 'new-remote',
        clientId: 'remoteClient',
      });
      const compensation = createTestOperation({
        id: 'compensation',
        vectorClock: { testClient: 1 },
      });
      await service.append(existingRemote, 'remote');

      const result = await service.appendMixedSourceBatchSkipDuplicates([
        { ops: [existingRemote, newRemote], source: 'remote' },
        { ops: [compensation, compensation], source: 'local' },
      ]);

      expect(result.skippedCount).toBe(2);
      expect(result.written.map(({ op }) => op.id)).toEqual([
        'new-remote',
        'compensation',
      ]);
      expect(result.written[1].op.vectorClock.testClient).toBe(3);
      expect((await service.getVectorClock())?.testClient).toBe(3);
    });

    it('should roll back both source groups and the clock when the clock write fails', async () => {
      await service.setVectorClock({ testClient: 4 });
      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const originalTransaction = adapter.transaction.bind(adapter);
      spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
        originalTransaction(stores, mode, async (tx) => {
          const failingTx = new Proxy(tx, {
            get: (target, property): unknown => {
              if (property === 'put') {
                return async (store: string, value: unknown, key?: string | number) => {
                  if (store === STORE_NAMES.VECTOR_CLOCK) {
                    throw new Error('injected mixed-batch clock failure');
                  }
                  return target.put(store, value, key);
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(failingTx);
        }),
      );

      await expectAsync(
        service.appendMixedSourceBatchSkipDuplicates([
          {
            ops: [
              createTestOperation({
                id: 'remote-loser',
                clientId: 'remoteClient',
              }),
            ],
            source: 'remote',
          },
          {
            ops: [createTestOperation({ id: 'compensation' })],
            source: 'local',
          },
        ]),
      ).toBeRejectedWithError('injected mixed-batch clock failure');

      expect(await service.getOpsAfterSeq(0)).toEqual([]);
      service.clearVectorClockCache();
      expect(await service.getVectorClock()).toEqual({ testClient: 4 });
    });
  });

  describe('getOpById', () => {
    it('should return operation entry by ID', async () => {
      const op = createTestOperation();
      await service.append(op);

      const entry = await service.getOpById(op.id);

      expect(entry).toBeDefined();
      expect(entry!.op.id).toBe(op.id);
    });

    it('should return undefined for non-existent ID', async () => {
      const entry = await service.getOpById('non-existent-id');

      expect(entry).toBeUndefined();
    });
  });

  describe('markApplied', () => {
    it('should checkpoint reducer-committed operations as archive_pending', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });

      await service.markReducersCommittedAndMergeClocks([seq], [op]);

      const [stored] = await service.getOpsAfterSeq(0);
      expect(stored.applicationStatus).toBe('archive_pending');
      // No attempt was made, so no retry budget is charged.
      expect(stored.retryCount).toBeUndefined();
      expect((await service.getPendingRemoteOps()).length).toBe(0);
      expect((await service.getFailedRemoteOps()).map((entry) => entry.op.id)).toEqual([
        op.id,
      ]);
    });

    it('should atomically checkpoint reducer commit and merge its vector clock', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });
      await service.setVectorClock({ testClient: 2 });

      await service.markReducersCommittedAndMergeClocks(
        [seq],
        [{ ...op, vectorClock: { remoteClient: 4 } }],
      );

      const [stored] = await service.getOpsAfterSeq(0);
      expect(stored.applicationStatus).toBe('archive_pending');
      expect(await service.getVectorClock()).toEqual({
        testClient: 2,
        remoteClient: 4,
      });
    });

    it('should atomically reject reducer failures while checkpointing successful ops', async () => {
      const successfulOp = createTestOperation({ id: 'successful-op' });
      const failedOp = createTestOperation({
        id: 'reducer-failed-op',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      const successfulSeq = await service.append(successfulOp, 'remote', {
        pendingApply: true,
      });
      await service.append(failedOp, 'remote', { pendingApply: true });
      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(failedOp.id);

      await service.markReducersCommittedAndMergeClocks(
        [successfulSeq],
        [successfulOp],
        [failedOp.id],
      );

      const successfulEntry = await service.getOpById(successfulOp.id);
      const failedEntry = await service.getOpById(failedOp.id);
      expect(successfulEntry?.applicationStatus).toBe('archive_pending');
      expect(failedEntry?.applicationStatus).toBe('pending');
      expect(failedEntry?.rejectedAt).toBeDefined();
      expect(failedEntry?.reducerRejectedAt).toBeDefined();
      expect(await service.getPendingRemoteOps()).toEqual([]);
      expect(await service.getLatestFullStateOpEntry()).toBeUndefined();
    });

    it('should durably reject a local synthetic operation whose reducer fails', async () => {
      const syntheticOp = createTestOperation({ id: 'synthetic-local-op' });
      await service.append(syntheticOp, 'local');

      await service.markReducersCommittedAndMergeClocks([], [], [syntheticOp.id]);

      const storedEntry = await service.getOpById(syntheticOp.id);
      expect(storedEntry?.rejectedAt).toBeDefined();
      expect(storedEntry?.reducerRejectedAt).toBeDefined();
      expect(await service.getUnsynced()).toEqual([]);
    });

    it('should not resurrect a reducer-rejected full-state op when metadata rebuilds', async () => {
      const failedOp = createTestOperation({
        id: 'reducer-failed-full-state-op',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await service.append(failedOp, 'remote', { pendingApply: true });
      await service.markReducersCommittedAndMergeClocks([], [], [failedOp.id]);
      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      await db.delete(STORE_NAMES.META, FULL_STATE_OPS_META_KEY);

      expect(await service.getLatestFullStateOpEntry()).toBeUndefined();
    });

    it('should roll back reducer checkpoint and clock when the atomic clock write fails', async () => {
      const op = createTestOperation();
      const reducerFailedOp = createTestOperation({ id: 'reducer-failed-op' });
      const seq = await service.append(op, 'remote', { pendingApply: true });
      await service.append(reducerFailedOp, 'remote', { pendingApply: true });
      await service.setVectorClock({ testClient: 2 });

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const originalTransaction = adapter.transaction.bind(adapter);
      spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
        originalTransaction(stores, mode, async (tx) => {
          const failingTx = new Proxy(tx, {
            get: (target, property): unknown => {
              if (property === 'put') {
                return async (store: string, value: unknown, key?: string | number) => {
                  if (store === STORE_NAMES.VECTOR_CLOCK) {
                    throw new Error('injected vector-clock write failure');
                  }
                  return target.put(store, value, key);
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(failingTx);
        }),
      );

      await expectAsync(
        service.markReducersCommittedAndMergeClocks(
          [seq],
          [{ ...op, vectorClock: { remoteClient: 4 } }],
          [reducerFailedOp.id],
        ),
      ).toBeRejectedWithError('injected vector-clock write failure');

      const [stored] = await service.getOpsAfterSeq(0);
      expect(stored.applicationStatus).toBe('pending');
      const failedEntry = await service.getOpById(reducerFailedOp.id);
      expect(failedEntry?.applicationStatus).toBe('pending');
      expect(failedEntry?.rejectedAt).toBeUndefined();
      service.clearVectorClockCache();
      expect(await service.getVectorClock()).toEqual({ testClient: 2 });
    });

    it('should abort the atomic checkpoint when a row is missing or no longer pending', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote');
      await service.setVectorClock({ testClient: 2 });

      await expectAsync(
        service.markReducersCommittedAndMergeClocks(
          [seq],
          [{ ...op, vectorClock: { remoteClient: 4 } }],
        ),
      ).toBeRejectedWithError(/requires pending remote operation/);

      const [stored] = await service.getOpsAfterSeq(0);
      expect(stored.applicationStatus).toBe('applied');
      service.clearVectorClockCache();
      expect(await service.getVectorClock()).toEqual({ testClient: 2 });
    });

    it('should update applicationStatus from pending to applied', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });

      const before = await service.getOpsAfterSeq(0);
      expect(before[0].applicationStatus).toBe('pending');

      await service.markApplied([seq]);

      const after = await service.getOpsAfterSeq(0);
      expect(after[0].applicationStatus).toBe('applied');
    });

    it('should not change status if not pending', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote'); // Not pending

      await service.markApplied([seq]);

      const after = await service.getOpsAfterSeq(0);
      expect(after[0].applicationStatus).toBe('applied'); // Was already applied
    });

    it('should handle empty array', async () => {
      await service.markApplied([]);
      // Should not throw
    });

    // =========================================================================
    // Regression test: markApplied should handle both 'pending' and 'failed' status
    // =========================================================================
    // When retryFailedRemoteOps() successfully applies a failed op, it calls
    // markApplied() to clear it. markApplied() must handle both 'pending' and
    // 'failed' status transitions to 'applied'.

    it('should update applicationStatus from failed to applied', async () => {
      // Create an op and mark it as pending
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });

      // Mark it as failed (simulating a failed application attempt)
      await service.markFailed([op.id]);

      // Verify it's now in 'failed' status
      const afterFail = await service.getOpsAfterSeq(0);
      expect(afterFail[0].applicationStatus).toBe('failed');

      // Now try to mark it as applied (simulating a successful retry)
      await service.markApplied([seq]);

      // The status should transition from 'failed' to 'applied'
      const afterMarkApplied = await service.getOpsAfterSeq(0);
      expect(afterMarkApplied[0].applicationStatus).toBe('applied');
    });

    it('should update applicationStatus from reducer-commit checkpoint to applied', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'remote', { pendingApply: true });
      await service.markReducersCommittedAndMergeClocks([seq], [op]);

      await service.markApplied([seq]);

      const [stored] = await service.getOpsAfterSeq(0);
      expect(stored.applicationStatus).toBe('applied');
    });

    it('should remove failed ops from getFailedRemoteOps after markApplied is called', async () => {
      // Create an op and mark it as pending
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      // Mark it as failed
      await service.markFailed([op.id]);

      // Verify it appears in failed ops
      const failedBefore = await service.getFailedRemoteOps();
      expect(failedBefore.length).toBe(1);

      // Get the seq from failed ops
      const seq = failedBefore[0].seq;

      // Call markApplied (simulating successful retry)
      await service.markApplied([seq]);

      // The op should no longer appear in failed ops
      const failedAfter = await service.getFailedRemoteOps();
      expect(failedAfter.length).toBe(0);
    });
  });

  describe('getPendingRemoteOps', () => {
    it('should return only pending remote operations', async () => {
      const localOp = createTestOperation({ entityId: 'local' });
      const remoteApplied = createTestOperation({ entityId: 'applied' });
      const remotePending = createTestOperation({ entityId: 'pending' });

      await service.append(localOp, 'local');
      await service.append(remoteApplied, 'remote'); // applied by default
      await service.append(remotePending, 'remote', { pendingApply: true });

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(1);
      expect(pending[0].op.entityId).toBe('pending');
    });

    it('should return empty array when no pending ops', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote');

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(0);
    });

    it('should exclude rejected ops (parity with getFailedRemoteOps)', async () => {
      // A rejected-but-still-pending row must not trip the incomplete-remote
      // sync gate: nothing will ever apply it, so counting it would wedge sync
      // for the whole session.
      const op = createTestOperation({ entityId: 'rejected-pending' });
      await service.append(op, 'remote', { pendingApply: true });
      await service.markRejected([op.id]);

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(0);
    });
  });

  describe('markFailed', () => {
    const seedLegacyTerminalRemoteFailure = async (op: Operation): Promise<void> => {
      await service.append(op, 'remote', { pendingApply: true });
      for (let retry = 0; retry < 4; retry++) {
        await service.markFailed([op.id]);
      }
      await service.markRejected([op.id]);

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      await adapter.transaction([STORE_NAMES.OPS], 'readwrite', async (tx) => {
        const entry = await tx.getFromIndex<OperationLogEntry>(
          STORE_NAMES.OPS,
          OPS_INDEXES.BY_ID,
          op.id,
        );
        if (!entry) {
          throw new Error('Expected seeded legacy operation');
        }
        entry.applicationStatus = undefined;
        await tx.put(STORE_NAMES.OPS, entry);
      });
    };

    it('should increment retry count', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      await service.markFailed([op.id]);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].retryCount).toBe(1);
      expect(ops[0].applicationStatus).toBe('failed');
    });

    it('should increment retry count on subsequent failures', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      await service.markFailed([op.id]);
      await service.markFailed([op.id]);
      await service.markFailed([op.id]);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].retryCount).toBe(3);
    });

    it('should keep failed operations quarantined after repeated failures', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote', { pendingApply: true });

      await service.markFailed([op.id]);
      await service.markFailed([op.id]);
      await service.markFailed([op.id]);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].rejectedAt).toBeUndefined();
      expect(ops[0].applicationStatus).toBe('failed');
      expect(ops[0].retryCount).toBe(3);
    });

    it('should re-quarantine legacy terminal remote failures', async () => {
      const op = createTestOperation();
      await seedLegacyTerminalRemoteFailure(op);

      expect(await service.recoverLegacyTerminalRemoteFailures()).toBe(1);

      const [recovered] = await service.getFailedRemoteOps();
      expect(recovered.op.id).toBe(op.id);
      expect(recovered.rejectedAt).toBeUndefined();
      expect(recovered.applicationStatus).toBe('failed');
    });

    it('should run the legacy terminal remote failure repair only once', async () => {
      const firstLegacyOp = createTestOperation({ entityId: 'first-legacy' });
      await seedLegacyTerminalRemoteFailure(firstLegacyOp);

      expect(await service.recoverLegacyTerminalRemoteFailures()).toBe(1);

      const laterLegacyOp = createTestOperation({ entityId: 'later-legacy' });
      await seedLegacyTerminalRemoteFailure(laterLegacyOp);

      expect(await service.recoverLegacyTerminalRemoteFailures()).toBe(0);
      expect((await service.getOpById(laterLegacyOp.id))?.rejectedAt).toBeDefined();
    });

    it('should leave legitimately rejected failed remote work untouched', async () => {
      const op = createTestOperation({ entityId: 'legitimately-rejected' });
      await service.append(op, 'remote', { pendingApply: true });
      for (let retry = 0; retry < 4; retry++) {
        await service.markFailed([op.id]);
      }
      await service.markRejected([op.id]);

      expect(await service.recoverLegacyTerminalRemoteFailures()).toBe(0);

      const stored = await service.getOpById(op.id);
      expect(stored?.rejectedAt).toBeDefined();
      expect(stored?.applicationStatus).toBe('failed');
    });

    it('should handle empty array', async () => {
      await service.markFailed([]);
      // Should not throw
    });
  });

  describe('getFailedRemoteOps', () => {
    it('should return only failed remote operations', async () => {
      const pending = createTestOperation({ entityId: 'pending' });
      const failed = createTestOperation({ entityId: 'failed' });
      const rejected = createTestOperation({ entityId: 'rejected' });

      await service.append(pending, 'remote', { pendingApply: true });
      await service.append(failed, 'remote', { pendingApply: true });
      await service.append(rejected, 'remote', { pendingApply: true });

      await service.markFailed([failed.id]);
      await service.markRejected([rejected.id]);

      const failedOps = await service.getFailedRemoteOps();

      expect(failedOps.length).toBe(1);
      expect(failedOps[0].op.entityId).toBe('failed');
    });

    it('should return empty array when no failed ops', async () => {
      const op = createTestOperation();
      await service.append(op, 'remote');

      const failed = await service.getFailedRemoteOps();

      expect(failed.length).toBe(0);
    });
  });

  describe('crash recovery scenarios', () => {
    it('should allow recovering pending ops after simulated crash', async () => {
      // Simulate: ops stored as pending but never marked applied (crash before dispatch)
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });

      await service.appendBatch([op1, op2], 'remote', { pendingApply: true });

      // Simulating "restart" - get pending ops for recovery
      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(2);
      expect(pending.map((p) => p.op.entityId).sort()).toEqual(['task1', 'task2']);
    });

    it('should track partial application progress', async () => {
      const ops = [
        createTestOperation({ entityId: 'task1' }),
        createTestOperation({ entityId: 'task2' }),
        createTestOperation({ entityId: 'task3' }),
      ];

      const seqs = await service.appendBatch(ops, 'remote', { pendingApply: true });

      // Simulate: first op applied, then crash
      await service.markApplied([seqs[0]]);

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(2);
      expect(pending.map((p) => p.op.entityId).sort()).toEqual(['task2', 'task3']);
    });
  });

  describe('appliedOpIds cache', () => {
    it('should return cached result when no new ops added', async () => {
      const op = createTestOperation();
      await service.append(op);

      // First call builds cache
      const ids1 = await service.getAppliedOpIds();
      // Second call should use cache
      const ids2 = await service.getAppliedOpIds();

      expect(ids1.size).toBe(1);
      expect(ids2.size).toBe(1);
      expect(ids1.has(op.id)).toBe(true);
    });

    it('should invalidate cache when new ops added', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      await service.append(op1);

      const ids1 = await service.getAppliedOpIds();
      expect(ids1.size).toBe(1);

      // Add new op
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op2);

      const ids2 = await service.getAppliedOpIds();
      expect(ids2.size).toBe(2);
      expect(ids2.has(op2.id)).toBe(true);
    });

    it('should incrementally update cache when new ops added', async () => {
      // Build initial cache with 5 ops
      const initialOps = Array.from({ length: 5 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );
      for (const op of initialOps) {
        await service.append(op);
      }

      // First call - builds cache
      const ids1 = await service.getAppliedOpIds();
      expect(ids1.size).toBe(5);

      // Add 2 more ops
      const newOp1 = createTestOperation({ entityId: 'new-task-1' });
      const newOp2 = createTestOperation({ entityId: 'new-task-2' });
      await service.append(newOp1);
      await service.append(newOp2);

      // Second call - should incrementally add only new IDs
      const ids2 = await service.getAppliedOpIds();
      expect(ids2.size).toBe(7);
      expect(ids2.has(newOp1.id)).toBe(true);
      expect(ids2.has(newOp2.id)).toBe(true);

      // All original IDs should still be present
      for (const op of initialOps) {
        expect(ids2.has(op.id)).toBe(true);
      }
    });
  });

  describe('unsynced cache', () => {
    it('should return cached result when no changes', async () => {
      const op = createTestOperation();
      await service.append(op);

      // First call builds cache
      const unsynced1 = await service.getUnsynced();
      // Second call should use cache
      const unsynced2 = await service.getUnsynced();

      expect(unsynced1.length).toBe(1);
      expect(unsynced2.length).toBe(1);
      expect(unsynced1[0].op.id).toBe(op.id);
    });

    it('should incrementally add new unsynced ops to cache', async () => {
      // Build initial cache with 3 ops
      const initialOps = Array.from({ length: 3 }, (_, i) =>
        createTestOperation({ entityId: `task-${i}` }),
      );
      for (const op of initialOps) {
        await service.append(op);
      }

      // First call - builds cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(3);

      // Add 2 more ops
      const newOp1 = createTestOperation({ entityId: 'new-task-1' });
      const newOp2 = createTestOperation({ entityId: 'new-task-2' });
      await service.append(newOp1);
      await service.append(newOp2);

      // Second call - should incrementally add new unsynced ops
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(5);
    });

    it('should invalidate cache when markSynced is called', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op1);
      await service.append(op2);

      // Build cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(2);

      // Mark one as synced
      const ops = await service.getOpsAfterSeq(0);
      await service.markSynced([ops[0].seq]);

      // Cache should be invalidated, returning only the unsynced op
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(1);
      expect(unsynced2[0].op.id).toBe(op2.id);
    });

    it('should invalidate cache when markRejected is called', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op1);
      await service.append(op2);

      // Build cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(2);

      // Mark one as rejected
      await service.markRejected([op1.id]);

      // Cache should be invalidated, returning only the non-rejected op
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(1);
      expect(unsynced2[0].op.id).toBe(op2.id);
    });

    it('should keep local failed ops unsynced after repeated failures', async () => {
      const op1 = createTestOperation({ entityId: 'task1' });
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op1);
      await service.append(op2);

      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(2);

      await service.markFailed([op1.id]);

      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.map((entry) => entry.op.id)).toEqual([op1.id, op2.id]);
    });

    it('should not include already synced ops when incrementally updating', async () => {
      // Add initial ops
      const op1 = createTestOperation({ entityId: 'task1' });
      await service.append(op1);

      // Build initial cache
      const unsynced1 = await service.getUnsynced();
      expect(unsynced1.length).toBe(1);

      // Mark as synced - this invalidates the cache
      const ops = await service.getOpsAfterSeq(0);
      await service.markSynced([ops[0].seq]);

      // Add a new unsynced op
      const op2 = createTestOperation({ entityId: 'task2' });
      await service.append(op2);

      // Should only return the new unsynced op
      const unsynced2 = await service.getUnsynced();
      expect(unsynced2.length).toBe(1);
      expect(unsynced2[0].op.id).toBe(op2.id);
    });
  });

  describe('edge cases', () => {
    it('should handle empty arrays for markSynced', async () => {
      await service.markSynced([]);
      // Should not throw
    });

    it('should handle empty arrays for markRejected', async () => {
      await service.markRejected([]);
      // Should not throw
    });

    it('should handle deleteOpsWhere with no matches', async () => {
      const op = createTestOperation();
      await service.append(op);

      await service.deleteOpsWhere(() => false);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
    });

    it('should handle very large operations', async () => {
      // Create operation with large payload
      const largePayload: Record<string, unknown> = {};
      for (let i = 0; i < 1000; i++) {
        largePayload[`field${i}`] = 'x'.repeat(100);
      }

      const op = createTestOperation({ payload: largePayload });
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].op.payload).toEqual(largePayload);
    });

    it('should handle operations with special characters in payload', async () => {
      const payload = {
        title: 'Task with "quotes" and \n newlines',
        description: 'Unicode: 日本語 🎉 emoji',
        tags: ['special/chars', 'back\\slash'],
      };

      const op = createTestOperation({ payload });
      await service.append(op);

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].op.payload).toEqual(payload);
    });

    it('should preserve operation order in getOpsAfterSeq', async () => {
      const ids: string[] = [];
      for (let i = 0; i < 20; i++) {
        const op = createTestOperation({ entityId: `task-${i}` });
        ids.push(op.id);
        await service.append(op);
      }

      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(20);

      // Verify order is preserved
      for (let i = 0; i < ops.length - 1; i++) {
        expect(ops[i].seq).toBeLessThan(ops[i + 1].seq);
      }
    });
  });

  describe('import backup', () => {
    it('should save and load import backup', async () => {
      const state = { tasks: ['task1', 'task2'], projects: [] };

      const backupRef = await service.saveImportBackup(state);

      const backup = await service.loadImportBackup();
      expect(backup).not.toBeNull();
      expect(backup!.state).toEqual(state);
      expect(backup!.savedAt).toBeDefined();
      expect(typeof backup!.savedAt).toBe('number');
      expect(backup!.backupId).toBeDefined();
      expect(backupRef).toEqual({
        backupId: backup!.backupId,
        savedAt: backup!.savedAt,
      });
    });

    it('should assign distinct opaque IDs to same-millisecond replacements', async () => {
      spyOn(Date, 'now').and.returnValue(1234);

      const first = await service.saveImportBackup({ version: 1 });
      const second = await service.saveImportBackup({ version: 2 });

      expect(first.savedAt).toBe(second.savedAt);
      expect(first.backupId).not.toBe(second.backupId);
      expect((await service.loadImportBackup())?.backupId).toBe(second.backupId);
    });

    it('should return null when no backup exists', async () => {
      const backup = await service.loadImportBackup();
      expect(backup).toBeNull();
    });

    it('should overwrite existing backup on save', async () => {
      const state1 = { version: 1 };
      const state2 = { version: 2 };

      await service.saveImportBackup(state1);
      await service.saveImportBackup(state2);

      const backup = await service.loadImportBackup();
      expect(backup!.state).toEqual(state2);
    });

    it('should clear import backup', async () => {
      const state = { data: 'test' };
      await service.saveImportBackup(state);

      await service.clearImportBackup();

      const backup = await service.loadImportBackup();
      expect(backup).toBeNull();
    });

    it('should not let a stale identity clear a replacement backup', async () => {
      const first = await service.saveImportBackup({ version: 1 });
      const second = await service.saveImportBackup({ version: 2 });

      await service.clearImportBackup(first.backupId);

      expect((await service.loadImportBackup())?.backupId).toBe(second.backupId);
      await service.clearImportBackup(second.backupId);
      expect(await service.loadImportBackup()).toBeNull();
    });

    it('should check if backup exists with hasImportBackup', async () => {
      expect(await service.hasImportBackup()).toBe(false);

      await service.saveImportBackup({ test: true });

      expect(await service.hasImportBackup()).toBe(true);

      await service.clearImportBackup();

      expect(await service.hasImportBackup()).toBe(false);
    });

    it('should preserve complex nested data structures', async () => {
      const complexState = {
        tasks: {
          ids: ['task1', 'task2'],
          entities: {
            task1: { id: 'task1', title: 'Test', nested: { deep: { value: 123 } } },
            task2: { id: 'task2', title: 'Test 2', tags: ['a', 'b', 'c'] },
          },
        },
        projects: [{ id: 'p1', name: 'Project' }],
        nullValue: null,
        undefinedValue: undefined,
        emptyArray: [],
        emptyObject: {},
      };

      await service.saveImportBackup(complexState);

      const backup = await service.loadImportBackup();
      expect(backup!.state).toEqual(complexState);
    });

    it('should survive clearAllOperations', async () => {
      // Save backup and add some operations
      const backupState = { important: 'data' };
      await service.saveImportBackup(backupState);
      await service.append(createTestOperation());
      await service.append(createTestOperation());

      // Clear all operations
      await service.clearAllOperations();

      // Backup should still exist
      const backup = await service.loadImportBackup();
      expect(backup).not.toBeNull();
      expect(backup!.state).toEqual(backupState);
    });

    it('should be independent from state_cache', async () => {
      // Save both import backup and state cache
      const importBackupState = { type: 'import_backup' };
      const stateCacheState = { type: 'state_cache' };

      await service.saveImportBackup(importBackupState);
      await service.saveStateCache({
        state: stateCacheState,
        lastAppliedOpSeq: 1,
        vectorClock: { client1: 1 } as VectorClock,
        compactedAt: Date.now(),
      });

      // Both should be independent
      const importBackup = await service.loadImportBackup();
      const stateCache = await service.loadStateCache();

      expect(importBackup!.state).toEqual(importBackupState);
      expect(stateCache!.state).toEqual(stateCacheState);

      // Clearing one should not affect the other
      await service.clearImportBackup();

      expect(await service.loadImportBackup()).toBeNull();
      expect((await service.loadStateCache())!.state).toEqual(stateCacheState);
    });
  });

  // ===========================================================================
  // Vector Clock Store Tests (Performance Optimization)
  // ===========================================================================
  // These tests verify the vector_clock object store introduced in DB version 2
  // to consolidate vector clock writes into a single atomic transaction with ops.

  describe('getVectorClock', () => {
    it('should return null when no vector clock exists', async () => {
      const clock = await service.getVectorClock();
      expect(clock).toBeNull();
    });

    it('should return the stored vector clock', async () => {
      await service.setVectorClock({ clientA: 5, clientB: 3 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ clientA: 5, clientB: 3 });
    });
  });

  describe('setVectorClock', () => {
    it('should store a new vector clock', async () => {
      await service.setVectorClock({ clientA: 10 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ clientA: 10 });
    });

    it('should overwrite existing vector clock', async () => {
      await service.setVectorClock({ clientA: 5 });
      await service.setVectorClock({ clientA: 10, clientB: 3 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ clientA: 10, clientB: 3 });
    });

    it('should handle empty vector clock', async () => {
      await service.setVectorClock({});

      const clock = await service.getVectorClock();
      expect(clock).toEqual({});
    });
  });

  describe('getVectorClockEntry', () => {
    it('should return null when no vector clock exists', async () => {
      const entry = await service.getVectorClockEntry();
      expect(entry).toBeNull();
    });

    it('should return full entry with clock and lastUpdate', async () => {
      const beforeTime = Date.now();
      await service.setVectorClock({ clientA: 5 });
      const afterTime = Date.now();

      const entry = await service.getVectorClockEntry();
      expect(entry).not.toBeNull();
      expect(entry!.clock).toEqual({ clientA: 5 });
      expect(entry!.lastUpdate).toBeGreaterThanOrEqual(beforeTime);
      expect(entry!.lastUpdate).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('runDestructiveStateReplacement', () => {
    const createArchive = (taskId: string): any => ({
      task: {
        ids: [taskId],
        entities: { [taskId]: { id: taskId, title: taskId } },
      },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    });

    it('should atomically clear an interrupted raw-rebuild marker', async () => {
      await service.runRemoteStateReplacement({
        baselineState: { task: { ids: [], entities: {} } },
        vectorClock: { remote: 1 },
        schemaVersion: 4,
        snapshotEntityKeys: [],
        archiveYoung: createArchive('remote-young'),
        archiveOld: createArchive('remote-old'),
      });
      expect(await service.isRawRebuildIncomplete()).toBe(true);

      await service.runDestructiveStateReplacement({
        syncImportOp: createTestOperation({
          opType: OpType.BackupImport,
          entityType: 'ALL' as EntityType,
          entityId: 'restored-backup',
          payload: { task: { ids: [], entities: {} } },
        }),
        snapshotEntityKeys: [],
      });

      expect(await service.isRawRebuildIncomplete()).toBe(false);
    });

    it('should write archives in the same destructive replacement', async () => {
      const archiveYoung = createArchive('young-task');
      const archiveOld = createArchive('old-task');
      const lockRequestSpy = spyOn(lockService, 'request').and.callThrough();

      await service.runDestructiveStateReplacement({
        syncImportOp: createTestOperation({
          opType: OpType.BackupImport,
          entityType: 'ALL' as EntityType,
          entityId: 'backup-import',
          payload: { task: { ids: [], entities: {} } },
        }),
        snapshotEntityKeys: [],
        archiveYoung,
        archiveOld,
      });

      const db = (service as any).db;
      const youngEntry = await db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY);
      const oldEntry = await db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY);
      expect(youngEntry.data).toEqual(archiveYoung);
      expect(oldEntry.data).toEqual(archiveOld);
      expect(lockRequestSpy).toHaveBeenCalledOnceWith(
        LOCK_NAMES.TASK_ARCHIVE,
        jasmine.any(Function),
      );
    });

    it('should roll back ops, state_cache, vector_clock, and archives when an archive write fails', async () => {
      const priorOp = createTestOperation({ entityId: 'prior-task' });
      const priorArchiveYoung = createArchive('prior-young');
      const priorArchiveOld = createArchive('prior-old');
      await service.append(priorOp);
      await service.saveStateCache({
        state: { sentinel: 'prior-state' },
        lastAppliedOpSeq: 1,
        vectorClock: { testClient: 1 },
        compactedAt: Date.now(),
      });
      await service.setVectorClock({ testClient: 1 });

      const db = (service as any).db;
      await db.put(STORE_NAMES.ARCHIVE_YOUNG, {
        id: SINGLETON_KEY,
        data: priorArchiveYoung,
        lastModified: 1,
      });
      await db.put(STORE_NAMES.ARCHIVE_OLD, {
        id: SINGLETON_KEY,
        data: priorArchiveOld,
        lastModified: 1,
      });

      const realTransaction = db.transaction.bind(db);
      spyOn(db, 'transaction').and.callFake((stores: any, mode: any) => {
        const tx = realTransaction(stores, mode);
        if (Array.isArray(stores) && stores.includes(STORE_NAMES.ARCHIVE_YOUNG)) {
          const realObjectStore = tx.objectStore.bind(tx);
          tx.objectStore = ((storeName: string) => {
            const store = realObjectStore(storeName);
            if (storeName === STORE_NAMES.ARCHIVE_YOUNG) {
              store.put = async () => {
                throw new Error('Simulated archive write failure');
              };
            }
            return store;
          }) as typeof tx.objectStore;
        }
        return tx;
      });

      await expectAsync(
        service.runDestructiveStateReplacement({
          syncImportOp: createTestOperation({
            opType: OpType.BackupImport,
            entityType: 'ALL' as EntityType,
            entityId: 'backup-import',
            payload: { sentinel: 'new-state' },
            vectorClock: { newClient: 1 },
          }),
          snapshotEntityKeys: [],
          archiveYoung: createArchive('new-young'),
          archiveOld: createArchive('new-old'),
        }),
      ).toBeRejected();

      const opsAfter = await service.getOpsAfterSeq(0);
      expect(opsAfter.map((entry) => entry.op.id)).toEqual([priorOp.id]);
      expect((await service.loadStateCache())!.state).toEqual({
        sentinel: 'prior-state',
      });
      expect(await service.getVectorClock()).toEqual({ testClient: 1 });
      expect((await db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY)).data).toEqual(
        priorArchiveYoung,
      );
      expect((await db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY)).data).toEqual(
        priorArchiveOld,
      );
    });

    it('writes the rotated clientId into the client_id store and clears the cache', async () => {
      const clearCacheSpy = spyOn(mockClientIdProvider, 'clearCache');

      await service.runDestructiveStateReplacement({
        syncImportOp: createTestOperation({
          opType: OpType.SyncImport,
          entityType: 'ALL' as EntityType,
          entityId: undefined,
          clientId: 'rotatedClient',
          vectorClock: { rotatedClient: 1 },
          payload: { task: { ids: [], entities: {} } },
        }),
        snapshotEntityKeys: [],
      });

      const db = (service as any).db;
      expect(await db.get(STORE_NAMES.CLIENT_ID, SINGLETON_KEY)).toBe('rotatedClient');
      // Cache-clear runs after a committed tx.done so the next clientId read
      // sees the rotated value.
      expect(clearCacheSpy).toHaveBeenCalledTimes(1);
    });

    it('leaves the client_id store and cache untouched when the destructive tx aborts', async () => {
      const db = (service as any).db;
      // Seed a prior clientId — the aborted put must roll back to this.
      await db.put(STORE_NAMES.CLIENT_ID, 'priorClient', SINGLETON_KEY);
      const clearCacheSpy = spyOn(mockClientIdProvider, 'clearCache');

      const realTransaction = db.transaction.bind(db);
      spyOn(db, 'transaction').and.callFake((stores: any, mode: any) => {
        const tx = realTransaction(stores, mode);
        if (Array.isArray(stores) && stores.includes(STORE_NAMES.OPS)) {
          const opsStore = tx.objectStore(STORE_NAMES.OPS);
          opsStore.add = async () => {
            throw new Error('Simulated interrupt inside destructive tx');
          };
        }
        return tx;
      });

      await expectAsync(
        service.runDestructiveStateReplacement({
          syncImportOp: createTestOperation({
            opType: OpType.SyncImport,
            entityType: 'ALL' as EntityType,
            clientId: 'abortClient',
            vectorClock: { abortClient: 1 },
          }),
          snapshotEntityKeys: [],
        }),
      ).toBeRejected();

      expect(await db.get(STORE_NAMES.CLIENT_ID, SINGLETON_KEY)).toBe('priorClient');
      expect(clearCacheSpy).not.toHaveBeenCalled();
    });

    it('should update full-state metadata for the replacement op', async () => {
      const syncImportOp = createTestOperation({
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
        clientId: 'replacementClient',
        vectorClock: { replacementClient: 1 },
        payload: { task: { ids: [], entities: {} } },
      });

      await service.runDestructiveStateReplacement({
        syncImportOp,
        snapshotEntityKeys: [],
      });

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(syncImportOp.id);
      expect(adapter.iterate).not.toHaveBeenCalled();
    });

    it('should preserve full-state metadata when the destructive tx aborts', async () => {
      const priorImport = createTestOperation({
        id: '01900000-0000-7000-8000-000000000031',
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
      });
      await service.append(priorImport);
      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(priorImport.id);

      const db = (service as any).db;
      const realTransaction = db.transaction.bind(db);
      spyOn(db, 'transaction').and.callFake((stores: any, mode: any) => {
        const tx = realTransaction(stores, mode);
        if (Array.isArray(stores) && stores.includes(STORE_NAMES.OPS)) {
          const opsStore = tx.objectStore(STORE_NAMES.OPS);
          opsStore.add = async () => {
            throw new Error('Simulated interrupt inside destructive tx');
          };
        }
        return tx;
      });

      await expectAsync(
        service.runDestructiveStateReplacement({
          syncImportOp: createTestOperation({
            id: '01900000-0000-7000-8000-000000000032',
            opType: OpType.SyncImport,
            entityType: 'ALL' as EntityType,
            clientId: 'abortClient',
            vectorClock: { abortClient: 1 },
          }),
          snapshotEntityKeys: [],
        }),
      ).toBeRejected();

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(priorImport.id);
      expect(adapter.iterate).not.toHaveBeenCalled();
    });
  });

  describe('runRemoteStateReplacement', () => {
    const createArchive = (taskId: string): ArchiveModel =>
      ({
        task: {
          ids: [taskId],
          entities: { [taskId]: { id: taskId, title: taskId } },
        },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 0,
      }) as unknown as ArchiveModel;

    it('atomically replaces ops, cache, clock, metadata, and both archives', async () => {
      await service.append(
        createTestOperation({
          opType: OpType.SyncImport,
          entityType: 'ALL' as EntityType,
        }),
      );
      const baselineState = { task: { ids: [], entities: {} } };
      const archiveYoung = createArchive('remote-young');
      const archiveOld = createArchive('remote-old');

      await service.runRemoteStateReplacement({
        baselineState,
        vectorClock: { remote: 4 },
        schemaVersion: 4,
        snapshotEntityKeys: ['TASK:remote-task'],
        archiveYoung,
        archiveOld,
      });

      expect(await service.getOpsAfterSeq(0)).toEqual([]);
      expect(await service.getLatestFullStateOpEntry()).toBeUndefined();
      expect(await service.loadStateCache()).toEqual(
        jasmine.objectContaining({
          state: baselineState,
          lastAppliedOpSeq: 0,
          vectorClock: { remote: 4 },
          schemaVersion: 4,
          snapshotEntityKeys: ['TASK:remote-task'],
        }),
      );
      expect(await service.getVectorClock()).toEqual({ remote: 4 });

      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      expect((await db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY)).data).toEqual(
        archiveYoung,
      );
      expect((await db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY)).data).toEqual(
        archiveOld,
      );
    });

    it('sets the raw-rebuild-incomplete marker atomically with the replacement and clears it on demand', async () => {
      expect(await service.isRawRebuildIncomplete()).toBe(false);

      await service.runRemoteStateReplacement({
        baselineState: { task: { ids: [], entities: {} } },
        vectorClock: { remote: 1 },
        schemaVersion: 4,
        snapshotEntityKeys: [],
        archiveYoung: createArchive('young'),
        archiveOld: createArchive('old'),
      });

      // A crash after the replacement but before the replay commits must leave
      // the marker set so the next sync redoes the raw rebuild.
      expect(await service.isRawRebuildIncomplete()).toBe(true);

      await service.completeRawRebuild();
      expect(await service.isRawRebuildIncomplete()).toBe(false);
    });

    it('should abort replacement if the captured backup slot was superseded', async () => {
      const priorOp = createTestOperation({ id: 'prior-local-op' });
      await service.append(priorOp, 'local');
      const capturedBackup = await service.saveImportBackup({ version: 1 });
      const replacementBackup = await service.saveImportBackup({ version: 2 });

      await expectAsync(
        service.runRemoteStateReplacement({
          baselineState: { task: { ids: [], entities: {} } },
          vectorClock: { remote: 1 },
          schemaVersion: 4,
          snapshotEntityKeys: [],
          archiveYoung: createArchive('young'),
          archiveOld: createArchive('old'),
          backupRef: capturedBackup,
        }),
      ).toBeRejectedWithError(/backup was superseded/);

      expect((await service.getOpsAfterSeq(0)).map(({ op }) => op.id)).toEqual([
        priorOp.id,
      ]);
      expect((await service.loadImportBackup())?.backupId).toBe(
        replacementBackup.backupId,
      );
      expect(await service.isRawRebuildIncomplete()).toBeFalse();
    });

    it('atomically transitions a completed rebuild to a durable recovery token', async () => {
      await service.runRemoteStateReplacement({
        baselineState: { task: { ids: [], entities: {} } },
        vectorClock: { remote: 1 },
        schemaVersion: 4,
        snapshotEntityKeys: [],
        archiveYoung: createArchive('young'),
        archiveOld: createArchive('old'),
      });

      const backupRef = {
        backupId: 'backup-4242',
        savedAt: 4242,
      };
      await service.saveImportBackup({ original: true });
      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      await adapter.put(STORE_NAMES.IMPORT_BACKUP, {
        id: SINGLETON_KEY,
        state: { original: true },
        ...backupRef,
      });

      expect(await service.completeRawRebuild(backupRef)).toBeTrue();

      expect(await service.isRawRebuildIncomplete()).toBe(false);
      expect(await service.loadRawRebuildRecovery()).toEqual(
        jasmine.objectContaining({
          backupId: 'backup-4242',
          backupSavedAt: 4242,
        }),
      );

      await service.clearRawRebuildRecovery('stale-backup');
      expect(await service.loadRawRebuildRecovery()).not.toBeNull();
      await service.clearRawRebuildRecovery('backup-4242');
      expect(await service.loadRawRebuildRecovery()).toBeNull();
    });

    it('should identity-guard dismissal retirement of marker and backup', async () => {
      const backupRef = await service.saveImportBackup({ original: true });
      await service.runRemoteStateReplacement({
        baselineState: { task: { ids: [], entities: {} } },
        vectorClock: { remote: 1 },
        schemaVersion: 4,
        snapshotEntityKeys: [],
        archiveYoung: createArchive('young'),
        archiveOld: createArchive('old'),
        backupRef,
      });
      expect(await service.completeRawRebuild(backupRef)).toBeTrue();

      expect(await service.retireCompletedRawRebuildRecovery('stale-backup')).toBeFalse();
      expect(await service.loadRawRebuildRecovery()).not.toBeNull();
      expect(await service.loadImportBackup()).not.toBeNull();

      expect(
        await service.retireCompletedRawRebuildRecovery(backupRef.backupId),
      ).toBeTrue();
      expect(await service.loadRawRebuildRecovery()).toBeNull();
      expect(await service.loadImportBackup()).toBeNull();
    });

    it('rolls back the incomplete-to-recovery transition when the token write fails', async () => {
      await service.runRemoteStateReplacement({
        baselineState: { task: { ids: [], entities: {} } },
        vectorClock: { remote: 1 },
        schemaVersion: 4,
        snapshotEntityKeys: [],
        archiveYoung: createArchive('young'),
        archiveOld: createArchive('old'),
      });
      const backupRef = await service.saveImportBackup({ original: true });
      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      const originalTransaction = adapter.transaction.bind(adapter);
      spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
        originalTransaction(stores, mode, async (tx) => {
          const failingTx = new Proxy(tx, {
            get: (target, property): unknown => {
              if (property === 'put') {
                return async (): Promise<void> => {
                  throw new Error('injected recovery-token write failure');
                };
              }
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          });
          return callback(failingTx);
        }),
      );

      await expectAsync(service.completeRawRebuild(backupRef)).toBeRejectedWithError(
        'injected recovery-token write failure',
      );

      expect(await service.isRawRebuildIncomplete()).toBe(true);
      expect(await service.loadRawRebuildRecovery()).toBeNull();
    });

    it('durably carries post-crash local ops in the rebuild marker', async () => {
      const preservedLocalOp = createTestOperation({
        id: '01900000-0000-7000-8000-000000000091',
        entityId: 'edited-after-crash',
        clientId: 'localClient',
        vectorClock: { localClient: 2, remote: 1 },
      });

      const backupRef = await service.saveImportBackup({ original: true });
      await service.runRemoteStateReplacement({
        baselineState: { task: { ids: [], entities: {} } },
        vectorClock: { remote: 1 },
        schemaVersion: 4,
        snapshotEntityKeys: [],
        archiveYoung: createArchive('young'),
        archiveOld: createArchive('old'),
        preservedLocalOps: [preservedLocalOp],
        backupRef,
      });

      expect(await service.getOpsAfterSeq(0)).toEqual([]);
      expect(await service.loadRawRebuildIncomplete()).toEqual(
        jasmine.objectContaining({
          incomplete: true,
          preservedLocalOps: [preservedLocalOp],
          backupRef,
        }),
      );
    });

    it('rolls back every store if one archive write fails', async () => {
      const priorOp = createTestOperation({ entityId: 'prior-task' });
      const priorState = { sentinel: 'prior-state' };
      const priorYoung = createArchive('prior-young');
      const priorOld = createArchive('prior-old');
      await service.append(priorOp);
      await service.saveStateCache({
        state: priorState,
        lastAppliedOpSeq: 1,
        vectorClock: { testClient: 1 },
        compactedAt: Date.now(),
      });
      await service.setVectorClock({ testClient: 1 });

      const db = (
        service as unknown as {
          db: IDBPDatabase<unknown>;
        }
      ).db;
      await db.put(STORE_NAMES.ARCHIVE_YOUNG, {
        id: SINGLETON_KEY,
        data: priorYoung,
        lastModified: 1,
      });
      await db.put(STORE_NAMES.ARCHIVE_OLD, {
        id: SINGLETON_KEY,
        data: priorOld,
        lastModified: 1,
      });

      const realTransaction = db.transaction.bind(db);
      spyOn(db, 'transaction').and.callFake(((
        stores: Parameters<typeof db.transaction>[0],
        mode: Parameters<typeof db.transaction>[1],
      ) => {
        const tx = realTransaction(stores, mode);
        if (Array.isArray(stores) && stores.includes(STORE_NAMES.ARCHIVE_OLD)) {
          const realObjectStore = tx.objectStore.bind(tx);
          tx.objectStore = ((storeName: string) => {
            const store = realObjectStore(storeName);
            if (storeName === STORE_NAMES.ARCHIVE_OLD) {
              store.put = async () => {
                throw new Error('Simulated archive write failure');
              };
            }
            return store;
          }) as typeof tx.objectStore;
        }
        return tx;
      }) as typeof db.transaction);

      await expectAsync(
        service.runRemoteStateReplacement({
          baselineState: { sentinel: 'new-state' },
          vectorClock: { remote: 2 },
          schemaVersion: 4,
          snapshotEntityKeys: [],
          archiveYoung: createArchive('new-young'),
          archiveOld: createArchive('new-old'),
        }),
      ).toBeRejected();

      expect((await service.getOpsAfterSeq(0)).map((entry) => entry.op.id)).toEqual([
        priorOp.id,
      ]);
      expect((await service.loadStateCache())!.state).toEqual(priorState);
      expect(await service.getVectorClock()).toEqual({ testClient: 1 });
      expect((await db.get(STORE_NAMES.ARCHIVE_YOUNG, SINGLETON_KEY)).data).toEqual(
        priorYoung,
      );
      expect((await db.get(STORE_NAMES.ARCHIVE_OLD, SINGLETON_KEY)).data).toEqual(
        priorOld,
      );
    });
  });

  describe('appendWithVectorClockOverwrite', () => {
    it('should append operation and update vector clock atomically for local ops', async () => {
      const op = createTestOperation({
        vectorClock: { testClient: 1 },
      });

      const seq = await service.appendWithVectorClockOverwrite(op, 'local');

      // Operation should be stored
      const ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(ops[0].seq).toBe(seq);
      expect(ops[0].source).toBe('local');

      // Vector clock should be updated
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 1 });
    });

    it('should NOT update vector clock for remote ops', async () => {
      // First set a local clock
      await service.setVectorClock({ localClient: 5 });

      const remoteOp = createTestOperation({
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 10 },
      });

      await service.appendWithVectorClockOverwrite(remoteOp, 'remote');

      // Vector clock should NOT be updated (remote ops don't change local clock)
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5 });
    });

    it('should update vector clock with each local operation', async () => {
      const op1 = createTestOperation({
        entityId: 'task1',
        vectorClock: { testClient: 1 },
      });
      const op2 = createTestOperation({
        entityId: 'task2',
        vectorClock: { testClient: 2 },
      });
      const op3 = createTestOperation({
        entityId: 'task3',
        vectorClock: { testClient: 3, otherClient: 1 },
      });

      await service.appendWithVectorClockOverwrite(op1, 'local');
      let clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 1 });

      await service.appendWithVectorClockOverwrite(op2, 'local');
      clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 2 });

      await service.appendWithVectorClockOverwrite(op3, 'local');
      clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 3, otherClient: 1 });
    });

    it('should set applicationStatus to pending for remote ops with pendingApply', async () => {
      const op = createTestOperation();

      await service.appendWithVectorClockOverwrite(op, 'remote', { pendingApply: true });

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].applicationStatus).toBe('pending');
    });

    it('should set applicationStatus to applied for remote ops without pendingApply', async () => {
      const op = createTestOperation();

      await service.appendWithVectorClockOverwrite(op, 'remote');

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].applicationStatus).toBe('applied');
    });

    it('should set syncedAt for remote ops', async () => {
      const beforeTime = Date.now();
      const op = createTestOperation();

      await service.appendWithVectorClockOverwrite(op, 'remote');
      const afterTime = Date.now();

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].syncedAt).toBeDefined();
      expect(ops[0].syncedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(ops[0].syncedAt).toBeLessThanOrEqual(afterTime);
    });

    it('should NOT set syncedAt for local ops', async () => {
      const op = createTestOperation();

      await service.appendWithVectorClockOverwrite(op, 'local');

      const ops = await service.getOpsAfterSeq(0);
      expect(ops[0].syncedAt).toBeUndefined();
    });

    it('should handle concurrent appends with vector clock updates', async () => {
      const ops = Array.from({ length: 5 }, (_, i) =>
        createTestOperation({
          entityId: `task-${i}`,
          vectorClock: { testClient: i + 1 },
        }),
      );

      // Append concurrently
      await Promise.all(
        ops.map((op) => service.appendWithVectorClockOverwrite(op, 'local')),
      );

      const storedOps = await service.getOpsAfterSeq(0);
      expect(storedOps.length).toBe(5);

      // Vector clock should reflect the last write (order may vary due to concurrency)
      const clock = await service.getVectorClock();
      expect(clock!.testClient).toBeGreaterThanOrEqual(1);
      expect(clock!.testClient).toBeLessThanOrEqual(5);
    });
  });

  describe('replaceRejectedRepair', () => {
    it('should reject the stale repair and append its replacement atomically', async () => {
      const staleRepair = createTestOperation({
        id: 'stale-repair',
        opType: OpType.Repair,
        entityType: 'ALL',
        entityId: undefined,
      });
      await service.append(staleRepair);
      const repairedState = { task: { ids: [], entities: {} } };
      const replacement = createTestOperation({
        id: 'replacement-repair',
        opType: OpType.Repair,
        entityType: 'ALL',
        entityId: undefined,
        payload: { appDataComplete: repairedState },
        vectorClock: { testClient: 2 },
      });

      const seq = await service.replaceRejectedRepair({
        staleRepairOpId: staleRepair.id,
        replacementOp: replacement,
        repairedState,
      });

      expect((await service.getOpById(staleRepair.id))?.rejectedAt).toBeDefined();
      expect((await service.getOpById(replacement.id))?.seq).toBe(seq);
      expect((await service.loadStateCache())?.state).toEqual(repairedState);
      expect(await service.getVectorClock()).toEqual(replacement.vectorClock);
      expect((await service.getLatestFullStateOpEntry())?.op.id).toBe(replacement.id);
    });

    // #8939: the caller-built clock may be stale (derived from a lagging
    // in-memory cache); the replacement must be rebased onto the durable
    // clock inside the transaction so the clock can never regress.
    it('should rebase the replacement clock past a durable clock that advanced since it was built', async () => {
      const staleRepair = createTestOperation({
        id: 'stale-repair',
        opType: OpType.Repair,
        entityType: 'ALL',
        entityId: undefined,
      });
      await service.append(staleRepair);
      await service.setVectorClock({ testClient: 9, otherClient: 4 });
      const repairedState = { task: { ids: [], entities: {} } };
      const replacement = createTestOperation({
        id: 'replacement-repair',
        opType: OpType.Repair,
        entityType: 'ALL',
        entityId: undefined,
        payload: { appDataComplete: repairedState },
        vectorClock: { testClient: 2 },
      });

      await service.replaceRejectedRepair({
        staleRepairOpId: staleRepair.id,
        replacementOp: replacement,
        repairedState,
      });

      const expectedClock = { testClient: 10, otherClient: 4 };
      expect(await service.getVectorClock()).toEqual(expectedClock);
      expect((await service.getOpById(replacement.id))?.op.vectorClock).toEqual(
        expectedClock,
      );
      expect((await service.loadStateCache())?.vectorClock).toEqual(expectedClock);
    });

    it('should abort without appending when the stale repair is missing', async () => {
      const replacement = createTestOperation({
        id: 'replacement-repair',
        opType: OpType.Repair,
        entityType: 'ALL',
        entityId: undefined,
      });

      await expectAsync(
        service.replaceRejectedRepair({
          staleRepairOpId: 'missing-repair',
          replacementOp: replacement,
          repairedState: {},
        }),
      ).toBeRejectedWithError(/missing-repair/);

      expect(await service.getOpById(replacement.id)).toBeUndefined();
    });
  });

  describe('VectorClockService integration with vector_clock store', () => {
    it('should read from vector_clock store as fast path', async () => {
      // Set vector clock directly in the store
      await service.setVectorClock({ directClient: 100 });

      // VectorClockService should read from the store first
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ directClient: 100 });
    });

    it('should fall back to snapshot+ops when vector_clock store is empty', async () => {
      // Save snapshot with vector clock (simulating pre-upgrade state)
      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { snapshotClient: 50 },
        compactedAt: Date.now(),
      });

      // Add an op with newer clock
      const op = createTestOperation({
        vectorClock: { snapshotClient: 51 },
      });
      await service.append(op); // Using append, not appendWithVectorClockOverwrite

      // VectorClockService should fall back to computing from snapshot+ops
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock.snapshotClient).toBe(51);
    });

    it('should prefer vector_clock store over snapshot computation', async () => {
      // Set up both: vector_clock store and snapshot with ops
      await service.setVectorClock({ storeClient: 200 });

      await service.saveStateCache({
        state: {},
        lastAppliedOpSeq: 0,
        vectorClock: { snapshotClient: 50 },
        compactedAt: Date.now(),
      });

      const op = createTestOperation({
        vectorClock: { snapshotClient: 51, opClient: 1 },
      });
      await service.append(op);

      // Should read from vector_clock store, not compute from snapshot+ops
      const clock = await vectorClockService.getCurrentVectorClock();
      expect(clock).toEqual({ storeClient: 200 });
    });
  });

  describe('clearAllOperations', () => {
    it('should remove all operations from the log', async () => {
      // Add several operations
      await service.append(createTestOperation({ entityId: 'task1' }));
      await service.append(createTestOperation({ entityId: 'task2' }));
      await service.append(createTestOperation({ entityId: 'task3' }));

      // Verify they exist
      let ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(3);

      // Clear all operations
      await service.clearAllOperations();

      // Verify they are gone
      ops = await service.getOpsAfterSeq(0);
      expect(ops.length).toBe(0);
    });

    it('should reset lastSeq to 0 after clearing', async () => {
      await service.append(createTestOperation());
      await service.append(createTestOperation());

      const seqBefore = await service.getLastSeq();
      expect(seqBefore).toBeGreaterThan(0);

      await service.clearAllOperations();

      const seqAfter = await service.getLastSeq();
      expect(seqAfter).toBe(0);
    });

    it('should invalidate caches after clearing', async () => {
      // Add operations and build caches
      await service.append(createTestOperation({ entityId: 'task1' }));
      await service.getAppliedOpIds(); // Build appliedOpIds cache
      await service.getUnsynced(); // Build unsynced cache

      // Clear all operations
      await service.clearAllOperations();

      // Subsequent calls should return empty results (not stale cached data)
      const appliedOpIds = await service.getAppliedOpIds();
      expect(appliedOpIds.size).toBe(0);

      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should clear full-state metadata after clearing operations', async () => {
      await service.append(
        createTestOperation({
          opType: OpType.SyncImport,
          entityType: 'ALL' as EntityType,
          entityId: undefined,
        }),
      );
      expect(await service.getLatestFullStateOpEntry()).toBeDefined();

      await service.clearAllOperations();

      const adapter = (
        service as unknown as {
          _adapter: OpLogDbAdapter;
        }
      )._adapter;
      spyOn(adapter, 'iterate').and.callThrough();

      expect(await service.getLatestFullStateOpEntry()).toBeUndefined();
      expect(adapter.iterate).not.toHaveBeenCalled();
    });

    it('should not affect state_cache', async () => {
      // Save a state cache
      const stateCache = {
        state: { test: 'data' },
        lastAppliedOpSeq: 5,
        vectorClock: { client1: 5 } as VectorClock,
        compactedAt: Date.now(),
      };
      await service.saveStateCache(stateCache);

      // Add operations
      await service.append(createTestOperation());

      // Clear operations
      await service.clearAllOperations();

      // State cache should still exist
      const loadedCache = await service.loadStateCache();
      expect(loadedCache).not.toBeNull();
      expect(loadedCache?.state).toEqual({ test: 'data' });
    });

    it('should not affect import_backup', async () => {
      // Save an import backup
      const backupState = { preserved: 'backup_data' };
      await service.saveImportBackup(backupState);

      // Add operations
      await service.append(createTestOperation());

      // Clear operations
      await service.clearAllOperations();

      // Import backup should still exist
      const backup = await service.loadImportBackup();
      expect(backup).not.toBeNull();
      expect(backup?.state).toEqual(backupState);
    });
  });

  describe('vector clock cache coherence', () => {
    // Tests for the in-memory _vectorClockCache behavior

    it('should cache vector clock after first read', async () => {
      // Set vector clock in DB
      await service.setVectorClock({ client1: 10 });

      // First read - populates cache
      const clock1 = await service.getVectorClock();
      expect(clock1).toEqual({ client1: 10 });

      // Second read - should return same value (from cache)
      const clock2 = await service.getVectorClock();
      expect(clock2).toEqual({ client1: 10 });

      // Values should be equal but not same reference (defensive copy)
      expect(clock1).not.toBe(clock2);
    });

    it('should update cache when local op is appended', async () => {
      const localOp = createTestOperation({
        vectorClock: { localClient: 5 },
      });

      await service.appendWithVectorClockOverwrite(localOp, 'local');

      // Cache should be updated with the new clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5 });
    });

    it('should NOT update cache when remote op is appended', async () => {
      // First set a local clock
      await service.setVectorClock({ localClient: 10 });

      // Append a remote op with different clock
      const remoteOp = createTestOperation({
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 99, localClient: 15 },
      });
      await service.appendWithVectorClockOverwrite(remoteOp, 'remote');

      // Cache should NOT be updated - still returns local clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 10 });
    });

    it('should return correct clock after mixed local and remote ops', async () => {
      // Local op 1
      const localOp1 = createTestOperation({
        entityId: 'task1',
        vectorClock: { localClient: 1 },
      });
      await service.appendWithVectorClockOverwrite(localOp1, 'local');

      // Remote op (should not affect cache)
      const remoteOp = createTestOperation({
        entityId: 'task2',
        clientId: 'remoteClient',
        vectorClock: { remoteClient: 50, localClient: 5 },
      });
      await service.appendWithVectorClockOverwrite(remoteOp, 'remote');

      // Local op 2
      const localOp2 = createTestOperation({
        entityId: 'task3',
        vectorClock: { localClient: 2 },
      });
      await service.appendWithVectorClockOverwrite(localOp2, 'local');

      // Cache should reflect the last LOCAL op's clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 2 });
    });

    it('should clear cache when _clearAllDataForTesting is called', async () => {
      // Set up vector clock
      await service.setVectorClock({ testClient: 100 });

      // Verify it's set
      let clock = await service.getVectorClock();
      expect(clock).toEqual({ testClient: 100 });

      // Clear all data (includes cache)
      await service._clearAllDataForTesting();

      // Cache should be cleared - getVectorClock should return null
      clock = await service.getVectorClock();
      expect(clock).toBeNull();
    });

    it('should re-read from DB after cache is cleared', async () => {
      // Set vector clock and read it (populates cache)
      await service.setVectorClock({ original: 1 });
      await service.getVectorClock();

      // Clear all data
      await service._clearAllDataForTesting();

      // Set a new vector clock directly
      await service.setVectorClock({ newValue: 42 });

      // Should read from DB (cache was cleared)
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ newValue: 42 });
    });

    it('should return defensive copies from cache', async () => {
      await service.setVectorClock({ client: 5 });

      const clock1 = await service.getVectorClock();
      const clock2 = await service.getVectorClock();

      // Modify one copy
      clock1!.client = 999;

      // Other copy and subsequent reads should be unaffected
      expect(clock2).toEqual({ client: 5 });

      const clock3 = await service.getVectorClock();
      expect(clock3).toEqual({ client: 5 });
    });

    it('should clear cache when clearVectorClockCache is called', async () => {
      // Set vector clock and read it (populates cache)
      await service.setVectorClock({ tabA: 10, tabB: 5 });
      const cachedClock = await service.getVectorClock();
      expect(cachedClock).toEqual({ tabA: 10, tabB: 5 });

      // Clear the cache
      service.clearVectorClockCache();

      // Next read should fetch from IndexedDB (which still has the value)
      const freshClock = await service.getVectorClock();
      expect(freshClock).toEqual({ tabA: 10, tabB: 5 });
    });

    it('should force fresh read from IndexedDB after clearVectorClockCache', async () => {
      // This test simulates the multi-tab scenario where another tab updates IndexedDB
      // while this tab has a stale cache.

      // Set initial clock and populate cache
      await service.setVectorClock({ originalClient: 1 });
      await service.getVectorClock();

      // Simulate another tab writing directly to IndexedDB (bypassing our cache)
      // We do this by using setVectorClock which updates both DB and cache
      await service.setVectorClock({ originalClient: 1, anotherTabClient: 99 });

      // Now clear cache to simulate what happens after acquiring a lock
      service.clearVectorClockCache();

      // Should get the updated value from IndexedDB
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ originalClient: 1, anotherTabClient: 99 });
    });
  });

  describe('import author protection during clock pruning (#9096)', () => {
    const createImportOp = (clientId: string, counter: number): Operation =>
      createTestOperation({
        opType: OpType.SyncImport,
        entityType: 'ALL' as EntityType,
        entityId: undefined,
        clientId,
        vectorClock: { [clientId]: counter },
      });

    const createBusyClientOps = (count: number): Operation[] =>
      Array.from({ length: count }, (_, i) =>
        createTestOperation({
          clientId: `busyClient_${i}`,
          vectorClock: { [`busyClient_${i}`]: 100 + i },
        }),
      );

    it('should keep the stored import author when a remote batch overflows the clock', async () => {
      // Durable baseline after receiving an import from another client: the
      // author's counter is LOW, so uploader-only pruning would evict it first.
      await service.append(createImportOp('importAuthor', 1), 'remote');
      await service.setVectorClock({ importAuthor: 1, testClient: 50 });

      await service.mergeRemoteOpClocks(createBusyClientOps(MAX_VECTOR_CLOCK_SIZE));

      const clock = await service.getVectorClock();
      expect(Object.keys(clock!).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(clock!['importAuthor']).toBe(1);
      expect(clock!['testClient']).toBe(50);
    });

    it('should keep an in-batch import author when later ops in the same batch overflow the clock', async () => {
      await service.setVectorClock({ testClient: 50 });

      await service.mergeRemoteOpClocks([
        createImportOp('importAuthor', 1),
        ...createBusyClientOps(MAX_VECTOR_CLOCK_SIZE + 1),
      ]);

      const clock = await service.getVectorClock();
      expect(Object.keys(clock!).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(clock!['importAuthor']).toBe(1);
    });

    it('should keep the stored import author when the reducer checkpoint prunes the merged clock', async () => {
      await service.append(createImportOp('importAuthor', 1), 'remote');
      await service.setVectorClock({ importAuthor: 1, testClient: 50 });

      const busyOps = createBusyClientOps(MAX_VECTOR_CLOCK_SIZE);
      const seqs: number[] = [];
      for (const op of busyOps) {
        seqs.push(await service.append(op, 'remote', { pendingApply: true }));
      }

      await service.markReducersCommittedAndMergeClocks(seqs, busyOps);

      const clock = await service.getVectorClock();
      expect(Object.keys(clock!).length).toBe(MAX_VECTOR_CLOCK_SIZE);
      expect(clock!['importAuthor']).toBe(1);
    });

    it('should protect the previous active import author when the latest import is rejected in the same checkpoint', async () => {
      // The author must be resolved INSIDE the checkpoint transaction, after
      // rejections are written — a pre-transaction read would still name the
      // about-to-be-rejected import's author and let the real baseline's
      // author be evicted.
      await service.append(createImportOp('olderAuthor', 1), 'remote');
      const rejectedImport = createImportOp('rejectedAuthor', 2);
      await service.append(rejectedImport, 'remote', { pendingApply: true });
      await service.setVectorClock({ olderAuthor: 1, rejectedAuthor: 2, testClient: 50 });

      const busyOps = createBusyClientOps(MAX_VECTOR_CLOCK_SIZE);
      const seqs: number[] = [];
      for (const op of busyOps) {
        seqs.push(await service.append(op, 'remote', { pendingApply: true }));
      }

      await service.markReducersCommittedAndMergeClocks(seqs, busyOps, [
        rejectedImport.id,
      ]);

      const clock = await service.getVectorClock();
      expect(clock!['olderAuthor']).toBe(1);
      expect((await service.getLatestFullStateOpEntry())?.op.clientId).toBe(
        'olderAuthor',
      );
    });
  });

  describe('mergeRemoteOpClocks', () => {
    it('should merge remote ops clocks into local clock', async () => {
      // Set initial local clock
      await service.setVectorClock({ localClient: 5 });

      // Create remote ops with different clocks
      const remoteOps = [
        createTestOperation({
          clientId: 'remoteClientA',
          vectorClock: { remoteClientA: 10 },
        }),
        createTestOperation({
          clientId: 'remoteClientB',
          vectorClock: { remoteClientB: 3, remoteClientA: 5 },
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      // Local clock should now include all remote clock entries
      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        localClient: 5,
        remoteClientA: 10, // Max of 10 and 5
        remoteClientB: 3,
      });
    });

    it('should take maximum value when merging overlapping clock entries', async () => {
      await service.setVectorClock({ clientA: 5, clientB: 3 });

      const remoteOps = [
        createTestOperation({
          vectorClock: { clientA: 3, clientB: 7, clientC: 1 },
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 5, // Local was higher (5 > 3)
        clientB: 7, // Remote was higher (7 > 3)
        clientC: 1, // New from remote
      });
    });

    it('should handle empty ops array', async () => {
      await service.setVectorClock({ localClient: 5 });

      await service.mergeRemoteOpClocks([]);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5 });
    });

    it('should handle null local clock', async () => {
      // Don't set any local clock

      const remoteOps = [
        createTestOperation({
          vectorClock: { remoteClient: 10 },
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ remoteClient: 10 });
    });

    it('should not throw and store merged clock when loadClientId returns null (invalid stored ID)', async () => {
      // Simulate issue #6197: stored clientId has an invalid format, loadClientId() returns null.
      // mergeRemoteOpClocks must not throw — it falls back to storing the full merged clock
      // without pruning (suboptimal but safe).
      spyOn(mockClientIdProvider, 'loadClientId').and.resolveTo(null);
      await service.setVectorClock({ localClient: 3 });

      const remoteOps = [
        createTestOperation({
          clientId: 'remoteClient',
          vectorClock: { remoteClient: 7, localClient: 2 },
        }),
      ];

      await expectAsync(service.mergeRemoteOpClocks(remoteOps)).toBeResolved();

      // The merged clock must contain all entries (no pruning without a clientId, but no data loss)
      const clock = await service.getVectorClock();
      expect(clock).toEqual(
        jasmine.objectContaining({
          remoteClient: 7,
          localClient: 3, // local was higher (3 > 2)
        }),
      );
    });

    it('should REPLACE clock for SYNC_IMPORT (not merge into old clock)', async () => {
      // SYNC_IMPORT is a clean slate — old clock entries are irrelevant.
      // Merging would cause clock bloat → server pruning → CONCURRENT comparisons.
      await service.setVectorClock({ clientB: 5 });

      const syncImportOp = createTestOperation({
        clientId: 'clientA',
        opType: OpType.SyncImport,
        vectorClock: { clientA: 1 },
      });

      await service.mergeRemoteOpClocks([syncImportOp]);

      const clock = await service.getVectorClock();
      // Old clientB entry should be gone — replaced, not merged
      expect(clock).toEqual({
        clientA: 1,
      });
    });

    it('should REPLACE (not merge) vector clock when receiving a full-state BACKUP_IMPORT', async () => {
      // BUG REPRODUCTION: When a client with a well-established clock receives a
      // remote BACKUP_IMPORT with a fresh clock, the local clock should be REPLACED
      // (not merged into the old clock).
      //
      // Without replacement:
      // 1. Old 10-entry clock gets B_sUq7:1 merged in → 11 entries
      // 2. Client creates new ops with 11-entry clock
      // 3. Server prunes to 10 entries, dropping B_sUq7:1 (lowest counter)
      // 4. Other clients compare: op missing B_sUq7 → CONCURRENT with import → discarded
      //
      // With replacement:
      // 1. Clock becomes {B_sUq7:1}
      // 2. Client creates new ops: {B_sUq7:1, localClient:1} (2 entries, no pruning)
      // 3. Comparison: GREATER_THAN import → kept correctly

      // Step 1: Simulate a well-established client at MAX_VECTOR_CLOCK_SIZE
      const existingClock: VectorClock = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        existingClock[`oldClient_${i}`] = (i + 1) * 100;
      }
      await service.setVectorClock(existingClock);

      // Step 2: Receive a BACKUP_IMPORT with a fresh clock (user exported/imported from file)
      const backupImportOp = createTestOperation({
        opType: OpType.BackupImport,
        clientId: 'importClient',
        vectorClock: { importClient: 1 },
      });
      await service.mergeRemoteOpClocks([backupImportOp]);

      // Step 3: The clock should be REPLACED, not merged
      const clockAfterImport = await service.getVectorClock();

      // Old entries should be gone - the import is a clean slate
      expect(clockAfterImport).toEqual({ importClient: 1 });
    });

    it('should ensure ops created after receiving BACKUP_IMPORT survive server-side pruning and remain GREATER_THAN import', async () => {
      // End-to-end verification: After receiving a BACKUP_IMPORT, new ops from
      // this client should be GREATER_THAN the import even after server-side pruning.
      // This is the user-visible consequence of the clock replacement fix.

      // Simulate established client with MAX entries
      const existingClock: VectorClock = {};
      for (let i = 0; i < MAX_VECTOR_CLOCK_SIZE; i++) {
        existingClock[`oldClient_${i}`] = (i + 1) * 100;
      }
      await service.setVectorClock(existingClock);

      // Receive BACKUP_IMPORT with fresh clock
      const importClock: VectorClock = { importClient: 1 };
      await service.mergeRemoteOpClocks([
        createTestOperation({
          opType: OpType.BackupImport,
          clientId: 'importClient',
          vectorClock: importClock,
        }),
      ]);

      // Simulate creating a new local op (increment the stored clock)
      const storedClock = await service.getVectorClock();
      const newOpClock = incrementVectorClock(storedClock, 'localClient');

      // Simulate server-side pruning (server prunes to MAX_VECTOR_CLOCK_SIZE)
      const prunedClock = limitVectorClockSize(newOpClock, ['localClient']);

      // importClient must survive pruning
      expect(prunedClock['importClient']).toBe(1);

      // The pruned clock must be GREATER_THAN the import (not CONCURRENT)
      const comparison = compareVectorClocks(prunedClock, importClock);
      expect(comparison).toBe(VectorClockComparison.GREATER_THAN);
    });

    it('should merge multiple ops in sequence correctly', async () => {
      await service.setVectorClock({ localClient: 1 });

      // First batch of remote ops
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { clientA: 5 } }),
        createTestOperation({ vectorClock: { clientB: 3 } }),
      ]);

      let clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 1, clientA: 5, clientB: 3 });

      // Second batch of remote ops
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { clientA: 7, clientC: 2 } }),
      ]);

      clock = await service.getVectorClock();
      expect(clock).toEqual({
        localClient: 1,
        clientA: 7, // Updated from 5 to 7
        clientB: 3,
        clientC: 2, // New entry
      });
    });

    it('should update cache after merge', async () => {
      await service.setVectorClock({ localClient: 5 });

      // Read to populate cache
      await service.getVectorClock();

      // Merge remote clocks
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { remoteClient: 10 } }),
      ]);

      // Cache should be updated - next read should include remote clock
      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5, remoteClient: 10 });
    });

    it('should persist merged clock to IndexedDB', async () => {
      await service.setVectorClock({ localClient: 5 });

      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { remoteClient: 10 } }),
      ]);

      // Re-initialize service to force reading from IndexedDB
      await service._clearAllDataForTesting();
      await service.init();
      await service.setVectorClock({ localClient: 5, remoteClient: 10 });

      const clock = await service.getVectorClock();
      expect(clock).toEqual({ localClient: 5, remoteClient: 10 });
    });

    it('should handle ops with overlapping but different clock entries', async () => {
      // Simulate multiple clients with complex clock histories
      await service.setVectorClock({ clientA: 10, clientB: 5, clientC: 3 });

      const remoteOps = [
        createTestOperation({
          vectorClock: { clientA: 8, clientD: 7 }, // clientA lower, clientD new
        }),
        createTestOperation({
          vectorClock: { clientB: 12, clientE: 2 }, // clientB higher, clientE new
        }),
        createTestOperation({
          vectorClock: { clientC: 3, clientF: 1 }, // clientC equal, clientF new
        }),
      ];

      await service.mergeRemoteOpClocks(remoteOps);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 10, // local was higher (10 > 8)
        clientB: 12, // remote was higher (12 > 5)
        clientC: 3, // equal
        clientD: 7, // new from remote
        clientE: 2, // new from remote
        clientF: 1, // new from remote
      });
    });

    it('should handle op with zero vector clock values', async () => {
      await service.setVectorClock({ clientA: 5 });

      // Some ops might have 0 values (edge case)
      await service.mergeRemoteOpClocks([
        createTestOperation({ vectorClock: { clientA: 0, clientB: 0 } }),
      ]);

      const clock = await service.getVectorClock();
      expect(clock).toEqual({
        clientA: 5, // local higher than 0
        clientB: 0, // 0 merged in
      });
    });

    it('should handle large number of remote ops efficiently and prune to MAX_VECTOR_CLOCK_SIZE', async () => {
      await service.setVectorClock({ localClient: 1 });

      // Create 100 remote ops
      const remoteOps = Array.from({ length: 100 }, (_, i) =>
        createTestOperation({
          id: `op-${i}`,
          vectorClock: { [`client${i}`]: i + 1 },
        }),
      );

      const startTime = Date.now();
      await service.mergeRemoteOpClocks(remoteOps);
      const endTime = Date.now();

      // Should complete quickly (less than 100ms even for 100 ops)
      expect(endTime - startTime).toBeLessThan(100);

      const clock = await service.getVectorClock();
      expect(clock).not.toBeNull();
      // Merged clock is pruned to MAX_VECTOR_CLOCK_SIZE to break the inflate/prune cycle
      expect(Object.keys(clock!).length).toBeLessThanOrEqual(MAX_VECTOR_CLOCK_SIZE);
      // Highest-counter clients are preserved by the pruning algorithm
      expect(clock!['client99']).toBe(100);
    });

    it('should REPLACE clock from SYNC_IMPORT, discarding old entries', async () => {
      // SYNC_IMPORT is a clean slate — old local entries are irrelevant.
      await service.setVectorClock({
        clientA: 100,
        clientB: 50,
        clientC: 25,
        localClient: 200,
      });

      // Another client did a SYNC_IMPORT that only knew about some clients
      const syncImportOp = createTestOperation({
        opType: OpType.SyncImport,
        clientId: 'clientX',
        vectorClock: {
          clientX: 1,
          clientA: 80,
          clientD: 30,
        },
      });

      await service.mergeRemoteOpClocks([syncImportOp]);

      const clock = await service.getVectorClock();
      // After SYNC_IMPORT, the working clock is reset to minimal:
      // only the import client's entry + the receiving client's entry.
      // The full import clock is preserved in the stored operation for filtering.
      // Old entries (clientA, clientB, clientC, clientD, localClient) are dropped.
      expect(clock).toEqual({
        clientX: 1,
      });
    });
  });

  describe('index fallback behavior', () => {
    // These tests verify that getPendingRemoteOps and getFailedRemoteOps
    // gracefully handle missing bySourceAndStatus index (for legacy DBs)

    it('getPendingRemoteOps should fall back to full scan when index throws', async () => {
      // Create some test data first
      const pendingOp = createTestOperation({ entityId: 'pending-task' });
      const appliedOp = createTestOperation({ entityId: 'applied-task' });

      await service.append(appliedOp, 'remote'); // applied by default
      await service.append(pendingOp, 'remote', { pendingApply: true });

      // Access the internal db and spy on getAllFromIndex
      const db = (service as any)._db;
      const originalGetAllFromIndex = db.getAllFromIndex.bind(db);

      spyOn(db, 'getAllFromIndex').and.callFake(
        (storeName: string, indexName: string, query: any) => {
          if (indexName === 'bySourceAndStatus') {
            // Simulate missing index error
            throw new DOMException(
              "Failed to execute 'index' on 'IDBObjectStore': The specified index was not found.",
              'NotFoundError',
            );
          }
          return originalGetAllFromIndex(storeName, indexName, query);
        },
      );

      // Should still work via fallback
      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(1);
      expect(pending[0].op.entityId).toBe('pending-task');
      expect(pending[0].source).toBe('remote');
      expect(pending[0].applicationStatus).toBe('pending');
    });

    it('getFailedRemoteOps should fall back to full scan when index throws', async () => {
      // Create test data
      const failedOp = createTestOperation({ entityId: 'failed-task' });
      const pendingOp = createTestOperation({ entityId: 'pending-task' });

      await service.append(failedOp, 'remote', { pendingApply: true });
      await service.append(pendingOp, 'remote', { pendingApply: true });
      await service.markFailed([failedOp.id]);

      // Access the internal db and spy on getAllFromIndex
      const db = (service as any)._db;
      const originalGetAllFromIndex = db.getAllFromIndex.bind(db);

      spyOn(db, 'getAllFromIndex').and.callFake(
        (storeName: string, indexName: string, query: any) => {
          if (indexName === 'bySourceAndStatus') {
            throw new DOMException(
              "Failed to execute 'index' on 'IDBObjectStore': The specified index was not found.",
              'NotFoundError',
            );
          }
          return originalGetAllFromIndex(storeName, indexName, query);
        },
      );

      // Should still work via fallback
      const failed = await service.getFailedRemoteOps();

      expect(failed.length).toBe(1);
      expect(failed[0].op.entityId).toBe('failed-task');
      expect(failed[0].source).toBe('remote');
      expect(failed[0].applicationStatus).toBe('failed');
    });

    it('getPendingRemoteOps fallback should filter correctly with mixed data', async () => {
      // Create a variety of ops to ensure filtering works correctly
      const localOp = createTestOperation({ entityId: 'local-task' });
      const remoteApplied = createTestOperation({ entityId: 'remote-applied' });
      const remotePending1 = createTestOperation({ entityId: 'remote-pending-1' });
      const remotePending2 = createTestOperation({ entityId: 'remote-pending-2' });

      await service.append(localOp, 'local');
      await service.append(remoteApplied, 'remote');
      await service.append(remotePending1, 'remote', { pendingApply: true });
      await service.append(remotePending2, 'remote', { pendingApply: true });

      // Force fallback path
      const db = (service as any)._db;
      spyOn(db, 'getAllFromIndex').and.throwError(
        new DOMException('Index not found', 'NotFoundError'),
      );

      const pending = await service.getPendingRemoteOps();

      expect(pending.length).toBe(2);
      const entityIds = pending.map((p) => p.op.entityId).sort();
      expect(entityIds).toEqual(['remote-pending-1', 'remote-pending-2']);
    });

    it('getFailedRemoteOps fallback should exclude rejected ops', async () => {
      const failedOp = createTestOperation({ entityId: 'failed' });
      const rejectedOp = createTestOperation({ entityId: 'rejected' });

      await service.append(failedOp, 'remote', { pendingApply: true });
      await service.append(rejectedOp, 'remote', { pendingApply: true });
      await service.markFailed([failedOp.id]);
      await service.markFailed([rejectedOp.id]);
      await service.markRejected([rejectedOp.id]);

      // Force fallback path
      const db = (service as any)._db;
      spyOn(db, 'getAllFromIndex').and.throwError(
        new DOMException('Index not found', 'NotFoundError'),
      );

      const failed = await service.getFailedRemoteOps();

      // Only the failed (not rejected) op should be returned
      expect(failed.length).toBe(1);
      expect(failed[0].op.entityId).toBe('failed');
    });
  });

  describe('hasSyncedOps', () => {
    it('should return false when no ops exist', async () => {
      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return false when only unsynced ops exist', async () => {
      const op = createTestOperation();
      await service.append(op, 'local');

      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return true when synced ops exist', async () => {
      const op = createTestOperation();
      const seq = await service.append(op, 'local');
      await service.markSynced([seq]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(true);
    });

    it('should return false when only MIGRATION ops have syncedAt', async () => {
      const migrationOp = createTestOperation({
        entityType: 'MIGRATION' as EntityType,
        entityId: '*',
        opType: OpType.Batch,
      });
      const seq = await service.append(migrationOp, 'local');
      await service.markSynced([seq]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return false when only RECOVERY ops have syncedAt', async () => {
      const recoveryOp = createTestOperation({
        entityType: 'RECOVERY' as EntityType,
        entityId: '*',
        opType: OpType.Batch,
      });
      const seq = await service.append(recoveryOp, 'local');
      await service.markSynced([seq]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });

    it('should return true when mixed MIGRATION and regular synced ops exist', async () => {
      // Add MIGRATION op
      const migrationOp = createTestOperation({
        entityType: 'MIGRATION' as EntityType,
        entityId: '*',
        opType: OpType.Batch,
      });
      const seq1 = await service.append(migrationOp, 'local');
      await service.markSynced([seq1]);

      // Add regular op
      const regularOp = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      const seq2 = await service.append(regularOp, 'local');
      await service.markSynced([seq2]);

      const result = await service.hasSyncedOps();
      expect(result).toBe(true);
    });

    it('should handle multiple MIGRATION/RECOVERY ops correctly', async () => {
      // Add multiple MIGRATION ops
      for (let i = 0; i < 3; i++) {
        const migrationOp = createTestOperation({
          entityType: 'MIGRATION' as EntityType,
          entityId: '*',
          opType: OpType.Batch,
        });
        const seq = await service.append(migrationOp, 'local');
        await service.markSynced([seq]);
      }

      // All are MIGRATION, so should return false
      const result = await service.hasSyncedOps();
      expect(result).toBe(false);
    });
  });

  describe('clearUnsyncedOps', () => {
    it('should mark all unsynced ops as rejected', async () => {
      // Add some unsynced ops
      const op1 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      const op2 = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-2',
        opType: OpType.Update,
      });
      await service.append(op1, 'local');
      await service.append(op2, 'local');

      // Verify they are unsynced
      let unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(2);

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      // Should have no unsynced ops now
      unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should not affect already synced ops', async () => {
      // Add a synced op
      const syncedOp = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-synced',
        opType: OpType.Create,
      });
      const seq1 = await service.append(syncedOp, 'local');
      await service.markSynced([seq1]);

      // Add an unsynced op
      const unsyncedOp = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-unsynced',
        opType: OpType.Create,
      });
      await service.append(unsyncedOp, 'local');

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      // Synced op should still exist and be queryable by ID
      const entry = await service.getOpById(syncedOp.id);
      expect(entry).toBeTruthy();
      expect(entry!.syncedAt).toBeDefined();
      expect(entry!.rejectedAt).toBeUndefined();
    });

    it('should handle empty unsynced list gracefully', async () => {
      // No ops added - nothing to clear
      await expectAsync(service.clearUnsyncedOps()).toBeResolved();

      // Should still have no unsynced ops
      const unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should update rejectedAt timestamp for each cleared op', async () => {
      const beforeClear = Date.now();

      // Add unsynced op
      const op = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      await service.append(op, 'local');

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      const afterClear = Date.now();

      // Get the stored entry directly to check rejectedAt
      const entry = await service.getOpById(op.id);
      expect(entry).toBeTruthy();
      expect(entry!.rejectedAt).toBeDefined();
      expect(entry!.rejectedAt).toBeGreaterThanOrEqual(beforeClear);
      expect(entry!.rejectedAt).toBeLessThanOrEqual(afterClear);
    });

    it('should invalidate unsynced cache', async () => {
      // Add unsynced ops
      const op = createTestOperation({
        entityType: 'TASK' as EntityType,
        entityId: 'task-1',
        opType: OpType.Create,
      });
      await service.append(op, 'local');

      // Read unsynced (populates cache)
      let unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(1);

      // Clear unsynced ops
      await service.clearUnsyncedOps();

      // Should read from DB (cache invalidated) and show no unsynced ops
      unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });

    it('should clear multiple unsynced ops', async () => {
      // Add multiple unsynced ops
      for (let i = 0; i < 10; i++) {
        const op = createTestOperation({
          entityType: 'TASK' as EntityType,
          entityId: `task-${i}`,
          opType: OpType.Create,
        });
        await service.append(op, 'local');
      }

      // Verify they are all unsynced
      let unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(10);

      // Clear all
      await service.clearUnsyncedOps();

      // Should have none
      unsynced = await service.getUnsynced();
      expect(unsynced.length).toBe(0);
    });
  });

  describe('_openDbWithRetry classification and budget', () => {
    // Uses a fresh, un-initialized service and spies on `_openDbOnce` (the
    // testing seam around the real `openDB` call) to observe classification
    // and retry-budget behavior without mocking the `idb` module.
    let retryService: OperationLogStoreService;
    let openSpy: jasmine.Spy;

    const makeFakeDb = (): any => ({
      addEventListener: () => {},
    });

    beforeEach(() => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          OperationLogStoreService,
          { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        ],
      });
      retryService = TestBed.inject(OperationLogStoreService);
      openSpy = spyOn<any>(retryService, '_openDbOnce');
    });

    it('makes 1 + IDB_OPEN_RETRIES_NON_LOCK attempts and throws on a generic error', fakeAsync(() => {
      openSpy.and.returnValue(Promise.reject(new Error('generic')));

      let caught: unknown;
      retryService.init().catch((e) => {
        caught = e;
      });

      // Advance past each backoff window. With base=1000ms and 3 non-lock
      // retries, delays are 1s, 2s, 4s before attempts 2, 3, 4.
      for (let i = 1; i <= IDB_OPEN_RETRIES_NON_LOCK; i++) {
        tick(IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, i - 1));
      }
      // Final tick to resolve the rejection
      tick();

      expect(openSpy).toHaveBeenCalledTimes(1 + IDB_OPEN_RETRIES_NON_LOCK);
      expect(caught).toBeInstanceOf(IndexedDBOpenError);
    }));

    it('makes up to 1 + IDB_OPEN_RETRIES attempts on a lock-related InvalidStateError', fakeAsync(() => {
      const lockErr = new Error('Internal error.');
      lockErr.name = 'InvalidStateError';
      openSpy.and.returnValue(Promise.reject(lockErr));

      let caught: unknown;
      retryService.init().catch((e) => {
        caught = e;
      });

      // Drain all backoff windows for the full lock budget.
      for (let i = 1; i <= IDB_OPEN_RETRIES; i++) {
        tick(IDB_OPEN_RETRY_BASE_DELAY_MS * Math.pow(2, i - 1));
      }
      tick();

      expect(openSpy).toHaveBeenCalledTimes(1 + IDB_OPEN_RETRIES);
      // Sanity: lock budget strictly exceeds the non-lock budget.
      expect(openSpy.calls.count()).toBeGreaterThan(1 + IDB_OPEN_RETRIES_NON_LOCK);
      expect(caught).toBeInstanceOf(IndexedDBOpenError);
    }));

    it('returns the database when a single lock-related failure is followed by a success', fakeAsync(() => {
      const lockErr = new Error('Internal error opening backing store');
      const fakeDb = makeFakeDb();
      openSpy.and.returnValues(Promise.reject(lockErr), Promise.resolve(fakeDb));

      let resolved = false;
      retryService.init().then(() => {
        resolved = true;
      });

      // First attempt rejects immediately; backoff before attempt 2 is 1s.
      tick(IDB_OPEN_RETRY_BASE_DELAY_MS);
      tick();

      expect(openSpy).toHaveBeenCalledTimes(2);
      expect(resolved).toBe(true);
      expect((retryService as any)._db).toBe(fakeDb);
    }));
  });
});
