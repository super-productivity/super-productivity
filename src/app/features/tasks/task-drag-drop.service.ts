import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';
import { makeTaskSubtaskOfAnother, convertSubtaskToTask } from './store/task.actions';

@Injectable({
  providedIn: 'root',
})
export class TaskDragDropService {
  private readonly _store = inject(Store);

  makeSubtask(taskId: string, newParentId: string, newOrderedIds?: string[]): void {
    this._store.dispatch(
      makeTaskSubtaskOfAnother({
        taskId,
        newParentId,
        newOrderedIds,
      }),
    );
  }

  makeIndependentTask(taskId: string, parentId: string): void {
    this._store.dispatch(
      convertSubtaskToTask({
        taskId,
        parentId,
      }),
    );
  }
}
