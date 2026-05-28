import { Injectable, inject } from '@angular/core';
import { Update } from '@ngrx/entity';
import { Action, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { take } from 'rxjs/operators';

import { ActionType, Operation } from '../../op-log/core/operation.types';
import { addSubTask } from '../../features/tasks/store/task.actions';
import { TaskSharedActions } from '../meta/task-shared.actions';
import { RootState } from '../root-state';
import { WorkContextType } from '../../features/work-context/work-context.model';
import {
  CompensatingOp,
  UndoRedoError,
  UndoRedoErrorCode,
  UndoRedoOperation,
  UndoRedoOperationType,
} from './undo-redo.types';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { selectTaskByIdWithSubTaskData } from '../../features/tasks/store/task.selectors';
import { UNDO_OPERATION_PAYLOAD_KEY } from '../meta/undo-operation-payload.meta-reducer';
import { isTaskDeleteUndoPayload } from '../meta/undo-task-delete.meta-reducer';
import { isTaskUpdateUndoPayload } from '../meta/undo-task-update.meta-reducer';

interface CompensatingOpBuildResult {
  operation: UndoRedoOperation;
  compensatingOp: CompensatingOp;
}

type CompensatingHandler = (
  op: Operation,
) => Promise<CompensatingOpBuildResult | UndoRedoError>;

type RedoHandler = (op: Operation) => Promise<Action | UndoRedoError>;

/**
 * Extracts the action payload from an operation payload structure.
 * Handles both wrapped format (MultiEntityPayload with actionPayload field)
 * and direct payload format (raw action properties).
 */
const extractActionPayload = (payload: unknown): Record<string, unknown> => {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const p = payload as Record<string, unknown>;
  if ('actionPayload' in p && p.actionPayload && typeof p.actionPayload === 'object') {
    return p.actionPayload as Record<string, unknown>;
  }

  return p;
};

/**
 * Converts snapshot of previous values (with presence flags) into NgRx Update changes.
 * Fields that were not present are set to undefined to ensure deletion on redo.
 */
const snapshotPreviousValuesToChanges = (
  previousValues: Record<string, { value: unknown; wasPresent: boolean }>,
): Update<Task>['changes'] => {
  const changes: Record<string, unknown> = {};
  for (const [key, previousValue] of Object.entries(previousValues)) {
    changes[key] = previousValue.wasPresent ? previousValue.value : undefined;
  }

  return changes as Update<Task>['changes'];
};

/**
 * Registry for generating compensating operations (undo/redo transformations).
 *
 * Uses handler maps pattern to decouple operation type logic:
 * - _undoHandlers: ActionType → compensating op generator
 * - _redoHandlers: ActionType → action reconstructor
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
    [ActionType.TASK_SHARED_UPDATE]: (op) => this._compensateTaskUpdate(op),
    [ActionType.TASK_SHARED_DELETE]: (op) => this._compensateTaskDelete(op),
  };

  /** Maps action types to redo handlers. Each handler reconstructs the original action from stored operation. */
  private readonly _redoHandlers: Partial<Record<ActionType, RedoHandler>> = {
    [ActionType.TASK_SHARED_ADD]: (op) => this._redoTaskCreate(op),
    [ActionType.TASK_ADD_SUB]: (op) => this._redoSubTaskCreate(op),
    [ActionType.TASK_SHARED_UPDATE]: (op) => this._redoTaskUpdate(op),
    [ActionType.TASK_SHARED_DELETE]: (op) => this._redoTaskDelete(op),
  };

  /** Returns the compensating operation (undo) for a given operation. */
  async getCompensatingOp(
    op: Operation,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const handler = this._undoHandlers[op.actionType];
    if (!handler) {
      return {
        code: UndoRedoErrorCode.UnsupportedOperation,
        message: `Undo is not supported for ${op.actionType}.`,
      };
    }

    return handler(op);
  }

  /** Reconstructs the original action from a stored operation (for redo). */
  async convertOpToAction(op: Operation): Promise<Action | UndoRedoError> {
    const handler = this._redoHandlers[op.actionType];
    if (!handler) {
      return {
        code: UndoRedoErrorCode.UnsupportedOperation,
        message: `Redo is not supported for ${op.actionType}.`,
      };
    }

    return handler(op);
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

    return this._buildDeleteCompensation(op, task.id, 'Undo task creation');
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

    return this._buildDeleteCompensation(op, task.id, 'Undo sub task creation');
  }

  /** Redo task creation by reconstructing the original add action. */
  private async _redoTaskCreate(op: Operation): Promise<Action | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const task = payload.task as Task | undefined;
    if (!task) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot redo task creation without task payload.',
      };
    }

    return TaskSharedActions.addTask({
      task,
      workContextId: (payload.workContextId as string | undefined) ?? 'TODAY',
      workContextType: payload.workContextType as WorkContextType,
      isAddToBacklog: (payload.isAddToBacklog as boolean | undefined) ?? false,
      isAddToBottom: (payload.isAddToBottom as boolean | undefined) ?? false,
    });
  }

  /** Redo subtask creation by reconstructing the original add action.*/
  private async _redoSubTaskCreate(op: Operation): Promise<Action | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const task = payload.task as Task | undefined;
    const parentId = payload.parentId as string | undefined;
    if (!task?.id || !parentId) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot redo sub task creation without task and parent payload.',
      };
    }

    return addSubTask({
      task,
      parentId,
    });
  }

  /** Redo task update by reconstructing the original update action. */
  private async _redoTaskUpdate(op: Operation): Promise<Action | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const taskUpdate = payload.task as Update<Task> | undefined;
    if (!taskUpdate?.id) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot redo task update without task payload.',
      };
    }

    const taskId = String(taskUpdate.id);

    return TaskSharedActions.updateTask({
      task: {
        id: taskId,
        changes: taskUpdate.changes,
      } as Update<Task>,
      isIgnoreShortSyntax: payload.isIgnoreShortSyntax as boolean | undefined,
    });
  }

  /** Redo task deletion by reconstructing the original delete action. */
  private async _redoTaskDelete(op: Operation): Promise<Action | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const task = payload.task as Task | undefined;
    if (!task?.id) {
      return {
        code: UndoRedoErrorCode.MissingPayload,
        message: 'Cannot redo task deletion without task payload.',
      };
    }

    const currentTask = await this._getTaskWithSubTasks(task.id);
    if (!currentTask?.id) {
      return {
        code: UndoRedoErrorCode.MissingEntity,
        message: 'Cannot redo task deletion because the task no longer exists.',
      };
    }

    return TaskSharedActions.deleteTask({ task: currentTask });
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
        message: `Cannot undo ${label.toLowerCase()} because the task no longer exists.`,
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
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const taskUpdate = payload.task as Update<Task> | undefined;
    const undoPayload = payload[UNDO_OPERATION_PAYLOAD_KEY];

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

    return this._buildResult({
      op,
      operationType: UndoRedoOperationType.Update,
      label: 'Undo task update',
      action: TaskSharedActions.updateTask({
        task: {
          id: taskId,
          changes: snapshotPreviousValuesToChanges(undoPayload.snapshot.previousValues),
        } as Update<Task>,
        isIgnoreShortSyntax: true,
      }),
    });
  }

  /** Undo task deletion by generating a restore compensation.*/
  private _compensateTaskDelete(
    op: Operation,
  ): Promise<CompensatingOpBuildResult | UndoRedoError> {
    const payload = extractActionPayload(op.payload);
    const undoPayload = payload[UNDO_OPERATION_PAYLOAD_KEY];

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
        label: 'Undo task deletion',
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
