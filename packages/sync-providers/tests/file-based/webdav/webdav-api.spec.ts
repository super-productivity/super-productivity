import { describe, expect, it, vi } from 'vitest';
import { md5 as md5HashWasm } from 'hash-wasm';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import { WebdavApi } from '../../../src/file-based/webdav/webdav-api';
import type {
  WebDavHttpAdapter,
  WebDavHttpResponse,
} from '../../../src/file-based/webdav/webdav-http-adapter';
import type { WebdavPrivateCfg } from '../../../src/webdav';
import {
  AuthFailSPError,
  EmptyRemoteBodySPError,
  HttpNotOkAPIError,
  InvalidDataSPError,
  MissingCredentialsSPError,
  RemoteFileChangedUnexpectedly,
  RemoteFileNotFoundAPIError,
} from '../../../src/errors';

const cfg: WebdavPrivateCfg = {
  baseUrl: 'https://dav.example.com/dav/',
  userName: 'alice',
  password: 'secret',
  syncFolderPath: 'sp',
};

const sampleListing = `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/sp/</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>sp</D:displayname>
        <D:getcontentlength>0</D:getcontentlength>
        <D:resourcetype><D:collection/></D:resourcetype>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>/dav/sp/op-1.json</D:href>
    <D:propstat>
      <D:prop>
        <D:displayname>op-1.json</D:displayname>
        <D:getcontentlength>10</D:getcontentlength>
        <D:resourcetype/>
      </D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

interface MockAdapter {
  request: ReturnType<typeof vi.fn>;
}

const makeAdapter = (): MockAdapter => ({
  request: vi.fn<(_: unknown) => Promise<WebDavHttpResponse>>(),
});

const makeApi = (
  adapter: MockAdapter,
  logger: SyncLogger = NOOP_SYNC_LOGGER,
  overrideCfg: WebdavPrivateCfg = cfg,
): WebdavApi =>
  new WebdavApi({
    logger,
    getCfg: async () => overrideCfg,
    httpAdapter: adapter as unknown as WebDavHttpAdapter,
  });

const okResponse = (data: string, status = 200): WebDavHttpResponse => ({
  status,
  headers: {},
  data,
});

describe('WebdavApi', () => {
  describe('listFiles', () => {
    it('returns file paths from PROPFIND multistatus, filtering folder itself', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse(sampleListing, 207));

      const result = await makeApi(adapter).listFiles('sp/');
      expect(result).toEqual(['/dav/sp/op-1.json']);
    });

    it('returns empty array on 404', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse('', 404));
      const result = await makeApi(adapter).listFiles('missing/');
      expect(result).toEqual([]);
    });

    it('also returns empty array on HttpNotOkAPIError with 404 in catch', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(
        new HttpNotOkAPIError(new Response('', { status: 404 })),
      );
      const result = await makeApi(adapter).listFiles('missing/');
      expect(result).toEqual([]);
    });
  });

  describe('download', () => {
    it('returns dataStr and md5 rev', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse('hello world'));
      const r = await makeApi(adapter).download({ path: 'op-1.json' });
      expect(r.dataStr).toBe('hello world');
      expect(r.rev).toBe(await md5HashWasm('hello world'));
    });

    it('throws EmptyRemoteBodySPError on empty body', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse(''));
      await expect(
        makeApi(adapter).download({ path: 'op-1.json' }),
      ).rejects.toBeInstanceOf(EmptyRemoteBodySPError);
    });

    it('throws RemoteFileNotFoundAPIError when body is HTML', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse('<!DOCTYPE html><html/>'));
      await expect(
        makeApi(adapter).download({ path: 'op-1.json' }),
      ).rejects.toBeInstanceOf(RemoteFileNotFoundAPIError);
    });
  });

  describe('upload', () => {
    it('rejects empty data upfront', async () => {
      const adapter = makeAdapter();
      await expect(
        makeApi(adapter).upload({ path: 'op-1.json', data: '   ' }),
      ).rejects.toBeInstanceOf(InvalidDataSPError);
      expect(adapter.request).not.toHaveBeenCalled();
    });

    it('uploads when expectedRev matches current content hash', async () => {
      const adapter = makeAdapter();
      const data = 'updated body';
      const currentRev = await md5HashWasm('current body');
      // 1. GET current for conditional check
      adapter.request.mockResolvedValueOnce(okResponse('current body'));
      // 2. PUT new data
      adapter.request.mockResolvedValueOnce(okResponse('', 201));
      // 3. verify GET returns same data we sent
      adapter.request.mockResolvedValueOnce(okResponse(data));

      // First call expects same-rev semantics — force the first GET to return
      // bytes whose hash != expectedRev triggers conflict; here we set
      // expectedRev to the hash of "current body" so PUT proceeds.
      const r = await makeApi(adapter).upload({
        path: 'op-1.json',
        data,
        expectedRev: currentRev,
      });

      expect(r.rev).toBe(await md5HashWasm(data));
      expect(adapter.request).toHaveBeenCalledTimes(3);
    });

    it('throws RemoteFileChangedUnexpectedly when remote hash drift detected', async () => {
      const adapter = makeAdapter();
      // GET returns body whose hash differs from expectedRev
      adapter.request.mockResolvedValueOnce(okResponse('remote-changed'));

      await expect(
        makeApi(adapter).upload({
          path: 'op-1.json',
          data: 'mine',
          expectedRev: 'stale-rev',
        }),
      ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
    });

    it('proceeds on 404 conditional GET (file does not exist yet)', async () => {
      const adapter = makeAdapter();
      const data = 'new content';
      adapter.request.mockRejectedValueOnce(new RemoteFileNotFoundAPIError('op-1.json'));
      // PUT succeeds
      adapter.request.mockResolvedValueOnce(okResponse('', 201));
      // verify GET
      adapter.request.mockResolvedValueOnce(okResponse(data));

      const r = await makeApi(adapter).upload({
        path: 'op-1.json',
        data,
        expectedRev: 'something',
      });

      expect(r.rev).toBe(await md5HashWasm(data));
    });

    it('throws RemoteFileChangedUnexpectedly when verify-after-upload hash mismatches', async () => {
      const adapter = makeAdapter();
      const data = 'good';
      // skip conditional (no expectedRev)
      adapter.request.mockResolvedValueOnce(okResponse('', 201)); // PUT
      adapter.request.mockResolvedValueOnce(okResponse('truncated')); // verify

      await expect(
        makeApi(adapter).upload({ path: 'op-1.json', data }),
      ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
    });

    it('creates parent directory on 409 then retries PUT', async () => {
      const adapter = makeAdapter();
      const data = 'fresh';
      // First PUT → 409
      adapter.request.mockRejectedValueOnce(
        new HttpNotOkAPIError(new Response('', { status: 409 })),
      );
      // MKCOL → success
      adapter.request.mockResolvedValueOnce(okResponse('', 201));
      // Retry PUT → success
      adapter.request.mockResolvedValueOnce(okResponse('', 201));
      // verify GET
      adapter.request.mockResolvedValueOnce(okResponse(data));

      const r = await makeApi(adapter).upload({ path: 'sp/op-1.json', data });
      expect(r.rev).toBe(await md5HashWasm(data));
      // PUT + MKCOL + PUT + GET
      expect(adapter.request).toHaveBeenCalledTimes(4);
    });
  });

  describe('remove', () => {
    it('issues a DELETE for the full path', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse('', 204));
      await makeApi(adapter).remove('op-1.json');
      const call = adapter.request.mock.calls[0]?.[0] as { method: string };
      expect(call.method).toBe('DELETE');
    });
  });

  describe('testConnection', () => {
    it('returns success on 207', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse(sampleListing, 207));
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(true);
    });

    // Regression: issue #7617. The probe must hit the WebDAV base ROOT,
    // not `baseUrl + syncFolderPath`. On a first-time setup the sync
    // folder does not exist yet (created lazily on first upload), so
    // probing it would 404 and falsely fail an otherwise valid config.
    it('probes the base root, not the configured sync folder', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(okResponse(sampleListing, 207));
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(true);
      expect(adapter.request).toHaveBeenCalledTimes(1);
      const arg = adapter.request.mock.calls[0][0] as { url: string };
      expect(arg.url).toBe('https://dav.example.com/dav/');
      expect(arg.url).not.toContain('/sp');
      // ...but the result still reports the configured sync folder (where
      // data will sync), NOT the probed root — UI invariant.
      expect(r.fullUrl).toBe('https://dav.example.com/dav/sp');
    });

    // A wrong username / base path makes the base root itself 404 on
    // Nextcloud — that is a genuine misconfig and must still fail.
    it('returns success: false when the base root is 404 (wrong base/username)', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(
        new RemoteFileNotFoundAPIError('https://dav.example.com/dav/'),
      );
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
    });

    // Safety invariant for #7617: relaxing the folder check must NOT let a
    // bad password through. A 401 on the base root surfaces as
    // AuthFailSPError and must still fail the test.
    it('returns success: false on bad credentials (401 → AuthFailSPError)', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(new AuthFailSPError());
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
    });

    it('returns success: false with user-facing error + fullUrl on failure', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(new Error('Network unreachable'));
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
      expect(r.error).toBe('Network unreachable');
      expect(r.fullUrl).toContain('dav.example.com');
    });

    it('privacy invariant: logger meta on failure carries no raw error / URL', async () => {
      const calls: Array<{ msg: string; meta?: unknown }> = [];
      const push = (msg: string, meta?: unknown): void => {
        calls.push({ msg, meta });
      };
      const logger: SyncLogger = {
        ...NOOP_SYNC_LOGGER,
        normal: push,
        critical: push,
      };
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(
        new Error('Embedded https://user:pass@dav.example.com/dav/?token=secret'),
      );
      await makeApi(adapter, logger).testConnection(cfg);

      // The returned error string is user-facing and intentionally readable;
      // privacy invariant lives on the logger side. testConnection logs at
      // `normal` (not `critical`) since misconfig retries are expected, but
      // either level the meta must be structured.
      const meta = calls[0]?.meta as { errorName?: string };
      expect(meta?.errorName).toBe('Error');
      expect(JSON.stringify(calls)).not.toContain('user:pass');
      expect(JSON.stringify(calls)).not.toContain('secret');
    });
  });

  describe('_buildFullPath (via list)', () => {
    it('throws MissingCredentialsSPError when baseUrl is missing', async () => {
      const adapter = makeAdapter();
      const api = makeApi(adapter, NOOP_SYNC_LOGGER, {
        ...cfg,
        baseUrl: '',
      } as WebdavPrivateCfg);
      await expect(api.listFiles('/')).rejects.toBeInstanceOf(MissingCredentialsSPError);
    });

    it('throws InvalidDataSPError for paths with .. (no path echo in message)', async () => {
      const adapter = makeAdapter();
      const api = makeApi(adapter);
      try {
        await api.listFiles('../escape');
        expect.fail('expected throw');
      } catch (e) {
        expect(e).toBeInstanceOf(InvalidDataSPError);
        expect((e as Error).message).not.toContain('../escape');
      }
    });
  });

  describe('privacy: A3 sweep — never log raw errors', () => {
    it('listFiles error meta does not embed raw Error', async () => {
      const calls: Array<{ msg: string; meta?: unknown }> = [];
      const logger: SyncLogger = {
        ...NOOP_SYNC_LOGGER,
        critical: (msg, meta) => calls.push({ msg, meta }),
      };
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(new Error('inner-leak-token-xyz'));
      const api = makeApi(adapter, logger);
      await expect(api.listFiles('sp/')).rejects.toThrow();

      // critical was called; meta must be structured, not raw error
      expect(calls.length).toBeGreaterThan(0);
      const meta = calls[0].meta as { errorName?: string };
      expect(meta?.errorName).toBe('Error');
      expect(JSON.stringify(calls)).not.toContain('inner-leak-token-xyz');
    });
  });
});
