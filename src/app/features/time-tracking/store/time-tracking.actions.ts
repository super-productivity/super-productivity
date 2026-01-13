/* eslint-disable @typescript-eslint/naming-convention */
import { createAction, createActionGroup, props } from '@ngrx/store';
import { WorkContextType } from '../../work-context/work-context.model';
import { TimeTrackingState, TTWorkContextData } from '../time-tracking.model';
import { Task } from '../../tasks/task.model';
import { PersistentActionMeta } from '../../../op-log/core/persistent-action.interface';
import { OpType } from '../../../op-log/core/operation.types';

// Standalone persistent action for updating work context data (manual worklog edits)
export const updateWorkContextData = createAction(
  '[TimeTracking] Update Work Context Data',
  (actionProps: {
    ctx: { id: string; type: WorkContextType };
    date: string;
    updates: Partial<TTWorkContextData>;
  }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'TIME_TRACKING',
      entityId: `${actionProps.ctx.type}:${actionProps.ctx.id}:${actionProps.date}`,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

/**
 * Persistent action for syncing TIME_TRACKING session data to other clients.
 * Dispatched periodically (every 5 minutes) alongside syncTimeSpent.
 *
 * Uses action-payload capture (not state diffing) for efficient granular sync.
 */
export const syncTimeTracking = createAction(
  '[TimeTracking] Sync sessions',
  (actionProps: {
    contextType: 'TAG' | 'PROJECT';
    contextId: string;
    date: string;
    data: TTWorkContextData;
  }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'TIME_TRACKING',
      entityId: `${actionProps.contextType}:${actionProps.contextId}:${actionProps.date}`,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const TimeTrackingActions = createActionGroup({
  source: 'TimeTracking',
  events: {
    'Add time spent': props<{
      task: Task;
      date: string;
      duration: number;
      isFromTrackingReminder: boolean;
    }>(),
    'Update whole State': props<{
      newState: TimeTrackingState;
    }>(),
  },
});

/**
 * Persistent action for syncing accumulated time spent to other clients.
 * Dispatched every 5 minutes during active tracking and when tracking stops.
 *
 * Local dispatch: Ignored by reducer (state already updated by addTimeSpent ticks)
 * Remote dispatch: Applied to update timeSpentOnDay and timeTracking state
 */
export const syncTimeSpent = createAction(
  '[TimeTracking] Sync time spent',
  (actionProps: { taskId: string; date: string; duration: number }) => ({
    ...actionProps,
    meta: {
      isPersistent: true,
      entityType: 'TASK',
      entityId: actionProps.taskId,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);
