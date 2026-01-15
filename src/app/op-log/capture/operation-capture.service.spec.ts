import { OperationCaptureService } from './operation-capture.service';
import { OpType, EntityType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';

describe('OperationCaptureService', () => {
  let service: OperationCaptureService;

  const createPersistentAction = (
    type: string,
    entityType: EntityType,
    entityId: string = 'entity-1',
    opType: OpType = OpType.Update,
    additionalProps: Record<string, unknown> = {},
  ): PersistentAction =>
    ({
      type,
      ...additionalProps,
      meta: {
        isPersistent: true,
        entityType,
        entityId,
        opType,
      },
    }) as PersistentAction;

  beforeEach(() => {
    service = new OperationCaptureService();
  });

  afterEach(() => {
    service.clear();
  });

  describe('enqueue and dequeue', () => {
    it('should enqueue and dequeue empty entityChanges for regular actions', () => {
      const action = createPersistentAction(
        '[Task] Update Task',
        'TASK',
        'task-1',
        OpType.Update,
      );

      service.enqueue(action);
      expect(service.getQueueSize()).toBe(1);

      const changes = service.dequeue();
      expect(changes).toEqual([]);
      expect(service.getQueueSize()).toBe(0);
    });

    it('should maintain FIFO order', () => {
      const action1 = createPersistentAction(
        '[Task] Add Task',
        'TASK',
        'task-1',
        OpType.Create,
      );
      const action2 = createPersistentAction(
        '[Task] Update Task',
        'TASK',
        'task-2',
        OpType.Update,
      );
      const action3 = createPersistentAction(
        '[Task] Delete Task',
        'TASK',
        'task-3',
        OpType.Delete,
      );

      service.enqueue(action1);
      service.enqueue(action2);
      service.enqueue(action3);

      expect(service.getQueueSize()).toBe(3);

      service.dequeue();
      expect(service.getQueueSize()).toBe(2);

      service.dequeue();
      expect(service.getQueueSize()).toBe(1);

      service.dequeue();
      expect(service.getQueueSize()).toBe(0);
    });

    it('should return empty array when dequeue from empty queue', () => {
      const changes = service.dequeue();
      expect(changes).toEqual([]);
    });
  });

  describe('TIME_TRACKING entity changes', () => {
    it('should extract entity changes from syncTimeTracking action', () => {
      const action = {
        type: '[TimeTracking] Sync Time Tracking',
        contextType: 'PROJECT',
        contextId: 'project-1',
        date: '2024-01-15',
        data: { workedMs: 3600000 },
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 'time-1',
          opType: OpType.Update,
        },
      } as PersistentAction;

      service.enqueue(action);
      const changes = service.dequeue();

      expect(changes.length).toBe(1);
      expect(changes[0].entityType).toBe('TIME_TRACKING');
      expect(changes[0].entityId).toBe('PROJECT:project-1:2024-01-15');
      expect(changes[0].opType).toBe(OpType.Update);
      expect(changes[0].changes).toEqual({
        contextType: 'PROJECT',
        contextId: 'project-1',
        date: '2024-01-15',
        data: { workedMs: 3600000 },
      });
    });

    it('should extract entity changes from updateWorkContextData action', () => {
      const action = {
        type: '[TimeTracking] Update Work Context Data',
        ctx: { id: 'tag-1', type: 'TAG' },
        date: '2024-01-15',
        updates: { field: 'value' },
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 'time-1',
          opType: OpType.Update,
        },
      } as PersistentAction;

      service.enqueue(action);
      const changes = service.dequeue();

      expect(changes.length).toBe(1);
      expect(changes[0].entityType).toBe('TIME_TRACKING');
      expect(changes[0].entityId).toBe('TAG:tag-1:2024-01-15');
      expect(changes[0].opType).toBe(OpType.Update);
    });

    it('should return empty array for unknown TIME_TRACKING action format', () => {
      const action = {
        type: '[TimeTracking] Unknown Format',
        someField: 'value',
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 'time-1',
          opType: OpType.Update,
        },
      } as PersistentAction;

      service.enqueue(action);
      const changes = service.dequeue();

      expect(changes).toEqual([]);
    });
  });

  describe('TASK time sync entity changes', () => {
    it('should extract entity changes from syncTimeSpent action', () => {
      // Note: The action type is '[TimeTracking] Sync time spent', not '[Task] Sync Time Spent'
      const action = {
        type: '[TimeTracking] Sync time spent',
        taskId: 'task-1',
        date: '2024-01-15',
        duration: 3600000,
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
        },
      } as PersistentAction;

      service.enqueue(action);
      const changes = service.dequeue();

      expect(changes.length).toBe(1);
      expect(changes[0].entityType).toBe('TASK');
      expect(changes[0].entityId).toBe('task-1');
      expect(changes[0].opType).toBe(OpType.Update);
      expect(changes[0].changes).toEqual({
        taskId: 'task-1',
        date: '2024-01-15',
        duration: 3600000,
      });
    });

    it('should NOT capture TASK actions with taskId/date/duration but different action type', () => {
      // This tests that the explicit action type check prevents false matches
      const action = {
        type: '[Task] Some Future Action',
        taskId: 'task-1',
        date: '2024-01-15',
        duration: 3600000, // Has all the fields syncTimeSpent has
        someOtherField: 'value',
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
        },
      } as PersistentAction;

      service.enqueue(action);
      const changes = service.dequeue();

      // Should return empty - not captured as syncTimeSpent
      expect(changes).toEqual([]);
    });
  });

  describe('queue management', () => {
    it('should track queue size correctly', () => {
      expect(service.getQueueSize()).toBe(0);

      const action = createPersistentAction('[Task] Update', 'TASK');
      service.enqueue(action);
      expect(service.getQueueSize()).toBe(1);

      service.enqueue(action);
      expect(service.getQueueSize()).toBe(2);

      service.dequeue();
      expect(service.getQueueSize()).toBe(1);
    });

    it('should clear all queued operations', () => {
      const action = createPersistentAction('[Task] Update', 'TASK');
      service.enqueue(action);
      service.enqueue(action);
      expect(service.getQueueSize()).toBe(2);

      service.clear();
      expect(service.getQueueSize()).toBe(0);
    });

    it('should peek at pending operations without removing them', () => {
      // TIME_TRACKING action to generate actual entity changes
      const action = {
        type: '[TimeTracking] Sync',
        contextType: 'PROJECT',
        contextId: 'p1',
        date: '2024-01-15',
        data: {},
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 'time-1',
          opType: OpType.Update,
        },
      } as PersistentAction;

      service.enqueue(action);
      expect(service.getQueueSize()).toBe(1);

      const pending = service.peekPendingOperations();
      expect(pending.length).toBe(1);
      expect(service.getQueueSize()).toBe(1); // Still in queue
    });
  });
});
