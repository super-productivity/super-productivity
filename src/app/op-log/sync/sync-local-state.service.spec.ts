import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { SyncLocalStateService } from './sync-local-state.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import {
  ActionType,
  EntityType,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';

type StateCache = NonNullable<
  Awaited<ReturnType<OperationLogStoreService['loadStateCache']>>
>;

describe('SyncLocalStateService', () => {
  let service: SyncLocalStateService;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let stateSnapshotSpy: jasmine.SpyObj<StateSnapshotService>;

  const entry = (
    entityType: EntityType,
    actionType: ActionType,
    opType: OpType,
    source: 'local' | 'remote' = 'local',
  ): OperationLogEntry => ({
    seq: 1,
    op: {
      id: `op-${entityType}`,
      clientId: 'client-A',
      actionType,
      opType,
      entityType,
      entityId: 'SINGLETON',
      payload: {},
      vectorClock: { clientA: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
    },
    appliedAt: Date.now(),
    source,
  });

  const migrationGenesis = entry(
    'MIGRATION',
    ActionType.MIGRATION_GENESIS_IMPORT,
    OpType.Batch,
  );
  const recoveryGenesis = entry(
    'RECOVERY',
    ActionType.RECOVERY_DATA_IMPORT,
    OpType.Batch,
  );
  const regularOp = entry('TASK', '[Task] Add Task' as ActionType, OpType.Create);
  const syncImport = entry('ALL', ActionType.LOAD_ALL_DATA, OpType.SyncImport);

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'loadStateCache',
      'getLastSeq',
      'hasSyncedOps',
      'getLatestFullStateOpEntry',
      'getFirstOpEntry',
    ]);
    // Defaults describe a legacy-migrated client that has never synced: the
    // genesis wrote a state cache and one op, nothing else happened since.
    opLogStoreSpy.loadStateCache.and.resolveTo({ state: {} } as unknown as StateCache);
    opLogStoreSpy.getLastSeq.and.resolveTo(1);
    opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
    opLogStoreSpy.getLatestFullStateOpEntry.and.resolveTo(undefined);
    opLogStoreSpy.getFirstOpEntry.and.resolveTo(migrationGenesis);

    stateSnapshotSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotAsync',
    ]);

    TestBed.configureTestingModule({
      providers: [
        SyncLocalStateService,
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: StateSnapshotService, useValue: stateSnapshotSpy },
        {
          provide: TranslateService,
          useValue: jasmine.createSpyObj('TranslateService', ['instant']),
        },
      ],
    });
    service = TestBed.inject(SyncLocalStateService);
  });

  describe('isNeverSyncedGenesisClient (#9863)', () => {
    it('is true when the log starts with a MIGRATION genesis and nothing was ever synced', async () => {
      expect(await service.isNeverSyncedGenesisClient()).toBe(true);
    });

    it('is true for a RECOVERY genesis as well', async () => {
      opLogStoreSpy.getFirstOpEntry.and.resolveTo(recoveryGenesis);
      expect(await service.isNeverSyncedGenesisClient()).toBe(true);
    });

    it('is false once real sync history exists', async () => {
      opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
      expect(await service.isNeverSyncedGenesisClient()).toBe(false);
      expect(opLogStoreSpy.getFirstOpEntry).not.toHaveBeenCalled();
    });

    it('is false once a local full-state op exists (state already ships as SYNC_IMPORT)', async () => {
      opLogStoreSpy.getLatestFullStateOpEntry.and.resolveTo(syncImport);
      expect(await service.isNeverSyncedGenesisClient()).toBe(false);
      expect(opLogStoreSpy.getFirstOpEntry).not.toHaveBeenCalled();
    });

    it("is false when the first op is another client's genesis (raw rebuild from server history)", async () => {
      opLogStoreSpy.getFirstOpEntry.and.resolveTo(
        entry('MIGRATION', ActionType.MIGRATION_GENESIS_IMPORT, OpType.Batch, 'remote'),
      );
      expect(await service.isNeverSyncedGenesisClient()).toBe(false);
    });

    it('is false when the first op is a regular op', async () => {
      opLogStoreSpy.getFirstOpEntry.and.resolveTo(regularOp);
      expect(await service.isNeverSyncedGenesisClient()).toBe(false);
    });

    it('is false for an empty log', async () => {
      opLogStoreSpy.getFirstOpEntry.and.resolveTo(undefined);
      expect(await service.isNeverSyncedGenesisClient()).toBe(false);
    });
  });

  describe('isFreshOrNeverSyncedGenesisClient', () => {
    it('is true for a wholly fresh client without reading the log', async () => {
      opLogStoreSpy.loadStateCache.and.resolveTo(null);
      opLogStoreSpy.getLastSeq.and.resolveTo(0);
      expect(await service.isFreshOrNeverSyncedGenesisClient([regularOp.op])).toBe(true);
      expect(opLogStoreSpy.getFirstOpEntry).not.toHaveBeenCalled();
    });

    it('stays true for a wholly fresh client even when a full-state op is incoming', async () => {
      opLogStoreSpy.loadStateCache.and.resolveTo(null);
      opLogStoreSpy.getLastSeq.and.resolveTo(0);
      expect(await service.isFreshOrNeverSyncedGenesisClient([syncImport.op])).toBe(true);
    });

    it('is true for a never-synced genesis client receiving ordinary ops', async () => {
      expect(await service.isFreshOrNeverSyncedGenesisClient([regularOp.op])).toBe(true);
    });

    it('defers a genesis client to the incoming-import gate when a full-state op is incoming', async () => {
      expect(
        await service.isFreshOrNeverSyncedGenesisClient([regularOp.op, syncImport.op]),
      ).toBe(false);
      expect(opLogStoreSpy.getFirstOpEntry).not.toHaveBeenCalled();
    });

    it('is false for a client with ordinary history', async () => {
      opLogStoreSpy.getFirstOpEntry.and.resolveTo(regularOp);
      expect(await service.isFreshOrNeverSyncedGenesisClient([regularOp.op])).toBe(false);
    });
  });

  describe('hasMeaningfulStoreData (#9932)', () => {
    const emptyArchive = {
      task: { ids: [], entities: {} },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    };
    const emptyNgRx = {
      task: { ids: [], entities: {} },
      project: { ids: ['INBOX_PROJECT'], entities: {} },
      tag: { ids: ['TODAY'], entities: {} },
      note: { ids: [], entities: {} },
    };

    beforeEach(() => {
      // What getStateSnapshot() reports: NgRx plus placeholder archives.
      stateSnapshotSpy.getStateSnapshot.and.returnValue({
        ...emptyNgRx,
        archiveYoung: emptyArchive,
        archiveOld: emptyArchive,
      } as any);
      stateSnapshotSpy.getStateSnapshotAsync.and.resolveTo({
        ...emptyNgRx,
        archiveYoung: emptyArchive,
        archiveOld: emptyArchive,
      } as any);
    });

    it('answers from the store snapshot alone when it already holds user data', async () => {
      stateSnapshotSpy.getStateSnapshot.and.returnValue({
        ...emptyNgRx,
        task: { ids: ['t1'], entities: {} },
      } as any);

      expect(await service.hasMeaningfulStoreData()).toBe(true);
      expect(stateSnapshotSpy.getStateSnapshotAsync).not.toHaveBeenCalled();
    });

    it('reads the archives when the store holds nothing and counts an archived task', async () => {
      stateSnapshotSpy.getStateSnapshotAsync.and.resolveTo({
        ...emptyNgRx,
        archiveYoung: {
          ...emptyArchive,
          task: { ids: ['archived-1'], entities: {} },
        },
        archiveOld: emptyArchive,
      } as any);

      expect(await service.hasMeaningfulStoreData()).toBe(true);
      expect(stateSnapshotSpy.getStateSnapshotAsync).toHaveBeenCalledTimes(1);
    });

    it('is false when both the store and the archives are empty', async () => {
      expect(await service.hasMeaningfulStoreData()).toBe(false);
      expect(stateSnapshotSpy.getStateSnapshotAsync).toHaveBeenCalledTimes(1);
    });

    it('applies ignoreTaskIds to the store check but still reads the archives (#7985)', async () => {
      stateSnapshotSpy.getStateSnapshot.and.returnValue({
        ...emptyNgRx,
        task: { ids: ['example-1'], entities: {} },
      } as any);

      expect(await service.hasMeaningfulStoreData(new Set(['example-1']))).toBe(false);
      expect(stateSnapshotSpy.getStateSnapshotAsync).toHaveBeenCalledTimes(1);
    });
  });
});
