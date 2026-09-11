import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { strToU8, zipSync } from 'fflate';
import { of } from 'rxjs';
import { GlobalConfigService } from '../features/config/global-config.service';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { SnackService } from '../core/snack/snack.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { PluginCacheService } from './plugin-cache.service';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginHooksService } from './plugin-hooks';
import { PluginI18nService } from './plugin-i18n.service';
import { PluginIssueProviderRegistryService } from './issue-provider/plugin-issue-provider-registry.service';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginManifest } from './plugin-api.model';
import { PluginBridgeService } from './plugin-bridge.service';
import { PluginMetaPersistenceService } from './plugin-meta-persistence.service';
import { PluginRunner } from './plugin-runner';
import { PluginSecurityService } from './plugin-security';
import { PluginService } from './plugin.service';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';

/**
 * #9459: an uploaded plugin's translations reached IndexedDB but never came back,
 * so `pluginApi.translate()` silently returned keys. Every other plugin spec mocks
 * PluginCacheService, which means the write-then-read that actually broke is only
 * ever asserted as "storePlugin was called with X".
 *
 * This spec deliberately uses the REAL cache, loader and i18n service, so the whole
 * chain is executed rather than asserted through spies:
 *   loadPluginFromZip -> IndexedDB -> loadUploadedPluginAssets -> translate()
 *
 * Caveat worth knowing: `src/test.ts` installs `fake-indexeddb`, so the store is an
 * in-memory polyfill, not the browser's IndexedDB. This exercises PluginCacheService's
 * own put/get code (which every other spec mocks) but does not prove real-browser
 * storage semantics. test.ts also swaps in a fresh IDBFactory per spec, so no manual
 * teardown is needed here.
 */
describe('PluginService uploaded translations round-trip', () => {
  const PLUGIN_ID = 'i18n-round-trip';

  const manifest: PluginManifest = {
    id: PLUGIN_ID,
    name: 'Round Trip',
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: '18.0.0',
    hooks: [],
    permissions: [],
    iFrame: true,
    i18n: { languages: ['en', 'de'] },
  };
  const EN = JSON.stringify({ GREETING: 'Hello' });
  const DE = JSON.stringify({ GREETING: 'Hallo' });

  const createZipFile = (files: Record<string, string>): File => {
    const entries: Record<string, Uint8Array> = {};
    for (const [path, content] of Object.entries(files)) {
      entries[path] = strToU8(content);
    }
    const zipBytes = zipSync(entries);
    const zipBuffer = new ArrayBuffer(zipBytes.byteLength);
    new Uint8Array(zipBuffer).set(zipBytes);
    return new File([zipBuffer], 'plugin.zip', { type: 'application/zip' });
  };

  const pluginZip = (translations: Record<string, string>): File => {
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(manifest);
    files['index.html'] = '<!doctype html><html><body>UI</body></html>';
    for (const [lang, content] of Object.entries(translations)) {
      files[`i18n/${lang}.json`] = content;
    }
    return createZipFile(files);
  };

  const configure = (): void => {
    const pluginRunner = jasmine.createSpyObj<PluginRunner>('PluginRunner', [
      'loadPlugin',
      'triggerReady',
      'unloadPlugin',
      'triggerUnload',
      'pingNodeBridge',
    ]);
    pluginRunner.loadPlugin.and.callFake(
      async (loadedManifest, _code, _cfg, isEnabled = true) => ({
        manifest: loadedManifest,
        loaded: true,
        isEnabled,
      }),
    );
    pluginRunner.triggerReady.and.resolveTo();

    const pluginSecurity = jasmine.createSpyObj<PluginSecurityService>(
      'PluginSecurityService',
      ['analyzePluginCode', 'hasElevatedPermissions'],
    );
    pluginSecurity.analyzePluginCode.and.returnValue({ warnings: [], info: [] });
    pluginSecurity.hasElevatedPermissions.and.returnValue(false);

    const pluginMetaPersistence = jasmine.createSpyObj<PluginMetaPersistenceService>(
      'PluginMetaPersistenceService',
      ['isPluginEnabled', 'setPluginEnabled'],
    );
    pluginMetaPersistence.isPluginEnabled.and.resolveTo(true);

    const translateService = jasmine.createSpyObj<TranslateService>('TranslateService', [
      'instant',
    ]);
    translateService.instant.and.callFake((key: string | string[]) =>
      Array.isArray(key) ? key.join(',') : key,
    );

    const globalConfig = jasmine.createSpyObj('GlobalConfigService', [], {
      localization: jasmine.createSpy().and.returnValue({ lng: 'en' }),
    });

    TestBed.configureTestingModule({
      providers: [
        PluginService,
        // The three under test are deliberately real.
        PluginCacheService,
        PluginLoaderService,
        PluginI18nService,
        { provide: HttpClient, useValue: { get: () => of(null) } },
        { provide: GlobalConfigService, useValue: globalConfig },
        { provide: PluginRunner, useValue: pluginRunner },
        { provide: PluginSecurityService, useValue: pluginSecurity },
        { provide: PluginMetaPersistenceService, useValue: pluginMetaPersistence },
        { provide: TranslateService, useValue: translateService },
        { provide: GlobalThemeService, useValue: { darkMode: () => 'light' } },
        {
          provide: PluginHooksService,
          useValue: jasmine.createSpyObj<PluginHooksService>('PluginHooksService', [
            'unregisterPluginHooks',
          ]),
        },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: jasmine.createSpyObj<PluginIssueProviderRegistryService>(
            'PluginIssueProviderRegistryService',
            ['getRegisteredKey', 'unregister'],
          ),
        },
        {
          provide: IssueSyncAdapterRegistryService,
          useValue: jasmine.createSpyObj<IssueSyncAdapterRegistryService>(
            'IssueSyncAdapterRegistryService',
            ['unregister'],
          ),
        },
        {
          provide: PluginBridgeService,
          useValue: jasmine.createSpyObj<PluginBridgeService>('PluginBridgeService', [
            'hasNodeExecutionGrantToken',
            'requestNodeExecutionGrant',
            'setNodeExecutionGrantToken',
            'revokeNodeExecutionGrantToken',
            'revokeNodeExecutionGrant',
            'clearNodeExecutionConsent',
          ]),
        },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: MatDialog, useValue: {} },
        { provide: PluginCleanupService, useValue: {} },
        { provide: Store, useValue: {} },
        { provide: SnackService, useValue: {} },
      ],
    });
  };

  beforeEach(() => {
    configure();
  });

  // Does not touch the cache — registration happens in memory during the upload.
  // Kept because it pins the shape users report: it works until you restart.
  it('translates in-session immediately after upload', async () => {
    await TestBed.inject(PluginService).loadPluginFromZip(pluginZip({ en: EN, de: DE }));

    const i18n = TestBed.inject(PluginI18nService);
    expect(i18n.translate(PLUGIN_ID, 'GREETING')).toBe('Hello');
    i18n.setCurrentLanguage('de');
    expect(i18n.translate(PLUGIN_ID, 'GREETING')).toBe('Hallo');
  });

  it('really persists the translations to IndexedDB', async () => {
    await TestBed.inject(PluginService).loadPluginFromZip(pluginZip({ en: EN, de: DE }));

    const cached = await TestBed.inject(PluginCacheService).getPlugin(PLUGIN_ID);

    expect(cached).not.toBeNull();
    expect(cached!.translations).toEqual({ en: EN, de: DE });
  });

  // The regression #9459 actually describes: it worked in-session but was gone after
  // a restart. Drives the production startup path end to end — discovery, activation
  // and registration — so removing the cache-to-i18n handoff anywhere along it fails
  // here, not just a broken write.
  it('still translates after a restart, via the real startup path', async () => {
    await TestBed.inject(PluginService).loadPluginFromZip(pluginZip({ en: EN, de: DE }));

    // "Restart": tear down every service instance, keep the stored data.
    TestBed.resetTestingModule();
    configure();

    const i18n = TestBed.inject(PluginI18nService);
    // Nothing is registered until startup reads the cache back.
    expect(i18n.translate(PLUGIN_ID, 'GREETING')).toBe('GREETING');

    await TestBed.inject(PluginService).initializePlugins();

    i18n.setCurrentLanguage('de');
    expect(i18n.translate(PLUGIN_ID, 'GREETING')).toBe('Hallo');
    i18n.setCurrentLanguage('en');
    expect(i18n.translate(PLUGIN_ID, 'GREETING')).toBe('Hello');
  });

  it('never persists a language whose json cannot be parsed', async () => {
    await TestBed.inject(PluginService).loadPluginFromZip(
      pluginZip({ en: EN, de: '{ not json ' }),
    );

    const cached = await TestBed.inject(PluginCacheService).getPlugin(PLUGIN_ID);

    // Broken content in the cache would survive every restart while degrading
    // translate() to returning keys — #9459's symptom in a new disguise.
    expect(cached!.translations).toEqual({ en: EN });
  });
});
