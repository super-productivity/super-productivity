/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { ServerMigrationService } from './server-migration.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { OpType } from '../core/operation.types';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';

describe('ServerMigrationService', () => {
  let service: ServerMigrationService;
  let store: MockStore;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let vectorClockServiceSpy: jasmine.SpyObj<VectorClockService>;
  let validateStateServiceSpy: jasmine.SpyObj<ValidateStateService>;
  let stateSnapshotServiceSpy: jasmine.SpyObj<StateSnapshotService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let clientIdProviderSpy: jasmine.SpyObj<ClientIdProvider>;
  let defaultProvider: OperationSyncProvider;

  // Type for operation-sync-capable provider
  type OperationSyncProvider = SyncProviderServiceInterface<SyncProviderId> &
    OperationSyncCapable;

  // Mock sync provider that supports operations
  const createMockSyncProvider = (): OperationSyncProvider => {
    return {
      supportsOperationSync: true,
      id: 'SuperSync' as SyncProviderId,
      maxConcurrentRequests: 10,
      getLastServerSeq: jasmine
        .createSpy('getLastServerSeq')
        .and.returnValue(Promise.resolve(0)),
      downloadOps: jasmine
        .createSpy('downloadOps')
        .and.returnValue(Promise.resolve({ ops: [], latestSeq: 0, hasMore: false })),
      uploadOps: jasmine.createSpy('uploadOps'),
      uploadSnapshot: jasmine.createSpy('uploadSnapshot'),
      setLastServerSeq: jasmine.createSpy('setLastServerSeq'),
      privateCfg: {} as any,
      getFileRev: jasmine.createSpy('getFileRev'),
      downloadFile: jasmine.createSpy('downloadFile'),
      uploadFile: jasmine.createSpy('uploadFile'),
      removeFile: jasmine.createSpy('removeFile'),
      isReady: jasmine.createSpy('isReady'),
      setPrivateCfg: jasmine.createSpy('setPrivateCfg'),
    } as unknown as OperationSyncProvider;
  };

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'hasSyncedOps',
      'append',
      'getOpsAfterSeq',
    ]);
    vectorClockServiceSpy = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    validateStateServiceSpy = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
    ]);
    stateSnapshotServiceSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    clientIdProviderSpy = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);

    // Default mock returns
    opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(true));
    opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
    opLogStoreSpy.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
    vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ 'test-client': 5 }),
    );
    validateStateServiceSpy.validateAndRepair.and.returnValue({
      isValid: true,
      wasRepaired: false,
    } as any);
    stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
      task: {
        ids: ['task-1'],
        entities: { 'task-1': { id: 'task-1', title: 'Test' } },
      },
      project: { ids: [], entities: {} },
      tag: { ids: [], entities: {} },
    } as any);
    clientIdProviderSpy.loadClientId.and.returnValue(Promise.resolve('test-client'));

    TestBed.configureTestingModule({
      providers: [
        ServerMigrationService,
        provideMockStore(),
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: VectorClockService, useValue: vectorClockServiceSpy },
        { provide: ValidateStateService, useValue: validateStateServiceSpy },
        { provide: StateSnapshotService, useValue: stateSnapshotServiceSpy },
        { provide: SnackService, useValue: snackServiceSpy },
        { provide: CLIENT_ID_PROVIDER, useValue: clientIdProviderSpy },
      ],
    });

    service = TestBed.inject(ServerMigrationService);
    store = TestBed.inject(MockStore);
    spyOn(store, 'dispatch');

    // Create a default provider for handleServerMigration tests
    defaultProvider = createMockSyncProvider();
  });

  describe('checkAndHandleMigration', () => {
    // Note: The check for non-operation-sync-capable providers is now done at
    // a higher level (sync.service.ts), so these methods expect OperationSyncCapable.

    it('should skip if lastServerSeq !== 0 (already synced with server)', async () => {
      const provider = createMockSyncProvider();
      (provider.getLastServerSeq as jasmine.Spy).and.returnValue(Promise.resolve(10));

      await service.checkAndHandleMigration(provider);

      expect(provider.downloadOps).not.toHaveBeenCalled();
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should skip if server has data (latestSeq !== 0)', async () => {
      const provider = createMockSyncProvider();
      (provider.getLastServerSeq as jasmine.Spy).and.returnValue(Promise.resolve(0));
      (provider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 5, hasMore: false }),
      );

      await service.checkAndHandleMigration(provider);

      expect(opLogStoreSpy.hasSyncedOps).not.toHaveBeenCalled();
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should skip if client has no previously synced ops (fresh client)', async () => {
      const provider = createMockSyncProvider();
      opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(false));

      await service.checkAndHandleMigration(provider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should call handleServerMigration when all conditions are met', async () => {
      const provider = createMockSyncProvider();
      (provider.getLastServerSeq as jasmine.Spy).and.returnValue(Promise.resolve(0));
      (provider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 0, hasMore: false }),
      );
      opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(true));

      await service.checkAndHandleMigration(provider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];
      expect(appendedOp.opType).toBe(OpType.SyncImport);
    });
  });

  describe('handleServerMigration', () => {
    it('should skip if state is empty (no tasks/projects/tags)', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should skip if state only has system tags', async () => {
      const systemTagIds = Array.from(SYSTEM_TAG_IDS);
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
        tag: { ids: systemTagIds, entities: {} },
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should abort if state validation fails', async () => {
      validateStateServiceSpy.validateAndRepair.and.returnValue({
        isValid: false,
        wasRepaired: false,
        error: 'Validation failed',
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
      expect(snackServiceSpy.open).toHaveBeenCalledWith(
        jasmine.objectContaining({ type: 'ERROR' }),
      );
    });

    it('should use repaired state and dispatch to store if repair occurred', async () => {
      const repairedState = {
        task: {
          ids: ['task-1'],
          entities: { 'task-1': { id: 'task-1', title: 'Repaired' } },
        },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
      };

      validateStateServiceSpy.validateAndRepair.and.returnValue({
        isValid: true,
        wasRepaired: true,
        repairedState,
        repairSummary: 'Fixed orphaned references',
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(store.dispatch).toHaveBeenCalledWith(
        loadAllData({ appDataComplete: repairedState as any }),
      );

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];
      expect(appendedOp.payload).toBe(repairedState);
    });

    it('should create SYNC_IMPORT with correct structure', async () => {
      const mockState = {
        task: { ids: ['task-1'], entities: { 'task-1': { id: 'task-1' } } },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
      };
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue(mockState as any);
      vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ 'test-client': 5 }),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];
      expect(appendedOp.opType).toBe(OpType.SyncImport);
      expect(appendedOp.entityType).toBe('ALL');
      expect(appendedOp.clientId).toBe('test-client');
      expect(appendedOp.payload).toBe(mockState);
      expect(appendedOp.vectorClock['test-client']).toBe(6);
    });

    it('should abort if no client ID is available', async () => {
      clientIdProviderSpy.loadClientId.and.returnValue(Promise.resolve(null));

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should proceed if state has tasks', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: ['task-1'], entities: { 'task-1': { id: 'task-1' } } },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });

    it('should proceed if state has projects', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [], entities: {} },
        project: { ids: ['proj-1'], entities: { 'proj-1': { id: 'proj-1' } } },
        tag: { ids: [], entities: {} },
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });

    it('should proceed if state has user-created tags', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
        tag: { ids: ['user-tag-1'], entities: { 'user-tag-1': { id: 'user-tag-1' } } },
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });
  });

  describe('_isEmptyState (tested via handleServerMigration)', () => {
    it('should treat null state as empty', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue(null as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should treat undefined state as empty', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue(undefined as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should treat non-object state as empty', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue('not an object' as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });
  });

  describe('_hasNoUserCreatedTags (tested via handleServerMigration)', () => {
    it('should identify system tags correctly', async () => {
      for (const systemTagId of SYSTEM_TAG_IDS) {
        opLogStoreSpy.append.calls.reset();
        stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: { ids: [systemTagId], entities: {} },
        } as any);

        await service.handleServerMigration(defaultProvider);

        expect(opLogStoreSpy.append).not.toHaveBeenCalled();
      }
    });

    it('should proceed with mixed system and user tags', async () => {
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: { ids: [], entities: {} },
        project: { ids: [], entities: {} },
        tag: { ids: ['TODAY', 'user-custom-tag'], entities: {} },
      } as any);

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });
  });

  describe('handleServerMigration - Double-check and Clock Merging', () => {
    it('should abort if server is no longer empty during double-check', async () => {
      // Provider reports server has data on double-check
      (defaultProvider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 5, hasMore: false }),
      );

      await service.handleServerMigration(defaultProvider);

      // Should not create SYNC_IMPORT because server is no longer empty
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should proceed if server is still empty during double-check', async () => {
      // Provider reports server is still empty
      (defaultProvider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 0, hasMore: false }),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });

    it('should merge all local op clocks into SYNC_IMPORT vector clock', async () => {
      const localOps = [
        {
          seq: 1,
          op: {
            id: 'op-1',
            vectorClock: { 'test-client': 1, 'other-client': 3 },
          },
          appliedAt: Date.now(),
          source: 'local' as const,
        },
        {
          seq: 2,
          op: {
            id: 'op-2',
            vectorClock: { 'test-client': 2 },
          },
          appliedAt: Date.now(),
          source: 'local' as const,
        },
        {
          seq: 3,
          op: {
            id: 'op-3',
            vectorClock: { 'third-client': 5 },
          },
          appliedAt: Date.now(),
          source: 'local' as const,
        },
      ];

      opLogStoreSpy.getOpsAfterSeq.and.returnValue(Promise.resolve(localOps as any));
      vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ 'test-client': 5 }),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];

      // SYNC_IMPORT's clock should dominate all local ops:
      // Merged: { test-client: 5 (current), other-client: 3, third-client: 5 }
      // Then incremented for this client: test-client: 6
      expect(appendedOp.vectorClock['test-client']).toBe(6);
      expect(appendedOp.vectorClock['other-client']).toBe(3);
      expect(appendedOp.vectorClock['third-client']).toBe(5);
    });

    it('should work with empty local ops (only current clock)', async () => {
      opLogStoreSpy.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
      vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ 'test-client': 10 }),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];

      // Should just increment current clock
      expect(appendedOp.vectorClock['test-client']).toBe(11);
    });

    // Note: Test for non-operation-sync-capable providers removed.
    // The check for operation-sync capability is now done at a higher level
    // (sync.service.ts), so handleServerMigration expects OperationSyncCapable.
  });
});
