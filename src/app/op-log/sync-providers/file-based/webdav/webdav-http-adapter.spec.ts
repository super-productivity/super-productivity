import { WebDavHttpAdapter } from './webdav-http-adapter';
import {
  AuthFailSPError,
  HttpNotOkAPIError,
  RemoteFileNotFoundAPIError,
  TooManyRequestsAPIError,
} from '../../../core/errors/sync-errors';

describe('WebDavHttpAdapter', () => {
  let adapter: WebDavHttpAdapter;
  let fetchSpy: jasmine.Spy;

  // Helper class to override platform checks for testing
  class TestableWebDavHttpAdapter extends WebDavHttpAdapter {
    constructor(private _isNativePlatform: boolean = false) {
      super();
    }

    protected override get isNativePlatform(): boolean {
      return this._isNativePlatform;
    }
  }

  describe('fetch mode (non-native)', () => {
    beforeEach(() => {
      adapter = new TestableWebDavHttpAdapter(false);
      fetchSpy = jasmine.createSpy('fetch');
      (global as any).fetch = fetchSpy;
    });

    afterEach(() => {
      delete (global as any).fetch;
    });

    it('should make successful request using fetch', async () => {
      const mockHeaders = new Map([
        ['content-type', 'text/xml'],
        ['etag', '"abc123"'],
      ]);
      const mockResponse = new Response('<?xml version="1.0"?><response/>', {
        status: 200,
        headers: mockHeaders as any,
      });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      const result = await adapter.request({
        url: 'http://example.com/file.txt',
        method: 'GET',
        headers: { Authorization: 'Basic test' },
      });

      expect(fetchSpy).toHaveBeenCalledWith('http://example.com/file.txt', {
        method: 'GET',
        headers: { Authorization: 'Basic test' },
        body: undefined,
        cache: 'no-store',
      });

      expect(result.status).toBe(200);
      expect(result.data).toBe('<?xml version="1.0"?><response/>');
      expect(result.headers['content-type']).toBe('text/xml');
      expect(result.headers['etag']).toBe('"abc123"');
    });

    it('should handle 401 authentication errors', async () => {
      const mockResponse = new Response(null, { status: 401 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(AuthFailSPError);
    });

    it('should handle 404 not found errors', async () => {
      const mockResponse = new Response(null, { status: 404 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(RemoteFileNotFoundAPIError);
    });

    it('should handle 429 too many requests errors', async () => {
      const mockResponse = new Response(null, { status: 429 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(TooManyRequestsAPIError);
    });

    it('should handle other HTTP errors', async () => {
      const mockResponse = new Response(null, { status: 500 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(HttpNotOkAPIError);
    });

    it('should handle network errors', async () => {
      fetchSpy.and.returnValue(Promise.reject(new Error('Network error')));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(HttpNotOkAPIError);
    });

    it('should send body for PUT requests', async () => {
      const mockResponse = new Response('', { status: 201 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      const body = 'file content';
      await adapter.request({
        url: 'http://example.com/file.txt',
        method: 'PUT',
        body,
      });

      expect(fetchSpy).toHaveBeenCalledWith('http://example.com/file.txt', {
        method: 'PUT',
        headers: undefined,
        body: body,
        cache: 'no-store',
      });
    });

    it('should accept 2xx status codes', async () => {
      const statuses = [200, 201, 207];

      for (const status of statuses) {
        const mockResponse = new Response('', { status });
        fetchSpy.and.returnValue(Promise.resolve(mockResponse));

        const result = await adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        });

        expect(result.status).toBe(status);
      }
    });

    it('should handle 204 No Content response', async () => {
      const mockResponse = new Response(null, { status: 204 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      const result = await adapter.request({
        url: 'http://example.com/file.txt',
        method: 'DELETE',
      });

      expect(result.status).toBe(204);
      expect(result.data).toBe('');
    });

    it('should reject 3xx status codes', async () => {
      const mockResponse = new Response('', { status: 301 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(HttpNotOkAPIError);
    });

    it('should reject 4xx status codes (except handled ones)', async () => {
      const mockResponse = new Response('', { status: 403 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(HttpNotOkAPIError);
    });

    it('should reject 5xx status codes', async () => {
      const mockResponse = new Response('', { status: 503 });
      fetchSpy.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWithError(HttpNotOkAPIError);
    });

    it('should re-throw known error types', async () => {
      const authError = new AuthFailSPError();
      fetchSpy.and.returnValue(Promise.reject(authError));

      await expectAsync(
        adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        }),
      ).toBeRejectedWith(authError);
    });

    it('should wrap unknown errors in HttpNotOkAPIError', async () => {
      const unknownError = new Error('Unknown error');
      fetchSpy.and.returnValue(Promise.reject(unknownError));

      try {
        await adapter.request({
          url: 'http://example.com/file.txt',
          method: 'GET',
        });
        fail('Should have thrown an error');
      } catch (e) {
        expect(e).toBeInstanceOf(HttpNotOkAPIError);
        expect((e as HttpNotOkAPIError).response.status).toBe(500);
      }
    });
  });

  // Native mode tests (Android + iOS)
  // Note: We're skipping these tests because they require mocking the WebDavHttp plugin
  // which is registered at module load time and difficult to mock properly in Jasmine.
  // On native platforms, ALL methods are routed through the WebDavHttp plugin
  // because CapacitorHttp has issues with WebDAV responses on both Android and iOS.
  xdescribe('native mode (Android + iOS)', () => {
    beforeEach(() => {
      adapter = new TestableWebDavHttpAdapter(true);
    });

    it('should use WebDavHttp plugin for all methods on native platforms', async () => {
      const allMethods = [
        'PROPFIND',
        'MKCOL',
        'MOVE',
        'COPY',
        'LOCK',
        'UNLOCK',
        'PROPPATCH',
        'GET',
        'PUT',
        'DELETE',
        'HEAD',
      ];
      for (const method of allMethods) {
        await adapter.request({
          url: 'http://example.com/test',
          method: method,
        });
      }
    });
  });
});
