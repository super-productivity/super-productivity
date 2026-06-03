import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Observable, of, throwError } from 'rxjs';
import { PluginCacheService } from './plugin-cache.service';
import { PluginLoaderService } from './plugin-loader.service';
import { PluginManifest } from './plugin-api.model';

describe('PluginLoaderService iframe-only plugins', () => {
  let service: PluginLoaderService;
  let httpGet: jasmine.Spy;

  const pluginPath = '/plugins/iframe-only';
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

  const expectRejectsWithHttpStatus = async (
    promise: Promise<unknown>,
    status: number,
  ): Promise<void> => {
    try {
      await promise;
      fail(`Expected promise to reject with HTTP status ${status}`);
    } catch (error) {
      expect(error).toEqual(jasmine.any(HttpErrorResponse));
      expect((error as HttpErrorResponse).status).toBe(status);
    }
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        PluginLoaderService,
        { provide: HttpClient, useValue: { get: jasmine.createSpy('get') } },
        {
          provide: PluginCacheService,
          useValue: jasmine.createSpyObj<PluginCacheService>('PluginCacheService', [
            'getPlugin',
            'clearCache',
          ]),
        },
      ],
    });

    service = TestBed.inject(PluginLoaderService);
    httpGet = TestBed.inject(HttpClient).get as jasmine.Spy;
  });

  it('loads an iframe plugin without plugin.js when index.html is available', async () => {
    const indexHtml = '<!doctype html><html><body>Plugin UI</body></html>';
    httpGet.and.callFake((url: string): Observable<string> => {
      if (url === `${pluginPath}/manifest.json`) {
        return of(JSON.stringify(iframeManifest));
      }
      if (url === `${pluginPath}/plugin.js`) {
        return throwError(
          () => new HttpErrorResponse({ status: 404, statusText: 'Not Found' }),
        );
      }
      if (url === `${pluginPath}/index.html`) {
        return of(indexHtml);
      }
      return throwError(() => new Error(`Unexpected URL: ${url}`));
    });

    const result = await service.loadPluginAssets(pluginPath);

    expect(result.manifest).toEqual(iframeManifest);
    expect(result.code).toBe('');
    expect(result.indexHtml).toBe(indexHtml);
  });

  it('still requires plugin.js for plugins without iframe UI', async () => {
    const standardManifest: PluginManifest = {
      ...iframeManifest,
      iFrame: false,
    };
    httpGet.and.callFake((url: string): Observable<string> => {
      if (url === `${pluginPath}/manifest.json`) {
        return of(JSON.stringify(standardManifest));
      }
      if (url === `${pluginPath}/plugin.js`) {
        return throwError(() => new HttpErrorResponse({ status: 404 }));
      }
      return throwError(() => new Error(`Unexpected URL: ${url}`));
    });

    await expectRejectsWithHttpStatus(service.loadPluginAssets(pluginPath), 404);
  });

  it('requires index.html when plugin.js is missing for an iframe plugin', async () => {
    httpGet.and.callFake((url: string): Observable<string> => {
      if (url === `${pluginPath}/manifest.json`) {
        return of(JSON.stringify(iframeManifest));
      }
      if (url === `${pluginPath}/plugin.js`) {
        return throwError(() => new HttpErrorResponse({ status: 404 }));
      }
      if (url === `${pluginPath}/index.html`) {
        return throwError(() => new Error('404 index.html'));
      }
      return throwError(() => new Error(`Unexpected URL: ${url}`));
    });

    await expectRejectsWithHttpStatus(service.loadPluginAssets(pluginPath), 404);
  });

  it('does not hide non-404 plugin.js load failures', async () => {
    httpGet.and.callFake((url: string): Observable<string> => {
      if (url === `${pluginPath}/manifest.json`) {
        return of(JSON.stringify(iframeManifest));
      }
      if (url === `${pluginPath}/plugin.js`) {
        return throwError(
          () =>
            new HttpErrorResponse({
              status: 500,
              statusText: 'Internal Server Error',
            }),
        );
      }
      return throwError(() => new Error(`Unexpected URL: ${url}`));
    });

    await expectRejectsWithHttpStatus(service.loadPluginAssets(pluginPath), 500);
  });

  it('requires non-empty index.html when plugin.js is missing', async () => {
    httpGet.and.callFake((url: string): Observable<string> => {
      if (url === `${pluginPath}/manifest.json`) {
        return of(JSON.stringify(iframeManifest));
      }
      if (url === `${pluginPath}/plugin.js`) {
        return throwError(() => new HttpErrorResponse({ status: 404 }));
      }
      if (url === `${pluginPath}/index.html`) {
        return of(' ');
      }
      return throwError(() => new Error(`Unexpected URL: ${url}`));
    });

    await expectAsync(service.loadPluginAssets(pluginPath)).toBeRejectedWithError(
      'Plugin iframe-only requires a non-empty index.html when plugin.js is missing',
    );
  });
});
