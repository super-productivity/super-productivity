import { Injectable } from '@angular/core';
import { EntityChange, OpType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import { OpLog } from '../../core/log';

/**
 * Captures action payloads and queues them for persistence using a simple FIFO queue.
 *
 * PERFORMANCE OPTIMIZATION: This service no longer performs expensive state diffing.
 * Instead, it relies on action payloads and meta.entityId/entityIds for sync.
 *
 * The entityChanges computed here are for backward compatibility with the operation
 * log format. The actual replay uses action payloads (extractActionPayload), and
 * conflict detection uses meta.entityId from the action.
 *
 * Flow:
 * 1. Meta-reducer calls `enqueue()` with the action
 * 2. Service queues entity changes (empty for most actions, extracted for TIME_TRACKING)
 * 3. Effect calls `dequeue()` to retrieve changes for persistence (FIFO order)
 *
 * The FIFO queue works because:
 * - NgRx reducers process actions sequentially
 * - Effect uses concatMap for sequential processing
 * - Order is preserved between enqueue and dequeue
 */
@Injectable({
  providedIn: 'root',
})
export class OperationCaptureService {
  /**
   * Warning threshold for queue size.
   * If effects fail to dequeue, we log a warning.
   */
  private readonly QUEUE_WARNING_THRESHOLD = 100;

  /**
   * FIFO queue of pending entity changes.
   */
  private queue: EntityChange[][] = [];

  /**
   * Tracks if we've already warned about queue overflow to avoid log spam.
   */
  private hasWarnedAboutQueueSize = false;

  /**
   * Enqueues entity changes for an action.
   * Called synchronously by the operation-capture meta-reducer.
   *
   * For most actions, this queues empty entityChanges (the action payload is sufficient).
   * For TIME_TRACKING and TASK time sync, it extracts changes from the action payload.
   */
  enqueue(action: PersistentAction): void {
    const entityChanges = this._extractEntityChanges(action);

    // Warn if queue is growing large (indicates potential processing issue)
    if (
      this.queue.length >= this.QUEUE_WARNING_THRESHOLD &&
      !this.hasWarnedAboutQueueSize
    ) {
      OpLog.warn(
        `OperationCaptureService: Queue size (${this.queue.length}) exceeds warning threshold ` +
          `(${this.QUEUE_WARNING_THRESHOLD}). Effects may not be processing operations.`,
      );
      this.hasWarnedAboutQueueSize = true;
    }

    this.queue.push(entityChanges);

    OpLog.verbose('OperationCaptureService: Enqueued operation', {
      actionType: action.type,
      changeCount: entityChanges.length,
      queueSize: this.queue.length,
    });
  }

  /**
   * Dequeues the next batch of entity changes (FIFO).
   * Called by the effect to retrieve pre-computed changes for persistence.
   */
  dequeue(): EntityChange[] {
    const entityChanges = this.queue.shift();

    if (entityChanges === undefined) {
      OpLog.warn('OperationCaptureService: No queued operation found');
      return [];
    }

    // Reset warning flag when queue drains below threshold so we can warn again if it fills up
    if (
      this.queue.length < this.QUEUE_WARNING_THRESHOLD &&
      this.hasWarnedAboutQueueSize
    ) {
      this.hasWarnedAboutQueueSize = false;
    }

    OpLog.verbose('OperationCaptureService: Dequeued operation', {
      changeCount: entityChanges.length,
      queueSize: this.queue.length,
    });

    return entityChanges;
  }

  /**
   * Gets the current queue size (for monitoring).
   */
  getQueueSize(): number {
    return this.queue.length;
  }

  /**
   * Peeks at pending operations without removing them (for diagnostics).
   * Returns a flat list of all entity changes in the queue.
   */
  peekPendingOperations(): EntityChange[] {
    return this.queue.flat();
  }

  /**
   * Clears all queued operations (for testing).
   */
  clear(): void {
    this.queue = [];
    this.hasWarnedAboutQueueSize = false;
  }

  /**
   * Extracts entity changes from action payload.
   *
   * For most actions, returns empty array (action payload is sufficient for sync).
   * TIME_TRACKING and TASK time sync need special handling because their reducers
   * don't follow the standard entity adapter pattern.
   */
  private _extractEntityChanges(action: PersistentAction): EntityChange[] {
    // TIME_TRACKING: Extract from action payload
    if (action.meta.entityType === 'TIME_TRACKING') {
      return this._captureTimeTrackingFromAction(action);
    }

    // TASK time sync (syncTimeSpent): Extract from action payload
    // The reducer is a no-op locally (state already updated by addTimeSpent ticks),
    // so we capture from the action payload instead.
    // Use explicit action type check to avoid false matches with future TASK actions
    // that might have taskId, date, duration fields.
    if (
      action.type === '[TimeTracking] Sync time spent' &&
      action.meta.entityType === 'TASK'
    ) {
      return this._captureTaskTimeSyncFromAction(action);
    }

    // For all other actions, return empty entityChanges.
    // The action payload (stored in operation.payload.actionPayload) contains
    // everything needed for replay, and meta.entityId/entityIds are used for
    // conflict detection.
    return [];
  }

  /**
   * Captures TIME_TRACKING changes from action payload.
   * This is more efficient than state diffing for the nested TIME_TRACKING structure.
   *
   * Supports both syncTimeTracking and updateWorkContextData actions.
   */
  private _captureTimeTrackingFromAction(action: PersistentAction): EntityChange[] {
    // syncTimeTracking action: { contextType, contextId, date, data }
    if (
      'contextType' in action &&
      'contextId' in action &&
      'date' in action &&
      'data' in action
    ) {
      const { contextType, contextId, date, data } = action as unknown as {
        contextType: 'TAG' | 'PROJECT';
        contextId: string;
        date: string;
        data: unknown;
      };
      return [
        {
          entityType: 'TIME_TRACKING',
          entityId: `${contextType}:${contextId}:${date}`,
          opType: OpType.Update,
          changes: { contextType, contextId, date, data },
        },
      ];
    }

    // updateWorkContextData action: { ctx: { id, type }, date, updates }
    if ('ctx' in action && 'date' in action && 'updates' in action) {
      const { ctx, date, updates } = action as unknown as {
        ctx: { id: string; type: string };
        date: string;
        updates: unknown;
      };
      return [
        {
          entityType: 'TIME_TRACKING',
          entityId: `${ctx.type}:${ctx.id}:${date}`,
          opType: OpType.Update,
          changes: { ctx, date, updates },
        },
      ];
    }

    OpLog.warn('OperationCaptureService: Unknown TIME_TRACKING action format', {
      actionType: action.type,
    });
    return [];
  }

  /**
   * Captures TASK time sync changes from syncTimeSpent action payload.
   * The local reducer is a no-op (state already updated by addTimeSpent ticks),
   * so we capture from the action payload instead of state diffing.
   */
  private _captureTaskTimeSyncFromAction(action: PersistentAction): EntityChange[] {
    const { taskId, date, duration } = action as unknown as {
      taskId: string;
      date: string;
      duration: number;
    };

    return [
      {
        entityType: 'TASK',
        entityId: taskId,
        opType: OpType.Update,
        changes: { taskId, date, duration },
      },
    ];
  }
}
