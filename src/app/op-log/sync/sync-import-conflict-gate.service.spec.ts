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

  it('should not prompt for a full-state op this client cannot interpret, nor for anything after it (#8764)', async () => {
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

    const unknownReason = createOperation({
      id: 'import-future-reason',
      syncImportReason: 'FUTURE_REASON' as never,
    });
    expect(
      (await service.checkIncomingFullStateConflict([unknownReason])).fullStateOp,
    ).toBeUndefined();

    const unknownOpType = createOperation({
      id: 'future-op',
      opType: 'FUTURE_OP' as unknown as OpType,
    });
    const importAfterBlock = createOperation({
      id: 'import-after-block',
      syncImportReason: 'SERVER_MIGRATION',
    });
    expect(
      (await service.checkIncomingFullStateConflict([unknownOpType, importAfterBlock]))
        .fullStateOp,
    ).toBeUndefined();

    const importFromNewerSchema = createOperation({
      id: 'import-newer-schema',
      syncImportReason: 'SERVER_MIGRATION',
      schemaVersion: 99,
    });
    expect(
      (await service.checkIncomingFullStateConflict([importFromNewerSchema])).fullStateOp,
    ).toBeUndefined();

    // The prefix before the block is still gated normally.
    const result = await service.checkIncomingFullStateConflict([
      importAfterBlock,
      unknownOpType,
    ]);
    expect(result.fullStateOp).toBe(importAfterBlock);
    expect(result.hasMeaningfulPending).toBeTrue();
  });

  describe('incoming causal REPAIR', () => {
    const createPendingTaskEntry = (): OperationLogEntry =>
      createEntry(
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

    /**
     * A REPAIR is automatic. Prompting for it offers the user three wrong
     * answers — force-upload (destroys every other device's work), force-download
     * (destroys this device's pending work), or cancel (re-prompts next cycle).
     * Defer it instead: this device keeps its work and its own repair pass fixes
     * the same shared corruption locally. (#9773)
     */
    it('defers an incoming causal REPAIR instead of prompting', async () => {
      const incomingRepair = createOperation({
        id: 'remote-causal-repair',
        actionType: ActionType.REPAIR_AUTO,
        opType: OpType.Repair,
        syncImportReason: 'REPAIR',
        repairBaseServerSeq: 4,
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([createPendingTaskEntry()]);

      const result = await service.checkIncomingFullStateConflict([incomingRepair]);

      expect(result.fullStateOp).toBe(incomingRepair);
      expect(result.hasMeaningfulPending).toBeTrue();
      expect(result.dialogData).toBeUndefined();
      expect(result.deferredRepairOpId).toBe('remote-causal-repair');
    });

    it('still prompts for an incoming SYNC_IMPORT', async () => {
      const incomingImport = createOperation({ syncImportReason: 'SERVER_MIGRATION' });
      opLogStoreSpy.getUnsynced.and.resolveTo([createPendingTaskEntry()]);

      const result = await service.checkIncomingFullStateConflict([incomingImport]);

      expect(result.dialogData).toBeDefined();
      expect(result.deferredRepairOpId).toBeUndefined();
    });

    it('does not defer a REPAIR when there is no meaningful pending work', async () => {
      const incomingRepair = createOperation({
        id: 'remote-causal-repair',
        actionType: ActionType.REPAIR_AUTO,
        opType: OpType.Repair,
        syncImportReason: 'REPAIR',
        repairBaseServerSeq: 4,
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([]);

      const result = await service.checkIncomingFullStateConflict([incomingRepair]);

      expect(result.hasMeaningfulPending).toBeFalse();
      expect(result.deferredRepairOpId).toBeUndefined();
    });

    it('does not defer a legacy REPAIR that carries no causal base', async () => {
      const legacyRepair = createOperation({
        id: 'remote-legacy-repair',
        actionType: ActionType.REPAIR_AUTO,
        opType: OpType.Repair,
        syncImportReason: 'REPAIR',
      });
      opLogStoreSpy.getUnsynced.and.resolveTo([createPendingTaskEntry()]);

      const result = await service.checkIncomingFullStateConflict([legacyRepair]);

      expect(result.deferredRepairOpId).toBeUndefined();
      expect(result.dialogData).toBeDefined();
    });
  });

  const createPendingConfigEntry = (sectionKey = 'sync'): OperationLogEntry =>
    createEntry(
      createOperation({
        id: 'local-config-update',
        actionType: '[Global Config] Update Global Config Section' as ActionType,
        opType: OpType.Update,
        entityType: 'GLOBAL_CONFIG',
        entityId: sectionKey,
        payload: { sectionKey },
        clientId: 'client-A',
        vectorClock: { clientA: 1 },
      }),
    );

  it('should produce dialog data for a synced client with a pending config change', async () => {
    opLogStoreSpy.hasSyncedOps.and.resolveTo(true);
    opLogStoreSpy.getUnsynced.and.resolveTo([createPendingConfigEntry()]);

    const result = await service.checkIncomingFullStateConflict([createOperation()]);

    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.dialogData).toBeDefined();
  });

  it('should ignore the sync setup write on a never-synced client', async () => {
    opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
    opLogStoreSpy.getUnsynced.and.resolveTo([createPendingConfigEntry()]);

    const result = await service.checkIncomingFullStateConflict([createOperation()]);

    expect(result.hasMeaningfulPending).toBeFalse();
    expect(result.discardablePendingOpIds).toEqual(['local-config-update']);
    expect(result.dialogData).toBeUndefined();
  });

  it('should protect non-update operations targeting the sync config coordinates', async () => {
    opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
    opLogStoreSpy.getUnsynced.and.resolveTo([
      createEntry(
        createOperation({
          id: 'local-config-delete',
          actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
          opType: OpType.Delete,
          entityType: 'GLOBAL_CONFIG',
          entityId: 'sync',
          payload: { sectionKey: 'sync' },
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
        }),
      ),
    ]);

    const result = await service.checkIncomingFullStateConflict([createOperation()]);

    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.discardablePendingOpIds).toEqual([]);
    expect(result.dialogData).toBeDefined();
  });

  it('should flag a user config change on a never-synced client', async () => {
    opLogStoreSpy.hasSyncedOps.and.resolveTo(false);
    opLogStoreSpy.getUnsynced.and.resolveTo([
      createPendingConfigEntry('productivityHacks'),
    ]);

    const result = await service.checkIncomingFullStateConflict([createOperation()]);

    expect(result.hasMeaningfulPending).toBeTrue();
    expect(result.dialogData).toBeDefined();
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

  it('should not consult sync history when only startup example tasks are pending', async () => {
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

  describe('meaningful-work coverage beyond TASK/PROJECT/TAG/NOTE CUD', () => {
    it('should treat a pending MOV op as meaningful', async () => {
      const pendingMove = createEntry(
        createOperation({
          id: 'local-move',
          actionType: '[Task] Move task' as ActionType,
          opType: OpType.Move,
          entityType: 'TASK',
          entityId: 'task-1',
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
        }),
      );
      opLogStoreSpy.getUnsynced.and.resolveTo([pendingMove]);

      const result = await service.checkIncomingFullStateConflict([createOperation()]);

      expect(result.hasMeaningfulPending).toBeTrue();
      expect(result.dialogData).toBeDefined();
    });

    it('should treat pending non-task entity work (TIME_TRACKING, SIMPLE_COUNTER) as meaningful', async () => {
      const pendingTimeTracking = createEntry(
        createOperation({
          id: 'local-tt',
          actionType: '[TimeTracking] Update whole day' as ActionType,
          opType: OpType.Update,
          entityType: 'TIME_TRACKING',
          entityId: 'tt-1',
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
        }),
      );
      const pendingCounter = createEntry(
        createOperation({
          id: 'local-counter',
          actionType: '[SimpleCounter] Increase Counter Today' as ActionType,
          opType: OpType.Update,
          entityType: 'SIMPLE_COUNTER',
          entityId: 'counter-1',
          clientId: 'client-A',
          vectorClock: { clientA: 2 },
        }),
      );

      expect(service.hasMeaningfulPendingOps([pendingTimeTracking])).toBeTrue();
      expect(service.hasMeaningfulPendingOps([pendingCounter])).toBeTrue();
    });

    it('should always treat MIGRATION/RECOVERY genesis batches as meaningful', async () => {
      const pendingMigration = createEntry(
        createOperation({
          id: 'local-genesis',
          actionType: '[Migration] Genesis' as ActionType,
          opType: OpType.Batch,
          entityType: 'MIGRATION',
          entityId: 'genesis',
          payload: { task: { ids: ['recovered-task'] } },
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
        }),
      );

      const pendingRecovery = createEntry(
        createOperation({
          id: 'local-recovery',
          actionType: '[Recovery] Data Import' as ActionType,
          opType: OpType.Batch,
          entityType: 'RECOVERY',
          entityId: 'genesis',
          payload: { project: { ids: ['recovered-project'] } },
          clientId: 'client-A',
          vectorClock: { clientA: 2 },
        }),
        { seq: 2 },
      );

      expect(service.hasMeaningfulPendingOps([pendingMigration])).toBeTrue();
      expect(service.hasMeaningfulPendingOps([pendingRecovery])).toBeTrue();
    });
  });

  describe('preCapturedPendingOps (piggyback-upload race)', () => {
    it('should judge meaningfulness against the union of the upload snapshot and live pending set', async () => {
      // Live pending set is empty — the op was accepted and marked synced during
      // the same upload round that piggybacked the import.
      opLogStoreSpy.getUnsynced.and.resolveTo([]);

      const acceptedThisRound = createEntry(
        createOperation({
          id: 'accepted-op',
          actionType: '[Task] Update task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
        }),
      );

      const result = await service.checkIncomingFullStateConflict([createOperation()], {
        preCapturedPendingOps: [acceptedThisRound],
      });

      expect(result.hasMeaningfulPending).toBeTrue();
      expect(result.dialogData).toBeDefined();
    });

    it('should include meaningful work created after the upload snapshot', async () => {
      const createdDuringUpload = createEntry(
        createOperation({
          id: 'created-during-upload',
          actionType: '[SimpleCounter] Increase Counter Today' as ActionType,
          opType: OpType.Update,
          entityType: 'SIMPLE_COUNTER',
          entityId: 'counter-1',
          clientId: 'client-A',
          vectorClock: { clientA: 2 },
        }),
        { seq: 2 },
      );
      opLogStoreSpy.getUnsynced.and.resolveTo([createdDuringUpload]);

      const result = await service.checkIncomingFullStateConflict([createOperation()], {
        flushPendingWrites: true,
        preCapturedPendingOps: [],
      });

      expect(writeFlushServiceSpy.flushPendingWrites).toHaveBeenCalled();
      expect(result.pendingOps).toEqual([createdDuringUpload]);
      expect(result.hasMeaningfulPending).toBeTrue();
      expect(result.dialogData).toBeDefined();
    });

    it('should de-duplicate operations present in both upload and live snapshots', async () => {
      const selectedForUpload = createEntry(
        createOperation({
          id: 'same-op',
          actionType: '[Task] Update task' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          clientId: 'client-A',
          vectorClock: { clientA: 1 },
        }),
      );
      opLogStoreSpy.getUnsynced.and.resolveTo([selectedForUpload]);

      const result = await service.checkIncomingFullStateConflict([createOperation()], {
        preCapturedPendingOps: [selectedForUpload],
      });

      expect(result.pendingOps).toEqual([selectedForUpload]);
      expect(result.dialogData?.filteredOpCount).toBe(1);
    });

    it('should derive discardable example-task ids from the LIVE pending set', async () => {
      const exampleCreate = (id: string): OperationLogEntry =>
        createEntry(
          createOperation({
            id,
            actionType: ActionType.TASK_SHARED_ADD,
            opType: OpType.Create,
            entityType: 'TASK',
            entityId: `task-${id}`,
            payload: {
              actionPayload: {
                task: { id: `task-${id}` },
                isExampleTask: true,
              },
              entityChanges: [],
            },
            clientId: 'client-A',
            vectorClock: { clientA: 1 },
          }),
        );

      // Pre-captured snapshot has two example ops; one was accepted (synced)
      // during the round, so only the still-pending one may be discarded.
      const stillPending = exampleCreate('example-still-pending');
      const acceptedAlready = exampleCreate('example-accepted');
      opLogStoreSpy.getUnsynced.and.resolveTo([stillPending]);

      const result = await service.checkIncomingFullStateConflict([createOperation()], {
        preCapturedPendingOps: [stillPending, acceptedAlready],
      });

      expect(result.discardablePendingOpIds).toEqual(['example-still-pending']);
    });
  });
});
