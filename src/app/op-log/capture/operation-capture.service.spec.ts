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

  describe('pending counter', () => {
    it('should start at zero', () => {
      expect(service.getPendingCount()).toBe(0);
    });

    it('should increment on capture and decrement on processing', () => {
      const action = createPersistentAction('[Task] Update Task', 'TASK', 'task-1');

      service.incrementPending(action);
      expect(service.getPendingCount()).toBe(1);

      service.decrementPending();
      expect(service.getPendingCount()).toBe(0);
    });

    it('should track multiple pending operations', () => {
      const action = createPersistentAction('[Task] Update', 'TASK');

      service.incrementPending(action);
      service.incrementPending(action);
      service.incrementPending(action);
      expect(service.getPendingCount()).toBe(3);

      service.decrementPending();
      expect(service.getPendingCount()).toBe(2);

      service.decrementPending();
      service.decrementPending();
      expect(service.getPendingCount()).toBe(0);
    });

    it('should clamp at zero on underflow (decrement without matching increment)', () => {
      // Degenerate window: a decrement arrives with nothing pending. The counter
      // must stay at 0 so the flush signal never goes negative.
      service.decrementPending();
      expect(service.getPendingCount()).toBe(0);

      const action = createPersistentAction('[Task] Update', 'TASK');
      service.incrementPending(action);
      service.decrementPending();
      service.decrementPending();
      expect(service.getPendingCount()).toBe(0);
    });

    it('should reset the counter on clear', () => {
      const action = createPersistentAction('[Task] Update', 'TASK');
      service.incrementPending(action);
      service.incrementPending(action);
      expect(service.getPendingCount()).toBe(2);

      service.clear();
      expect(service.getPendingCount()).toBe(0);
    });
  });

  describe('extractEntityChanges', () => {
    it('should return empty entityChanges for regular actions', () => {
      const action = createPersistentAction(
        '[Task] Update Task',
        'TASK',
        'task-1',
        OpType.Update,
      );

      expect(service.extractEntityChanges(action)).toEqual([]);
    });

    it('should be a pure function (idempotent across repeated calls)', () => {
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

      const first = service.extractEntityChanges(action);
      const second = service.extractEntityChanges(action);
      expect(first).toEqual(second);
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

      const changes = service.extractEntityChanges(action);

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

      const changes = service.extractEntityChanges(action);

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

      const changes = service.extractEntityChanges(action);

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

      const changes = service.extractEntityChanges(action);

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

      const changes = service.extractEntityChanges(action);

      // Should return empty - not captured as syncTimeSpent
      expect(changes).toEqual([]);
    });
  });
});
