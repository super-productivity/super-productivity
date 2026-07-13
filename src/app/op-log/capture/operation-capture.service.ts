import { Injectable } from '@angular/core';
import { EntityChange, OpType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import { OpLog } from '../../core/log';
import { BatchedTimeSyncEntry } from '../../core/util/batched-time-sync-accumulator';

/**
 * Tracks how many local actions have been captured but not yet written to the
 * operation log, and computes the `entityChanges` payload for an action.
 *
 * ## Pending counter (replaces the former positional FIFO queue)
 *
 * The meta-reducer increments the counter synchronously when it captures a
 * local action; the persist effect decrements it in a `finally` after each
 * write attempt completes (success OR failure). `flushPendingWrites()` polls
 * `getPendingCount()` to know when every dispatched action has been processed.
 *
 * The previous implementation kept a FIFO of `EntityChange[]` correlated with
 * actions purely by position (meta-reducer `push`, effect `shift`). That
 * positional contract leaked an entry whenever a write threw before its
 * dequeue ran (e.g. a lock-acquisition timeout), permanently wedging the flush
 * — issue #8306. A plain counter decremented in a `finally` cannot leak.
 *
 * ## entityChanges extraction
 *
 * `extractEntityChanges()` is a pure function of the action — there is no state
 * diffing. It returns `[]` for every action except `TIME_TRACKING` and the
 * `[TimeTracking] Sync time spent` TASK action, whose reducers don't follow the
 * standard entity-adapter pattern. The field is kept on the wire (even as `[]`)
 * because the Android background provider reads `payload.entityChanges` for
 * reminder scheduling and the `isMultiEntityPayload` guard requires it; replay
 * and conflict detection use `actionPayload` / `meta.entityId` only.
 */
@Injectable({
  providedIn: 'root',
})
export class OperationCaptureService {
  /**
   * Warning threshold for the pending counter.
   * If the effect falls far behind the meta-reducer, log a warning.
   */
  private readonly PENDING_WARNING_THRESHOLD = 100;

  /**
   * Count of actions captured (incremented by the meta-reducer) but not yet
   * processed by the persist effect (decremented after each write attempt).
   */
  private pendingCount = 0;

  /**
   * Task-time actions update live task state before their operation is durable.
   * Keep those deltas visible to snapshot projection until the matching write
   * attempt completes, otherwise a snapshot can overlap its later tail op.
   */
  private pendingTaskTimeEntries = new Map<PersistentAction, BatchedTimeSyncEntry[]>();

  /**
   * Tracks if we've already warned about the pending counter growing large,
   * to avoid log spam.
   */
  private hasWarnedAboutPending = false;

  /**
   * Records that a local action has been captured and is awaiting persistence.
   * Called synchronously by the operation-capture meta-reducer.
   */
  incrementPending(action: PersistentAction): void {
    this.pendingCount++;
    const taskTimeEntry = this._getTaskTimeEntry(action);
    if (taskTimeEntry) {
      const entries = this.pendingTaskTimeEntries.get(action) ?? [];
      entries.push(taskTimeEntry);
      this.pendingTaskTimeEntries.set(action, entries);
    }

    // Warn if the counter is growing large (indicates the effect is not keeping up)
    if (
      this.pendingCount >= this.PENDING_WARNING_THRESHOLD &&
      !this.hasWarnedAboutPending
    ) {
      OpLog.warn(
        `OperationCaptureService: Pending count (${this.pendingCount}) exceeds warning threshold ` +
          `(${this.PENDING_WARNING_THRESHOLD}). Effect may not be processing operations.`,
      );
      this.hasWarnedAboutPending = true;
    }

    OpLog.verbose('OperationCaptureService: Captured action', {
      actionType: action.type,
      pendingCount: this.pendingCount,
    });
  }

  /**
   * Records that a captured action's write attempt has completed (success or
   * failure). Called from the persist effect's `finally`, so a thrown write —
   * e.g. a lock-acquisition timeout — can never leak a pending entry (#8306).
   */
  decrementPending(action?: PersistentAction): void {
    if (this.pendingCount <= 0) {
      // Underflow guard: a decrement with no matching increment. This is only
      // reachable in the degenerate window before the meta-reducer service is
      // wired (operations are dropped with a warning there). Clamp at 0 so the
      // flush signal stays correct.
      OpLog.warn(
        'OperationCaptureService: decrementPending called with no pending operations',
      );
      this.pendingCount = 0;
      return;
    }

    this.pendingCount--;
    if (action) {
      const entries = this.pendingTaskTimeEntries.get(action);
      if (entries?.length === 1) {
        this.pendingTaskTimeEntries.delete(action);
      } else if (entries && entries.length > 1) {
        entries.shift();
      }
    }

    // Reset warning flag once the backlog drains so we can warn again if it refills
    if (
      this.pendingCount < this.PENDING_WARNING_THRESHOLD &&
      this.hasWarnedAboutPending
    ) {
      this.hasWarnedAboutPending = false;
    }

    OpLog.verbose('OperationCaptureService: Processed action', {
      pendingCount: this.pendingCount,
    });
  }

  /**
   * Returns the number of captured actions still awaiting persistence.
   * Used by `flushPendingWrites()` to know when all writes have completed.
   */
  getPendingCount(): number {
    return this.pendingCount;
  }

  /** Returns task-time deltas that are captured but not yet durably written. */
  getPendingTaskTimeEntries(): BatchedTimeSyncEntry[] {
    const totals = new Map<string, BatchedTimeSyncEntry>();
    for (const entries of this.pendingTaskTimeEntries.values()) {
      for (const entry of entries) {
        const key = `${entry.id}\u0000${entry.date}`;
        const existing = totals.get(key);
        if (existing) {
          existing.duration += entry.duration;
        } else {
          totals.set(key, { ...entry });
        }
      }
    }
    return [...totals.values()];
  }

  /**
   * Resets the pending counter (for testing and error recovery).
   */
  clear(): void {
    this.pendingCount = 0;
    this.hasWarnedAboutPending = false;
    this.pendingTaskTimeEntries.clear();
  }

  private _getTaskTimeEntry(action: PersistentAction): BatchedTimeSyncEntry | undefined {
    if (
      action.type !== '[TimeTracking] Sync time spent' ||
      action.meta.entityType !== 'TASK'
    ) {
      return undefined;
    }

    const actionPayload = action as unknown as Record<string, unknown>;
    const taskId = actionPayload['taskId'];
    const date = actionPayload['date'];
    const duration = actionPayload['duration'];
    if (
      typeof taskId !== 'string' ||
      typeof date !== 'string' ||
      typeof duration !== 'number' ||
      !Number.isFinite(duration)
    ) {
      return undefined;
    }
    return { id: taskId, date, duration };
  }

  /**
   * Extracts entity changes from an action payload.
   *
   * For most actions, returns empty array (action payload is sufficient for sync).
   * TIME_TRACKING and TASK time sync need special handling because their reducers
   * don't follow the standard entity adapter pattern.
   *
   * Pure function of the action — safe to call from the write path and idempotent
   * across retries.
   */
  extractEntityChanges(action: PersistentAction): EntityChange[] {
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
        changes: {
          taskId,
          date,
          duration,
        },
      },
    ];
  }
}
