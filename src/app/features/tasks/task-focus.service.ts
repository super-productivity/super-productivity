import { Injectable, signal } from '@angular/core';
import { TaskComponent } from './task/task.component';

@Injectable({
  providedIn: 'root',
})
export class TaskFocusService {
  readonly focusedTaskId = signal<string | null>(null);
  readonly lastFocusedTaskComponent = signal<TaskComponent | null>(null);
  readonly isTaskContextMenuOpen = signal(false);

  // Registry of all task components for efficient focus navigation
  private _taskComponentsRegistry = new Map<string, TaskComponent>();

  registerTaskComponent(taskId: string, component: TaskComponent): void {
    this._taskComponentsRegistry.set(taskId, component);
  }

  unregisterTaskComponent(taskId: string): void {
    this._taskComponentsRegistry.delete(taskId);
  }

  getTaskElements(): HTMLElement[] {
    // Return task elements in DOM order without expensive querySelectorAll
    return Array.from(document.querySelectorAll('task'));
  }

  getNextTaskElement(
    currentEl: HTMLElement,
    isTaskMovedInList = false,
  ): HTMLElement | undefined {
    const taskEls = this.getTaskElements();
    const currentIndex = taskEls.findIndex((el) => el === currentEl);

    if (isTaskMovedInList) {
      // if a parent task is moved in list, as it is for when toggling done,
      // we don't want to focus the next sub-task, but the next main task instead
      const currentComponent = this._taskComponentsRegistry.get(
        currentEl.id.replace('t-', ''),
      );
      if (currentComponent && currentComponent.task().subTaskIds.length) {
        return taskEls.find((el, i) => {
          return i > currentIndex && el.parentElement?.closest('task');
        }) as HTMLElement | undefined;
      }
      return taskEls[currentIndex + 1] as HTMLElement;
    }

    return taskEls[currentIndex + 1] as HTMLElement;
  }

  getPreviousTaskElement(currentEl: HTMLElement): HTMLElement | undefined {
    const taskEls = this.getTaskElements();
    const currentIndex = taskEls.findIndex((el) => el === currentEl);
    return taskEls[currentIndex - 1] as HTMLElement;
  }
}
