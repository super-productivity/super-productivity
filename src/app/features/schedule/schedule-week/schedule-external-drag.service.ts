import { Injectable, signal } from '@angular/core';
import { TaskWithSubTasks } from '../../tasks/task.model';
import { DragRef } from '@angular/cdk/drag-drop';

@Injectable({ providedIn: 'root' })
export class ScheduleExternalDragService {
  private readonly _activeTask = signal<TaskWithSubTasks | null>(null);
  private _activeDragRef: DragRef | null = null;
  private _cancelNextDrop: boolean = false;

  setCancelNextDrop(val: boolean): void {
    this._cancelNextDrop = val;
  }

  isCancelNextDrop(): boolean {
    return this._cancelNextDrop;
  }

  activeTask(): TaskWithSubTasks | null {
    return this._activeTask();
  }

  activeDragRef(): DragRef | null {
    return this._activeDragRef;
  }

  setActiveTask(task: TaskWithSubTasks | null, dragRef: DragRef | null = null): void {
    this._activeTask.set(task);
    this._activeDragRef = dragRef;
  }
}
