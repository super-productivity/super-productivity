import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { PluginCacheService } from './plugin-cache.service';
import { PluginLoaderService } from './plugin-loader.service';

describe('PluginLoaderService', () => {
  let service: PluginLoaderService;
  let httpMock: HttpTestingController;
  let cacheService: jasmine.SpyObj<PluginCacheService>;

  beforeEach(() => {
    cacheService = jasmine.createSpyObj<PluginCacheService>('PluginCacheService', [
      'getPlugin',
      'clearCache',
    ]);

    TestBed.configureTestingModule({
      providers: [
        PluginLoaderService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PluginCacheService, useValue: cacheService },
      ],
    });

    service = TestBed.inject(PluginLoaderService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  it('loads standard plugin assets from HTTP', async () => {
    const resultPromise = service.loadPluginAssets('/plugins/example');

    httpMock.expectOne('/plugins/example/manifest.json').flush(
      JSON.stringify({
        id: 'example',
        name: 'Example',
        manifestVersion: 1,
        version: '1.0.0',
        minSupVersion: '1.0.0',
        permissions: [],
        hooks: [],
        icon: 'icon.svg',
      }),
    );
    await Promise.resolve();

    httpMock.expectOne('/plugins/example/plugin.js').flush('plugin code');
    await Promise.resolve();

    httpMock.expectOne('/plugins/example/icon.svg').flush('<svg></svg>');

    await expectAsync(resultPromise).toBeResolvedTo(
      jasmine.objectContaining({
        manifest: jasmine.objectContaining({ id: 'example' }),
        code: 'plugin code',
        icon: '<svg></svg>',
      }),
    );
  });

  it('loads uploaded plugin assets from the cache', async () => {
    cacheService.getPlugin.and.resolveTo({
      id: 'uploaded-plugin',
      manifest: JSON.stringify({
        id: 'uploaded-plugin',
        name: 'Uploaded Plugin',
        manifestVersion: 1,
        version: '1.0.0',
        minSupVersion: '1.0.0',
        permissions: [],
        hooks: [],
      }),
      code: 'cached code',
      indexHtml: '<main></main>',
      icon: '<svg></svg>',
      uploadDate: 123,
    });

    await expectAsync(
      service.loadPluginAssets('uploaded://uploaded-plugin'),
    ).toBeResolvedTo(
      jasmine.objectContaining({
        manifest: jasmine.objectContaining({ id: 'uploaded-plugin' }),
        code: 'cached code',
        indexHtml: '<main></main>',
        icon: '<svg></svg>',
      }),
    );
    expect(cacheService.getPlugin).toHaveBeenCalledOnceWith('uploaded-plugin');
  });

  it('throws when uploaded plugin assets are missing from the cache', async () => {
    cacheService.getPlugin.and.resolveTo(null);

    await expectAsync(
      service.loadPluginAssets('uploaded://missing-plugin'),
    ).toBeRejectedWithError('Plugin missing-plugin not found in cache');
  });

  it('clears all plugin caches through the cache service', async () => {
    cacheService.clearCache.and.resolveTo();

    await service.clearAllCaches();

    expect(cacheService.clearCache).toHaveBeenCalledTimes(1);
  });
});
