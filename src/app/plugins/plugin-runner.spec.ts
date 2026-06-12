import { TestBed } from '@angular/core/testing';
import { PluginRunner } from './plugin-runner';
import { PluginAPI } from './plugin-api';
import { PluginBridgeService } from './plugin-bridge.service';
import { PluginSecurityService } from './plugin-security';
import { SnackService } from '../core/snack/snack.service';
import { PluginCleanupService } from './plugin-cleanup.service';
import { PluginManifest, PluginBaseCfg } from './plugin-api.model';
import { PluginI18nService } from './plugin-i18n.service';

describe('PluginRunner', () => {
  let service: PluginRunner;
  let mockPluginBridge: jasmine.SpyObj<PluginBridgeService>;
  let mockSecurityService: jasmine.SpyObj<PluginSecurityService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let mockCleanupService: jasmine.SpyObj<PluginCleanupService>;
  let mockI18nService: jasmine.SpyObj<PluginI18nService>;
  let registerSidePanelButtonSpy: jasmine.Spy;

  const mockManifest: PluginManifest = {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    manifestVersion: 1,
    minSupVersion: '1.0.0',
    hooks: [],
    permissions: [],
  };

  const mockBaseCfg: PluginBaseCfg = {
    theme: 'light',
    appVersion: '1.0.0',
    platform: 'web',
    isDev: true,
  };

  beforeEach(() => {
    mockPluginBridge = jasmine.createSpyObj('PluginBridgeService', [
      'unregisterPluginHooks',
      'createBoundMethods',
      'pingNodeBridge',
    ]);
    // createBoundMethods should return an empty object (no additional bound methods)
    registerSidePanelButtonSpy = jasmine.createSpy('registerSidePanelButton');
    mockPluginBridge.createBoundMethods.and.returnValue({
      registerSidePanelButton: registerSidePanelButtonSpy,
    } as any);
    mockPluginBridge.pingNodeBridge.and.resolveTo(false);

    mockSecurityService = jasmine.createSpyObj('PluginSecurityService', [
      'analyzePluginCode',
    ]);
    mockSecurityService.analyzePluginCode.and.returnValue({ warnings: [], info: [] });

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);
    mockCleanupService = jasmine.createSpyObj('PluginCleanupService', ['cleanupPlugin']);
    mockI18nService = jasmine.createSpyObj('PluginI18nService', [
      'translate',
      'getCurrentLanguage',
      'loadPluginTranslationsFromPath',
      'loadPluginTranslationsFromContent',
      'unloadPluginTranslations',
    ]);
    mockI18nService.getCurrentLanguage.and.returnValue('en');
    mockI18nService.translate.and.callFake((_pluginId, key) => key);

    TestBed.configureTestingModule({
      providers: [
        PluginRunner,
        { provide: PluginBridgeService, useValue: mockPluginBridge },
        { provide: PluginSecurityService, useValue: mockSecurityService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: PluginCleanupService, useValue: mockCleanupService },
        { provide: PluginI18nService, useValue: mockI18nService },
      ],
    });
    service = TestBed.inject(PluginRunner);
  });

  describe('Plugin variable injection', () => {
    it('should make "plugin" variable available to plugin code', async () => {
      // Plugin code that checks for 'plugin' variable existence
      const pluginCode = `
        if (typeof plugin === 'undefined') {
          throw new Error('plugin is not defined');
        }
        // Verify plugin has expected properties (showSnack is one of the API methods)
        if (typeof plugin.showSnack !== 'function') {
          throw new Error('plugin.showSnack is not a function');
        }
      `;

      const instance = await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      expect(instance.loaded).toBe(true);
      expect(instance.error).toBeUndefined();
    });

    it('should make "PluginAPI" variable available to plugin code', async () => {
      // Plugin code that checks for 'PluginAPI' variable existence
      const pluginCode = `
        if (typeof PluginAPI === 'undefined') {
          throw new Error('PluginAPI is not defined');
        }
        // Verify PluginAPI has expected properties
        if (typeof PluginAPI.showSnack !== 'function') {
          throw new Error('PluginAPI.showSnack is not a function');
        }
      `;

      const instance = await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      expect(instance.loaded).toBe(true);
      expect(instance.error).toBeUndefined();
    });

    it('should allow plugins to use either "plugin" or "PluginAPI" interchangeably', async () => {
      // Plugin code that verifies both variables reference the same object
      const pluginCode = `
        // Both should reference the same API object
        if (plugin !== PluginAPI) {
          throw new Error('plugin and PluginAPI should be the same object');
        }
      `;

      const instance = await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      expect(instance.loaded).toBe(true);
      expect(instance.error).toBeUndefined();
    });

    it('should capture plugin execution errors', async () => {
      const pluginCode = `
        throw new Error('Intentional test error');
      `;

      const instance = await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      expect(instance.loaded).toBe(false);
      expect(instance.error).toBe('Intentional test error');
    });
  });

  describe('loadPlugin', () => {
    it('should create plugin instance with correct manifest', async () => {
      const pluginCode = `/* no-op */`;

      const instance = await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      expect(instance.manifest).toEqual(mockManifest);
      expect(instance.isEnabled).toBe(true);
    });

    it('should analyze plugin code for security warnings', async () => {
      const pluginCode = `/* no-op */`;

      await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      expect(mockSecurityService.analyzePluginCode).toHaveBeenCalledWith(
        pluginCode,
        mockManifest,
      );
    });

    it('uses plugin i18n for auto-registered side panel labels', async () => {
      mockI18nService.translate
        .withArgs('test-plugin', 'PLUGIN.NAME')
        .and.returnValue('Aufgaben von gestern');

      await service.loadPlugin(
        {
          ...mockManifest,
          sidePanel: true,
          i18n: { languages: ['en', 'de'] },
        },
        `/* no-op */`,
        mockBaseCfg,
      );

      expect(registerSidePanelButtonSpy).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ label: 'Aufgaben von gestern' }),
      );
    });

    it('falls back to manifest name when plugin name i18n is missing', async () => {
      await service.loadPlugin(
        {
          ...mockManifest,
          sidePanel: true,
          i18n: { languages: ['en', 'de'] },
        },
        `/* no-op */`,
        mockBaseCfg,
      );

      expect(registerSidePanelButtonSpy).toHaveBeenCalledOnceWith(
        jasmine.objectContaining({ label: 'Test Plugin' }),
      );
    });
  });

  describe('unloadPlugin', () => {
    it('should cleanup resources when unloading', async () => {
      const pluginCode = `/* no-op */`;
      await service.loadPlugin(mockManifest, pluginCode, mockBaseCfg);

      const result = service.unloadPlugin(mockManifest.id);

      expect(result).toBe(true);
      expect(mockCleanupService.cleanupPlugin).toHaveBeenCalledWith(mockManifest.id);
      expect(mockPluginBridge.unregisterPluginHooks).toHaveBeenCalledWith(
        mockManifest.id,
      );
    });

    it('should return false for unknown plugin', () => {
      const result = service.unloadPlugin('unknown-plugin');

      expect(result).toBe(false);
    });
  });

  describe('triggerReady()', () => {
    // Plugin code runs via `new Function` so it sees globalThis. Tests install
    // observable spies there and the registered onReady fn calls them.
    const READY_GLOBAL = '__pluginRunnerSpec_onReady__';
    const getGlobal = (): Record<string, jasmine.Spy> =>
      (globalThis as unknown as Record<string, Record<string, jasmine.Spy>>)[
        READY_GLOBAL
      ];

    beforeEach(() => {
      (globalThis as unknown as Record<string, Record<string, jasmine.Spy>>)[
        READY_GLOBAL
      ] = {};
    });

    afterEach(() => {
      delete (globalThis as unknown as Record<string, unknown>)[READY_GLOBAL];
    });

    it('should call the registered onReady callback', async () => {
      const readySpy = jasmine.createSpy('ready');
      getGlobal()[mockManifest.id] = readySpy;

      const code = `plugin.onReady(() => globalThis['${READY_GLOBAL}']['${mockManifest.id}']());`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);

      await service.triggerReady(mockManifest.id);
      expect(readySpy).toHaveBeenCalledTimes(1);
    });

    it('should only fire the callback for the specified plugin', async () => {
      const manifestB = { ...mockManifest, id: 'plugin-b', name: 'Plugin B' };
      const aSpy = jasmine.createSpy('aReady');
      const bSpy = jasmine.createSpy('bReady');
      getGlobal()[mockManifest.id] = aSpy;
      getGlobal()[manifestB.id] = bSpy;

      await service.loadPlugin(
        mockManifest,
        `plugin.onReady(() => globalThis['${READY_GLOBAL}']['${mockManifest.id}']());`,
        mockBaseCfg,
      );
      await service.loadPlugin(
        manifestB,
        `plugin.onReady(() => globalThis['${READY_GLOBAL}']['${manifestB.id}']());`,
        mockBaseCfg,
      );

      await service.triggerReady(mockManifest.id);
      expect(aSpy).toHaveBeenCalledTimes(1);
      expect(bSpy).not.toHaveBeenCalled();

      await service.triggerReady(manifestB.id);
      expect(aSpy).toHaveBeenCalledTimes(1);
      expect(bSpy).toHaveBeenCalledTimes(1);
    });

    it('should resolve silently for unknown plugin id', async () => {
      await expectAsync(service.triggerReady('does-not-exist')).toBeResolved();
    });

    it('should ignore onReady registrations from a stale API instance', async () => {
      const staleSpy = jasmine.createSpy('staleReady');
      // plugin leaks its API object so the test can register after unload
      const code = `globalThis['${READY_GLOBAL}']['leakedApi'] = plugin;`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);
      service.unloadPlugin(mockManifest.id);

      const leakedApi = getGlobal()['leakedApi'] as unknown as PluginAPI;
      leakedApi.onReady(staleSpy);

      // reload the plugin: the stale registration must not run in its activation
      await service.loadPlugin(mockManifest, `/* no-op */`, mockBaseCfg);
      await service.triggerReady(mockManifest.id);
      expect(staleSpy).not.toHaveBeenCalled();
    });
  });

  describe('onUnload', () => {
    // Same globalThis-spy pattern as the triggerReady() tests above.
    const UNLOAD_GLOBAL = '__pluginRunnerSpec_onUnload__';
    const getGlobal = (): Record<string, jasmine.Spy> =>
      (globalThis as unknown as Record<string, Record<string, jasmine.Spy>>)[
        UNLOAD_GLOBAL
      ];

    beforeEach(() => {
      (globalThis as unknown as Record<string, Record<string, jasmine.Spy>>)[
        UNLOAD_GLOBAL
      ] = {};
    });

    afterEach(() => {
      delete (globalThis as unknown as Record<string, unknown>)[UNLOAD_GLOBAL];
    });

    it('should call the registered onUnload callback when unloading', async () => {
      const unloadSpy = jasmine.createSpy('unload');
      getGlobal()[mockManifest.id] = unloadSpy;

      const code = `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${mockManifest.id}']());`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);

      expect(unloadSpy).not.toHaveBeenCalled();
      const result = service.unloadPlugin(mockManifest.id);

      expect(result).toBe(true);
      expect(unloadSpy).toHaveBeenCalledTimes(1);
    });

    it('should invoke the callback before hooks are unregistered', async () => {
      const callOrder: string[] = [];
      getGlobal()[mockManifest.id] = jasmine
        .createSpy('unload')
        .and.callFake(() => callOrder.push('onUnload'));
      mockPluginBridge.unregisterPluginHooks.and.callFake(() => {
        callOrder.push('unregisterPluginHooks');
      });

      const code = `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${mockManifest.id}']());`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);
      service.unloadPlugin(mockManifest.id);

      expect(callOrder).toEqual(['onUnload', 'unregisterPluginHooks']);
    });

    it('should not block teardown when the callback throws', async () => {
      getGlobal()[mockManifest.id] = jasmine.createSpy('unload').and.throwError('boom');

      const code = `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${mockManifest.id}']());`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);

      const result = service.unloadPlugin(mockManifest.id);

      expect(result).toBe(true);
      expect(mockCleanupService.cleanupPlugin).toHaveBeenCalledWith(mockManifest.id);
      expect(mockPluginBridge.unregisterPluginHooks).toHaveBeenCalledWith(
        mockManifest.id,
      );
    });

    it('should not block teardown when the callback rejects asynchronously', async () => {
      getGlobal()[mockManifest.id] = jasmine
        .createSpy('unload')
        .and.rejectWith(new Error('async boom'));

      const code = `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${mockManifest.id}']());`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);

      const result = service.unloadPlugin(mockManifest.id);

      expect(result).toBe(true);
      expect(mockCleanupService.cleanupPlugin).toHaveBeenCalledWith(mockManifest.id);
      // let the rejected promise settle so it doesn't leak into other specs
      await new Promise((r) => setTimeout(r, 0));
    });

    it('should fire the callback at most once across triggerUnload and unloadPlugin', async () => {
      const unloadSpy = jasmine.createSpy('unload');
      getGlobal()[mockManifest.id] = unloadSpy;

      const code = `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${mockManifest.id}']());`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);

      // plugin.service fires triggerUnload at the start of teardown, then
      // unloadPlugin runs as part of the same teardown — must not double-fire
      service.triggerUnload(mockManifest.id);
      expect(unloadSpy).toHaveBeenCalledTimes(1);

      const result = service.unloadPlugin(mockManifest.id);
      expect(result).toBe(true);
      expect(unloadSpy).toHaveBeenCalledTimes(1);
    });

    it('should ignore onUnload registrations from a stale API instance', async () => {
      const staleSpy = jasmine.createSpy('staleUnload');
      // plugin leaks its API object so the test can register after unload
      const code = `globalThis['${UNLOAD_GLOBAL}']['leakedApi'] = plugin;`;
      await service.loadPlugin(mockManifest, code, mockBaseCfg);
      service.unloadPlugin(mockManifest.id);

      const leakedApi = getGlobal()['leakedApi'] as unknown as PluginAPI;
      leakedApi.onUnload(staleSpy);

      // reload the plugin: the stale registration must not fire on its unload
      await service.loadPlugin(mockManifest, `/* no-op */`, mockBaseCfg);
      service.unloadPlugin(mockManifest.id);
      expect(staleSpy).not.toHaveBeenCalled();
    });

    it('should only fire the callback of the unloaded plugin', async () => {
      const manifestB = { ...mockManifest, id: 'plugin-b', name: 'Plugin B' };
      const aSpy = jasmine.createSpy('aUnload');
      const bSpy = jasmine.createSpy('bUnload');
      getGlobal()[mockManifest.id] = aSpy;
      getGlobal()[manifestB.id] = bSpy;

      await service.loadPlugin(
        mockManifest,
        `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${mockManifest.id}']());`,
        mockBaseCfg,
      );
      await service.loadPlugin(
        manifestB,
        `plugin.onUnload(() => globalThis['${UNLOAD_GLOBAL}']['${manifestB.id}']());`,
        mockBaseCfg,
      );

      service.unloadPlugin(mockManifest.id);
      expect(aSpy).toHaveBeenCalledTimes(1);
      expect(bSpy).not.toHaveBeenCalled();
    });
  });

  describe('pingNodeBridge()', () => {
    it('should return false for unknown plugin', async () => {
      const result = await service.pingNodeBridge('unknown-plugin');
      expect(result).toBe(false);
    });

    it('should return false when bridge returns false (non-Electron / bridge unavailable)', async () => {
      await service.loadPlugin(mockManifest, `/* no-op */`, mockBaseCfg);
      mockPluginBridge.pingNodeBridge.and.resolveTo(false);
      const result = await service.pingNodeBridge(mockManifest.id);
      expect(result).toBe(false);
    });

    it('should return true when bridge responds successfully', async () => {
      await service.loadPlugin(mockManifest, `/* no-op */`, mockBaseCfg);
      mockPluginBridge.pingNodeBridge.and.resolveTo(true);
      const result = await service.pingNodeBridge(mockManifest.id);
      expect(result).toBe(true);
    });
  });
});
