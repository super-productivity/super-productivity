import { isOperationSyncCapable, syncOpToOperation } from './operation-sync.util';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
} from '../sync-providers/provider.interface';
import { SyncProviderId } from '../sync-providers/provider.const';
import { ActionType, OpType } from '../core/operation.types';

describe('operation-sync utility', () => {
  describe('isOperationSyncCapable', () => {
    it('should return true for provider with supportsOperationSync = true', () => {
      const provider = {
        supportsOperationSync: true,
        downloadOps: jasmine.createSpy(),
        uploadOps: jasmine.createSpy(),
      } as unknown as SyncProviderServiceInterface<SyncProviderId> & OperationSyncCapable;

      expect(isOperationSyncCapable(provider)).toBeTrue();
    });

    it('should return false for provider with supportsOperationSync = false', () => {
      const provider = {
        supportsOperationSync: false,
      } as unknown as SyncProviderServiceInterface<SyncProviderId>;

      expect(isOperationSyncCapable(provider)).toBeFalse();
    });

    it('should return false for provider without supportsOperationSync property', () => {
      const provider = {
        someOtherProp: true,
      } as unknown as SyncProviderServiceInterface<SyncProviderId>;

      expect(isOperationSyncCapable(provider)).toBeFalse();
    });

    it('should return false for empty provider object', () => {
      const provider = {} as unknown as SyncProviderServiceInterface<SyncProviderId>;

      expect(isOperationSyncCapable(provider)).toBeFalse();
    });
  });

  describe('syncOpToOperation', () => {
    const createMockSyncOp = (overrides: Partial<SyncOperation> = {}): SyncOperation => ({
      id: 'sync-op-123',
      clientId: 'test-client',
      actionType: '[Task] Add Task' as ActionType,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: 'task-456',
      entityIds: undefined,
      payload: { title: 'Test Task' },
      vectorClock: { testClient: 5 },
      timestamp: 1701700000000,
      schemaVersion: 1,
      ...overrides,
    });

    it('should convert sync operation to local operation format', () => {
      const syncOp = createMockSyncOp();
      const op = syncOpToOperation(syncOp);

      expect(op.id).toBe('sync-op-123');
      expect(op.clientId).toBe('test-client');
      expect(op.actionType).toBe('[Task] Add Task');
      expect(op.opType).toBe(OpType.Create);
      expect(op.entityType).toBe('TASK');
      expect(op.entityId).toBe('task-456');
    });

    it('should preserve payload', () => {
      const syncOp = createMockSyncOp({
        payload: { title: 'My Task', done: true, timeSpent: 3600 },
      });
      const op = syncOpToOperation(syncOp);

      expect(op.payload).toEqual({ title: 'My Task', done: true, timeSpent: 3600 });
    });

    it('should preserve vector clock', () => {
      const syncOp = createMockSyncOp({
        vectorClock: { clientA: 10, clientB: 5, clientC: 3 },
      });
      const op = syncOpToOperation(syncOp);

      expect(op.vectorClock).toEqual({ clientA: 10, clientB: 5, clientC: 3 });
    });

    it('should preserve timestamp', () => {
      const syncOp = createMockSyncOp({ timestamp: 1701700000000 });
      const op = syncOpToOperation(syncOp);

      expect(op.timestamp).toBe(1701700000000);
    });

    it('should preserve schemaVersion', () => {
      const syncOp = createMockSyncOp({ schemaVersion: 2 });
      const op = syncOpToOperation(syncOp);

      expect(op.schemaVersion).toBe(2);
    });

    it('should handle entityIds array', () => {
      const syncOp = createMockSyncOp({
        opType: OpType.Batch,
        entityIds: ['task-1', 'task-2', 'task-3'],
        entityId: undefined,
      });
      const op = syncOpToOperation(syncOp);

      expect(op.entityIds).toEqual(['task-1', 'task-2', 'task-3']);
      expect(op.entityId).toBeUndefined();
    });

    it('should handle Update operation type', () => {
      const syncOp = createMockSyncOp({
        opType: OpType.Update,
        actionType: '[Task] Update Task' as ActionType,
        payload: { id: 'task-456', changes: { title: 'Updated' } },
      });
      const op = syncOpToOperation(syncOp);

      expect(op.opType).toBe(OpType.Update);
      expect(op.actionType).toBe('[Task] Update Task');
    });

    it('should handle Delete operation type', () => {
      const syncOp = createMockSyncOp({
        opType: OpType.Delete,
        actionType: '[Task] Delete Task' as ActionType,
      });
      const op = syncOpToOperation(syncOp);

      expect(op.opType).toBe(OpType.Delete);
    });

    it('should handle Move operation type', () => {
      const syncOp = createMockSyncOp({
        opType: OpType.Move,
        actionType: '[Task] Move Task' as ActionType,
        payload: { taskId: 'task-1', targetProjectId: 'proj-2' },
      });
      const op = syncOpToOperation(syncOp);

      expect(op.opType).toBe(OpType.Move);
    });

    it('should handle SyncImport operation type', () => {
      const syncOp = createMockSyncOp({
        opType: OpType.SyncImport,
        entityType: 'ALL',
        actionType: '[Sync] Import State' as ActionType,
      });
      const op = syncOpToOperation(syncOp);

      expect(op.opType).toBe(OpType.SyncImport);
      expect(op.entityType).toBe('ALL');
    });

    it('should handle empty payload', () => {
      const syncOp = createMockSyncOp({ payload: {} });
      const op = syncOpToOperation(syncOp);

      expect(op.payload).toEqual({});
    });

    it('should handle complex nested payload', () => {
      const syncOp = createMockSyncOp({
        payload: {
          task: {
            id: 't1',
            subTasks: [{ id: 'st1', title: 'Subtask' }],
            timeTracking: { totalTime: 3600, entries: [] },
          },
        },
      });
      const op = syncOpToOperation(syncOp);

      expect((op.payload as any).task.id).toBe('t1');
      expect((op.payload as any).task.subTasks[0].title).toBe('Subtask');
    });

    it('should handle different entity types', () => {
      const entityTypes = ['TASK', 'PROJECT', 'TAG', 'NOTE', 'GLOBAL_CONFIG'] as const;

      for (const entityType of entityTypes) {
        const syncOp = createMockSyncOp({ entityType });
        const op = syncOpToOperation(syncOp);
        expect(op.entityType).toBe(entityType);
      }
    });
  });
});
