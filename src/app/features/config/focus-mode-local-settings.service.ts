import { Injectable, signal } from '@angular/core';
import { FocusModeLocalConfig } from './global-config.model';
import { Log } from '../../core/log';

const STORAGE_KEY = 'sp_focus_mode_local_settings';

const DEFAULT_FOCUS_MODE_LOCAL_CONFIG: Required<FocusModeLocalConfig> = {
  isLoopBreakEndAlarm: false,
};

/**
 * Focus-mode settings that intentionally live in localStorage rather than the
 * synced global config, because they control audio behavior that differs
 * across platforms. The looping break-end alarm keeps the break-end sound
 * playing until the break is dismissed; on desktop the AudioContext keeps
 * running while the window is unfocused, but on mobile it is suspended on
 * app-background (#8243), so a single value synced across devices would behave
 * differently per device. Mirrors TaskWidgetSettingsService. See #8593.
 */
@Injectable({ providedIn: 'root' })
export class FocusModeLocalSettingsService {
  private readonly _settings = signal<Required<FocusModeLocalConfig>>(
    this._loadFromStorage(),
  );
  readonly settings = this._settings.asReadonly();

  update(partial: Partial<FocusModeLocalConfig>): void {
    const next: Required<FocusModeLocalConfig> = { ...this._settings(), ...partial };
    this._settings.set(next);
    this._persistToStorage(next);
  }

  private _loadFromStorage(): Required<FocusModeLocalConfig> {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_FOCUS_MODE_LOCAL_CONFIG };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_FOCUS_MODE_LOCAL_CONFIG };
      const parsed = JSON.parse(raw) as Partial<FocusModeLocalConfig>;
      return { ...DEFAULT_FOCUS_MODE_LOCAL_CONFIG, ...parsed };
    } catch (e) {
      Log.err('Failed to read focus mode local settings from localStorage', e);
      return { ...DEFAULT_FOCUS_MODE_LOCAL_CONFIG };
    }
  }

  private _persistToStorage(value: Required<FocusModeLocalConfig>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
      Log.err('Failed to persist focus mode local settings to localStorage', e);
    }
  }
}
