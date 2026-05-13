import { NOOP_SYNC_LOGGER, type SyncLogger } from '@sp/sync-core';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockInstance,
} from 'vitest';
import {
  AuthFailSPError,
  MissingCredentialsSPError,
  NetworkUnavailableSPError,
} from '../../src/errors';
import type {
  NativeHttpExecutor,
  NativeHttpRequestConfig,
  NativeHttpResponse,
} from '../../src/http/native-http-retry';
import { isRetryableUploadError } from '../../src/http/retryable-upload-error';
import type { ProviderPlatformInfo } from '../../src/platform/provider-platform-info';
import type {
  OpUploadResponse,
  RestorePointsResponse,
  RestoreSnapshotResponse,
  SnapshotUploadResponse,
  SuperSyncOpDownloadResponse,
  SyncOperation,
} from '../../src/provider-types';
import type { SuperSyncResponseValidators } from '../../src/super-sync/response-validators';
import type { SuperSyncStorage } from '../../src/super-sync/storage';
import {
  PROVIDER_ID_SUPER_SYNC,
  SUPER_SYNC_DEFAULT_BASE_URL,
  type SuperSyncPrivateCfg,
} from '../../src/super-sync/super-sync.model';
import { SuperSyncProvider, type SuperSyncDeps } from '../../src/super-sync/super-sync';
import type { SyncCredentialStorePort } from '../../src/credential-store-port';

// Helpers reused across native-platform decompression assertions.
const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};

const decompressGzip = async (compressed: Uint8Array | Blob): Promise<string> => {
  const bytes =
    compressed instanceof Blob ? await blobToUint8Array(compressed) : compressed;
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes as BufferSource);
  writer.close();
  const decompressed = await new Response(stream.readable).arrayBuffer();
  return new TextDecoder().decode(decompressed);
};

const decompressBase64Gzip = async (base64: string): Promise<string> => {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return decompressGzip(bytes);
};

type CredentialStoreMock = {
  [K in keyof SyncCredentialStorePort<
    typeof PROVIDER_ID_SUPER_SYNC,
    SuperSyncPrivateCfg
  >]: ReturnType<typeof vi.fn>;
};

const createCredentialStoreMock = (): CredentialStoreMock & {
  __asPort: () => SyncCredentialStorePort<
    typeof PROVIDER_ID_SUPER_SYNC,
    SuperSyncPrivateCfg
  >;
} => {
  const mock = {
    load: vi.fn(),
    setComplete: vi.fn(),
    updatePartial: vi.fn(),
    upsertPartial: vi.fn(),
    clear: vi.fn(),
    onConfigChange: vi.fn(),
  };
  return {
    ...mock,
    __asPort: () =>
      mock as unknown as SyncCredentialStorePort<
        typeof PROVIDER_ID_SUPER_SYNC,
        SuperSyncPrivateCfg
      >,
  };
};

const createStorageMock = (): {
  port: SuperSyncStorage;
  getLastServerSeq: ReturnType<typeof vi.fn>;
  setLastServerSeq: ReturnType<typeof vi.fn>;
  removeLastServerSeq: ReturnType<typeof vi.fn>;
} => {
  const getLastServerSeq = vi.fn().mockReturnValue(null);
  const setLastServerSeq = vi.fn();
  const removeLastServerSeq = vi.fn();
  return {
    port: {
      getLastServerSeq: (key: string) => getLastServerSeq(key) as number | null,
      setLastServerSeq: (key: string, value: number) =>
        setLastServerSeq(key, value) as void,
      removeLastServerSeq: (key: string) => removeLastServerSeq(key) as void,
    },
    getLastServerSeq,
    setLastServerSeq,
    removeLastServerSeq,
  };
};

const createValidatorsPassthrough = (): SuperSyncResponseValidators => ({
  validateOpUpload: (data) => data as OpUploadResponse,
  validateOpDownload: (data) => data as SuperSyncOpDownloadResponse,
  validateSnapshotUpload: (data) => data as SnapshotUploadResponse,
  validateRestorePoints: (data) => data as RestorePointsResponse,
  validateRestoreSnapshot: (data) => data as RestoreSnapshotResponse,
  validateDeleteAllData: (data) => data as { success: boolean },
});

const createLoggerSpy = (): {
  logger: SyncLogger;
  spy: { [K in keyof SyncLogger]: MockInstance };
} => {
  const spy = {
    log: vi.spyOn(NOOP_SYNC_LOGGER, 'log'),
    error: vi.spyOn(NOOP_SYNC_LOGGER, 'error'),
    err: vi.spyOn(NOOP_SYNC_LOGGER, 'err'),
    normal: vi.spyOn(NOOP_SYNC_LOGGER, 'normal'),
    verbose: vi.spyOn(NOOP_SYNC_LOGGER, 'verbose'),
    info: vi.spyOn(NOOP_SYNC_LOGGER, 'info'),
    warn: vi.spyOn(NOOP_SYNC_LOGGER, 'warn'),
    critical: vi.spyOn(NOOP_SYNC_LOGGER, 'critical'),
    debug: vi.spyOn(NOOP_SYNC_LOGGER, 'debug'),
  };
  return { logger: NOOP_SYNC_LOGGER, spy };
};

interface BuildProviderResult {
  provider: SuperSyncProvider;
  deps: SuperSyncDeps;
  cfgStore: CredentialStoreMock;
  fetchMock: ReturnType<typeof vi.fn>;
  storage: ReturnType<typeof createStorageMock>;
  validators: SuperSyncResponseValidators;
  platformInfo: { -readonly [K in keyof ProviderPlatformInfo]: ProviderPlatformInfo[K] };
  nativeHttpExecutor: ReturnType<typeof vi.fn>;
  webRequestRetryDelay: ReturnType<typeof vi.fn>;
}

const buildProvider = (
  overrides?: Partial<{
    isNativePlatform: boolean;
    isAndroidWebView: boolean;
    isIosNative: boolean;
    validators: SuperSyncResponseValidators;
  }>,
): BuildProviderResult => {
  const cfgStore = createCredentialStoreMock();
  const storage = createStorageMock();
  const validators = overrides?.validators ?? createValidatorsPassthrough();
  const fetchMock = vi.fn();
  const nativeHttpExecutor = vi.fn();
  const webRequestRetryDelay = vi.fn().mockResolvedValue(undefined);
  const platformInfo: BuildProviderResult['platformInfo'] = {
    isNativePlatform: overrides?.isNativePlatform ?? false,
    isAndroidWebView: overrides?.isAndroidWebView ?? false,
    isIosNative: overrides?.isIosNative ?? false,
  };
  const deps: SuperSyncDeps = {
    logger: NOOP_SYNC_LOGGER,
    platformInfo,
    webFetch: () => fetchMock as unknown as typeof fetch,
    nativeHttpExecutor: nativeHttpExecutor as unknown as NativeHttpExecutor,
    credentialStore: cfgStore.__asPort(),
    storage: storage.port,
    responseValidators: validators,
    webRequestRetryDelay: webRequestRetryDelay as (ms: number) => Promise<void>,
  };
  const provider = new SuperSyncProvider(deps);
  return {
    provider,
    deps,
    cfgStore,
    fetchMock,
    storage,
    validators,
    platformInfo,
    nativeHttpExecutor,
    webRequestRetryDelay,
  };
};

const testConfig: SuperSyncPrivateCfg = {
  baseUrl: 'https://sync.example.com',
  accessToken: 'test-access-token',
};

const createMockOperation = (overrides: Partial<SyncOperation> = {}): SyncOperation => ({
  id: 'op-123',
  clientId: 'client-1',
  actionType: 'ADD_TASK',
  opType: 'CRT',
  entityType: 'TASK',
  entityId: 'task-1',
  payload: { title: 'Test Task' },
  vectorClock: { client1: 1 },
  timestamp: Date.now(),
  schemaVersion: 1,
  ...overrides,
});

const okResponse = (body: unknown): Response =>
  ({
    ok: true,
    status: 200,
    statusText: 'OK',
    json: () => Promise.resolve(body),
  }) as unknown as Response;

const errorResponse = (
  status: number,
  statusText: string,
  bodyText: string | (() => Promise<string>),
): Response =>
  ({
    ok: false,
    status,
    statusText,
    text: typeof bodyText === 'function' ? bodyText : () => Promise.resolve(bodyText),
  }) as unknown as Response;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('SuperSyncProvider', () => {
  describe('properties', () => {
    it('has correct id', () => {
      const { provider } = buildProvider();
      expect(provider.id).toBe(PROVIDER_ID_SUPER_SYNC);
    });

    it('does not support force upload', () => {
      const { provider } = buildProvider();
      expect(provider.isUploadForcePossible).toBe(false);
    });

    it('supports operation sync', () => {
      const { provider } = buildProvider();
      expect(provider.supportsOperationSync).toBe(true);
    });

    it('has max concurrent requests set to 10', () => {
      const { provider } = buildProvider();
      expect(provider.maxConcurrentRequests).toBe(10);
    });
  });

  describe('isReady', () => {
    it('returns true when accessToken is configured', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      expect(await provider.isReady()).toBe(true);
    });

    it('returns false when config is null', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue(null);
      expect(await provider.isReady()).toBe(false);
    });

    it('returns true when baseUrl is missing but accessToken is set', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        accessToken: 'token',
      } as SuperSyncPrivateCfg);
      expect(await provider.isReady()).toBe(true);
    });

    it('returns false when accessToken is missing', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        baseUrl: 'https://sync.example.com',
      } as SuperSyncPrivateCfg);
      expect(await provider.isReady()).toBe(false);
    });
  });

  describe('setPrivateCfg', () => {
    it('forwards the config to credentialStore.setComplete', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.setComplete.mockResolvedValue(undefined);
      await provider.setPrivateCfg(testConfig);
      expect(cfgStore.setComplete).toHaveBeenCalledWith(testConfig);
    });

    it('invalidates cached server-seq key so subsequent calls load fresh config', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.setComplete.mockResolvedValue(undefined);
      fetchMock.mockResolvedValue(okResponse({ ops: [], hasMore: false, latestSeq: 0 }));

      cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://server1.com',
      });
      await provider.downloadOps(0);

      await provider.setPrivateCfg({
        ...testConfig,
        baseUrl: 'https://server2.com',
      });

      cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://server2.com',
      });
      await provider.downloadOps(0);

      const lastCallUrl = fetchMock.mock.calls.at(-1)?.[0];
      expect(String(lastCallUrl)).toContain('server2.com');
    });
  });

  describe('config loading', () => {
    it("calls credentialStore.load for each operation (caching is the store's responsibility)", async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ ops: [], hasMore: false, latestSeq: 0 }));

      await provider.downloadOps(0);
      await provider.downloadOps(1);
      await provider.downloadOps(2);

      expect(cfgStore.load).toHaveBeenCalledTimes(3);
    });

    it('caches the server-seq key (load called once across repeated getLastServerSeq)', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      storage.getLastServerSeq.mockReturnValue(10);

      await provider.getLastServerSeq();
      await provider.getLastServerSeq();
      await provider.getLastServerSeq();

      expect(cfgStore.load).toHaveBeenCalledTimes(1);
    });
  });

  describe('getWebSocketParams', () => {
    it('returns null when access token is missing', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        baseUrl: 'https://sync.example.com',
      } as SuperSyncPrivateCfg);
      expect(await provider.getWebSocketParams()).toBeNull();
    });

    it('returns sanitized params using the configured base URL', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        baseUrl: 'https://sync.example.com/',
        accessToken: 'token​123',
      } as SuperSyncPrivateCfg);

      expect(await provider.getWebSocketParams()).toEqual({
        baseUrl: 'https://sync.example.com',
        accessToken: 'token123',
      });
    });

    it('falls back to the default base URL when none is configured', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        accessToken: 'test-access-token',
      } as SuperSyncPrivateCfg);

      expect(await provider.getWebSocketParams()).toEqual({
        baseUrl: SUPER_SYNC_DEFAULT_BASE_URL,
        accessToken: 'test-access-token',
      });
    });
  });

  describe('uploadOps', () => {
    it('uploads operations successfully', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const mockResponse = {
        results: [{ opId: 'op-123', accepted: true, serverSeq: 1 }],
        latestSeq: 1,
      };
      fetchMock.mockResolvedValue(okResponse(mockResponse));

      const ops = [createMockOperation()];
      const result = await provider.uploadOps(ops, 'client-1');

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sync.example.com/api/sync/ops');
      expect(options.method).toBe('POST');
      const headers = options.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer test-access-token');
      expect(headers.get('Content-Type')).toBe('application/json');

      const bodyJson = await decompressGzip(options.body as Blob);
      const body = JSON.parse(bodyJson);
      expect(body.ops).toEqual(ops);
      expect(body.clientId).toBe('client-1');
      expect(body.requestId).toMatch(/^ops-v1-/);
      expect(body.requestId.length).toBeLessThanOrEqual(64);
    });

    it('uses a stable requestId across retries/key-reordering/encrypted IV changes', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ results: [], latestSeq: 5 }));

      const firstOp = createMockOperation({
        id: 'op-123',
        payload: { top: 'value', nested: { a: 1, b: 2 } },
        vectorClock: { client1: 1, client2: 2 },
      });
      const secondOp = createMockOperation({ id: 'op-456', entityId: 'task-2' });
      const ops = [firstOp, secondOp];

      // Call 0: original batch
      await provider.uploadOps(ops, 'client-1', 2);
      // Call 1: same batch, retried with different lastKnownServerSeq
      await provider.uploadOps(ops, 'client-1', 4);
      // Call 2: same batch with nested keys reordered (stable JSON)
      await provider.uploadOps(
        [
          {
            ...firstOp,
            payload: { nested: { b: 2, a: 1 }, top: 'value' },
            vectorClock: { client2: 2, client1: 1 },
          },
          secondOp,
        ],
        'client-1',
        4,
      );
      // Call 3: same batch but first op's payload content changed
      await provider.uploadOps(
        [{ ...firstOp, payload: { title: 'Changed Task' } }, secondOp],
        'client-1',
        4,
      );
      // Call 4: extended batch (extra op appended)
      await provider.uploadOps(
        [...ops, createMockOperation({ id: 'op-789', entityId: 'task-3' })],
        'client-1',
        4,
      );
      const encryptedOp = createMockOperation({
        id: 'op-encrypted',
        payload: 'ciphertext-with-random-iv-a',
        isPayloadEncrypted: true,
      });
      // Call 5: encrypted payload
      await provider.uploadOps([encryptedOp], 'client-1', 4);
      // Call 6: same logical encrypted op after re-encryption with a fresh IV
      await provider.uploadOps(
        [{ ...encryptedOp, payload: 'ciphertext-with-random-iv-b' }],
        'client-1',
        4,
      );

      const bodies = await Promise.all(
        [0, 1, 2, 3, 4, 5, 6].map(async (i) => {
          const [, options] = fetchMock.mock.calls[i] as [string, RequestInit];
          return JSON.parse(await decompressGzip(options.body as Blob));
        }),
      );

      expect(bodies[1].requestId).toBe(bodies[0].requestId);
      expect(bodies[2].requestId).toBe(bodies[0].requestId);
      expect(bodies[3].requestId).not.toBe(bodies[0].requestId);
      expect(bodies[4].requestId).not.toBe(bodies[0].requestId);
      expect(bodies[6].requestId).toBe(bodies[5].requestId);
      expect(bodies[0].requestId.length).toBeLessThanOrEqual(64);
    });

    it('includes lastKnownServerSeq when provided', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        okResponse({
          results: [],
          latestSeq: 5,
          newOps: [{ serverSeq: 3, op: createMockOperation(), receivedAt: Date.now() }],
        }),
      );

      await provider.uploadOps([createMockOperation()], 'client-1', 2);

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = JSON.parse(await decompressGzip(options.body as Blob));
      expect(body.lastKnownServerSeq).toBe(2);
    });

    it('throws MissingCredentialsSPError when config is missing', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue(null);
      await expect(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toBeInstanceOf(MissingCredentialsSPError);
    });

    it('throws on API failure (web path uses HTTP <status> <statusText> form)', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(500, 'Internal Server Error', 'Server error'),
      );

      await expect(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toThrow(/HTTP 500 Internal Server Error/);
    });

    it('strips trailing slash from baseUrl', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://sync.example.com/',
      });
      fetchMock.mockResolvedValue(okResponse({ results: [], latestSeq: 0 }));

      await provider.uploadOps([createMockOperation()], 'client-1');

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('https://sync.example.com/api/sync/ops');
    });
  });

  describe('downloadOps', () => {
    it('downloads operations successfully', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const mockResponse = {
        ops: [{ serverSeq: 1, op: createMockOperation(), receivedAt: Date.now() }],
        hasMore: false,
        latestSeq: 1,
      };
      fetchMock.mockResolvedValue(okResponse(mockResponse));

      const result = await provider.downloadOps(0);

      expect(result).toEqual(mockResponse);
      expect(fetchMock).toHaveBeenCalledTimes(1);

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toBe('https://sync.example.com/api/sync/ops?sinceSeq=0');
    });

    it('includes excludeClient parameter when provided', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ ops: [], hasMore: false, latestSeq: 0 }));

      await provider.downloadOps(0, 'client-1');

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('excludeClient=client-1');
    });

    it('includes limit parameter when provided', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ ops: [], hasMore: false, latestSeq: 0 }));

      await provider.downloadOps(0, undefined, 100);

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('limit=100');
    });

    it('includes all query parameters when provided', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ ops: [], hasMore: false, latestSeq: 0 }));

      await provider.downloadOps(5, 'client-1', 50);

      const [url] = fetchMock.mock.calls[0] as [string];
      expect(url).toContain('sinceSeq=5');
      expect(url).toContain('excludeClient=client-1');
      expect(url).toContain('limit=50');
    });

    it('throws MissingCredentialsSPError when config is missing', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue(null);
      await expect(provider.downloadOps(0)).rejects.toBeInstanceOf(
        MissingCredentialsSPError,
      );
    });
  });

  describe('getLastServerSeq', () => {
    it('returns 0 when no value is stored', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      storage.getLastServerSeq.mockReturnValue(null);

      expect(await provider.getLastServerSeq()).toBe(0);
    });

    it('returns stored value when present', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      storage.getLastServerSeq.mockReturnValue(42);

      expect(await provider.getLastServerSeq()).toBe(42);
    });

    it('uses unique key per server URL', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      storage.getLastServerSeq.mockReturnValue(10);

      await provider.getLastServerSeq();

      expect(storage.getLastServerSeq).toHaveBeenCalledWith(
        expect.stringMatching(/^super_sync_last_server_seq_/),
      );
    });
  });

  describe('setLastServerSeq', () => {
    it('stores the sequence value', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);

      await provider.setLastServerSeq(100);

      expect(storage.setLastServerSeq).toHaveBeenCalledWith(
        expect.stringMatching(/^super_sync_last_server_seq_/),
        100,
      );
    });
  });

  describe('error handling', () => {
    it('retries transient web fetch failures before succeeding', async () => {
      const { provider, cfgStore, fetchMock, webRequestRetryDelay } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(okResponse({ ops: [], hasMore: false, latestSeq: 7 }));

      const result = await provider.downloadOps(0, 'client-1');

      expect(result.latestSeq).toBe(7);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(webRequestRetryDelay).toHaveBeenCalledWith(1000);
    });

    it('uses linear 1s/2s backoff across two web retries', async () => {
      const { provider, cfgStore, fetchMock, webRequestRetryDelay } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce(okResponse({ ops: [], hasMore: false, latestSeq: 9 }));

      const result = await provider.downloadOps(0, 'client-1');

      expect(result.latestSeq).toBe(9);
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(webRequestRetryDelay.mock.calls).toEqual([[1000], [2000]]);
    });

    it('throws NetworkUnavailableSPError after web retries are exhausted', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));

      let caught: unknown;
      try {
        await provider.downloadOps(0, 'client-1');
      } catch (e) {
        caught = e;
      }

      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect(caught).toBeInstanceOf(NetworkUnavailableSPError);
      expect((caught as Error).message).toBe(
        'Unable to connect to SuperSync server. Check your internet connection.',
      );
      // Provider's existing retry contract (regex used by op-log uploader)
      // must keep matching this error string after the type refactor.
      expect(isRetryableUploadError(caught as Error)).toBe(true);
      // Privacy invariant: surface must not leak path/clientId.
      expect((caught as Error).message).not.toContain('/api/sync/ops');
      expect((caught as Error).message).not.toContain('client-1');
    });

    it('does NOT retry AbortError (fetch timeout) — surfaces timeout error', async () => {
      const { provider, cfgStore, fetchMock, webRequestRetryDelay } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const abortErr = new Error('aborted');
      abortErr.name = 'AbortError';
      fetchMock.mockRejectedValue(abortErr);

      let caught: Error | undefined;
      try {
        await provider.downloadOps(0, 'client-1');
      } catch (e) {
        caught = e as Error;
      }

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(webRequestRetryDelay).not.toHaveBeenCalled();
      expect(caught?.message).toMatch(/^SuperSync request timeout/);
    });

    it('does NOT retry HTTP-status responses (e.g. 5xx) at the web layer', async () => {
      const { provider, cfgStore, fetchMock, webRequestRetryDelay } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(errorResponse(500, 'Internal Server Error', ''));

      await expect(provider.downloadOps(0, 'client-1')).rejects.toThrow(/^HTTP 500/);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(webRequestRetryDelay).not.toHaveBeenCalled();
    });

    it('does NOT retry auth failures', async () => {
      const { provider, cfgStore, fetchMock, webRequestRetryDelay } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(errorResponse(401, 'Unauthorized', ''));

      await expect(provider.downloadOps(0, 'client-1')).rejects.toBeInstanceOf(
        AuthFailSPError,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(webRequestRetryDelay).not.toHaveBeenCalled();
    });

    it('threads extracted reason into thrown HTTP error for non-auth 5xx', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(
          500,
          'Internal Server Error',
          '{"error":"database connection failed"}',
        ),
      );

      await expect(provider.downloadOps(0)).rejects.toThrow(
        'HTTP 500 Internal Server Error — database connection failed',
      );
    });

    it('handles text() failure gracefully (no reason, status only)', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(500, 'Internal Server Error', () =>
          Promise.reject(new Error('Cannot read body')),
        ),
      );

      await expect(provider.downloadOps(0)).rejects.toThrow(
        'HTTP 500 Internal Server Error',
      );
    });

    it('throws on 429 Rate Limited', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(
          429,
          'Too Many Requests',
          JSON.stringify({
            statusCode: 429,
            code: 'FST_TOO_MANY_REQUESTS',
            error: 'Too Many Requests',
            message: 'Rate limit exceeded, retry in 5 minutes',
          }),
        ),
      );

      await expect(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toThrow(
        /HTTP 429 Too Many Requests — Too Many Requests — retry in 5 minutes/,
      );
    });

    it('throws on 413 Storage Quota Exceeded', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(
          413,
          'Payload Too Large',
          '{"error":"Storage quota exceeded","errorCode":"STORAGE_QUOTA_EXCEEDED"}',
        ),
      );

      await expect(
        provider.uploadSnapshot(
          {},
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id',
        ),
      ).rejects.toThrow(/HTTP 413.*Storage quota exceeded/);
    });

    it('truncates server reason to 80 chars', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const longReason = 'x'.repeat(200);
      fetchMock.mockResolvedValue(
        errorResponse(500, 'ISE', JSON.stringify({ error: longReason })),
      );

      let captured: Error | undefined;
      try {
        await provider.downloadOps(0);
      } catch (e) {
        captured = e as Error;
      }
      expect(captured?.message).toBeDefined();
      // 80-char cap of the reason
      expect(captured!.message).toContain('x'.repeat(80));
      expect(captured!.message).not.toContain('x'.repeat(81));
    });
  });

  describe('authentication error handling', () => {
    it('throws AuthFailSPError on 401', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(401, 'Unauthorized', 'Invalid or expired token'),
      );

      await expect(provider.downloadOps(0)).rejects.toBeInstanceOf(AuthFailSPError);
    });

    it('throws AuthFailSPError on 403', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(errorResponse(403, 'Forbidden', 'Account deleted'));

      await expect(provider.downloadOps(0)).rejects.toBeInstanceOf(AuthFailSPError);
    });

    it('AuthFailSPError does NOT retain response body on `additionalLog` (privacy invariant)', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const sensitiveBody =
        '{"taskId":"abc","title":"secret task title","accessToken":"leak"}';
      fetchMock.mockResolvedValue(errorResponse(401, 'Unauthorized', sensitiveBody));

      let caught: AuthFailSPError | undefined;
      try {
        await provider.downloadOps(0);
      } catch (e) {
        caught = e as AuthFailSPError;
      }
      expect(caught).toBeInstanceOf(AuthFailSPError);
      // `additionalLog` carries the constructor args. SuperSync constructs
      // the error with ONE arg (a fixed status-form message) — the response
      // body is never passed. So no user content can land in `additionalLog`.
      const additionalLog = (caught as unknown as { additionalLog?: unknown[] })
        .additionalLog;
      const serializedAdditional = JSON.stringify(additionalLog);
      expect(serializedAdditional).not.toContain('secret task title');
      expect(serializedAdditional).not.toContain('"taskId"');
      expect(serializedAdditional).not.toContain('"accessToken"');
      expect(serializedAdditional).not.toContain('leak');
      // Same invariant on `.message`.
      expect(caught!.message).not.toContain('secret task title');
      expect(caught!.message).not.toContain('leak');
    });

    it('throws AuthFailSPError for uploadOps on 401', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(401, 'Unauthorized', 'Account not found'),
      );

      await expect(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toBeInstanceOf(AuthFailSPError);
    });

    it('throws AuthFailSPError for uploadSnapshot on 401', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(errorResponse(401, 'Unauthorized', 'Invalid token'));

      await expect(
        provider.uploadSnapshot(
          {},
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id',
        ),
      ).rejects.toBeInstanceOf(AuthFailSPError);
    });

    it('includes HTTP status code in AuthFailSPError message', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(errorResponse(403, 'Forbidden', 'Access denied'));

      try {
        await provider.downloadOps(0);
        expect.fail('Expected AuthFailSPError to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AuthFailSPError);
        expect((e as AuthFailSPError).message).toContain('403');
      }
    });
  });

  describe('upload response with rejected ops', () => {
    it('returns response with CONFLICT_CONCURRENT rejection', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const mockResponse = {
        results: [
          {
            opId: 'op-123',
            accepted: false,
            error: 'Concurrent modification detected for TASK:task-1',
            errorCode: 'CONFLICT_CONCURRENT',
          },
        ],
        latestSeq: 5,
        newOps: [{ serverSeq: 3, op: createMockOperation(), receivedAt: Date.now() }],
      };
      fetchMock.mockResolvedValue(okResponse(mockResponse));

      const result = await provider.uploadOps([createMockOperation()], 'client-1', 2);

      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(false);
      expect(result.results[0].errorCode).toBe('CONFLICT_CONCURRENT');
      expect(result.results[0].error).toContain('Concurrent modification');
      expect(result.newOps).toBeDefined();
      expect(result.newOps!.length).toBe(1);
    });

    it('returns response with CONFLICT_SUPERSEDED rejection', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            {
              opId: 'op-123',
              accepted: false,
              error: 'Superseded',
              errorCode: 'CONFLICT_SUPERSEDED',
            },
          ],
          latestSeq: 5,
        }),
      );

      const result = await provider.uploadOps([createMockOperation()], 'client-1');
      expect(result.results[0].accepted).toBe(false);
      expect(result.results[0].errorCode).toBe('CONFLICT_SUPERSEDED');
    });

    it('returns response with DUPLICATE_OPERATION rejection', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            {
              opId: 'op-123',
              accepted: false,
              error: 'Duplicate operation ID',
              errorCode: 'DUPLICATE_OPERATION',
            },
          ],
          latestSeq: 5,
        }),
      );

      const result = await provider.uploadOps([createMockOperation()], 'client-1');
      expect(result.results[0].accepted).toBe(false);
      expect(result.results[0].errorCode).toBe('DUPLICATE_OPERATION');
    });

    it('returns mixed accept/reject results correctly', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            { opId: 'op-1', accepted: true, serverSeq: 10 },
            {
              opId: 'op-2',
              accepted: false,
              error: 'Concurrent modification',
              errorCode: 'CONFLICT_CONCURRENT',
            },
            { opId: 'op-3', accepted: true, serverSeq: 11 },
          ],
          latestSeq: 11,
        }),
      );

      const ops = [
        createMockOperation({ id: 'op-1' }),
        createMockOperation({ id: 'op-2' }),
        createMockOperation({ id: 'op-3' }),
      ];
      const result = await provider.uploadOps(ops, 'client-1');

      expect(result.results.length).toBe(3);
      expect(result.results[0].accepted).toBe(true);
      expect(result.results[1].accepted).toBe(false);
      expect(result.results[1].errorCode).toBe('CONFLICT_CONCURRENT');
      expect(result.results[2].accepted).toBe(true);
    });

    it('includes piggybacked ops even when upload has rejections', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const piggybackedOp = {
        serverSeq: 5,
        op: createMockOperation({ id: 'remote-op', entityId: 'task-2' }),
        receivedAt: Date.now(),
      };
      fetchMock.mockResolvedValue(
        okResponse({
          results: [
            {
              opId: 'op-123',
              accepted: false,
              error: 'Concurrent modification',
              errorCode: 'CONFLICT_CONCURRENT',
            },
          ],
          latestSeq: 10,
          newOps: [piggybackedOp],
          hasMorePiggyback: true,
        }),
      );

      const result = await provider.uploadOps([createMockOperation()], 'client-1', 4);

      expect(result.results[0].accepted).toBe(false);
      expect(result.newOps).toBeDefined();
      expect(result.newOps!.length).toBe(1);
      expect(result.newOps![0].op.id).toBe('remote-op');
      expect(result.hasMorePiggyback).toBe(true);
    });
  });

  describe('server URL key generation', () => {
    it('generates different keys for different URLs', async () => {
      const capturedKeys: string[] = [];

      const a = buildProvider();
      a.storage.getLastServerSeq.mockImplementation((key: string) => {
        capturedKeys.push(key);
        return null;
      });
      a.cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://server1.com',
      });
      await a.provider.getLastServerSeq();

      const b = buildProvider();
      b.storage.getLastServerSeq.mockImplementation((key: string) => {
        capturedKeys.push(key);
        return null;
      });
      b.cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://server2.com',
      });
      await b.provider.getLastServerSeq();

      expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
    });

    it('generates different keys for different access tokens on same server', async () => {
      const capturedKeys: string[] = [];

      const a = buildProvider();
      a.storage.getLastServerSeq.mockImplementation((key: string) => {
        capturedKeys.push(key);
        return null;
      });
      a.cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://server.com',
        accessToken: 'token-user-1',
      });
      await a.provider.getLastServerSeq();

      const b = buildProvider();
      b.storage.getLastServerSeq.mockImplementation((key: string) => {
        capturedKeys.push(key);
        return null;
      });
      b.cfgStore.load.mockResolvedValue({
        ...testConfig,
        baseUrl: 'https://server.com',
        accessToken: 'token-user-2',
      });
      await b.provider.getLastServerSeq();

      expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
    });

    it('falls back to default key when config is missing', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(null);
      storage.getLastServerSeq.mockReturnValue(null);

      await provider.getLastServerSeq();

      expect(storage.getLastServerSeq).toHaveBeenCalledWith(
        expect.stringMatching(/^super_sync_last_server_seq_/),
      );
    });

    it('resets the cached key whenever setPrivateCfg fires (load called twice)', async () => {
      const { provider, cfgStore, storage } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      cfgStore.setComplete.mockResolvedValue(undefined);
      storage.getLastServerSeq.mockReturnValue(null);

      await provider.getLastServerSeq();
      const loadCallsBefore = cfgStore.load.mock.calls.length;

      await provider.setPrivateCfg(testConfig);
      await provider.getLastServerSeq();

      expect(cfgStore.load.mock.calls.length).toBeGreaterThan(loadCallsBefore);
    });
  });

  describe('uploadSnapshot', () => {
    it('uploads snapshot with gzip compression', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ accepted: true, serverSeq: 5 }));

      const state = { tasks: [{ id: 'task-1', title: 'Test' }] };
      const result = await provider.uploadSnapshot(
        state,
        'client-1',
        'recovery',
        { clientA: 3 },
        1,
        undefined,
        'test-op-id-snapshot',
      );

      expect(result).toEqual({ accepted: true, serverSeq: 5 });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('https://sync.example.com/api/sync/snapshot');
      expect(options.method).toBe('POST');
      const headers = options.headers as Headers;
      expect(headers.get('Authorization')).toBe('Bearer test-access-token');
      expect(headers.get('Content-Type')).toBe('application/json');
      expect(headers.get('Content-Encoding')).toBe('gzip');
    });

    it('sends gzip-compressed body', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ accepted: true }));

      await provider.uploadSnapshot(
        { data: 'test' },
        'client-1',
        'initial',
        {},
        1,
        undefined,
        'test-op-id-gzip',
      );

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const body = options.body as Blob;
      expect(body).toBeInstanceOf(Blob);
      const bytes = await blobToUint8Array(body);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
    });

    it('includes all required fields in payload', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      let capturedBody: Blob | null = null;
      fetchMock.mockImplementation(async (_url: unknown, options: unknown) => {
        capturedBody = (options as RequestInit).body as Blob;
        return okResponse({ accepted: true });
      });

      const state = { tasks: [] };
      await provider.uploadSnapshot(
        state,
        'client-1',
        'migration',
        { clientA: 5 },
        2,
        undefined,
        'test-op-id-fields',
      );

      expect(capturedBody).not.toBeNull();
      const payload = JSON.parse(await decompressGzip(capturedBody!));
      expect(payload.state).toEqual(state);
      expect(payload.clientId).toBe('client-1');
      expect(payload.reason).toBe('migration');
      expect(payload.requestId).toMatch(/^snapshot-v1-/);
      expect(payload.requestId).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
      expect(payload.vectorClock).toEqual({ clientA: 5 });
      expect(payload.schemaVersion).toBe(2);
    });

    it('produces a stable snapshot requestId for the same clientId+opId, regardless of state', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const bodies: Array<{ requestId: string }> = [];
      fetchMock.mockImplementation(async (_url: unknown, options: unknown) => {
        const decoded = JSON.parse(
          await decompressGzip((options as RequestInit).body as Blob),
        );
        bodies.push(decoded);
        return okResponse({ accepted: true });
      });

      await provider.uploadSnapshot(
        { tasks: [{ id: 'a' }] },
        'client-stable',
        'recovery',
        { c: 1 },
        2,
        undefined,
        'op-stable-1',
      );
      await provider.uploadSnapshot(
        { tasks: [{ id: 'a' }, { id: 'b' }] }, // different state
        'client-stable',
        'recovery',
        { c: 1 },
        2,
        undefined,
        'op-stable-1', // same opId
      );
      await provider.uploadSnapshot(
        { tasks: [{ id: 'a' }] },
        'client-stable',
        'recovery',
        { c: 1 },
        2,
        undefined,
        'op-stable-2', // different opId
      );

      expect(bodies[1].requestId).toBe(bodies[0].requestId);
      expect(bodies[2].requestId).not.toBe(bodies[0].requestId);
    });

    it('throws MissingCredentialsSPError when config is missing', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue(null);
      await expect(
        provider.uploadSnapshot(
          {},
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id',
        ),
      ).rejects.toBeInstanceOf(MissingCredentialsSPError);
    });

    it('throws on API failure', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(
        errorResponse(413, 'Payload Too Large', 'Body too large'),
      );

      await expect(
        provider.uploadSnapshot(
          { largeData: 'x'.repeat(1000) },
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id-error',
        ),
      ).rejects.toThrow(/HTTP 413/);
    });

    it('handles different snapshot reasons', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);

      for (const reason of ['initial', 'recovery', 'migration'] as const) {
        fetchMock.mockResolvedValueOnce(okResponse({ accepted: true }));

        await provider.uploadSnapshot(
          {},
          'client-1',
          reason,
          {},
          1,
          undefined,
          `test-op-id-${reason}`,
        );

        const [, options] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
        const payload = JSON.parse(await decompressGzip(options.body as Blob));
        expect(payload.reason).toBe(reason);
      }
    });

    it('compresses large payloads effectively', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      let capturedBody: Blob | null = null;
      fetchMock.mockImplementation(async (_url: unknown, options: unknown) => {
        capturedBody = (options as RequestInit).body as Blob;
        return okResponse({ accepted: true });
      });

      const largeState = {
        tasks: Array.from({ length: 100 }, (_, i) => ({
          id: `task-${i}`,
          title: `Task number ${i} with description`,
          done: false,
        })),
      };

      await provider.uploadSnapshot(
        largeState,
        'client-1',
        'recovery',
        {},
        1,
        undefined,
        'test-op-id-compress',
      );

      const originalSize = JSON.stringify({
        state: largeState,
        clientId: 'client-1',
        reason: 'recovery',
        vectorClock: {},
        schemaVersion: 1,
      }).length;

      expect(capturedBody).not.toBeNull();
      expect(capturedBody!.size).toBeLessThan(originalSize * 0.5);
    });
  });

  describe('native platform routing', () => {
    /**
     * The previous Jasmine spec used a `TestableSuperSyncProvider` subclass
     * to swap the `isNativePlatform` getter. Under the package's injected
     * `platformInfo` port that subclass is gone — we set the platform flag
     * at construction time and assert on the captured native HTTP executor
     * call.
     */
    const captureNativeRequest = (): {
      ctx: BuildProviderResult;
      requests: NativeHttpRequestConfig[];
    } => {
      const ctx = buildProvider({ isNativePlatform: true });
      const requests: NativeHttpRequestConfig[] = [];
      ctx.nativeHttpExecutor.mockImplementation(async (cfg: NativeHttpRequestConfig) => {
        requests.push(cfg);
        return {
          status: 200,
          headers: {},
          data: { results: [], latestSeq: 0 },
        } as NativeHttpResponse;
      });
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      return { ctx, requests };
    };

    it('routes uploadOps through nativeHttpExecutor when isNativePlatform=true', async () => {
      const { ctx, requests } = captureNativeRequest();
      await ctx.provider.uploadOps([createMockOperation()], 'client-1');
      expect(requests).toHaveLength(1);
      expect(requests[0].url).toBe('https://sync.example.com/api/sync/ops');
      expect(requests[0].method).toBe('POST');
      expect(requests[0].headers?.Authorization).toBe('Bearer test-access-token');
      expect(requests[0].headers?.['Content-Encoding']).toBe('gzip');
      expect(requests[0].headers?.['Content-Transfer-Encoding']).toBe('base64');
    });

    it('sends valid base64-encoded gzip data on native path', async () => {
      const { ctx, requests } = captureNativeRequest();
      const ops = [createMockOperation()];
      await ctx.provider.uploadOps(ops, 'client-1', 5);

      const base64 = requests[0].data as string;
      expect(typeof base64).toBe('string');
      expect(() => atob(base64)).not.toThrow();

      const decompressed = await decompressBase64Gzip(base64);
      const payload = JSON.parse(decompressed);
      expect(payload.ops).toEqual(ops);
      expect(payload.clientId).toBe('client-1');
      expect(payload.lastKnownServerSeq).toBe(5);
    });

    it('routes via fetch (not native) when isNativePlatform=false', async () => {
      const { provider, cfgStore, fetchMock, nativeHttpExecutor } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ results: [], latestSeq: 0 }));

      await provider.uploadOps([createMockOperation()], 'client-1');

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(nativeHttpExecutor).not.toHaveBeenCalled();
      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      const headers = options.headers as Headers;
      expect(headers.get('Content-Encoding')).toBe('gzip');
      expect(headers.get('Content-Transfer-Encoding')).toBeNull();
    });

    it('routes via native when only isAndroidWebView=true (legacy WebView shim)', async () => {
      const { provider, cfgStore, nativeHttpExecutor } = buildProvider({
        isNativePlatform: false,
        isAndroidWebView: true,
      });
      cfgStore.load.mockResolvedValue(testConfig);
      nativeHttpExecutor.mockResolvedValue({
        status: 200,
        headers: {},
        data: { results: [], latestSeq: 0 },
      });

      await provider.uploadOps([createMockOperation()], 'client-1');
      expect(nativeHttpExecutor).toHaveBeenCalledTimes(1);
    });

    it('native snapshot payload contains state, vectorClock, reason after decompression', async () => {
      const ctx = buildProvider({ isNativePlatform: true });
      const requests: NativeHttpRequestConfig[] = [];
      ctx.nativeHttpExecutor.mockImplementation(async (cfg: NativeHttpRequestConfig) => {
        requests.push(cfg);
        return {
          status: 200,
          headers: {},
          data: { accepted: true },
        } as NativeHttpResponse;
      });
      ctx.cfgStore.load.mockResolvedValue(testConfig);

      const state = { tasks: [{ id: 'task-1' }] };
      await ctx.provider.uploadSnapshot(
        state,
        'client-1',
        'migration',
        { clientA: 10 },
        2,
        true,
        'test-op-id-native',
      );

      const base64 = requests[0].data as string;
      const decompressed = await decompressBase64Gzip(base64);
      const payload = JSON.parse(decompressed);
      expect(payload.state).toEqual(state);
      expect(payload.clientId).toBe('client-1');
      expect(payload.reason).toBe('migration');
      expect(payload.vectorClock).toEqual({ clientA: 10 });
      expect(payload.schemaVersion).toBe(2);
      expect(payload.isPayloadEncrypted).toBe(true);
    });

    /**
     * Pre-existing quirk preserved by the move: a non-2xx native response
     * gets thrown as `Error("HTTP <status> — <reason>")` from the inner
     * `try`, which the outer `catch` hands to `_handleNativeRequestError`.
     * Because the broad-pattern `isRetryableUploadError` matches "500"
     * (and other 5xx codes), the user-facing message is rewritten to the
     * generic "Unable to connect" form. Web path does NOT have this
     * conversion — it surfaces the `HTTP <status> <statusText> — <reason>`
     * directly. Test asserts the preserved behavior.
     */
    it('native 5xx response surfaces as "Unable to connect" (preserved native quirk)', async () => {
      const ctx = buildProvider({ isNativePlatform: true });
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.nativeHttpExecutor.mockResolvedValue({
        status: 500,
        headers: {},
        data: { error: 'server overloaded' },
      });

      await expect(
        ctx.provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toThrow(
        'Unable to connect to SuperSync server. Check your internet connection.',
      );
    });

    it('native 4xx (non-auth) response is NOT rewritten — surfaces HTTP error', async () => {
      const ctx = buildProvider({ isNativePlatform: true });
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.nativeHttpExecutor.mockResolvedValue({
        status: 422,
        headers: {},
        data: { error: 'invalid op' },
      });

      await expect(
        ctx.provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toThrow(/^HTTP 422 — invalid op$/);
    });

    it('throws fixed user-facing message (no native error interpolation) on transient native error', async () => {
      const { ctx } = captureNativeRequest();
      ctx.nativeHttpExecutor.mockRejectedValue(
        new Error('failed to fetch https://internal-host.invalid/api/sync/ops'),
      );

      let caught: Error | undefined;
      try {
        await ctx.provider.uploadOps([createMockOperation()], 'client-1');
      } catch (e) {
        caught = e as Error;
      }
      expect(caught?.message).toBe(
        'Unable to connect to SuperSync server. Check your internet connection.',
      );
      expect(isRetryableUploadError(caught)).toBe(true);
      // Privacy: the URL/hostname must NOT be in the user-facing message.
      expect(caught!.message).not.toContain('internal-host.invalid');
    });

    /**
     * Non-retryable foreign native errors (e.g. iOS TLS-cert errors) can
     * embed the resolved hostname in `.message`. Verify the user-facing
     * surface scrubs to a name-only form so dialogs / snacks don't leak.
     */
    it('scrubs non-retryable foreign native errors (e.g. TLS cert) to name-only surface', async () => {
      const ctx = buildProvider({ isNativePlatform: true });
      const { logger, spy } = createLoggerSpy();
      ctx.deps.logger = logger;
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      const tlsError = new Error(
        'SSL certificate problem: hostname mismatch for sync.example.com',
      );
      tlsError.name = 'TlsError';
      ctx.nativeHttpExecutor.mockRejectedValue(tlsError);

      let caught: Error | undefined;
      try {
        await ctx.provider.uploadOps([createMockOperation()], 'client-1');
      } catch (e) {
        caught = e as Error;
      }
      expect(caught?.message).toBe('SuperSync native request failed: TlsError');
      // Privacy: the hostname from the cert error must NOT leak.
      expect(caught!.message).not.toContain('sync.example.com');
      expect(caught!.message).not.toContain('hostname mismatch');
      for (const call of spy.error.mock.calls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('sync.example.com');
        expect(serialized).not.toContain('hostname mismatch');
      }
    });

    /**
     * Regression: an earlier version of `_handleNativeRequestError`
     * used `error.message.startsWith('HTTP ')` to detect our own
     * thrown HTTP errors. That heuristic would have let a foreign
     * error with a coincidental "HTTP " prefix through unscrubbed,
     * leaking whatever followed. The current implementation tags our
     * own thrown errors with an internal class, so the foreign error
     * is scrubbed even when its message starts with "HTTP ".
     */
    it('scrubs foreign errors that coincidentally start with "HTTP " in the message', async () => {
      const ctx = buildProvider({ isNativePlatform: true });
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      const trickyError = new Error(
        'HTTP request from sync.example.com refused at 10.0.0.5',
      );
      trickyError.name = 'NetworkPolicyError';
      ctx.nativeHttpExecutor.mockRejectedValue(trickyError);

      let caught: Error | undefined;
      try {
        await ctx.provider.uploadOps([createMockOperation()], 'client-1');
      } catch (e) {
        caught = e as Error;
      }
      expect(caught?.message).toBe('SuperSync native request failed: NetworkPolicyError');
      expect(caught!.message).not.toContain('sync.example.com');
      expect(caught!.message).not.toContain('10.0.0.5');
    });

    /**
     * Our own thrown errors carry only scrubbed content (HTTP <status>,
     * AuthFailSPError, MissingCredentialsSPError) and must propagate
     * unchanged on the non-retryable native path.
     */
    it('preserves AuthFailSPError identity through non-retryable native path', async () => {
      const ctx = buildProvider({ isNativePlatform: true });
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.nativeHttpExecutor.mockResolvedValue({
        status: 401,
        headers: {},
        data: { error: 'token expired' },
      });

      await expect(
        ctx.provider.uploadOps([createMockOperation()], 'client-1'),
      ).rejects.toBeInstanceOf(AuthFailSPError);
    });
  });

  describe('Request timeout handling', () => {
    it('throws path-free timeout error on AbortError', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      fetchMock.mockRejectedValue(abortError);

      let caught: Error | undefined;
      try {
        await provider.downloadOps(0, 'client-1');
      } catch (e) {
        caught = e as Error;
      }
      expect(caught?.message).toContain('timeout after 75s');
      // Privacy: relative path (which includes excludeClient=client-1) MUST
      // NOT be interpolated into the thrown Error.message.
      expect(caught!.message).not.toContain('/api/sync/ops');
      expect(caught!.message).not.toContain('client-1');
    });

    it('passes AbortSignal to fetch', async () => {
      const { provider, cfgStore, fetchMock } = buildProvider();
      cfgStore.load.mockResolvedValue(testConfig);
      fetchMock.mockResolvedValue(okResponse({ ops: [], hasMore: false, latestSeq: 0 }));

      await provider.downloadOps(0, 'client-1');

      const [, options] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(options.signal).toBeDefined();
      expect(options.signal instanceof AbortSignal).toBe(true);
    });
  });

  describe('logger behavior', () => {
    it('does not log warning for fast requests', async () => {
      const { logger, spy } = createLoggerSpy();
      const ctx = buildProvider();
      ctx.deps.logger = logger;
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.fetchMock.mockResolvedValue(
        okResponse({ ops: [], hasMore: false, latestSeq: 100 }),
      );

      await ctx.provider.downloadOps(0, 'client-1');

      expect(spy.warn).not.toHaveBeenCalled();
    });

    it('logs error on fetch failure with safe meta only (no body, no URL)', async () => {
      const { logger, spy } = createLoggerSpy();
      const ctx = buildProvider();
      ctx.deps.logger = logger;
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.fetchMock.mockRejectedValue(new Error('Network error'));

      await expect(ctx.provider.downloadOps(0, 'client-1')).rejects.toThrow();

      expect(spy.error).toHaveBeenCalledWith(
        expect.stringContaining('SuperSync request failed'),
        undefined,
        expect.objectContaining({
          path: '/api/sync/ops?sinceSeq=0&excludeClient=client-1',
          errorName: 'Error',
        }),
      );
    });

    it('logs timeout errors with path metadata (path is safe in structured log)', async () => {
      const { logger, spy } = createLoggerSpy();
      const ctx = buildProvider();
      ctx.deps.logger = logger;
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      ctx.fetchMock.mockRejectedValue(abortError);

      await expect(ctx.provider.downloadOps(0, 'client-1')).rejects.toThrow();

      expect(spy.error).toHaveBeenCalledWith(
        expect.stringContaining('SuperSync request timeout'),
        undefined,
        expect.objectContaining({
          path: '/api/sync/ops?sinceSeq=0&excludeClient=client-1',
          timeoutMs: 75000,
        }),
      );
    });
  });

  describe('getEncryptKey', () => {
    it('returns the encryption key when encryption is enabled', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        ...testConfig,
        encryptKey: 'test-password-123',
        isEncryptionEnabled: true,
      });

      expect(await provider.getEncryptKey()).toBe('test-password-123');
    });

    it('returns undefined when encryption is disabled even if encryptKey is set', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        ...testConfig,
        encryptKey: 'test-password-123',
        isEncryptionEnabled: false,
      });

      expect(await provider.getEncryptKey()).toBeUndefined();
    });

    it('returns undefined when no encryption key is set', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        ...testConfig,
        isEncryptionEnabled: true,
      });

      expect(await provider.getEncryptKey()).toBeUndefined();
    });

    it('returns undefined when config is null', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue(null);
      expect(await provider.getEncryptKey()).toBeUndefined();
    });

    it('handles empty string encryption key', async () => {
      const { provider, cfgStore } = buildProvider();
      cfgStore.load.mockResolvedValue({
        ...testConfig,
        encryptKey: '',
        isEncryptionEnabled: true,
      });

      expect(await provider.getEncryptKey()).toBeUndefined();
    });
  });

  describe('privacy regression: no user content in error/log surface', () => {
    /**
     * Drives an HTTP-error path with a body that contains plausible user
     * content (task id + title + an embedded `accessToken`-shaped field)
     * and asserts the thrown error and captured logger meta contain
     * none of it. Pinned by multi-review consensus as a regression test
     * that future contributors can't accidentally regress without breaking
     * this spec.
     */
    it('captures no task id / title / token in logger meta or thrown Error.message', async () => {
      const sensitive =
        '{"taskId":"abc","title":"secret task title","accessToken":"leak"}';
      const { logger, spy } = createLoggerSpy();
      const ctx = buildProvider();
      ctx.deps.logger = logger;
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.fetchMock.mockResolvedValue(
        errorResponse(500, 'Internal Server Error', sensitive),
      );

      let caught: Error | undefined;
      try {
        await ctx.provider.downloadOps(0, 'client-1');
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).toBeDefined();
      expect(caught!.message).not.toContain('secret task title');
      expect(caught!.message).not.toContain('taskId');
      expect(caught!.message).not.toContain('leak');

      const errorCalls = spy.error.mock.calls;
      for (const call of errorCalls) {
        const serialized = JSON.stringify(call);
        expect(serialized).not.toContain('secret task title');
        expect(serialized).not.toContain('"taskId"');
        expect(serialized).not.toContain('"accessToken":"leak"');
      }
    });

    it('logger.error catch-paths receive structured meta (no raw error objects)', async () => {
      const { logger, spy } = createLoggerSpy();
      const ctx = buildProvider();
      ctx.deps.logger = logger;
      ctx.cfgStore.load.mockResolvedValue(testConfig);
      ctx.fetchMock.mockRejectedValue(new Error('boom https://internal-host.invalid/'));

      await expect(ctx.provider.downloadOps(0, 'client-1')).rejects.toThrow();

      // SyncLogger.error signature is (msg, error?, meta?). SuperSync's
      // catch paths always pass `undefined` as the error arg (no raw
      // error object leaks).
      for (const call of spy.error.mock.calls) {
        expect(call[1]).toBeUndefined();
        expect(JSON.stringify(call)).not.toContain('internal-host.invalid');
      }
    });
  });
});

beforeEach(() => {
  vi.clearAllMocks();
});
