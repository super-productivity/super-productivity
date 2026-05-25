/* TODO: Temporarily disabled while fixing core plugin issues
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginCacheService } from './plugin-cache.service';
import { PluginManifest } from './plugin-api.model';
import * as validateManifestUtil from './util/validate-manifest.util';

describe('PluginLoaderService', () => {
  let service: PluginLoaderService;
  let httpClient: jasmine.SpyObj<HttpClient>;
  let cacheService: jasmine.SpyObj<PluginCacheService>;
  let validateManifestSpy: jasmine.Spy;

  const mockManifest: PluginManifest = {
    id: 'test-plugin',
    name: 'Test Plugin',
    manifestVersion: 1,
    version: '1.0.0',
    minSupVersion: '1.0.0',
    description: 'Test plugin',
    iFrame: true,
    icon: 'icon.svg',
  };

  beforeEach(() => {
    const httpClientSpy = jasmine.createSpyObj('HttpClient', ['get']);
    const cacheServiceSpy = jasmine.createSpyObj('PluginCacheService', [
      'getPlugin',
      'clearCache',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PluginLoaderService,
        { provide: HttpClient, useValue: httpClientSpy },
        { provide: PluginCacheService, useValue: cacheServiceSpy },
      ],
    });

    service = TestBed.inject(PluginLoaderService);
    httpClient = TestBed.inject(HttpClient) as jasmine.SpyObj<HttpClient>;
    cacheService = TestBed.inject(
      PluginCacheService,
    ) as jasmine.SpyObj<PluginCacheService>;

    // Spy on validatePluginManifest
    validateManifestSpy = spyOn(validateManifestUtil, 'validatePluginManifest');
    validateManifestSpy.and.returnValue({ isValid: true, errors: [] });
  });

  describe('loadPluginAssets', () => {
    it('should load all plugin assets successfully', async () => {
      const pluginPath = '/plugins/test-plugin';
      const manifestText = JSON.stringify(mockManifest);
      const code = 'console.log("test plugin");';
      const indexHtml = '<html><body>Test</body></html>';
      const icon = '<svg>icon</svg>';

      httpClient.get.and.callFake((url: string, options?: any) => {
        if (url === `${pluginPath}/manifest.json`) {
          return of(manifestText);
        } else if (url === `${pluginPath}/plugin.js`) {
          return of(code);
        } else if (url === `${pluginPath}/index.html`) {
          return of(indexHtml);
        } else if (url === `${pluginPath}/${mockManifest.icon}`) {
          return of(icon);
        }
        return throwError(() => new Error('Unknown URL'));
      });

      const result = await service.loadPluginAssets(pluginPath);

      expect(result).toEqual({
        manifest: mockManifest,
        code,
        indexHtml,
        icon,
      });

      expect(httpClient.get).toHaveBeenCalledTimes(4);
      expect(httpClient.get).toHaveBeenCalledWith(`${pluginPath}/manifest.json`, {
        responseType: 'text',
      });
      expect(httpClient.get).toHaveBeenCalledWith(`${pluginPath}/plugin.js`, {
        responseType: 'text',
      });
      expect(httpClient.get).toHaveBeenCalledWith(`${pluginPath}/index.html`, {
        responseType: 'text',
      });
      expect(httpClient.get).toHaveBeenCalledWith(`${pluginPath}/icon.svg`, {
        responseType: 'text',
      });
    });

    it('should load plugin without optional assets', async () => {
      const minimalManifest: PluginManifest = {
        ...mockManifest,
        iFrame: false,
        icon: undefined,
      };
      const pluginPath = '/plugins/minimal';
      const manifestText = JSON.stringify(minimalManifest);
      const code = 'console.log("minimal");';

      httpClient.get.and.callFake((url: string, options?: any) => {
        if (url === `${pluginPath}/manifest.json`) {
          return of(manifestText);
        } else if (url === `${pluginPath}/plugin.js`) {
          return of(code);
        }
        return throwError(() => new Error('Unknown URL'));
      });

      const result = await service.loadPluginAssets(pluginPath);

      expect(result).toEqual({
        manifest: minimalManifest,
        code,
        indexHtml: undefined,
        icon: undefined,
      });

      expect(httpClient.get).toHaveBeenCalledTimes(2);
    });

    it('should handle missing index.html gracefully', async () => {
      const pluginPath = '/plugins/test';
      const manifestText = JSON.stringify(mockManifest);
      const code = 'console.log("test");';

      httpClient.get.and.callFake((url: string, options?: any) => {
        if (url === `${pluginPath}/manifest.json`) {
          return of(manifestText);
        } else if (url === `${pluginPath}/plugin.js`) {
          return of(code);
        } else if (url === `${pluginPath}/index.html`) {
          return throwError(() => new Error('404 Not Found'));
        } else if (url === `${pluginPath}/${mockManifest.icon}`) {
          return of('<svg>icon</svg>');
        }
        return throwError(() => new Error('Unknown URL'));
      });

      spyOn(console, 'warn');

      const result = await service.loadPluginAssets(pluginPath);

      expect(result.indexHtml).toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(
        `No index.html for plugin ${mockManifest.id}`,
      );
    });

    it('should handle missing icon gracefully', async () => {
      const pluginPath = '/plugins/test';
      const manifestText = JSON.stringify(mockManifest);
      const code = 'console.log("test");';
      const indexHtml = '<html>Test</html>';

      httpClient.get.and.callFake((url: string, options?: any) => {
        if (url === `${pluginPath}/manifest.json`) {
          return of(manifestText);
        } else if (url === `${pluginPath}/plugin.js`) {
          return of(code);
        } else if (url === `${pluginPath}/index.html`) {
          return of(indexHtml);
        } else if (url === `${pluginPath}/${mockManifest.icon}`) {
          return throwError(() => new Error('404 Not Found'));
        }
        return throwError(() => new Error('Unknown URL'));
      });

      spyOn(console, 'warn');

      const result = await service.loadPluginAssets(pluginPath);

      expect(result.icon).toBeUndefined();
      expect(console.warn).toHaveBeenCalledWith(`No icon for plugin ${mockManifest.id}`);
    });

    it('should throw error for invalid manifest', async () => {
      const pluginPath = '/plugins/invalid';
      const manifestText = JSON.stringify(mockManifest);

      httpClient.get.and.callFake((url: string, options?: any) => {
        if (url === `${pluginPath}/manifest.json`) {
          return of(manifestText);
        }
        return throwError(() => new Error('Unknown URL'));
      });

      validateManifestSpy.and.returnValue({
        isValid: false,
        errors: ['Missing required field: name', 'Invalid version format'],
      });

      await expectAsync(service.loadPluginAssets(pluginPath)).toBeRejectedWithError(
        'Invalid manifest: Missing required field: name, Invalid version format',
      );
    });

    it('should handle manifest loading error', async () => {
      const pluginPath = '/plugins/error';

      httpClient.get.and.returnValue(throwError(() => new Error('Network error')));

      spyOn(console, 'error');

      await expectAsync(service.loadPluginAssets(pluginPath)).toBeRejectedWithError(
        'Network error',
      );

      expect(console.error).toHaveBeenCalledWith(
        `Failed to load plugin from ${pluginPath}:`,
        jasmine.any(Error),
      );
    });

    it('should handle invalid JSON in manifest', async () => {
      const pluginPath = '/plugins/bad-json';
      const invalidJson = '{ invalid json }';

      httpClient.get.and.returnValue(of(invalidJson));

      spyOn(console, 'error');

      await expectAsync(service.loadPluginAssets(pluginPath)).toBeRejected();

      expect(console.error).toHaveBeenCalledWith(
        `Failed to load plugin from ${pluginPath}:`,
        jasmine.any(Error),
      );
    });

    it('should handle plugin.js loading error', async () => {
      const pluginPath = '/plugins/no-code';
      const manifestText = JSON.stringify(mockManifest);

      httpClient.get.and.callFake((url: string, options?: any) => {
        if (url === `${pluginPath}/manifest.json`) {
          return of(manifestText);
        } else if (url === `${pluginPath}/plugin.js`) {
          return throwError(() => new Error('404 Not Found'));
        }
        return throwError(() => new Error('Unknown URL'));
      });

      spyOn(console, 'error');

      await expectAsync(service.loadPluginAssets(pluginPath)).toBeRejectedWithError(
        '404 Not Found',
      );
    });
  });

  describe('loadUploadedPluginAssets', () => {
    it('should load plugin from cache successfully', async () => {
      const pluginId = 'uploaded-plugin';
      const cachedPlugin = {
        id: pluginId,
        manifest: JSON.stringify(mockManifest),
        code: 'console.log("cached");',
        indexHtml: '<html>Cached</html>',
        icon: '<svg>cached icon</svg>',
        uploadDate: Date.now(),
      };

      cacheService.getPlugin.and.returnValue(Promise.resolve(cachedPlugin));

      const result = await service.loadUploadedPluginAssets(pluginId);

      expect(result).toEqual({
        manifest: mockManifest,
        code: cachedPlugin.code,
        indexHtml: cachedPlugin.indexHtml,
        icon: cachedPlugin.icon,
      });

      expect(cacheService.getPlugin).toHaveBeenCalledWith(pluginId);
    });

    it('should load plugin without optional fields from cache', async () => {
      const pluginId = 'minimal-uploaded';
      const cachedPlugin = {
        id: pluginId,
        manifest: JSON.stringify(mockManifest),
        code: 'console.log("minimal");',
        uploadDate: Date.now(),
      };

      cacheService.getPlugin.and.returnValue(Promise.resolve(cachedPlugin));

      const result = await service.loadUploadedPluginAssets(pluginId);

      expect(result).toEqual({
        manifest: mockManifest,
        code: cachedPlugin.code,
        indexHtml: undefined,
        icon: undefined,
      });
    });

    it('should throw error when plugin not found in cache', async () => {
      const pluginId = 'non-existent';

      cacheService.getPlugin.and.returnValue(Promise.resolve(null));

      await expectAsync(service.loadUploadedPluginAssets(pluginId)).toBeRejectedWithError(
        `Plugin ${pluginId} not found in cache`,
      );
    });

    it('should handle invalid JSON in cached manifest', async () => {
      const pluginId = 'bad-manifest';
      const cachedPlugin = {
        id: pluginId,
        manifest: '{ invalid json }',
        code: 'console.log("test");',
        uploadDate: Date.now(),
      };

      cacheService.getPlugin.and.returnValue(Promise.resolve(cachedPlugin));

      await expectAsync(service.loadUploadedPluginAssets(pluginId)).toBeRejected();
    });

    it('should handle cache service errors', async () => {
      const pluginId = 'error-plugin';

      cacheService.getPlugin.and.returnValue(Promise.reject(new Error('Cache error')));

      await expectAsync(service.loadUploadedPluginAssets(pluginId)).toBeRejectedWithError(
        'Cache error',
      );
    });
  });

  describe('clearAllCaches', () => {
    it('should clear all caches', async () => {
      cacheService.clearCache.and.returnValue(Promise.resolve());

      await service.clearAllCaches();

      expect(cacheService.clearCache).toHaveBeenCalled();
    });

    it('should handle cache clear errors', async () => {
      cacheService.clearCache.and.returnValue(
        Promise.reject(new Error('Clear cache error')),
      );

      await expectAsync(service.clearAllCaches()).toBeRejectedWithError(
        'Clear cache error',
      );
    });
  });
});
*/
