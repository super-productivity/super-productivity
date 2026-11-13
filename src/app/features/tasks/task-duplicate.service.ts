import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskService } from './task.service';
import { Task, TaskWithSubTasks } from './task.model';
import { addSubTask } from './store/task.actions';
import { PlannerActions } from '../planner/store/planner.actions';
import { isWontDoTask } from './util/is-wont-do-task';

@Injectable({
  providedIn: 'root',
})
export class TaskDuplicateService {
  private readonly _taskService = inject(TaskService);
  private readonly _store = inject(Store);

  duplicate(task: TaskWithSubTasks, isBulk = false): string | null {
    if (!isBulk && (task.parentId || task.isDone)) {
      return null;
    }
    if (task.parentId) {
      return this._duplicateSubTask({ ...task, isDone: false }, task.parentId);
    }

    const taskData = {
      isDone: false,
      projectId: task.projectId || undefined,
      tagIds: task.tagIds || [],
      attachments: task.attachments,
      ...(task.notes && { notes: task.notes }),
      ...(task.deadlineDay && { deadlineDay: task.deadlineDay }),
      ...(task.deadlineWithTime && { deadlineWithTime: task.deadlineWithTime }),
      ...(task.deadlineRemindAt && { deadlineRemindAt: task.deadlineRemindAt }),
      ...(task.priority !== undefined && { priority: task.priority }),
    };
    const timeData = {
      ...(task.dueDay && { dueDay: task.dueDay }),
      ...(task.dueWithTime && { dueWithTime: task.dueWithTime }),
      ...(task.timeEstimate && { timeEstimate: task.timeEstimate }),
    };
    const taskId = isBulk
      ? this._taskService.add(
          task.title,
          false,
          { ...taskData, ...timeData },
          false,
          true,
        )
      : this._taskService.add(
          `${task.title} (copy)`,
          false,
          { ...taskData, ...timeData },
          false,
        );

    for (const subTask of task.subTasks) {
      this._duplicateSubTask(subTask, taskId);
    }

    return taskId;
  }

  private _duplicateSubTask(subTask: Task, parentId: string): string {
    const subTaskObj = this._taskService.createNewTaskWithDefaults({
      title: subTask.title,
      additional: {
        parentId,
        isDone: subTask.isDone,
        ...(isWontDoTask(subTask) && {
          doneOn: subTask.doneOn,
          wontDoOn: subTask.wontDoOn,
        }),
        projectId: subTask.projectId,
        ...(subTask.dueDay && { dueDay: subTask.dueDay }),
        ...(subTask.dueWithTime && { dueWithTime: subTask.dueWithTime }),
        timeEstimate: subTask.timeEstimate,
        notes: subTask.notes,
        attachments: subTask.attachments,
        ...(subTask.deadlineDay && { deadlineDay: subTask.deadlineDay }),
        ...(subTask.deadlineWithTime && { deadlineWithTime: subTask.deadlineWithTime }),
        ...(subTask.deadlineRemindAt && { deadlineRemindAt: subTask.deadlineRemindAt }),
        ...(subTask.priority !== undefined && { priority: subTask.priority }),
      },
    });
    this._store.dispatch(
      addSubTask({
        task: subTaskObj,
        parentId,
      }),
    );
    if (subTask.dueDay) {
      this._store.dispatch(
        PlannerActions.planTaskForDay({
          task: subTaskObj,
          day: subTask.dueDay,
        }),
      );
    }
    return subTaskObj.id;
  }
}
