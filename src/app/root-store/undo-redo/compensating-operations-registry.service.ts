import { Injectable, inject } from '@angular/core';
import { Update } from '@ngrx/entity';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import {
  ActionType,
  extractActionPayload,
  Operation,
} from '../../op-log/core/operation.types';
import { convertOpToAction } from '../../op-log/apply/operation-converter.util';
import { TaskSharedActions } from '../meta/task-shared.actions';
import { RootState } from '../root-state';
import {
  CompensatingOp,
  UndoRedoError,
  UndoRedoErrorCode,
  UndoRedoOperation,
  UndoRedoOperationType,
} from './undo-redo.types';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { selectTaskByIdWithSubTaskData } from '../../features/tasks/store/task.selectors';
import { isTaskDeleteUndoPayload } from '../meta/undo-task-delete.meta-reducer';
import { isTaskUpdateUndoPayload } from '../meta/undo-task-update.meta-reducer';
import { T } from '../../t.const';

interface CompensatingOpBuildResult {
  operation: UndoRedoOperation;
  compensatingOp: CompensatingOp;
}

type CompensatingHandler = (
  op: Operation,
  undoPayload?: unknown,
) => Promise<CompensatingOpBuildResult | UndoRedoError>;

interface SnapshotPreviousValuesResult {
  changes: Update<Task>['changes'];
  deleteFieldKeys: (keyof Task)[];
}

/**
 * Converts snapshot of previous values (with presence flags) into NgRx Update changes.
 * Fields that were not present are deleted after the normal entity update merge.
 */
const snapshotPreviousValuesToUpdate = (
  previousValues: Record<string, { value: unknown; wasPresent: boolean }>,
): SnapshotPreviousValuesResult => {
  const changes: Record<string, unknown> = {};
  const deleteFieldKeys: (keyof Task)[] = [];
  for (const [key, previousValue] of Object.entries(previousValues)) {
    if (previousValue.wasPresent) {
      changes[key] = previousValue.value;
    } else if (key !== 'id') {
      deleteFieldKeys.push(key as keyof Task);
    }
  }

  return {
    changes: changes as Update<Task>['changes'],
    deleteFieldKeys,
  };
};

/**
 * Registry for generating compensating operations and snackbar restore actions.
 *
 * Uses handler maps pattern to decouple operation type logic:
 * - _undoHandlers: ActionType → compensating op generator
 * - _restoreHandlers: ActionType → action reconstructor
 *
 * Supports: TASK_SHARED_ADD, TASK_ADD_SUB, TASK_SHARED_UPDATE, TASK_SHARED_DELETE
 */
@Injectable({
  providedIn: 'root',
})
export class CompensatingOperationsRegistry {
  private readonly _store = inject<Store<RootState>>(Store);

  /** Maps action types to undo handlers. Each handler generates the reverse operation. */
  private readonly _undoHandlers: Partial<Record<ActionType, CompensatingHandler>> = {
    [ActionType.TASK_SHARED_ADD]: (op) => this._compensateTaskCreate(op),
    [ActionType.TASK_ADD_SUB]: (op) => this._compensateSubTaskCreate(op),
    [ActionType.TASK_SHARED_UPDATE]: (op, undoPayload) =>
      this._compensateTaskUpdate(op, undoPayload),
    [ActionType.TASK_SHARED_DELETE]: (op, undoPayload) =>
      this._compensateTaskDelete(op, undoPayload),
  };

  /** Returns the compensating operation (undo) for a given operation. */
  async getCompensatingOp(
    op: Operation,
    undoPayload?: unknown,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const handler = this._undoHandlers[op.actionType];
    if (!handler) {
      return {
        code: UndoRedoErrorCode.UnsupportedOperation,
        message: `Undo is not supported for ${op.actionType}.`,
      };
    }

    return handler(op, undoPayload);
  }

  /** Reconstructs the original action from a stored operation for snackbar restore. */
  async convertOpToAction(op: Operation): Promise<Action | UndoRedoError> {
    if (!this.isUndoableActionType(op.actionType)) {
      return {
        code: UndoRedoErrorCode.UnsupportedOperation,
        message: `Restore is not supported for ${op.actionType}.`,
      };
    }

    return convertOpToAction(op);
  }

  isUndoableActionType(actionType: ActionType): boolean {
    return !!this._undoHandlers[actionType];
  }

  getSupportedActionTypes(): ActionType[] {
    return Object.keys(this._undoHandlers) as ActionType[];
  }

  /** Undo task creation by generating a delete compensation. */
  private async _compensateTaskCreate(
    op: Operation,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const task = this._extractTaskFromPayload(op.payload);
    if (!task) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot undo task creation without task payload.',
      };
    }

    return this._buildDeleteCompensation(op, task.id, T.G.UNDO_TASK_CREATION);
  }

  /** Undo subtask creation by generating a delete compensation.*/
  private async _compensateSubTaskCreate(
    op: Operation,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const task = payload.task as Task | undefined;
    const parentId = payload.parentId as string | undefined;

    if (!task?.id || !parentId) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot undo sub task creation without task and parent payload.',
      };
    }

    const parent = await this._getTaskWithSubTasks(parentId);
    if (!parent?.subTaskIds.includes(task.id)) {
      return {
        code: UndoRedoErrorCode.ValidationFailed,
        message: 'Cannot undo sub task creation because the parent changed.',
      };
    }

    return this._buildDeleteCompensation(op, task.id, T.G.UNDO_SUB_TASK_CREATION);
  }

  /** Helper to build a delete compensation action. Fetches current task state to include subtasks. */
  private async _buildDeleteCompensation(
    op: Operation,
    taskId: string,
    label: string,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const taskWithSubTasks = await this._getTaskWithSubTasks(taskId);
    if (!taskWithSubTasks?.id) {
      return {
        code: UndoRedoErrorCode.MissingEntity,
        message: 'Cannot undo task creation because the task no longer exists.',
      };
    }

    return this._buildResult({
      op,
      operationType: UndoRedoOperationType.Create,
      label,
      action: TaskSharedActions.deleteTask({ task: taskWithSubTasks }),
    });
  }

  /** Extracts task from operation payload. Shorthand for TASK_SHARED_ADD pattern. */
  private _extractTaskFromPayload(payload: unknown): Task | undefined {
    const actionPayload = extractActionPayload(payload);
    return actionPayload.task as Task | undefined;
  }

  /** Undo task update by reconstructing previous values from snapshot.*/
  private async _compensateTaskUpdate(
    op: Operation,
    undoPayload?: unknown,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const taskUpdate = payload.task as Update<Task> | undefined;

    if (!taskUpdate?.id) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot undo task update without task payload.',
      };
    }

    if (!isTaskUpdateUndoPayload(undoPayload)) {
      return {
        code: UndoRedoErrorCode.MissingSnapshot,
        message:
          'Cannot undo task update because the previous values snapshot is missing.',
      };
    }

    const taskId = String(taskUpdate.id);
    const currentTask = await this._getTaskWithSubTasks(taskId);
    if (!currentTask?.id) {
      return {
        code: UndoRedoErrorCode.MissingEntity,
        message: 'Cannot undo task update because the task no longer exists.',
      };
    }

    const { changes, deleteFieldKeys } = snapshotPreviousValuesToUpdate(
      undoPayload.snapshot.previousValues,
    );

    return this._buildResult({
      op,
      operationType: UndoRedoOperationType.Update,
      label: T.G.UNDO_TASK_UPDATE,
      action: TaskSharedActions.updateTask({
        task: {
          id: taskId,
          changes,
        } as Update<Task>,
        deleteFieldKeys,
        isIgnoreShortSyntax: true,
      }),
    });
  }

  /** Undo task deletion by generating a restore compensation.*/
  private _compensateTaskDelete(
    op: Operation,
    undoPayload?: unknown,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    if (!isTaskDeleteUndoPayload(undoPayload)) {
      return Promise.resolve({
        code: UndoRedoErrorCode.MissingSnapshot,
        message:
          'Cannot undo task deletion because the full restore snapshot is missing.',
      });
    }

    return Promise.resolve(
      this._buildResult({
        op,
        operationType: UndoRedoOperationType.Delete,
        label: T.G.UNDO_TASK_DELETION,
        action: TaskSharedActions.restoreDeletedTask(undoPayload.restorePayload),
      }),
    );
  }

  /** Factory method to build a compensating operation result from action and metadata. */
  private _buildResult({
    op,
    operationType,
    label,
    action,
  }: {
    op: Operation;
    operationType: UndoRedoOperationType;
    label: string;
    action: Action;
  }): CompensatingOpBuildResult {
    return {
      operation: {
        originalOperation: op,
        operationType,
        actionType: op.actionType,
        label,
      },
      compensatingOp: {
        originalOperationId: op.id,
        label,
        action,
      },
    };
  }

  /** Fetches task and all associated subtasks from store. Used for validating and rebuilding state. */
  private async _getTaskWithSubTasks(id: string): Promise<TaskWithSubTasks | undefined> {
    return firstValueFrom(
      this._store.select(selectTaskByIdWithSubTaskData, { id }).pipe(take(1)),
    );
  }
}
