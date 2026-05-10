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
    opLogStoreSpy = jasmine.createSpyObj('OperationLogStoreService', ['getUnsynced']);
    opLogStoreSpy.getUnsynced.and.resolveTo([]);

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
    });
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
