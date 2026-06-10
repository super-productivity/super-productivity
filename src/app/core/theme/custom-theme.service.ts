import { computed, inject, Injectable, signal, Signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Log } from '../log';
import { LS } from '../persistence/storage-keys.const';
import { ThemeStorageService } from './theme-storage.service';
import { validateThemeCss } from './validate-theme-css.util';
import { ThemeCssWarning } from './theme-contract.const';
import { IS_APPLE_SILICON } from '../../app.constants';

/**
 * A theme entry surfaced in the picker.
 *
 * Built-in themes load from `assets/themes/*.css` via a `<link>` tag.
 * User themes load from IDB-stored CSS bytes via a `<style>` tag.
 *
 * `kind` discriminates the load path and lines up with `CustomThemeRef.kind`,
 * so the picker can build a ref directly without re-deriving it from a flag.
 */
export interface CustomTheme {
  id: string;
  name: string;
  kind: 'builtin' | 'user';
  /** Empty for the default theme; an asset URL for built-ins; absent for user themes. */
  url?: string;
  requiredMode?: 'dark' | 'light' | 'system';
  /**
   * Non-blocking warnings carried over from the validator (user themes only).
   * Built-ins ship with a complete contract and never set this. The picker
   * may surface warnings the first time a theme is installed.
   */
  warnings?: ThemeCssWarning[];
}

/** Reference to a theme stored as `kind:id` in `LS.CUSTOM_THEME`. */
export type CustomThemeRef =
  | { kind: 'builtin'; id: string }
  | { kind: 'user'; id: string };

const STYLESHEET_ID = 'custom-theme-stylesheet';

const DEFAULT_REF: CustomThemeRef = { kind: 'builtin', id: 'default' };

const LIQUID_GLASS_REF: CustomThemeRef = { kind: 'builtin', id: 'liquid-glass' };

const parseRef = (raw: string | null): CustomThemeRef => {
  if (!raw) return DEFAULT_REF;
  const idx = raw.indexOf(':');
  if (idx <= 0) return DEFAULT_REF;
  const kind = raw.slice(0, idx);
  const id = raw.slice(idx + 1);
  if (!id) return DEFAULT_REF;
  if (kind === 'builtin') return { kind: 'builtin', id };
  if (kind === 'user') return { kind: 'user', id };
  return DEFAULT_REF;
};

const serializeRef = (ref: CustomThemeRef): string => `${ref.kind}:${ref.id}`;

/**
 * Pick the cold-start theme. Honors any stored selection first; otherwise
 * Apple Silicon Macs land on Liquid Glass (backdrop-filter is cheap on
 * M-series GPUs, the macOS aesthetic feels at home), everyone else stays
 * on the default theme.
 *
 * Deliberately does *not* write to LS on first run — leaving LS untouched
 * lets `migrateLegacyCustomTheme` still detect the "no choice yet" state
 * and import a synced device's preference. The consequence is that a
 * future change to this rule will silently re-pick for users who never
 * touched the picker, which is the expected behavior of a default.
 *
 * Exported so tests can exercise both branches without monkey-patching
 * the module-level `IS_APPLE_SILICON` constant.
 */
export const pickInitialActiveRef = (
  stored: string | null,
  isAppleSilicon: boolean,
): CustomThemeRef => {
  if (stored) return parseRef(stored);
  return isAppleSilicon ? LIQUID_GLASS_REF : DEFAULT_REF;
};

export const BUILT_IN_THEMES: CustomTheme[] = [
  { id: 'default', name: 'Default', kind: 'builtin', url: '', requiredMode: 'system' },
  {
    id: 'zen',
    name: 'Zen',
    kind: 'builtin',
    url: 'assets/themes/zen.css',
    requiredMode: 'system',
  },
  {
    id: 'arc',
    name: 'Arc',
    kind: 'builtin',
    url: 'assets/themes/arc.css',
    requiredMode: 'dark',
  },
  {
    id: 'catppuccin-mocha',
    name: 'Catppuccin Mocha',
    kind: 'builtin',
    url: 'assets/themes/catppuccin-mocha.css',
    requiredMode: 'dark',
  },
  {
    id: 'cybr',
    name: 'Cybr (Cyberpunk)',
    kind: 'builtin',
    url: 'assets/themes/cybr.css',
    requiredMode: 'dark',
  },
  {
    id: 'dark-base',
    name: 'Dark Base',
    kind: 'builtin',
    url: 'assets/themes/dark-base.css',
    requiredMode: 'dark',
  },
  {
    id: 'dracula',
    name: 'Dracula',
    kind: 'builtin',
    url: 'assets/themes/dracula.css',
    requiredMode: 'dark',
  },
  {
    id: 'everforest',
    name: 'Everforest',
    kind: 'builtin',
    url: 'assets/themes/everforest.css',
    requiredMode: 'system',
  },
  {
    id: 'glass',
    name: 'Glass',
    kind: 'builtin',
    url: 'assets/themes/glass.css',
    requiredMode: 'dark',
  },
  {
    id: 'lines',
    name: 'Lines',
    kind: 'builtin',
    url: 'assets/themes/lines.css',
    requiredMode: 'system',
  },
  {
    id: 'liquid-glass',
    name: 'Liquid Glass (macOS)',
    kind: 'builtin',
    url: 'assets/themes/liquid-glass.css',
    requiredMode: 'system',
  },
  {
    id: 'nord-polar-night',
    name: 'Nord Polar Night',
    kind: 'builtin',
    url: 'assets/themes/nord-polar-night.css',
    requiredMode: 'dark',
  },
  {
    id: 'nord-snow-storm',
    name: 'Nord Snow Storm',
    kind: 'builtin',
    url: 'assets/themes/nord-snow-storm.css',
    requiredMode: 'light',
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    kind: 'builtin',
    url: 'assets/themes/rainbow.css',
    requiredMode: 'system',
  },
  {
    id: 'velvet',
    name: 'Velvet',
    kind: 'builtin',
    url: 'assets/themes/velvet.css',
    requiredMode: 'dark',
  },
];

@Injectable({ providedIn: 'root' })
export class CustomThemeService {
  private _document = inject<Document>(DOCUMENT);
  private _themeStorage = inject(ThemeStorageService);

  private _activeRef = signal<CustomThemeRef>(
    pickInitialActiveRef(localStorage.getItem(LS.CUSTOM_THEME), IS_APPLE_SILICON),
  );

  /** The currently selected theme reference. */
  readonly activeRef: Signal<CustomThemeRef> = this._activeRef.asReadonly();

  /** All themes available in the picker — built-ins first, then user uploads. */
  readonly themes: Signal<CustomTheme[]> = computed(() => [
    ...BUILT_IN_THEMES,
    ...this._themeStorage.themes().map(
      (t): CustomTheme => ({
        id: t.id,
        name: t.name,
        kind: 'user',
        requiredMode: 'system',
        warnings: t.warnings,
      }),
    ),
  ]);

  /**
   * Apply the currently-selected theme. Called from startup to honor a
   * cold-start `LS.CUSTOM_THEME` value, and from `setActiveTheme` after
   * a user picks a theme.
   */
  async applyActiveTheme(): Promise<void> {
    await this.loadTheme(this._activeRef());
  }

  /**
   * Persist the selection to localStorage and load it. Sole writer of
   * `LS.CUSTOM_THEME` — every caller goes through here so the signal,
   * localStorage, and the live stylesheet stay in lockstep.
   */
  async setActiveTheme(ref: CustomThemeRef): Promise<void> {
    this._activeRef.set(ref);
    localStorage.setItem(LS.CUSTOM_THEME, serializeRef(ref));
    await this.loadTheme(ref);
  }

  /**
   * Bridge for users syncing from a pre-`LS.CUSTOM_THEME` device, where the
   * picker value lived in `globalConfig.misc.customTheme`. If LS already has
   * a value the user already chose on this device — leave it alone. Only
   * migrates known built-in IDs; user themes never lived in legacy config.
   */
  async migrateLegacyCustomTheme(legacyId: string | undefined): Promise<void> {
    if (localStorage.getItem(LS.CUSTOM_THEME)) return;
    if (!legacyId || legacyId === 'default') return;
    if (!BUILT_IN_THEMES.some((t) => t.id === legacyId)) return;
    await this.setActiveTheme({ kind: 'builtin', id: legacyId });
  }

  /**
   * Uninstall a user theme. Deletes from IDB; if it was the active theme,
   * resets the picker to the default. Returns whether a fallback occurred
   * so callers can surface a "reverted to default" toast.
   *
   * IDB delete runs first — if it fails, LS is untouched and the user can
   * retry without a corrupted active-theme reference.
   */
  async removeUserTheme(id: string): Promise<boolean> {
    const active = this._activeRef();
    const wasActive = active.kind === 'user' && active.id === id;
    await this._themeStorage.removeTheme(id);
    if (wasActive) {
      await this.setActiveTheme(DEFAULT_REF);
    }
    return wasActive;
  }

  /** Inject the appropriate stylesheet element for the given ref. */
  async loadTheme(ref: CustomThemeRef): Promise<void> {
    this._unloadCurrentTheme();

    if (ref.kind === 'builtin') {
      const theme = BUILT_IN_THEMES.find((t) => t.id === ref.id);
      if (!theme) {
        Log.err({ themeId: ref.id, kind: ref.kind, reason: 'unknown built-in theme' });
        return;
      }
      if (theme.id === 'default' || !theme.url) {
        return;
      }
      const link = this._document.createElement('link');
      link.rel = 'stylesheet';
      link.href = theme.url;
      link.id = STYLESHEET_ID;
      this._document.head.appendChild(link);
      return;
    }

    // User theme — read CSS from IDB and inject a <style> element.
    const stored = await this._themeStorage.getTheme(ref.id);
    if (!stored) {
      Log.err({ themeId: ref.id, kind: ref.kind, reason: 'theme not found in storage' });
      // Active theme reset on missing data so the picker doesn't get stuck.
      await this.setActiveTheme(DEFAULT_REF);
      return;
    }
    // Re-validate cached CSS — a previous client may have stored bytes the
    // current validator now rejects (e.g. an `image-set` payload from before
    // the v2 validator landed). Treat a failed re-validation like a missing
    // theme: log structured, fall back to default, do not inject.
    const validation = validateThemeCss(stored.css);
    if (!validation.isValid) {
      Log.err({ themeId: ref.id, reason: 'cached-css-failed-validation' });
      await this.setActiveTheme(DEFAULT_REF);
      return;
    }
    const style = this._document.createElement('style');
    style.id = STYLESHEET_ID;
    style.textContent = stored.css;
    this._document.head.appendChild(style);
  }

  private _unloadCurrentTheme(): void {
    const existing = this._document.getElementById(STYLESHEET_ID);
    if (existing) {
      existing.remove();
    }
  }
}
