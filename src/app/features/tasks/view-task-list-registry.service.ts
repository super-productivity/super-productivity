import { computed, Injectable, signal } from '@angular/core';
import { ViewTaskListHost } from './view-task-list.token';

/**
 * The columns of the view open as a task list, in display order. Lets parts
 * outside the view's own rows act on the view instead of the stale work
 * context: the regular add-task bar adds into the first column that accepts
 * new tasks, the task detail panel moves a row within the view. Local UI
 * state, never persisted.
 */
@Injectable({ providedIn: 'root' })
export class ViewTaskListRegistry {
  private readonly _entry = signal<{
    owner: object;
    hosts: readonly ViewTaskListHost[];
  } | null>(null);

  readonly hosts = computed(() => this._entry()?.hosts ?? []);

  /** The column the add-task bar adds into, if a view list is open. */
  readonly addTarget = computed(
    () => this.hosts().find((host) => host.newTaskTarget() !== null) ?? null,
  );

  /** `owner` keeps a view that is leaving from clearing the next view's columns. */
  set(owner: object, hosts: readonly ViewTaskListHost[]): void {
    if (!hosts.length) {
      this.clear(owner);
      return;
    }
    this._entry.set({ owner, hosts });
  }

  clear(owner: object): void {
    if (this._entry()?.owner === owner) {
      this._entry.set(null);
    }
  }

  hostForRow(taskId: string): ViewTaskListHost | null {
    return this.hosts().find((host) => host.isRow(taskId)) ?? null;
  }
}
