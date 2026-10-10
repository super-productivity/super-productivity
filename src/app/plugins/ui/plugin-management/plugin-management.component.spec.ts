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
import { PluginInstance, PluginManifest, PluginHooks } from '../../plugin-api.model';
import { PluginService } from '../../plugin.service';
import { PluginState } from '../../plugin-state.model';
import { PluginManagementComponent } from './plugin-management.component';
import { T } from '../../../t.const';
import { DialogConfirmComponent } from '../../../ui/dialog-confirm/dialog-confirm.component';

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
    TestBed.configureTestingModule({
      imports: [PluginManagementComponent, TranslateModule.forRoot()],
      providers: [
        {
          provide: PluginService,
          useValue: {
            pluginStates: signal(new Map()),
            loadPluginFromZip: loadPluginFromZipSpy,
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
          provide: MatDialog,
          useValue: {},
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
          useValue: {},
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
      Promise.resolve({ manifest: { name: 'My Plugin' } }),
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
      Promise.resolve({ manifest: { name: 'My Plugin' }, error: 'boom' }),
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

  it('surfaces allowedHosts (with count) only when the "http" capability is declared', () => {
    const plugin = {
      manifest: {
        ...baseManifest,
        permissions: ['http'],
        allowedHosts: ['api.example.com', 'auth.example.com'],
        hooks: [PluginHooks.TASK_COMPLETE],
      },
      loaded: true,
      isEnabled: true,
    };

    expect(component.getNetworkReachHosts(plugin)).toEqual([
      'api.example.com',
      'auth.example.com',
    ]);
    // instant() echoes the key here (no translations loaded); the allowedHosts part
    // appears with its count, between permissions and hooks.
    expect(component.getPermissionsHooksTitle(plugin)).toBe(
      'PLUGINS.PERMISSIONS (1) / PLUGINS.ALLOWED_HOSTS (2) / PLUGINS.HOOKS (1)',
    );
  });

  it('hides allowedHosts when the plugin lacks the "http" capability (bridge would reject request)', () => {
    const plugin = {
      manifest: {
        ...baseManifest,
        permissions: ['nodeExecution'],
        allowedHosts: ['api.example.com', 'auth.example.com'],
        hooks: [PluginHooks.TASK_COMPLETE],
      },
      loaded: true,
      isEnabled: true,
    };

    expect(component.getNetworkReachHosts(plugin)).toEqual([]);
    // No "ALLOWED_HOSTS" segment — network reach is not advertised without "http".
    expect(component.getPermissionsHooksTitle(plugin)).toBe(
      'PLUGINS.PERMISSIONS (1) / PLUGINS.HOOKS (1)',
    );
  });

  it('omits allowedHosts from the title when none are declared', () => {
    const title = component.getPermissionsHooksTitle({
      manifest: { ...baseManifest, hooks: [PluginHooks.TASK_COMPLETE] },
      loaded: true,
      isEnabled: true,
    });

    expect(title).toBe('PLUGINS.HOOKS (1)');
  });

  describe('community plugins card', () => {
    const normalize = (text: string | null | undefined): string =>
      (text ?? '').replace(/\s+/g, ' ').trim();
    const plugin = {
      name: 'X',
      shortDescription: '',
      url: 'https://example.com',
      author: 'someone',
      authorUrl: 'https://example.com/someone',
      stars: 3,
    };

    beforeEach(() => {
      // A non-English language whose AUTHORED_BY puts the author first, so the
      // test also covers translations that do not start with "by".
      const translateService = TestBed.inject(TranslateService);
      translateService.setTranslation('tr', {
        PLUGINS: {
          AUTHORED_BY: '{{author}} tarafından',
          COMMUNITY_PLUGINS_ADD_YOURS: 'Eklentinizi burada listeleyin',
          COMMUNITY_PLUGINS_STARS: '{{count}} yıldız',
          COMMUNITY_PLUGINS_TITLE: 'Topluluk eklentileri',
          COMMUNITY_PLUGINS_WARNING: 'Topluluk eklentileri incelenmez.',
        },
      });
      translateService.use('tr');
      // A fixture instead of the real community-plugins.json, whose first entry
      // may lack the optional authorUrl or stars.
      component.communityPlugins.set([plugin]);
      fixture.detectChanges();
    });

    const card = (): HTMLElement =>
      fixture.nativeElement.querySelector('.community-plugins-card');

    it('translates the title, warning and add-your-plugin link', () => {
      expect(normalize(card().querySelector('mat-card-title')?.textContent)).toBe(
        'Topluluk eklentileri',
      );
      expect(normalize(card().querySelector('.install-warning span')?.textContent)).toBe(
        'Topluluk eklentileri incelenmez.',
      );
      const addYoursLink = card().querySelector<HTMLAnchorElement>(
        'a[href$="community-plugins.json"]',
      );
      expect(normalize(addYoursLink?.textContent)).toBe(
        'add Eklentinizi burada listeleyin',
      );
    });

    it('renders the translated author line with the author as a link', () => {
      const authorLine = card().querySelector(
        '.community-plugin-item .plugin-author > span',
      );
      const authorLink = authorLine?.querySelector('a');

      expect(normalize(authorLine?.textContent)).toBe(`${plugin.author} tarafından`);
      expect(authorLink?.getAttribute('href')).toBe(plugin.authorUrl);
      expect(normalize(authorLink?.textContent)).toBe(plugin.author);
    });

    it('translates the stars label', () => {
      const stars = card().querySelector('.community-plugin-item .plugin-stars');

      expect(stars?.getAttribute('aria-label')).toBe(`${plugin.stars} yıldız`);
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

  // Stubs MatDialog.open so the confirm dialog closes with `result`:
  // true = confirmed, false = Cancel, undefined = Esc or backdrop click.
  const stubConfirmDialog = (result: boolean | undefined): jasmine.Spy => {
    const openSpy = jasmine
      .createSpy('open')
      .and.returnValue({ afterClosed: () => of(result) });
    Object.assign(TestBed.inject(MatDialog), { open: openSpy });
    return openSpy;
  };

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
      // Plugin cards are not under test and need service methods this mock lacks.
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
          okTxt: T.PLUGINS.CLEAR_PLUGIN_CACHE,
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
      it(`shows a translated error snack, not the Install Plugin card, for ${label}`, async () => {
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
