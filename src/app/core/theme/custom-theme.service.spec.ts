import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import {
  CustomThemeService,
  getRequiredThemeMode,
  pickInitialActiveRef,
} from './custom-theme.service';
import { LS } from '../persistence/storage-keys.const';
import { StoredTheme, ThemeStorageService } from './theme-storage.service';

const STYLESHEET_ID = 'custom-theme-stylesheet';

const deferred = <T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
};

const finishBuiltInLoad = async <T>(
  operation: Promise<T>,
  themeId: string,
): Promise<T> => {
  await Promise.resolve();
  const pending = document.querySelector<HTMLLinkElement>(
    `link[href*="assets/themes/${themeId}.css"]`,
  );
  expect(pending).withContext(`pending ${themeId} stylesheet`).not.toBeNull();
  pending?.dispatchEvent(new Event('load'));
  return operation;
};

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
    document
      .querySelectorAll('[data-custom-theme-candidate]')
      .forEach((candidate) => candidate.remove());
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
    await finishBuiltInLoad(
      service.loadTheme({ kind: 'builtin', id: 'dracula' }),
      'dracula',
    );
    const el = document.getElementById(STYLESHEET_ID);
    expect(el?.tagName).toBe('LINK');
    expect((el as HTMLLinkElement).href).toContain('assets/themes/dracula.css');
  });

  it('keeps the current theme active until a built-in stylesheet finishes loading', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
    const current = document.createElement('style');
    current.id = STYLESHEET_ID;
    current.textContent = ':root { --current-theme: dracula; }';
    document.head.appendChild(current);
    const service = buildService();

    let settled = false;
    const selection = service.setActiveTheme({ kind: 'builtin', id: 'arc' });
    void selection.then(() => (settled = true));
    await Promise.resolve();

    expect(current.isConnected).toBeTrue();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
    expect(settled).toBeFalse();
    expect(service.appliedThemeVersion()).toBe(0);

    const pending = document.querySelector<HTMLLinkElement>(
      'link[href*="assets/themes/arc.css"]',
    );
    expect(pending).not.toBeNull();
    pending?.dispatchEvent(new Event('load'));

    expect(await selection).toBeTrue();
    expect(current.isConnected).toBeFalse();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'arc' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:arc');
    expect(service.appliedThemeVersion()).toBe(1);
  });

  it('keeps the current theme and selection when a built-in stylesheet fails to load', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
    const current = document.createElement('style');
    current.id = STYLESHEET_ID;
    current.textContent = ':root { --current-theme: dracula; }';
    document.head.appendChild(current);
    const service = buildService();

    const selection = service.setActiveTheme({ kind: 'builtin', id: 'arc' });
    await Promise.resolve();
    const pending = document.querySelector<HTMLLinkElement>(
      'link[href*="assets/themes/arc.css"]',
    );
    expect(pending).not.toBeNull();
    pending?.dispatchEvent(new Event('error'));

    expect(await selection).toBeFalse();
    expect(current.isConnected).toBeTrue();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
    expect(service.appliedThemeVersion()).toBe(0);
  });

  it('does not let a stale built-in stylesheet replace a newer selection', async () => {
    const service = buildService();

    const firstSelection = service.setActiveTheme({ kind: 'builtin', id: 'arc' });
    await Promise.resolve();
    const staleLink = document.querySelector<HTMLLinkElement>(
      'link[href*="assets/themes/arc.css"]',
    );

    const secondSelection = service.setActiveTheme({
      kind: 'builtin',
      id: 'dracula',
    });
    await Promise.resolve();
    const currentLink = document.querySelector<HTMLLinkElement>(
      'link[href*="assets/themes/dracula.css"]',
    );
    currentLink?.dispatchEvent(new Event('load'));

    expect(await secondSelection).toBeTrue();
    staleLink?.dispatchEvent(new Event('load'));
    expect(await firstSelection).toBeFalse();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
    expect(document.getElementById(STYLESHEET_ID)).toBe(currentLink);
    expect(staleLink?.isConnected).toBeFalse();
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

  it('does not let a stale missing user theme replace a newer valid selection', async () => {
    const firstLoad = deferred<StoredTheme | undefined>();
    storageMock.getTheme.and.callFake((id) => {
      if (id === 'first') return firstLoad.promise;
      return Promise.resolve({
        id: 'second',
        name: 'Second',
        css: ':root { --selected-theme: second; }',
        uploadDate: 2,
      });
    });
    const service = buildService();

    const firstSelection = service.setActiveTheme({ kind: 'user', id: 'first' });
    const secondSelection = service.setActiveTheme({ kind: 'user', id: 'second' });

    expect(await secondSelection).toBeTrue();
    firstLoad.resolve(undefined);
    expect(await firstSelection).toBeFalse();

    expect(service.activeRef()).toEqual({ kind: 'user', id: 'second' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('user:second');
    expect(document.getElementById(STYLESHEET_ID)?.textContent).toContain(
      '--selected-theme: second',
    );
  });

  it('does not let stale user-theme CSS overwrite a newer selection', async () => {
    const firstLoad = deferred<StoredTheme | undefined>();
    storageMock.getTheme.and.callFake((id) => {
      if (id === 'first') return firstLoad.promise;
      return Promise.resolve({
        id: 'second',
        name: 'Second',
        css: ':root { --selected-theme: second; }',
        uploadDate: 2,
      });
    });
    const service = buildService();

    const firstSelection = service.setActiveTheme({ kind: 'user', id: 'first' });
    const secondSelection = service.setActiveTheme({ kind: 'user', id: 'second' });
    expect(await secondSelection).toBeTrue();

    firstLoad.resolve({
      id: 'first',
      name: 'First',
      css: ':root { --selected-theme: first; }',
      uploadDate: 1,
    });
    expect(await firstSelection).toBeFalse();

    expect(service.activeRef()).toEqual({ kind: 'user', id: 'second' });
    expect(document.getElementById(STYLESHEET_ID)?.textContent).toContain(
      '--selected-theme: second',
    );
  });

  it('falls back consistently when an unknown built-in is selected', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
    const current = document.createElement('style');
    current.id = STYLESHEET_ID;
    document.head.appendChild(current);
    const service = buildService();

    expect(
      await service.setActiveTheme({ kind: 'builtin', id: 'not-a-theme' }),
    ).toBeFalse();

    expect(current.isConnected).toBeFalse();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:default');
  });

  it('repairs an unknown stored built-in when applying the cold-start theme', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:not-a-theme');
    const service = buildService();

    await service.applyActiveTheme();

    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:default');
    expect(document.getElementById(STYLESHEET_ID)).toBeNull();
  });

  it('repairs a malformed stored reference when applying the cold-start theme', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'malformed');
    const service = buildService();

    await service.applyActiveTheme();

    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'default' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:default');
  });

  it('preserves the active theme when user-theme storage cannot be read', async () => {
    localStorage.setItem(LS.CUSTOM_THEME, 'builtin:dracula');
    const current = document.createElement('style');
    current.id = STYLESHEET_ID;
    document.head.appendChild(current);
    storageMock.getTheme.and.rejectWith(new Error('IndexedDB unavailable'));
    const service = buildService();

    await expectAsync(
      service.setActiveTheme({ kind: 'user', id: 'unreadable' }),
    ).toBeResolvedTo(false);
    expect(current.isConnected).toBeTrue();
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
  });

  it('keeps an applied theme live when localStorage cannot persist the selection', async () => {
    storageMock.getTheme.and.resolveTo({
      id: 'local-only',
      name: 'Local only',
      css: ':root { --selected-theme: local-only; }',
      uploadDate: 1,
    });
    const service = buildService();
    spyOn(localStorage, 'setItem').and.throwError('storage denied');

    await expectAsync(
      service.setActiveTheme({ kind: 'user', id: 'local-only' }),
    ).toBeResolvedTo(true);

    expect(service.activeRef()).toEqual({ kind: 'user', id: 'local-only' });
    expect(service.appliedThemeVersion()).toBe(1);
    expect(document.getElementById(STYLESHEET_ID)?.textContent).toContain(
      '--selected-theme: local-only',
    );
  });

  it('writes back to localStorage when setActiveTheme is called', async () => {
    const service = buildService();
    await finishBuiltInLoad(
      service.setActiveTheme({ kind: 'builtin', id: 'dracula' }),
      'dracula',
    );
    expect(localStorage.getItem(LS.CUSTOM_THEME)).toBe('builtin:dracula');
    expect(service.activeRef()).toEqual({ kind: 'builtin', id: 'dracula' });
  });

  it('replaces the previous stylesheet when switching themes', async () => {
    const service = buildService();
    await finishBuiltInLoad(
      service.loadTheme({ kind: 'builtin', id: 'dracula' }),
      'dracula',
    );
    await finishBuiltInLoad(service.loadTheme({ kind: 'builtin', id: 'arc' }), 'arc');
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
    await finishBuiltInLoad(service.applyActiveTheme(), 'dracula');
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
      await finishBuiltInLoad(service.migrateLegacyCustomTheme('dracula'), 'dracula');
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

describe('getRequiredThemeMode()', () => {
  it('returns only fixed built-in modes', () => {
    expect(getRequiredThemeMode({ kind: 'builtin', id: 'arc' })).toBe('dark');
    expect(getRequiredThemeMode({ kind: 'builtin', id: 'nord-snow-storm' })).toBe(
      'light',
    );
    expect(getRequiredThemeMode({ kind: 'builtin', id: 'plainspace' })).toBeUndefined();
    expect(getRequiredThemeMode({ kind: 'user', id: 'arc' })).toBeUndefined();
  });
});
