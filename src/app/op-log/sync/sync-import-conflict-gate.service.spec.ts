import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { OperationWriteFlushService } from './operation-write-flush.service';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';
import { SyncImportConflictGateService } from './sync-import-conflict-gate.service';

describe('SyncImportConflictGateService', () => {
  let service: SyncImportConflictGateService;
  let opLogStoreSpy: jasmine.SpyObj<OperationLogStoreService>;
  let writeFlushServiceSpy: jasmine.SpyObj<OperationWriteFlushService>;

  const createOperation = (overrides: Partial<Operation> = {}): Operation => ({
    id: 'op-1',
    actionType: ActionType.LOAD_ALL_DATA,
    opType: OpType.SyncImport,
    entityType: 'ALL',
    payload: {},
    clientId: 'client-B',
    vectorClock: { clientB: 1 },
    timestamp: 123,
    schemaVersion: 1,
    ...overrides,
  });

  const createEntry = (
    op: Operation,
    overrides: Partial<OperationLogEntry> = {},
  ): OperationLogEntry => ({
    seq: 1,
    op,
    appliedAt: 124,
    source: 'local',
    ...overrides,
  });

  beforeEach(() => {
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', [
      'getUnsynced',
      'hasSyncedOps',
    ]);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);
    opLogStoreSpy.hasSyncedOps.and.resolveTo(false);

    writeFlushServiceSpy = jasmine.createSpyObj('OperationWriteFlushService', [
      'flushPendingWrites',
    ]);
    writeFlushServiceSpy.flushPendingWrites.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        SyncImportConflictGateService,
        { provide: OperationLogStoreService, useValue: opLogStoreSpy },
        { provide: OperationWriteFlushService, useValue: writeFlushServiceSpy },
      ],
    });

    service = TestBed.inject(SyncImportConflictGateService);
  });

  it('should produce dialog data for incoming full-state ops with meaningful pending ops', async () => {
    const incomingSyncImport = createOperation({
      syncImportReason: 'SERVER_MIGRATION',
    });
    const pendingTaskEntry = createEntry(
      createOperation({
        id: 'local-task-update',
        actionType: 'test' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Local title' },
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingTaskEntry]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(result.fullStateOp).toBe(incomingSyncImport);
    expect(result.pendingOps).toEqual([pendingTaskEntry]);
    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.dialogData).toEqual({
      filteredOpCount: 1,
      localImportTimestamp: 123,
      syncImportReason: 'SERVER_MIGRATION',
      scenario: 'INCOMING_IMPORT',
      isNeverSynced: true,
    });
  });

  it('should not produce dialog data when pending ops are config-only', async () => {
    const incomingSyncImport = createOperation();
    const pendingConfigEntry = createEntry(
      createOperation({
        id: 'local-config-update',
        actionType: '[Global Config] Update Global Config Section' as ActionType,
        opType: OpType.Update,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'sync',
        payload: { sectionKey: 'sync' },
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingConfigEntry]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(result.fullStateOp).toBe(incomingSyncImport);
    expect(result.hasMeaningfulPending).toBeFalse();
    expect(result.dialogData).toBeUndefined();
  });

  it('should not produce dialog data when pending task creates are startup example tasks', async () => {
    const incomingSyncImport = createOperation();
    const pendingExampleTaskEntry = createEntry(
      createOperation({
        id: 'local-example-task-create',
        actionType: ActionType.TASK_SHARED_ADD,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 'example-task-1',
        payload: {
          actionPayload: {
            task: { id: 'example-task-1' },
            isExampleTask: true,
          },
          entityChanges: [],
        },
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingExampleTaskEntry]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(result.fullStateOp).toBe(incomingSyncImport);
    expect(result.pendingOps).toEqual([pendingExampleTaskEntry]);
    expect(result.hasMeaningfulPending).toBeFalse();
    expect(result.discardablePendingOpIds).toEqual(['local-example-task-create']);
    expect(result.dialogData).toBeUndefined();
  });

  it('reports example-task ids as discardable but still shows the dialog when real work is also pending', async () => {
    const incomingSyncImport = createOperation();
    const pendingRealTaskEntry = createEntry(
      createOperation({
        id: 'local-task-update',
        actionType: 'test' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Local title' },
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    const pendingExampleTaskEntry = createEntry(
      createOperation({
        id: 'local-example-task-create',
        actionType: ActionType.TASK_SHARED_ADD,
        opType: OpType.Create,
        entityType: 'TASK',
        entityId: 'example-task-1',
        payload: {
          actionPayload: {
            task: { id: 'example-task-1' },
            isExampleTask: true,
          },
          entityChanges: [],
        },
        clientId: 'client-A',
        vectorClock: { clientA: 2 },
      }),
      { seq: 2 },
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([
      pendingRealTaskEntry,
      pendingExampleTaskEntry,
    ]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport]);

    // Real pending work blocks silent acceptance -> the conflict dialog is shown...
    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.dialogData).toBeDefined();
    // ...but the example-task id is still reported. The caller intentionally leaves
    // these untouched in the dialog path, so they ride along if the user keeps local.
    expect(result.discardablePendingOpIds).toEqual(['local-example-task-create']);
  });

  it('should treat pending full-state ops as meaningful', async () => {
    const incomingSyncImport = createOperation({
      id: 'incoming-sync-import',
    });
    const pendingFullStateEntry = createEntry(
      createOperation({
        id: 'local-backup-import',
        clientId: 'client-A',
        opType: OpType.BackupImport,
        syncImportReason: 'BACKUP_RESTORE',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingFullStateEntry]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.dialogData).toEqual({
      filteredOpCount: 1,
      localImportTimestamp: 123,
      syncImportReason: undefined,
      scenario: 'INCOMING_IMPORT',
      isNeverSynced: true,
    });
  });

  it('should mark dialogData.isNeverSynced=false for an already-synced client', async () => {
    opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
    const incomingSyncImport = createOperation();
    const pendingTaskEntry = createEntry(
      createOperation({
        id: 'local-task-update',
        actionType: 'test' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingTaskEntry]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(result.dialogData?.isNeverSynced).toBeFalse();
  });

  it('should honor a caller-provided isNeverSynced snapshot instead of reading live sync history', async () => {
    // The piggyback-upload path captures isNeverSynced at sync-cycle start and passes it
    // in, because by the time that gate runs the live store already reflects this sync's
    // own writes (downloaded ops persisted with syncedAt, accepted uploads marked synced).
    // A live read here would be `true` (already synced), wrongly clearing the guard.
    opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
    const incomingSyncImport = createOperation();
    const pendingTaskEntry = createEntry(
      createOperation({
        id: 'local-task-update',
        actionType: 'test' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: 'task-1',
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingTaskEntry]);

    const result = await service.checkIncomingFullStateConflict([incomingSyncImport], {
      isNeverSynced: true,
    });

    expect(result.dialogData?.isNeverSynced).toBeTrue();
    expect(opLogStoreSpy.hasSyncedOps).not.toHaveBeenCalled();
  });

  it('should not consult sync history when there are no meaningful pending ops', async () => {
    const incomingSyncImport = createOperation();
    const pendingConfigEntry = createEntry(
      createOperation({
        id: 'local-config-update',
        opType: OpType.Update,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'sync',
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );
    opLogStoreSpy.getUnsynced.and.resolveTo([pendingConfigEntry]);

    await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(opLogStoreSpy.hasSyncedOps).not.toHaveBeenCalled();
  });

  it('should skip pending-op checks when incoming ops contain no full-state op', async () => {
    const regularOp = createOperation({
      opType: OpType.Update,
      entityType: 'TASK',
      actionType: 'test' as ActionType,
    });

    const result = await service.checkIncomingFullStateConflict([regularOp]);

    expect(result.fullStateOp).toBeUndefined();
    expect(result.pendingOps).toEqual([]);
    expect(result.hasMeaningfulPending).toBeFalse();
    expect(opLogStoreSpy.getUnsynced).not.toHaveBeenCalled();
    expect(writeFlushServiceSpy.flushPendingWrites).not.toHaveBeenCalled();
  });

  it('should flush pending writes before reading pending ops when requested', async () => {
    const events: string[] = [];
    const incomingSyncImport = createOperation();
    writeFlushServiceSpy.flushPendingWrites.and.callFake(async () => {
      events.push('flush');
    });
    opLogStoreSpy.getUnsynced.and.callFake(async () => {
      events.push('getUnsynced');
      return [];
    });

    await service.checkIncomingFullStateConflict([incomingSyncImport], {
      flushPendingWrites: true,
    });

    expect(events).toEqual(['flush', 'getUnsynced']);
  });

  it('should not flush pending writes by default', async () => {
    const incomingSyncImport = createOperation();

    await service.checkIncomingFullStateConflict([incomingSyncImport]);

    expect(writeFlushServiceSpy.flushPendingWrites).not.toHaveBeenCalled();
    expect(opLogStoreSpy.getUnsynced).toHaveBeenCalled();
  });
});
