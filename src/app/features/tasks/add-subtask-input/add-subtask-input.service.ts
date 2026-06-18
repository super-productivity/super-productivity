import { Injectable, signal } from '@angular/core';

/**
 * Bus that tells the `TaskComponent` rendering `parentId`'s subtasks to open its
 * inline draft input. Callers (row, context menu, shortcut, detail panel) don't
 * hold a reference to that component, so the request travels through this shared
 * signal.
 *
 * The request is transient: the consuming row calls `consume()` once it has
 * acted on it, resetting the signal to `null`. This is deliberate — without it,
 * a freshly re-created row whose id matches a stale request (e.g. navigating
 * away from a project and back) would re-run its open effect on init and steal
 * focus into the input with no user action.
 */
@Injectable({
  providedIn: 'root',
})
export class AddSubtaskInputService {
  /** parentId of the task whose inline subtask input should open, or null. */
  readonly openRequest = signal<string | null>(null);

  requestOpen(parentId: string): void {
    this.openRequest.set(parentId);
  }

  /** Reset the request once the target row has opened its input. */
  consume(): void {
    this.openRequest.set(null);
  }
}
