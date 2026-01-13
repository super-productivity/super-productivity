import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { distinctUntilChanged, map, shareReplay } from 'rxjs/operators';

/**
 * Shared service to track when sync-related dialogs are waiting for user input.
 * Uses reference counting to support multiple concurrent dialogs.
 *
 * This prevents the sync timeout from firing while user is making decisions
 * in dialogs like conflict resolution, fresh client confirmation, etc.
 */
@Injectable({ providedIn: 'root' })
export class UserInputWaitStateService {
  private _waitingSources$ = new BehaviorSubject<Set<string>>(new Set());

  /**
   * Observable that emits true when any dialog is waiting for user input.
   */
  isWaitingForUserInput$ = this._waitingSources$.pipe(
    map((sources) => sources.size > 0),
    distinctUntilChanged(),
    shareReplay(1),
  );

  /**
   * Signal that a dialog is waiting for user input.
   * @param sourceId Unique identifier for the dialog (e.g., 'oplog-conflict', 'legacy-conflict')
   * @returns Cleanup function that MUST be called when dialog closes (use in finally block)
   */
  startWaiting(sourceId: string): () => void {
    const current = new Set(this._waitingSources$.value);
    current.add(sourceId);
    this._waitingSources$.next(current);

    return () => {
      const updated = new Set(this._waitingSources$.value);
      updated.delete(sourceId);
      this._waitingSources$.next(updated);
    };
  }

  /**
   * Synchronous check if any dialog is waiting for user input.
   */
  isWaitingSync(): boolean {
    return this._waitingSources$.value.size > 0;
  }
}
