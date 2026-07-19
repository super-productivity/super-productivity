import { computed, inject, Injectable, signal, Signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { Log } from '../log';
import { LS } from '../persistence/storage-keys.const';
import { StoredTheme, ThemeStorageService } from './theme-storage.service';
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
   * Built-ins satisfy the required contract and never set this. The picker
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

const refsEqual = (a: CustomThemeRef, b: CustomThemeRef): boolean =>
  a.kind === b.kind && a.id === b.id;

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
    id: 'plainspace',
    name: 'Plainspace',
    kind: 'builtin',
    url: 'assets/themes/plainspace.css',
    requiredMode: 'system',
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    kind: 'builtin',
    url: 'assets/themes/rainbow.css',
    // Neon glow pass needs a dark canvas — picking it auto-applies dark mode.
    requiredMode: 'dark',
  },
  {
    id: 'velvet',
    name: 'Velvet',
    kind: 'builtin',
    url: 'assets/themes/velvet.css',
    requiredMode: 'dark',
  },
];

/** Return the mode a fixed-mode built-in requires; dual-mode and user themes are free. */
export const getRequiredThemeMode = (
  ref: CustomThemeRef,
): 'dark' | 'light' | undefined => {
  if (ref.kind !== 'builtin') return undefined;
  const requiredMode = BUILT_IN_THEMES.find((theme) => theme.id === ref.id)?.requiredMode;
  return requiredMode === 'dark' || requiredMode === 'light' ? requiredMode : undefined;
};

@Injectable({ providedIn: 'root' })
export class CustomThemeService {
  private _document = inject<Document>(DOCUMENT);
  private _themeStorage = inject(ThemeStorageService);
  private _loadRequestGeneration = 0;

  private _activeRef = signal<CustomThemeRef>(
    pickInitialActiveRef(localStorage.getItem(LS.CUSTOM_THEME), IS_APPLE_SILICON),
  );
  private _appliedThemeVersion = signal(0);

  /** The currently selected theme reference. */
  readonly activeRef: Signal<CustomThemeRef> = this._activeRef.asReadonly();

  /** Increments after a stylesheet has been successfully applied. */
  readonly appliedThemeVersion: Signal<number> = this._appliedThemeVersion.asReadonly();

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

  /** Apply the currently-selected theme during startup. */
  async applyActiveTheme(): Promise<void> {
    const activeRef = this._activeRef();
    const storedRef = localStorage.getItem(LS.CUSTOM_THEME);
    const shouldRepairStoredRef =
      storedRef !== null && storedRef !== serializeRef(activeRef);
    await this._activateTheme(activeRef, shouldRepairStoredRef);
  }

  /**
   * Load a requested selection and persist it only after the stylesheet is
   * active. Returns false when the request failed, was superseded, or had to
   * fall back, allowing callers to avoid applying stale companion state.
   */
  async setActiveTheme(ref: CustomThemeRef): Promise<boolean> {
    return this._activateTheme(ref, true);
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
    await this._activateTheme(ref, false);
  }

  private async _activateTheme(
    ref: CustomThemeRef,
    persistSelection: boolean,
  ): Promise<boolean> {
    const requestGeneration = ++this._loadRequestGeneration;
    const appliedRef = await this._applyTheme(ref, requestGeneration);
    if (!appliedRef || requestGeneration !== this._loadRequestGeneration) return false;

    const requestedThemeWasApplied = refsEqual(appliedRef, ref);
    if (persistSelection || !requestedThemeWasApplied) {
      this._commitActiveRef(appliedRef);
    }
    this._markThemeApplied();
    return requestedThemeWasApplied;
  }

  private async _applyTheme(
    ref: CustomThemeRef,
    requestGeneration: number,
  ): Promise<CustomThemeRef | undefined> {
    if (requestGeneration !== this._loadRequestGeneration) return undefined;

    if (ref.kind === 'builtin') {
      const theme = BUILT_IN_THEMES.find((t) => t.id === ref.id);
      if (!theme) {
        Log.err({ themeId: ref.id, kind: ref.kind, reason: 'unknown built-in theme' });
        return this._applyDefaultTheme(requestGeneration);
      }
      if (theme.id === 'default' || !theme.url) {
        return this._applyDefaultTheme(requestGeneration);
      }
      return this._loadBuiltInTheme(ref, theme.url, requestGeneration);
    }

    // User theme — read CSS from IDB and inject a <style> element.
    let stored: StoredTheme | undefined;
    try {
      stored = await this._themeStorage.getTheme(ref.id);
    } catch {
      if (requestGeneration === this._loadRequestGeneration) {
        Log.err({
          themeId: ref.id,
          kind: ref.kind,
          reason: 'theme-storage-read-failed',
        });
      }
      return undefined;
    }
    if (requestGeneration !== this._loadRequestGeneration) return undefined;
    if (!stored) {
      Log.err({ themeId: ref.id, kind: ref.kind, reason: 'theme not found in storage' });
      return this._applyDefaultTheme(requestGeneration);
    }
    // Re-validate cached CSS — a previous client may have stored bytes the
    // current validator now rejects (e.g. an `image-set` payload from before
    // the v2 validator landed). Treat a failed re-validation like a missing
    // theme: log structured, fall back to default, do not inject.
    const validation = validateThemeCss(stored.css);
    if (!validation.isValid) {
      Log.err({ themeId: ref.id, reason: 'cached-css-failed-validation' });
      return this._applyDefaultTheme(requestGeneration);
    }
    const style = this._document.createElement('style');
    style.textContent = stored.css;
    return this._swapThemeElement(style, requestGeneration) ? ref : undefined;
  }

  private _loadBuiltInTheme(
    ref: CustomThemeRef,
    url: string,
    requestGeneration: number,
  ): Promise<CustomThemeRef | undefined> {
    return new Promise((resolve) => {
      const link = this._document.createElement('link');
      link.rel = 'stylesheet';
      link.href = url;
      // Load without applying so the current theme remains visually active
      // until the replacement stylesheet is ready.
      link.media = 'not all';
      link.setAttribute('data-custom-theme-candidate', '');

      const settle = (result: CustomThemeRef | undefined): void => {
        link.onload = null;
        link.onerror = null;
        resolve(result);
      };
      link.onload = (): void => {
        if (!this._swapThemeElement(link, requestGeneration)) {
          link.remove();
          settle(undefined);
          return;
        }
        settle(ref);
      };
      link.onerror = (): void => {
        link.remove();
        if (requestGeneration === this._loadRequestGeneration) {
          Log.err({ themeId: ref.id, kind: ref.kind, reason: 'stylesheet-load-failed' });
        }
        settle(undefined);
      };

      this._document.head.appendChild(link);
    });
  }

  private _applyDefaultTheme(requestGeneration: number): CustomThemeRef | undefined {
    if (requestGeneration !== this._loadRequestGeneration) return undefined;
    this._unloadCurrentTheme();
    return DEFAULT_REF;
  }

  private _swapThemeElement(
    next: HTMLLinkElement | HTMLStyleElement,
    requestGeneration: number,
  ): boolean {
    if (requestGeneration !== this._loadRequestGeneration) return false;

    const current = this._document.getElementById(STYLESHEET_ID);
    if (!next.isConnected) {
      next.id = `${STYLESHEET_ID}-candidate`;
      this._document.head.appendChild(next);
    }
    current?.remove();
    next.id = STYLESHEET_ID;
    next.removeAttribute('media');
    next.removeAttribute('data-custom-theme-candidate');
    return true;
  }

  private _commitActiveRef(ref: CustomThemeRef): void {
    this._activeRef.set(ref);
    try {
      localStorage.setItem(LS.CUSTOM_THEME, serializeRef(ref));
    } catch {
      // The stylesheet is already live. Keep the in-memory selection usable
      // for this session even when browser privacy/quota rules block storage.
      Log.err({ reason: 'theme-selection-persistence-failed' });
    }
  }

  private _markThemeApplied(): void {
    this._appliedThemeVersion.update((version) => version + 1);
  }

  private _unloadCurrentTheme(): void {
    const existing = this._document.getElementById(STYLESHEET_ID);
    if (existing) {
      existing.remove();
    }
  }
}
