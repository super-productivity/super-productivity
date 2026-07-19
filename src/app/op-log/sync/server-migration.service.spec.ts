/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { provideMockStore, MockStore } from '@ngrx/store/testing';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { of } from 'rxjs';
import { ServerMigrationService } from './server-migration.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { AppStateSnapshot, StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';
import { UserInputWaitStateService } from '../../imex/sync/user-input-wait-state.service';
import {
  SyncProviderBase,
  OperationSyncCapable,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { ActionType, OperationLogEntry, OpType } from '../core/operation.types';
import { SYSTEM_TAG_IDS } from '../../features/tag/tag.const';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { LockService } from './lock.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { LOCK_NAMES } from '../core/operation-log.const';
import { OperationCaptureService } from '../capture/operation-capture.service';

describe('ServerMigrationService', () => {
  let service: ServerMigrationService;
  let store: MockStore;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let vectorClockServiceSpy: jasmine.SpyObj<VectorClockService>;
  let validateStateServiceSpy: jasmine.SpyObj<ValidateStateService>;
  let stateSnapshotServiceSpy: jasmine.SpyObj<StateSnapshotService>;
  let snackServiceSpy: jasmine.SpyObj<SnackService>;
  let clientIdProviderSpy: jasmine.SpyObj<ClientIdProvider>;
  let matDialogSpy: jasmine.SpyObj<MatDialog>;
  let userInputWaitStateSpy: jasmine.SpyObj<UserInputWaitStateService>;
  let lockServiceSpy: jasmine.SpyObj<LockService>;
  let writeFlushServiceSpy: jasmine.SpyObj<OperationWriteFlushService>;
  let operationCaptureServiceSpy: jasmine.SpyObj<OperationCaptureService>;
  let defaultProvider: OperationSyncProvider;

  // Type for operation-sync-capable provider
  type OperationSyncProvider = SyncProviderBase<SyncProviderId> & OperationSyncCapable;

  // Mock sync provider that supports operations
  const createMockSyncProvider = (): OperationSyncProvider => {
    return {
      supportsOperationSync: true,
      providerMode: 'superSyncOps',
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

  const createMigrationEntry = (rejectedAt?: number): OperationLogEntry => ({
    seq: 1,
    op: {
      id: '01900000-0000-7000-8000-000000000001',
      actionType: ActionType.LOAD_ALL_DATA,
      opType: OpType.SyncImport,
      entityType: 'ALL',
      payload: {},
      clientId: 'test-client',
      vectorClock: { 'test-client': 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
      syncImportReason: 'SERVER_MIGRATION',
    },
    source: 'local',
    appliedAt: Date.now(),
    rejectedAt,
  });

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'hasSyncedOps',
      'append',
      'getOpsAfterSeq',
      'pruneClockForStorage',
    ]);
    // Store-owned pruning (#9096): pass-through by default.
    opLogStoreSpy.pruneClockForStorage.and.callFake(async (clock) => clock);
    vectorClockServiceSpy = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    validateStateServiceSpy = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepair',
    ]);
    stateSnapshotServiceSpy = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
      'getStateSnapshotAsync',
      'getStateSnapshotForOperationLogAsync',
    ]);
    stateSnapshotServiceSpy.getStateSnapshotForOperationLogAsync.and.callFake(() =>
      stateSnapshotServiceSpy.getStateSnapshotAsync(),
    );
    snackServiceSpy = jasmine.createSpyObj('SnackService', ['open']);
    clientIdProviderSpy = jasmine.createSpyObj('ClientIdProvider', ['loadClientId']);
    matDialogSpy = jasmine.createSpyObj('MatDialog', ['open']);
    userInputWaitStateSpy = jasmine.createSpyObj('UserInputWaitStateService', [
      'startWaiting',
    ]);
    userInputWaitStateSpy.startWaiting.and.returnValue(() => {});
    lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    lockServiceSpy.request.and.callFake(async <T>(_name: string, fn: () => Promise<T>) =>
      fn(),
    );
    writeFlushServiceSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
      'flushThenRunExclusive',
    ]);
    writeFlushServiceSpy.flushPendingWrites.and.resolveTo();
    // Mirror the real barrier semantics: flush, acquire the op-log lock, run fn.
    writeFlushServiceSpy.flushThenRunExclusive.and.callFake(
      async <T>(fn: () => Promise<T>) => {
        await writeFlushServiceSpy.flushPendingWrites();
        return lockServiceSpy.request(LOCK_NAMES.OPERATION_LOG, fn);
      },
    );
    operationCaptureServiceSpy = jasmine.createSpyObj('OperationCaptureService', [
      'getPendingCount',
    ]);
    operationCaptureServiceSpy.getPendingCount.and.returnValue(0);

    // Default mock returns
    opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(true));
    opLogStoreSpy.append.and.returnValue(Promise.resolve(1));
    opLogStoreSpy.getOpsAfterSeq.and.returnValue(Promise.resolve([]));
    vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ 'test-client': 5 }),
    );
    validateStateServiceSpy.validateAndRepair.and.resolveTo({
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
    stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
      Promise.resolve({
        task: {
          ids: ['task-1'],
          entities: { 'task-1': { id: 'task-1', title: 'Test' } },
        },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
      } as any),
    );
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
        { provide: MatDialog, useValue: matDialogSpy },
        { provide: UserInputWaitStateService, useValue: userInputWaitStateSpy },
        { provide: LockService, useValue: lockServiceSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushServiceSpy },
        { provide: OperationCaptureService, useValue: operationCaptureServiceSpy },
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

    it('should reuse an existing pending server-migration snapshot without probing again', async () => {
      const provider = createMockSyncProvider();
      opLogStoreSpy.getOpsAfterSeq.and.resolveTo([createMigrationEntry()]);

      await service.checkAndHandleMigration(provider);

      expect(provider.downloadOps).not.toHaveBeenCalled();
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should block after a rejected server-migration snapshot instead of appending another', async () => {
      const provider = createMockSyncProvider();
      opLogStoreSpy.getOpsAfterSeq.and.resolveTo([createMigrationEntry(Date.now())]);

      await expectAsync(service.checkAndHandleMigration(provider)).toBeRejected();

      expect(provider.downloadOps).not.toHaveBeenCalled();
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should skip if server has data and client has no synced ops', async () => {
      const provider = createMockSyncProvider();
      (provider.getLastServerSeq as jasmine.Spy).and.returnValue(Promise.resolve(0));
      (provider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 5, hasMore: false }),
      );
      opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(false));

      await service.checkAndHandleMigration(provider);

      expect(matDialogSpy.open).not.toHaveBeenCalled();
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should show confirmation dialog when server has data and client has synced ops', async () => {
      const provider = createMockSyncProvider();
      (provider.getLastServerSeq as jasmine.Spy).and.returnValue(Promise.resolve(0));
      (provider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 5, hasMore: false }),
      );
      opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(true));
      matDialogSpy.open.and.returnValue({
        afterClosed: () => of(false),
      } as MatDialogRef<unknown>);

      await service.checkAndHandleMigration(provider);

      expect(matDialogSpy.open).toHaveBeenCalled();
      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should create SYNC_IMPORT when user confirms migration to non-empty server', async () => {
      const provider = createMockSyncProvider();
      (provider.getLastServerSeq as jasmine.Spy).and.returnValue(Promise.resolve(0));
      (provider.downloadOps as jasmine.Spy).and.returnValue(
        Promise.resolve({ ops: [], latestSeq: 5, hasMore: false }),
      );
      opLogStoreSpy.hasSyncedOps.and.returnValue(Promise.resolve(true));
      matDialogSpy.open.and.returnValue({
        afterClosed: () => of(true),
      } as MatDialogRef<unknown>);

      await service.checkAndHandleMigration(provider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];
      expect(appendedOp.opType).toBe(OpType.SyncImport);
      expect(appendedOp.syncImportReason).toBe('SERVER_MIGRATION');
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
    it('should create the snapshot and import under the operation-log lock', async () => {
      await service.handleServerMigration(defaultProvider);

      expect(lockServiceSpy.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should skip if state is empty (no tasks/projects/tags)', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: { ids: [], entities: {} },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should skip if state only has system tags', async () => {
      const systemTagIds = Array.from(SYSTEM_TAG_IDS);
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: { ids: systemTagIds, entities: {} },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should skip if state only has the default INBOX project', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: {
            ids: [INBOX_PROJECT.id],
            entities: { [INBOX_PROJECT.id]: INBOX_PROJECT },
          },
          tag: { ids: [], entities: {} },
          note: { ids: [], entities: {} },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should proceed if state has notes', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: {
            ids: [INBOX_PROJECT.id],
            entities: { [INBOX_PROJECT.id]: INBOX_PROJECT },
          },
          tag: { ids: [], entities: {} },
          note: { ids: ['note-1'], entities: { 'note-1': { id: 'note-1' } } },
        } as any),
      );

      const createdOpId = await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      expect(createdOpId).toBe(opLogStoreSpy.append.calls.mostRecent().args[0].id);
    });

    it('should proceed if non-entity sync state differs from defaults', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: {
            ids: [INBOX_PROJECT.id],
            entities: { [INBOX_PROJECT.id]: INBOX_PROJECT },
          },
          tag: { ids: [], entities: {} },
          note: { ids: [], entities: {} },
          planner: {
            days: { '2026-06-19': ['task-1'] },
            addPlannedTasksDialogLastShown: undefined,
          },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });

    it('should abort if state validation fails', async () => {
      validateStateServiceSpy.validateAndRepair.and.resolveTo({
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

      validateStateServiceSpy.validateAndRepair.and.resolveTo({
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
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve(mockState as any),
      );
      vectorClockServiceSpy.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ 'test-client': 5 }),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];
      expect(appendedOp.opType).toBe(OpType.SyncImport);
      expect(appendedOp.entityType).toBe('ALL');
      expect(appendedOp.clientId).toBe('test-client');
      expect(appendedOp.payload).toEqual(mockState);
      expect(appendedOp.vectorClock['test-client']).toBe(6);
    });

    it('should abort if no client ID is available', async () => {
      clientIdProviderSpy.loadClientId.and.returnValue(Promise.resolve(null));

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should proceed if state has tasks', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: ['task-1'], entities: { 'task-1': { id: 'task-1' } } },
          project: { ids: [], entities: {} },
          tag: { ids: [], entities: {} },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });

    it('should proceed if state has projects', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: { ids: ['proj-1'], entities: { 'proj-1': { id: 'proj-1' } } },
          tag: { ids: [], entities: {} },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });

    it('should proceed if state has user-created tags', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: {
            ids: ['user-tag-1'],
            entities: { 'user-tag-1': { id: 'user-tag-1' } },
          },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });
  });

  describe('empty-state detection (tested via handleServerMigration)', () => {
    it('should treat null state as empty', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve(null as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should treat undefined state as empty', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve(undefined as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });

    it('should treat non-object state as empty', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve('not an object' as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).not.toHaveBeenCalled();
    });
  });

  it('should capture and append the full-state operation inside one operation-log barrier', async () => {
    const events: string[] = [];
    writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
      events.push('flush');
    });
    lockServiceSpy.request.and.callFake(async <T>(name: string, fn: () => Promise<T>) => {
      events.push(`lock:${name}:start`);
      const result = await fn();
      events.push(`lock:${name}:end`);
      return result;
    });
    stateSnapshotServiceSpy.getStateSnapshotAsync.and.callFake(async () => {
      events.push('snapshot');
      return {
        task: { ids: ['task-1'], entities: { 'task-1': { id: 'task-1' } } },
        project: { ids: [], entities: {} },
        tag: { ids: [], entities: {} },
      } as unknown as AppStateSnapshot;
    });
    opLogStoreSpy.append.and.callFake(async () => {
      events.push('append');
      return 1;
    });

    await service.handleServerMigration(defaultProvider);

    expect(events).toEqual([
      'flush',
      `lock:${LOCK_NAMES.OPERATION_LOG}:start`,
      'snapshot',
      'append',
      `lock:${LOCK_NAMES.OPERATION_LOG}:end`,
    ]);
  });

  // The release-flush-retry behavior when an action lands between flush and lock
  // acquisition now lives in OperationWriteFlushService.flushThenRunExclusive —
  // covered by operation-write-flush.service.spec.ts.

  describe('system-tag empty-state detection (tested via handleServerMigration)', () => {
    it('should identify system tags correctly', async () => {
      for (const systemTagId of SYSTEM_TAG_IDS) {
        opLogStoreSpy.append.calls.reset();
        stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
          Promise.resolve({
            task: { ids: [], entities: {} },
            project: { ids: [], entities: {} },
            tag: { ids: [systemTagId], entities: {} },
          } as any),
        );

        await service.handleServerMigration(defaultProvider);

        expect(opLogStoreSpy.append).not.toHaveBeenCalled();
      }
    });

    it('should proceed with mixed system and user tags', async () => {
      stateSnapshotServiceSpy.getStateSnapshotAsync.and.returnValue(
        Promise.resolve({
          task: { ids: [], entities: {} },
          project: { ids: [], entities: {} },
          tag: { ids: ['TODAY', 'user-custom-tag'], entities: {} },
        } as any),
      );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
    });
  });

  describe('handleServerMigration - Archive data preservation', () => {
    it('should include archive data in SYNC_IMPORT payload (not empty DEFAULT_ARCHIVE)', async () => {
      // This test verifies that archive data is included in the SYNC_IMPORT operation.
      // BUG: Currently getStateSnapshot() returns DEFAULT_ARCHIVE (empty) for archives
      // instead of loading real archive data from IndexedDB via getStateSnapshotAsync().

      const mockArchiveYoung = {
        task: {
          ids: ['archived-task-1'],
          entities: {
            'archived-task-1': {
              id: 'archived-task-1',
              title: 'Archived Task',
              tagIds: ['tag-1'],
              isDone: true,
            },
          },
        },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 0,
      };

      const mockArchiveOld = {
        task: {
          ids: ['old-archived-task-1'],
          entities: {
            'old-archived-task-1': {
              id: 'old-archived-task-1',
              title: 'Old Archived Task',
              tagIds: ['tag-2'],
              isDone: true,
            },
          },
        },
        timeTracking: { project: {}, tag: {} },
        lastTimeTrackingFlush: 0,
      };

      // Mock getStateSnapshot to return state WITH empty archives (current buggy behavior)
      // This simulates what actually happens in production
      stateSnapshotServiceSpy.getStateSnapshot.and.returnValue({
        task: {
          ids: ['task-1'],
          entities: { 'task-1': { id: 'task-1', title: 'Active Task' } },
        },
        project: { ids: [], entities: {} },
        tag: { ids: ['tag-1'], entities: { 'tag-1': { id: 'tag-1', name: 'Test Tag' } } },
        // DEFAULT_ARCHIVE values (empty) - this is what getStateSnapshot returns
        archiveYoung: {
          task: { ids: [], entities: {} },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: 0,
        },
        archiveOld: {
          task: { ids: [], entities: {} },
          timeTracking: { project: {}, tag: {} },
          lastTimeTrackingFlush: 0,
        },
      } as any);

      // Mock getStateSnapshotAsync to return state with REAL archive data
      // This is what SHOULD be used to get archive data
      (stateSnapshotServiceSpy as any).getStateSnapshotAsync = jasmine
        .createSpy('getStateSnapshotAsync')
        .and.returnValue(
          Promise.resolve({
            task: {
              ids: ['task-1'],
              entities: { 'task-1': { id: 'task-1', title: 'Active Task' } },
            },
            project: { ids: [], entities: {} },
            tag: {
              ids: ['tag-1'],
              entities: { 'tag-1': { id: 'tag-1', name: 'Test Tag' } },
            },
            archiveYoung: mockArchiveYoung,
            archiveOld: mockArchiveOld,
          }),
        );

      await service.handleServerMigration(defaultProvider);

      expect(opLogStoreSpy.append).toHaveBeenCalled();
      const appendedOp = opLogStoreSpy.append.calls.mostRecent().args[0];
      const payload = appendedOp.payload as {
        archiveYoung: { task: { ids: string[]; entities: Record<string, unknown> } };
        archiveOld: { task: { ids: string[]; entities: Record<string, unknown> } };
      };

      // The SYNC_IMPORT payload should contain the archive data, not empty archives
      // This test will FAIL with the current implementation because getStateSnapshot()
      // is used instead of getStateSnapshotAsync()
      expect(payload.archiveYoung.task.ids.length).toBeGreaterThan(
        0,
        'archiveYoung should contain archived tasks, not be empty',
      );
      expect(payload.archiveOld.task.ids.length).toBeGreaterThan(
        0,
        'archiveOld should contain archived tasks, not be empty',
      );
      expect(payload.archiveYoung.task.entities['archived-task-1']).toBeDefined();
      expect(payload.archiveOld.task.entities['old-archived-task-1']).toBeDefined();
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
