import { TestBed } from '@angular/core/testing';
import { VectorClockService } from './vector-clock.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
  EntityType,
} from '../core/operation.types';
import { VectorClock } from '../../core/util/vector-clock';

describe('VectorClockService', () => {
  let service: VectorClockService;
  let mockStoreService: jasmine.SpyObj<OperationLogStoreService>;

  const createMockOperation = (
    id: string,
    vectorClock: VectorClock,
    entityType: EntityType = 'TASK',
    entityId?: string,
    entityIds?: string[],
  ): Operation => ({
    id,
    actionType: '[Test] Action' as ActionType,
    opType: OpType.Update,
    entityType,
    entityId,
    entityIds,
    payload: {},
    clientId: 'test-client',
    vectorClock,
    timestamp: Date.now(),
    schemaVersion: 1,
  });

  const createMockEntry = (
    seq: number,
    op: Operation,
    source: 'local' | 'remote' = 'local',
  ): OperationLogEntry => ({
    seq,
    op,
    appliedAt: Date.now(),
    source,
  });

  beforeEach(() => {
    mockStoreService = jasmine.createSpyObj('OperationLogStoreService', [
      'loadStateCache',
      'getOpsAfterSeq',
      'getVectorClock',
    ]);

    TestBed.configureTestingModule({
      providers: [
        VectorClockService,
        { provide: OperationLogStoreService, useValue: mockStoreService },
      ],
    });

    service = TestBed.inject(VectorClockService);
  });

  describe('getCurrentVectorClock', () => {
    it('should return stored clock when vector_clock store has data (fast path)', async () => {
      const storedClock: VectorClock = { clientA: 10, clientB: 5 };
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(storedClock));

      const clock = await service.getCurrentVectorClock();

      expect(clock).toEqual({ clientA: 10, clientB: 5 });
      // Should NOT call loadStateCache when fast path is used
      expect(mockStoreService.loadStateCache).not.toHaveBeenCalled();
    });

    it('should return empty clock when no snapshot and no operations', async () => {
      // Mock getVectorClock to return null (no stored clock, triggers fallback)
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(null));
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      const clock = await service.getCurrentVectorClock();

      expect(clock).toEqual({});
    });

    it('should return snapshot clock when no operations after snapshot', async () => {
      // Mock getVectorClock to return null (no stored clock, triggers fallback)
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(null));
      const snapshotClock: VectorClock = { clientA: 5, clientB: 3 };
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: snapshotClock,
          lastAppliedOpSeq: 10,
          state: {},
          compactedAt: Date.now(),
        }),
      );
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      const clock = await service.getCurrentVectorClock();

      expect(clock).toEqual({ clientA: 5, clientB: 3 });
    });

    it('should merge snapshot clock with operation clocks', async () => {
      // Mock getVectorClock to return null (no stored clock, triggers fallback)
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(null));
      const snapshotClock: VectorClock = { clientA: 5, clientB: 3 };
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: snapshotClock,
          lastAppliedOpSeq: 10,
          state: {},
          compactedAt: Date.now(),
        }),
      );

      const ops: OperationLogEntry[] = [
        createMockEntry(11, createMockOperation('op1', { clientA: 6, clientB: 3 })),
        createMockEntry(12, createMockOperation('op2', { clientA: 6, clientB: 4 })),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const clock = await service.getCurrentVectorClock();

      expect(clock).toEqual({ clientA: 6, clientB: 4 });
    });

    it('should include new clients from operations', async () => {
      // Mock getVectorClock to return null (no stored clock, triggers fallback)
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(null));
      const snapshotClock: VectorClock = { clientA: 5 };
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: snapshotClock,
          lastAppliedOpSeq: 10,
          state: {},
          compactedAt: Date.now(),
        }),
      );

      const ops: OperationLogEntry[] = [
        createMockEntry(11, createMockOperation('op1', { clientA: 5, clientB: 1 })),
        createMockEntry(
          12,
          createMockOperation('op2', { clientA: 5, clientB: 1, clientC: 1 }),
        ),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const clock = await service.getCurrentVectorClock();

      expect(clock).toEqual({ clientA: 5, clientB: 1, clientC: 1 });
    });

    it('should call getOpsAfterSeq with correct sequence number', async () => {
      // Mock getVectorClock to return null (no stored clock, triggers fallback)
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(null));
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 5 },
          lastAppliedOpSeq: 42,
          state: {},
          compactedAt: Date.now(),
        }),
      );
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      await service.getCurrentVectorClock();

      expect(mockStoreService.getOpsAfterSeq).toHaveBeenCalledWith(42);
    });

    it('should call getOpsAfterSeq with 0 when no snapshot', async () => {
      // Mock getVectorClock to return null (no stored clock, triggers fallback)
      mockStoreService.getVectorClock.and.returnValue(Promise.resolve(null));
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      await service.getCurrentVectorClock();

      expect(mockStoreService.getOpsAfterSeq).toHaveBeenCalledWith(0);
    });
  });

  describe('getSnapshotVectorClock', () => {
    it('should return undefined when no snapshot exists', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const clock = await service.getSnapshotVectorClock();

      expect(clock).toBeUndefined();
    });

    it('should return snapshot vector clock when snapshot exists', async () => {
      const snapshotClock: VectorClock = { clientA: 10, clientB: 5 };
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: snapshotClock,
          lastAppliedOpSeq: 100,
          state: {},
          compactedAt: Date.now(),
        }),
      );

      const clock = await service.getSnapshotVectorClock();

      expect(clock).toEqual({ clientA: 10, clientB: 5 });
    });
  });

  describe('getSnapshotEntityKeys', () => {
    it('should return undefined when no snapshot exists', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const entityKeys = await service.getSnapshotEntityKeys();

      expect(entityKeys).toBeUndefined();
    });

    it('should return undefined when snapshot has no snapshotEntityKeys (old format)', async () => {
      // Old snapshot format without snapshotEntityKeys
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 10 },
          lastAppliedOpSeq: 100,
          state: {},
          compactedAt: Date.now(),
          // No snapshotEntityKeys field
        }),
      );

      const entityKeys = await service.getSnapshotEntityKeys();

      expect(entityKeys).toBeUndefined();
    });

    it('should return Set of entity keys when snapshot has snapshotEntityKeys', async () => {
      const snapshotEntityKeys = ['TASK:task-1', 'TASK:task-2', 'PROJECT:proj-1'];
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 10 },
          lastAppliedOpSeq: 100,
          state: {},
          compactedAt: Date.now(),
          snapshotEntityKeys,
        }),
      );

      const entityKeys = await service.getSnapshotEntityKeys();

      expect(entityKeys).toBeDefined();
      expect(entityKeys instanceof Set).toBeTrue();
      expect(entityKeys!.size).toBe(3);
      expect(entityKeys!.has('TASK:task-1')).toBeTrue();
      expect(entityKeys!.has('TASK:task-2')).toBeTrue();
      expect(entityKeys!.has('PROJECT:proj-1')).toBeTrue();
    });

    it('should return empty Set when snapshotEntityKeys is empty array', async () => {
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 10 },
          lastAppliedOpSeq: 100,
          state: {},
          compactedAt: Date.now(),
          snapshotEntityKeys: [],
        }),
      );

      const entityKeys = await service.getSnapshotEntityKeys();

      expect(entityKeys).toBeDefined();
      expect(entityKeys!.size).toBe(0);
    });

    it('should allow efficient lookup of entity existence', async () => {
      const snapshotEntityKeys = ['TASK:task-1', 'TAG:tag-1', 'PROJECT:proj-1'];
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 10 },
          lastAppliedOpSeq: 100,
          state: {},
          compactedAt: Date.now(),
          snapshotEntityKeys,
        }),
      );

      const entityKeys = await service.getSnapshotEntityKeys();

      // Entity that existed at snapshot time
      expect(entityKeys!.has('TASK:task-1')).toBeTrue();

      // Entity that did NOT exist at snapshot time (new entity)
      expect(entityKeys!.has('TASK:new-task')).toBeFalse();
    });
  });

  describe('getFullVectorClock', () => {
    it('should return empty clock when no snapshot and no operations', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      const clock = await service.getFullVectorClock();

      expect(clock).toEqual({});
    });

    it('should return snapshot clock merged with all ops from seq 0', async () => {
      const snapshotClock: VectorClock = { clientA: 5, clientB: 3 };
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: snapshotClock,
          lastAppliedOpSeq: 10,
          state: {},
          compactedAt: Date.now(),
        }),
      );

      const ops: OperationLogEntry[] = [
        createMockEntry(1, createMockOperation('op1', { clientA: 2 })), // Before snapshot
        createMockEntry(5, createMockOperation('op2', { clientB: 2, clientC: 1 })), // Before snapshot
        createMockEntry(11, createMockOperation('op3', { clientA: 6, clientB: 4 })), // After snapshot
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const clock = await service.getFullVectorClock();

      // Should merge snapshot + ALL ops (including those before snapshot seq)
      expect(clock).toEqual({ clientA: 6, clientB: 4, clientC: 1 });
    });

    it('should always query from seq 0 regardless of snapshot', async () => {
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 5 },
          lastAppliedOpSeq: 100, // High snapshot seq
          state: {},
          compactedAt: Date.now(),
        }),
      );
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      await service.getFullVectorClock();

      // Should query from seq 0, not from snapshot.lastAppliedOpSeq
      expect(mockStoreService.getOpsAfterSeq).toHaveBeenCalledWith(0);
    });

    it('should include clock entries that might be missing from snapshot', async () => {
      // Simulate a corrupted/incomplete snapshot clock
      const snapshotClock: VectorClock = { clientA: 5 }; // Missing clientB entry
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: snapshotClock,
          lastAppliedOpSeq: 10,
          state: {},
          compactedAt: Date.now(),
        }),
      );

      // Op with clientB entry that was compacted but not in snapshot clock
      const ops: OperationLogEntry[] = [
        createMockEntry(
          5,
          createMockOperation('op1', { clientA: 4, clientB: 3 }), // Before snapshot
        ),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const clock = await service.getFullVectorClock();

      // Should include clientB from the op even though snapshot doesn't have it
      expect(clock).toEqual({ clientA: 5, clientB: 3 });
    });
  });

  describe('getEntityFrontier', () => {
    it('should return empty map when no operations', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      const frontier = await service.getEntityFrontier();

      expect(frontier.size).toBe(0);
    });

    it('should return entity frontier for single operation with entityId', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const ops: OperationLogEntry[] = [
        createMockEntry(
          1,
          createMockOperation('op1', { clientA: 1 }, 'TASK', 'task-123'),
        ),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier();

      expect(frontier.size).toBe(1);
      expect(frontier.get('TASK:task-123')).toEqual({ clientA: 1 });
    });

    it('should return entity frontier for operation with entityIds array', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const op = createMockOperation('op1', { clientA: 1 }, 'TASK');
      op.entityIds = ['task-1', 'task-2', 'task-3'];
      const ops: OperationLogEntry[] = [createMockEntry(1, op)];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier();

      expect(frontier.size).toBe(3);
      expect(frontier.get('TASK:task-1')).toEqual({ clientA: 1 });
      expect(frontier.get('TASK:task-2')).toEqual({ clientA: 1 });
      expect(frontier.get('TASK:task-3')).toEqual({ clientA: 1 });
    });

    it('should keep latest operation clock for each entity', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const ops: OperationLogEntry[] = [
        createMockEntry(
          1,
          createMockOperation('op1', { clientA: 1 }, 'TASK', 'task-123'),
        ),
        createMockEntry(
          2,
          createMockOperation('op2', { clientA: 2 }, 'TASK', 'task-123'),
        ),
        createMockEntry(
          3,
          createMockOperation('op3', { clientA: 3 }, 'TASK', 'task-123'),
        ),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier();

      expect(frontier.size).toBe(1);
      expect(frontier.get('TASK:task-123')).toEqual({ clientA: 3 });
    });

    it('should track multiple entities separately', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const ops: OperationLogEntry[] = [
        createMockEntry(1, createMockOperation('op1', { clientA: 1 }, 'TASK', 'task-1')),
        createMockEntry(
          2,
          createMockOperation('op2', { clientA: 2 }, 'PROJECT', 'project-1'),
        ),
        createMockEntry(3, createMockOperation('op3', { clientA: 3 }, 'TAG', 'tag-1')),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier();

      expect(frontier.size).toBe(3);
      expect(frontier.get('TASK:task-1')).toEqual({ clientA: 1 });
      expect(frontier.get('PROJECT:project-1')).toEqual({ clientA: 2 });
      expect(frontier.get('TAG:tag-1')).toEqual({ clientA: 3 });
    });

    it('should filter by entityType when specified', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const ops: OperationLogEntry[] = [
        createMockEntry(1, createMockOperation('op1', { clientA: 1 }, 'TASK', 'task-1')),
        createMockEntry(
          2,
          createMockOperation('op2', { clientA: 2 }, 'PROJECT', 'project-1'),
        ),
        createMockEntry(3, createMockOperation('op3', { clientA: 3 }, 'TASK', 'task-2')),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier('TASK');

      expect(frontier.size).toBe(2);
      expect(frontier.get('TASK:task-1')).toEqual({ clientA: 1 });
      expect(frontier.get('TASK:task-2')).toEqual({ clientA: 3 });
      expect(frontier.has('PROJECT:project-1')).toBe(false);
    });

    it('should filter by entityId when specified', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const ops: OperationLogEntry[] = [
        createMockEntry(1, createMockOperation('op1', { clientA: 1 }, 'TASK', 'task-1')),
        createMockEntry(2, createMockOperation('op2', { clientA: 2 }, 'TASK', 'task-2')),
        createMockEntry(3, createMockOperation('op3', { clientA: 3 }, 'TASK', 'task-1')),
      ];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier('TASK', 'task-1');

      expect(frontier.size).toBe(1);
      expect(frontier.get('TASK:task-1')).toEqual({ clientA: 3 });
    });

    it('should start from snapshot lastAppliedOpSeq', async () => {
      mockStoreService.loadStateCache.and.returnValue(
        Promise.resolve({
          vectorClock: { clientA: 10 },
          lastAppliedOpSeq: 50,
          state: {},
          compactedAt: Date.now(),
        }),
      );
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve([]));

      await service.getEntityFrontier();

      expect(mockStoreService.getOpsAfterSeq).toHaveBeenCalledWith(50);
    });

    it('should handle operations without entityId or entityIds', async () => {
      mockStoreService.loadStateCache.and.returnValue(Promise.resolve(null));

      const op = createMockOperation('op1', { clientA: 1 }, 'GLOBAL_CONFIG');
      // No entityId or entityIds
      const ops: OperationLogEntry[] = [createMockEntry(1, op)];
      mockStoreService.getOpsAfterSeq.and.returnValue(Promise.resolve(ops));

      const frontier = await service.getEntityFrontier();

      expect(frontier.size).toBe(0);
    });
  });
});
