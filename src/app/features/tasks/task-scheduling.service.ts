import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { Task, TaskReminderOptionId, TaskWithSubTasks } from './task.model';
import { TaskService } from './task.service';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { remindOptionToMilliseconds } from './util/remind-option-to-milliseconds';

/**
 * Scheduling a task with a due time and reminder. Thin wrappers around the
 * `TaskSharedActions` schedule actions; `addAndSchedule` adds via `TaskService` first.
 */
@Injectable({
  providedIn: 'root',
})
export class TaskSchedulingService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  async addAndSchedule(
    title: string | null,
    additional: Partial<Task> = {},
    due: number,
    remindCfg?: TaskReminderOptionId,
    isIgnoreShortSyntax = false,
  ): Promise<string> {
    const id = this._taskService.add(
      title,
      undefined,
      additional,
      undefined,
      isIgnoreShortSyntax,
    );
    const task = await this._taskService.getByIdOnce$(id).toPromise();
    this.scheduleTask(
      task,
      due,
      remindCfg ??
        this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
        DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
    );
    return id;
  }

  scheduleTask(
    task: Task | TaskWithSubTasks,
    due: number,
    remindCfg: TaskReminderOptionId,
    isMoveToBacklog: boolean = false,
  ): void {
    this._store.dispatch(
      TaskSharedActions.scheduleTaskWithTime({
        task,
        dueWithTime: due,
        remindAt: remindOptionToMilliseconds(due, remindCfg),
        isMoveToBacklog,
      }),
    );
  }

  reScheduleTask({
    task,
    due,
    remindCfg,
    isMoveToBacklog = false,
  }: {
    task: Task;
    due: number;
    remindCfg: TaskReminderOptionId;
    isMoveToBacklog: boolean;
  }): void {
    this._store.dispatch(
      TaskSharedActions.reScheduleTaskWithTime({
        task,
        dueWithTime: due,
        remindAt: remindOptionToMilliseconds(due, remindCfg),
        isMoveToBacklog,
      }),
    );
  }
}
