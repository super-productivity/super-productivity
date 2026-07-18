import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ThemeSelectorComponent } from './theme-selector.component';
import { GlobalThemeService } from '../global-theme.service';
import { CustomTheme, CustomThemeService } from '../custom-theme.service';
import { ThemeStorageService, StoredTheme } from '../theme-storage.service';
import { SnackService } from '../../snack/snack.service';
import { TranslateService } from '@ngx-translate/core';
import { T } from '../../../t.const';

const makeFile = (name: string, contents: string): File =>
  new File([contents], name, { type: 'text/css' });

describe('ThemeSelectorComponent — install warnings', () => {
  let storageMock: jasmine.SpyObj<ThemeStorageService>;
  let customMock: jasmine.SpyObj<CustomThemeService>;
  let snackMock: jasmine.SpyObj<SnackService>;
  const darkMode = signal<'system' | 'dark' | 'light'>('system');
  const activeRef = signal({ kind: 'builtin' as const, id: 'default' });
  const themes = signal<CustomTheme[]>([]);

  const buildComponent = (): ThemeSelectorComponent => {
    TestBed.configureTestingModule({
      imports: [ThemeSelectorComponent],
      providers: [
        {
          provide: GlobalThemeService,
          useValue: {
            darkMode,
          },
        },
        { provide: CustomThemeService, useValue: customMock },
        { provide: ThemeStorageService, useValue: storageMock },
        { provide: SnackService, useValue: snackMock },
        {
          provide: TranslateService,
          useValue: { instant: (k: string) => k, get: () => ({ subscribe: () => {} }) },
        },
      ],
    });
    return TestBed.createComponent(ThemeSelectorComponent).componentInstance;
  };

  beforeEach(() => {
    storageMock = jasmine.createSpyObj<ThemeStorageService>('ThemeStorageService', [
      'installFromFile',
    ]);
    customMock = Object.assign(
      jasmine.createSpyObj<CustomThemeService>('CustomThemeService', ['setActiveTheme']),
      {
        activeRef,
        themes,
      },
    );
    customMock.setActiveTheme.and.resolveTo(true);
    snackMock = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
    darkMode.set('system');
    activeRef.set({ kind: 'builtin', id: 'default' });
    themes.set([]);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  /**
   * Stub a `change` event with a single file attached. The component reads
   * `event.target.files[0]` and resets `event.target.value`, so we hand it
   * a minimal HTMLInputElement-like object.
   */
  const makeFileEvent = (file: File): Event =>
    ({
      target: { files: [file], value: 'x' } as unknown as HTMLInputElement,
    }) as unknown as Event;

  const makeThemeSelection = (
    value: string,
  ): Parameters<ThemeSelectorComponent['updateCustomTheme']>[0] =>
    ({ value }) as Parameters<ThemeSelectorComponent['updateCustomTheme']>[0];

  it('distinguishes built-in and user themes that share a filename slug', () => {
    const cmp = buildComponent();

    expect(cmp.optionValue({ id: 'arc', name: 'Arc', kind: 'builtin' })).toBe(
      'builtin:arc',
    );
    expect(cmp.optionValue({ id: 'arc', name: 'Arc fork', kind: 'user' })).toBe(
      'user:arc',
    );
  });

  it('preserves an explicit mode when selecting a dual-mode theme', async () => {
    darkMode.set('dark');
    themes.set([
      {
        id: 'plainspace',
        name: 'Plainspace',
        kind: 'builtin',
        requiredMode: 'system',
      },
    ]);
    const cmp = buildComponent();

    await cmp.updateCustomTheme(makeThemeSelection('builtin:plainspace'));

    expect(darkMode()).toBe('dark');
  });

  it('applies the declared mode for dark-only and light-only themes', async () => {
    themes.set([
      { id: 'arc', name: 'Arc', kind: 'builtin', requiredMode: 'dark' },
      {
        id: 'nord-snow-storm',
        name: 'Nord Snow Storm',
        kind: 'builtin',
        requiredMode: 'light',
      },
    ]);
    const cmp = buildComponent();

    darkMode.set('light');
    await cmp.updateCustomTheme(makeThemeSelection('builtin:arc'));
    expect(darkMode()).toBe('dark');

    await cmp.updateCustomTheme(makeThemeSelection('builtin:nord-snow-storm'));
    expect(darkMode()).toBe('light');
  });

  it('does not apply a mode for a theme selection that failed', async () => {
    darkMode.set('light');
    themes.set([{ id: 'arc', name: 'Arc', kind: 'builtin', requiredMode: 'dark' }]);
    customMock.setActiveTheme.and.resolveTo(false);
    const cmp = buildComponent();

    await cmp.updateCustomTheme(makeThemeSelection('builtin:arc'));

    expect(darkMode()).toBe('light');
  });

  it('does not allow a fixed-mode theme to be switched into an incompatible mode', () => {
    activeRef.set({ kind: 'builtin', id: 'arc' });
    themes.set([{ id: 'arc', name: 'Arc', kind: 'builtin', requiredMode: 'dark' }]);
    darkMode.set('dark');
    const cmp = buildComponent();

    cmp.updateDarkMode({
      value: 'light',
    } as Parameters<ThemeSelectorComponent['updateDarkMode']>[0]);

    expect(darkMode()).toBe('dark');
  });

  it('opens a warning snack when installFromFile returns warnings', async () => {
    const stored: StoredTheme = {
      id: 'spartan',
      name: 'Spartan',
      css: ':root { --bg: #111; }',
      uploadDate: 1,
      warnings: [{ token: '--surface-1' }, { token: '--ink' }],
    };
    storageMock.installFromFile.and.resolveTo(stored);

    const cmp = buildComponent();
    await cmp.onFileSelected(makeFileEvent(makeFile('spartan.css', ':root {}')));

    expect(snackMock.open).toHaveBeenCalledTimes(1);
    const arg = snackMock.open.calls.mostRecent().args[0] as {
      type: string;
      msg: string;
      translateParams: { tokens: string };
    };
    expect(arg.type).toBe('CUSTOM');
    expect(arg.msg).toBe(T.GCF.MISC.THEME_INSTALLED_WITH_WARNINGS);
    expect(arg.translateParams.tokens).toContain('--surface-1');
    expect(arg.translateParams.tokens).toContain('--ink');
  });

  it('does not open a snack when installFromFile returns no warnings', async () => {
    const stored: StoredTheme = {
      id: 'complete',
      name: 'Complete',
      css: '/* complete contract */',
      uploadDate: 1,
    };
    storageMock.installFromFile.and.resolveTo(stored);

    const cmp = buildComponent();
    await cmp.onFileSelected(makeFileEvent(makeFile('complete.css', ':root {}')));

    expect(snackMock.open).not.toHaveBeenCalled();
  });
});
