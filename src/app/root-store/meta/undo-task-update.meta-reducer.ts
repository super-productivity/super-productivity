import { Action } from '@ngrx/store';

import { RootState } from '../root-state';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { Task } from '../../features/tasks/task.model';
import { TaskSharedActions } from './task-shared.actions';
import { SnapshotPayload, SnapshotValue } from '../undo-redo/undo-redo.types';
import type { UndoPayloadBuilder } from './undo-operation-payload.meta-reducer';

export const TASK_UPDATE_UNDO_PAYLOAD_TYPE = 'TASK_UPDATE';

export interface TaskUpdateUndoPayload {
  type: typeof TASK_UPDATE_UNDO_PAYLOAD_TYPE;
  snapshot: SnapshotPayload & {
    previousValues: Record<string, SnapshotValue>;
  };
}

export const isTaskUpdateUndoPayload = (
  payload: unknown,
): payload is TaskUpdateUndoPayload => {
  if (!payload || typeof payload !== 'object') {
    return false;
  }

  const p = payload as Partial<TaskUpdateUndoPayload>;
  const previousValues = p.snapshot?.previousValues;
  return (
    p.type === TASK_UPDATE_UNDO_PAYLOAD_TYPE &&
    !!previousValues &&
    Object.keys(previousValues).length > 0 &&
    Object.values(previousValues).every(
      (entry) =>
        !!entry && typeof entry === 'object' && typeof entry.wasPresent === 'boolean',
    )
  );
};

export const taskUpdateUndoPayloadBuilder: UndoPayloadBuilder = {
  actionType: TaskSharedActions.updateTask.type,
  build: (state: RootState, action: Action) => {
    const { task } = action as ReturnType<typeof TaskSharedActions.updateTask>;
    const taskId = task.id as string | undefined;
    if (!taskId || !task.changes) {
      return null;
    }

    const currentTask = state[TASK_FEATURE_NAME].entities[taskId] as Task | undefined;
    if (!currentTask) {
      return null;
    }

    const previousValues: Record<string, SnapshotValue> = {};
    const currentTaskRecord = currentTask as Record<string, unknown>;
    for (const key of Object.keys(task.changes)) {
      if (key === 'modified') {
        continue;
      }

      previousValues[key] = {
        value: currentTaskRecord[key],
        wasPresent: Object.prototype.hasOwnProperty.call(currentTaskRecord, key),
      };
    }

    if (Object.keys(previousValues).length === 0) {
      return null;
    }

    return {
      type: TASK_UPDATE_UNDO_PAYLOAD_TYPE,
      snapshot: {
        previousValues,
      },
    };
  },
};
