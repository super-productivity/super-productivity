import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { MatDialog } from '@angular/material/dialog';
import { Store } from '@ngrx/store';
import { TranslateService } from '@ngx-translate/core';
import { strToU8, zipSync } from 'fflate';
import { of } from 'rxjs';
import { GlobalThemeService } from '../core/theme/global-theme.service';
import { SnackService } from '../core/snack/snack.service';
import { IssueSyncAdapterRegistryService } from '../features/issue/two-way-sync/issue-sync-adapter-registry.service';
import { T } from '../t.const';
import { PluginCacheService } from './plugin-cache.service';
import { PluginCleanupService } from './plugin-cleanup.service';
import { MAX_PLUGIN_TRANSLATIONS_TOTAL_SIZE } from './plugin.const';
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

describe('PluginService loadPluginFromZip iframe-only plugins', () => {
  let service: PluginService;
  let pluginRunner: jasmine.SpyObj<PluginRunner>;
  let pluginCache: jasmine.SpyObj<PluginCacheService>;
  let pluginMetaPersistence: jasmine.SpyObj<PluginMetaPersistenceService>;
  let pluginHooks: jasmine.SpyObj<PluginHooksService>;
  let pluginI18n: jasmine.SpyObj<PluginI18nService>;
  let pluginIssueProviderRegistry: jasmine.SpyObj<PluginIssueProviderRegistryService>;
  let issueSyncAdapterRegistry: jasmine.SpyObj<IssueSyncAdapterRegistryService>;

  const iframeManifest: PluginManifest = {
    id: 'iframe-only',
    name: 'Iframe Only',
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: '18.0.0',
    hooks: [],
    permissions: [],
    iFrame: true,
  };

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

  beforeEach(() => {
    pluginRunner = jasmine.createSpyObj<PluginRunner>('PluginRunner', [
      'loadPlugin',
      'triggerReady',
      'unloadPlugin',
      'triggerUnload',
      'pingNodeBridge',
    ]);
    pluginRunner.loadPlugin.and.callFake(
      async (manifest, _pluginCode, _baseCfg, isEnabled = true) => ({
        manifest,
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

    pluginCache = jasmine.createSpyObj<PluginCacheService>('PluginCacheService', [
      'storePlugin',
      'getPlugin',
      'removePlugin',
    ]);
    pluginCache.storePlugin.and.resolveTo();

    pluginMetaPersistence = jasmine.createSpyObj<PluginMetaPersistenceService>(
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
    pluginHooks = jasmine.createSpyObj<PluginHooksService>('PluginHooksService', [
      'unregisterPluginHooks',
    ]);
    pluginI18n = jasmine.createSpyObj<PluginI18nService>('PluginI18nService', [
      'loadPluginTranslationsFromContent',
      'unloadPluginTranslations',
    ]);
    pluginIssueProviderRegistry =
      jasmine.createSpyObj<PluginIssueProviderRegistryService>(
        'PluginIssueProviderRegistryService',
        ['getRegisteredKey', 'unregister'],
      );
    issueSyncAdapterRegistry = jasmine.createSpyObj<IssueSyncAdapterRegistryService>(
      'IssueSyncAdapterRegistryService',
      ['unregister'],
    );

    TestBed.configureTestingModule({
      providers: [
        PluginService,
        { provide: HttpClient, useValue: { get: () => of(null) } },
        { provide: PluginRunner, useValue: pluginRunner },
        { provide: PluginHooksService, useValue: pluginHooks },
        { provide: PluginSecurityService, useValue: pluginSecurity },
        { provide: GlobalThemeService, useValue: { darkMode: () => 'light' } },
        { provide: PluginMetaPersistenceService, useValue: pluginMetaPersistence },
        { provide: PluginUserPersistenceService, useValue: {} },
        { provide: PluginCacheService, useValue: pluginCache },
        { provide: MatDialog, useValue: {} },
        { provide: PluginCleanupService, useValue: {} },
        { provide: PluginLoaderService, useValue: {} },
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
        { provide: TranslateService, useValue: translateService },
        { provide: PluginI18nService, useValue: pluginI18n },
        { provide: Store, useValue: {} },
        {
          provide: PluginIssueProviderRegistryService,
          useValue: pluginIssueProviderRegistry,
        },
        { provide: IssueSyncAdapterRegistryService, useValue: issueSyncAdapterRegistry },
        { provide: SnackService, useValue: {} },
      ],
    });

    service = TestBed.inject(PluginService);
  });

  it('loads an iframe plugin zip without plugin.js when index.html exists', async () => {
    const indexHtml = '<!doctype html><html><body>Plugin UI</body></html>';
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(iframeManifest);
    files['index.html'] = indexHtml;
    const file = createZipFile(files);

    const result = await service.loadPluginFromZip(file);

    expect(result.loaded).toBeTrue();
    expect(pluginRunner.loadPlugin).toHaveBeenCalledWith(
      iframeManifest,
      '',
      jasmine.objectContaining({ theme: 'light', platform: 'web' }),
      true,
    );
    expect(pluginCache.storePlugin).toHaveBeenCalledWith(
      iframeManifest.id,
      JSON.stringify(iframeManifest),
      '',
      indexHtml,
      undefined,
      undefined,
      undefined,
    );
    expect(service.getPluginIndexHtml(iframeManifest.id)).toBe(indexHtml);
  });

  it('loads declared translations before executing an uploaded plugin', async () => {
    const manifest: PluginManifest = {
      ...iframeManifest,
      i18n: { languages: ['en', 'de'] },
    };
    const indexHtml = '<!doctype html><html><body>Translated plugin UI</body></html>';
    const translations = {
      en: JSON.stringify({ GREETING: 'Hello' }),
      de: JSON.stringify({ GREETING: 'Hallo' }),
    };
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(manifest);
    files['index.html'] = indexHtml;
    files['i18n/en.json'] = translations.en;
    files['i18n/de.json'] = translations.de;
    files['i18n/fr.json'] = JSON.stringify({ GREETING: 'Bonjour' });
    const file = createZipFile(files);
    pluginRunner.loadPlugin.and.callFake(
      async (loadedManifest, _pluginCode, _baseCfg, isEnabled = true) => {
        expect(pluginI18n.loadPluginTranslationsFromContent).toHaveBeenCalledOnceWith(
          manifest.id,
          translations,
        );
        return {
          manifest: loadedManifest,
          loaded: true,
          isEnabled,
        };
      },
    );

    await service.loadPluginFromZip(file);

    expect(pluginCache.storePlugin).toHaveBeenCalledOnceWith(
      manifest.id,
      JSON.stringify(manifest),
      '',
      indexHtml,
      undefined,
      translations,
      undefined,
    );
  });

  // Selection semantics (dedupe, unsupported codes, missing files, invalid json) are
  // covered by read-plugin-translations-from-zip.util.spec.ts, and persistence by
  // plugin.service.translations-round-trip.spec.ts. Keep this file to what only the
  // full upload path can show.

  // A failed upload files its error state under a synthetic `error-…` id, so on the
  // next upload `existingState` is undefined and the teardown that normally unloads
  // translations never runs. Without an unconditional unload the old version's
  // strings keep being served while the cache correctly holds none.
  it('clears translations left by a failed upload when the new zip has none', async () => {
    const withI18n: PluginManifest = {
      ...iframeManifest,
      i18n: { languages: ['en'] },
    };
    const indexHtml = '<!doctype html><html><body>Plugin UI</body></html>';
    const first: Record<string, string> = {};
    first['manifest.json'] = JSON.stringify(withI18n);
    first['index.html'] = indexHtml;
    first['i18n/en.json'] = JSON.stringify({ GREETING: 'Hello' });
    pluginRunner.loadPlugin.and.rejectWith(new Error('boom'));
    await expectAsync(service.loadPluginFromZip(createZipFile(first))).toBeRejected();
    expect(pluginI18n.loadPluginTranslationsFromContent).toHaveBeenCalledWith(
      withI18n.id,
      { en: first['i18n/en.json'] },
    );
    // The failure left no state under the real id — this is what disables teardown.
    expect(service.pluginStates().get(withI18n.id)).toBeUndefined();

    pluginI18n.unloadPluginTranslations.calls.reset();
    pluginRunner.loadPlugin.and.callFake(
      async (manifest, _code, _cfg, isEnabled = true) => ({
        manifest,
        loaded: true,
        isEnabled,
      }),
    );

    const second: Record<string, string> = {};
    second['manifest.json'] = JSON.stringify(iframeManifest);
    second['index.html'] = indexHtml;
    await service.loadPluginFromZip(createZipFile(second));

    expect(pluginI18n.unloadPluginTranslations).toHaveBeenCalledWith(iframeManifest.id);
    expect(pluginCache.storePlugin).toHaveBeenCalledWith(
      iframeManifest.id,
      JSON.stringify(iframeManifest),
      '',
      indexHtml,
      undefined,
      undefined,
      undefined,
    );
  });

  it('rejects oversized combined translations before caching them', async () => {
    const languages = ['en', 'de', 'fr', 'es', 'it', 'nl'];
    const manifest: PluginManifest = {
      ...iframeManifest,
      i18n: { languages },
    };
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(manifest);
    files['index.html'] = '<!doctype html><html><body>Plugin UI</body></html>';
    for (const lang of languages) {
      files[`i18n/${lang}.json`] = JSON.stringify({
        BIG: 'x'.repeat(
          Math.floor(MAX_PLUGIN_TRANSLATIONS_TOTAL_SIZE / languages.length),
        ),
      });
    }

    await expectAsync(
      service.loadPluginFromZip(createZipFile(files)),
    ).toBeRejectedWithError(T.PLUGINS.TRANSLATIONS_TOO_LARGE);
    expect(pluginCache.storePlugin).not.toHaveBeenCalled();
  });

  it('rejects a plugin zip without plugin.js when index.html is absent', async () => {
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(iframeManifest);
    const file = createZipFile(files);

    await expectAsync(service.loadPluginFromZip(file)).toBeRejectedWithError(
      T.PLUGINS.PLUGIN_JS_NOT_FOUND,
    );
  });

  it('rejects a plugin zip without plugin.js when index.html is empty', async () => {
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(iframeManifest);
    files['index.html'] = ' ';
    const file = createZipFile(files);

    await expectAsync(service.loadPluginFromZip(file)).toBeRejectedWithError(
      T.PLUGINS.INDEX_HTML_NOT_LOADED,
    );
  });

  it('rejects uploaded plugin ids reserved by bundled plugins', async () => {
    const reservedManifest: PluginManifest = {
      ...iframeManifest,
      id: 'sync-md',
      name: 'Bundled Collision',
    };
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(reservedManifest);
    files['index.html'] = '<!doctype html><html><body>Plugin UI</body></html>';
    const file = createZipFile(files);

    await expectAsync(service.loadPluginFromZip(file)).toBeRejectedWithError(
      T.PLUGINS.PLUGIN_ID_RESERVED,
    );
    expect(pluginCache.storePlugin).not.toHaveBeenCalled();
  });

  it('accepts uploaded plugins that declare nodeExecution (gated later by main-process consent)', async () => {
    const nodeExecutionManifest: PluginManifest = {
      ...iframeManifest,
      id: 'uploaded-node-plugin',
      name: 'Uploaded Node Plugin',
      permissions: ['nodeExecution'],
    };
    const files: Record<string, string> = {};
    files['manifest.json'] = JSON.stringify(nodeExecutionManifest);
    files['plugin.js'] = 'PluginAPI.log.log("node plugin")';
    const file = createZipFile(files);

    // Resolving (instead of throwing NODE_EXECUTION_BUILT_IN_ONLY) is the behaviour
    // change: uploaded node plugins are no longer rejected at upload time. The
    // nodeExecution capability is gated by the main-process consent dialog at grant
    // time instead.
    const instance = await service.loadPluginFromZip(file);

    expect(instance).toBeTruthy();
    expect(instance.manifest.id).toBe('uploaded-node-plugin');
    expect(pluginCache.storePlugin).toHaveBeenCalled();
  });
});
