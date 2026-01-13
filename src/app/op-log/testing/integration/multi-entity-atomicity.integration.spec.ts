import { OperationCaptureService } from '../../capture/operation-capture.service';
import {
  PersistentAction,
  PersistentActionMeta,
} from '../../core/persistent-action.interface';
import { EntityType, OpType, EntityChange } from '../../core/operation.types';

/**
 * Operation Capture Integration Tests
 *
 * These tests verify that OperationCaptureService correctly captures entity
 * changes from action payloads.
 *
 * ARCHITECTURAL NOTE:
 * State diffing was removed for performance optimization. The capture service
 * now extracts entity changes directly from action payloads instead of
 * comparing before/after state.
 *
 * Entity changes are only computed for:
 * 1. TIME_TRACKING actions - because time tracking data is nested in context
 * 2. TASK time sync actions - because time is tracked per-task per-day
 *
 * For all other actions, the action payload itself contains all information
 * needed for sync replay, so no entity changes are computed.
 */
describe('Multi-Entity Atomicity Integration', () => {
  let service: OperationCaptureService;

  /**
   * Helper to compute entity changes using the service.
   */
  const computeChanges = (action: PersistentAction): EntityChange[] => {
    service.enqueue(action);
    return service.dequeue();
  };

  beforeEach(() => {
    service = new OperationCaptureService();
  });

  afterEach(() => {
    service.clear();
  });

  describe('standard action handling', () => {
    it('should return empty array for regular TASK actions (uses action payload for replay)', () => {
      const action: PersistentAction = {
        type: '[TaskShared] Update Task',
        task: { id: 'task-1', changes: { title: 'Updated' } },
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      // Regular task updates don't need entity changes - action payload is sufficient
      expect(changes).toEqual([]);
    });

    it('should return empty array for TAG actions', () => {
      const action: PersistentAction = {
        type: '[Tag] Update Tag',
        tag: { id: 'tag-1', changes: { title: 'Updated Tag' } },
        meta: {
          isPersistent: true,
          entityType: 'TAG' as EntityType,
          entityId: 'tag-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      expect(changes).toEqual([]);
    });

    it('should return empty array for PROJECT actions', () => {
      const action: PersistentAction = {
        type: '[Project] Update Project',
        project: { id: 'project-1', changes: { title: 'Updated Project' } },
        meta: {
          isPersistent: true,
          entityType: 'PROJECT' as EntityType,
          entityId: 'project-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      expect(changes).toEqual([]);
    });

    it('should return empty array for delete actions', () => {
      const action: PersistentAction = {
        type: '[TaskShared] Delete Task',
        task: { id: 'task-1' },
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Delete,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      expect(changes).toEqual([]);
    });
  });

  describe('TIME_TRACKING entity changes', () => {
    it('should capture entity changes for syncTimeTracking action', () => {
      const action: PersistentAction = {
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
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

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

    it('should capture entity changes for updateWorkContextData action', () => {
      const action: PersistentAction = {
        type: '[TimeTracking] Update Work Context Data',
        ctx: { id: 'tag-1', type: 'TAG' },
        date: '2024-01-15',
        updates: { field: 'value' },
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 'time-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      expect(changes.length).toBe(1);
      expect(changes[0].entityType).toBe('TIME_TRACKING');
      expect(changes[0].entityId).toBe('TAG:tag-1:2024-01-15');
    });

    it('should return empty array for unknown TIME_TRACKING action format', () => {
      const action: PersistentAction = {
        type: '[TimeTracking] Unknown Format',
        someField: 'value',
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 'time-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      expect(changes).toEqual([]);
    });
  });

  describe('TASK time sync entity changes', () => {
    it('should capture entity changes for syncTimeSpent action', () => {
      // Note: The actual action type is '[TimeTracking] Sync time spent'
      // with entityType 'TASK' - this syncs task time across clients
      const action: PersistentAction = {
        type: '[TimeTracking] Sync time spent',
        taskId: 'task-1',
        date: '2024-01-15',
        duration: 3600000,
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

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
  });

  describe('queue behavior', () => {
    it('should maintain FIFO order for multiple actions', () => {
      // Enqueue multiple TIME_TRACKING actions
      const action1: PersistentAction = {
        type: '[TimeTracking] Sync Time Tracking',
        contextType: 'PROJECT',
        contextId: 'p1',
        date: '2024-01-15',
        data: {},
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 't1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const action2: PersistentAction = {
        type: '[TimeTracking] Sync Time Tracking',
        contextType: 'TAG',
        contextId: 't1',
        date: '2024-01-16',
        data: {},
        meta: {
          isPersistent: true,
          entityType: 'TIME_TRACKING' as EntityType,
          entityId: 't2',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      service.enqueue(action1);
      service.enqueue(action2);

      expect(service.getQueueSize()).toBe(2);

      const changes1 = service.dequeue();
      expect(changes1[0].entityId).toBe('PROJECT:p1:2024-01-15');
      expect(service.getQueueSize()).toBe(1);

      const changes2 = service.dequeue();
      expect(changes2[0].entityId).toBe('TAG:t1:2024-01-16');
      expect(service.getQueueSize()).toBe(0);
    });
  });

  describe('architectural consistency', () => {
    /**
     * This test documents the architectural decision that state diffing
     * is not needed for most actions because:
     *
     * 1. Action payloads contain all information needed for replay
     * 2. Multi-entity changes are handled by meta-reducers atomically
     * 3. The sync replay uses extractActionPayload(), not entityChanges
     *
     * Entity changes are only needed for TIME_TRACKING and TASK time sync
     * because those have nested/composite data structures.
     */
    it('should NOT capture multi-entity changes - action payloads are used for replay', () => {
      // A "moveTask" action that affects TASK, TAG, and PROJECT
      const action: PersistentAction = {
        type: '[TaskShared] Move Task',
        task: { id: 'task-1' },
        targetProjectId: 'project-2',
        meta: {
          isPersistent: true,
          entityType: 'TASK' as EntityType,
          entityId: 'task-1',
          opType: OpType.Update,
        } satisfies PersistentActionMeta,
      };

      const changes = computeChanges(action);

      // Returns empty - all info for replay is in action.task, action.targetProjectId, etc.
      // The meta-reducers handle TAG and PROJECT updates atomically during replay
      expect(changes).toEqual([]);
    });
  });
});
