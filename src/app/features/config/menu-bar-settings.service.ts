import { Injectable, signal } from '@angular/core';
import { MenuBarConfig } from './global-config.model';
import { Log } from '../../core/log';

const STORAGE_KEY = 'sp_menu_bar_settings';

const DEFAULT_MENU_BAR_CONFIG: Required<MenuBarConfig> = {
  showDockIcon: false,
};

/**
 * macOS menu bar settings that are per-instance (localStorage), not synced:
 * whether the app keeps a Dock icon is a property of this Mac, not of the user's
 * data, and another Mac may want the opposite. Mirrors TaskWidgetSettingsService.
 *
 * `showDockIcon: false` is menu-bar-only mode. `true` keeps the Dock icon (and
 * its running dot) so the app's open state is visible there too.
 */
@Injectable({ providedIn: 'root' })
export class MenuBarSettingsService {
  private readonly _settings = signal<Required<MenuBarConfig>>(this._loadFromStorage());
  readonly settings = this._settings.asReadonly();

  constructor() {
    // Push the persisted value to the main process at boot, before the
    // lazy-loaded Settings page is ever opened.
    this._notifyElectron(this._settings());
  }

  update(partial: Partial<MenuBarConfig>): void {
    const next: Required<MenuBarConfig> = { ...this._settings(), ...partial };
    this._settings.set(next);
    this._persistToStorage(next);
    this._notifyElectron(next);
  }

  private _loadFromStorage(): Required<MenuBarConfig> {
    if (typeof localStorage === 'undefined') {
      return { ...DEFAULT_MENU_BAR_CONFIG };
    }
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { ...DEFAULT_MENU_BAR_CONFIG };
      const parsed = JSON.parse(raw) as Partial<MenuBarConfig>;
      return { ...DEFAULT_MENU_BAR_CONFIG, ...parsed };
    } catch (e) {
      Log.err('Failed to read menu bar settings from localStorage', e);
      return { ...DEFAULT_MENU_BAR_CONFIG };
    }
  }

  private _persistToStorage(value: Required<MenuBarConfig>): void {
    if (typeof localStorage === 'undefined') return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
    } catch (e) {
      Log.err('Failed to persist menu bar settings to localStorage', e);
    }
  }

  private _notifyElectron(value: Required<MenuBarConfig>): void {
    // The bridge only exposes this in the desktop build; on macOS the main
    // process applies it, elsewhere the handler is not registered.
    if (typeof window.ea?.updateMenuBarSettings !== 'function') return;
    window.ea.updateMenuBarSettings(value);
  }
}
