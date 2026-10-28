import { Injectable, signal } from '@angular/core';
import { Observable, Subject } from 'rxjs';

/** Why the last push of a task failed: a translation key or an error text. */
export type IssueSyncFailure = { msgKey: string } | { text: string };

export interface IssueSyncPushRequest {
  taskId: string;
  /** Poll-time pushes stay quiet; their failure only shows on the task. */
  isSilent: boolean;
  /** Told whether nothing pending is left unpushed once the push has run. */
  onDone?: (isPushed: boolean) => void;
}

/**
 * Per-task two-way-sync state for the task detail panel: "couldn't sync" with
 * the reason of the last failed push, and "no longer in your list" for linked
 * tasks a successful poll did not return. In memory only — never persisted or
 * synced, rebuilt by pushes and successful polls; a restart starts clean.
 *
 * Also carries requests to push a task's pending local edits (its fields that
 * differ from their baseline) from a poll, the Retry button or a handoff to the
 * two-way-sync effect, which runs them in line with ordinary pushes.
 */
@Injectable({ providedIn: 'root' })
export class IssueSyncStateService {
  private readonly _failures = signal<ReadonlyMap<string, IssueSyncFailure>>(new Map());
  private readonly _missingTaskIds = signal<ReadonlySet<string>>(new Set());
  private readonly _pushRequests$ = new Subject<IssueSyncPushRequest>();

  readonly failures = this._failures.asReadonly();
  readonly missingTaskIds = this._missingTaskIds.asReadonly();
  readonly pushRequests$: Observable<IssueSyncPushRequest> =
    this._pushRequests$.asObservable();

  requestPush(taskId: string, isSilent: boolean): void {
    this._pushRequests$.next({ taskId, isSilent });
  }

  /**
   * Pushes the task's pending edits quietly and resolves once that is done:
   * true when nothing is left unpushed (nothing was pending, or the push went
   * through), false when it failed (shown on the task).
   */
  pushPending(taskId: string): Promise<boolean> {
    return new Promise((resolve) =>
      this._pushRequests$.next({ taskId, isSilent: true, onDone: resolve }),
    );
  }

  reportFailure(taskId: string, failure: IssueSyncFailure): void {
    this._failures.update((failures) => new Map(failures).set(taskId, failure));
  }

  clearFailure(taskId: string): void {
    if (!this._failures().has(taskId)) {
      return;
    }
    this._failures.update((failures) => {
      const next = new Map(failures);
      next.delete(taskId);
      return next;
    });
  }

  isMissing(taskId: string): boolean {
    return this._missingTaskIds().has(taskId);
  }

  /**
   * Records which of the polled tasks a successful poll did not return. Only
   * ever called with a successful response: an offline or failed poll says
   * nothing about membership. Tasks not polled this time keep their state.
   */
  setMissing(polledTaskIds: string[], missingTaskIds: string[]): void {
    const current = this._missingTaskIds();
    const missing = new Set(missingTaskIds);
    const isUnchanged = polledTaskIds.every((id) => current.has(id) === missing.has(id));
    if (isUnchanged) {
      return;
    }
    const next = new Set(current);
    for (const id of polledTaskIds) {
      if (missing.has(id)) {
        next.add(id);
      } else {
        next.delete(id);
      }
    }
    this._missingTaskIds.set(next);
    // A task that is gone stops pushing; its old failure no longer applies.
    missingTaskIds.forEach((id) => this.clearFailure(id));
  }
}
