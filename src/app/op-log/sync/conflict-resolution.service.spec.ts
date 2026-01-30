import { TestBed } from '@angular/core/testing';
import { ConflictResolutionService } from './conflict-resolution.service';
import { Store } from '@ngrx/store';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { of } from 'rxjs';
import { ActionType, EntityConflict, OpType, Operation } from '../core/operation.types';
import { DUPLICATE_OPERATION_ERROR_MSG } from '../persistence/op-log-errors.const';

describe('ConflictResolutionService', () => {
  let service: ConflictResolutionService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOperationApplier: jasmine.SpyObj<OperationApplierService>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockValidateStateService: jasmine.SpyObj<ValidateStateService>;

  const createMockOp = (id: string, clientId: string): Operation => ({
    id,
    clientId,
    actionType: 'test' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-1',
    // Use different payloads for different clients to avoid auto-resolution as identical
    payload: { source: clientId },
    vectorClock: { [clientId]: 1 },
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['select']);
    // Default: select returns of(undefined) - can be overridden in specific tests
    mockStore.select.and.returnValue(of(undefined));

    mockOperationApplier = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'hasOp',
      'append',
      'appendBatch',
      'appendWithVectorClockUpdate',
      'markApplied',
      'markRejected',
      'markFailed',
      'getUnsyncedByEntity',
      'filterNewOps',
      'mergeRemoteOpClocks',
    ]);
    mockOpLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockValidateStateService = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepairCurrentState',
    ]);

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: Store, useValue: mockStore },
        { provide: OperationApplierService, useValue: mockOperationApplier },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        { provide: SnackService, useValue: mockSnackService },
        { provide: ValidateStateService, useValue: mockValidateStateService },
      ],
    });
    service = TestBed.inject(ConflictResolutionService);

    // Default mock behaviors
    mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });
    mockValidateStateService.validateAndRepairCurrentState.and.resolveTo(true);
    mockOpLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
    // By default, treat all ops as new (return them as-is)
    mockOpLogStore.filterNewOps.and.callFake((ops: Operation[]) => Promise.resolve(ops));
    // By default, appendBatch returns sequential seq numbers starting from 1
    mockOpLogStore.appendBatch.and.callFake((ops: Operation[]) =>
      Promise.resolve(ops.map((_, i) => i + 1)),
    );
  });

  describe('isIdenticalConflict', () => {
    it('should detect identical conflict when both sides DELETE', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [{ ...createMockOp('local-1', 'local'), opType: OpType.Delete }],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Delete }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should detect identical conflict when both sides have same UPDATE payload', () => {
      const payload = { title: 'Same Title', notes: 'Same Notes' };
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Update, payload },
        ],
        remoteOps: [
          { ...createMockOp('remote-1', 'remote'), opType: OpType.Update, payload },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should NOT detect identical conflict when payloads differ', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { title: 'Local Title' },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { title: 'Remote Title' },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should NOT detect identical conflict when opTypes differ', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [{ ...createMockOp('local-1', 'local'), opType: OpType.Update }],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Delete }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should NOT detect identical conflict when multiple ops with different counts', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Update },
          { ...createMockOp('local-2', 'local'), opType: OpType.Update },
        ],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Update }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should detect identical conflict with multiple DELETE ops on both sides', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Delete },
          { ...createMockOp('local-2', 'local'), opType: OpType.Delete },
        ],
        remoteOps: [
          { ...createMockOp('remote-1', 'remote'), opType: OpType.Delete },
          { ...createMockOp('remote-2', 'remote'), opType: OpType.Delete },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should handle nested object payloads correctly', () => {
      const payload = {
        title: 'Test',
        nested: { deep: { value: 123 }, array: [1, 2, 3] },
      };
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          { ...createMockOp('local-1', 'local'), opType: OpType.Update, payload },
        ],
        remoteOps: [
          { ...createMockOp('remote-1', 'remote'), opType: OpType.Update, payload },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should return false for empty ops', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [],
        remoteOps: [{ ...createMockOp('remote-1', 'remote'), opType: OpType.Delete }],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });
  });
  describe('isIdenticalConflict edge cases', () => {
    it('should NOT detect arrays with different order as identical', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { tagIds: ['a', 'b', 'c'] },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { tagIds: ['c', 'b', 'a'] },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should handle null payload values correctly', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { notes: null },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { notes: null },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });

    it('should NOT treat null and undefined as identical', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: { notes: null },
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: { notes: undefined },
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(false);
    });

    it('should handle empty objects as identical', () => {
      const conflict: EntityConflict = {
        entityType: 'TASK',
        entityId: 'task-1',
        localOps: [
          {
            ...createMockOp('local-1', 'local'),
            opType: OpType.Update,
            payload: {},
          },
        ],
        remoteOps: [
          {
            ...createMockOp('remote-1', 'remote'),
            opType: OpType.Update,
            payload: {},
          },
        ],
        suggestedResolution: 'manual',
      };

      expect(service.isIdenticalConflict(conflict)).toBe(true);
    });
  });
  describe('autoResolveConflictsLWW', () => {
    // Helper to create ops with specific timestamps
    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
      opType: OpType = OpType.Update,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      clientId,
      actionType: 'test' as ActionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId, timestamp },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    // Helper to create conflict with suggestedResolution
    const createConflict = (
      entityId: string,
      localOps: Operation[],
      remoteOps: Operation[],
    ): EntityConflict => ({
      entityType: 'TASK',
      entityId,
      localOps,
      remoteOps,
      suggestedResolution: 'manual', // LWW will override this
    });

    beforeEach(() => {
      // Default mock behaviors for LWW tests
      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.callFake((op: Operation) => Promise.resolve(1));
      mockOpLogStore.appendWithVectorClockUpdate.and.callFake((op: Operation) =>
        Promise.resolve(1),
      );
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });
    });

    it('should auto-resolve conflict as remote when remote timestamp is newer', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote ops should be appended via batch
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        [jasmine.objectContaining({ id: 'remote-1' })],
        'remote',
        jasmine.any(Object),
      );
      // Local ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
      // Snack should be shown
      expect(mockSnackService.open).toHaveBeenCalled();
    });

    it('should auto-resolve conflict as local when local timestamp is newer', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now)],
          [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Both local and remote ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
      // Remote ops need to be appended first (via batch), then rejected
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        [jasmine.objectContaining({ id: 'remote-1' })],
        'remote',
      );
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
      // Snack should show local wins
      expect(mockSnackService.open).toHaveBeenCalled();
    });

    it('should auto-resolve as remote when timestamps are equal (tie-breaker)', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote wins on tie - should apply remote ops via batch
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        [jasmine.objectContaining({ id: 'remote-1' })],
        'remote',
        jasmine.any(Object),
      );
      // Local ops should be rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
    });

    it('should handle multiple conflicts in single batch', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [
            createOpWithTimestamp(
              'local-1',
              'client-a',
              now - 1000,
              OpType.Update,
              'task-1',
            ),
          ],
          [createOpWithTimestamp('remote-1', 'client-b', now, OpType.Update, 'task-1')],
        ),
        createConflict(
          'task-2',
          [createOpWithTimestamp('local-2', 'client-a', now, OpType.Update, 'task-2')],
          [
            createOpWithTimestamp(
              'remote-2',
              'client-b',
              now - 1000,
              OpType.Update,
              'task-2',
            ),
          ],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [conflicts[0].remoteOps[0]],
      });

      await service.autoResolveConflictsLWW(conflicts);

      // First conflict: remote wins (newer timestamp) - goes to pendingApply batch
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
        'remote',
        jasmine.any(Object),
      );

      // Second conflict: local wins (newer timestamp)
      // Remote op should be appended (via batch) then rejected
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-2' })]),
        'remote',
      );

      // Snack notification should reflect both outcomes
      expect(mockSnackService.open).toHaveBeenCalledWith(
        jasmine.objectContaining({
          translateParams: {
            localWins: 1,
            remoteWins: 1,
          },
        }),
      );
    });

    it('should piggyback non-conflicting ops with conflict resolution', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];
      const nonConflicting = [
        createOpWithTimestamp('non-conflict-1', 'client-b', now, OpType.Update, 'task-2'),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [...conflicts[0].remoteOps, ...nonConflicting],
      });

      await service.autoResolveConflictsLWW(conflicts, nonConflicting);

      // Non-conflicting op should also be appended (via batch with the remote-wins ops)
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'non-conflict-1' })]),
        'remote',
        jasmine.any(Object),
      );
    });

    it('should return early if no conflicts and no non-conflicting ops', async () => {
      await service.autoResolveConflictsLWW([]);

      expect(mockOpLogStore.appendBatch).not.toHaveBeenCalled();
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('should validate state after resolution', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
          [createOpWithTimestamp('remote-1', 'client-b', now)],
        ),
      ];

      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: conflicts[0].remoteOps,
      });

      await service.autoResolveConflictsLWW(conflicts);

      expect(mockValidateStateService.validateAndRepairCurrentState).toHaveBeenCalled();
    });

    it('should use max timestamp when multiple ops exist on one side', async () => {
      const now = Date.now();
      const conflicts: EntityConflict[] = [
        createConflict(
          'task-1',
          // Local has older first op but newer second op
          [
            createOpWithTimestamp('local-1', 'client-a', now - 2000),
            createOpWithTimestamp('local-2', 'client-a', now),
          ],
          // Remote has one op in between
          [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
        ),
      ];

      await service.autoResolveConflictsLWW(conflicts);

      // Local wins because max(local timestamps) > max(remote timestamps)
      // Both local ops should be rejected (old ones replaced by new update op)
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1', 'local-2']);
      // Remote ops should be appended then rejected
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    describe('edge cases', () => {
      it('should handle conflict with empty localOps array gracefully', async () => {
        // Edge case: conflict struct with empty localOps (shouldn't happen but defensive)
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [], // Empty!
            remoteOps: [createOpWithTimestamp('remote-1', 'client-b', now)],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        // Math.max() with empty array returns -Infinity, so remote should always win
        await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeResolved();

        // Remote should win (any timestamp > -Infinity)
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
          'remote',
          jasmine.any(Object),
        );
      });

      it('should handle conflict with empty remoteOps array gracefully', async () => {
        // Edge case: conflict struct with empty remoteOps (shouldn't happen but defensive)
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
            remoteOps: [], // Empty!
            suggestedResolution: 'manual',
          },
        ];

        // Math.max() with empty array returns -Infinity, so local should always win
        await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeResolved();

        // Local wins (any timestamp > -Infinity)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
        // No remote ops to append
      });

      it('should resolve DELETE vs UPDATE conflict using LWW when DELETE is newer', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-del', 'client-a', now),
                opType: OpType.Delete,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-upd', 'client-b', now - 1000),
                opType: OpType.Update,
              },
            ],
          ),
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local DELETE wins (newer timestamp)
        // Both ops should be rejected, local state (deleted) is preserved
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-del']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-upd']);
      });

      it('should resolve UPDATE vs DELETE conflict using LWW when UPDATE is newer', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-upd', 'client-a', now),
                opType: OpType.Update,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-del', 'client-b', now - 1000),
                opType: OpType.Delete,
              },
            ],
          ),
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local UPDATE wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-upd']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-del']);
      });

      it('should resolve DELETE vs UPDATE conflict when DELETE is older (remote UPDATE wins)', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [
              {
                ...createOpWithTimestamp('local-del', 'client-a', now - 1000),
                opType: OpType.Delete,
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-upd', 'client-b', now),
                opType: OpType.Update,
              },
            ],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote UPDATE wins (newer timestamp) - entity should be restored
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-upd', opType: OpType.Update }),
          ]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-del']);
      });

      it('should extract entity from DELETE payload when UPDATE wins but entity not in store', () => {
        // This tests the helper method that extracts entity state from DELETE operations
        // Used when remote DELETE is applied first, then local UPDATE wins LWW
        const taskEntity = {
          id: 'task-1',
          title: 'Test Task',
          projectId: 'project-1',
          tagIds: [],
        };

        const conflict: EntityConflict = createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-upd', 'client-a', Date.now()),
              opType: OpType.Update,
              payload: { task: taskEntity },
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-del', 'client-b', Date.now() - 1000),
              opType: OpType.Delete,
              payload: { task: taskEntity }, // DELETE payload contains the deleted entity
            },
          ],
        );

        // Call the private extraction method
        const extractedEntity = (service as any)._extractEntityFromDeleteOperation(
          conflict,
        );

        // Verify it extracted the entity from the DELETE operation's payload
        expect(extractedEntity).toEqual(taskEntity);
      });

      it('should return undefined when no DELETE operation in conflict', () => {
        const conflict: EntityConflict = createConflict(
          'task-1',
          [
            {
              ...createOpWithTimestamp('local-upd', 'client-a', Date.now()),
              opType: OpType.Update,
            },
          ],
          [
            {
              ...createOpWithTimestamp('remote-upd', 'client-b', Date.now() - 1000),
              opType: OpType.Update,
            },
          ],
        );

        const extractedEntity = (service as any)._extractEntityFromDeleteOperation(
          conflict,
        );

        expect(extractedEntity).toBeUndefined();
      });

      it('should handle CREATE vs CREATE conflict using LWW', async () => {
        // Two clients create entity with same ID (rare but possible)
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-same-id',
            [
              {
                ...createOpWithTimestamp('local-create', 'client-a', now - 1000),
                opType: OpType.Create,
                entityId: 'task-same-id',
                payload: { title: 'Local Version' },
              },
            ],
            [
              {
                ...createOpWithTimestamp('remote-create', 'client-b', now),
                opType: OpType.Create,
                entityId: 'task-same-id',
                payload: { title: 'Remote Version' },
              },
            ],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote CREATE wins (newer timestamp)
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-create', opType: OpType.Create }),
          ]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-create']);
      });

      it('should handle MOV (Move) operation conflicts using LWW', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-mov', 'client-a', now),
                opType: OpType.Move,
                payload: { fromIndex: 0, toIndex: 5 },
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-mov', 'client-b', now - 1000),
                opType: OpType.Move,
                payload: { fromIndex: 0, toIndex: 10 },
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local MOV wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-mov']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-mov']);
      });

      it('should handle BATCH operation conflicts using LWW', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-batch', 'client-a', now - 1000),
                opType: OpType.Batch,
                entityIds: ['task-1', 'task-2', 'task-3'],
                payload: { changes: [{ done: true }] },
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-batch', 'client-b', now),
                opType: OpType.Batch,
                entityIds: ['task-1', 'task-2'],
                payload: { changes: [{ done: false }] },
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote BATCH wins (newer timestamp)
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-batch', opType: OpType.Batch }),
          ]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-batch']);
      });

      it('should handle singleton entity (GLOBAL_CONFIG) conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'GLOBAL_CONFIG',
            entityId: 'GLOBAL_CONFIG', // Singleton ID
            localOps: [
              {
                id: 'local-config',
                clientId: 'clientA',
                actionType: 'updateGlobalConfig' as ActionType,
                opType: OpType.Update,
                entityType: 'GLOBAL_CONFIG',
                entityId: 'GLOBAL_CONFIG',
                payload: { theme: 'dark' },
                vectorClock: { clientA: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-config',
                clientId: 'clientB',
                actionType: 'updateGlobalConfig' as ActionType,
                opType: OpType.Update,
                entityType: 'GLOBAL_CONFIG',
                entityId: 'GLOBAL_CONFIG',
                payload: { theme: 'light' },
                vectorClock: { clientB: 1 },
                timestamp: now - 1000,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-config']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-config']);
      });

      it('should handle PLANNER entity conflicts', async () => {
        const now = Date.now();
        const dayId = '2024-01-15';
        const conflicts: EntityConflict[] = [
          {
            entityType: 'PLANNER',
            entityId: dayId,
            localOps: [
              {
                id: 'local-planner',
                clientId: 'clientA',
                actionType: 'updatePlanner' as ActionType,
                opType: OpType.Update,
                entityType: 'PLANNER',
                entityId: dayId,
                payload: { scheduledTaskIds: ['task-1', 'task-2'] },
                vectorClock: { clientA: 1 },
                timestamp: now - 1000,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-planner',
                clientId: 'clientB',
                actionType: 'updatePlanner' as ActionType,
                opType: OpType.Update,
                entityType: 'PLANNER',
                entityId: dayId,
                payload: { scheduledTaskIds: ['task-3', 'task-4'] },
                vectorClock: { clientB: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote wins (newer timestamp)
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-planner' })]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-planner']);
      });

      it('should handle BOARD entity conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'BOARD',
            entityId: 'board-1',
            localOps: [
              {
                id: 'local-board',
                clientId: 'clientA',
                actionType: 'updateBoard' as ActionType,
                opType: OpType.Update,
                entityType: 'BOARD',
                entityId: 'board-1',
                payload: { title: 'Local Board' },
                vectorClock: { clientA: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-board',
                clientId: 'clientB',
                actionType: 'updateBoard' as ActionType,
                opType: OpType.Update,
                entityType: 'BOARD',
                entityId: 'board-1',
                payload: { title: 'Remote Board' },
                vectorClock: { clientB: 1 },
                timestamp: now - 1000,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        await service.autoResolveConflictsLWW(conflicts);

        // Local wins (newer timestamp)
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-board']);
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-board']);
      });

      it('should handle REMINDER entity conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'REMINDER',
            entityId: 'reminder-1',
            localOps: [
              {
                id: 'local-reminder',
                clientId: 'clientA',
                actionType: 'updateReminder' as ActionType,
                opType: OpType.Update,
                entityType: 'REMINDER',
                entityId: 'reminder-1',
                payload: { title: 'Local Reminder', remindAt: now + 3600000 },
                vectorClock: { clientA: 1 },
                timestamp: now - 500,
                schemaVersion: 1,
              },
            ],
            remoteOps: [
              {
                id: 'remote-reminder',
                clientId: 'clientB',
                actionType: 'updateReminder' as ActionType,
                opType: OpType.Update,
                entityType: 'REMINDER',
                entityId: 'reminder-1',
                payload: { title: 'Remote Reminder', remindAt: now + 7200000 },
                vectorClock: { clientB: 1 },
                timestamp: now,
                schemaVersion: 1,
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Remote wins (newer timestamp)
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-reminder' })]),
          'remote',
          jasmine.any(Object),
        );
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-reminder']);
      });

      it('should handle mixed entity types in conflicts batch', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            localOps: [createOpWithTimestamp('local-task', 'client-a', now - 1000)],
            remoteOps: [createOpWithTimestamp('remote-task', 'client-b', now)],
            suggestedResolution: 'manual',
          },
          {
            entityType: 'PROJECT',
            entityId: 'project-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-project', 'client-a', now),
                entityType: 'PROJECT',
                entityId: 'project-1',
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-project', 'client-b', now - 1000),
                entityType: 'PROJECT',
                entityId: 'project-1',
              },
            ],
            suggestedResolution: 'manual',
          },
          {
            entityType: 'TAG',
            entityId: 'tag-1',
            localOps: [
              {
                ...createOpWithTimestamp('local-tag', 'client-a', now - 500),
                entityType: 'TAG',
                entityId: 'tag-1',
              },
            ],
            remoteOps: [
              {
                ...createOpWithTimestamp('remote-tag', 'client-b', now - 500),
                entityType: 'TAG',
                entityId: 'tag-1',
              },
            ],
            suggestedResolution: 'manual',
          },
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [conflicts[0].remoteOps[0], conflicts[2].remoteOps[0]],
        });

        await service.autoResolveConflictsLWW(conflicts);

        // Task: remote wins (newer), Tag: remote wins (tie goes to remote)
        // Both are appended in a single batch
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
          jasmine.arrayContaining([
            jasmine.objectContaining({ id: 'remote-task' }),
            jasmine.objectContaining({ id: 'remote-tag' }),
          ]),
          'remote',
          jasmine.any(Object),
        );

        // All local ops from conflicts get rejected in one batch
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith([
          'local-task',
          'local-project',
          'local-tag',
        ]);

        // Project: local wins - remote op rejected separately
        expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-project']);

        // Notification should show mixed results
        expect(mockSnackService.open).toHaveBeenCalledWith(
          jasmine.objectContaining({
            translateParams: {
              localWins: 1,
              remoteWins: 2,
            },
          }),
        );
      });
    });

    describe('return value (localWinOpsCreated)', () => {
      // Helper to create a mock local-win update operation
      const createMockLocalWinOp = (entityId: string): Operation => ({
        id: `lww-update-${entityId}`,
        clientId: 'client-a',
        actionType: '[TASK] LWW Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId,
        payload: { title: 'Local Win State' },
        vectorClock: { clientA: 2, clientB: 1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      });

      it('should return { localWinOpsCreated: 0 } when no conflicts', async () => {
        const result = await service.autoResolveConflictsLWW([]);

        expect(result).toEqual({ localWinOpsCreated: 0 });
      });

      it('should return { localWinOpsCreated: 0 } when only non-conflicting ops', async () => {
        const now = Date.now();
        const nonConflicting = [
          createOpWithTimestamp('nc-1', 'client-b', now, OpType.Update, 'task-99'),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: nonConflicting,
        });

        const result = await service.autoResolveConflictsLWW([], nonConflicting);

        expect(result).toEqual({ localWinOpsCreated: 0 });
      });

      it('should return { localWinOpsCreated: 0 } when remote wins all conflicts', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: conflicts[0].remoteOps,
        });

        const result = await service.autoResolveConflictsLWW(conflicts);

        expect(result).toEqual({ localWinOpsCreated: 0 });
      });

      it('should return { localWinOpsCreated: 1 } when local wins one conflict', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
        ];

        // Spy on the private method to return a mock local-win op
        spyOn<any>(service, '_createLocalWinUpdateOp').and.returnValue(
          Promise.resolve(createMockLocalWinOp('task-1')),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        expect(result).toEqual({ localWinOpsCreated: 1 });
      });

      it('should return correct count when multiple local wins', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
          createConflict(
            'task-2',
            [createOpWithTimestamp('local-2', 'client-a', now, OpType.Update, 'task-2')],
            [
              createOpWithTimestamp(
                'remote-2',
                'client-b',
                now - 1000,
                OpType.Update,
                'task-2',
              ),
            ],
          ),
        ];

        // Spy on the private method to return mock local-win ops
        spyOn<any>(service, '_createLocalWinUpdateOp').and.callFake(
          (conflict: EntityConflict) =>
            Promise.resolve(createMockLocalWinOp(conflict.entityId)),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        expect(result).toEqual({ localWinOpsCreated: 2 });
      });

      it('should return correct count for mixed local/remote wins', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          // Remote wins this one
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
          // Local wins this one
          createConflict(
            'task-2',
            [createOpWithTimestamp('local-2', 'client-a', now, OpType.Update, 'task-2')],
            [
              createOpWithTimestamp(
                'remote-2',
                'client-b',
                now - 1000,
                OpType.Update,
                'task-2',
              ),
            ],
          ),
          // Remote wins this one
          createConflict(
            'task-3',
            [
              createOpWithTimestamp(
                'local-3',
                'client-a',
                now - 500,
                OpType.Update,
                'task-3',
              ),
            ],
            [createOpWithTimestamp('remote-3', 'client-b', now, OpType.Update, 'task-3')],
          ),
        ];

        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [conflicts[0].remoteOps[0], conflicts[2].remoteOps[0]],
        });

        // Spy on the private method to return mock local-win op (only called for task-2)
        spyOn<any>(service, '_createLocalWinUpdateOp').and.callFake(
          (conflict: EntityConflict) =>
            Promise.resolve(createMockLocalWinOp(conflict.entityId)),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        // Only 1 local win out of 3 conflicts
        expect(result).toEqual({ localWinOpsCreated: 1 });
      });

      it('should return 0 when local wins but entity not found', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
        ];

        // Spy on the private method to return undefined (entity not found)
        spyOn<any>(service, '_createLocalWinUpdateOp').and.returnValue(
          Promise.resolve(undefined),
        );

        const result = await service.autoResolveConflictsLWW(conflicts);

        // No op created because entity not found
        expect(result).toEqual({ localWinOpsCreated: 0 });
      });
    });

    describe('vector clock update', () => {
      it('should use appendWithVectorClockUpdate for local-win ops to ensure vector clock is updated atomically', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now)],
            [createOpWithTimestamp('remote-1', 'client-b', now - 1000)],
          ),
        ];

        // Mock the private method to return a local-win op
        const mockLocalWinOp: Operation = {
          id: 'lww-update-task-1',
          clientId: 'client-a',
          actionType: '[TASK] LWW Update' as ActionType,
          opType: OpType.Update,
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Local Win State' },
          vectorClock: { clientA: 2, clientB: 1 },
          timestamp: now,
          schemaVersion: 1,
        };
        spyOn<any>(service, '_createLocalWinUpdateOp').and.returnValue(
          Promise.resolve(mockLocalWinOp),
        );

        await service.autoResolveConflictsLWW(conflicts);

        // Verify appendWithVectorClockUpdate is called (not plain append)
        // This ensures the vector clock store is updated atomically with the operation
        expect(mockOpLogStore.appendWithVectorClockUpdate).toHaveBeenCalledWith(
          jasmine.objectContaining({
            id: 'lww-update-task-1',
            actionType: '[TASK] LWW Update' as ActionType,
          }),
          'local',
        );
      });

      it('should call mergeRemoteOpClocks after applying remote ops (remote wins case)', async () => {
        // REGRESSION TEST: Bug where remote ops applied via conflict resolution
        // didn't have their clocks merged into the local clock store.
        // Without clock merge, subsequent local ops would have clocks that are
        // CONCURRENT with the applied remote ops instead of GREATER_THAN.
        const now = Date.now();
        const remoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [remoteOp],
          ),
        ];

        mockOpLogStore.hasOp.and.resolveTo(false);
        mockOpLogStore.append.and.resolveTo(1);
        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [remoteOp],
        });
        mockOpLogStore.markApplied.and.resolveTo(undefined);
        mockOpLogStore.markRejected.and.resolveTo(undefined);

        await service.autoResolveConflictsLWW(conflicts);

        // CRITICAL: mergeRemoteOpClocks must be called with applied remote ops
        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([remoteOp]);
      });

      it('should call mergeRemoteOpClocks for non-conflicting ops piggybacked through conflict resolution', async () => {
        const now = Date.now();
        const conflictRemoteOp = createOpWithTimestamp('remote-1', 'client-b', now);
        const nonConflictingOp = createOpWithTimestamp(
          'nc-1',
          'client-c',
          now,
          OpType.Update,
          'other-task',
        );
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [conflictRemoteOp],
          ),
        ];

        mockOpLogStore.hasOp.and.resolveTo(false);
        mockOpLogStore.append.and.resolveTo(1);
        mockOperationApplier.applyOperations.and.resolveTo({
          appliedOps: [conflictRemoteOp, nonConflictingOp],
        });
        mockOpLogStore.markApplied.and.resolveTo(undefined);
        mockOpLogStore.markRejected.and.resolveTo(undefined);

        await service.autoResolveConflictsLWW(conflicts, [nonConflictingOp]);

        // Both conflict-winning remote ops AND non-conflicting ops should be merged
        expect(mockOpLogStore.mergeRemoteOpClocks).toHaveBeenCalledWith([
          conflictRemoteOp,
          nonConflictingOp,
        ]);
      });
    });

    // =========================================================================
    // Issue #6213: Duplicate operation error handling with retry
    // =========================================================================
    describe('duplicate operation error handling (issue #6213)', () => {
      it('should retry once on duplicate error and succeed when cache is refreshed', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        let filterCallCount = 0;
        let appendCallCount = 0;

        // First filterNewOps: returns all ops (stale cache)
        // Second filterNewOps: returns empty (cache now fresh, ops already exist)
        mockOpLogStore.filterNewOps.and.callFake(async (ops: Operation[]) => {
          filterCallCount++;
          if (filterCallCount === 1) return ops; // Stale cache
          return []; // Fresh cache - ops already exist
        });

        // First appendBatch: throws duplicate error
        mockOpLogStore.appendBatch.and.callFake(async () => {
          appendCallCount++;
          if (appendCallCount === 1) {
            throw new Error(DUPLICATE_OPERATION_ERROR_MSG);
          }
          return [1];
        });

        mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

        // Should complete successfully with retry
        await service.autoResolveConflictsLWW(conflicts);

        // Should have retried - filterNewOps called at least twice for remoteWinsOps
        expect(mockOpLogStore.filterNewOps).toHaveBeenCalledTimes(2);
        // appendBatch only called once (retry's filterNewOps returned [])
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledTimes(1);
      });

      it('should fail if retry also throws duplicate error', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        // filterNewOps always returns the ops (simulating persistent cache issue)
        mockOpLogStore.filterNewOps.and.callFake(async (ops: Operation[]) => ops);
        // appendBatch always throws (both original and retry fail)
        mockOpLogStore.appendBatch.and.rejectWith(
          new Error(DUPLICATE_OPERATION_ERROR_MSG),
        );

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError(/Duplicate operation detected/);

        // Should have tried twice total (original + 1 retry)
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledTimes(2);
        expect(mockOpLogStore.filterNewOps).toHaveBeenCalledTimes(2);
      });

      it('should NOT retry for non-duplicate errors', async () => {
        const now = Date.now();
        const conflicts: EntityConflict[] = [
          createConflict(
            'task-1',
            [createOpWithTimestamp('local-1', 'client-a', now - 1000)],
            [createOpWithTimestamp('remote-1', 'client-b', now)],
          ),
        ];

        mockOpLogStore.filterNewOps.and.callFake(async (ops: Operation[]) => ops);
        mockOpLogStore.appendBatch.and.rejectWith(new Error('Some other database error'));

        await expectAsync(
          service.autoResolveConflictsLWW(conflicts),
        ).toBeRejectedWithError(/Some other database error/);

        // Should NOT have retried - only one call
        expect(mockOpLogStore.appendBatch).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe('_deepEqual', () => {
    // Access private method for testing
    const deepEqual = (a: unknown, b: unknown): boolean =>
      (service as any)._deepEqual(a, b);

    it('should return true for identical primitives', () => {
      expect(deepEqual(1, 1)).toBe(true);
      expect(deepEqual('hello', 'hello')).toBe(true);
      expect(deepEqual(true, true)).toBe(true);
      expect(deepEqual(null, null)).toBe(true);
    });

    it('should return false for different primitives', () => {
      expect(deepEqual(1, 2)).toBe(false);
      expect(deepEqual('hello', 'world')).toBe(false);
      expect(deepEqual(true, false)).toBe(false);
    });

    it('should return true for identical objects', () => {
      expect(deepEqual({ a: 1, b: 2 }, { a: 1, b: 2 })).toBe(true);
      expect(
        deepEqual({ nested: { value: 'test' } }, { nested: { value: 'test' } }),
      ).toBe(true);
    });

    it('should return true for identical arrays', () => {
      expect(deepEqual([1, 2, 3], [1, 2, 3])).toBe(true);
      expect(deepEqual([{ a: 1 }], [{ a: 1 }])).toBe(true);
    });

    describe('circular reference protection', () => {
      it('should return false for objects with circular references', () => {
        const warnSpy = spyOn(console, 'warn');
        const obj1: Record<string, unknown> = { a: 1 };
        obj1['self'] = obj1; // Create circular reference

        const obj2: Record<string, unknown> = { a: 1 };
        obj2['self'] = obj2; // Create circular reference

        const result = deepEqual(obj1, obj2);

        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.calls.allArgs();
        // OpLog.warn calls console.warn with prefix '[ol]' as first arg, message as second
        const hasCircularWarning = warnCalls.some((args) =>
          args.some(
            (arg) => typeof arg === 'string' && arg.includes('circular reference'),
          ),
        );
        expect(hasCircularWarning).toBe(true);
      });

      it('should return false for arrays with circular references', () => {
        const warnSpy = spyOn(console, 'warn');
        const arr1: unknown[] = [1, 2];
        arr1.push(arr1); // Create circular reference

        const arr2: unknown[] = [1, 2];
        arr2.push(arr2); // Create circular reference

        const result = deepEqual(arr1, arr2);

        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
      });
    });

    describe('depth limit protection', () => {
      it('should return false for deeply nested objects exceeding max depth', () => {
        const warnSpy = spyOn(console, 'warn');

        // Create object with depth > 50
        let obj1: Record<string, unknown> = { value: 'deep' };
        let obj2: Record<string, unknown> = { value: 'deep' };
        for (let i = 0; i < 60; i++) {
          obj1 = { nested: obj1 };
          obj2 = { nested: obj2 };
        }

        const result = deepEqual(obj1, obj2);

        expect(result).toBe(false);
        expect(warnSpy).toHaveBeenCalled();
        const warnCalls = warnSpy.calls.allArgs();
        // OpLog.warn calls console.warn with prefix '[ol]' as first arg, message as second
        const hasDepthWarning = warnCalls.some((args) =>
          args.some(
            (arg) => typeof arg === 'string' && arg.includes('exceeded max depth'),
          ),
        );
        expect(hasDepthWarning).toBe(true);
      });
    });
  });

  describe('_suggestResolution', () => {
    // Access private method for testing
    const callSuggestResolution = (
      localOps: Operation[],
      remoteOps: Operation[],
    ): 'local' | 'remote' | 'manual' => {
      return (service as any)._suggestResolution(localOps, remoteOps);
    };

    const createOp = (partial: Partial<Operation>): Operation => ({
      id: 'op-1',
      actionType: '[Test] Action' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'entity-1',
      payload: {},
      clientId: 'client-1',
      vectorClock: { client1: 1 },
      timestamp: Date.now(),
      schemaVersion: 1,
      ...partial,
    });

    it('should suggest remote when local ops are empty', () => {
      const remoteOps = [createOp({ id: 'remote-1' })];
      expect(callSuggestResolution([], remoteOps)).toBe('remote');
    });

    it('should suggest local when remote ops are empty', () => {
      const localOps = [createOp({ id: 'local-1' })];
      expect(callSuggestResolution(localOps, [])).toBe('local');
    });

    it('should suggest newer side when timestamps differ by more than 1 hour', () => {
      const now = Date.now();
      const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
      const twoHoursAgo = now - TWO_HOURS_MS;

      const localOps = [createOp({ id: 'local-1', timestamp: now })];
      const remoteOps = [createOp({ id: 'remote-1', timestamp: twoHoursAgo })];

      // Local is newer
      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');

      // Flip: remote is newer
      const localOpsOld = [createOp({ id: 'local-1', timestamp: twoHoursAgo })];
      const remoteOpsNew = [createOp({ id: 'remote-1', timestamp: now })];
      expect(callSuggestResolution(localOpsOld, remoteOpsNew)).toBe('remote');
    });

    it('should prefer update over delete (local delete, remote update)', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Delete, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Update, timestamp: now }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('remote');
    });

    it('should prefer update over delete (remote delete, local update)', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Update, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Delete, timestamp: now }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');
    });

    it('should prefer create over update', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Create, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Update, timestamp: now }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');

      // Flip
      const localOps2 = [
        createOp({ id: 'local-1', opType: OpType.Update, timestamp: now }),
      ];
      const remoteOps2 = [
        createOp({ id: 'remote-1', opType: OpType.Create, timestamp: now }),
      ];
      expect(callSuggestResolution(localOps2, remoteOps2)).toBe('remote');
    });

    it('should return manual for close timestamps with same op types', () => {
      const now = Date.now();
      const FIVE_MINUTES_MS = 5 * 60 * 1000;
      const fiveMinutesAgo = now - FIVE_MINUTES_MS;

      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Update, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Update, timestamp: fiveMinutesAgo }),
      ];

      expect(callSuggestResolution(localOps, remoteOps)).toBe('manual');
    });

    it('should auto-resolve when both have delete ops (outcome is identical)', () => {
      const now = Date.now();
      const localOps = [
        createOp({ id: 'local-1', opType: OpType.Delete, timestamp: now }),
      ];
      const remoteOps = [
        createOp({ id: 'remote-1', opType: OpType.Delete, timestamp: now }),
      ];

      // Both want to delete - auto-resolve to local (could be either, outcome is same)
      expect(callSuggestResolution(localOps, remoteOps)).toBe('local');
    });
  });

  // =========================================================================
  // Clock skew edge cases
  // =========================================================================
  // These tests verify LWW conflict resolution handles edge cases where
  // clients have significant clock differences.

  describe('clock skew edge cases', () => {
    const ONE_YEAR_MS = 365 * 24 * 60 * 60 * 1000;

    const createOpWithTimestamp = (
      id: string,
      clientId: string,
      timestamp: number,
      opType: OpType = OpType.Update,
      entityId: string = 'task-1',
    ): Operation => ({
      id,
      actionType: '[Task] Update Task' as ActionType,
      opType,
      entityType: 'TASK',
      entityId,
      payload: { source: clientId, timestamp },
      clientId,
      timestamp,
      vectorClock: { [clientId]: 1 },
      schemaVersion: 1,
    });

    it('should handle timestamps in far future (client clock ahead)', async () => {
      const now = Date.now();
      const futureTime = now + ONE_YEAR_MS; // 1 year in future

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', futureTime)],
          suggestedResolution: 'remote',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [conflicts[0].remoteOps[0]],
      });

      // Remote wins because its timestamp is newer (even if unrealistic)
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
        'remote',
        jasmine.any(Object),
      );
    });

    it('should handle timestamps in far past (client clock behind)', async () => {
      const now = Date.now();
      const pastTime = now - ONE_YEAR_MS; // 1 year in past

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', pastTime)],
          suggestedResolution: 'local',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      // Local wins because its timestamp is newer
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    it('should handle zero timestamps gracefully', async () => {
      const now = Date.now();

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', 0)],
          suggestedResolution: 'local',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      // Local wins (0 is earlier than now)
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    it('should handle negative timestamps gracefully (system clock errors)', async () => {
      const now = Date.now();

      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', -1000)],
          suggestedResolution: 'local',
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

      // Should not throw, local wins
      await service.autoResolveConflictsLWW(conflicts);

      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-1']);
    });

    it('should use client ID as stable tie-breaker for identical timestamps', async () => {
      const now = Date.now();

      // Both have exactly the same timestamp
      const conflicts: EntityConflict[] = [
        {
          entityType: 'TASK',
          entityId: 'task-1',
          // client-a < client-b alphabetically, but we test that remote wins on tie
          localOps: [createOpWithTimestamp('local-1', 'client-a', now)],
          remoteOps: [createOpWithTimestamp('remote-1', 'client-b', now)],
          suggestedResolution: 'remote', // Remote wins on tie
        },
      ];

      mockOpLogStore.hasOp.and.resolveTo(false);
      mockOpLogStore.append.and.resolveTo(1);
      mockOpLogStore.markApplied.and.resolveTo(undefined);
      mockOpLogStore.markRejected.and.resolveTo(undefined);
      mockOperationApplier.applyOperations.and.resolveTo({
        appliedOps: [conflicts[0].remoteOps[0]],
      });

      await service.autoResolveConflictsLWW(conflicts);

      // Remote should win on tie
      expect(mockOpLogStore.appendBatch).toHaveBeenCalledWith(
        jasmine.arrayContaining([jasmine.objectContaining({ id: 'remote-1' })]),
        'remote',
        jasmine.any(Object),
      );
      expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['local-1']);
    });
  });
});
