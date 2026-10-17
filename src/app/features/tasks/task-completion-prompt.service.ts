import { inject, Injectable } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Observable, of } from 'rxjs';
import { map, shareReplay } from 'rxjs/operators';
import { Task, TaskCopy } from './task.model';
import { TaskService } from './task.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DialogMarkTaskDoneComponent } from './dialog-mark-task-done/dialog-mark-task-done.component';
import {
  MarkTaskDoneDialogData,
  MarkTaskDoneDialogResult,
} from './dialog-mark-task-done/dialog-mark-task-done.model';

export interface TaskCompletionPromptOptions {
  isFromSchedule?: boolean;
  forcePrompt?: boolean;
}

@Injectable({
  providedIn: 'root',
})
export class TaskCompletionPromptService {
  private readonly _matDialog = inject(MatDialog);
  private readonly _taskService = inject(TaskService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  /**
   * Orchestrates task completion.
   * Checks scope guards: bypasses dialog and completes immediately if:
   * 1. Subtask (parentId != null)
   * 2. Recurring task (repeatCfgId != null) in MVP
   * 3. Config disabled (isPromptOnTaskDoneSchedule is false)
   * 4. Already scheduled task (dueWithTime exists) with matching or zero tracked time
   *    (unless completing from schedule view context where placement/duration confirmation is requested)
   *
   * Otherwise, opens DialogMarkTaskDoneComponent.
   * If confirmed, applies updates (dueWithTime, dueDay: undefined, timeEstimate) and calls taskService.setDone.
   * If cancelled, calls onCancel to revert any UI checkmark animation.
   */
  completeTask(
    task: Task,
    onCancel?: () => void,
    options?: TaskCompletionPromptOptions,
  ): Observable<boolean> {
    if (this._shouldBypassPrompt(task, options)) {
      this._taskService.setDone(task.id);
      return of(true);
    }

    const data: MarkTaskDoneDialogData = {
      taskId: task.id,
      taskTitle: task.title,
      timeSpent: task.timeSpent || 0,
      timeEstimate: task.timeEstimate || 0,
      currentScheduledTime: task.dueWithTime ?? null,
      dueDay: task.dueDay ?? null,
    };

    const dialogRef = this._matDialog.open(DialogMarkTaskDoneComponent, {
      data,
    });

    const result$ = dialogRef.afterClosed().pipe(
      map((res?: MarkTaskDoneDialogResult) => {
        if (res?.confirmed) {
          const updates: Partial<TaskCopy> = {
            dueWithTime: res.placement.dueWithTime,
            dueDay: undefined,
          };
          if (res.durationAdjustment) {
            updates.timeEstimate = res.durationAdjustment.newEstimateDurationMs;
          }
          this._taskService.update(task.id, updates);
          this._taskService.setDone(task.id);
          return true;
        } else {
          onCancel?.();
          return false;
        }
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    // Subscribe immediately so side effects execute even if caller does not subscribe
    result$.subscribe();

    return result$;
  }

  private _shouldBypassPrompt(
    task: Task,
    options?: TaskCompletionPromptOptions,
  ): boolean {
    if (task.isDone) {
      return true;
    }

    // 1. Subtasks bypass completely (US 24)
    if (task.parentId != null) {
      return true;
    }

    // 2. Recurring tasks bypass in MVP (US 25)
    if (task.repeatCfgId != null) {
      return true;
    }

    // 3. Config disabled (isPromptOnTaskDoneSchedule === false)
    const scheduleCfg =
      this._globalConfigService.cfg?.()?.schedule ??
      this._globalConfigService.timelineCfg?.();
    if (!scheduleCfg?.isPromptOnTaskDoneSchedule) {
      return true;
    }

    // 4. Already scheduled tasks
    if (task.dueWithTime != null) {
      if (options?.isFromSchedule) {
        // From schedule view: bypass only if tracked time matches non-zero estimate
        if (task.timeSpent > 0 && task.timeSpent === task.timeEstimate) {
          return true;
        }
        return false;
      }

      const timeSpent = task.timeSpent || 0;
      const timeEstimate = task.timeEstimate || 0;
      // Zero time tracked (US 26) or tracked matches estimate (US 27)
      if (timeSpent === 0 || timeSpent === timeEstimate) {
        return true;
      }
    }

    return false;
  }
}
