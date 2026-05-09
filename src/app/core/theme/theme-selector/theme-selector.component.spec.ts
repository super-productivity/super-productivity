import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ThemeSelectorComponent } from './theme-selector.component';
import { GlobalThemeService } from '../global-theme.service';
import { CustomThemeService } from '../custom-theme.service';
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

  const buildComponent = (): ThemeSelectorComponent => {
    TestBed.configureTestingModule({
      imports: [ThemeSelectorComponent],
      providers: [
        {
          provide: GlobalThemeService,
          useValue: {
            darkMode: signal('system'),
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
        activeRef: signal({ kind: 'builtin' as const, id: 'default' }),
        themes: signal([]),
      },
    );
    customMock.setActiveTheme.and.resolveTo();
    snackMock = jasmine.createSpyObj<SnackService>('SnackService', ['open']);
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
