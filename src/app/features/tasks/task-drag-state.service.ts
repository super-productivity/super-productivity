import { Injectable, signal } from '@angular/core';
import { TaskWithSubTasks } from './task.model';

export type DropType = 'SUBTASK' | 'BLOCKED' | 'NONE';

@Injectable({
  providedIn: 'root',
})
export class TaskDragStateService {
  readonly draggedTask = signal<TaskWithSubTasks | null>(null);
  readonly hoverTargetId = signal<string | null>(null);
  readonly dropType = signal<DropType>('NONE');

  setDragState(task: TaskWithSubTasks, targetId: string | null, type: DropType): void {
    this.draggedTask.set(task);
    this.hoverTargetId.set(targetId);
    this.dropType.set(type);
  }

  clear(): void {
    this.draggedTask.set(null);
    this.hoverTargetId.set(null);
    this.dropType.set('NONE');
  }
}
