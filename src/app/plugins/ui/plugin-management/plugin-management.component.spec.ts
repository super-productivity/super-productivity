import { signal, WritableSignal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleChange } from '@angular/material/slide-toggle';
import { Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { TranslateModule, TranslateService } from '@ngx-translate/core';
import { of } from 'rxjs';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { SnackService } from '../../../core/snack/snack.service';
import { LayoutService } from '../../../core-ui/layout/layout.service';
import { PluginBridgeService } from '../../plugin-bridge.service';
import { PluginCacheService } from '../../plugin-cache.service';
import { PluginConfigService } from '../../plugin-config.service';
import { PluginMetaPersistenceService } from '../../plugin-meta-persistence.service';
import { PluginInstance, PluginManifest } from '../../plugin-api.model';
import { PluginService } from '../../plugin.service';
import { PluginState } from '../../plugin-state.model';
import {
  isPluginListed,
  PLUGIN_TAB_INDEX,
  PluginManagementComponent,
} from './plugin-management.component';
import { T } from '../../../t.const';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';
import { CommunityPlugin } from '../../util/community-plugin.util';
import { strToU8, zipSync } from 'fflate';

type PluginManifestWithAuthor = PluginManifest & { author?: string };

describe('PluginManagementComponent', () => {
  let fixture: ComponentFixture<PluginManagementComponent>;
  let component: PluginManagementComponent;
  let routerNavigateSpy: jasmine.Spy;
  let layoutToggleSpy: jasmine.Spy;
  let loadPluginFromZipSpy: jasmine.Spy;
  let snackOpenSpy: jasmine.Spy;
  let isShowIssuePanel: ReturnType<typeof signal<boolean>>;

  beforeEach(() => {
    loadPluginFromZipSpy = jasmine.createSpy('loadPluginFromZip');
    snackOpenSpy = jasmine.createSpy('open');
    routerNavigateSpy = jasmine
      .createSpy('navigate')
      .and.returnValue(Promise.resolve(true));
    layoutToggleSpy = jasmine.createSpy('toggleAddTaskPanel');
    isShowIssuePanel = signal(false);
    const pluginStates = signal(new Map<string, PluginState>());
    TestBed.configureTestingModule({
      imports: [PluginManagementComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: PluginService,
          useValue: {
            pluginStates,
            loadPluginFromZip: loadPluginFromZipSpy,
            getPluginPath: (id: string) => pluginStates().get(id)?.path,
            getPluginIconsSignal: () => signal(new Map()),
          },
        },
        {
          provide: PluginMetaPersistenceService,
          useValue: {},
        },
        {
          provide: PluginCacheService,
          useValue: {},
        },
        {
          provide: PluginConfigService,
          useValue: {},
        },
        {
          provide: GlobalConfigService,
          useValue: { localization: signal({ lng: 'en' }) },
        },
        {
          // Confirms by default (e.g. the install warning); tests override via stubConfirmDialog.
          provide: MatDialog,
          useValue: { open: () => ({ afterClosed: () => of(true) }) },
        },
        {
          provide: Router,
          useValue: { navigate: routerNavigateSpy },
        },
        {
          provide: LayoutService,
          useValue: { isShowIssuePanel, toggleAddTaskPanel: layoutToggleSpy },
        },
        {
          provide: Store,
          useValue: { selectSignal: () => signal([]) },
        },
        {
          provide: PluginBridgeService,
          useValue: { hasConfigHandler: () => false },
        },
        {
          provide: SnackService,
          useValue: { open: snackOpenSpy },
        },
      ],
    });

    fixture = TestBed.createComponent(PluginManagementComponent);
    component = fixture.componentInstance;
  });

  it('returns trimmed plugin author from the manifest', () => {
    const manifest: PluginManifestWithAuthor = {
      id: 'test-plugin',
      name: 'Test Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      hooks: [],
      permissions: [],
      author: '  Super Productivity  ',
    };

    expect(
      component.getPluginAuthor({
        manifest,
        loaded: false,
        isEnabled: false,
      }),
    ).toBe('Super Productivity');
  });

  it('hides missing or blank plugin authors', () => {
    const manifest: PluginManifestWithAuthor = {
      id: 'test-plugin',
      name: 'Test Plugin',
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      hooks: [],
      permissions: [],
    };
    const blankAuthorManifest: PluginManifestWithAuthor = {
      ...manifest,
      author: '   ',
    };

    expect(
      component.getPluginAuthor({
        manifest,
        loaded: false,
        isEnabled: false,
      }),
    ).toBeNull();

    expect(
      component.getPluginAuthor({
        manifest: blankAuthorManifest,
        loaded: false,
        isEnabled: false,
      }),
    ).toBeNull();
  });

  const zipInputEvent = (): Event => {
    const input = document.createElement('input');
    input.type = 'file';
    const file = new File(['zip'], 'plugin.zip');
    Object.defineProperty(input, 'files', { value: [file] });
    return { target: input } as unknown as Event;
  };

  it('shows a success snack after a plugin ZIP installs', async () => {
    loadPluginFromZipSpy.and.returnValue(
      Promise.resolve({ manifest: { id: 'my-plugin', name: 'My Plugin' } }),
    );

    await component.onFileSelected(zipInputEvent());

    expect(snackOpenSpy).toHaveBeenCalledWith({
      type: 'SUCCESS',
      msg: T.PLUGINS.PLUGIN_INSTALLED,
      translateParams: { name: 'My Plugin' },
    });
    expect(component.uploadError()).toBeNull();
  });

  it('shows no snack when the plugin loads but fails to run', async () => {
    loadPluginFromZipSpy.and.returnValue(
      Promise.resolve({
        manifest: { id: 'my-plugin', name: 'My Plugin' },
        error: 'boom',
      }),
    );

    await component.onFileSelected(zipInputEvent());

    expect(snackOpenSpy).not.toHaveBeenCalled();
  });

  it('shows the error instead of a snack when a plugin ZIP fails to install', async () => {
    loadPluginFromZipSpy.and.returnValue(Promise.reject(new Error('bad zip')));

    await component.onFileSelected(zipInputEvent());

    expect(snackOpenSpy).not.toHaveBeenCalled();
    expect(component.uploadError()).toBe('bad zip');
  });

  it('shows the risk warning before installing and installs only when confirmed', async () => {
    loadPluginFromZipSpy.and.returnValue(
      Promise.resolve({ manifest: { id: 'my-plugin', name: 'My Plugin' } }),
    );
    const openSpy = stubConfirmDialog(true);

    await component.onFileSelected(zipInputEvent());

    expect(openSpy).toHaveBeenCalledOnceWith(DialogConfirmComponent, {
      restoreFocus: true,
      data: {
        message: jasmine.stringContaining(T.PLUGINS.RISK_DATA_ACCESS),
        okTxt: T.PLUGINS.INSTALL_PLUGIN,
      },
    });
    expect(loadPluginFromZipSpy).toHaveBeenCalled();
  });

  it('installs nothing and clears the file input when the risk warning is cancelled', async () => {
    stubConfirmDialog(undefined);
    const event = zipInputEvent();
    const input = event.target as HTMLInputElement;
    const valueSetter = spyOnProperty(input, 'value', 'set');

    await component.onFileSelected(event);

    expect(loadPluginFromZipSpy).not.toHaveBeenCalled();
    expect(valueSetter).toHaveBeenCalledWith('');
    expect(component.isUploading()).toBe(false);
  });

  const baseManifest: PluginManifest = {
    id: 'github-issue-provider',
    name: 'GitHub Issues',
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: '1.0.0',
    hooks: [],
    permissions: [],
  };

  it('detects issue-provider plugins', () => {
    expect(
      component.isIssueProviderPlugin({
        manifest: { ...baseManifest, type: 'issueProvider' },
        loaded: true,
        isEnabled: true,
      }),
    ).toBe(true);

    expect(
      component.isIssueProviderPlugin({
        manifest: { ...baseManifest, type: 'standard' },
        loaded: true,
        isEnabled: true,
      }),
    ).toBe(false);
  });

  it('lists every declared permission exactly once, as checked access or as other', () => {
    const plugin = {
      manifest: {
        ...baseManifest,
        permissions: ['http', 'getTasks', 'nodeExecution'],
        allowedHosts: ['api.example.com'],
      },
      loaded: true,
      isEnabled: true,
    };

    expect(component.getApiAccess(plugin).map((a) => a.permission)).toEqual([
      'nodeExecution',
      'http',
    ]);
    expect(component.getOtherPermissions(plugin)).toEqual(['getTasks']);
  });

  it('lists "http" without allowed hosts as an other permission', () => {
    expect(
      component.getOtherPermissions({
        manifest: { ...baseManifest, permissions: ['http'] },
        loaded: true,
        isEnabled: true,
      }),
    ).toEqual(['http']);
  });

  describe('Community tab', () => {
    const normalize = (text: string | null | undefined): string =>
      (text ?? '').replace(/\s+/g, ' ').trim();
    const plugin = {
      name: 'X',
      shortDescription: '',
      url: 'https://example.com',
      author: 'someone',
      authorUrl: 'https://example.com/someone',
      id: 'x',
      release: { version: '2.0.0', downloadUrl: 'https://example.com/x.zip', sha256: '' },
    };

    beforeEach(() => {
      // A non-English language, so the test fails if a string stays hardcoded.
      const translateService = TestBed.inject(TranslateService);
      translateService.setTranslation('tr', {
        PLUGINS: {
          AUTHORED_BY: '{{author}} tarafından',
          COMMUNITY_GET_LISTED: 'Eklentinizi burada listeleyin',
          COMMUNITY_DOWNLOAD: 'v{{version}} indir',
          COMMUNITY_INSTALL: 'v{{version}} yükle',
          COMMUNITY_PLUGINS: 'Topluluk eklentileri',
          COMMUNITY_WARNING: 'Topluluk eklentileri incelenmez.',
          GROUP_UPLOADED: 'Yüklenen eklentiler',
          INSTALL_FROM_FILE: 'Dosyadan yükle',
          REMOVE_ALL_UPLOADED_PLUGINS: 'Yüklenen tüm eklentileri kaldır',
        },
      });
      translateService.use('tr');
      // A fixture instead of the real community-plugins.json, whose first entry
      // may lack the optional authorUrl or release.
      (component as { isInAppInstall: boolean }).isInAppInstall = true;
      component.communityPlugins.set([plugin]);
      component.selectedTabIndex.set(PLUGIN_TAB_INDEX.COMMUNITY);
      fixture.detectChanges();
    });

    const card = (): HTMLElement => fixture.nativeElement;
    const headings = (): string[] =>
      Array.from(card().querySelectorAll('h3'), (h) => normalize(h.textContent));

    it('translates the warning, the catalog heading and add-your-plugin link', () => {
      expect(headings()).toContain('Topluluk eklentileri');
      expect(
        normalize(
          card().querySelector('.community-header .community-warning')?.textContent,
        ),
      ).toBe('Topluluk eklentileri incelenmez.');
      const addYoursLink = card().querySelector<HTMLAnchorElement>(
        'a[href$="#get-listed-in-the-app"]',
      );
      expect(normalize(addYoursLink?.textContent)).toBe(
        'add Eklentinizi burada listeleyin',
      );
    });

    it('links the translated author line to the author', () => {
      const authorLink = card().querySelector('.community-plugin-item .plugin-author a');

      expect(normalize(authorLink?.textContent)).toBe(`${plugin.author} tarafından`);
      expect(authorLink?.getAttribute('href')).toBe(plugin.authorUrl);
    });

    it('offers a translated install button for an entry with a release', () => {
      const button = card().querySelector('.community-plugin-item button');

      expect(normalize(button?.textContent)).toBe('download v2.0.0 yükle');
    });

    it('links to the ZIP instead on web, where release hosts block the download', () => {
      (component as { isInAppInstall: boolean }).isInAppInstall = false;
      // A new list, so the OnPush view re-renders with the flag.
      component.communityPlugins.set([{ ...plugin }]);
      fixture.detectChanges();
      const item = card().querySelector('.community-plugin-item');
      const link = item?.querySelector<HTMLAnchorElement>('.community-plugin-action a');

      expect(item?.querySelector('button')).toBeNull();
      expect(link?.getAttribute('href')).toBe(plugin.release.downloadUrl);
      expect(normalize(link?.textContent)).toBe('download v2.0.0 indir');
    });

    it('offers no install button for a link-only entry', () => {
      component.communityPlugins.set([{ ...plugin, id: undefined, release: undefined }]);
      fixture.detectChanges();

      expect(card().querySelector('.community-plugin-item button')).toBeNull();
    });

    it('opens with one header row: the warning, an install button and a menu, no cards', () => {
      const header = card().querySelector('.community-header');
      const installButton = header?.querySelector('.community-header-actions button');

      expect(normalize(installButton?.textContent)).toBe('upload Dosyadan yükle');
      expect(header?.querySelector('.community-menu-btn')).not.toBeNull();
      expect(card().querySelector('mat-card')).toBeNull();
    });

    it('offers "Remove all uploaded plugins" in the header menu', async () => {
      const clearSpy = spyOn(component, 'clearPluginCache').and.resolveTo();
      card().querySelector<HTMLButtonElement>('.community-menu-btn')?.click();
      fixture.detectChanges();
      await fixture.whenStable();
      const item = document.querySelector<HTMLButtonElement>(
        '.cdk-overlay-container .mat-mdc-menu-item',
      );

      expect(normalize(item?.textContent)).toContain('Yüklenen tüm eklentileri kaldır');
      item?.click();
      expect(clearSpy).toHaveBeenCalledTimes(1);
    });

    it('lists uploaded plugins before the catalog', () => {
      const pluginStates = TestBed.inject(PluginService).pluginStates as WritableSignal<
        Map<string, PluginState>
      >;
      pluginStates.set(
        new Map([
          [
            'mine',
            {
              manifest: { ...baseManifest, id: 'mine', name: 'Mine' },
              status: 'not-loaded',
              path: 'uploaded://mine',
              type: 'uploaded',
              isEnabled: false,
            },
          ],
        ]),
      );
      fixture.detectChanges();

      expect(headings()).toEqual(['Yüklenen eklentiler', 'Topluluk eklentileri']);
    });
  });

  it('navigates to the work view and opens the issue panel', async () => {
    await component.goToIssuePanel();

    expect(routerNavigateSpy).toHaveBeenCalledWith(['/active/tasks']);
    expect(layoutToggleSpy).toHaveBeenCalledTimes(1);
  });

  it('does not re-toggle the panel when it is already open', async () => {
    isShowIssuePanel.set(true);

    await component.goToIssuePanel();

    expect(routerNavigateSpy).toHaveBeenCalledWith(['/active/tasks']);
    expect(layoutToggleSpy).not.toHaveBeenCalled();
  });

  describe('getPluginLanguages', () => {
    const pluginWithLanguages = (languages?: string[]): PluginInstance => ({
      manifest: {
        ...baseManifest,
        ...(languages ? { i18n: { languages } } : {}),
      },
      loaded: true,
      isEnabled: true,
    });

    it('names the languages in the UI language', () => {
      TestBed.inject(TranslateService).use('de');

      expect(component.getPluginLanguages(pluginWithLanguages(['de', 'fr']))).toBe(
        'Deutsch, Französisch',
      );
    });

    it('names English in the UI language for plugins without languages', () => {
      TestBed.inject(TranslateService).use('de');

      expect(component.getPluginLanguages(pluginWithLanguages())).toBe('Englisch');
      expect(component.getPluginLanguages(pluginWithLanguages([]))).toBe('Englisch');
      expect(component.getPluginLanguages(pluginWithLanguages(['en']))).toBe('Englisch');
    });

    it('names app locale codes with a region or script', () => {
      TestBed.inject(TranslateService).use('en');

      expect(
        component.getPluginLanguages(
          pluginWithLanguages(['pt-br', 'ro-md', 'zh', 'zh-tw']),
        ),
      ).toBe(
        'Portuguese (Brazil), Romanian (Moldova), Chinese (Simplified), Chinese (Traditional)',
      );
    });

    it('follows a UI language switch without recreating the component', () => {
      const translateService = TestBed.inject(TranslateService);
      const plugin = pluginWithLanguages(['fr']);

      translateService.use('en');
      expect(component.getPluginLanguages(plugin)).toBe('French');

      translateService.use('de');
      expect(component.getPluginLanguages(plugin)).toBe('Französisch');
    });

    it('falls back to the raw code for an invalid language code', () => {
      TestBed.inject(TranslateService).use('de');

      expect(
        component.getPluginLanguages(pluginWithLanguages(['de', 'not a code!'])),
      ).toBe('Deutsch, not a code!');
    });
  });

  // Stubs MatDialog.open so the confirm dialog closes with `result`:
  // true = confirmed, false = Cancel, undefined = Esc or backdrop click.
  const stubConfirmDialog = (result: boolean | undefined): jasmine.Spy => {
    const openSpy = jasmine
      .createSpy('open')
      .and.returnValue({ afterClosed: () => of(result) });
    Object.assign(TestBed.inject(MatDialog), { open: openSpy });
    return openSpy;
  };

  describe('plugin lists', () => {
    let pluginStates: WritableSignal<Map<string, PluginState>>;

    const state = (
      name: string,
      type: PluginState['type'],
      opts: { manifestType?: PluginManifest['type']; isEnabled?: boolean } = {},
    ): PluginState => {
      const id = name.toLowerCase().replace(/\s+/g, '-');
      return {
        manifest: { ...baseManifest, id, name, type: opts.manifestType },
        status: 'not-loaded',
        path: type === 'uploaded' ? `uploaded://${id}` : `assets/bundled-plugins/${id}`,
        type,
        isEnabled: opts.isEnabled ?? false,
      };
    };
    const setStates = (...states: PluginState[]): void =>
      pluginStates.set(new Map(states.map((st) => [st.manifest.id, st])));
    const names = (plugins: PluginInstance[]): string[] =>
      plugins.map((p) => p.manifest.name);
    const rowNames = (): string[] =>
      Array.from(
        fixture.nativeElement.querySelectorAll('.plugin-row .plugin-row-name'),
        (el: Element) => el.textContent?.trim() ?? '',
      );

    beforeEach(() => {
      pluginStates = TestBed.inject(PluginService).pluginStates as WritableSignal<
        Map<string, PluginState>
      >;
    });

    it('splits built-in plugins into features and integrations, each by name', () => {
      setStates(
        state('Zeta', 'built-in'),
        state('GitHub', 'built-in', { manifestType: 'issueProvider' }),
        state('alpha', 'built-in', { isEnabled: true }),
        state('Uploaded', 'uploaded', { manifestType: 'issueProvider' }),
        state('Azure', 'built-in', { manifestType: 'issueProvider' }),
      );

      expect(names(component.featurePlugins())).toEqual(['alpha', 'Zeta']);
      expect(names(component.integrationPlugins())).toEqual(['Azure', 'GitHub']);
    });

    it('lists the TickTick and Todoist importers and sync.md under integrations', () => {
      setStates(
        state('Todoist Import', 'built-in'),
        state('GitHub', 'built-in', { manifestType: 'issueProvider' }),
        state('TickTick Import', 'built-in'),
        state('Sync MD', 'built-in'),
        state('Brain Dump', 'built-in'),
      );

      expect(names(component.integrationPlugins())).toEqual([
        'GitHub',
        'Sync MD',
        'TickTick Import',
        'Todoist Import',
      ]);
      expect(names(component.featurePlugins())).toEqual(['Brain Dump']);
    });

    it('lists uploaded plugins by name, apart from the built-in ones', () => {
      setStates(
        state('Plugin 10', 'uploaded'),
        state('bundled', 'built-in'),
        state('Plugin 9', 'uploaded'),
        state('Écrire', 'uploaded'),
      );

      expect(names(component.uploadedPlugins())).toEqual([
        'Écrire',
        'Plugin 9',
        'Plugin 10',
      ]);
    });

    it('keeps the order when a plugin is enabled', () => {
      setStates(state('B', 'built-in'), state('A', 'built-in'));
      const before = names(component.featurePlugins());

      setStates(state('B', 'built-in', { isEnabled: true }), state('A', 'built-in'));

      expect(names(component.featurePlugins())).toEqual(before);
    });

    it('shows feature plugins by default and the others in their own tabs', async () => {
      setStates(
        state('Bundled', 'built-in'),
        state('GitHub', 'built-in', { manifestType: 'issueProvider' }),
        state('Uploaded', 'uploaded'),
      );
      fixture.detectChanges();
      await fixture.whenStable();

      expect(rowNames()).toEqual(['Bundled']);

      component.selectedTabIndex.set(PLUGIN_TAB_INDEX.INTEGRATIONS);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(rowNames()).toEqual(['GitHub']);

      component.selectedTabIndex.set(PLUGIN_TAB_INDEX.COMMUNITY);
      fixture.detectChanges();
      await fixture.whenStable();

      expect(rowNames()).toEqual(['Uploaded']);
      const row = fixture.nativeElement.querySelector('.plugin-row');
      expect(row.querySelector('.more-actions-btn')).not.toBeNull();
    });

    it('offers no "more actions" menu on built-in plugins, which cannot be removed', async () => {
      setStates(state('Bundled', 'built-in'));
      fixture.detectChanges();
      await fixture.whenStable();

      expect(fixture.nativeElement.querySelector('.more-actions-btn')).toBeNull();
    });

    it('shows the loading icon in the settings button slot, so the controls keep their place', async () => {
      const configurable = state('Configurable', 'built-in', { isEnabled: true });
      configurable.manifest.jsonSchemaCfg = 'config-schema.json';
      const slot = (): HTMLElement =>
        fixture.nativeElement.querySelector('.plugin-controls .control-slot');
      const controlCount = (): number =>
        fixture.nativeElement.querySelector('.plugin-controls').children.length;

      setStates({ ...configurable, status: 'loading' });
      fixture.detectChanges();
      await fixture.whenStable();
      const loadingControlCount = controlCount();

      expect(slot().querySelector('.loading-icon')).not.toBeNull();
      expect(slot().querySelector('button')).toBeNull();

      setStates({ ...configurable, status: 'loaded' });
      fixture.detectChanges();

      expect(slot().querySelector('.loading-icon')).toBeNull();
      expect(slot().querySelector('button')).not.toBeNull();
      expect(controlCount()).toBe(loadingControlCount);
    });

    it('opens and closes the details of one plugin from its summary', async () => {
      setStates(state('First', 'built-in'), state('Second', 'built-in'));
      fixture.detectChanges();
      await fixture.whenStable();
      const summaries = (): HTMLButtonElement[] =>
        Array.from(fixture.nativeElement.querySelectorAll('.plugin-summary'));

      expect(fixture.nativeElement.querySelector('.plugin-details')).toBeNull();

      summaries()[1].click();
      fixture.detectChanges();

      const details = fixture.nativeElement.querySelectorAll('.plugin-details');
      expect(details.length).toBe(1);
      expect(details[0].textContent).toContain('second');
      expect(summaries()[1].getAttribute('aria-expanded')).toBe('true');
      expect(summaries()[1].getAttribute('aria-controls')).toBe(details[0].id);
      expect(summaries()[0].getAttribute('aria-expanded')).toBe('false');

      summaries()[1].click();
      fixture.detectChanges();

      expect(fixture.nativeElement.querySelector('.plugin-details')).toBeNull();
    });

    describe('after a plugin ZIP installs', () => {
      const install = async (installed: PluginState): Promise<void> => {
        loadPluginFromZipSpy.and.callFake(async () => {
          pluginStates.update((states) =>
            new Map(states).set(installed.manifest.id, installed),
          );
          return { manifest: installed.manifest, loaded: false, isEnabled: false };
        });
        await component.onFileSelected(zipInputEvent());
        fixture.detectChanges();
        await fixture.whenStable();
      };

      it('shows the plugin in the "Community" tab, scrolled into view and highlighted', async () => {
        setStates(state('Bundled', 'built-in'));
        fixture.detectChanges();
        const scrollSpy = spyOn(HTMLElement.prototype, 'scrollIntoView');

        await install(state('New Plugin', 'uploaded'));

        expect(component.selectedTabIndex()).toBe(PLUGIN_TAB_INDEX.COMMUNITY);
        const highlighted = fixture.nativeElement.querySelectorAll('.isHighlighted');
        expect(highlighted.length).toBe(1);
        expect(highlighted[0].dataset.pluginId).toBe('new-plugin');
        expect(scrollSpy).toHaveBeenCalledOnceWith({
          behavior: 'smooth',
          block: 'center',
        });
        expect(scrollSpy.calls.mostRecent().object).toBe(highlighted[0]);
      });

      describe('with a mocked clock', () => {
        beforeEach(() => {
          jasmine.clock().install();
        });

        afterEach(() => {
          jasmine.clock().uninstall();
        });

        it('removes the highlight after a few seconds', async () => {
          await install(state('New Plugin', 'uploaded'));

          jasmine.clock().tick(2999);
          expect(component.highlightedPluginId()).toBe('new-plugin');

          jasmine.clock().tick(1);
          expect(component.highlightedPluginId()).toBeNull();
        });

        it('keeps a second upload highlighted for its full time', async () => {
          await install(state('First Plugin', 'uploaded'));
          jasmine.clock().tick(2000);

          await install(state('Second Plugin', 'uploaded'));
          jasmine.clock().tick(2000);

          expect(component.highlightedPluginId()).toBe('second-plugin');
        });
      });

      it('highlights nothing when the ZIP fails to install', async () => {
        loadPluginFromZipSpy.and.rejectWith(new Error('bad zip'));

        await component.onFileSelected(zipInputEvent());

        expect(component.highlightedPluginId()).toBeNull();
        expect(component.selectedTabIndex()).toBe(PLUGIN_TAB_INDEX.FEATURES);
      });
    });
  });

  describe('listed community plugins', () => {
    const zipBytes = new Uint8Array(
      zipSync({
        // eslint-disable-next-line @typescript-eslint/naming-convention
        'manifest.json': strToU8(JSON.stringify({ id: 'listed', version: '1.2.0' })),
      }),
    );
    let listed: CommunityPlugin;
    let pluginStates: WritableSignal<Map<string, PluginState>>;
    let fetchSpy: jasmine.Spy;

    const uploaded = (id: string, version: string): PluginState => ({
      manifest: { ...baseManifest, id, version },
      status: 'not-loaded',
      path: `uploaded://${id}`,
      type: 'uploaded',
      isEnabled: false,
    });

    beforeEach(async () => {
      const digest = await crypto.subtle.digest('SHA-256', zipBytes);
      listed = {
        name: 'Listed',
        shortDescription: '',
        url: 'https://example.com',
        author: 'someone',
        id: 'listed',
        release: {
          version: '1.2.0',
          downloadUrl: 'https://example.com/listed.zip',
          sha256: Array.from(new Uint8Array(digest), (b) =>
            b.toString(16).padStart(2, '0'),
          ).join(''),
        },
      };
      component.communityPlugins.set([listed]);
      pluginStates = TestBed.inject(PluginService).pluginStates as WritableSignal<
        Map<string, PluginState>
      >;
      fetchSpy = spyOn(window, 'fetch').and.callFake(() =>
        Promise.resolve(new Response(zipBytes)),
      );
    });

    afterEach(() => {
      // Empty again so the template (rendered on teardown) needs no further stubs.
      pluginStates.set(new Map());
    });

    it('marks the entry by the installed uploaded plugin with the same id', () => {
      expect(component.communityPluginRows()[0].status).toBe('notInstalled');

      pluginStates.set(new Map([['listed', uploaded('listed', '1.2.0')]]));
      expect(component.communityPluginRows()[0].status).toBe('installed');
      expect(component.communityUpdates().size).toBe(0);

      pluginStates.set(new Map([['listed', uploaded('listed', '1.1.0')]]));
      expect(component.communityPluginRows()[0].status).toBe('updateAvailable');
      expect(component.communityUpdates().get('listed')).toEqual({
        plugin: listed,
        release: listed.release!,
      });
    });

    it('offers the update in the installed plugin row', async () => {
      (component as { isInAppInstall: boolean }).isInAppInstall = true;
      pluginStates.set(new Map([['listed', uploaded('listed', '1.1.0')]]));
      component.selectedTabIndex.set(PLUGIN_TAB_INDEX.COMMUNITY);
      fixture.detectChanges();
      await fixture.whenStable();
      const installSpy = spyOn(component, 'installCommunityPlugin').and.resolveTo();

      const updateBtn = fixture.nativeElement.querySelector(
        '.plugin-row .plugin-row-action button',
      );
      expect(updateBtn?.textContent).toContain(T.PLUGINS.COMMUNITY_UPDATE);

      updateBtn.click();
      expect(installSpy).toHaveBeenCalledOnceWith(listed);
    });

    it('ignores a built-in plugin with the same id', () => {
      pluginStates.set(
        new Map([['listed', { ...uploaded('listed', '1.0.0'), type: 'built-in' }]]),
      );

      expect(component.communityPluginRows()[0].status).toBe('notInstalled');
    });

    it('downloads, verifies and installs the release after the risk warning', async () => {
      const openSpy = stubConfirmDialog(true);
      loadPluginFromZipSpy.and.returnValue(
        Promise.resolve({ manifest: { id: 'listed', name: 'Listed' } }),
      );

      await component.installCommunityPlugin(listed);

      expect(openSpy).toHaveBeenCalledOnceWith(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: jasmine.stringContaining(T.PLUGINS.RISK_DATA_ACCESS),
          okTxt: T.PLUGINS.INSTALL_PLUGIN,
        },
      });
      expect(fetchSpy).toHaveBeenCalledWith(listed.release!.downloadUrl, {
        credentials: 'omit',
      });
      const file: File = loadPluginFromZipSpy.calls.mostRecent().args[0];
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(zipBytes);
      expect(snackOpenSpy).toHaveBeenCalledWith({
        type: 'SUCCESS',
        msg: T.PLUGINS.PLUGIN_INSTALLED,
        translateParams: { name: 'Listed' },
      });
      expect(component.isUploading()).toBe(false);
    });

    it('shows the installed plugin in the "Community" tab, highlighted, like a ZIP upload', async () => {
      stubConfirmDialog(true);
      loadPluginFromZipSpy.and.returnValue(
        Promise.resolve({ manifest: { id: 'listed', name: 'Listed' } }),
      );

      await component.installCommunityPlugin(listed);

      expect(component.selectedTabIndex()).toBe(PLUGIN_TAB_INDEX.COMMUNITY);
      expect(component.highlightedPluginId()).toBe('listed');
    });

    it('downloads nothing when the risk warning is cancelled', async () => {
      stubConfirmDialog(undefined);

      await component.installCommunityPlugin(listed);

      expect(fetchSpy).not.toHaveBeenCalled();
      expect(loadPluginFromZipSpy).not.toHaveBeenCalled();
    });

    it('installs nothing and says so when the download does not match the hash', async () => {
      stubConfirmDialog(true);
      fetchSpy.and.callFake(() =>
        Promise.resolve(new Response(new TextEncoder().encode('swapped'))),
      );

      await component.installCommunityPlugin(listed);

      expect(loadPluginFromZipSpy).not.toHaveBeenCalled();
      expect(snackOpenSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({
          type: 'ERROR',
          msg: T.PLUGINS.COMMUNITY_HASH_MISMATCH,
          translateParams: jasmine.objectContaining({ name: 'Listed' }),
        }),
      );
      expect(component.isUploading()).toBe(false);
    });

    it('shows the install error, as for a ZIP upload, when the plugin is rejected', async () => {
      stubConfirmDialog(true);
      loadPluginFromZipSpy.and.returnValue(Promise.reject(new Error('Manifest invalid')));

      await component.installCommunityPlugin(listed);

      expect(snackOpenSpy).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: 'Manifest invalid',
        isSkipTranslate: true,
      });
      expect(component.isUploading()).toBe(false);
    });

    it('points to the manual install when the download fails', async () => {
      stubConfirmDialog(true);
      fetchSpy.and.callFake(() => Promise.reject(new TypeError('Failed to fetch')));

      await component.installCommunityPlugin(listed);

      expect(snackOpenSpy).toHaveBeenCalledWith(
        jasmine.objectContaining({ msg: T.PLUGINS.COMMUNITY_DOWNLOAD_FAILED }),
      );
    });
  });

  describe('clearPluginCache', () => {
    let clearCacheSpy: jasmine.Spy;
    let clearUploadedSpy: jasmine.Spy;
    let pluginStates: WritableSignal<Map<string, PluginState>>;

    const stateFor = (id: string, type: PluginState['type']): PluginState => ({
      manifest: { ...baseManifest, id, name: id },
      status: 'not-loaded',
      path: type === 'uploaded' ? `uploaded://${id}` : `assets/bundled-plugins/${id}`,
      type,
      isEnabled: false,
    });

    beforeEach(() => {
      clearCacheSpy = jasmine.createSpy('clearCache').and.resolveTo();
      clearUploadedSpy = jasmine
        .createSpy('clearUploadedPluginsFromMemory')
        .and.resolveTo();
      Object.assign(TestBed.inject(PluginCacheService), { clearCache: clearCacheSpy });
      const pluginService = TestBed.inject(PluginService);
      Object.assign(pluginService, { clearUploadedPluginsFromMemory: clearUploadedSpy });
      pluginStates = pluginService.pluginStates as WritableSignal<
        Map<string, PluginState>
      >;
      pluginStates.set(
        new Map([
          ['uploaded-a', stateFor('uploaded-a', 'uploaded')],
          ['bundled', stateFor('bundled', 'built-in')],
          ['uploaded-b', stateFor('uploaded-b', 'uploaded')],
        ]),
      );
    });

    afterEach(() => {
      // Plugin rows are not under test and need service methods this mock lacks.
      pluginStates.set(new Map());
    });

    it('asks in the app dialog with the number of uploaded plugins, then clears', async () => {
      const openSpy = stubConfirmDialog(true);

      await component.clearPluginCache();

      expect(openSpy).toHaveBeenCalledOnceWith(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.PLUGINS.CONFIRM_CLEAR_CACHE,
          translateParams: { count: 2 },
          okTxt: T.PLUGINS.REMOVE_ALL_UPLOADED_PLUGINS,
        },
      });
      expect(clearCacheSpy).toHaveBeenCalledTimes(1);
      expect(clearUploadedSpy).toHaveBeenCalledTimes(1);
    });

    it('removes nothing when the user cancels', async () => {
      const openSpy = stubConfirmDialog(false);

      await component.clearPluginCache();

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(clearCacheSpy).not.toHaveBeenCalled();
      expect(clearUploadedSpy).not.toHaveBeenCalled();
    });

    it('removes nothing when the dialog is dismissed with Esc or the backdrop', async () => {
      const openSpy = stubConfirmDialog(undefined);

      await component.clearPluginCache();

      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(clearCacheSpy).not.toHaveBeenCalled();
      expect(clearUploadedSpy).not.toHaveBeenCalled();
    });

    it('clears the cache without asking when no uploaded plugin is installed', async () => {
      const openSpy = stubConfirmDialog(true);
      pluginStates.set(new Map([['bundled', stateFor('bundled', 'built-in')]]));

      await component.clearPluginCache();

      expect(openSpy).not.toHaveBeenCalled();
      expect(clearCacheSpy).toHaveBeenCalledTimes(1);
      expect(clearUploadedSpy).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeUploadedPlugin', () => {
    let removeSpy: jasmine.Spy;

    const uploadedPlugin = (name: string): PluginInstance => ({
      manifest: { ...baseManifest, id: 'uploaded-a', name },
      loaded: false,
      isEnabled: false,
    });

    beforeEach(() => {
      removeSpy = jasmine.createSpy('removeUploadedPlugin').and.resolveTo();
      Object.assign(TestBed.inject(PluginService), { removeUploadedPlugin: removeSpy });
    });

    it('asks in the app dialog, then removes the plugin', async () => {
      const openSpy = stubConfirmDialog(true);

      await component.removeUploadedPlugin(uploadedPlugin('My Plugin'));

      expect(openSpy).toHaveBeenCalledOnceWith(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.PLUGINS.CONFIRM_REMOVE,
          translateParams: { name: 'My Plugin' },
          okTxt: T.PLUGINS.REMOVE,
        },
      });
      expect(removeSpy).toHaveBeenCalledOnceWith('uploaded-a');
    });

    it('escapes HTML in the plugin name, which comes from the uploaded ZIP', async () => {
      const openSpy = stubConfirmDialog(false);

      await component.removeUploadedPlugin(uploadedPlugin('<b>Evil</b>'));

      const config = openSpy.calls.mostRecent().args[1] as {
        data: { translateParams: { name: string } };
      };
      expect(config.data.translateParams.name).toBe('&lt;b&gt;Evil&lt;/b&gt;');
    });

    it('keeps the plugin when the user cancels', async () => {
      stubConfirmDialog(false);

      await component.removeUploadedPlugin(uploadedPlugin('My Plugin'));

      expect(removeSpy).not.toHaveBeenCalled();
    });

    it('keeps the plugin when the dialog is dismissed with Esc or the backdrop', async () => {
      stubConfirmDialog(undefined);

      await component.removeUploadedPlugin(uploadedPlugin('My Plugin'));

      expect(removeSpy).not.toHaveBeenCalled();
    });
  });

  describe('disabling a plugin with attached issue providers', () => {
    let disableSpy: jasmine.Spy;
    let issueProviders: WritableSignal<{ id: string; pluginId?: string }[]>;

    const plugin: PluginInstance = {
      manifest: { ...baseManifest, name: '<i>GitHub</i>', type: 'issueProvider' },
      loaded: true,
      isEnabled: true,
    };

    // MatSlideToggle has already flipped itself off when (change) fires.
    const toggleOffEvent = (): MatSlideToggleChange =>
      ({ checked: false, source: { checked: false } }) as unknown as MatSlideToggleChange;

    // onPluginToggle does not return the disable promise; let it settle.
    const toggleOff = async (event: MatSlideToggleChange): Promise<void> => {
      component.onPluginToggle(plugin, event);
      await new Promise((resolve) => setTimeout(resolve));
    };

    beforeEach(() => {
      disableSpy = jasmine.createSpy('disablePlugin').and.resolveTo();
      Object.assign(TestBed.inject(PluginService), { disablePlugin: disableSpy });
      issueProviders = signal([
        { id: 'ip-1', pluginId: baseManifest.id },
        { id: 'ip-2', pluginId: baseManifest.id },
        { id: 'ip-3', pluginId: 'other-plugin' },
      ]);
      // The component reads the providers once at construction, so build it again
      // with a Store that returns them.
      Object.assign(TestBed.inject(Store), { selectSignal: () => issueProviders });
      component = TestBed.createComponent(PluginManagementComponent).componentInstance;
    });

    it('asks in the app dialog with the provider count and escaped name, then disables', async () => {
      const openSpy = stubConfirmDialog(true);
      const event = toggleOffEvent();

      await toggleOff(event);

      expect(openSpy).toHaveBeenCalledOnceWith(DialogConfirmComponent, {
        restoreFocus: true,
        data: {
          message: T.PLUGINS.CONFIRM_DISABLE_WITH_ISSUE_PROVIDERS,
          translateParams: { count: 2, name: '&lt;i&gt;GitHub&lt;/i&gt;' },
          okTxt: undefined,
        },
      });
      expect(disableSpy).toHaveBeenCalledOnceWith(baseManifest.id);
      expect(event.source.checked).toBe(false);
    });

    it('turns the toggle back on and keeps the plugin enabled when the user cancels', async () => {
      stubConfirmDialog(false);
      const event = toggleOffEvent();

      await toggleOff(event);

      expect(disableSpy).not.toHaveBeenCalled();
      expect(event.source.checked).toBe(true);
    });

    it('turns the toggle back on when the dialog is dismissed with Esc or the backdrop', async () => {
      stubConfirmDialog(undefined);
      const event = toggleOffEvent();

      await toggleOff(event);

      expect(disableSpy).not.toHaveBeenCalled();
      expect(event.source.checked).toBe(true);
    });

    it('disables without asking when no issue provider uses the plugin', async () => {
      const openSpy = stubConfirmDialog(false);
      issueProviders.set([{ id: 'ip-3', pluginId: 'other-plugin' }]);

      await toggleOff(toggleOffEvent());

      expect(openSpy).not.toHaveBeenCalled();
      expect(disableSpy).toHaveBeenCalledOnceWith(baseManifest.id);
    });
  });

  describe('enabling a plugin that needs Node.js execution consent', () => {
    let setPluginEnabledSpy: jasmine.Spy;
    let activatePluginSpy: jasmine.Spy;
    let checkConsentSpy: jasmine.Spy;

    const plugin: PluginInstance = {
      manifest: { ...baseManifest, permissions: ['nodeExecution'] },
      loaded: false,
      isEnabled: false,
    };

    // MatSlideToggle has already flipped itself on when (change) fires.
    const toggleOnEvent = (): MatSlideToggleChange =>
      ({ checked: true, source: { checked: true } }) as unknown as MatSlideToggleChange;

    // onPluginToggle does not return the enable promise; let it settle.
    const toggleOn = async (event: MatSlideToggleChange): Promise<void> => {
      component.onPluginToggle(plugin, event);
      await new Promise((resolve) => setTimeout(resolve));
    };

    beforeEach(() => {
      checkConsentSpy = jasmine.createSpy('checkNodeExecutionPermission');
      activatePluginSpy = jasmine.createSpy('activatePlugin').and.resolveTo(null);
      setPluginEnabledSpy = jasmine.createSpy('setPluginEnabled').and.resolveTo();
      Object.assign(TestBed.inject(PluginService), {
        checkNodeExecutionPermission: checkConsentSpy,
        activatePlugin: activatePluginSpy,
      });
      Object.assign(TestBed.inject(PluginMetaPersistenceService), {
        setPluginEnabled: setPluginEnabledSpy,
      });
    });

    it('turns the toggle back off and enables nothing when consent is denied', async () => {
      checkConsentSpy.and.resolveTo(false);
      const event = toggleOnEvent();

      await toggleOn(event);

      expect(setPluginEnabledSpy).not.toHaveBeenCalled();
      expect(activatePluginSpy).not.toHaveBeenCalled();
      expect(event.source.checked).toBe(false);
    });

    it('enables and activates the plugin when consent is granted', async () => {
      checkConsentSpy.and.resolveTo(true);
      const event = toggleOnEvent();

      await toggleOn(event);

      expect(setPluginEnabledSpy).toHaveBeenCalledOnceWith(baseManifest.id, true);
      expect(activatePluginSpy).toHaveBeenCalledOnceWith(baseManifest.id, true);
      expect(event.source.checked).toBe(true);
    });
  });

  describe('openConfigDialog', () => {
    const plugin = { manifest: baseManifest, loaded: true, isEnabled: true };
    let loadSchemaSpy: jasmine.Spy;

    beforeEach(() => {
      loadSchemaSpy = jasmine.createSpy('loadPluginConfigSchema');
      Object.assign(TestBed.inject(PluginService), {
        getPluginPath: () => 'uploaded://github-issue-provider',
      });
      Object.assign(TestBed.inject(PluginConfigService), {
        loadPluginConfigSchema: loadSchemaSpy,
      });
    });

    [
      { label: 'an Error', thrown: new Error('No config schema found') },
      { label: 'a non-Error value', thrown: 'boom' },
    ].forEach(({ label, thrown }) => {
      it(`shows a translated error snack, not the install row error, for ${label}`, async () => {
        loadSchemaSpy.and.rejectWith(thrown);

        await component.openConfigDialog(plugin);

        expect(snackOpenSpy).toHaveBeenCalledWith({
          type: 'ERROR',
          msg: T.PLUGINS.FAILED_TO_LOAD_CONFIG,
        });
        expect(component.uploadError()).toBeNull();
      });
    });
  });
});

describe('isPluginListed', () => {
  const instance = (id: string, isEnabled: boolean): PluginInstance => ({
    manifest: {
      id,
      name: id,
      manifestVersion: 1,
      version: '1.0.0',
      minSupVersion: '1.0.0',
      hooks: [],
      permissions: [],
    },
    loaded: false,
    isEnabled,
  });

  it('always lists regular plugins', () => {
    expect(isPluginListed(instance('brain-dump', false), false, new Set())).toBe(true);
  });

  it('hides a disabled dev-only plugin unless dev plugins are shown', () => {
    expect(isPluginListed(instance('api-test-plugin', false), false, new Set())).toBe(
      false,
    );
    expect(isPluginListed(instance('api-test-plugin', false), true, new Set())).toBe(
      true,
    );
  });

  it('keeps listing a dev-only plugin seen enabled after it is disabled', () => {
    const shown = new Set<string>();

    expect(isPluginListed(instance('api-test-plugin', true), false, shown)).toBe(true);
    expect(isPluginListed(instance('api-test-plugin', false), false, shown)).toBe(true);
  });
});
