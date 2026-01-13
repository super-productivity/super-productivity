import { inject, Injectable } from '@angular/core';
import { select, Store } from '@ngrx/store';
import {
  addTaskRepeatCfgToTask,
  deleteTaskRepeatCfgs,
  updateTaskRepeatCfg,
  updateTaskRepeatCfgs,
  upsertTaskRepeatCfg,
  deleteTaskRepeatCfgInstance,
} from './store/task-repeat-cfg.actions';
import { Observable } from 'rxjs';
import {
  TaskRepeatCfg,
  TaskRepeatCfgCopy,
  TaskRepeatCfgState,
} from './task-repeat-cfg.model';
import { nanoid } from 'nanoid';
import { DialogConfirmComponent } from '../../ui/dialog-confirm/dialog-confirm.component';
import { MatDialog } from '@angular/material/dialog';
import { T } from '../../t.const';
import { first, take } from 'rxjs/operators';
import { firstValueFrom } from 'rxjs';
import { TaskService } from '../tasks/task.service';
import { Task } from '../tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { addSubTask } from '../tasks/store/task.actions';
import { WorkContextService } from '../work-context/work-context.service';
import { WorkContextType } from '../work-context/work-context.model';
import { isValidSplitTime } from '../../util/is-valid-split-time';
import { getDateTimeFromClockString } from '../../util/get-date-time-from-clock-string';
import { remindOptionToMilliseconds } from '../tasks/util/remind-option-to-milliseconds';
import { getNewestPossibleDueDate } from './store/get-newest-possible-due-date.util';
import { getDbDateStr } from '../../util/get-db-date-str';
import { isToday } from '../../util/is-today.util';
import { TODAY_TAG } from '../tag/tag.const';
import {
  selectAllTaskRepeatCfgs,
  selectTaskRepeatCfgById,
  selectTaskRepeatCfgByIdAllowUndefined,
  selectAllUnprocessedTaskRepeatCfgs,
  selectTaskRepeatCfgsForExactDay,
} from './store/task-repeat-cfg.selectors';
import { devError } from '../../util/dev-error';
import { getRepeatableTaskId } from './get-repeatable-task-id.util';

@Injectable({
  providedIn: 'root',
})
export class TaskRepeatCfgService {
  private _store$ = inject<Store<TaskRepeatCfgState>>(Store);
  private _matDialog = inject(MatDialog);
  private _taskService = inject(TaskService);
  private _workContextService = inject(WorkContextService);

  taskRepeatCfgs$: Observable<TaskRepeatCfg[]> = this._store$.pipe(
    select(selectAllTaskRepeatCfgs),
  );

  getRepeatableTasksForExactDay$(dayDate: number): Observable<TaskRepeatCfg[]> {
    // ===> taskRepeatCfgs where calculated due date matches the specified day
    return this._store$.select(selectTaskRepeatCfgsForExactDay, { dayDate });
  }

  getAllUnprocessedRepeatableTasks$(dayDate: number): Observable<TaskRepeatCfg[]> {
    // ===> taskRepeatCfgs scheduled for today and not yet created already
    return this._store$
      .select(selectAllUnprocessedTaskRepeatCfgs, { dayDate })
      .pipe(first());
  }

  getTaskRepeatCfgById$(id: string): Observable<TaskRepeatCfg> {
    return this._store$.select(selectTaskRepeatCfgById, { id });
  }

  getTaskRepeatCfgByIdAllowUndefined$(id: string): Observable<TaskRepeatCfg | undefined> {
    return this._store$.select(selectTaskRepeatCfgByIdAllowUndefined, { id });
  }

  addTaskRepeatCfgToTask(
    taskId: string,
    projectId: string | null,
    taskRepeatCfg: Omit<TaskRepeatCfgCopy, 'id'>,
  ): void {
    // Note: First occurrence calculation and lastTaskCreationDay update
    // is handled by the updateTaskAfterMakingItRepeatable$ effect (#5594)
    this._store$.dispatch(
      addTaskRepeatCfgToTask({
        taskRepeatCfg: {
          ...taskRepeatCfg,
          projectId,
          id: nanoid(),
        },
        taskId,
        startTime: taskRepeatCfg.startTime,
        remindAt: taskRepeatCfg.remindAt,
      }),
    );
  }

  async deleteTaskRepeatCfg(id: string): Promise<void> {
    // Gather task IDs to unlink - this ensures atomic sync
    const tasks = await firstValueFrom(this._taskService.getTasksByRepeatCfgId$(id));
    const taskIdsToUnlink = tasks.map((task) => task.id);

    this._store$.dispatch(
      TaskSharedActions.deleteTaskRepeatCfg({
        taskRepeatCfgId: id,
        taskIdsToUnlink,
      }),
    );
  }

  deleteTaskRepeatCfgsNoTaskCleanup(ids: string[]): void {
    this._store$.dispatch(deleteTaskRepeatCfgs({ ids }));
  }

  updateTaskRepeatCfg(
    id: string,
    changes: Partial<TaskRepeatCfg>,
    isUpdateAllTaskInstances: boolean = false,
  ): void {
    this._store$.dispatch(
      updateTaskRepeatCfg({
        taskRepeatCfg: { id, changes },
        isAskToUpdateAllTaskInstances: isUpdateAllTaskInstances,
      }),
    );
  }

  updateTaskRepeatCfgs(ids: string[], changes: Partial<TaskRepeatCfg>): void {
    this._store$.dispatch(updateTaskRepeatCfgs({ ids, changes }));
  }

  upsertTaskRepeatCfg(taskRepeatCfg: TaskRepeatCfg): void {
    this._store$.dispatch(upsertTaskRepeatCfg({ taskRepeatCfg }));
  }

  deleteTaskRepeatCfgInstance(repeatCfgId: string, dateStr: string): void {
    this._store$.dispatch(deleteTaskRepeatCfgInstance({ repeatCfgId, dateStr }));
  }

  async createRepeatableTask(
    taskRepeatCfg: TaskRepeatCfg,
    targetDayDate: number,
  ): Promise<void> {
    const actionsForRepeatCfg = await this._getActionsForTaskRepeatCfg(
      taskRepeatCfg,
      targetDayDate,
    );
    actionsForRepeatCfg.forEach((act) => {
      this._store$.dispatch(act);
    });
  }

  deleteTaskRepeatCfgWithDialog(id: string): void {
    this._matDialog
      .open(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.F.TASK_REPEAT.D_CONFIRM_REMOVE.MSG,
          okTxt: T.F.TASK_REPEAT.D_CONFIRM_REMOVE.OK,
        },
      })
      .afterClosed()
      .subscribe(async (isConfirm: boolean) => {
        if (isConfirm) {
          await this.deleteTaskRepeatCfg(id);
        }
      });
  }

  // NOTE: this is public for testing purposes only
  async _getActionsForTaskRepeatCfg(
    taskRepeatCfg: TaskRepeatCfg,
    targetDayDate: number = Date.now(),
  ): // NOTE: updateTaskRepeatCfg missing as there is no way to declare it as action type
  Promise<
    (
      | ReturnType<typeof TaskSharedActions.addTask>
      | ReturnType<typeof updateTaskRepeatCfg>
      | ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>
      | ReturnType<typeof addSubTask>
    )[]
  > {
    // NOTE: there might be multiple configs in case something went wrong
    // we want to move all of them to the archive
    const existingTaskInstances: Task[] = await this._taskService
      .getTasksWithSubTasksByRepeatCfgId$(taskRepeatCfg.id as string)
      .pipe(take(1))
      .toPromise();

    if (!taskRepeatCfg.id) {
      throw new Error('No taskRepeatCfg.id');
    }

    const targetCreated = getNewestPossibleDueDate(
      taskRepeatCfg,
      new Date(targetDayDate),
    );

    // there is no creation date in the present
    if (targetCreated === null) {
      // not sure if we should always expect one when this is called, so we throw a dev error for evaluation
      devError('No target creation date found for repeatable task');
      return [];
    } else if (!targetCreated) {
      throw new Error('Unable to getNewestPossibleDueDate()');
    }

    // IMPORTANT: compute the actual target day first and base all other checks on it.
    // Using Date.now() caused duplicates when generating overdue instances because "today"
    // differs from the repeat day we are about to create.
    const targetDateStr = getDbDateStr(targetCreated);

    // Generate the deterministic ID that would be used for this task.
    // This ensures both local dueDay check AND ID check prevent duplicates.
    const expectedTaskId = getRepeatableTaskId(taskRepeatCfg.id, targetDateStr);

    // Check if a task already exists with this deterministic ID or dueDay.
    // The ID check handles cases where another device created the task but it hasn't
    // fully synced yet (the task exists locally but dueDay might differ during migration).
    const taskAlreadyExists = existingTaskInstances.some((taskI) => {
      const existingDateStr = taskI.dueDay || getDbDateStr(taskI.created);
      return taskI.id === expectedTaskId || existingDateStr === targetDateStr;
    });

    if (taskAlreadyExists) {
      return [];
    }
    // Check if this date is in the deleted instances list
    // NOTE: needs to run after deriving targetDateStr so deletions for overdue instances work.
    if (taskRepeatCfg.deletedInstanceDates?.includes(targetDateStr)) {
      return [];
    }

    const { task, isAddToBottom } = this._getTaskRepeatTemplate(
      taskRepeatCfg,
      targetDateStr,
    );
    const taskWithTargetDates: Task = {
      ...task,
      // NOTE if moving this to top isCreateNew check above would not work as intended
      // we use created also for the repeat day label for past tasks
      created: targetCreated.getTime(),
    };

    const createNewActions: (
      | ReturnType<typeof TaskSharedActions.addTask>
      | ReturnType<typeof updateTaskRepeatCfg>
      | ReturnType<typeof TaskSharedActions.scheduleTaskWithTime>
      | ReturnType<typeof addSubTask>
    )[] = [
      TaskSharedActions.addTask({
        task: taskWithTargetDates,
        workContextType: this._workContextService
          .activeWorkContextType as WorkContextType,
        workContextId: this._workContextService.activeWorkContextId as string,
        isAddToBacklog: false,
        isAddToBottom,
      }),
      updateTaskRepeatCfg({
        taskRepeatCfg: {
          id: taskRepeatCfg.id,
          changes: {
            lastTaskCreation: targetCreated.getTime(),
            lastTaskCreationDay: getDbDateStr(targetCreated),
          },
        },
      }),
    ];

    // Schedule if given
    if (isValidSplitTime(taskRepeatCfg.startTime) && taskRepeatCfg.remindAt) {
      // NOTE: schedule tasks against the computed repeat day to avoid mismatched due dates.
      const dateTime = getDateTimeFromClockString(
        taskRepeatCfg.startTime as string,
        targetCreated.getTime(),
      );
      createNewActions.push(
        TaskSharedActions.scheduleTaskWithTime({
          task: taskWithTargetDates,
          dueWithTime: dateTime,
          remindAt: remindOptionToMilliseconds(dateTime, taskRepeatCfg.remindAt),
          isMoveToBacklog: false,
          // Only keep in today list if scheduled for today (#5594)
          isSkipAutoRemoveFromToday: isToday(dateTime),
        }),
      );
    }

    if (
      taskRepeatCfg.shouldInheritSubtasks &&
      taskRepeatCfg.subTaskTemplates &&
      taskRepeatCfg.subTaskTemplates.length > 0
    ) {
      for (const subTask of taskRepeatCfg.subTaskTemplates) {
        const newSubTask = this._taskService.createNewTaskWithDefaults({
          title: subTask.title,
          additional: {
            notes: subTask.notes ?? '',
            timeEstimate: subTask.timeEstimate ?? 0,
            parentId: task.id,
            projectId: taskRepeatCfg.projectId || undefined,
            isDone: false, // Always start fresh
          },
        });

        createNewActions.push(
          addSubTask({
            task: newSubTask,
            parentId: task.id,
          }),
        );
      }
    }

    return createNewActions;
  }

  private _getTaskRepeatTemplate(
    taskRepeatCfg: TaskRepeatCfg,
    dueDay: string,
  ): {
    task: Task;
    isAddToBottom: boolean;
  } {
    const taskId = getRepeatableTaskId(taskRepeatCfg.id, dueDay);
    return {
      task: this._taskService.createNewTaskWithDefaults({
        title: taskRepeatCfg.title,
        id: taskId,
        additional: {
          repeatCfgId: taskRepeatCfg.id,
          timeEstimate: taskRepeatCfg.defaultEstimate || 0,
          projectId: taskRepeatCfg.projectId || undefined,
          notes: taskRepeatCfg.notes || '',
          dueDay,
          tagIds: taskRepeatCfg.tagIds.filter((tagId) => tagId !== TODAY_TAG.id),
        },
      }),
      isAddToBottom: taskRepeatCfg.order > 0,
    };
  }
}
