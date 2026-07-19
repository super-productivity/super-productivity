import { TestBed } from '@angular/core/testing';
import { RepairOperationService } from './repair-operation.service';
import {
  MixedSourceOperationBatch,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { LockService } from '../sync/lock.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ActionType, Operation, OpType, RepairSummary } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { TranslateService } from '@ngx-translate/core';
import { RepairSyncContextService } from './repair-sync-context.service';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';

describe('RepairOperationService', () => {
  let service: RepairOperationService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let repairSyncContext: RepairSyncContextService;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let alertSpy: jasmine.Spy;
  let confirmSpy: jasmine.Spy;

  const mockRepairedState = {
    task: { entities: {}, ids: [] },
    project: { entities: {}, ids: [] },
  };

  const createRepairSummary = (
    overrides: Partial<RepairSummary> = {},
  ): RepairSummary => ({
    entityStateFixed: 0,
    orphanedEntitiesRestored: 0,
    invalidReferencesRemoved: 0,
    relationshipsFixed: 0,
    structureRepaired: 0,
    typeErrorsFixed: 0,
    ...overrides,
  });

  /** The operation passed to the mixed-source batch in the most recent call. */
  const getAppendedOp = (): Operation =>
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.mostRecent().args[0][0]
      .ops[0];

  /** Makes the batch mock echo its input ops back as written, with the given seq. */
  const mockBatchAppendWithSeq = (seq: number): void => {
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(
      async (batches: readonly MixedSourceOperationBatch[]) => ({
        written: batches.flatMap((batch) =>
          batch.ops.map((op) => ({ seq, op, source: batch.source })),
        ),
        skippedCount: 0,
      }),
    );
  };

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'appendMixedSourceBatchSkipDuplicates',
      'replaceRejectedRepair',
      'saveStateCache',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotAsync',
    ]);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    // Default mock implementations
    mockLockService.request.and.callFake(async <T>(_name: string, fn: () => Promise<T>) =>
      fn(),
    );
    mockBatchAppendWithSeq(100);
    mockOpLogStore.saveStateCache.and.returnValue(Promise.resolve());
    mockOpLogStore.replaceRejectedRepair.and.resolveTo(101);
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ clientA: 5 }),
    );
    mockStateSnapshotService.getStateSnapshotAsync.and.resolveTo(
      mockRepairedState as never,
    );
    mockTranslateService.instant.and.callFake((key: string) => key);

    // Spy on global alert (handle if already spied)
    if (!jasmine.isSpy(window.alert)) {
      alertSpy = spyOn(window, 'alert');
    } else {
      alertSpy = window.alert as jasmine.Spy;
      alertSpy.calls.reset();
    }

    // Spy on global confirm to prevent devError from throwing
    // (devError calls confirm() and throws if user confirms)
    if (!jasmine.isSpy(window.confirm)) {
      confirmSpy = spyOn(window, 'confirm').and.returnValue(false);
    } else {
      confirmSpy = window.confirm as jasmine.Spy;
      confirmSpy.calls.reset();
      confirmSpy.and.returnValue(false);
    }

    TestBed.configureTestingModule({
      providers: [
        RepairOperationService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: LockService, useValue: mockLockService },
        { provide: TranslateService, useValue: mockTranslateService },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: SnackService, useValue: mockSnackService },
      ],
    });

    service = TestBed.inject(RepairOperationService);
    repairSyncContext = TestBed.inject(RepairSyncContextService);
  });

  describe('rebaseStaleRepair', () => {
    it('should atomically replace the stale repair with a snapshot at the new cursor', async () => {
      const summary = createRepairSummary({ entityStateFixed: 1 });

      const seq = await service.rebaseStaleRepair({
        staleRepairOpId: 'stale-repair',
        repairSummary: summary,
        clientId: 'test-client',
        repairBaseServerSeq: 12,
      });

      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
      expect(mockStateSnapshotService.getStateSnapshotAsync).toHaveBeenCalled();
      expect(mockOpLogStore.replaceRejectedRepair).toHaveBeenCalledWith({
        staleRepairOpId: 'stale-repair',
        replacementOp: jasmine.objectContaining({
          opType: OpType.Repair,
          clientId: 'test-client',
          payload: {
            appDataComplete: mockRepairedState,
            repairSummary: summary,
            repairBaseServerSeq: 12,
          },
        }),
        repairedState: mockRepairedState,
      });
      expect(alertSpy).not.toHaveBeenCalled();
      expect(seq).toBe(101);
    });
  });

  describe('createRepairOperation', () => {
    it('should create a repair operation with correct properties', async () => {
      const summary = createRepairSummary({ entityStateFixed: 3 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).toHaveBeenCalledWith([
        {
          ops: [
            jasmine.objectContaining({
              actionType: '[Repair] Auto Repair' as ActionType,
              opType: OpType.Repair,
              entityType: 'ALL',
              clientId: 'test-client',
              schemaVersion: CURRENT_SCHEMA_VERSION,
            }),
          ],
          source: 'local',
        },
      ]);
    });

    it('should use the mixed-source batch so the clock is rebased on the durable clock', async () => {
      const summary = createRepairSummary({ entityStateFixed: 1 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      // The batch's in-transaction rebase is what prevents a stale in-memory
      // clock cache from regressing the durable clock (#8939).
      expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).toHaveBeenCalled();
    });

    it('should include repaired state and summary in payload', async () => {
      const summary = createRepairSummary({ orphanedEntitiesRestored: 5 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(getAppendedOp().payload).toEqual({
        appDataComplete: mockRepairedState,
        repairSummary: summary,
      });
    });

    it('should include the server cursor used to build a sync repair', async () => {
      const summary = createRepairSummary({ entityStateFixed: 1 });

      await repairSyncContext.runWithBaseServerSeq(17, () =>
        service.createRepairOperation(mockRepairedState, summary, 'test-client'),
      );

      expect(getAppendedOp().payload).toEqual(
        jasmine.objectContaining({ repairBaseServerSeq: 17 }),
      );
    });

    it('should acquire lock before creating operation', async () => {
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should propose an incremented vector clock for the client', async () => {
      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 10, clientB: 5 }),
      );
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      const operation = getAppendedOp();
      // Should have incremented the test-client entry
      expect(operation.vectorClock['test-client']).toBe(1);
      // Should preserve existing entries
      expect(operation.vectorClock['clientA']).toBe(10);
      expect(operation.vectorClock['clientB']).toBe(5);
    });

    it('should save state cache with the seq and clock that were actually written', async () => {
      const rebasedClock = { rebasedClient: 9, otherClient: 3 };
      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(
        async (batches: readonly MixedSourceOperationBatch[]) => ({
          // Simulate the in-transaction rebase changing the proposed clock.
          written: batches.flatMap((batch) =>
            batch.ops.map((op) => ({
              seq: 42,
              op: { ...op, vectorClock: rebasedClock },
              source: batch.source,
            })),
          ),
          skippedCount: 0,
        }),
      );
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          state: mockRepairedState,
          lastAppliedOpSeq: 42,
          vectorClock: rebasedClock,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }),
      );
    });

    it('should return the sequence number of the created operation', async () => {
      mockBatchAppendWithSeq(77);
      const summary = createRepairSummary();

      const seq = await service.createRepairOperation(
        mockRepairedState,
        summary,
        'test-client',
      );

      expect(seq).toBe(77);
    });

    it('should throw error if clientId is empty', async () => {
      const summary = createRepairSummary();

      await expectAsync(
        service.createRepairOperation(mockRepairedState, summary, ''),
      ).toBeRejectedWithError('clientId is required - cannot create repair operation');
    });

    it('should notify user when fixes were made (interactive)', async () => {
      const summary = createRepairSummary({
        entityStateFixed: 2,
        orphanedEntitiesRestored: 3,
      });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client', {
        interactive: true,
      });

      expect(mockTranslateService.instant).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalled();
    });

    it('should always alert an interactive caller even when no fixes were made', async () => {
      const summary = createRepairSummary(); // All zeros

      await service.createRepairOperation(mockRepairedState, summary, 'test-client', {
        interactive: true,
      });

      expect(alertSpy).toHaveBeenCalled();
    });

    // #9026: the default is non-interactive (automatic/in-lock repair). It must
    // never reach the blocking "data repaired" alert() — that would hold
    // sp_op_log open during background sync — but a non-blocking snack still
    // surfaces the silent data change, and the REPAIR op is still created.
    it('shows a non-blocking snack (not the blocking alert) for a non-interactive repair', async () => {
      const summary = createRepairSummary({ entityStateFixed: 2 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).toHaveBeenCalled();
      // translateService.instant + alert() are only reached by the blocking path.
      expect(mockTranslateService.instant).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          msg: T.F.SYNC.D_DATA_REPAIRED.MSG,
          translateParams: { count: 2 },
        }),
      );
    });

    it('does not snack a non-interactive repair when nothing changed', async () => {
      const summary = createRepairSummary(); // All zeros

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockSnackService.open).not.toHaveBeenCalled();
      expect(alertSpy).not.toHaveBeenCalled();
    });

    it('snacks a non-interactive repair only once per session', async () => {
      const summary = createRepairSummary({ entityStateFixed: 1 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');
      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockSnackService.open).toHaveBeenCalledTimes(1);
    });

    it('should generate unique operation ID', async () => {
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');
      const firstId = getAppendedOp().id;

      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.reset();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');
      const secondId = getAppendedOp().id;

      expect(firstId).not.toBe(secondId);
    });

    it('should include timestamp in operation', async () => {
      const beforeTime = Date.now();
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      const afterTime = Date.now();
      const operation = getAppendedOp();

      expect(operation.timestamp).toBeGreaterThanOrEqual(beforeTime);
      expect(operation.timestamp).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('createEmptyRepairSummary', () => {
    it('should create a summary with all zero counts', () => {
      const summary = RepairOperationService.createEmptyRepairSummary();

      expect(summary.entityStateFixed).toBe(0);
      expect(summary.orphanedEntitiesRestored).toBe(0);
      expect(summary.invalidReferencesRemoved).toBe(0);
      expect(summary.relationshipsFixed).toBe(0);
      expect(summary.structureRepaired).toBe(0);
      expect(summary.typeErrorsFixed).toBe(0);
    });
  });

  describe('total fixes calculation', () => {
    it('should count all fix types correctly', async () => {
      const summary = createRepairSummary({
        entityStateFixed: 1,
        orphanedEntitiesRestored: 2,
        invalidReferencesRemoved: 3,
        relationshipsFixed: 4,
        structureRepaired: 5,
        typeErrorsFixed: 6,
      });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client', {
        interactive: true,
      });

      // Total fixes = 1+2+3+4+5+6 = 21
      expect(mockTranslateService.instant).toHaveBeenCalledWith(
        jasmine.any(String),
        jasmine.objectContaining({ count: '21' }),
      );
      expect(alertSpy).toHaveBeenCalled();
    });
  });
});
