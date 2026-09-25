import { inject, Injectable } from '@angular/core';
import { Store } from '@ngrx/store';
import { TaskService } from './task.service';
import { TaskWithSubTasks } from './task.model';
import { addSubTask } from './store/task.actions';

@Injectable({
  providedIn: 'root',
})
export class TaskDuplicateService {
  private readonly _taskService = inject(TaskService);
  private readonly _store = inject(Store);

  duplicate(task: TaskWithSubTasks): string | null {
    if (task.parentId || task.isDone) {
      return null;
    }

    const taskData = {
      isDone: false,
      projectId: task.projectId || undefined,
      tagIds: task.tagIds || [],
      ...(task.notes && { notes: task.notes }),
    };
    const timeData = {
      ...(task.dueDay && { dueDay: task.dueDay }),
      ...(task.dueWithTime && { dueWithTime: task.dueWithTime }),
      ...(task.timeEstimate && { timeEstimate: task.timeEstimate }),
    };
    const taskId = this._taskService.add(
      `${task.title} (copy)`,
      false,
      { ...taskData, ...timeData },
      false,
    );

    for (const subTask of task.subTasks) {
      const subTaskObj = this._taskService.createNewTaskWithDefaults({
        title: subTask.title,
        additional: {
          isDone: subTask.isDone,
          projectId: subTask.projectId,
          timeEstimate: subTask.timeEstimate,
          notes: subTask.notes,
        },
      });
      this._store.dispatch(
        addSubTask({
          task: subTaskObj,
          parentId: taskId,
        }),
      );
    }

    return taskId;
  }
}
