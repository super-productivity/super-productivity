import { Injectable, signal } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Log } from '../../core/log';

const STORAGE_KEY = 'sp_due_task_badge_local_settings';

/**
 * Whether to show the due-task count on the app icon. Lives in localStorage
 * rather than the synced config: badge permission is granted per device, so a
 * synced flag would trigger an unexpected iOS permission prompt on devices that
 * never opted in.
 */
@Injectable({ providedIn: 'root' })
export class DueTaskBadgeLocalSettingsService {
  private readonly _isEnabled = signal<boolean>(this._loadFromStorage());
  readonly isEnabled = this._isEnabled.asReadonly();
  readonly isEnabled$ = toObservable(this._isEnabled);

  setEnabled(isEnabled: boolean): void {
    this._isEnabled.set(isEnabled);
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(isEnabled));
    } catch (e) {
      Log.err('Failed to persist due task badge setting to localStorage', e);
    }
  }

  private _loadFromStorage(): boolean {
    if (typeof localStorage === 'undefined') return false;
    try {
      return localStorage.getItem(STORAGE_KEY) === 'true';
    } catch (e) {
      Log.err('Failed to read due task badge setting from localStorage', e);
      return false;
    }
  }
}
