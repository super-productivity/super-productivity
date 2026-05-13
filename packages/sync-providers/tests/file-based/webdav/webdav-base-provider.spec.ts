import { describe, expect, it, vi } from 'vitest';
import { md5 as md5HashWasm } from 'hash-wasm';
import { NOOP_SYNC_LOGGER } from '@sp/sync-core';
import {
  NextcloudProvider,
  PROVIDER_ID_NEXTCLOUD,
  PROVIDER_ID_WEBDAV,
  Webdav,
  type NextcloudPrivateCfg,
  type WebdavPrivateCfg,
} from '../../../src/webdav';
import type { SyncCredentialStorePort } from '../../../src/credential-store';
import type { NativeHttpExecutor } from '../../../src/http';
import {
  MissingCredentialsSPError,
  UploadRevToMatchMismatchAPIError,
} from '../../../src/errors';
import { createStatefulCredentialStore } from '../../helpers/credential-store';

const fakeStore = <PID extends string, T>(
  initial: T | null,
): SyncCredentialStorePort<PID, T> =>
  createStatefulCredentialStore<PID, T>(initial, { spy: false });

const nativeNoop: NativeHttpExecutor = async () => ({
  status: 200,
  headers: {},
  data: '',
});

const propfindXml = (path: string): string => `<?xml version="1.0" encoding="utf-8"?>
<D:multistatus xmlns:D="DAV:">
  <D:response>
    <D:href>/dav/sp/</D:href>
    <D:propstat>
      <D:prop><D:displayname>sp</D:displayname><D:getcontentlength>0</D:getcontentlength><D:resourcetype><D:collection/></D:resourcetype></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
  <D:response>
    <D:href>${path}</D:href>
    <D:propstat>
      <D:prop><D:displayname>op-1.json</D:displayname><D:getcontentlength>10</D:getcontentlength><D:resourcetype/></D:prop>
      <D:status>HTTP/1.1 200 OK</D:status>
    </D:propstat>
  </D:response>
</D:multistatus>`;

const validWebdavCfg: WebdavPrivateCfg = {
  baseUrl: 'https://dav.example.com/dav/',
  userName: 'alice',
  password: 'secret',
  syncFolderPath: 'sp',
};

describe('Webdav (provider)', () => {
  it('exposes id = PROVIDER_ID_WEBDAV', () => {
    const provider = new Webdav({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: false,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp: nativeNoop,
      credentialStore: fakeStore<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>(
        validWebdavCfg,
      ),
    });
    expect(provider.id).toBe(PROVIDER_ID_WEBDAV);
  });

  it('isReady returns true with complete cfg, false on missing pieces', async () => {
    const ready = new Webdav({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: false,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp: nativeNoop,
      credentialStore: fakeStore<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>(
        validWebdavCfg,
      ),
    });
    expect(await ready.isReady()).toBe(true);

    const incomplete = new Webdav({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: false,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp: nativeNoop,
      credentialStore: fakeStore<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>({
        ...validWebdavCfg,
        password: '',
      }),
    });
    expect(await incomplete.isReady()).toBe(false);
  });

  it('translates RemoteFileChangedUnexpectedly → UploadRevToMatchMismatchAPIError', async () => {
    // Conditional check fires, remote hash differs from localRev, base
    // provider should rewrap the error so the upper sync layer can
    // recognize it as a conflict.
    const nativeHttp = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: 'remote-changed',
    });
    const provider = new Webdav({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: true,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp,
      credentialStore: fakeStore<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>(
        validWebdavCfg,
      ),
    });
    await expect(
      provider.uploadFile('op-1.json', 'mine', 'stale-rev'),
    ).rejects.toBeInstanceOf(UploadRevToMatchMismatchAPIError);
  });

  it('downloadFile returns the md5 hash as rev', async () => {
    const body = 'real-payload';
    const nativeHttp = vi.fn().mockResolvedValue({
      status: 200,
      headers: {},
      data: body,
    });
    const provider = new Webdav({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: true,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp,
      credentialStore: fakeStore<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>(
        validWebdavCfg,
      ),
    });
    const r = await provider.downloadFile('op-1.json');
    expect(r.dataStr).toBe(body);
    expect(r.rev).toBe(await md5HashWasm(body));
  });

  it('listFiles parses PROPFIND multistatus body', async () => {
    const nativeHttp = vi.fn().mockResolvedValue({
      status: 207,
      headers: {},
      data: propfindXml('/dav/sp/op-1.json'),
    });
    const provider = new Webdav({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: true,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp,
      credentialStore: fakeStore<typeof PROVIDER_ID_WEBDAV, WebdavPrivateCfg>(
        validWebdavCfg,
      ),
    });
    const r = await provider.listFiles('');
    expect(r).toEqual(['/dav/sp/op-1.json']);
  });
});

describe('NextcloudProvider', () => {
  const validNextcloudCfg: NextcloudPrivateCfg = {
    serverUrl: 'https://cloud.example.com',
    userName: 'alice',
    password: 'secret',
    syncFolderPath: 'sp',
  };

  it('exposes id = PROVIDER_ID_NEXTCLOUD', () => {
    const provider = new NextcloudProvider({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: false,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp: nativeNoop,
      credentialStore: fakeStore<typeof PROVIDER_ID_NEXTCLOUD, NextcloudPrivateCfg>(
        validNextcloudCfg,
      ),
    });
    expect(provider.id).toBe(PROVIDER_ID_NEXTCLOUD);
  });

  it('buildBaseUrl encodes username and appends DAV path', () => {
    const url = NextcloudProvider.buildBaseUrl({
      serverUrl: 'https://cloud.example.com/',
      userName: 'a b/c',
    });
    expect(url).toBe('https://cloud.example.com/remote.php/dav/files/a%20b%2Fc/');
  });

  it('_cfgOrError rejects missing serverUrl', async () => {
    const provider = new NextcloudProvider({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: false,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp: nativeNoop,
      credentialStore: fakeStore<typeof PROVIDER_ID_NEXTCLOUD, NextcloudPrivateCfg>({
        ...validNextcloudCfg,
        serverUrl: '',
      }),
    });
    await expect(provider.downloadFile('op-1.json')).rejects.toBeInstanceOf(
      MissingCredentialsSPError,
    );
  });

  it('_cfgOrError rejects serverUrl without scheme', async () => {
    const provider = new NextcloudProvider({
      logger: NOOP_SYNC_LOGGER,
      platformInfo: {
        isNativePlatform: false,
        isAndroidWebView: false,
        isIosNative: false,
      },
      webFetch: () => globalThis.fetch as typeof fetch,
      nativeHttp: nativeNoop,
      credentialStore: fakeStore<typeof PROVIDER_ID_NEXTCLOUD, NextcloudPrivateCfg>({
        ...validNextcloudCfg,
        serverUrl: 'cloud.example.com',
      }),
    });
    await expect(provider.downloadFile('op-1.json')).rejects.toBeInstanceOf(
      MissingCredentialsSPError,
    );
  });
});
