import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { SearchQueryParams } from '../../pages/search-page/search-page.model';
import { first } from 'rxjs/operators';
import { devError } from '../../util/dev-error';
import { TaskService } from '../../features/tasks/task.service';
import { ProjectService } from '../../features/project/project.service';
import { Router } from '@angular/router';
import { Task, TaskWithSubTasks } from '../../features/tasks/task.model';
import { TaskSharedActions } from '../../root-store/meta/task-shared.actions';
import { INBOX_PROJECT } from '../../features/project/project.const';
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
  private _store = inject(Store);
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
      const { location, orphanToHeal } = await this._resolveNavTarget(
        task,
        isArchiveTask,
      );
      if (!location) {
        // Never fall through with an empty location: `''.startsWith` would make
        // the same-context check below always true and swallow the navigation.
        throw new Error(`Could not resolve a location for task ${taskId}`);
      }
      // Perform the orphan self-heal here (not inside the resolver) so the
      // synced state mutation is an explicit navigation step, not a hidden side
      // effect of computing a URL. Must run before the same-context check below
      // so the task is added to the Inbox list in either branch. (#8780)
      if (orphanToHeal) {
        this._healOrphanTaskToInbox(orphanToHeal);
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

      // Route-change path: focus is handed off to the destination view via the
      // `focusItem` query param (AppComponent), which owns its own reveal/retry.
      // The explicit onFailure error snack is only wired to the same-context
      // branch above; here a heal always adds the task to the Inbox main list, so
      // it renders and focuses normally.
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
      this._showNavErrorSnack();
    }
  }

  /**
   * Pure resolver: computes the navigation location and, for an orphan task,
   * returns the top-level task that must be re-homed into the Inbox — WITHOUT
   * mutating state. The caller (`navigate`) performs the heal, keeping this a
   * side-effect-free "where does this task live?" query. (#8780)
   */
  private async _resolveNavTarget(
    task: Task,
    isArchiveTask: boolean,
  ): Promise<{ location: string; orphanToHeal: Task | null }> {
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
      return { location: `/tag/${TODAY_TAG.id}/${tasksOrWorklog}`, orphanToHeal: null };
    }

    if (taskToCheck.projectId) {
      return {
        location: `/project/${taskToCheck.projectId}/${tasksOrWorklog}`,
        orphanToHeal: null,
      };
    } else if (taskToCheck.tagIds?.length > 0 && taskToCheck.tagIds[0]) {
      return {
        location: `/tag/${taskToCheck.tagIds[0]}/${tasksOrWorklog}`,
        orphanToHeal: null,
      };
    } else if (!isArchiveTask) {
      // No project, no tag, and not due today: the task's id is in no work
      // context's `taskIds` ordering array, so it renders in no list view
      // (routing to Today only reveals tasks due or overdue *today*). It must be
      // self-healed into the Inbox — assigning its projectId and adding it to the
      // Inbox list — so navigation can actually reveal and focus it. moveToOther-
      // Project operates on a top-level task, so an orphaned subtask whose parent
      // could not be loaded (still has `parentId`) is routed but not healed. (#8780)
      return {
        location: `/project/${INBOX_PROJECT.id}/${tasksOrWorklog}`,
        orphanToHeal: taskToCheck.parentId ? null : taskToCheck,
      };
    } else {
      devError("Couldn't find task location");
      return { location: '', orphanToHeal: null };
    }
  }

  /**
   * Assign a project-less, tag-less task to the Inbox so it lives in a real list
   * and can be revealed. The move reducer only strips the task from its source
   * project when that project exists, so an empty or dangling projectId is
   * handled gracefully, and it reads canonical subtask data from the store, so
   * passing an empty `subTasks` here is safe. (#8780)
   */
  private _healOrphanTaskToInbox(task: Task): void {
    // Defense-in-depth: `moveToOtherProject` operates on a top-level task, so
    // never move a subtask as if it were a parent (the resolver already returns
    // `null` for subtasks, so this only guards against future misuse).
    if (task.parentId) {
      return;
    }
    this._store.dispatch(
      TaskSharedActions.moveToOtherProject({
        task: { ...task, subTasks: [] } as TaskWithSubTasks,
        targetProjectId: INBOX_PROJECT.id,
      }),
    );
  }

  private _showNavErrorSnack(): void {
    this._snackService.open({
      type: 'ERROR',
      msg: T.GLOBAL_SNACK.NAVIGATE_TO_TASK_ERR,
    });
  }

  private _isDueToday(task: Task): boolean {
    if (task.dueWithTime) {
      return this._dateService.isToday(task.dueWithTime);
    }
    return task.dueDay === this._dateService.todayStr();
  }

  private _focusTaskElement(taskId: string): void {
    // Never swallow silently: if the task never becomes focusable in the current
    // context, surface the error instead of leaving the user on the wrong view.
    this._layoutService.focusTaskInViewWhenReady(taskId, undefined, () => {
      recordSearchNavDebug('navigateToTask:focusFailed', { taskId });
      this._showNavErrorSnack();
    });
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
