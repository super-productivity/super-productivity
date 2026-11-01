import { inject, Injectable, Injector } from '@angular/core';
import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { TaskCopy } from '../../tasks/task.model';
import { TaskMatchChanges } from '../../tasks/task-criteria/task-criteria.model';
import {
  selectTaskById,
  selectTaskByIdWithSubTaskData,
} from '../../tasks/store/task.selectors';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import {
  moveProjectTaskToBacklogListAuto,
  moveProjectTaskToRegularListAuto,
} from '../../project/store/project.actions';
import { unique } from '../../../util/unique';
import { TaskBulkActionService } from '../../tasks/task-bulk-action.service';
import { getCalendarDateForDueDay } from '../boards.util';
import { dateStrToUtcDate } from '../../../util/date-str-to-utc-date';
import { getDeadlineAutoPlanFields } from '../../tasks/util/get-deadline-auto-plan-fields';
import { DateService } from '../../../core/date/date.service';

/**
 * Writes what a task needs to match a board panel (`TaskMatchChanges`) with
 * the regular task actions, so their effects and ops are the usual ones.
 */
@Injectable({ providedIn: 'root' })
export class PanelTaskChangesService {
  private readonly _store = inject(Store);
  private readonly _injector = inject(Injector);
  private readonly _dateService = inject(DateService);

  /**
   * Applies the per-task part, in the order the changes depend on: project
   * (moves the parent with its subtasks) → backlog (on the parent) → one
   * `updateTask` for tags, done and priority → unschedule. Dates follow in
   * `applyDateChanges`.
   */
  async applyTaskChanges(task: TaskCopy, changes: TaskMatchChanges): Promise<void> {
    if (changes.projectId) {
      const taskWithSubTasks = await firstValueFrom(
        this._store.select(selectTaskByIdWithSubTaskData, {
          id: task.parentId || task.id,
        }),
      );
      if (taskWithSubTasks) {
        this._store.dispatch(
          TaskSharedActions.moveToOtherProject({
            task: taskWithSubTasks,
            targetProjectId: changes.projectId,
          }),
        );
      }
    }
    const projectId = changes.projectId ?? task.projectId;
    if (changes.backlog && projectId) {
      const taskId = task.parentId || task.id;
      this._store.dispatch(
        changes.backlog === 'moveIn'
          ? moveProjectTaskToBacklogListAuto({ taskId, projectId })
          : moveProjectTaskToRegularListAuto({ taskId, projectId, isMoveToTop: false }),
      );
    }
    const updates: Partial<TaskCopy> = {
      ...(changes.tagIds ? { tagIds: unique(changes.tagIds) } : {}),
      ...(changes.isDone !== undefined ? { isDone: changes.isDone } : {}),
      // `null` clears it; `undefined` would be dropped from the synced op (#9776).
      ...(changes.priority !== undefined ? { priority: changes.priority } : {}),
    };
    if (Object.keys(updates).length > 0) {
      this._store.dispatch(
        TaskSharedActions.updateTask({ task: { id: task.id, changes: updates } }),
      );
    }
    if (changes.isUnschedule) {
      this._store.dispatch(
        TaskSharedActions.unscheduleTask({ id: task.id, isSkipToast: true }),
      );
    }
  }

  /**
   * Plans tasks for the day and sets the deadline the panel's rules ask for.
   * Re-reads each task first (`changesFor` on the fresh task): earlier changes
   * may have moved it. A planned day is the logical day; a timed task keeps
   * its time on the matching calendar date. The deadline goes last: its
   * auto-plan into Today then sees the planned date.
   */
  async applyDateChanges(
    taskIds: readonly string[],
    changesFor: (task: TaskCopy) => TaskMatchChanges | null,
    startOfNextDayDiffMs: number,
  ): Promise<void> {
    const tasksByDay = new Map<string, TaskCopy[]>();
    const deadlineChanges: [TaskCopy, TaskMatchChanges][] = [];
    for (const id of taskIds) {
      const task = await firstValueFrom(this._store.select(selectTaskById, { id }));
      const changes = task && changesFor(task);
      if (!task || !changes) continue;
      if (changes.scheduleDay) {
        const day = getCalendarDateForDueDay(
          task,
          changes.scheduleDay,
          startOfNextDayDiffMs,
        );
        tasksByDay.set(day, [...(tasksByDay.get(day) ?? []), task]);
      }
      if (changes.deadlineDay || changes.isRemoveDeadline) {
        deadlineChanges.push([task, changes]);
      }
    }
    for (const [day, tasks] of tasksByDay) {
      // Looked up on use, like the panel did.
      await this._injector
        .get(TaskBulkActionService)
        .scheduleFor(
          { date: dateStrToUtcDate(day), time: null, remindOption: null },
          tasks,
        );
    }
    for (const [task, changes] of deadlineChanges) {
      this._store.dispatch(
        changes.deadlineDay
          ? TaskSharedActions.setDeadline({
              taskId: task.id,
              deadlineDay: changes.deadlineDay,
              isSkipSnack: true,
              ...getDeadlineAutoPlanFields(this._dateService, changes.deadlineDay),
            })
          : TaskSharedActions.removeDeadline({ taskId: task.id, isSkipSnack: true }),
      );
    }
  }
}
