import { Injectable } from '@angular/core';

export interface NavigatorWithKeyboard {
  keyboard?: NavigatorKeyboard;
}

export interface NavigatorKeyboard {
  getLayoutMap: () => Promise<Map<string, string>>;
}

/**
 * A Map where keys are string representations of key codes,
 * and values are the corresponding characters or symbols for this layout.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/API/KeyboardLayoutMap#browser_compatibility
 */
export type KeyboardLayout = Map<string, string>;

/**
 * Service that manages the user's keyboard layout mapping.
 *
 * Encapsulates the keyboard layout state to avoid global mutable state,
 * which caused issues in parallel tests and SSR scenarios.
 *
 * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardLayoutMap
 */
@Injectable({
  providedIn: 'root',
})
export class KeyboardLayoutService {
  private _layout: KeyboardLayout = new Map();

  /**
   * Gets the current keyboard layout map.
   * Returns an empty map if the layout hasn't been initialized.
   */
  get layout(): KeyboardLayout {
    return this._layout;
  }

  /**
   * Saves the user's keyboard layout mapping from the browser's Keyboard API.
   * Should be called once during app initialization.
   *
   * @see https://developer.mozilla.org/en-US/docs/Web/API/KeyboardLayoutMap
   */
  async saveUserLayout(): Promise<void> {
    // If browser doesn't support keyboard API
    if (!('keyboard' in navigator)) return;

    const keyboard = (navigator as NavigatorWithKeyboard).keyboard;
    if (!keyboard) return;

    const kbLayout = await keyboard.getLayoutMap();
    this._layout.clear();
    kbLayout.forEach((value, key) => this._layout.set(key, value));
  }

  /**
   * Clears the keyboard layout. Used for testing.
   * @internal
   */
  clear(): void {
    this._layout.clear();
  }

  /**
   * Sets the keyboard layout directly. Used for testing.
   * @internal
   */
  setLayout(layout: KeyboardLayout): void {
    this._layout.clear();
    layout.forEach((value, key) => this._layout.set(key, value));
  }
}
