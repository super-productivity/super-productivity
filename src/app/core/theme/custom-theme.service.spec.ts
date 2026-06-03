import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { CustomThemeService, pickInitialActiveRef } from './custom-theme.service';
import { LS } from '../persistence/storage-keys.const';
import { StoredTheme, ThemeStorageService } from './theme-storage.service';

const STYLESHEET_ID = 'custom-theme-stylesheet';

describe('CustomThemeService', () => {
  const themesSignal = signal<StoredTheme[]>([]);
  let storageMock: jasmine.SpyObj<ThemeStorageService> & {
    themes: typeof themesSignal;
  };

  const buildService = (): CustomThemeService => {
    TestBed.configureTestingModule({
      providers: [
        CustomThemeService,
        { provide: ThemeStorageService, useValue: storageMock },
      ],
    });
    return TestBed.inject(CustomThemeService);
  };

  beforeEach(() => {
    localStorage.removeItem(LS.CUSTOM_THEME);
    document.getElementById(STYLESHEET_ID)?.remove();
    themesSignal.set([]);
    storageMock = Object.assign(
      jasmine.createSpyObj<ThemeStorageService>('ThemeStorageService', [
        'installFromFile',
        'removeTheme',
        'getTheme',
        'listThemes',
      ]),
      { themes: themesSignal },
    );
    storageMock.getTheme.and.resolveTo(undefined);
    storageMock.listThemes.and.resolveTo([]);
  });

  afterEach(() => {
    localStorage.removeItem(LS.CUSTOM_THEME);
    document.getElementById(STYLESHEET_ID)?.remove();
    TestBed.resetTestingModule();
  });

  it('reads cold-start theme from localStorage on construction', () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
    const service = buildService();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
  });

  it('falls back to default when LS.CUSTOM_THEME is missing or malformed', () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'garbage');
    const service = buildService();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
  });

  it('injects a <link> stylesheet for built-in themes', async () => {
    const service = buildService();
    await service.loadTheme({ kind: 'builtin', id: 'dracula' });
    const el = document.getElementById(STYLESHEET_ID);
    expect(el?.tagName).toBe('LINK');
    expect((el as HTMLLinkElement).href).toContain('assets/themes/dracula.css');
  });

  it('injects no stylesheet for the default built-in', async () => {
    const service = buildService();
    await service.loadTheme({ kind: 'builtin', id: 'default' });
    expect(document.getElementById(STYLESHEET_ID)).toBeNull();
  });

  it('injects a <style> element for user themes from storage', async () => {
    storageMock.getTheme.and.resolveTo({
      id: 'dracula',
      name: 'Dracula',
      css: ':root { --bg: #282a36; }',
      uploadDate: 1,
    });
    const service = buildService();
    await service.loadTheme({ kind: 'user', id: 'dracula' });
    const el = document.getElementById(STYLESHEET_ID);
    expect(el?.tagName).toBe('STYLE');
    expect(el?.textContent).toContain('--bg: #282a36');
  });

  it('falls back to default when a user theme is missing from storage', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'user:gone');
    storageMock.getTheme.and.resolveTo(undefined);
    const service = buildService();
    await service.loadTheme({ kind: 'user', id: 'gone' });
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:default');
  });

  it('falls back to default when cached CSS fails re-validation', async () => {
    // A theme persisted by an older client may contain bytes the current
    // validator rejects. We must not inject those bytes blindly on load.
    localStorage.setItem(LS.CUSTOM_THEME, 'user:stale');
    storageMock.getTheme.and.resolveTo({
      id: 'stale',
      name: 'Stale',
      css: 'a { background: url(http://evil/x); }',
      uploadDate: 1,
    });
    const service = buildService();
    await service.loadTheme({ kind: 'user', id: 'stale' });
    expect(document.getElementById(STYLESHEET_ID)).toBeNull();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:default');
  });

  it('writes back to localStorage when setActiveTheme is called', async () => {
    const service = buildService();
    await service.setActiveTheme({ kind: 'builtin', id: 'dracula' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
  });

  it('replaces the previous stylesheet when switching themes', async () => {
    const service = buildService();
    await service.loadTheme({ kind: 'builtin', id: 'dracula' });
    await service.loadTheme({ kind: 'builtin', id: 'arc' });
    const elements = document.querySelectorAll(`#${STYLESHEET_ID}`);
    expect(elements.length).toBe(1);
    expect((elements[0] as HTMLLinkElement).href).toContain('assets/themes/arc.css');
  });

  it('exposes built-ins followed by user themes in the themes signal', () => {
    themesSignal.set([{ id: 'mine', name: 'Mine', css: 'a {}', uploadDate: 1 }]);
    const service = buildService();
    const all = service.themes();
    expect(all[0].id).toBe('default');
    expect(all[0].kind).toBe('builtin');
    const userEntry = all.find((t) => t.id === 'mine');
    expect(userEntry?.kind).toBe('user');
  });

  it('carries StoredTheme.warnings onto the listed CustomTheme entry', () => {
    themesSignal.set([
      {
        id: 'spartan',
        name: 'Spartan',
        css: ':root { --bg: #111; }',
        uploadDate: 1,
        warnings: [{ token: '--ink' }],
      },
    ]);
    const service = buildService();
    const userEntry = service.themes().find((t) => t.id === 'spartan');
    expect(userEntry?.warnings?.length).toBe(1);
    expect(userEntry?.warnings?.[0].token).toBe('--ink');
  });

  it('applyActiveTheme loads whatever activeRef currently points at', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
    const service = buildService();
    await service.applyActiveTheme();
    const el = document.getElementById(STYLESHEET_ID);
    expect(el?.tagName).toBe('LINK');
    expect((el as HTMLLinkElement).href).toContain('dracula.css');
  });

  describe('removeUserTheme', () => {
    it('deletes IDB and resets LS/signal/stylesheet when the removed theme is active', async () => {
      // Install + select a user theme so it's the active one.
      storageMock.getTheme.and.resolveTo({
        id: 'mine',
        name: 'Mine',
        css: 'a {}',
        uploadDate: 1,
      });
      storageMock.removeTheme.and.resolveTo();
      const service = buildService();
      await service.setActiveTheme({ kind: 'user', id: 'mine' });
      expect(document.getElementById(STYLESHEET_ID)?.tagName).toBe('STYLE');

      // Switch to default getTheme behavior so the post-remove default-load
      // doesn't try to fetch a user theme.
      storageMock.getTheme.and.resolveTo(undefined);

      const wasActive = await service.removeUserTheme('mine');

      expect(storageMock.removeTheme).toHaveBeenCalledWith('mine');
      expect(wasActive).toBe(true);
      expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:default');
      // Default built-in injects no stylesheet element.
      expect(document.getElementById(STYLESHEET_ID)).toBeNull();
    });

    it('leaves the active theme alone when removing a different one', async () => {
      localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
      storageMock.removeTheme.and.resolveTo();
      const service = buildService();

      const wasActive = await service.removeUserTheme('other');

      expect(storageMock.removeTheme).toHaveBeenCalledWith('other');
      expect(wasActive).toBe(false);
      expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
    });

    it('propagates IDB delete errors so the caller can surface them', async () => {
      storageMock.removeTheme.and.rejectWith(new Error('boom'));
      const service = buildService();
      await expectAsync(service.removeUserTheme('mine')).toBeRejectedWithError('boom');
    });
  });

  describe('migrateLegacyCustomTheme', () => {
    it('is a no-op when LS is already populated', async () => {
      localStorage.setItem(LS.CUSTOM_THEME, 'builtin:arc');
      const service = buildService();
      await service.migrateLegacyCustomTheme('dracula');
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:arc');
      expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'arc' });
    });

    it('is a no-op for missing/default/empty legacy ids', async () => {
      const service = buildService();
      await service.migrateLegacyCustomTheme(undefined);
      await service.migrateLegacyCustomTheme('');
      await service.migrateLegacyCustomTheme('default');
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBeNull();
    });

    it('is a no-op for unknown legacy ids (allowlist enforced)', async () => {
      const service = buildService();
      await service.migrateLegacyCustomTheme('not-a-real-theme');
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBeNull();
      expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
    });

    it('promotes a known built-in id into LS and applies the theme', async () => {
      const service = buildService();
      await service.migrateLegacyCustomTheme('dracula');
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
      expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
      const el = document.getElementById(STYLESHEET_ID);
      expect(el?.tagName).toBe('LINK');
      expect((el as HTMLLinkElement).href).toContain('assets/themes/dracula.css');
    });
  });

  describe('pickInitialActiveRef', () => {
    // First-run platform default. The Apple Silicon branch is exercised
    // here because the module-level `IS_APPLE_SILICON` constant can't be
    // toggled per test without monkey-patching window.ea.

    it('honors a stored selection regardless of platform', () => {
      expect(pickInitialActiveRef('builtin:dracula', true)).toEqual({
        kind: 'builtin',
        id: 'dracula',
      });
      expect(pickInitialActiveRef('builtin:dracula', false)).toEqual({
        kind: 'builtin',
        id: 'dracula',
      });
    });

    it('falls back to default when stored value is missing or malformed', () => {
      expect(pickInitialActiveRef(null, false)).toEqual({
        kind: 'builtin',
        id: 'default',
      });
      expect(pickInitialActiveRef('garbage', false)).toEqual({
        kind: 'builtin',
        id: 'default',
      });
    });

    it('picks Liquid Glass on first run for Apple Silicon Macs', () => {
      expect(pickInitialActiveRef(null, true)).toEqual({
        kind: 'builtin',
        id: 'liquid-glass',
      });
    });

    it('does not write the platform default to LS — leaves it for legacy migration', () => {
      // `migrateLegacyCustomTheme` short-circuits when LS already has a
      // value. Persisting on first run would lock new Apple Silicon Macs
      // out of inheriting a synced device's theme choice.
      pickInitialActiveRef(null, true);
      expect(localStorage.getItem(LS.CUSTOM_THEME)).toBeNull();
    });
  });
});
