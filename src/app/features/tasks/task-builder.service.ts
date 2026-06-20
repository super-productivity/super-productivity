import { inject, Injectable } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { first, timeout } from 'rxjs/operators';
import { MatDialog } from '@angular/material/dialog';
import {
  DEFAULT_TASK_REPEAT_CFG,
  TaskRepeatCfgCopy,
} from '../task-repeat-cfg/task-repeat-cfg.model';
import { SnackService } from '../../core/snack/snack.service';
import { Log } from '../../core/log';
import { T } from '../../t.const';
import { TaskReminderOptionId } from './task.model';
import { TaskService } from './task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { IS_ELECTRON } from '../../app.constants';
import { TagService } from '../tag/tag.service';
import { unique } from '../../util/unique';
import type { AddTaskPayload } from './add-task-bar/add-task-payload-builder';
import { isQuickAddWindowMode } from '../../util/is-quick-add-window-mode';

@Injectable({
  providedIn: 'root',
})
export class TaskBuilderService {
  private readonly _taskService = inject(TaskService);
  private readonly _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private readonly _tagService = inject(TagService);
  private readonly _matDialog = inject(MatDialog);
  private readonly _snackService = inject(SnackService);

  addTask(payload: AddTaskPayload): string | Promise<string> {
    if (IS_ELECTRON && isQuickAddWindowMode()) {
      return this._addTaskViaMainWindow(payload);
    }

    return this._addTaskLocally(payload);
  }

  private _addTaskLocally(payload: AddTaskPayload): string {
    const taskData = this._createNewTagsAndMergeTaskData(payload);
    const taskId = this._taskService.add(
      payload.title,
      payload.isAddToBacklog,
      taskData,
      payload.isAddToBottom,
    );

    const resolvedRemindOption = payload.remindOption;
    const isTimedRepeatTask =
      !!payload.repeatQuickSetting &&
      payload.repeatQuickSetting !== 'CUSTOM' &&
      (!!taskData.dueWithTime || !!payload.repeatCfg?.startTime);

    if (taskData.dueWithTime && !isTimedRepeatTask) {
      this._taskService
        .getByIdOnce$(taskId)
        .pipe(first(), timeout(1000))
        .subscribe((task) => {
          this._taskService.scheduleTask(
            task,
            taskData.dueWithTime!,
            resolvedRemindOption,
            payload.isAddToBacklog,
          );
        });
    }

    if (payload.repeatQuickSetting) {
      if (payload.repeatQuickSetting === 'CUSTOM') {
        this._openRepeatDialogForTask(taskId, resolvedRemindOption);
      } else if (payload.repeatCfg) {
        const repeatCfg = buildTaskRepeatCfg(payload.repeatCfg);
        this._taskRepeatCfgService.addTaskRepeatCfgToTask(
          taskId,
          taskData.projectId || null,
          repeatCfg,
        );
      }
    }

    return taskId;
  }

  private async _addTaskViaMainWindow(payload: AddTaskPayload): Promise<string> {
    const result = await window.ea.submitQuickAddTask(payload);
    if (result.ok) {
      return result.taskId;
    }

    this._snackService.open({
      type: 'ERROR',
      msg: result.error,
    });
    throw new Error(result.error);
  }

  private _createNewTagsAndMergeTaskData(
    payload: AddTaskPayload,
  ): AddTaskPayload['taskData'] {
    if (!payload.newTagTitles?.length) {
      return payload.taskData;
    }

    const newTagIds = payload.newTagTitles.map((title) =>
      this._tagService.addTag({ title }),
    );
    return {
      ...payload.taskData,
      tagIds: unique([...(payload.taskData.tagIds ?? []), ...newTagIds]),
    };
  }

  private _openRepeatDialogForTask(
    taskId: string,
    remindOption: TaskReminderOptionId,
  ): void {
    void firstValueFrom(
      this._taskService.getByIdOnce$(taskId).pipe(first(), timeout(1000)),
    )
      .then(async (task) => {
        if (IS_ELECTRON) {
          window.ea.showOrFocus();
        }
        const { DialogEditTaskRepeatCfgComponent } =
          await import('../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component');
        this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
          data: { task, defaultRemindOption: remindOption },
        });
      })
      .catch((err) => {
        Log.error('Failed to open repeat dialog', err);
        this._snackService.open({
          type: 'ERROR',
          msg: T.F.TASK_REPEAT.SNACK_REPEAT_DIALOG_FAIL,
        });
      });
  }
}

const buildTaskRepeatCfg = (
  repeatCfg: Partial<TaskRepeatCfgCopy>,
): Omit<TaskRepeatCfgCopy, 'id'> => ({
  ...DEFAULT_TASK_REPEAT_CFG,
  ...repeatCfg,
  title: repeatCfg.title ?? DEFAULT_TASK_REPEAT_CFG.title,
  tagIds: repeatCfg.tagIds ?? DEFAULT_TASK_REPEAT_CFG.tagIds,
  quickSetting: repeatCfg.quickSetting ?? DEFAULT_TASK_REPEAT_CFG.quickSetting,
  repeatCycle: repeatCfg.repeatCycle ?? DEFAULT_TASK_REPEAT_CFG.repeatCycle,
  repeatEvery: repeatCfg.repeatEvery ?? DEFAULT_TASK_REPEAT_CFG.repeatEvery,
  isPaused: repeatCfg.isPaused ?? DEFAULT_TASK_REPEAT_CFG.isPaused,
  order: repeatCfg.order ?? DEFAULT_TASK_REPEAT_CFG.order,
  projectId: repeatCfg.projectId ?? DEFAULT_TASK_REPEAT_CFG.projectId,
  notes: repeatCfg.notes ?? DEFAULT_TASK_REPEAT_CFG.notes,
});
