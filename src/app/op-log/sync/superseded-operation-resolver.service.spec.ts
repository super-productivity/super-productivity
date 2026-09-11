import { TestBed } from '@angular/core/testing';
import { SupersededOperationResolverService } from './superseded-operation-resolver.service';
import {
  MixedSourceWrittenOperation,
  OperationLogStoreService,
} from '../persistence/operation-log-store.service';
import { VectorClockService } from './vector-clock.service';
import {
  ConflictResolutionService,
  getLatestTaskProjectMoveEntityIds,
} from './conflict-resolution.service';
import { LockService } from './lock.service';
import { SnackService } from '../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
  EntityType,
} from '../core/operation.types';
import { VectorClock } from '../../core/util/vector-clock';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { MAX_VECTOR_CLOCK_SIZE } from '../core/operation-log.const';
import { StateSnapshotService } from '../backup/state-snapshot.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { AppStateSnapshot } from '../core/types/backup.types';
import { TODAY_TAG } from '../../features/tag/tag.const';

describe('SupersededOperationResolverService', () => {
  let service: SupersededOperationResolverService;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockVectorClockService: jasmine.SpyObj<VectorClockService>;
  let mockConflictResolutionService: jasmine.SpyObj<ConflictResolutionService>;
  let mockLockService: jasmine.SpyObj<LockService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockClientIdProvider: { loadClientId: jasmine.Spy };
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockOperationCapture: jasmine.SpyObj<OperationCaptureService>;

  const TEST_CLIENT_ID = 'test-client-123';

  const createReplaySnapshot = (
    overrides: Partial<AppStateSnapshot> = {},
  ): AppStateSnapshot =>
    ({
      section: { ids: [], entities: {} },
      project: { ids: [], entities: {} },
      tag: { ids: [], entities: {} },
      ...overrides,
    }) as AppStateSnapshot;

  const expectAtomicRejection = (opIds: readonly string[]): void => {
    expect(
      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.mostRecent().args[1],
    ).toEqual({ rejectOpIds: opIds });
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
  };

  const createMockOperation = (
    id: string,
    entityType: EntityType,
    entityId: string | undefined,
    vectorClock: VectorClock,
    timestamp: number = Date.now(),
  ): Operation => ({
    id,
    actionType: `[${entityType}] Update Task` as ActionType,
    opType: OpType.Update,
    entityType,
    entityId,
    payload: { someData: 'test' },
    clientId: 'original-client',
    vectorClock,
    timestamp,
    schemaVersion: 1,
  });

  beforeEach(() => {
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'markRejected',
      'appendMixedSourceBatchSkipDuplicates',
      'appendWithVectorClockOverwrite',
      'getOpsAfterSeq',
      'getUnsynced',
    ]);
    mockVectorClockService = jasmine.createSpyObj('VectorClockService', [
      'getCurrentVectorClock',
    ]);
    mockConflictResolutionService = jasmine.createSpyObj('ConflictResolutionService', [
      'getCurrentEntityState',
      'mergeAndIncrementClocks',
      'createLWWUpdateOp',
      'createTaskRecreationFollowUpOps',
    ]);
    mockLockService = jasmine.createSpyObj('LockService', ['request']);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockClientIdProvider = {
      loadClientId: jasmine
        .createSpy('loadClientId')
        .and.returnValue(Promise.resolve(TEST_CLIENT_ID)),
    };
    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshotForOperationLog',
    ]);
    mockOperationCapture = jasmine.createSpyObj('OperationCaptureService', [
      'hasUnrecoveredPersistFailure',
      'getPendingCount',
    ]);

    // Default mocks
    mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
    mockOpLogStore.getOpsAfterSeq.and.resolveTo([]);
    mockOpLogStore.getUnsynced.and.resolveTo([]);
    mockOpLogStore.markRejected.and.returnValue(Promise.resolve());
    mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
      createReplaySnapshot(),
    );
    mockOperationCapture.hasUnrecoveredPersistFailure.and.returnValue(false);
    mockOperationCapture.getPendingCount.and.returnValue(0);
    mockOpLogStore.appendWithVectorClockOverwrite.and.returnValue(Promise.resolve(1));
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => {
      const written: MixedSourceWrittenOperation[] = [];
      let seq = 1;
      for (const batch of batches) {
        for (const op of batch.ops) {
          await mockOpLogStore.appendWithVectorClockOverwrite(op, batch.source);
          written.push({ seq: seq++, op, source: batch.source });
        }
      }
      return { written, skippedCount: 0 };
    });
    // Mock lock service to execute the callback immediately
    mockLockService.request.and.callFake(
      (_lockName: string, callback: () => Promise<any>) => callback(),
    );
    // Mock merged clock methods - merged from LWWOperationFactory
    mockConflictResolutionService.mergeAndIncrementClocks.and.callFake(
      (clocks: VectorClock[], clientId: string) => {
        const merged: VectorClock = {};
        for (const clock of clocks) {
          for (const [k, v] of Object.entries(clock)) {
            merged[k] = Math.max(merged[k] || 0, v);
          }
        }
        merged[clientId] = (merged[clientId] || 0) + 1;
        return merged;
      },
    );
    mockConflictResolutionService.createLWWUpdateOp.and.callFake(
      (
        entityType: EntityType,
        entityId: string,
        entityState: unknown,
        clientId: string,
        vectorClock: VectorClock,
        timestamp: number,
        _lwwUpdateMode?: 'replace' | 'patch',
        entityIds?: string[],
      ) => ({
        id: 'generated-id-' + Math.random().toString(36).substring(7),
        actionType: `[${entityType}] LWW Update` as ActionType,
        opType: OpType.Update,
        entityType,
        entityId,
        entityIds,
        payload: entityState,
        clientId,
        vectorClock,
        timestamp,
        schemaVersion: 1,
      }),
    );
    mockConflictResolutionService.createTaskRecreationFollowUpOps.and.resolveTo([]);

    TestBed.configureTestingModule({
      providers: [
        SupersededOperationResolverService,
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: VectorClockService, useValue: mockVectorClockService },
        { provide: ConflictResolutionService, useValue: mockConflictResolutionService },
        { provide: LockService, useValue: mockLockService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: CLIENT_ID_PROVIDER, useValue: mockClientIdProvider },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: OperationCaptureService, useValue: mockOperationCapture },
      ],
    });

    service = TestBed.inject(SupersededOperationResolverService);
  });

  describe('resolveSupersededLocalOps', () => {
    it('should acquire sp_op_log lock before writing operations', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1', title: 'Test Task' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      expect(mockLockService.request).toHaveBeenCalledTimes(1);
      expect(mockLockService.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should execute all operations within the lock callback', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1', title: 'Test Task' };
      const callOrder: string[] = [];

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      // Track call order to verify operations happen inside lock
      mockLockService.request.and.callFake(
        async (_lockName: string, callback: () => Promise<any>) => {
          callOrder.push('lock-start');
          const result = await callback();
          callOrder.push('lock-end');
          return result;
        },
      );
      mockOpLogStore.appendWithVectorClockOverwrite.and.callFake(async () => {
        callOrder.push('appendWithVectorClockOverwrite');
        return 1;
      });
      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(
        async (batches) => {
          const written: MixedSourceWrittenOperation[] = [];
          for (const batch of batches) {
            for (const op of batch.ops) {
              await mockOpLogStore.appendWithVectorClockOverwrite(op, batch.source);
              written.push({ seq: written.length + 1, op, source: batch.source });
            }
          }
          callOrder.push('atomicCommit');
          return { written, skippedCount: 0 };
        },
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      // Verify write operations happen inside the lock
      expect(callOrder).toEqual([
        'lock-start',
        'appendWithVectorClockOverwrite',
        'atomicCommit',
        'lock-end',
      ]);
      expectAtomicRejection(['op-1']);
    });

    it('keeps superseded rows retryable when the replacement batch fails', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', {
        clientA: 1,
      });
      mockConflictResolutionService.getCurrentEntityState.and.resolveTo({
        id: 'task-1',
        title: 'Current task',
      });
      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.rejectWith(
        new Error('batch failed'),
      );

      await expectAsync(
        service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]),
      ).toBeRejectedWithError('batch failed');

      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should return 0 when supersededOps array is empty', async () => {
      const result = await service.resolveSupersededLocalOps([]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockOverwrite).not.toHaveBeenCalled();
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should return 0 when no client ID is available', async () => {
      mockClientIdProvider.loadClientId.and.returnValue(Promise.resolve(null));

      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp },
      ]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    });

    it('should skip ops without entityId and not create new ops for them', async () => {
      const supersededOpWithoutEntityId = createMockOperation('op-1', 'TASK', undefined, {
        clientA: 1,
      });

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOpWithoutEntityId },
      ]);

      expect(result).toBe(0);
      expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
      expect(mockOpLogStore.appendWithVectorClockOverwrite).not.toHaveBeenCalled();
    });

    it('should create LWW Update op for a single superseded op', async () => {
      const supersededOp = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 5 },
        1000,
      );
      supersededOp.actionType = ActionType.TASK_SHARED_UPDATE;
      supersededOp.entityIds = ['task-1', 'subtask-1'];
      supersededOp.payload = {
        actionPayload: {
          task: { id: 'task-1', changes: { projectId: 'project-2' } },
          projectMoveSubTaskIds: ['subtask-1'],
        },
        entityChanges: [],
      };
      const entityState = { id: 'task-1', title: 'Test Task' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 3, clientB: 2 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp },
      ]);

      expect(result).toBe(1);
      expectAtomicRejection(['op-1']);
      expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      expect(appendedOp.actionType).toBe('[TASK] LWW Update');
      expect(appendedOp.opType).toBe(OpType.Update);
      expect(appendedOp.entityType).toBe('TASK');
      expect(appendedOp.entityId).toBe('task-1');
      expect(appendedOp.entityIds).toEqual(['task-1', 'subtask-1']);
      expect(appendedOp.payload).toEqual(entityState);
      expect(appendedOp.clientId).toBe(TEST_CLIENT_ID);
      expect(appendedOp.timestamp).toBe(1000); // Preserved from original
    });

    it('preserves recreate guards and appends their relationship follow-ups (#8997)', async () => {
      const supersededOp: Operation = {
        ...createMockOperation('op-1', 'TASK', 'task-1', { clientA: 5 }, 1_000),
        actionType: '[TASK] LWW Update' as ActionType,
        payload: {
          actionPayload: {
            id: 'task-1',
            projectId: 'project-1',
            subTaskIds: [],
          },
          entityChanges: [],
          lwwUpdateMode: 'replace',
          recreatesEntityAfterDelete: true,
        },
      };
      const replacementOp: Operation = {
        ...supersededOp,
        id: 'replacement-task',
        payload: {
          actionPayload: {
            id: 'task-1',
            projectId: 'project-1',
            subTaskIds: [],
          },
          entityChanges: [],
          lwwUpdateMode: 'replace',
        },
      };
      const projectFollowUp: Operation = {
        ...replacementOp,
        id: 'project-follow-up',
        entityType: 'PROJECT',
        entityId: 'project-1',
        actionType: '[PROJECT] LWW Update' as ActionType,
      };
      const ordinarySupersededOp = createMockOperation(
        'op-2',
        'TAG',
        'tag-1',
        { clientA: 6 },
        2_000,
      );
      const ordinaryReplacementOp: Operation = {
        ...ordinarySupersededOp,
        id: 'replacement-tag',
        clientId: TEST_CLIENT_ID,
      };
      mockConflictResolutionService.getCurrentEntityState.and.callFake(
        (entityType: EntityType) =>
          Promise.resolve(
            entityType === 'TASK'
              ? (replacementOp.payload as { actionPayload: unknown }).actionPayload
              : { id: 'tag-1', title: 'Tag' },
          ),
      );
      mockConflictResolutionService.createLWWUpdateOp.and.callFake((entityType) =>
        entityType === 'TASK' ? replacementOp : ordinaryReplacementOp,
      );
      mockConflictResolutionService.createTaskRecreationFollowUpOps.and.callFake((op) =>
        Promise.resolve(op.entityType === 'TASK' ? [projectFollowUp] : []),
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: supersededOp.id, op: supersededOp },
        { opId: ordinarySupersededOp.id, op: ordinarySupersededOp },
      ]);

      expect(result).toBe(2);
      expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).toHaveBeenCalledTimes(
        1,
      );
      const appendedOps = mockOpLogStore.appendWithVectorClockOverwrite.calls
        .allArgs()
        .map(([op]) => op);
      expect(
        (appendedOps[0].payload as { recreatesEntityAfterDelete?: boolean })
          .recreatesEntityAfterDelete,
      ).toBeTrue();
      expect(appendedOps[1]).toBe(projectFollowUp);
      expect(appendedOps[2]).toBe(ordinaryReplacementOp);
      expect(
        mockConflictResolutionService.createTaskRecreationFollowUpOps,
      ).toHaveBeenCalledWith(appendedOps[0]);
    });

    it('should not reuse a generic multi-task footprint for an LWW update', async () => {
      const supersededOp = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 5 },
        1000,
      );
      supersededOp.entityIds = ['task-1', 'unrelated-task'];
      mockConflictResolutionService.getCurrentEntityState.and.resolveTo({
        id: 'task-1',
        title: 'Test Task',
      });

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      expect(appendedOp.entityIds).toBeUndefined();
    });

    it('should preserve an authenticated project-move footprint through another LWW replacement', async () => {
      const supersededOp = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 5 },
        1000,
      );
      supersededOp.actionType = '[TASK] LWW Update' as ActionType;
      supersededOp.entityIds = ['task-1', 'subtask-1'];
      // New-style synthetic LWW op: footprint lives in the authenticated payload.
      supersededOp.payload = {
        actionPayload: { id: 'task-1' },
        entityChanges: [],
        lwwUpdateMode: 'replace',
        projectMoveFootprint: ['task-1', 'subtask-1'],
      } as unknown as Operation['payload'];
      mockConflictResolutionService.getCurrentEntityState.and.resolveTo({
        id: 'task-1',
        title: 'Test Task',
      });

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      // The footprint is derived from the authenticated payload and passed to
      // createLWWUpdateOp (which embeds it in both entityIds and the payload;
      // real embedding is covered by the conflict-resolution spec).
      expect(appendedOp.entityIds).toEqual(['task-1', 'subtask-1']);
    });

    it('does not reuse a legacy LWW footprint that exists only in the plaintext entityIds envelope (GHSA-8pxh-mgc7-gp3g)', () => {
      // A pre-fix synthetic LWW op carries entityIds but no authenticated
      // projectMoveFootprint. It must NOT be reused as a footprint — reading the
      // envelope here would launder a (potentially tampered) value into a freshly
      // authenticated replacement op. The replacement falls back to
      // receiving-state repair instead.
      const legacyOp = createMockOperation(
        'op-legacy',
        'TASK',
        'task-1',
        { clientA: 5 },
        1000,
      );
      legacyOp.actionType = '[TASK] LWW Update' as ActionType;
      legacyOp.entityIds = ['task-1', 'subtask-1'];

      expect(getLatestTaskProjectMoveEntityIds([legacyOp])).toBeUndefined();
    });

    it('should create single merged op for multiple superseded ops on same entity', async () => {
      const supersededOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 3 },
        1000,
      );
      const supersededOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-1',
        { clientA: 4 },
        2000,
      );
      const supersededOp3 = createMockOperation(
        'op-3',
        'TASK',
        'task-1',
        { clientA: 5 },
        1500,
      );
      supersededOp1.actionType = ActionType.TASK_SHARED_UPDATE;
      supersededOp1.payload = {
        actionPayload: {
          task: { id: 'task-1', changes: { projectId: 'proj-2' } },
          projectMoveSubTaskIds: ['former-subtask'],
        },
        entityChanges: [],
      };
      supersededOp2.actionType = ActionType.TASK_SHARED_UPDATE;
      supersededOp2.payload = {
        actionPayload: {
          task: { id: 'task-1', changes: { projectId: 'proj-2' } },
          projectMoveSubTaskIds: ['current-subtask'],
        },
        entityChanges: [],
      };
      const entityState = { id: 'task-1', title: 'Latest State' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientB: 10 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
        { opId: 'op-3', op: supersededOp3 },
      ]);

      expect(result).toBe(1); // Only ONE new op for all 3 superseded ops
      expectAtomicRejection(['op-1', 'op-2', 'op-3']);
      expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      // Timestamp should be max of all superseded ops (2000)
      expect(appendedOp.timestamp).toBe(2000);
      expect(appendedOp.entityIds).toEqual(['task-1', 'current-subtask']);
    });

    it('should create separate ops for different entities', async () => {
      const supersededOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 1 },
        1000,
      );
      const supersededOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-2',
        { clientA: 2 },
        2000,
      );

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.callFake(
        (entityType: EntityType, entityId: string) => {
          return Promise.resolve({ id: entityId, title: `Entity ${entityId}` });
        },
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
      ]);

      expect(result).toBe(2);
      expectAtomicRejection(['op-1', 'op-2']);
      expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(2);
    });

    it('should mark ops as rejected but not create new op when entity not found', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'deleted-task', {
        clientA: 1,
      });

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(undefined),
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp },
      ]);

      expect(result).toBe(0);
      expectAtomicRejection(['op-1']);
      expect(mockOpLogStore.appendWithVectorClockOverwrite).not.toHaveBeenCalled();
      // Should notify user that local changes were discarded
      expect(mockSnackService.open).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({
          translateParams: { count: 1 },
        }),
      );
    });

    it('should merge snapshot vector clock when provided', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };
      const snapshotVectorClock: VectorClock = { clientX: 100, clientY: 50 };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 5 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps(
        [{ opId: 'op-1', op: supersededOp }],
        undefined,
        snapshotVectorClock,
      );

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      // Clock should include entries from global clock, snapshot clock, superseded op clock, and be incremented
      expect(appendedOp.vectorClock['clientX']).toBe(100);
      expect(appendedOp.vectorClock['clientY']).toBe(50);
      expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(5);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
    });

    it('should merge extra clocks from force download', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };
      const extraClocks: VectorClock[] = [{ clientP: 20 }, { clientQ: 30, clientP: 25 }];

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps(
        [{ opId: 'op-1', op: supersededOp }],
        extraClocks,
      );

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      // Should have max of all merged clocks
      expect(appendedOp.vectorClock['clientP']).toBe(25); // max(20, 25)
      expect(appendedOp.vectorClock['clientQ']).toBe(30);
    });

    it('should preserve maximum timestamp from superseded ops (not use Date.now())', async () => {
      const oldTimestamp = 1609459200000; // 2021-01-01
      const supersededOp = createMockOperation(
        'op-1',
        'TASK',
        'task-1',
        { clientA: 1 },
        oldTimestamp,
      );
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      expect(appendedOp.timestamp).toBe(oldTimestamp);
      // Verify it's NOT a recent timestamp
      expect(appendedOp.timestamp).toBeLessThan(Date.now() - 1000000);
    });

    it('should create vector clock that dominates global clock and superseded op clocks', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', {
        clientA: 10,
        clientB: 5,
      });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(
        Promise.resolve({ clientA: 8, clientC: 15 }),
      );
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      // New clock should be incremented and dominate all known clocks
      expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10); // max of 10 and 8
      expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
      expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
      expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1); // Incremented
    });

    it('should use LWW Update action type for created ops', async () => {
      const supersededOp = createMockOperation('op-1', 'PROJECT', 'project-1', {
        clientA: 1,
      });
      const entityState = { id: 'project-1', title: 'My Project' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
        .args[0] as Operation;
      expect(appendedOp.actionType).toBe('[PROJECT] LWW Update');
    });

    it('no longer fires the bare count snack when merge ops are created (SPAP-15)', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      // SPAP-15: the LWW_CONFLICTS_AUTO_RESOLVED snack was replaced by the
      // journal-driven summary banner. Superseded-merge ops are self-healing
      // local wins and are not journaled, so no count snack fires here.
      expect(mockSnackService.open).not.toHaveBeenCalledWith(
        jasmine.objectContaining({
          translateParams: { localWins: 1, remoteWins: 0 },
        }),
      );
    });

    it('should handle mixed scenario: some entities found, some not', async () => {
      const supersededOp1 = createMockOperation(
        'op-1',
        'TASK',
        'task-exists',
        { clientA: 1 },
        1000,
      );
      const supersededOp2 = createMockOperation(
        'op-2',
        'TASK',
        'task-deleted',
        { clientA: 2 },
        2000,
      );
      const supersededOp3 = createMockOperation(
        'op-3',
        'TASK',
        'task-exists-2',
        { clientA: 3 },
        3000,
      );

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.callFake(
        (_entityType: EntityType, entityId: string) => {
          if (entityId === 'task-deleted') {
            return Promise.resolve(undefined);
          }
          return Promise.resolve({ id: entityId });
        },
      );

      const result = await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
        { opId: 'op-3', op: supersededOp3 },
      ]);

      expect(result).toBe(2); // Only 2 new ops (for existing entities)
      expectAtomicRejection(['op-1', 'op-2', 'op-3']); // All 3 rejected
      expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(2);
    });

    it('should append ops with local source', async () => {
      const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const entityState = { id: 'task-1' };

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve(entityState),
      );

      await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

      expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledWith(
        jasmine.any(Object),
        'local',
      );
    });

    it('should generate unique UUIDs for new ops', async () => {
      const supersededOp1 = createMockOperation('op-1', 'TASK', 'task-1', { clientA: 1 });
      const supersededOp2 = createMockOperation('op-2', 'TASK', 'task-2', { clientA: 2 });

      mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
      mockConflictResolutionService.getCurrentEntityState.and.returnValue(
        Promise.resolve({ id: 'test' }),
      );

      await service.resolveSupersededLocalOps([
        { opId: 'op-1', op: supersededOp1 },
        { opId: 'op-2', op: supersededOp2 },
      ]);

      const calls = mockOpLogStore.appendWithVectorClockOverwrite.calls.all();
      const op1 = calls[0].args[0] as Operation;
      const op2 = calls[1].args[0] as Operation;

      expect(op1.id).not.toBe(op2.id);
      expect(op1.id).not.toBe('op-1'); // New ID, not reusing original
      expect(op2.id).not.toBe('op-2');
    });

    describe('section placement operation handling', () => {
      const remoteMoveOp: Operation = {
        id: 'remote-section-move',
        actionType: ActionType.SECTION_ADD_TASK,
        opType: OpType.Move,
        entityType: 'SECTION',
        entityId: 'section-left',
        entityIds: ['section-left', 'section-right'],
        payload: {
          actionPayload: {
            sectionId: 'section-right',
            taskId: 'task-1',
            afterTaskId: 'right-anchor',
            sourceSectionId: 'section-left',
          },
          entityChanges: [],
        },
        clientId: 'remote-client',
        vectorClock: { remote: 4 },
        timestamp: 900,
        schemaVersion: 1,
      };
      const remoteRemoveOp: Operation = {
        id: 'remote-section-remove',
        actionType: ActionType.SECTION_REMOVE_TASK,
        opType: OpType.Update,
        entityType: 'SECTION',
        entityId: 'section-left',
        payload: {
          actionPayload: {
            sectionId: 'section-left',
            taskId: 'task-1',
            workContextId: 'TODAY',
            workContextType: 'TAG',
            workContextAfterTaskId: 'main-anchor',
          },
          entityChanges: [],
        },
        clientId: 'remote-client',
        vectorClock: { remote: 4 },
        timestamp: 900,
        schemaVersion: 1,
      };
      const remoteOrderOp: Operation = {
        id: 'remote-section-order',
        actionType: ActionType.SECTION_UPDATE_ORDER,
        opType: OpType.Move,
        entityType: 'SECTION',
        entityId: 'section-right',
        entityIds: ['section-right', 'section-left'],
        payload: {
          actionPayload: {
            contextId: 'TODAY',
            ids: ['section-right', 'section-left'],
          },
          entityChanges: [],
        },
        clientId: 'remote-client',
        vectorClock: { remote: 4 },
        timestamp: 900,
        schemaVersion: 1,
      };
      const asPendingEntries = (...ops: Operation[]): OperationLogEntry[] =>
        ops.map((op, index) => ({
          seq: index + 1,
          op,
          appliedAt: index + 1,
          source: 'local',
        }));
      const sectionOps: Array<{
        description: string;
        op: Operation;
        remoteOp: Operation;
      }> = [
        {
          description: 'cross-section move',
          op: {
            id: 'op-section-move',
            actionType: ActionType.SECTION_ADD_TASK,
            opType: OpType.Move,
            entityType: 'SECTION',
            entityId: 'section-left',
            entityIds: ['section-left', 'section-right'],
            payload: {
              actionPayload: {
                sectionId: 'section-right',
                taskId: 'task-1',
                afterTaskId: 'right-anchor',
                sourceSectionId: 'section-left',
              },
              entityChanges: [],
            },
            clientId: 'original-client',
            vectorClock: { original: 3 },
            timestamp: 1000,
            schemaVersion: 1,
          },
          remoteOp: remoteRemoveOp,
        },
        {
          description: 'section removal with work-context reorder',
          op: {
            id: 'op-section-remove',
            actionType: ActionType.SECTION_REMOVE_TASK,
            opType: OpType.Update,
            entityType: 'SECTION',
            entityId: 'section-left',
            payload: {
              actionPayload: {
                sectionId: 'section-left',
                taskId: 'task-1',
                workContextId: 'TODAY',
                workContextType: 'TAG',
                workContextAfterTaskId: 'main-anchor',
              },
              entityChanges: [],
            },
            clientId: 'original-client',
            vectorClock: { original: 3 },
            timestamp: 2000,
            schemaVersion: 1,
          },
          remoteOp: remoteMoveOp,
        },
        {
          description: 'section order',
          op: {
            id: 'op-section-order',
            actionType: ActionType.SECTION_UPDATE_ORDER,
            opType: OpType.Move,
            entityType: 'SECTION',
            entityId: 'section-right',
            entityIds: ['section-right', 'section-left'],
            payload: {
              actionPayload: {
                contextId: 'TODAY',
                ids: ['section-right', 'section-left'],
              },
              entityChanges: [],
            },
            clientId: 'original-client',
            vectorClock: { original: 4 },
            timestamp: 3000,
            schemaVersion: 1,
          },
          remoteOp: remoteMoveOp,
        },
        {
          description: 'cross-section move rejected behind section order',
          op: {
            ...remoteMoveOp,
            id: 'op-section-move-behind-order',
            clientId: 'original-client',
            vectorClock: { original: 3 },
            timestamp: 4000,
          },
          remoteOp: remoteOrderOp,
        },
      ];
      const unrelatedPendingTaskOp = createMockOperation(
        'unrelated-pending-task',
        'TASK',
        'task-unrelated',
        { original: 4 },
        5000,
      );

      beforeEach(() => {
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-right', 'section-left', 'section-third'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor', 'task-1'],
                },
                ['section-third']: {
                  id: 'section-third',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Third',
                  taskIds: [],
                },
              },
            },
            tag: {
              ids: ['TODAY'],
              entities: {
                TODAY: {
                  ...TODAY_TAG,
                  taskIds: ['main-anchor', 'task-1'],
                },
              },
            },
          }),
        );
      });

      sectionOps.forEach(({ description, op, remoteOp }) => {
        it(`should causally re-create a superseded ${description}`, async () => {
          mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([
            {
              seq: 1,
              op: remoteOp,
              appliedAt: 1,
              source: 'remote',
              syncedAt: 1,
              applicationStatus: 'applied',
            },
          ]);
          mockOpLogStore.getUnsynced.and.resolveTo(asPendingEntries(op));

          const result = await service.resolveSupersededLocalOps([
            { opId: op.id, op, existingClock: remoteOp.vectorClock },
          ]);

          const needsLegacyWorkContextCompensation =
            op.actionType === ActionType.SECTION_REMOVE_TASK;
          expect(result).toBe(needsLegacyWorkContextCompensation ? 2 : 1);
          expectAtomicRejection([op.id]);
          expect(
            mockConflictResolutionService.getCurrentEntityState,
          ).not.toHaveBeenCalled();
          const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
            .args[0] as Operation;
          expect(replacement).toEqual(
            jasmine.objectContaining({
              actionType: op.actionType,
              id: jasmine.any(String),
              clientId: TEST_CLIENT_ID,
              vectorClock: {
                ...op.vectorClock,
                remote: 4,
                [TEST_CLIENT_ID]: 1,
              },
              schemaVersion: CURRENT_SCHEMA_VERSION,
            }),
          );
          if (op.actionType === ActionType.SECTION_UPDATE_ORDER) {
            expect(replacement.entityIds).toEqual([
              'section-right',
              'section-left',
              'section-third',
            ]);
            expect(
              (replacement.payload as { actionPayload: Record<string, unknown> })
                .actionPayload['ids'],
            ).toEqual(['section-right', 'section-left', 'section-third']);
          } else {
            expect(replacement.entityIds).toEqual(op.entityIds);
            expect(replacement.payload).toEqual(op.payload);
          }
          expect(replacement.id).not.toBe(op.id);
          if (needsLegacyWorkContextCompensation) {
            expect(
              mockOpLogStore.appendWithVectorClockOverwrite.calls.allArgs()[1][0],
            ).toEqual(
              jasmine.objectContaining({
                actionType: '[TAG] LWW Update',
                entityType: 'TAG',
                entityId: 'TODAY',
                payload: {
                  ...TODAY_TAG,
                  taskIds: ['main-anchor', 'task-1'],
                },
              }),
            );
          }
        });
      });

      it('should keep the LWW fallback when the retained SECTION op does not commute', async () => {
        const localRemoveOp = sectionOps[1].op;
        const nonCommutingMove: Operation = {
          ...remoteMoveOp,
          payload: {
            actionPayload: {
              sectionId: 'section-right',
              taskId: 'different-task',
              afterTaskId: 'right-anchor',
              sourceSectionId: 'section-left',
            },
            entityChanges: [],
          },
        };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getUnsynced.and.resolveTo(asPendingEntries(localRemoveOp));
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: nonCommutingMove,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockConflictResolutionService.getCurrentEntityState.and.resolveTo({
          id: 'section-left',
          taskIds: [],
        });

        await service.resolveSupersededLocalOps([
          {
            opId: localRemoveOp.id,
            op: localRemoveOp,
            existingClock: nonCommutingMove.vectorClock,
          },
        ]);

        expect(mockConflictResolutionService.getCurrentEntityState).toHaveBeenCalled();
        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(replacement.actionType).not.toBe(ActionType.SECTION_REMOVE_TASK);
      });

      it('should keep the LWW fallback when multiple retained ops share the conflict clock', async () => {
        const localMoveOp = sectionOps[0].op;
        const ambiguousRemoteOp: Operation = {
          ...remoteRemoveOp,
          id: 'ambiguous-remote-section-remove',
          payload: {
            actionPayload: {
              sectionId: 'section-left',
              taskId: 'different-task',
              workContextId: 'TODAY',
              workContextType: 'TAG',
              workContextAfterTaskId: 'main-anchor',
            },
            entityChanges: [],
          },
        };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getUnsynced.and.resolveTo(asPendingEntries(localMoveOp));
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteRemoveOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
          {
            seq: 2,
            op: ambiguousRemoteOp,
            appliedAt: 2,
            source: 'local',
            syncedAt: 2,
            rejectedAt: 3,
            applicationStatus: 'applied',
          },
        ]);
        mockConflictResolutionService.getCurrentEntityState.and.resolveTo({
          id: 'section-left',
          taskIds: [],
        });

        await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteRemoveOp.vectorClock,
          },
        ]);

        expect(mockConflictResolutionService.getCurrentEntityState).toHaveBeenCalled();
        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(replacement.actionType).not.toBe(ActionType.SECTION_ADD_TASK);
      });

      it('should compose an older move with a later synced move instead of deferring forever', async () => {
        const localMoveOp = sectionOps[0].op;
        const laterOverlappingMoveOp: Operation = {
          ...localMoveOp,
          id: 'later-synced-section-move',
          entityId: 'section-right',
          entityIds: ['section-right', 'section-third'],
          payload: {
            actionPayload: {
              sectionId: 'section-third',
              taskId: 'task-1',
              afterTaskId: 'third-anchor',
              sourceSectionId: 'section-right',
            },
            entityChanges: [],
          },
          vectorClock: { original: 4 },
          timestamp: 1500,
        };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({
          original: 4,
          remote: 4,
        });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: localMoveOp,
            appliedAt: 1,
            source: 'local',
          },
          {
            seq: 2,
            op: laterOverlappingMoveOp,
            appliedAt: 2,
            source: 'local',
            syncedAt: 2,
          },
          {
            seq: 3,
            op: remoteRemoveOp,
            appliedAt: 3,
            source: 'remote',
            syncedAt: 3,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-right', 'section-left', 'section-third'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor'],
                },
                ['section-third']: {
                  id: 'section-third',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Third',
                  taskIds: ['third-anchor', 'task-1'],
                },
              },
            },
          }),
        );

        const result = await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteRemoveOp.vectorClock,
          },
        ]);

        expect(result).toBe(1);
        expectAtomicRejection([localMoveOp.id]);
        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(replacement.entityId).toBe('section-left');
        expect(replacement.entityIds).toEqual(['section-left', 'section-third']);
        expect(
          (replacement.payload as { actionPayload: Record<string, unknown> })
            .actionPayload,
        ).toEqual({
          sectionId: 'section-third',
          taskId: 'task-1',
          afterTaskId: 'third-anchor',
          sourceSectionId: 'section-left',
        });
      });

      it('should persist projected placements in current predecessor order', async () => {
        const createPlacement = (
          taskId: string,
          afterTaskId: string,
          counter: number,
        ): Operation => ({
          ...sectionOps[0].op,
          id: `place-${taskId}`,
          entityId: 'section-right',
          entityIds: undefined,
          payload: {
            actionPayload: {
              sectionId: 'section-right',
              taskId,
              afterTaskId,
              sourceSectionId: null,
            },
            entityChanges: [],
          },
          vectorClock: { original: counter },
          timestamp: 1000 + counter,
        });
        const placeC = createPlacement('task-c', 'base-task', 1);
        const placeB = createPlacement('task-b', 'base-task', 2);
        const placeA = createPlacement('task-a', 'base-task', 3);
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({
          original: 3,
          remote: 4,
        });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteOrderOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-right', 'section-left'],
              entities: {
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['base-task', 'task-a', 'task-b', 'task-c'],
                },
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: [],
                },
              },
            },
          }),
        );

        const result = await service.resolveSupersededLocalOps(
          [placeC, placeB, placeA].map((op) => ({
            opId: op.id,
            op,
            existingClock: remoteOrderOp.vectorClock,
          })),
        );

        expect(result).toBe(3);
        expectAtomicRejection([placeC.id, placeB.id, placeA.id]);
        const replacementTaskIds = mockOpLogStore.appendWithVectorClockOverwrite.calls
          .all()
          .map(
            ({ args }) =>
              (
                args[0].payload as {
                  actionPayload: { taskId: string };
                }
              ).actionPayload.taskId,
          );
        expect(replacementTaskIds).toEqual(['task-a', 'task-b', 'task-c']);
      });

      it('should compose a later removal into a fleet-compatible replacement pair', async () => {
        const localMoveOp = sectionOps[0].op;
        const currentToday = {
          ...TODAY_TAG,
          taskIds: ['current-main-anchor', 'task-1'],
        };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteOrderOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-left', 'section-right'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor'],
                },
              },
            },
            tag: {
              ids: ['TODAY'],
              entities: {
                TODAY: currentToday,
              },
            },
          }),
        );

        const result = await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteOrderOp.vectorClock,
          },
        ]);

        expect(result).toBe(2);
        const replacements =
          mockOpLogStore.appendWithVectorClockOverwrite.calls.allArgs();
        const sectionReplacement = replacements[0][0] as Operation;
        expect(sectionReplacement.actionType).toBe(ActionType.SECTION_REMOVE_TASK);
        expect(sectionReplacement.opType).toBe(OpType.Update);
        expect(sectionReplacement.entityId).toBe('section-left');
        expect(sectionReplacement.entityIds).toBeUndefined();
        expect(
          (sectionReplacement.payload as { actionPayload: Record<string, unknown> })
            .actionPayload,
        ).toEqual({
          sectionId: 'section-left',
          taskId: 'task-1',
          workContextId: 'TODAY',
          workContextType: 'TAG',
          workContextAfterTaskId: 'current-main-anchor',
        });
        expect(replacements[1][0]).toEqual(
          jasmine.objectContaining({
            actionType: '[TAG] LWW Update',
            entityType: 'TAG',
            entityId: 'TODAY',
            payload: currentToday,
          }),
        );
      });

      it('should ignore an unrelated retained non-SECTION op for safe replay', async () => {
        const localMoveOp = sectionOps[0].op;
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteRemoveOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
          {
            seq: 2,
            op: unrelatedPendingTaskOp,
            appliedAt: 2,
            source: 'local',
            syncedAt: 2,
            applicationStatus: 'applied',
          },
        ]);

        const result = await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteRemoveOp.vectorClock,
          },
        ]);

        expect(result).toBe(1);
        expectAtomicRejection([localMoveOp.id]);
        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(replacement.actionType).toBe(ActionType.SECTION_ADD_TASK);
      });

      it('should replace a deleted section anchor with the current predecessor', async () => {
        const localMoveOp = sectionOps[0].op;
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteRemoveOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-left', 'section-right'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['new-predecessor', 'task-1', 'tail'],
                },
              },
            },
          }),
        );

        const result = await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteRemoveOp.vectorClock,
          },
        ]);

        expect(result).toBe(1);
        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(
          (replacement.payload as { actionPayload: Record<string, unknown> })
            .actionPayload['afterTaskId'],
        ).toBe('new-predecessor');
      });

      it('should replace a moved work-context anchor with the current predecessor', async () => {
        const localRemoveOp = sectionOps[1].op;
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteMoveOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-left', 'section-right'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor', 'task-1'],
                },
              },
            },
            tag: {
              ids: ['TODAY'],
              entities: {
                TODAY: {
                  id: 'TODAY',
                  title: 'Today',
                  taskIds: ['new-main-predecessor', 'task-1', 'main-anchor'],
                },
              },
            },
          }),
        );

        await service.resolveSupersededLocalOps([
          {
            opId: localRemoveOp.id,
            op: localRemoveOp,
            existingClock: remoteMoveOp.vectorClock,
          },
        ]);

        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(
          (replacement.payload as { actionPayload: Record<string, unknown> })
            .actionPayload['workContextAfterTaskId'],
        ).toBe('new-main-predecessor');
      });

      it('should preserve the work-context reorder when a later action re-adds the task to its source section', async () => {
        const localRemoveOp = sectionOps[1].op;
        const laterReAddOp: Operation = {
          ...sectionOps[0].op,
          id: 'later-re-add-to-source',
          entityId: 'section-left',
          entityIds: undefined,
          payload: {
            actionPayload: {
              sectionId: 'section-left',
              taskId: 'task-1',
              afterTaskId: 'left-anchor',
              sourceSectionId: null,
            },
            entityChanges: [],
          },
          vectorClock: { original: 4 },
          timestamp: 2500,
        };
        const currentToday = {
          ...TODAY_TAG,
          taskIds: ['new-main-predecessor', 'task-1', 'main-anchor'],
        };
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({
          original: 4,
          remote: 4,
        });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteOrderOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
          {
            seq: 2,
            op: laterReAddOp,
            appliedAt: 2,
            source: 'local',
            syncedAt: 2,
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-left', 'section-right'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor', 'task-1'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor'],
                },
              },
            },
            tag: {
              ids: ['TODAY'],
              entities: { TODAY: currentToday },
            },
          }),
        );

        const result = await service.resolveSupersededLocalOps([
          {
            opId: localRemoveOp.id,
            op: localRemoveOp,
            existingClock: remoteOrderOp.vectorClock,
          },
        ]);

        expect(result).toBe(1);
        expectAtomicRejection([localRemoveOp.id]);
        expect(mockConflictResolutionService.createLWWUpdateOp).toHaveBeenCalledWith(
          'TAG',
          'TODAY',
          currentToday,
          TEST_CLIENT_ID,
          {
            original: 4,
            remote: 4,
            [TEST_CLIENT_ID]: 1,
          },
          localRemoveOp.timestamp,
          'replace',
        );
        expect(
          mockOpLogStore.appendWithVectorClockOverwrite.calls.first().args[0],
        ).toEqual(
          jasmine.objectContaining({
            entityType: 'TAG',
            entityId: 'TODAY',
            actionType: '[TAG] LWW Update',
          }),
        );
      });

      it('should scope placement projection to its work context when the task belongs to sections in two contexts', async () => {
        const localMoveOp = sectionOps[0].op;
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteOrderOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-left', 'project-section', 'section-right'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['project-section']: {
                  id: 'project-section',
                  contextId: 'project-1',
                  contextType: 'PROJECT',
                  title: 'Project',
                  taskIds: ['task-1'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor', 'task-1'],
                },
              },
            },
          }),
        );

        await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteOrderOp.vectorClock,
          },
        ]);

        expect(
          mockConflictResolutionService.getCurrentEntityState,
        ).not.toHaveBeenCalled();
        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(replacement.actionType).toBe(ActionType.SECTION_ADD_TASK);
        expect(replacement.entityIds).toEqual(['section-left', 'section-right']);
        expect(
          (replacement.payload as { actionPayload: Record<string, unknown> })
            .actionPayload,
        ).toEqual({
          sectionId: 'section-right',
          taskId: 'task-1',
          afterTaskId: 'right-anchor',
          sourceSectionId: 'section-left',
        });
      });

      it('should not retarget a no-section placement replay into another work context', async () => {
        const localMoveOp = sectionOps[0].op;
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteOrderOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockStateSnapshotService.getStateSnapshotForOperationLog.and.returnValue(
          createReplaySnapshot({
            section: {
              ids: ['section-left', 'project-section', 'section-right'],
              entities: {
                ['section-left']: {
                  id: 'section-left',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Left',
                  taskIds: ['left-anchor'],
                },
                ['project-section']: {
                  id: 'project-section',
                  contextId: 'project-1',
                  contextType: 'PROJECT',
                  title: 'Project',
                  taskIds: ['task-1'],
                },
                ['section-right']: {
                  id: 'section-right',
                  contextId: 'TODAY',
                  contextType: 'TAG',
                  title: 'Right',
                  taskIds: ['right-anchor'],
                },
              },
            },
            tag: {
              ids: ['TODAY'],
              entities: {
                TODAY: {
                  id: 'TODAY',
                  title: 'Today',
                  taskIds: ['current-main-anchor', 'task-1'],
                },
              },
            },
          }),
        );

        await service.resolveSupersededLocalOps([
          {
            opId: localMoveOp.id,
            op: localMoveOp,
            existingClock: remoteOrderOp.vectorClock,
          },
        ]);

        const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(replacement.actionType).toBe(ActionType.SECTION_REMOVE_TASK);
        expect(replacement.entityId).toBe('section-left');
        expect(
          (replacement.payload as { actionPayload: Record<string, unknown> })
            .actionPayload,
        ).toEqual({
          sectionId: 'section-left',
          taskId: 'task-1',
          workContextId: 'TODAY',
          workContextType: 'TAG',
          workContextAfterTaskId: 'current-main-anchor',
        });
      });

      it('should leave the predecessor retryable when live state is ahead of durable capture', async () => {
        const localMoveOp = sectionOps[0].op;
        mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
        mockOpLogStore.getOpsAfterSeq.and.resolveTo([
          {
            seq: 1,
            op: remoteRemoveOp,
            appliedAt: 1,
            source: 'remote',
            syncedAt: 1,
            applicationStatus: 'applied',
          },
        ]);
        mockOperationCapture.getPendingCount.and.returnValue(1);

        await expectAsync(
          service.resolveSupersededLocalOps([
            {
              opId: localMoveOp.id,
              op: localMoveOp,
              existingClock: remoteRemoveOp.vectorClock,
            },
          ]),
        ).toBeRejectedWithError(/captured actions are still awaiting persistence/);

        expect(
          mockStateSnapshotService.getStateSnapshotForOperationLog,
        ).not.toHaveBeenCalled();
        expect(
          mockOpLogStore.appendMixedSourceBatchSkipDuplicates,
        ).not.toHaveBeenCalled();
      });

      [
        { description: 'causally older', vectorClock: { remote: 3 } },
        { description: 'equal-clock', vectorClock: { remote: 4 } },
      ].forEach(({ description, vectorClock }) => {
        it(`should keep the LWW fallback for a ${description} SECTION op`, async () => {
          const localMoveOp: Operation = {
            ...sectionOps[0].op,
            id: `op-section-move-${description}`,
            vectorClock,
          };
          mockVectorClockService.getCurrentVectorClock.and.resolveTo({ remote: 4 });
          mockOpLogStore.getUnsynced.and.resolveTo(asPendingEntries(localMoveOp));
          mockOpLogStore.getOpsAfterSeq.and.resolveTo([
            {
              seq: 1,
              op: remoteRemoveOp,
              appliedAt: 1,
              source: 'remote',
              syncedAt: 1,
              applicationStatus: 'applied',
            },
          ]);
          mockConflictResolutionService.getCurrentEntityState.and.resolveTo({
            id: 'section-left',
            taskIds: [],
          });

          await service.resolveSupersededLocalOps([
            {
              opId: localMoveOp.id,
              op: localMoveOp,
              existingClock: remoteRemoveOp.vectorClock,
            },
          ]);

          expect(mockConflictResolutionService.getCurrentEntityState).toHaveBeenCalled();
          const replacement = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
            .args[0] as Operation;
          expect(replacement.actionType).not.toBe(ActionType.SECTION_ADD_TASK);
        });
      });
    });

    describe('moveToArchive operation handling', () => {
      const createMockMoveToArchiveOperation = (
        id: string,
        entityIds: string[],
        vectorClock: VectorClock,
        timestamp: number = Date.now(),
      ): Operation => ({
        id,
        actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: entityIds[0],
        entityIds,
        payload: {
          actionPayload: {
            tasks: entityIds.map((eid) => ({ id: eid, title: `Task ${eid}` })),
          },
          entityChanges: [],
        },
        clientId: 'original-client',
        vectorClock,
        timestamp,
        schemaVersion: 1,
      });

      it('should re-create moveToArchive op instead of discarding it', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1', 'task-2'],
          { clientA: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 3, clientB: 2 }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        expect(result).toBe(1);
        expectAtomicRejection(['op-archive-1']);
        expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
        expect(appendedOp.opType).toBe(OpType.Update);
        expect(appendedOp.entityType).toBe('TASK');
      });

      it('should preserve original payload exactly', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1', 'task-2'],
          { clientA: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.payload).toEqual(archiveOp.payload);
      });

      it('should preserve entityId and entityIds in new operation', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1', 'task-2', 'task-3'],
          { clientA: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.entityId).toBe('task-1');
        expect(appendedOp.entityIds).toEqual(['task-1', 'task-2', 'task-3']);
      });

      it('should create merged vector clock that dominates global and original clocks', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 10, clientB: 5 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 8, clientC: 15 }),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10);
        expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
        expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
      });

      it('should preserve original timestamp', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 5 },
          1609459200000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.timestamp).toBe(1609459200000);
      });

      it('should NOT call getCurrentEntityState for moveToArchive ops', async () => {
        const archiveOp = createMockMoveToArchiveOperation('op-archive-1', ['task-1'], {
          clientA: 5,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        expect(
          mockConflictResolutionService.getCurrentEntityState,
        ).not.toHaveBeenCalled();
      });

      it('should handle mixed batch: moveToArchive + regular ops', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive',
          ['task-1', 'task-2'],
          { clientA: 5 },
          1000,
        );
        const regularOp = createMockOperation(
          'op-regular',
          'TASK',
          'task-3',
          { clientA: 3 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-3', title: 'Regular Task' }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-archive', op: archiveOp },
          { opId: 'op-regular', op: regularOp },
        ]);

        expect(result).toBe(2);
        expectAtomicRejection(['op-archive', 'op-regular']);
        expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(2);

        const calls = mockOpLogStore.appendWithVectorClockOverwrite.calls.all();
        const ops = calls.map((c) => c.args[0] as Operation);

        const archiveResult = ops.find(
          (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        );
        const regularResult = ops.find(
          (op) => op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        );

        expect(archiveResult).toBeDefined();
        expect(archiveResult!.entityIds).toEqual(['task-1', 'task-2']);
        expect(regularResult).toBeDefined();
        expect(regularResult!.entityId).toBe('task-3');
      });

      it('should use current clientId (not original) for re-created moveToArchive op', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 5 },
          1000,
        );
        // Original op has clientId='original-client' (from createMockMoveToArchiveOperation)
        // Current client is TEST_CLIENT_ID

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.clientId).toBe(TEST_CLIENT_ID);
        expect(appendedOp.clientId).not.toBe('original-client');
      });

      it('should merge snapshotVectorClock and extraClocks into moveToArchive vector clock', async () => {
        const archiveOp = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { archive: 1 },
          1000,
        );
        const snapshotVectorClock: VectorClock = { snapshot: 5 };
        const extraClocks: VectorClock[] = [{ extra: 3 }];

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps(
          [{ opId: 'op-archive-1', op: archiveOp }],
          extraClocks,
          snapshotVectorClock,
        );

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // Clock should include entries from snapshot, extra, archive op, and be incremented
        expect(appendedOp.vectorClock['snapshot']).toBe(5);
        expect(appendedOp.vectorClock['extra']).toBe(3);
        expect(appendedOp.vectorClock['archive']).toBeGreaterThanOrEqual(1);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
      });

      it('should use CURRENT_SCHEMA_VERSION for re-created op', async () => {
        const archiveOp = createMockMoveToArchiveOperation('op-archive-1', ['task-1'], {
          clientA: 5,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
      });

      it('should handle multiple moveToArchive ops in the same batch independently', async () => {
        const archiveOp1 = createMockMoveToArchiveOperation(
          'op-archive-1',
          ['task-1'],
          { clientA: 3 },
          1000,
        );
        const archiveOp2 = createMockMoveToArchiveOperation(
          'op-archive-2',
          ['task-2', 'task-3'],
          { clientA: 5 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-archive-1', op: archiveOp1 },
          { opId: 'op-archive-2', op: archiveOp2 },
        ]);

        expect(result).toBe(2);
        expectAtomicRejection(['op-archive-1', 'op-archive-2']);
        expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(2);

        const calls = mockOpLogStore.appendWithVectorClockOverwrite.calls.all();
        const ops = calls.map((c) => c.args[0] as Operation);

        expect(ops[0].entityIds).toEqual(['task-1']);
        expect(ops[1].entityIds).toEqual(['task-2', 'task-3']);
        expect(ops[0].id).not.toBe(ops[1].id);
      });
    });

    describe('DELETE operation handling', () => {
      const createMockDeleteOperation = (
        id: string,
        entityType: EntityType,
        entityId: string,
        vectorClock: VectorClock,
        timestamp: number = Date.now(),
      ): Operation => ({
        id,
        actionType: `[${entityType}] Delete Task` as ActionType,
        opType: OpType.Delete,
        entityType,
        entityId,
        payload: { id: entityId, title: 'Deleted Task' }, // Entity data for potential undo
        clientId: 'original-client',
        vectorClock,
        timestamp,
        schemaVersion: 1,
      });

      it('should create replacement DELETE op for superseded DELETE operation', async () => {
        const supersededDeleteOp = createMockDeleteOperation(
          'op-1',
          'TASK',
          'task-1',
          {
            clientA: 5,
          },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 3, clientB: 2 }),
        );
        // Entity doesn't exist - it was deleted
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve(undefined),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        expect(result).toBe(1);
        expectAtomicRejection(['op-1']);
        expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.opType).toBe(OpType.Delete);
        expect(appendedOp.actionType).toBe('[TASK] Delete Task');
        expect(appendedOp.entityType).toBe('TASK');
        expect(appendedOp.entityId).toBe('task-1');
        expect(appendedOp.payload).toEqual({ id: 'task-1', title: 'Deleted Task' });
        expect(appendedOp.clientId).toBe(TEST_CLIENT_ID);
        expect(appendedOp.timestamp).toBe(1000);
        // Should NOT call getCurrentEntityState for DELETE ops
        expect(
          mockConflictResolutionService.getCurrentEntityState,
        ).not.toHaveBeenCalled();
      });

      it('should create single replacement DELETE for multiple superseded DELETE ops on same entity', async () => {
        const supersededDeleteOp1 = createMockDeleteOperation(
          'op-1',
          'TASK',
          'task-1',
          { clientA: 3 },
          1000,
        );
        const supersededDeleteOp2 = createMockDeleteOperation(
          'op-2',
          'TASK',
          'task-1',
          { clientA: 4 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientB: 10 }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp1 },
          { opId: 'op-2', op: supersededDeleteOp2 },
        ]);

        expect(result).toBe(1); // Only ONE new op for both superseded DELETE ops
        expectAtomicRejection(['op-1', 'op-2']);
        expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(1);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.opType).toBe(OpType.Delete);
        // Timestamp should be max of all superseded ops (2000)
        expect(appendedOp.timestamp).toBe(2000);
      });

      it('should preserve actionType and payload from original DELETE op', async () => {
        const customPayload = {
          id: 'task-1',
          title: 'Important Task',
          notes: 'some notes',
        };
        const supersededDeleteOp: Operation = {
          id: 'op-1',
          actionType: '[TASK] Delete Task' as ActionType,
          opType: OpType.Delete,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: customPayload,
          clientId: 'original-client',
          vectorClock: { clientA: 1 },
          timestamp: 1000,
          schemaVersion: 1,
        };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.actionType).toBe('[TASK] Delete Task');
        expect(appendedOp.payload).toEqual(customPayload);
      });

      it('should merge vector clocks properly for DELETE ops', async () => {
        const supersededDeleteOp = createMockDeleteOperation('op-1', 'TASK', 'task-1', {
          clientA: 10,
          clientB: 5,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve({ clientA: 8, clientC: 15 }),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // New clock should dominate all known clocks
        expect(appendedOp.vectorClock['clientA']).toBeGreaterThanOrEqual(10);
        expect(appendedOp.vectorClock['clientB']).toBeGreaterThanOrEqual(5);
        expect(appendedOp.vectorClock['clientC']).toBeGreaterThanOrEqual(15);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeGreaterThanOrEqual(1);
      });

      it('should handle DELETE ops alongside UPDATE ops for different entities', async () => {
        const supersededDeleteOp = createMockDeleteOperation(
          'op-1',
          'TASK',
          'deleted-task',
          { clientA: 1 },
          1000,
        );
        const supersededUpdateOp = createMockOperation(
          'op-2',
          'TASK',
          'existing-task',
          { clientA: 2 },
          2000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'existing-task', title: 'Existing' }),
        );

        const result = await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
          { opId: 'op-2', op: supersededUpdateOp },
        ]);

        expect(result).toBe(2); // One DELETE op + one UPDATE op
        expectAtomicRejection(['op-1', 'op-2']);
        expect(mockOpLogStore.appendWithVectorClockOverwrite).toHaveBeenCalledTimes(2);

        const calls = mockOpLogStore.appendWithVectorClockOverwrite.calls.all();
        const ops = calls.map((c) => c.args[0] as Operation);

        const deleteOp = ops.find((op) => op.entityId === 'deleted-task');
        const updateOp = ops.find((op) => op.entityId === 'existing-task');

        expect(deleteOp?.opType).toBe(OpType.Delete);
        expect(updateOp?.opType).toBe(OpType.Update);
      });

      it('no longer emits a bare count snack for DELETE ops (SPAP-15 journal-driven banner)', async () => {
        const supersededDeleteOp = createMockDeleteOperation('op-1', 'TASK', 'task-1', {
          clientA: 1,
        });

        mockVectorClockService.getCurrentVectorClock.and.returnValue(Promise.resolve({}));

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededDeleteOp },
        ]);

        // SPAP-15: the bare count snack was replaced by the journal-driven summary
        // banner. Superseded self-heals are not journaled, so no count notification
        // fires for them (behavior change — flagged for review).
        expect(mockSnackService.open).not.toHaveBeenCalledWith(
          jasmine.objectContaining({
            translateParams: { localWins: 1, remoteWins: 0 },
          }),
        );
      });
    });

    describe('vector clock merging (no client-side pruning)', () => {
      const createLargeClock = (
        prefix: string,
        count: number,
        valueStart: number = 1,
      ): VectorClock => {
        const clock: VectorClock = {};
        for (let i = 1; i <= count; i++) {
          clock[`${prefix}-${i}`] = valueStart + i - 1;
        }
        return clock;
      };

      it('should NOT prune merged clock on the client (server handles pruning)', async () => {
        const globalClock = createLargeClock('global', 16, 1);
        const opClock = createLargeClock('op', 16, 10);
        const supersededOp = createMockOperation('op-1', 'TASK', 'task-1', opClock, 1000);

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // Client sends unpruned merged clock; server prunes after conflict detection
        expect(Object.keys(appendedOp.vectorClock).length).toBeGreaterThan(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should NOT prune merged clock for moveToArchive ops (server handles pruning)', async () => {
        const globalClock = createLargeClock('global', 16, 1);
        const opClock = createLargeClock('op', 16, 10);

        const archiveOp: Operation = {
          id: 'op-archive',
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          entityIds: ['task-1'],
          payload: {
            actionPayload: { tasks: [{ id: 'task-1' }] },
            entityChanges: [],
          },
          clientId: 'original-client',
          vectorClock: opClock,
          timestamp: 1000,
          schemaVersion: 1,
        };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-archive', op: archiveOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // Client sends unpruned merged clock; server prunes after conflict detection
        expect(Object.keys(appendedOp.vectorClock).length).toBeGreaterThan(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should NOT prune merged clock for DELETE ops (server handles pruning)', async () => {
        const globalClock = createLargeClock('global', 16, 1);
        const opClock = createLargeClock('op', 16, 10);

        const deleteOp: Operation = {
          id: 'op-delete',
          actionType: '[TASK] Delete Task' as ActionType,
          opType: OpType.Delete,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { id: 'task-1' },
          clientId: 'original-client',
          vectorClock: opClock,
          timestamp: 1000,
          schemaVersion: 1,
        };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-delete', op: deleteOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // Client sends unpruned merged clock; server prunes after conflict detection
        expect(Object.keys(appendedOp.vectorClock).length).toBeGreaterThan(
          MAX_VECTOR_CLOCK_SIZE,
        );
      });

      it('should always include current client ID in merged clock', async () => {
        // Global clock has 10 high-value clients; TEST_CLIENT_ID will have the lowest counter
        const globalClock = createLargeClock('high', 10, 100);
        const supersededOp = createMockOperation(
          'op-1',
          'TASK',
          'task-1',
          { extra: 200 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        // All keys preserved — no client-side pruning (server handles it)
        expect(Object.keys(appendedOp.vectorClock).length).toBe(12);
      });

      it('should include all client IDs in unpruned merged clock', async () => {
        const protectedId = 'protected-sync-import-client';

        const globalClock: VectorClock = { [protectedId]: 1 };
        for (let i = 1; i <= 10; i++) {
          globalClock[`high-${i}`] = i * 100;
        }
        const supersededOp = createMockOperation(
          'op-1',
          'TASK',
          'task-1',
          { extra: 50 },
          1000,
        );

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([{ opId: 'op-1', op: supersededOp }]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        expect(appendedOp.vectorClock[protectedId]).toBeDefined();
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        // No client-side pruning — all keys from global + op + client ID are preserved
        expect(Object.keys(appendedOp.vectorClock).length).toBe(13);
      });

      it('should include existingClock client IDs in unpruned merged clock', async () => {
        // Simulate scenario where existingClock has server entity client IDs
        // that must be preserved for the server to see GREATER_THAN (not CONCURRENT).
        const clientIds = Array.from(
          { length: MAX_VECTOR_CLOCK_SIZE },
          (_, i) => `client-${i}`,
        );

        const globalClock: VectorClock = {};
        for (const id of clientIds) {
          globalClock[id] = 5;
        }
        globalClock['serverEntityClient'] = 7; // Server entity clock entry

        const supersededOp = createMockOperation(
          'op-1',
          'TASK',
          'task-1',
          { [TEST_CLIENT_ID]: 1 },
          1000,
        );

        const existingClock: VectorClock = { serverEntityClient: 7, [TEST_CLIENT_ID]: 1 };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );
        mockConflictResolutionService.getCurrentEntityState.and.returnValue(
          Promise.resolve({ id: 'task-1' }),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-1', op: supersededOp, existingClock },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // No client-side pruning — all keys preserved including server entity client
        expect(appendedOp.vectorClock['serverEntityClient']).toBe(7);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        // MAX_VECTOR_CLOCK_SIZE client-* entries + serverEntityClient + TEST_CLIENT_ID = MAX + 2
        expect(Object.keys(appendedOp.vectorClock).length).toBe(
          MAX_VECTOR_CLOCK_SIZE + 2,
        );
      });

      it('should include existingClock client IDs in unpruned moveToArchive merged clock', async () => {
        const protectedIds = Array.from(
          { length: MAX_VECTOR_CLOCK_SIZE },
          (_, i) => `protected-${i}`,
        );
        const globalClock: VectorClock = {};
        for (const id of protectedIds) {
          globalClock[id] = 5;
        }
        globalClock['serverEntityClient'] = 7;

        const archiveOp: Operation = {
          id: 'op-archive',
          actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          entityIds: ['task-1'],
          payload: {
            actionPayload: { tasks: [{ id: 'task-1' }] },
            entityChanges: [],
          },
          clientId: 'original-client',
          vectorClock: { [TEST_CLIENT_ID]: 1 },
          timestamp: 1000,
          schemaVersion: 1,
        };

        const existingClock: VectorClock = { serverEntityClient: 7, [TEST_CLIENT_ID]: 1 };

        mockVectorClockService.getCurrentVectorClock.and.returnValue(
          Promise.resolve(globalClock),
        );

        await service.resolveSupersededLocalOps([
          { opId: 'op-archive', op: archiveOp, existingClock },
        ]);

        const appendedOp = mockOpLogStore.appendWithVectorClockOverwrite.calls.first()
          .args[0] as Operation;
        // No client-side pruning — all keys preserved including server entity client
        expect(appendedOp.vectorClock['serverEntityClient']).toBe(7);
        expect(appendedOp.vectorClock[TEST_CLIENT_ID]).toBeDefined();
        // MAX_VECTOR_CLOCK_SIZE protected-* entries + serverEntityClient + TEST_CLIENT_ID = MAX + 2
        expect(Object.keys(appendedOp.vectorClock).length).toBe(
          MAX_VECTOR_CLOCK_SIZE + 2,
        );
      });
    });
  });
});
