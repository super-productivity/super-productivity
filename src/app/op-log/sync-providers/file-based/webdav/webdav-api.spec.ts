/* eslint-disable @typescript-eslint/naming-convention */
import { WebdavApi } from './webdav-api';
import { WebdavPrivateCfg } from './webdav.model';
import { WebDavHttpAdapter } from './webdav-http-adapter';
import { WebdavXmlParser } from './webdav-xml-parser';
import {
  HttpNotOkAPIError,
  InvalidDataSPError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
} from '../../../core/errors/sync-errors';
import { md5HashSync } from '../../../../util/md5-hash';

describe('WebdavApi', () => {
  let api: WebdavApi;
  let mockGetCfg: jasmine.Spy;
  let mockHttpAdapter: jasmine.SpyObj<WebDavHttpAdapter>;
  let mockXmlParser: jasmine.SpyObj<WebdavXmlParser>;
  const mockCfg: WebdavPrivateCfg = {
    baseUrl: 'http://example.com/webdav',
    userName: 'testuser',
    password: 'testpass',
    syncFolderPath: '/sync',
    encryptKey: '',
  };

  beforeEach(() => {
    mockGetCfg = jasmine
      .createSpy('getCfgOrError')
      .and.returnValue(Promise.resolve(mockCfg));
    api = new WebdavApi(mockGetCfg);

    // Access private properties for mocking
    mockHttpAdapter = jasmine.createSpyObj('WebDavHttpAdapter', ['request']);
    mockXmlParser = jasmine.createSpyObj('WebdavXmlParser', [
      'parseMultiplePropsFromXml',
      'validateResponseContent',
    ]);
    (api as any).httpAdapter = mockHttpAdapter;
    (api as any).xmlParser = mockXmlParser;
  });

  describe('getFileMeta', () => {
    it('should get file metadata successfully using PROPFIND', async () => {
      const mockResponse = {
        status: 207,
        headers: {},
        data: '<?xml version="1.0"?><multistatus/>',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));

      const mockFileMeta = {
        filename: 'test.txt',
        basename: 'test.txt',
        lastmod: 'Wed, 15 Jan 2025 10:00:00 GMT',
        size: 1234,
        type: 'file',
        etag: 'abc123',
        data: {},
        path: '/test.txt',
      };
      mockXmlParser.parseMultiplePropsFromXml.and.returnValue([mockFileMeta]);

      const result = await api.getFileMeta('/test.txt');

      expect(mockHttpAdapter.request).toHaveBeenCalledWith({
        url: 'http://example.com/webdav/test.txt',
        method: 'PROPFIND',
        body: WebdavXmlParser.PROPFIND_XML,
        headers: jasmine.objectContaining({
          'Content-Type': 'application/xml; charset=utf-8',
          Depth: '0',
        }),
      });

      expect(mockXmlParser.parseMultiplePropsFromXml).toHaveBeenCalledWith(
        '<?xml version="1.0"?><multistatus/>',
        '/test.txt',
      );

      expect(result).toEqual(mockFileMeta);
    });

    it('should throw RemoteFileNotFoundAPIError when PROPFIND returns non-207 status', async () => {
      const mockResponse = {
        status: 404,
        headers: {},
        data: '',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(api.getFileMeta('/test.txt')).toBeRejectedWith(
        jasmine.any(RemoteFileNotFoundAPIError),
      );
    });

    it('should throw RemoteFileNotFoundAPIError when no files parsed from response', async () => {
      const mockResponse = {
        status: 207,
        headers: {},
        data: '<?xml version="1.0"?><multistatus/>',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));
      mockXmlParser.parseMultiplePropsFromXml.and.returnValue([]);

      await expectAsync(api.getFileMeta('/test.txt')).toBeRejectedWith(
        jasmine.any(RemoteFileNotFoundAPIError),
      );
    });

    it('should handle paths with special characters', async () => {
      const mockResponse = {
        status: 207,
        headers: {},
        data: '<?xml version="1.0"?><multistatus/>',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));
      mockXmlParser.parseMultiplePropsFromXml.and.returnValue([
        {
          filename: 'file with spaces.txt',
          basename: 'file with spaces.txt',
          lastmod: 'Wed, 15 Jan 2025 10:00:00 GMT',
          size: 100,
          type: 'file',
          etag: 'def456',
          data: {},
          path: '/folder/file with spaces.txt',
        },
      ]);

      await api.getFileMeta('/folder/file with spaces.txt');

      expect(mockHttpAdapter.request).toHaveBeenCalledWith(
        jasmine.objectContaining({
          url: 'http://example.com/webdav/folder/file%20with%20spaces.txt',
        }),
      );
    });
  });

  describe('download', () => {
    it('should return MD5 hash of content as rev', async () => {
      const content = 'file content';
      const expectedHash = md5HashSync(content);
      const mockResponse = {
        status: 200,
        headers: {},
        data: content,
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));
      mockXmlParser.validateResponseContent.and.stub();

      const result = await api.download({ path: '/test.txt' });

      expect(mockHttpAdapter.request).toHaveBeenCalledWith(
        jasmine.objectContaining({
          url: 'http://example.com/webdav/test.txt',
          method: 'GET',
        }),
      );

      expect(mockXmlParser.validateResponseContent).toHaveBeenCalledWith(
        content,
        '/test.txt',
        'download',
        'file content',
      );

      expect(result).toEqual({
        rev: expectedHash,
        dataStr: content,
      });
    });

    it('should produce the same hash for the same content', async () => {
      const content = 'identical content';
      mockXmlParser.validateResponseContent.and.stub();

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 200, headers: {}, data: content }),
      );
      const result1 = await api.download({ path: '/file1.txt' });

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 200, headers: {}, data: content }),
      );
      const result2 = await api.download({ path: '/file2.txt' });

      expect(result1.rev).toBe(result2.rev);
    });

    it('should produce different hashes for different content', async () => {
      mockXmlParser.validateResponseContent.and.stub();

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 200, headers: {}, data: 'content A' }),
      );
      const result1 = await api.download({ path: '/file.txt' });

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 200, headers: {}, data: 'content B' }),
      );
      const result2 = await api.download({ path: '/file.txt' });

      expect(result1.rev).not.toBe(result2.rev);
    });

    it('should produce identical rev when downloading the same unchanged file twice', async () => {
      const content = '{"tasks":[],"projects":[]}';
      mockXmlParser.validateResponseContent.and.stub();

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 200, headers: {}, data: content }),
      );
      const result1 = await api.download({ path: '/sync/sync-data.json' });

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 200, headers: {}, data: content }),
      );
      const result2 = await api.download({ path: '/sync/sync-data.json' });

      expect(result1.rev).toBe(result2.rev);
      expect(typeof result1.rev).toBe('string');
      expect(result1.rev.length).toBeGreaterThan(0);
    });

    it('should throw InvalidDataSPError when response body is empty', async () => {
      const mockResponse = {
        status: 200,
        headers: {},
        data: '',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(api.download({ path: '/test.txt' })).toBeRejectedWith(
        jasmine.any(InvalidDataSPError),
      );

      // validateResponseContent should NOT be called when empty body is detected
      expect(mockXmlParser.validateResponseContent).not.toHaveBeenCalled();
    });

    it('should call validateResponseContent to detect HTML error pages', async () => {
      const htmlContent = '<html><body>Error</body></html>';
      const mockResponse = {
        status: 200,
        headers: {},
        data: htmlContent,
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));
      mockXmlParser.validateResponseContent.and.throwError('HTML error page detected');

      await expectAsync(api.download({ path: '/test.txt' })).toBeRejected();

      expect(mockXmlParser.validateResponseContent).toHaveBeenCalledWith(
        htmlContent,
        '/test.txt',
        'download',
        'file content',
      );
    });
  });

  describe('upload', () => {
    it('should upload without expectedRev using plain PUT and return hash of uploaded data', async () => {
      const uploadData = 'new content';
      const expectedHash = md5HashSync(uploadData);
      const mockResponse = {
        status: 201,
        headers: {},
        data: '',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));

      const result = await api.upload({
        path: '/test.txt',
        data: uploadData,
        expectedRev: null,
      });

      // Should only make one request (the PUT)
      expect(mockHttpAdapter.request).toHaveBeenCalledTimes(1);
      expect(mockHttpAdapter.request).toHaveBeenCalledWith(
        jasmine.objectContaining({
          url: 'http://example.com/webdav/test.txt',
          method: 'PUT',
          body: uploadData,
          headers: jasmine.objectContaining({
            'Content-Type': 'application/octet-stream',
          }),
        }),
      );

      expect(result).toEqual({ rev: expectedHash });
    });

    it('should do GET-compare-PUT when expectedRev is provided', async () => {
      const existingContent = 'existing content';
      const existingHash = md5HashSync(existingContent);
      const uploadData = 'new content';
      const expectedUploadHash = md5HashSync(uploadData);

      let callCount = 0;
      mockHttpAdapter.request.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          // First call: GET to check current content
          return Promise.resolve({
            status: 200,
            headers: {},
            data: existingContent,
          });
        }
        // Second call: PUT to upload
        return Promise.resolve({ status: 201, headers: {}, data: '' });
      });

      const result = await api.upload({
        path: '/test.txt',
        data: uploadData,
        expectedRev: existingHash,
      });

      expect(mockHttpAdapter.request).toHaveBeenCalledTimes(2);
      // First call should be GET
      expect(mockHttpAdapter.request.calls.argsFor(0)[0]).toEqual(
        jasmine.objectContaining({ method: 'GET' }),
      );
      // Second call should be PUT
      expect(mockHttpAdapter.request.calls.argsFor(1)[0]).toEqual(
        jasmine.objectContaining({ method: 'PUT', body: uploadData }),
      );

      expect(result).toEqual({ rev: expectedUploadHash });
    });

    it('should throw RemoteFileChangedUnexpectedly when content hash mismatches expectedRev', async () => {
      const existingContent = 'modified content on remote';
      const staleHash = md5HashSync('original content');

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({
          status: 200,
          headers: {},
          data: existingContent,
        }),
      );

      await expectAsync(
        api.upload({
          path: '/test.txt',
          data: 'new content',
          expectedRev: staleHash,
        }),
      ).toBeRejectedWith(jasmine.any(RemoteFileChangedUnexpectedly));

      // Should have only made the GET request, not the PUT
      expect(mockHttpAdapter.request).toHaveBeenCalledTimes(1);
      expect(mockHttpAdapter.request.calls.argsFor(0)[0]).toEqual(
        jasmine.objectContaining({ method: 'GET' }),
      );
    });

    it('should skip GET check when isForceOverwrite is true', async () => {
      const uploadData = 'force overwrite content';
      const expectedHash = md5HashSync(uploadData);

      mockHttpAdapter.request.and.returnValue(
        Promise.resolve({ status: 201, headers: {}, data: '' }),
      );

      const result = await api.upload({
        path: '/test.txt',
        data: uploadData,
        expectedRev: 'some-old-rev',
        isForceOverwrite: true,
      });

      // Should only make one request (the PUT), no GET
      expect(mockHttpAdapter.request).toHaveBeenCalledTimes(1);
      expect(mockHttpAdapter.request.calls.argsFor(0)[0]).toEqual(
        jasmine.objectContaining({ method: 'PUT' }),
      );
      expect(result).toEqual({ rev: expectedHash });
    });

    it('should proceed with PUT when GET returns 404 (new file)', async () => {
      const uploadData = 'new file content';
      const expectedHash = md5HashSync(uploadData);

      let callCount = 0;
      mockHttpAdapter.request.and.callFake(() => {
        callCount++;
        if (callCount === 1) {
          // GET returns 404 via RemoteFileNotFoundAPIError
          return Promise.reject(new RemoteFileNotFoundAPIError('/test.txt'));
        }
        // PUT succeeds
        return Promise.resolve({ status: 201, headers: {}, data: '' });
      });

      const result = await api.upload({
        path: '/test.txt',
        data: uploadData,
        expectedRev: 'some-rev',
      });

      expect(mockHttpAdapter.request).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ rev: expectedHash });
    });

    it('should handle 409 Conflict by creating parent directory and retrying', async () => {
      const uploadData = 'new content';
      const expectedHash = md5HashSync(uploadData);
      const errorResponse = new Response(null, { status: 409 });
      const error = new HttpNotOkAPIError(errorResponse);

      // First call: PUT fails with 409
      // Second call: MKCOL to create directory succeeds
      // Third call: PUT retry succeeds
      const mockResponses = [
        Promise.reject(error),
        Promise.resolve({ status: 201, headers: {}, data: '' }),
        Promise.resolve({ status: 201, headers: {}, data: '' }),
      ];
      let callCount = 0;
      mockHttpAdapter.request.and.callFake(() => mockResponses[callCount++]);

      const result = await api.upload({
        path: '/folder/test.txt',
        data: uploadData,
        expectedRev: null,
      });

      expect(mockHttpAdapter.request).toHaveBeenCalledTimes(3);
      // Check MKCOL call
      expect(mockHttpAdapter.request.calls.argsFor(1)[0]).toEqual(
        jasmine.objectContaining({
          url: 'http://example.com/webdav/folder',
          method: 'MKCOL',
        }),
      );
      expect(result).toEqual({ rev: expectedHash });
    });

    it('should throw InvalidDataSPError when upload data is empty string', async () => {
      await expectAsync(
        api.upload({
          path: '/sync/sync-data.json',
          data: '',
          expectedRev: null,
        }),
      ).toBeRejectedWith(jasmine.any(InvalidDataSPError));

      // Should NOT have made any HTTP request
      expect(mockHttpAdapter.request).not.toHaveBeenCalled();
    });

    it('should throw InvalidDataSPError when upload data is whitespace only', async () => {
      await expectAsync(
        api.upload({
          path: '/sync/sync-data.json',
          data: '   ',
          expectedRev: null,
        }),
      ).toBeRejectedWith(jasmine.any(InvalidDataSPError));

      expect(mockHttpAdapter.request).not.toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('should remove file with plain DELETE', async () => {
      const mockResponse = {
        status: 204,
        headers: {},
        data: '',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));

      await api.remove('/test.txt');

      expect(mockHttpAdapter.request).toHaveBeenCalledWith(
        jasmine.objectContaining({
          url: 'http://example.com/webdav/test.txt',
          method: 'DELETE',
        }),
      );
    });
  });

  describe('_buildFullPath', () => {
    it('should build correct full paths', () => {
      expect((api as any)._buildFullPath('http://example.com/', '/file.txt')).toBe(
        'http://example.com/file.txt',
      );
      expect((api as any)._buildFullPath('http://example.com', 'file.txt')).toBe(
        'http://example.com/file.txt',
      );
      expect((api as any)._buildFullPath('http://example.com/', 'file.txt')).toBe(
        'http://example.com/file.txt',
      );
    });

    it('should throw error for invalid path sequences', () => {
      expect(() =>
        (api as any)._buildFullPath('http://example.com/', '../secret'),
      ).toThrowError(/Invalid path/);
      expect(() =>
        (api as any)._buildFullPath('http://example.com/', '//secret'),
      ).toThrowError(/Invalid path/);
    });

    it('should encode path segments with spaces', () => {
      expect(
        (api as any)._buildFullPath('http://example.com/base', '/file with spaces.txt'),
      ).toBe('http://example.com/base/file%20with%20spaces.txt');
    });

    it('should not double-encode already encoded paths', () => {
      expect(
        (api as any)._buildFullPath(
          'http://example.com/base',
          '/file%20with%20spaces.txt',
        ),
      ).toBe('http://example.com/base/file%20with%20spaces.txt');
    });

    it('should handle base URLs with spaces', () => {
      expect(
        (api as any)._buildFullPath('http://example.com/User Name', '/file.txt'),
      ).toBe('http://example.com/User%20Name/file.txt');
    });

    it('should fallback gracefully for invalid URLs', () => {
      const invalidBase = 'not-a-valid-url';
      const path = '/file.txt';
      expect((api as any)._buildFullPath(invalidBase, path)).toBe(
        'not-a-valid-url/file.txt',
      );
    });
  });

  describe('listFiles', () => {
    it('should handle invalid status codes safely when creating error Response', async () => {
      const mockResponse = {
        status: 0,
        headers: {},
        data: 'error body',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));

      await expectAsync(api.listFiles('/folder/')).toBeRejectedWith(
        jasmine.any(HttpNotOkAPIError),
      );
    });

    it('should return files from successful PROPFIND response', async () => {
      const mockResponse = {
        status: 207,
        headers: {},
        data: '<?xml version="1.0"?><multistatus/>',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));
      mockXmlParser.parseMultiplePropsFromXml.and.returnValue([
        {
          filename: 'file1.txt',
          basename: 'file1.txt',
          lastmod: '',
          size: 0,
          type: 'file',
          etag: '',
          data: {},
          path: '/folder/file1.txt',
        },
        {
          filename: 'subfolder',
          basename: 'subfolder',
          lastmod: '',
          size: 0,
          type: 'directory',
          etag: '',
          data: {},
          path: '/folder/subfolder',
        },
      ]);

      const result = await api.listFiles('/folder/');
      // Should only return files, not directories
      expect(result).toEqual(['/folder/file1.txt']);
    });
  });

  describe('_createDirectory', () => {
    it('should re-throw unexpected errors instead of swallowing them', async () => {
      const errorResponse = new Response(null, { status: 403 });
      const error = new HttpNotOkAPIError(errorResponse);

      let callCount = 0;
      mockHttpAdapter.request.and.callFake((params) => {
        callCount++;
        if (params.method === 'PUT' && callCount === 1) {
          const conflictResponse = new Response(null, { status: 409 });
          return Promise.reject(new HttpNotOkAPIError(conflictResponse));
        }
        if (params.method === 'MKCOL') {
          return Promise.reject(error);
        }
        return Promise.resolve({ status: 200, headers: {}, data: '' });
      });

      await expectAsync(
        api.upload({
          path: '/restricted/test.txt',
          data: 'content',
          expectedRev: null,
        }),
      ).toBeRejectedWith(jasmine.any(HttpNotOkAPIError));
    });

    it('should not throw for known "directory exists" status codes', async () => {
      const errorResponse405 = new Response(null, { status: 405 });
      const error405 = new HttpNotOkAPIError(errorResponse405);
      const uploadData = 'content';
      const expectedHash = md5HashSync(uploadData);

      let callCount = 0;
      mockHttpAdapter.request.and.callFake((params) => {
        callCount++;
        if (params.method === 'PUT' && callCount === 1) {
          const conflictResponse = new Response(null, { status: 409 });
          return Promise.reject(new HttpNotOkAPIError(conflictResponse));
        }
        if (params.method === 'MKCOL') {
          // 405 means directory already exists - should not throw
          return Promise.reject(error405);
        }
        if (params.method === 'PUT') {
          return Promise.resolve({ status: 201, headers: {}, data: '' });
        }
        return Promise.resolve({ status: 200, headers: {}, data: '' });
      });

      const result = await api.upload({
        path: '/folder/test.txt',
        data: uploadData,
        expectedRev: null,
      });
      expect(result).toEqual({ rev: expectedHash });
    });
  });

  describe('error handling', () => {
    it('should call getCfgOrError for each operation', async () => {
      const mockResponse = {
        status: 207,
        headers: {},
        data: '<?xml version="1.0"?><multistatus/>',
      };
      mockHttpAdapter.request.and.returnValue(Promise.resolve(mockResponse));
      mockXmlParser.parseMultiplePropsFromXml.and.returnValue([
        {
          filename: 'test.txt',
          basename: 'test.txt',
          lastmod: '',
          size: 0,
          type: 'file',
          etag: '',
          data: {},
          path: '/test.txt',
        },
      ]);

      await api.getFileMeta('/test.txt');

      expect(mockGetCfg).toHaveBeenCalled();
    });

    it('should propagate errors from getCfgOrError', async () => {
      const error = new Error('Config error');
      mockGetCfg.and.returnValue(Promise.reject(error));

      await expectAsync(api.getFileMeta('/test.txt')).toBeRejectedWith(error);
    });
  });
});
