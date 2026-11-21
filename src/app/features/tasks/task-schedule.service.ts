import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { DateService } from '../../core/date/date.service';
import { GlobalConfigService } from '../config/global-config.service';
import { DEFAULT_GLOBAL_CONFIG } from '../config/default-global-config.const';
import { combineDateAndTime } from '../../util/combine-date-and-time';
import { parseDbDateStr } from '../../util/parse-db-date-str';
import { Task } from './task.model';
import { TaskService } from './task.service';

/**
 * Plans a task for a day the way the task context menu's quick buttons do, so
 * every caller that "moves a task to a day" dispatches the same actions:
 *
 * - a task with a start time keeps that time on the new day
 *   (`scheduleTaskWithTime`), unless it already starts today and is planned
 *   for today, which only adds it to Today;
 * - otherwise today adds it to Today (`planTasksForToday`) and any other day
 *   plans it for that day (`planTaskForDay`);
 * - a task already planned for that day is left alone.
 */
@Injectable({ providedIn: 'root' })
export class TaskScheduleService {
  private readonly _store = inject(Store);
  private readonly _taskService = inject(TaskService);
  private readonly _dateService = inject(DateService);
  private readonly _globalConfigService = inject(GlobalConfigService);

  /** Returns false when the task already is planned for `day` and nothing was dispatched. */
  planForDay(task: Task, day: string, isShowSnack = true): boolean {
    const today = this._dateService.todayStr();
    if (
      task.dueWithTime &&
      this._dateService.isToday(task.dueWithTime) &&
      day === today
    ) {
      this.planForToday(task, isShowSnack);
      return true;
    }
    if (task.dueDay === day) {
      return false;
    }
    if (task.dueWithTime) {
      const due = combineDateAndTime(parseDbDateStr(day), new Date(task.dueWithTime));
      this._taskService.scheduleTask(
        task,
        due.getTime(),
        this._globalConfigService.cfg()?.reminder.defaultTaskRemindOption ??
          DEFAULT_GLOBAL_CONFIG.reminder.defaultTaskRemindOption!,
        false,
      );
      return true;
    }
    if (day === today) {
      this.planForToday(task, isShowSnack);
      return true;
    }
    this._store.dispatch(PlannerActions.planTaskForDay({ task, day, isShowSnack }));
    return true;
  }

  /** Adds the task to Today, clearing a reminder for a start time today. */
  planForToday(task: Task, isShowSnack = true): void {
    this._store.dispatch(
      TaskSharedActions.planTasksForToday({
        taskIds: [task.id],
        today: this._dateService.todayStr(),
        startOfNextDayDiffMs: this._dateService.getStartOfNextDayDiffMs(),
        parentTaskMap: { [task.id]: task.parentId },
        isShowSnack,
      }),
    );
  }
}
