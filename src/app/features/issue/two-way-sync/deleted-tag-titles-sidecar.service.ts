import { Injectable } from '@angular/core';

/**
 * Transient, in-memory sidecar that holds tag titles for tags being deleted.
 * TagService writes here *before* dispatching `deleteTag`/`deleteTags`; the
 * push-on-delete effect reads + clears here *after* the action arrives.
 *
 * Kept out of the NgRx action payload so tag titles (user content) are never
 * serialized into the operation log — same pattern as
 * DeletedTaskIssueSidecarService.
 *
 * Not persisted or synced. Remote clients never need it because the effect
 * uses LOCAL_ACTIONS and only fires on the originating client.
 */
@Injectable({ providedIn: 'root' })
export class DeletedTagTitlesSidecarService {
  private _pending: string[] = [];

  set(titles: string[]): void {
    this._pending = titles;
  }

  consume(): string[] {
    const titles = this._pending;
    this._pending = [];
    return titles;
  }
}
