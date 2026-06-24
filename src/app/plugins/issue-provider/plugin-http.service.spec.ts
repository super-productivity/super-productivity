import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import type { NativeHttpResponse } from '@sp/sync-providers/http';
import {
  PluginHttpService,
  PLUGIN_HTTP_IS_NATIVE,
  PLUGIN_HTTP_NATIVE_EXECUTOR,
} from './plugin-http.service';

describe('PluginHttpService', () => {
  let service: PluginHttpService;
  let httpMock: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [PluginHttpService, provideHttpClient(), provideHttpClientTesting()],
    });
    service = TestBed.inject(PluginHttpService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpMock.verify();
  });

  const noopHeaders = (): Record<string, string> => ({});

  // Helper: the internal _request is async (awaits getHeaders), so we need
  // to yield the microtask queue before the HttpClient request is dispatched.
  const flushMicrotasks = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

  describe('URL validation', () => {
    it('should allow valid HTTPS URLs', async () => {
      const http = service.createHttpHelper(noopHeaders);
      const promise = http.get('https://api.github.com/repos');
      await flushMicrotasks();
      const req = httpMock.expectOne('https://api.github.com/repos');
      req.flush({ ok: true });
      await expectAsync(promise).toBeResolved();
    });

    it('should allow valid HTTP URLs', async () => {
      const http = service.createHttpHelper(noopHeaders);
      const promise = http.get('http://example.com/api');
      await flushMicrotasks();
      const req = httpMock.expectOne('http://example.com/api');
      req.flush({ ok: true });
      await expectAsync(promise).toBeResolved();
    });

    it('should reject file:// scheme', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('file:///etc/passwd')).toBeRejectedWithError(
        /Unsupported URL scheme/,
      );
    });

    it('should reject javascript: scheme', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('javascript:alert(1)')).toBeRejectedWithError(
        /Unsupported URL scheme/,
      );
    });

    it('should reject ftp:// scheme', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('ftp://evil.com/file')).toBeRejectedWithError(
        /Unsupported URL scheme/,
      );
    });
  });

  describe('private/local network blocking', () => {
    it('should block localhost', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://localhost/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block 127.0.0.1', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://127.0.0.1/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block 0.0.0.0', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://0.0.0.0/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block ::1', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://[::1]/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block 10.x.x.x ranges', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://10.0.0.1/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block 192.168.x.x ranges', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://192.168.1.1/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block 172.16-31.x.x ranges', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://172.16.0.1/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block 169.254.x.x link-local range', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://169.254.169.254/api')).toBeRejectedWithError(
        /cloud metadata endpoints/,
      );
    });

    it('should block metadata.google.internal', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(
        http.get('https://metadata.google.internal/computeMetadata/v1/'),
      ).toBeRejectedWithError(/cloud metadata endpoints/);
    });

    it('should block IPv6 ULA (fc00::)', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://[fc00::1]/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block IPv6 ULA (fd00::)', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://[fd00::1]/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });

    it('should block IPv6 link-local (fe80::)', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(http.get('https://[fe80::1]/api')).toBeRejectedWithError(
        /private\/local/,
      );
    });
  });

  describe('timeout clamping', () => {
    it('should clamp timeout below minimum to minimum', async () => {
      const http = service.createHttpHelper(noopHeaders);
      const promise = http.get('https://api.example.com/', { timeout: 100 });
      await flushMicrotasks();
      const req = httpMock.expectOne('https://api.example.com/');
      req.flush({ ok: true });
      await expectAsync(promise).toBeResolved();
    });

    it('should clamp timeout above maximum to maximum', async () => {
      const http = service.createHttpHelper(noopHeaders);
      const promise = http.get('https://api.example.com/', { timeout: 999999 });
      await flushMicrotasks();
      const req = httpMock.expectOne('https://api.example.com/');
      req.flush({ ok: true });
      await expectAsync(promise).toBeResolved();
    });

    it('should use default timeout when none specified', async () => {
      const http = service.createHttpHelper(noopHeaders);
      const promise = http.get('https://api.example.com/');
      await flushMicrotasks();
      const req = httpMock.expectOne('https://api.example.com/');
      req.flush({ ok: true });
      await expectAsync(promise).toBeResolved();
    });
  });
});

describe('PluginHttpService - native WebDAV/CalDAV method routing (#8558)', () => {
  let service: PluginHttpService;
  let httpMock: HttpTestingController;
  let nativeHttp: jasmine.Spy<(c: unknown) => Promise<NativeHttpResponse>>;

  const okResponse = (over: Partial<NativeHttpResponse> = {}): NativeHttpResponse => ({
    status: 207,
    headers: {},
    data: '<multistatus/>',
    url: 'https://caldav.icloud.com/',
    ...over,
  });

  beforeEach(() => {
    nativeHttp = jasmine
      .createSpy('nativeHttp')
      .and.resolveTo(okResponse() as NativeHttpResponse);
    TestBed.configureTestingModule({
      providers: [
        PluginHttpService,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PLUGIN_HTTP_IS_NATIVE, useValue: true },
        { provide: PLUGIN_HTTP_NATIVE_EXECUTOR, useValue: nativeHttp },
      ],
    });
    service = TestBed.inject(PluginHttpService);
    httpMock = TestBed.inject(HttpTestingController);
  });

  afterEach(() => httpMock.verify());

  const authHeaders = (): Record<string, string> => ({ Authorization: 'Basic abc' });

  it('routes PROPFIND through the native executor (not HttpClient)', async () => {
    const http = service.createHttpHelper(authHeaders);
    const result = await http.request<string>(
      'PROPFIND',
      'https://caldav.icloud.com/',
      '<propfind/>',
      { responseType: 'text', headers: { Depth: '0' } },
    );
    expect(nativeHttp).toHaveBeenCalledTimes(1);
    const cfg = nativeHttp.calls.mostRecent().args[0] as Record<string, unknown>;
    expect(cfg['method']).toBe('PROPFIND');
    expect(cfg['data']).toBe('<propfind/>');
    expect((cfg['headers'] as Record<string, string>)['Authorization']).toBe('Basic abc');
    expect((cfg['headers'] as Record<string, string>)['Depth']).toBe('0');
    expect(result).toBe('<multistatus/>');
    httpMock.expectNone(() => true);
  });

  it('routes REPORT through the native executor', async () => {
    const http = service.createHttpHelper(authHeaders);
    await http.request('REPORT', 'https://caldav.icloud.com/cal/', '<query/>', {
      responseType: 'text',
    });
    expect(nativeHttp).toHaveBeenCalledTimes(1);
    expect((nativeHttp.calls.mostRecent().args[0] as { method: string }).method).toBe(
      'REPORT',
    );
  });

  it('rejects with an error carrying .status on a non-2xx native response', async () => {
    nativeHttp.and.resolveTo(okResponse({ status: 404, data: '' }));
    const http = service.createHttpHelper(authHeaders);
    await expectAsync(
      http.request('PROPFIND', 'https://caldav.icloud.com/', '<propfind/>', {
        responseType: 'text',
      }),
    ).toBeRejectedWith(jasmine.objectContaining({ status: 404 }));
  });

  it('parses JSON when responseType is not text', async () => {
    nativeHttp.and.resolveTo(okResponse({ status: 200, data: '{"ok":true}' }));
    const http = service.createHttpHelper(authHeaders);
    const result = await http.request<{ ok: boolean }>(
      'PROPFIND',
      'https://caldav.icloud.com/',
      '<propfind/>',
    );
    expect(result).toEqual({ ok: true });
  });

  it('does NOT reroute standard verbs — GET still uses HttpClient', async () => {
    const http = service.createHttpHelper(authHeaders);
    const promise = http.get('https://caldav.icloud.com/');
    await new Promise((r) => setTimeout(r, 0));
    const req = httpMock.expectOne('https://caldav.icloud.com/');
    req.flush({ ok: true });
    await expectAsync(promise).toBeResolved();
    expect(nativeHttp).not.toHaveBeenCalled();
  });
});
