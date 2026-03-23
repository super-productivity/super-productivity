import { TestBed } from '@angular/core/testing';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { provideHttpClient } from '@angular/common/http';
import { PluginHttpService } from './plugin-http.service';

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
        /private\/local/,
      );
    });

    it('should block metadata.google.internal', async () => {
      const http = service.createHttpHelper(noopHeaders);
      await expectAsync(
        http.get('https://metadata.google.internal/computeMetadata/v1/'),
      ).toBeRejectedWithError(/private\/local/);
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
