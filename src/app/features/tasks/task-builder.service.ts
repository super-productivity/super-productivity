import { inject, Injectable } from '@angular/core';
import { TaskService } from './task.service';
import { TaskRepeatCfgService } from '../task-repeat-cfg/task-repeat-cfg.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DateService } from '../../core/date/date.service';
import { MatDialog } from '@angular/material/dialog';
import { QuickAddTaskPayload } from '../../../../electron/shared-with-frontend/quick-add-task-payload.model';
import { DEFAULT_TASK_REPEAT_CFG } from '../task-repeat-cfg/task-repeat-cfg.model';
import { first, timeout } from 'rxjs/operators';
import { Log } from '../../core/log';
import { T } from '../../t.const';
import { SnackService } from '../../core/snack/snack.service';
import { TaskReminderOptionId } from './task.model';

@Injectable({
  providedIn: 'root',
})
export class TaskBuilderService {
  private _taskService = inject(TaskService);
  private _taskRepeatCfgService = inject(TaskRepeatCfgService);
  private _configService = inject(GlobalConfigService);
  private _dateService = inject(DateService);
  private _matDialog = inject(MatDialog);
  private _snackService = inject(SnackService);

  addTaskWithStuff(payload: QuickAddTaskPayload): string {
    const taskId = this._taskService.add(
      payload.title,
      payload.isAddToBacklog,
      payload.taskData,
      payload.isAddToBottom,
    );

    const isTimedRepeatTask =
      !!payload.repeatQuickSetting &&
      payload.repeatQuickSetting !== 'CUSTOM' &&
      (!!payload.taskData.dueWithTime || !!payload.repeatCfg?.startTime);

    if (payload.taskData.dueWithTime && !isTimedRepeatTask) {
      this._taskService
        .getByIdOnce$(taskId)
        .pipe(first())
        .subscribe((task) => {
          this._taskService.scheduleTask(
            task,
            payload.taskData.dueWithTime!,
            payload.remindOption || TaskReminderOptionId.DoNotRemind,
            payload.isAddToBacklog,
          );
        });
    }

    if (payload.repeatQuickSetting) {
      if (payload.repeatQuickSetting === 'CUSTOM') {
        // We might need to focus the app first if this comes from IPC
        // This is handled in shortcut.service.ts via window.ea.showOrFocus()
        this._openRepeatDialogForTask(
          taskId,
          payload.remindOption || TaskReminderOptionId.DoNotRemind,
        );
      } else if (payload.repeatCfg) {
        this._taskRepeatCfgService.addTaskRepeatCfgToTask(
          taskId,
          payload.taskData.projectId || null,
          {
            ...DEFAULT_TASK_REPEAT_CFG,
            ...payload.repeatCfg,
          },
        );
      }
    }

    return taskId;
  }

  private _openRepeatDialogForTask(
    taskId: string,
    remindOption: TaskReminderOptionId,
  ): void {
    this._taskService
      .getByIdOnce$(taskId)
      .pipe(timeout(1000))
      .subscribe({
        next: async (task) => {
          const { DialogEditTaskRepeatCfgComponent } =
            await import('../task-repeat-cfg/dialog-edit-task-repeat-cfg/dialog-edit-task-repeat-cfg.component');
          this._matDialog.open(DialogEditTaskRepeatCfgComponent, {
            data: { task, defaultRemindOption: remindOption },
          });
        },
        error: (err) => {
          Log.error('Failed to open repeat dialog', err);
          this._snackService.open({
            type: 'ERROR',
            msg: T.F.TASK_REPEAT.SNACK_REPEAT_DIALOG_FAIL,
          });
        },
      });
  }
}
