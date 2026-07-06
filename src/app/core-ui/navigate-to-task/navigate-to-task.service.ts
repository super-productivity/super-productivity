import { inject, Injectable } from '@angular/core';
import { SearchQueryParams } from '../../pages/search-page/search-page.model';
import { first } from 'rxjs/operators';
import { devError } from '../../util/dev-error';
import { TaskService } from '../../features/tasks/task.service';
import { ProjectService } from '../../features/project/project.service';
import { Router } from '@angular/router';
import { Task } from '../../features/tasks/task.model';
import { getDbDateStr } from '../../util/get-db-date-str';
import { DateService } from '../../core/date/date.service';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { SnackService } from '../../core/snack/snack.service';
import { T } from '../../t.const';
import { Log } from '../../core/log';
import { LayoutService } from '../layout/layout.service';
import { recordSearchNavDebug } from '../../util/search-nav-debug';

@Injectable({
  providedIn: 'root',
})
export class NavigateToTaskService {
  private _taskService = inject(TaskService);
  private _projectService = inject(ProjectService);
  private _router = inject(Router);
  private _snackService = inject(SnackService);
  private _dateService = inject(DateService);
  private _layoutService = inject(LayoutService);

  async navigate(taskId: string, isArchiveTask: boolean = false): Promise<void> {
    try {
      const task = await this._taskService.getByIdFromEverywhere(taskId);
      if (!task) {
        throw new Error(`Task with id ${taskId} not found`);
      }
      const location = await this._getLocation(task, isArchiveTask);
      if (!location) {
        // Never fall through with an empty location: `''.startsWith` would make
        // the same-context check below always true and swallow the navigation.
        throw new Error(`Could not resolve a location for task ${taskId}`);
      }
      recordSearchNavDebug('navigateToTask:start', {
        taskId,
        isArchiveTask,
        currentUrl: this._router.url,
        location,
        parentId: task.parentId || null,
        projectId: task.projectId || null,
        firstTagId: task.tagIds?.[0] || null,
      });

      if (this._router.url.startsWith(location)) {
        recordSearchNavDebug('navigateToTask:sameContext', {
          taskId,
          currentUrl: this._router.url,
          location,
        });
        this._focusTaskElement(taskId);
        return;
      }

      const queryParams: SearchQueryParams = { focusItem: taskId };
      if (isArchiveTask) {
        queryParams.dateStr = await this._getArchivedDate(task);
      } else {
        queryParams.isInBacklog = await this._isInBacklog(task);
      }
      recordSearchNavDebug('navigateToTask:routeChange', {
        taskId,
        location,
        queryParams,
      });
      await this._router.navigate([location], { queryParams });
    } catch (err) {
      recordSearchNavDebug('navigateToTask:error', {
        taskId,
        isArchiveTask,
        error: err instanceof Error ? err.message : String(err),
      });
      Log.err(err);
      this._snackService.open({
        type: 'ERROR',
        msg: T.GLOBAL_SNACK.NAVIGATE_TO_TASK_ERR,
      });
    }
  }

  private async _getLocation(task: Task, isArchiveTask: boolean): Promise<string> {
    const tasksOrWorklog = isArchiveTask ? 'history' : 'tasks';

    let taskToCheck = task;
    if (task.parentId) {
      const parentTask = await this._taskService.getByIdFromEverywhere(
        task.parentId,
        isArchiveTask,
      );
      if (parentTask) {
        taskToCheck = parentTask;
      }
    }

    if (!isArchiveTask && this._isDueToday(taskToCheck)) {
      return `/tag/${TODAY_TAG.id}/${tasksOrWorklog}`;
    }

    if (taskToCheck.projectId) {
      return `/project/${taskToCheck.projectId}/${tasksOrWorklog}`;
    } else if (taskToCheck.tagIds?.length > 0 && taskToCheck.tagIds[0]) {
      return `/tag/${taskToCheck.tagIds[0]}/${tasksOrWorklog}`;
    } else if (!isArchiveTask) {
      // A non-archived task with neither project nor tags only ever lives in the
      // Today list — either due today (handled above) or overdue. Route there so
      // navigation reveals it instead of resolving to '' and silently no-op'ing
      // (an empty location makes `url.startsWith(location)` always true). (#8780)
      return `/tag/${TODAY_TAG.id}/${tasksOrWorklog}`;
    } else {
      devError("Couldn't find task location");
      return '';
    }
  }

  private _isDueToday(task: Task): boolean {
    if (task.dueWithTime) {
      return this._dateService.isToday(task.dueWithTime);
    }
    return task.dueDay === this._dateService.todayStr();
  }

  private _focusTaskElement(taskId: string): void {
    this._layoutService.focusTaskInViewWhenReady(taskId);
  }

  private async _isInBacklog(task: Task): Promise<boolean> {
    if (!task.projectId) return false;
    const projects = await this._projectService.list$.pipe(first()).toPromise();
    const project = projects.find((p) => p.id === task.projectId);
    return project ? project.backlogTaskIds.includes(task.id) : false;
  }

  private async _getArchivedDate(task: Task): Promise<string> {
    let dateStr = task.timeSpentOnDay ? Object.keys(task.timeSpentOnDay)[0] : undefined;
    if (dateStr) return dateStr;

    if (task.parentId) {
      const tasks = await this._taskService.getArchivedTasks();
      const parentTask = tasks.find((innerTask) => innerTask.id === task.parentId);
      if (parentTask && parentTask.timeSpentOnDay) {
        dateStr = Object.keys(parentTask.timeSpentOnDay)[0];
        return dateStr ?? getDbDateStr(parentTask.created);
      }
    }

    return getDbDateStr(task.created);
  }
}
