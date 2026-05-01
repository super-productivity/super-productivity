import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { PluginConfigService } from './plugin-config.service';
import { PluginCacheService, CachedPlugin } from './plugin-cache.service';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { PluginManifest } from './plugin-api.model';

const BASE_MANIFEST: PluginManifest = {
  id: 'test-plugin',
  name: 'Test Plugin',
  version: '1.0.0',
  manifestVersion: 1,
  minSupVersion: '1.0.0',
  hooks: [],
  permissions: [],
  jsonSchemaCfg: 'config-schema.json',
};

const VALID_SCHEMA = { type: 'object', properties: { apiKey: { type: 'string' } } };

const makeCache = (overrides: Partial<CachedPlugin> = {}): CachedPlugin => ({
  id: 'test-plugin',
  manifest: JSON.stringify(BASE_MANIFEST),
  code: 'console.log("test");',
  uploadDate: Date.now(),
  ...overrides,
});

describe('PluginConfigService', () => {
  let service: PluginConfigService;
  let cacheSpy: jasmine.SpyObj<PluginCacheService>;
  let httpSpy: jasmine.SpyObj<HttpClient>;

  beforeEach(() => {
    cacheSpy = jasmine.createSpyObj('PluginCacheService', ['getPlugin']);
    httpSpy = jasmine.createSpyObj('HttpClient', ['get']);

    TestBed.configureTestingModule({
      providers: [
        PluginConfigService,
        { provide: PluginCacheService, useValue: cacheSpy },
        { provide: HttpClient, useValue: httpSpy },
        {
          provide: PluginUserPersistenceService,
          useValue: jasmine.createSpyObj('PluginUserPersistenceService', [
            'loadPluginUserData',
            'persistPluginUserData',
          ]),
        },
      ],
    });

    service = TestBed.inject(PluginConfigService);
  });

  describe('loadPluginConfigSchema - uploaded:// plugins', () => {
    it('should return parsed schema from cache for uploaded plugin', async () => {
      cacheSpy.getPlugin.and.resolveTo(
        makeCache({ configSchema: JSON.stringify(VALID_SCHEMA) }),
      );

      const result = await service.loadPluginConfigSchema(
        BASE_MANIFEST,
        'uploaded://test-plugin',
      );

      expect(cacheSpy.getPlugin).toHaveBeenCalledWith('test-plugin');
      expect(result).toEqual(VALID_SCHEMA as any);
    });

    it('should throw when configSchema is missing from cache', async () => {
      cacheSpy.getPlugin.and.resolveTo(makeCache({ configSchema: undefined }));

      await expectAsync(
        service.loadPluginConfigSchema(BASE_MANIFEST, 'uploaded://test-plugin'),
      ).toBeRejectedWithError(/No config schema found for uploaded plugin test-plugin/);
    });

    it('should throw when plugin is not in cache at all', async () => {
      cacheSpy.getPlugin.and.resolveTo(null);

      await expectAsync(
        service.loadPluginConfigSchema(BASE_MANIFEST, 'uploaded://test-plugin'),
      ).toBeRejectedWithError(/No config schema found for uploaded plugin test-plugin/);
    });

    it('should throw when configSchema contains invalid JSON', async () => {
      cacheSpy.getPlugin.and.resolveTo(makeCache({ configSchema: '{ not valid json' }));

      await expectAsync(
        service.loadPluginConfigSchema(BASE_MANIFEST, 'uploaded://test-plugin'),
      ).toBeRejected();
    });
  });

  describe('loadPluginConfigSchema - bundled/remote plugins', () => {
    it('should fetch schema via HTTP for non-uploaded plugins', async () => {
      httpSpy.get.and.returnValue(of(VALID_SCHEMA) as any);

      const result = await service.loadPluginConfigSchema(
        BASE_MANIFEST,
        'assets/bundled-plugins/test-plugin',
      );

      expect(httpSpy.get).toHaveBeenCalledWith(
        'assets/bundled-plugins/test-plugin/config-schema.json',
      );
      expect(result).toEqual(VALID_SCHEMA as any);
    });

    it('should throw when HTTP fetch fails', async () => {
      httpSpy.get.and.returnValue(throwError(() => new Error('404 Not Found')) as any);

      await expectAsync(
        service.loadPluginConfigSchema(
          BASE_MANIFEST,
          'assets/bundled-plugins/test-plugin',
        ),
      ).toBeRejected();
    });
  });

  describe('loadPluginConfigSchema - guard conditions', () => {
    it('should throw when manifest has no jsonSchemaCfg', async () => {
      const manifest: PluginManifest = { ...BASE_MANIFEST, jsonSchemaCfg: undefined };

      await expectAsync(
        service.loadPluginConfigSchema(manifest, 'uploaded://test-plugin'),
      ).toBeRejectedWithError('Plugin does not have a JSON schema configuration');
    });

    it('should throw when pluginPath is empty', async () => {
      await expectAsync(
        service.loadPluginConfigSchema(BASE_MANIFEST, ''),
      ).toBeRejectedWithError(/Plugin path not provided/);
    });
  });
});
