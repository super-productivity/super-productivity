import { Action, ActionReducer } from '@ngrx/store';
import { TaskHistoryEnvelope } from '../../features/tasks/task-history/task-history.model';
import { isTaskHistoryEnvelope } from '../../features/tasks/task-history/task-history.validation';
import { readTaskHistoryDelivery } from '../../features/tasks/task-history/task-history-delivery';
import {
  collectTaskHistory,
  mergeTaskHistory,
  recordTaskHistoryGaps,
} from '../../features/tasks/task-history/task-history.util';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { getActiveTaskHistoryCapture } from '../../op-log/capture/task-history-capture';
import { isPersistentAction } from '../../op-log/core/persistent-action.interface';
import { isLwwUpdateActionType } from '../../op-log/core/lww-update-action-types';
import { isFullStateOpType } from '../../op-log/core/operation.types';
import { RootState } from '../root-state';

/** Wraps domain reducers so every real task mutation has the same coverage. */
export const taskHistoryMetaReducer =
  <S extends RootState>(reducer: ActionReducer<S>): ActionReducer<S> =>
  (state: S | undefined, action: Action): S => {
    const next = reducer(state, action);
    if (!state || !isPersistentAction(action)) return next;
    const before = state[TASK_FEATURE_NAME];
    const after = next[TASK_FEATURE_NAME];
    if (!before || !after) return next;

    let envelope: TaskHistoryEnvelope | undefined =
      action.meta.entityType === 'PLUGIN_USER_DATA'
        ? readTaskHistoryDelivery(action)
        : undefined;
    if (envelope) {
      // An immutable history delivery is a projection, not another task edit.
    } else if (action.meta.isRemote) {
      const value: unknown = action['taskHistory'];
      if (value !== undefined && !isTaskHistoryEnvelope(value)) {
        throw new Error('Invalid task history envelope');
      }
      envelope = value;
      // Synthetic LWW snapshots can change the projection while immutable author
      // facts arrive separately. They do not prove a missing user event.
      if (
        !envelope &&
        !isLwwUpdateActionType(action.type) &&
        !isFullStateOpType(action.meta.opType)
      ) {
        const taskHistory = recordTaskHistoryGaps(before, after);
        return taskHistory === after.taskHistory
          ? next
          : { ...next, [TASK_FEATURE_NAME]: { ...after, taskHistory } };
      }
    } else {
      const capture = getActiveTaskHistoryCapture(action);
      if (!capture || before.entities === after.entities) return next;
      envelope = collectTaskHistory(
        before,
        after,
        capture.operationId,
        capture.occurredAt,
        action.type,
      );
      capture.envelope = envelope;
    }
    if (!envelope) return next;
    const taskHistory = mergeTaskHistory(after.taskHistory, envelope);
    if (taskHistory === after.taskHistory) return next;
    return { ...next, [TASK_FEATURE_NAME]: { ...after, taskHistory } };
  };
