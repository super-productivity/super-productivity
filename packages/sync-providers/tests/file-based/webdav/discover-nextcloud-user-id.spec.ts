import { describe, expect, it, vi } from 'vitest';
import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import { discoverNextcloudUserId } from '../../../src/webdav';
import type { NativeHttpExecutor } from '../../../src/http';
import type { ProviderPlatformInfo, WebFetchFactory } from '../../../src/platform';

const ocsBody = (id: unknown): string =>
  JSON.stringify({ ocs: { meta: { status: 'ok', statuscode: 200 }, data: { id } } });

interface RecordedReq {
  url: string;
  init?: RequestInit;
}

const makeDeps = (
  fetchImpl: typeof fetch,
): {
  logger: SyncLogger;
  platformInfo: ProviderPlatformInfo;
  webFetch: WebFetchFactory;
  nativeHttp: NativeHttpExecutor;
} => ({
  logger: NOOP_SYNC_LOGGER,
  platformInfo: {
    isNativePlatform: false,
    isAndroidWebView: false,
    isIosNative: false,
  },
  webFetch: () => fetchImpl,
  nativeHttp: vi.fn(),
});

const recordingFetch = (calls: RecordedReq[], response: () => Response): typeof fetch =>
  vi.fn(async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    return response();
  }) as unknown as typeof fetch;

const decodeBasic = (headers: Record<string, string> | undefined): string =>
  atob((headers?.['Authorization'] ?? '').replace('Basic ', ''));

const CFG = {
  serverUrl: 'https://cloud.example.com',
  userName: '',
  loginName: 'jane@example.com',
  password: 'app-pw',
};

describe('discoverNextcloudUserId', () => {
  it('returns the OCS user id and queries the OCS endpoint with the OCS header + login auth', async () => {
    const calls: RecordedReq[] = [];
    const res = await discoverNextcloudUserId(
      CFG,
      makeDeps(
        recordingFetch(calls, () => new Response(ocsBody('janedoe'), { status: 200 })),
      ),
    );

    expect(res).toEqual({ success: true, userId: 'janedoe' });
    expect(calls[0]?.url).toBe(
      'https://cloud.example.com/ocs/v2.php/cloud/user?format=json',
    );
    const headers = calls[0]?.init?.headers as Record<string, string>;
    expect(headers['OCS-APIRequest']).toBe('true');
    expect(decodeBasic(headers)).toBe('jane@example.com:app-pw');
  });

  it('trims a trailing slash from the server URL', async () => {
    const calls: RecordedReq[] = [];
    await discoverNextcloudUserId(
      { ...CFG, serverUrl: 'https://cloud.example.com/' },
      makeDeps(recordingFetch(calls, () => new Response(ocsBody('x'), { status: 200 }))),
    );
    expect(calls[0]?.url).toBe(
      'https://cloud.example.com/ocs/v2.php/cloud/user?format=json',
    );
  });

  it('falls back to userName for auth when loginName is empty', async () => {
    const calls: RecordedReq[] = [];
    await discoverNextcloudUserId(
      { ...CFG, loginName: '', userName: 'plainuser' },
      makeDeps(
        recordingFetch(calls, () => new Response(ocsBody('uid'), { status: 200 })),
      ),
    );
    expect(decodeBasic(calls[0]?.init?.headers as Record<string, string>)).toBe(
      'plainuser:app-pw',
    );
  });

  it('reports a 401 as wrong credentials (distinct from the 404 wrong-user-id path)', async () => {
    const res = await discoverNextcloudUserId(
      CFG,
      makeDeps(recordingFetch([], () => new Response('', { status: 401 }))),
    );
    expect(res.success).toBe(false);
    expect(res.errorCode).toBe(401);
    expect(res.error).toContain('Authentication failed');
  });

  it('reports a non-OCS 200 response without throwing (server is not Nextcloud / OCS disabled)', async () => {
    const res = await discoverNextcloudUserId(
      CFG,
      makeDeps(
        recordingFetch(
          [],
          () => new Response('<!DOCTYPE html><html>login</html>', { status: 200 }),
        ),
      ),
    );
    expect(res.success).toBe(false);
    expect(res.userId).toBeUndefined();
    expect(res.error).toContain('did not return a user ID');
  });

  it('rejects a server URL without an http(s) scheme without sending credentials', async () => {
    const calls: RecordedReq[] = [];
    const res = await discoverNextcloudUserId(
      { ...CFG, serverUrl: 'cloud.example.com' },
      makeDeps(recordingFetch(calls, () => new Response(ocsBody('x'), { status: 200 }))),
    );
    expect(res.success).toBe(false);
    expect(res.error).toContain('https://');
    expect(calls.length).toBe(0);
  });

  it('treats a missing/non-string id in the OCS payload as a failure', async () => {
    const res = await discoverNextcloudUserId(
      CFG,
      makeDeps(recordingFetch([], () => new Response(ocsBody(12345), { status: 200 }))),
    );
    expect(res.success).toBe(false);
  });
});
