import { describe, expect, it, vi } from 'vitest';
import { md5 as md5HashWasm } from 'hash-wasm';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import { WebdavApi } from '../../../src/file-based/webdav/webdav-api';
import { WebDavHttpHeader } from '../../../src/file-based/webdav/webdav.const';
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
  WebDavNativeRequestError,
  WebDavSyncFolderUnusableSPError,
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
  useCanonicalOcEtag = false,
): WebdavApi =>
  new WebdavApi({
    logger,
    getCfg: async () => overrideCfg,
    httpAdapter: adapter as unknown as WebDavHttpAdapter,
    useCanonicalOcEtag,
  });

const makeNextcloudApi = (adapter: MockAdapter): WebdavApi =>
  makeApi(adapter, NOOP_SYNC_LOGGER, cfg, true);

const okResponse = (
  data: string,
  status = 200,
  headers: Record<string, string> = {},
): WebDavHttpResponse => ({
  status,
  headers,
  data,
});

interface DavRequest {
  method: string;
  headers?: Record<string, string>;
  body?: string | null;
}

interface FakeDavFile {
  body: string;
  tag: string;
}

/**
 * Minimal stateful WebDAV origin: a single file that honours `If-Match` and
 * bumps its entity tag on every write.
 *
 * `etagSuffix` reproduces Apache `mod_deflate` under its default
 * `DeflateAlterETag AddSuffix`: a compressed GET advertises `"<tag>-gzip"`
 * while `If-Match` is still compared against the bare `"<tag>"`. A client that
 * echoes back the tag it was served therefore can never satisfy the
 * precondition — see #9154 / #9196.
 *
 * `If-Match` is evaluated as the RFC 7232 list it is: split on `,`, trimmed,
 * and satisfied if ANY member matches. That mirrors both evaluators that matter
 * — Apache's `ap_find_list_item` (verified live against 2.4 + mod_dav) and
 * sabre/dav's `explode(',', $ifMatch)`, which is what Nextcloud runs.
 */
const makeFakeDavServer = (
  file: FakeDavFile,
  {
    etagSuffix = '',
    exposeOcEtag = false,
  }: { etagSuffix?: string; exposeOcEtag?: boolean } = {},
): MockAdapter => {
  const adapter = makeAdapter();
  let writes = 0;
  const servedTag = (): string => `"${file.tag}${etagSuffix}"`;
  const comparedTag = (): string => `"${file.tag}"`;

  adapter.request.mockImplementation(async (raw: unknown) => {
    const { method, headers, body } = raw as DavRequest;

    if (method === 'GET') {
      return okResponse(file.body, 200, {
        etag: servedTag(),
        ...(exposeOcEtag ? { ['OC-ETag']: comparedTag() } : {}),
      });
    }
    if (method === 'PUT') {
      const ifMatch = headers?.[WebDavHttpHeader.IF_MATCH];
      const candidates = ifMatch?.split(',').map((t) => t.trim());
      if (candidates !== undefined && !candidates.includes(comparedTag())) {
        throw new HttpNotOkAPIError(new Response('', { status: 412 }));
      }
      file.body = body ?? '';
      file.tag = `tag-${(writes += 1)}`;
      return okResponse('', 204, { etag: comparedTag() });
    }
    throw new Error(`FakeDavServer: unexpected ${method}`);
  });

  return adapter;
};

const putsOf = (adapter: MockAdapter): DavRequest[] =>
  adapter.request.mock.calls
    .map((call: unknown[]) => call[0] as DavRequest)
    .filter((req) => req.method === 'PUT');

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

    it('uses a strong ETag as the download revision', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(
        okResponse('hello world', 200, { ETag: '"strong-rev"' }),
      );

      const result = await makeApi(adapter).download({ path: 'op-1.json' });

      expect(result.rev).toBe('"strong-rev"');
    });

    it('uses the canonical OC-ETag when Nextcloud HTTP ETag was rewritten', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(
        okResponse('hello world', 200, {
          ETag: '"strong-rev-gzip"',
          ['OC-ETag']: '"different-rev"',
        }),
      );

      const result = await makeNextcloudApi(adapter).download({ path: 'op-1.json' });

      expect(result.rev).toBe('"different-rev"');
    });

    it('ignores a matching OC-ETag for a generic WebDAV origin', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(
        okResponse('hello world', 200, {
          ETag: '"strong-rev-gzip"',
          ['OC-ETag']: '"strong-rev"',
        }),
      );

      const result = await makeApi(adapter).download({ path: 'op-1.json' });

      expect(result.rev).toBe('"strong-rev-gzip"');
    });

    it('uses a canonical OC-ETag when the HTTP ETag is not exposed', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(
        okResponse('hello world', 200, { ['OC-ETag']: '"strong-rev"' }),
      );

      const result = await makeNextcloudApi(adapter).download({ path: 'op-1.json' });

      expect(result.rev).toBe('"strong-rev"');
    });

    it('uses the content hash when Nextcloud OC-ETag is not exposed', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(
        okResponse('hello world', 200, { ETag: '"strong-rev-gzip"' }),
      );

      const result = await makeNextcloudApi(adapter).download({ path: 'op-1.json' });

      expect(result.rev).toBe(await md5HashWasm('hello world'));
    });

    it('does not trust a weak ETag as an atomic revision', async () => {
      const adapter = makeAdapter();
      adapter.request.mockResolvedValue(
        okResponse('hello world', 200, { etag: 'W/"weak-rev"' }),
      );

      const result = await makeApi(adapter).download({ path: 'op-1.json' });

      expect(result.rev).toBe(await md5HashWasm('hello world'));
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

    it('uses If-Match atomically when the expected revision is a strong ETag', async () => {
      const adapter = makeAdapter();
      const data = 'updated body';
      adapter.request.mockResolvedValueOnce(okResponse('', 204));
      adapter.request.mockResolvedValueOnce(okResponse(data, 200, { etag: '"new-rev"' }));

      const result = await makeApi(adapter).upload({
        path: 'op-1.json',
        data,
        expectedRev: '"old-rev"',
      });

      expect(result.rev).toBe('"new-rev"');
      expect(adapter.request).toHaveBeenCalledTimes(2);
      expect(adapter.request.mock.calls[0]?.[0]).toMatchObject({
        method: 'PUT',
        headers: expect.objectContaining({
          [WebDavHttpHeader.IF_MATCH]: '"old-rev"',
        }),
      });
    });

    it('uses If-None-Match for an atomic create', async () => {
      const adapter = makeAdapter();
      const data = 'new body';
      adapter.request.mockResolvedValueOnce(okResponse('', 201));
      adapter.request.mockResolvedValueOnce(okResponse(data));

      await makeApi(adapter).upload({
        path: 'op-1.json',
        data,
        expectedRev: null,
      });

      expect(adapter.request.mock.calls[0]?.[0]).toMatchObject({
        method: 'PUT',
        headers: expect.objectContaining({
          [WebDavHttpHeader.IF_NONE_MATCH]: '*',
        }),
      });
    });

    it('maps a failed HTTP precondition to RemoteFileChangedUnexpectedly', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValueOnce(
        new HttpNotOkAPIError(new Response('', { status: 412 })),
      );

      await expect(
        makeApi(adapter).upload({
          path: 'op-1.json',
          data: 'mine',
          expectedRev: '"stale-rev"',
        }),
      ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
      expect(putsOf(adapter)).toHaveLength(1);
    });

    describe('servers that rewrite the ETag they serve (#9154 / #9196)', () => {
      it("completes the upload when the served ETag carries mod_deflate's -gzip suffix", async () => {
        const file: FakeDavFile = { body: 'remote body', tag: 'abc' };
        const adapter = makeFakeDavServer(file, {
          etagSuffix: '-gzip',
          exposeOcEtag: true,
        });
        const api = makeNextcloudApi(adapter);

        // Nextcloud supplies the canonical validator explicitly. The app must
        // not reconstruct it from the opaque, content-coded HTTP ETag.
        const { rev } = await api.download({ path: 'op-1.json' });
        expect(rev).toBe('"abc"');

        await api.upload({ path: 'op-1.json', data: 'my new body', expectedRev: rev });

        expect(file.body).toBe('my new body');
        // The write stays atomic and costs no retry: one exact conditional PUT
        // using the validator that Nextcloud itself supplied.
        const puts = putsOf(adapter);
        expect(puts).toHaveLength(1);
        expect(puts[0]?.headers?.[WebDavHttpHeader.IF_MATCH]).toBe('"abc"');
      });

      it('still refuses to overwrite a genuine concurrent write', async () => {
        const file: FakeDavFile = { body: 'remote body', tag: 'abc' };
        const adapter = makeFakeDavServer(file, {
          etagSuffix: '-gzip',
          exposeOcEtag: true,
        });
        const api = makeNextcloudApi(adapter);
        const { rev } = await api.download({ path: 'op-1.json' });

        // Another client writes between our download and our upload.
        file.body = 'their body';
        file.tag = 'xyz';

        await expect(
          api.upload({ path: 'op-1.json', data: 'my new body', expectedRev: rev }),
        ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
        expect(file.body).toBe('their body');
      });

      it('does not treat a derived bare tag as the revision that was downloaded', async () => {
        const file: FakeDavFile = { body: 'remote body', tag: 'abc-gzip' };
        const adapter = makeFakeDavServer(file);
        const api = makeNextcloudApi(adapter);
        const { rev } = await api.download({ path: 'op-1.json' });

        // Entity tags are opaque. `"abc"` is a distinct, newer revision — it
        // must not match merely because the downloaded tag ended in `-gzip`.
        file.body = 'their body';
        file.tag = 'abc';

        await expect(
          api.upload({ path: 'op-1.json', data: 'my new body', expectedRev: rev }),
        ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
        expect(file.body).toBe('their body');
      });

      it('sends a single unexpanded tag to a compliant server', async () => {
        const file: FakeDavFile = { body: 'remote body', tag: 'abc' };
        const adapter = makeFakeDavServer(file);
        const api = makeApi(adapter);
        const { rev } = await api.download({ path: 'op-1.json' });

        await api.upload({ path: 'op-1.json', data: 'my new body', expectedRev: rev });

        const puts = putsOf(adapter);
        expect(puts).toHaveLength(1);
        expect(puts[0]?.headers?.[WebDavHttpHeader.IF_MATCH]).toBe('"abc"');
      });

      it('keeps working once the server re-mangles the tag it just returned', async () => {
        // The rev handed back after an upload is mangled too, so a fix that only
        // recovered once would 412 forever from the second upload on.
        const file: FakeDavFile = { body: 'remote body', tag: 'abc' };
        const adapter = makeFakeDavServer(file, {
          etagSuffix: '-gzip',
          exposeOcEtag: true,
        });
        const api = makeNextcloudApi(adapter);

        const first = await api.download({ path: 'op-1.json' });
        const { rev } = await api.upload({
          path: 'op-1.json',
          data: 'body two',
          expectedRev: first.rev,
        });
        await api.upload({ path: 'op-1.json', data: 'body three', expectedRev: rev });

        expect(file.body).toBe('body three');
        expect(putsOf(adapter)).toHaveLength(2);
      });

      it('does not expand a tag that is only the suffix', async () => {
        // `"-gzip"` is a tag in its own right; expanding it would offer the
        // degenerate `""` alongside it.
        const file: FakeDavFile = { body: 'remote body', tag: '' };
        const adapter = makeFakeDavServer(file, { etagSuffix: '-gzip' });
        const api = makeApi(adapter);
        const { rev } = await api.download({ path: 'op-1.json' });
        expect(rev).toBe('"-gzip"');

        await expect(
          api.upload({ path: 'op-1.json', data: 'mine', expectedRev: rev }),
        ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
        expect(putsOf(adapter)[0]?.headers?.[WebDavHttpHeader.IF_MATCH]).toBe('"-gzip"');
      });

      it('treats a 412 on an atomic create as a conflict, never a retry', async () => {
        // `expectedRev: null` sends `If-None-Match: *` — a 412 there means the
        // file EXISTS, which must never be resolved by overwriting it.
        const adapter = makeAdapter();
        adapter.request.mockRejectedValueOnce(
          new HttpNotOkAPIError(new Response('', { status: 412 })),
        );

        await expect(
          makeApi(adapter).upload({ path: 'op-1.json', data: 'mine', expectedRev: null }),
        ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
        expect(putsOf(adapter)).toHaveLength(1);
      });
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

    it('rejects when a hash-matched file disappeared before upload', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValueOnce(new RemoteFileNotFoundAPIError('op-1.json'));

      await expect(
        makeApi(adapter).upload({
          path: 'op-1.json',
          data: 'new content',
          expectedRev: 'legacy-content-hash',
        }),
      ).rejects.toBeInstanceOf(RemoteFileChangedUnexpectedly);
      expect(adapter.request).toHaveBeenCalledTimes(1);
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

    // A 409 that persists after we create the parent dir means the
    // Base URL / Sync Folder Path is misconfigured (classic Synology /
    // raw-WebDAV setup mistake). Surface an actionable error instead of a
    // bare `HTTP 409 Conflict` so the user knows what to fix.
    it('throws an actionable WebDavSyncFolderUnusableSPError when 409 persists after creating parent', async () => {
      const adapter = makeAdapter();
      const data = 'fresh';
      // First PUT → 409
      adapter.request.mockRejectedValueOnce(
        new HttpNotOkAPIError(new Response('', { status: 409 })),
      );
      // MKCOL → success
      adapter.request.mockResolvedValueOnce(okResponse('', 201));
      // Retry PUT → 409 again (folder path still unresolvable)
      adapter.request.mockRejectedValueOnce(
        new HttpNotOkAPIError(new Response('', { status: 409 })),
      );

      const err = await makeApi(adapter)
        .upload({ path: 'sp/op-1.json', data })
        .catch((e) => e);
      expect(err).toBeInstanceOf(WebDavSyncFolderUnusableSPError);
      // Privacy-safe + actionable message, no path or response body.
      expect(err.message).toContain('Base URL');
      expect(err.message).toContain('Sync Folder Path');
      expect(err.message).not.toContain('op-1.json');
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

    // Issue #7617 follow-up: a 404 must surface a readable, actionable
    // message + a 404 errorCode discriminator (so the Nextcloud UI can show
    // its "Username is not your email" hint). The old behaviour leaked the
    // bare scrubbed host as the message, which users misread as a stripped
    // URL. The message must NOT echo the host/URL.
    it('maps a 404 to a readable message + errorCode 404 (not the bare host)', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(
        new RemoteFileNotFoundAPIError('dav.example.com'),
      );
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
      expect(r.errorCode).toBe(404);
      expect(r.error).toContain('404');
      expect(r.error).not.toBe('dav.example.com');
      expect(r.error).not.toContain('dav.example.com');
    });

    // Safety invariant for #7617: relaxing the folder check must NOT let a
    // bad password through. A 401 on the base root surfaces as
    // AuthFailSPError and must still fail the test (its readable message
    // passes through unchanged; only the 404 case is remapped).
    it('returns success: false on bad credentials (401 → AuthFailSPError)', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(
        new AuthFailSPError('Authentication failed (HTTP 401)'),
      );
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
      expect(r.error).toContain('401');
    });

    it('returns success: false with user-facing error + fullUrl on failure', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(new Error('Network unreachable'));
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
      expect(r.error).toBe('Network unreachable');
      expect(r.fullUrl).toContain('dav.example.com');
    });

    // Issue #8053: on native platforms the adapter wraps a thrown native
    // request error (SSL/timeout/DNS) into WebDavNativeRequestError carrying a
    // readable, already-redacted message. testConnection must surface that
    // message verbatim as `result.error` so the "Test connection" snackbar
    // shows something actionable instead of "Unknown error". This guards the
    // seam between the adapter (proven to redact in webdav-http-adapter.spec)
    // and the user-facing return value.
    it('surfaces a native WebDavNativeRequestError message to the user', async () => {
      const adapter = makeAdapter();
      adapter.request.mockRejectedValue(
        new WebDavNativeRequestError(
          'SSL error: Trust anchor for certification path not found',
          'SSL_ERROR',
        ),
      );
      const r = await makeApi(adapter).testConnection(cfg);
      expect(r.success).toBe(false);
      expect(r.error).toBe('SSL error: Trust anchor for certification path not found');
      expect(r.error).not.toBe('Unknown error');
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
