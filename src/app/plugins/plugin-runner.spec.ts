import { TestBed } from '@angular/core/testing';
import { PluginRunner } from './plugin-runner';
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
    ]);
    // createBoundMethods should return an empty object (no additional bound methods)
    mockPluginBridge.createBoundMethods.and.returnValue({} as any);

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

  it('should be created', () => {
    expect(service).toBeTruthy();
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
});
