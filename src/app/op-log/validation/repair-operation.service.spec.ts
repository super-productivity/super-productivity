import { TestBed } from '@angular/core/testing';
import { RepairOperationService } from './repair-operation.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { LockService } from '../sync/lock.service';
import { VectorClockService } from '../sync/vector-clock.service';
import { ActionType, RepairSummary, OpType } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { TranslateService } from '@ngx-translate/core';

describe('RepairOperationService', () => {
  let service: RepairOperationService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockTranslateService: jasmine.SpyObj<TranslateService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
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

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'appendWithVectorClockUpdate',
      'saveStateCache',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockTranslateService = jasmine.createSpyObj('TranslateService', ['instant']);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);

    // Default mock implementations
    mockLockService.request.and.callFake(
      async (_name: string, fn: () => Promise<void>) => {
        await fn();
      },
    );
    // appendWithVectorClockUpdate returns the sequence number
    mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(Promise.resolve(100));
    mockOpLogStore.saveStateCache.and.returnValue(Promise.resolve());
    mockVectorClockService.getCurrentVectorClock.and.returnValue(
      Promise.resolve({ clientA: 5 }),
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
      ],
    });

    service = TestBed.inject(RepairOperationService);
  });

  describe('createRepairOperation', () => {
    it('should create a repair operation with correct properties', async () => {
      const summary = createRepairSummary({ entityStateFixed: 3 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
        jasmine.objectContaining({
          actionType: '[Repair] Auto Repair' as ActionType,
          opType: OpType.Repair,
          entityType: 'ALL',
          clientId: 'test-client',
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }),
        'local',
      );
    });

    it('should use appendWithVectorClockUpdate to ensure vector clock is updated atomically', async () => {
      const summary = createRepairSummary({ entityStateFixed: 1 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      // Verify appendWithVectorClockUpdate is called (not plain append)
      // This ensures the vector clock store is updated atomically with the operation
      expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalled();
    });

    it('should include repaired state and summary in payload', async () => {
      const summary = createRepairSummary({ orphanedEntitiesRestored: 5 });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      const appendCall = mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
      const operation = appendCall.args[0];

      expect(operation.payload).toEqual({
        appDataComplete: mockRepairedState,
        repairSummary: summary,
      });
    });

    it('should acquire lock before creating operation', async () => {
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should increment vector clock for the client', async () => {
      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 10, clientB: 5 }),
      );
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      const appendCall = mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
      const operation = appendCall.args[0];

      // Should have incremented the test-client entry
      expect(operation.vectorClock['test-client']).toBe(1);
      // Should preserve existing entries
      expect(operation.vectorClock['clientA']).toBe(10);
      expect(operation.vectorClock['clientB']).toBe(5);
    });

    it('should save state cache after appending operation', async () => {
      // appendWithVectorClockUpdate returns the sequence number directly
      mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(Promise.resolve(42));
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockOpLogStore.saveStateCache).toHaveBeenCalledWith(
        jasmine.objectContaining({
          state: mockRepairedState,
          lastAppliedOpSeq: 42,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        }),
      );
    });

    it('should return the sequence number of the created operation', async () => {
      // appendWithVectorClockUpdate returns the sequence number directly
      mockOpLogStore.appendWithVectorClockUpdate.and.returnValue(Promise.resolve(77));
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

    it('should notify user when fixes were made', async () => {
      const summary = createRepairSummary({
        entityStateFixed: 2,
        orphanedEntitiesRestored: 3,
      });

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(mockTranslateService.instant).toHaveBeenCalled();
      expect(alertSpy).toHaveBeenCalled();
    });

    it('should always notify user even when no fixes were made', async () => {
      // Always show alert since user already confirmed the repair
      const summary = createRepairSummary(); // All zeros

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      expect(alertSpy).toHaveBeenCalled();
    });

    it('should generate unique operation ID', async () => {
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');
      const firstCall = mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
      const firstId = firstCall.args[0].id;

      mockOpLogStore.appendWithVectorClockUpdate.calls.reset();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');
      const secondCall = mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
      const secondId = secondCall.args[0].id;

      expect(firstId).not.toBe(secondId);
    });

    it('should include timestamp in operation', async () => {
      const beforeTime = Date.now();
      const summary = createRepairSummary();

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      const afterTime = Date.now();
      const appendCall = mockOpLogStore.appendWithVectorClockUpdate.calls.mostRecent();
      const operation = appendCall.args[0];

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

      await service.createRepairOperation(mockRepairedState, summary, 'test-client');

      // Total fixes = 1+2+3+4+5+6 = 21
      expect(mockTranslateService.instant).toHaveBeenCalledWith(
        jasmine.any(String),
        jasmine.objectContaining({ count: '21' }),
      );
      expect(alertSpy).toHaveBeenCalled();
    });
  });
});
