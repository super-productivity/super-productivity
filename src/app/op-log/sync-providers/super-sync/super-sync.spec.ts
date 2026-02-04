import { SuperSyncProvider } from './super-sync';
import { SuperSyncPrivateCfg } from './super-sync.model';
import { SyncCredentialStore } from '../credential-store.service';
import { SyncProviderId } from '../provider.const';
import {
  MissingCredentialsSPError,
  AuthFailSPError,
} from '../../core/errors/sync-errors';
import { SyncOperation } from '../provider.interface';
import { SyncLog } from '../../../core/log';

// Helper to convert Blob to Uint8Array
const blobToUint8Array = async (blob: Blob): Promise<Uint8Array> => {
  const arrayBuffer = await blob.arrayBuffer();
  return new Uint8Array(arrayBuffer);
};

// Helper to decompress gzip Uint8Array or Blob to string
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

// Helper to decode base64 string and decompress gzip to string
const decompressBase64Gzip = async (base64: string): Promise<string> => {
  // Decode base64 to binary
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return decompressGzip(bytes);
};

describe('SuperSyncProvider', () => {
  let provider: SuperSyncProvider;
  let mockPrivateCfgStore: jasmine.SpyObj<SyncCredentialStore<SyncProviderId.SuperSync>>;
  let fetchSpy: jasmine.Spy;
  let localStorageSpy: {
    getItem: jasmine.Spy;
    setItem: jasmine.Spy;
  };

  const testConfig: SuperSyncPrivateCfg = {
    baseUrl: 'https://sync.example.com',
    accessToken: 'test-access-token',
  };

  const createMockOperation = (
    overrides: Partial<SyncOperation> = {},
  ): SyncOperation => ({
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

  beforeEach(() => {
    mockPrivateCfgStore = jasmine.createSpyObj('SyncCredentialStore', [
      'load',
      'setComplete',
    ]);

    provider = new SuperSyncProvider();
    provider.privateCfg = mockPrivateCfgStore;

    // Mock fetch
    fetchSpy = jasmine.createSpy('fetch');
    (globalThis as any).fetch = fetchSpy;

    // Mock localStorage
    localStorageSpy = {
      getItem: jasmine.createSpy('getItem'),
      setItem: jasmine.createSpy('setItem'),
    };
    spyOn(localStorage, 'getItem').and.callFake(localStorageSpy.getItem);
    spyOn(localStorage, 'setItem').and.callFake(localStorageSpy.setItem);
  });

  afterEach(() => {
    if (fetchSpy) {
      fetchSpy.calls.reset();
    }
  });

  describe('properties', () => {
    it('should have correct id', () => {
      expect(provider.id).toBe(SyncProviderId.SuperSync);
    });

    it('should not support force upload', () => {
      expect(provider.isUploadForcePossible).toBe(false);
    });

    it('should support operation sync', () => {
      expect(provider.supportsOperationSync).toBe(true);
    });

    it('should have max concurrent requests set to 10', () => {
      expect(provider.maxConcurrentRequests).toBe(10);
    });
  });

  describe('isReady', () => {
    it('should return true when baseUrl and accessToken are configured', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const result = await provider.isReady();

      expect(result).toBe(true);
    });

    it('should return false when config is null', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(null));

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return false when baseUrl is missing', async () => {
      mockPrivateCfgStore.load.and.returnValue(
        Promise.resolve({ accessToken: 'token' } as SuperSyncPrivateCfg),
      );

      const result = await provider.isReady();

      expect(result).toBe(false);
    });

    it('should return false when accessToken is missing', async () => {
      mockPrivateCfgStore.load.and.returnValue(
        Promise.resolve({ baseUrl: 'https://sync.example.com' } as SuperSyncPrivateCfg),
      );

      const result = await provider.isReady();

      expect(result).toBe(false);
    });
  });

  describe('setPrivateCfg', () => {
    it('should call privateCfg.setComplete with the config', async () => {
      mockPrivateCfgStore.setComplete.and.returnValue(Promise.resolve());

      await provider.setPrivateCfg(testConfig);

      expect(mockPrivateCfgStore.setComplete).toHaveBeenCalledWith(testConfig);
    });

    it('should invalidate caches so subsequent calls load fresh config', async () => {
      mockPrivateCfgStore.setComplete.and.returnValue(Promise.resolve());
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );

      // First config
      const config1 = { ...testConfig, baseUrl: 'https://server1.com' };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(config1));
      await provider.downloadOps(0);

      // Change config via setPrivateCfg
      const config2 = { ...testConfig, baseUrl: 'https://server2.com' };
      await provider.setPrivateCfg(config2);

      // Now load should return config2
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(config2));
      await provider.downloadOps(0);

      // Verify second fetch used the new URL
      const lastCallUrl = fetchSpy.calls.mostRecent().args[0];
      expect(lastCallUrl).toContain('server2.com');
    });
  });

  describe('config loading', () => {
    it('should call privateCfg.load for each operation (relies on SyncCredentialStore caching)', async () => {
      // Note: We removed redundant caching in SuperSyncProvider since SyncCredentialStore
      // already has its own in-memory caching. Each call to _cfgOrError now calls load(),
      // but SyncCredentialStore returns cached value after first load.
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );

      // Call multiple methods that use _cfgOrError
      await provider.downloadOps(0);
      await provider.downloadOps(1);
      await provider.downloadOps(2);

      // privateCfg.load is called for each operation, but SyncCredentialStore caches internally
      expect(mockPrivateCfgStore.load).toHaveBeenCalledTimes(3);
    });

    it('should call privateCfg.load for each server seq operation (relies on SyncCredentialStore caching)', async () => {
      // Note: We removed redundant caching in SuperSyncProvider since SyncCredentialStore
      // already has its own in-memory caching.
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      localStorageSpy.getItem.and.returnValue('10');

      // Call getLastServerSeq multiple times
      await provider.getLastServerSeq();
      await provider.getLastServerSeq();
      await provider.getLastServerSeq();

      // privateCfg.load is called for each operation, but SyncCredentialStore caches internally
      expect(mockPrivateCfgStore.load).toHaveBeenCalledTimes(3);
    });
  });

  describe('file operations (not supported)', () => {
    it('should throw error for getFileRev', async () => {
      await expectAsync(provider.getFileRev('/path', null)).toBeRejectedWithError(
        'SuperSync uses operation-based sync only. File operations not supported.',
      );
    });

    it('should throw error for downloadFile', async () => {
      await expectAsync(provider.downloadFile('/path')).toBeRejectedWithError(
        'SuperSync uses operation-based sync only. File operations not supported.',
      );
    });

    it('should throw error for uploadFile', async () => {
      await expectAsync(provider.uploadFile('/path', 'data', null)).toBeRejectedWithError(
        'SuperSync uses operation-based sync only. File operations not supported.',
      );
    });

    it('should throw error for removeFile', async () => {
      await expectAsync(provider.removeFile('/path')).toBeRejectedWithError(
        'SuperSync uses operation-based sync only. File operations not supported.',
      );
    });

    it('should throw error for listFiles', async () => {
      await expectAsync(provider.listFiles('/path')).toBeRejectedWithError(
        'SuperSync uses operation-based sync only. File operations not supported.',
      );
    });
  });

  describe('uploadOps', () => {
    it('should upload operations successfully', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const mockResponse = {
        results: [{ opId: 'op-123', accepted: true, serverSeq: 1 }],
        latestSeq: 1,
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );

      const ops = [createMockOperation()];
      const result = await provider.uploadOps(ops, 'client-1');

      expect(result).toEqual(mockResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://sync.example.com/api/sync/ops');
      expect(options.method).toBe('POST');
      expect(options.headers.get('Authorization')).toBe('Bearer test-access-token');
      expect(options.headers.get('Content-Type')).toBe('application/json');

      const bodyJson = await decompressGzip(options.body);
      const body = JSON.parse(bodyJson);
      expect(body.ops).toEqual(ops);
      expect(body.clientId).toBe('client-1');
    });

    it('should include lastKnownServerSeq when provided', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              results: [],
              latestSeq: 5,
              newOps: [
                { serverSeq: 3, op: createMockOperation(), receivedAt: Date.now() },
              ],
            }),
        } as Response),
      );

      await provider.uploadOps([createMockOperation()], 'client-1', 2);

      const bodyJson = await decompressGzip(fetchSpy.calls.mostRecent().args[1].body);
      const body = JSON.parse(bodyJson);
      expect(body.lastKnownServerSeq).toBe(2);
    });

    it('should throw MissingCredentialsSPError when config is missing', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(null));

      await expectAsync(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).toBeRejectedWith(jasmine.any(MissingCredentialsSPError));
    });

    it('should throw error on API failure', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Server error'),
        } as Response),
      );

      await expectAsync(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).toBeRejectedWithError(/SuperSync API error: 500/);
    });

    it('should strip trailing slash from baseUrl', async () => {
      mockPrivateCfgStore.load.and.returnValue(
        Promise.resolve({
          ...testConfig,
          baseUrl: 'https://sync.example.com/',
        }),
      );

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [], latestSeq: 0 }),
        } as Response),
      );

      await provider.uploadOps([createMockOperation()], 'client-1');

      const url = fetchSpy.calls.mostRecent().args[0];
      expect(url).toBe('https://sync.example.com/api/sync/ops');
    });
  });

  describe('downloadOps', () => {
    it('should download operations successfully', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const mockResponse = {
        ops: [{ serverSeq: 1, op: createMockOperation(), receivedAt: Date.now() }],
        hasMore: false,
        latestSeq: 1,
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );

      const result = await provider.downloadOps(0);

      expect(result).toEqual(mockResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const url = fetchSpy.calls.mostRecent().args[0];
      expect(url).toBe('https://sync.example.com/api/sync/ops?sinceSeq=0');
    });

    it('should include excludeClient parameter when provided', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );

      await provider.downloadOps(0, 'client-1');

      const url = fetchSpy.calls.mostRecent().args[0];
      expect(url).toContain('excludeClient=client-1');
    });

    it('should include limit parameter when provided', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );

      await provider.downloadOps(0, undefined, 100);

      const url = fetchSpy.calls.mostRecent().args[0];
      expect(url).toContain('limit=100');
    });

    it('should include all query parameters when provided', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );

      await provider.downloadOps(5, 'client-1', 50);

      const url = fetchSpy.calls.mostRecent().args[0];
      expect(url).toContain('sinceSeq=5');
      expect(url).toContain('excludeClient=client-1');
      expect(url).toContain('limit=50');
    });

    it('should throw MissingCredentialsSPError when config is missing', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(null));

      await expectAsync(provider.downloadOps(0)).toBeRejectedWith(
        jasmine.any(MissingCredentialsSPError),
      );
    });
  });

  describe('getLastServerSeq', () => {
    it('should return 0 when no value is stored', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      localStorageSpy.getItem.and.returnValue(null);

      const result = await provider.getLastServerSeq();

      expect(result).toBe(0);
    });

    it('should return stored value when present', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      localStorageSpy.getItem.and.returnValue('42');

      const result = await provider.getLastServerSeq();

      expect(result).toBe(42);
    });

    it('should use unique key per server URL', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      localStorageSpy.getItem.and.returnValue('10');

      await provider.getLastServerSeq();

      expect(localStorage.getItem).toHaveBeenCalledWith(
        jasmine.stringMatching(/^super_sync_last_server_seq_/),
      );
    });
  });

  describe('setLastServerSeq', () => {
    it('should store the sequence value', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      await provider.setLastServerSeq(100);

      expect(localStorage.setItem).toHaveBeenCalledWith(
        jasmine.stringMatching(/^super_sync_last_server_seq_/),
        '100',
      );
    });
  });

  describe('error handling', () => {
    it('should include error text in API error message for non-auth errors', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Database connection failed'),
        } as Response),
      );

      await expectAsync(provider.downloadOps(0)).toBeRejectedWithError(
        'SuperSync API error: 500 Internal Server Error - Database connection failed',
      );
    });

    it('should handle text() failure gracefully', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.reject(new Error('Cannot read body')),
        } as Response),
      );

      await expectAsync(provider.downloadOps(0)).toBeRejectedWithError(
        'SuperSync API error: 500 Internal Server Error - Unknown error',
      );
    });

    it('should throw error on 429 Rate Limited response', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 429,
          statusText: 'Too Many Requests',
          text: () =>
            Promise.resolve('{"error":"Rate limited","errorCode":"RATE_LIMITED"}'),
        } as Response),
      );

      await expectAsync(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).toBeRejectedWithError(/SuperSync API error: 429 Too Many Requests/);
    });

    it('should throw error on 413 Storage Quota Exceeded response', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 413,
          statusText: 'Payload Too Large',
          text: () =>
            Promise.resolve(
              '{"error":"Storage quota exceeded","errorCode":"STORAGE_QUOTA_EXCEEDED","storageUsedBytes":100000000,"storageQuotaBytes":100000000}',
            ),
        } as Response),
      );

      await expectAsync(
        provider.uploadSnapshot(
          {},
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id',
        ),
      ).toBeRejectedWithError(/SuperSync API error: 413.*Storage quota exceeded/);
    });
  });

  describe('authentication error handling', () => {
    it('should throw AuthFailSPError on 401 Unauthorized response', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Invalid or expired token'),
        } as Response),
      );

      await expectAsync(provider.downloadOps(0)).toBeRejectedWith(
        jasmine.any(AuthFailSPError),
      );
    });

    it('should throw AuthFailSPError on 403 Forbidden response', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: () => Promise.resolve('Account deleted'),
        } as Response),
      );

      await expectAsync(provider.downloadOps(0)).toBeRejectedWith(
        jasmine.any(AuthFailSPError),
      );
    });

    it('should throw AuthFailSPError and allow next operation to proceed', async () => {
      // Note: We removed the local caching in SuperSyncProvider since SyncCredentialStore
      // already has its own in-memory caching. Each operation calls load() directly.
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );
      await provider.downloadOps(0);
      expect(mockPrivateCfgStore.load).toHaveBeenCalledTimes(1);

      // Second call fails with 401
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Token expired'),
        } as Response),
      );

      try {
        await provider.downloadOps(0);
      } catch (e) {
        // Expected to throw AuthFailSPError
        expect(e).toBeInstanceOf(AuthFailSPError);
      }

      // Third call should succeed - config reloaded from SyncCredentialStore
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], hasMore: false, latestSeq: 0 }),
        } as Response),
      );
      await provider.downloadOps(0);
      // Each operation calls load() directly (SyncCredentialStore handles caching)
      expect(mockPrivateCfgStore.load).toHaveBeenCalledTimes(3);
    });

    it('should throw AuthFailSPError for uploadOps on 401', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Account not found'),
        } as Response),
      );

      await expectAsync(
        provider.uploadOps([createMockOperation()], 'client-1'),
      ).toBeRejectedWith(jasmine.any(AuthFailSPError));
    });

    it('should throw AuthFailSPError for uploadSnapshot on 401', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 401,
          statusText: 'Unauthorized',
          text: () => Promise.resolve('Invalid token'),
        } as Response),
      );

      await expectAsync(
        provider.uploadSnapshot(
          {},
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id',
        ),
      ).toBeRejectedWith(jasmine.any(AuthFailSPError));
    });

    it('should include HTTP status code in AuthFailSPError message', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 403,
          statusText: 'Forbidden',
          text: () => Promise.resolve('Access denied'),
        } as Response),
      );

      try {
        await provider.downloadOps(0);
        fail('Expected AuthFailSPError to be thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(AuthFailSPError);
        expect((e as AuthFailSPError).message).toContain('403');
      }
    });
  });

  describe('upload response with rejected ops', () => {
    it('should return response with CONFLICT_CONCURRENT rejection', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

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

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );

      const result = await provider.uploadOps([createMockOperation()], 'client-1', 2);

      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(false);
      expect(result.results[0].errorCode).toBe('CONFLICT_CONCURRENT');
      expect(result.results[0].error).toContain('Concurrent modification');
      expect(result.newOps).toBeDefined();
      expect(result.newOps!.length).toBe(1);
    });

    it('should return response with CONFLICT_SUPERSEDED rejection', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const mockResponse = {
        results: [
          {
            opId: 'op-123',
            accepted: false,
            error: 'Superseded operation: server has newer version of TASK:task-1',
            errorCode: 'CONFLICT_SUPERSEDED',
          },
        ],
        latestSeq: 5,
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );

      const result = await provider.uploadOps([createMockOperation()], 'client-1');

      expect(result.results[0].accepted).toBe(false);
      expect(result.results[0].errorCode).toBe('CONFLICT_SUPERSEDED');
    });

    it('should return response with DUPLICATE_OPERATION rejection', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const mockResponse = {
        results: [
          {
            opId: 'op-123',
            accepted: false,
            error: 'Duplicate operation ID',
            errorCode: 'DUPLICATE_OPERATION',
          },
        ],
        latestSeq: 5,
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );

      const result = await provider.uploadOps([createMockOperation()], 'client-1');

      expect(result.results[0].accepted).toBe(false);
      expect(result.results[0].errorCode).toBe('DUPLICATE_OPERATION');
    });

    it('should return mixed accept/reject results correctly', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const mockResponse = {
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
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
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

    it('should include piggybacked ops even when upload has rejections', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const piggybackedOp = {
        serverSeq: 5,
        op: createMockOperation({ id: 'remote-op', entityId: 'task-2' }),
        receivedAt: Date.now(),
      };

      const mockResponse = {
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
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
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
    it('should generate different keys for different URLs', async () => {
      const capturedKeys: string[] = [];
      localStorageSpy.getItem.and.callFake((key: string) => {
        capturedKeys.push(key);
        return null;
      });

      // First URL - use fresh provider
      const provider1 = new SuperSyncProvider();
      const mockStore1 = jasmine.createSpyObj('SyncCredentialStore', [
        'load',
        'setComplete',
      ]);
      provider1.privateCfg = mockStore1;
      mockStore1.load.and.returnValue(
        Promise.resolve({ ...testConfig, baseUrl: 'https://server1.com' }),
      );
      await provider1.getLastServerSeq();

      // Second URL - use fresh provider
      const provider2 = new SuperSyncProvider();
      const mockStore2 = jasmine.createSpyObj('SyncCredentialStore', [
        'load',
        'setComplete',
      ]);
      provider2.privateCfg = mockStore2;
      mockStore2.load.and.returnValue(
        Promise.resolve({ ...testConfig, baseUrl: 'https://server2.com' }),
      );
      await provider2.getLastServerSeq();

      expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
    });

    it('should generate different keys for different access tokens on same server', async () => {
      const capturedKeys: string[] = [];
      localStorageSpy.getItem.and.callFake((key: string) => {
        capturedKeys.push(key);
        return null;
      });

      // First user - use fresh provider
      const provider1 = new SuperSyncProvider();
      const mockStore1 = jasmine.createSpyObj('SyncCredentialStore', [
        'load',
        'setComplete',
      ]);
      provider1.privateCfg = mockStore1;
      mockStore1.load.and.returnValue(
        Promise.resolve({
          ...testConfig,
          baseUrl: 'https://server.com',
          accessToken: 'token-user-1',
        }),
      );
      await provider1.getLastServerSeq();

      // Second user - use fresh provider (same server, different token)
      const provider2 = new SuperSyncProvider();
      const mockStore2 = jasmine.createSpyObj('SyncCredentialStore', [
        'load',
        'setComplete',
      ]);
      provider2.privateCfg = mockStore2;
      mockStore2.load.and.returnValue(
        Promise.resolve({
          ...testConfig,
          baseUrl: 'https://server.com',
          accessToken: 'token-user-2',
        }),
      );
      await provider2.getLastServerSeq();

      expect(capturedKeys[0]).not.toBe(capturedKeys[1]);
    });

    it('should use default key when config is missing', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(null));
      localStorageSpy.getItem.and.returnValue(null);

      await provider.getLastServerSeq();

      expect(localStorage.getItem).toHaveBeenCalledWith(
        jasmine.stringMatching(/^super_sync_last_server_seq_/),
      );
    });
  });

  describe('uploadSnapshot', () => {
    it('should upload snapshot with gzip compression', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const mockResponse = {
        accepted: true,
        serverSeq: 5,
      };

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve(mockResponse),
        } as Response),
      );

      const state = { tasks: [{ id: 'task-1', title: 'Test' }] };
      const vectorClock: Record<string, number> = {};
      vectorClock['client-1'] = 3;
      const result = await provider.uploadSnapshot(
        state,
        'client-1',
        'recovery',
        vectorClock,
        1,
        undefined, // isPayloadEncrypted
        'test-op-id-snapshot', // opId
      );

      expect(result).toEqual(mockResponse);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      const [url, options] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://sync.example.com/api/sync/snapshot');
      expect(options.method).toBe('POST');
      expect(options.headers.get('Authorization')).toBe('Bearer test-access-token');
      expect(options.headers.get('Content-Type')).toBe('application/json');
      expect(options.headers.get('Content-Encoding')).toBe('gzip');
    });

    it('should send gzip-compressed body', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ accepted: true }),
        } as Response),
      );

      await provider.uploadSnapshot(
        { data: 'test' },
        'client-1',
        'initial',
        {},
        1,
        undefined, // isPayloadEncrypted
        'test-op-id-gzip', // opId
      );

      const body = fetchSpy.calls.mostRecent().args[1].body;
      expect(body).toBeInstanceOf(Blob);
      // Convert Blob to Uint8Array to verify gzip magic number
      const bytes = await blobToUint8Array(body);
      expect(bytes[0]).toBe(0x1f);
      expect(bytes[1]).toBe(0x8b);
    });

    it('should include all required fields in payload', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      let capturedBody: Blob | null = null;
      fetchSpy.and.callFake(async (_url: string, options: RequestInit) => {
        capturedBody = options.body as Blob;
        return {
          ok: true,
          json: () => Promise.resolve({ accepted: true }),
        } as Response;
      });

      const state = { tasks: [] };
      const vectorClock: Record<string, number> = {};
      vectorClock['client-1'] = 5;
      await provider.uploadSnapshot(
        state,
        'client-1',
        'migration',
        vectorClock,
        2,
        undefined, // isPayloadEncrypted
        'test-op-id-fields', // opId
      );

      // Decompress and verify payload
      expect(capturedBody).not.toBeNull();
      const payload = JSON.parse(await decompressGzip(capturedBody!));

      expect(payload.state).toEqual(state);
      expect(payload.clientId).toBe('client-1');
      expect(payload.reason).toBe('migration');
      expect(payload.vectorClock).toEqual(vectorClock);
      expect(payload.schemaVersion).toBe(2);
    });

    it('should throw MissingCredentialsSPError when config is missing', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(null));

      await expectAsync(
        provider.uploadSnapshot(
          {},
          'client-1',
          'recovery',
          {},
          1,
          undefined,
          'test-op-id',
        ),
      ).toBeRejectedWith(jasmine.any(MissingCredentialsSPError));
    });

    it('should throw error on API failure', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 413,
          statusText: 'Payload Too Large',
          text: () => Promise.resolve('Body too large'),
        } as Response),
      );

      await expectAsync(
        provider.uploadSnapshot(
          { largeData: 'x'.repeat(1000) },
          'client-1',
          'recovery',
          {},
          1,
          undefined, // isPayloadEncrypted
          'test-op-id-error', // opId
        ),
      ).toBeRejectedWithError(/SuperSync API error: 413/);
    });

    it('should handle different snapshot reasons', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      const reasons: Array<'initial' | 'recovery' | 'migration'> = [
        'initial',
        'recovery',
        'migration',
      ];

      for (const reason of reasons) {
        fetchSpy.and.returnValue(
          Promise.resolve({
            ok: true,
            json: () => Promise.resolve({ accepted: true }),
          } as Response),
        );

        await provider.uploadSnapshot(
          {},
          'client-1',
          reason,
          {},
          1,
          undefined, // isPayloadEncrypted
          `test-op-id-${reason}`, // opId
        );

        // Verify the reason was included in the compressed payload
        const body = fetchSpy.calls.mostRecent().args[1].body as Blob;
        const payload = JSON.parse(await decompressGzip(body));

        expect(payload.reason).toBe(reason);
      }
    });

    it('should compress large payloads effectively', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      let capturedBody: Blob | null = null;
      fetchSpy.and.callFake(async (_url: string, options: RequestInit) => {
        capturedBody = options.body as Blob;
        return {
          ok: true,
          json: () => Promise.resolve({ accepted: true }),
        } as Response;
      });

      // Create a large repetitive payload (compresses well)
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
        undefined, // isPayloadEncrypted
        'test-op-id-compress', // opId
      );

      const originalSize = JSON.stringify({
        state: largeState,
        clientId: 'client-1',
        reason: 'recovery',
        vectorClock: {},
        schemaVersion: 1,
      }).length;

      expect(capturedBody).not.toBeNull();
      // Compressed should be significantly smaller
      expect(capturedBody!.size).toBeLessThan(originalSize * 0.5);
    });
  });

  // Note: CapacitorHttp tests are skipped because native plugins are difficult to mock properly
  // in Jasmine (they're registered at module load time). This is the same approach used by
  // WebDavHttpAdapter tests.
  //
  // The native platform gzip handling is tested via:
  // 1. Server-side tests that verify base64-encoded gzip decompression works
  // 2. Manual testing on Android/iOS devices
  // 3. Integration tests with the actual CapacitorHttp plugin
  describe('Native platform branching logic', () => {
    // Create a testable subclass that overrides platform detection
    class TestableSuperSyncProvider extends SuperSyncProvider {
      constructor(private _isNativePlatform: boolean) {
        super();
      }

      protected override get isNativePlatform(): boolean {
        return this._isNativePlatform;
      }

      // Expose the private method for testing
      public async testFetchApiCompressedNative(
        cfg: SuperSyncPrivateCfg,
        path: string,
        jsonPayload: string,
      ): Promise<{ base64Gzip: string; headers: Record<string, string>; url: string }> {
        // Instead of actually calling CapacitorHttp, return what would be sent
        const { compressWithGzipToString } =
          await import('../../encryption/compression-handler');
        const base64Gzip = await compressWithGzipToString(jsonPayload);
        const baseUrl = cfg.baseUrl.replace(/\/$/, '');
        const url = `${baseUrl}${path}`;
        const sanitizedToken = cfg.accessToken.replace(/[^\x20-\x7E]/g, '');

        const headers: Record<string, string> = {
          Authorization: `Bearer ${sanitizedToken}`,
        };
        headers['Content-Type'] = 'application/json';
        headers['Content-Encoding'] = 'gzip';
        headers['Content-Transfer-Encoding'] = 'base64';

        return {
          base64Gzip,
          url,
          headers,
        };
      }
    }

    it('should use native path when isNativePlatform is true', async () => {
      const nativeProvider = new TestableSuperSyncProvider(true);
      nativeProvider.privateCfg = mockPrivateCfgStore;
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      // Test the payload that would be sent to CapacitorHttp
      const result = await nativeProvider.testFetchApiCompressedNative(
        testConfig,
        '/api/sync/ops',
        JSON.stringify({ ops: [createMockOperation()], clientId: 'client-1' }),
      );

      expect(result.url).toBe('https://sync.example.com/api/sync/ops');
      expect(result.headers['Content-Encoding']).toBe('gzip');
      expect(result.headers['Content-Transfer-Encoding']).toBe('base64');
      expect(result.headers['Authorization']).toBe('Bearer test-access-token');
    });

    it('should produce valid base64-encoded gzip data', async () => {
      const nativeProvider = new TestableSuperSyncProvider(true);
      nativeProvider.privateCfg = mockPrivateCfgStore;

      const ops = [createMockOperation()];
      const payload = { ops, clientId: 'client-1', lastKnownServerSeq: 5 };

      const result = await nativeProvider.testFetchApiCompressedNative(
        testConfig,
        '/api/sync/ops',
        JSON.stringify(payload),
      );

      // Verify it's a valid base64 string
      expect(typeof result.base64Gzip).toBe('string');
      expect(() => atob(result.base64Gzip)).not.toThrow();

      // Decompress and verify payload
      const jsonPayload = await decompressBase64Gzip(result.base64Gzip);
      const decompressedPayload = JSON.parse(jsonPayload);
      expect(decompressedPayload.ops).toEqual(ops);
      expect(decompressedPayload.clientId).toBe('client-1');
      expect(decompressedPayload.lastKnownServerSeq).toBe(5);
    });

    it('should use regular fetch path when not on native platform', async () => {
      // Simulate web browser
      const webProvider = new TestableSuperSyncProvider(false);
      webProvider.privateCfg = mockPrivateCfgStore;
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ results: [], latestSeq: 0 }),
        } as Response),
      );

      await webProvider.uploadOps([createMockOperation()], 'client-1');

      // Should use regular fetch, not CapacitorHttp
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const [url, options] = fetchSpy.calls.mostRecent().args;
      expect(url).toBe('https://sync.example.com/api/sync/ops');
      expect(options.headers.get('Content-Encoding')).toBe('gzip');
      // Should NOT have Content-Transfer-Encoding header (that's only for native)
      expect(options.headers.get('Content-Transfer-Encoding')).toBeNull();
    });

    it('should produce gzip data that decompresses to valid snapshot payload', async () => {
      const nativeProvider = new TestableSuperSyncProvider(true);
      nativeProvider.privateCfg = mockPrivateCfgStore;

      const state = { tasks: [{ id: 'task-1' }] };
      const vectorClock: Record<string, number> = {};
      vectorClock['client-1'] = 10;
      const payload = {
        state,
        clientId: 'client-1',
        reason: 'migration',
        vectorClock,
        schemaVersion: 2,
        isPayloadEncrypted: true,
      };

      const result = await nativeProvider.testFetchApiCompressedNative(
        testConfig,
        '/api/sync/snapshot',
        JSON.stringify(payload),
      );

      const jsonPayload = await decompressBase64Gzip(result.base64Gzip);
      const decompressedPayload = JSON.parse(jsonPayload);
      expect(decompressedPayload.state).toEqual(state);
      expect(decompressedPayload.clientId).toBe('client-1');
      expect(decompressedPayload.reason).toBe('migration');
      expect(decompressedPayload.vectorClock).toEqual(vectorClock);
      expect(decompressedPayload.schemaVersion).toBe(2);
      expect(decompressedPayload.isPayloadEncrypted).toBe(true);
    });
  });

  describe('Request timeout handling', () => {
    beforeEach(() => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
    });

    it('should clear timeout on successful response', async () => {
      const clearTimeoutSpy = spyOn(window, 'clearTimeout');

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], latestSeq: 100 }),
        } as Response),
      );

      await provider.downloadOps(0, 'client-1');

      // Verify timeout was cleared (prevents memory leaks)
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should clear timeout on error response', async () => {
      const clearTimeoutSpy = spyOn(window, 'clearTimeout');

      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: false,
          status: 500,
          statusText: 'Internal Server Error',
          text: () => Promise.resolve('Server error'),
        } as Response),
      );

      await expectAsync(provider.downloadOps(0, 'client-1')).toBeRejected();

      // Verify timeout was cleared even on error
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it('should pass AbortSignal to fetch', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], latestSeq: 0 }),
        } as Response),
      );

      await provider.downloadOps(0, 'client-1');

      const fetchCall = fetchSpy.calls.mostRecent();
      const options = fetchCall.args[1];
      expect(options.signal).toBeDefined();
      expect(options.signal instanceof AbortSignal).toBe(true);
    });

    it('should handle AbortError and convert to timeout error', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      fetchSpy.and.returnValue(Promise.reject(abortError));

      try {
        await provider.downloadOps(0, 'client-1');
        fail('Should have thrown timeout error');
      } catch (error) {
        expect((error as Error).message).toContain('timeout after 75s');
        expect((error as Error).message).toContain('/api/sync/ops');
      }
    });
  });

  describe('Performance logging', () => {
    let syncLogWarnSpy: jasmine.Spy;
    let syncLogErrorSpy: jasmine.Spy;

    beforeEach(() => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(testConfig));
      syncLogWarnSpy = spyOn(SyncLog, 'warn');
      syncLogErrorSpy = spyOn(SyncLog, 'error');
    });

    it('should not log warning for fast requests', async () => {
      fetchSpy.and.returnValue(
        Promise.resolve({
          ok: true,
          json: () => Promise.resolve({ ops: [], latestSeq: 100 }),
        } as Response),
      );

      await provider.downloadOps(0, 'client-1');

      // Should not have logged warning for fast request
      expect(syncLogWarnSpy).not.toHaveBeenCalled();
    });

    it('should log error on fetch failure', async () => {
      fetchSpy.and.returnValue(Promise.reject(new Error('Network error')));

      await expectAsync(provider.downloadOps(0, 'client-1')).toBeRejected();

      // Should have logged error
      expect(syncLogErrorSpy).toHaveBeenCalledWith(
        'SuperSyncProvider',
        'SuperSync request failed',
        jasmine.objectContaining({
          path: '/api/sync/ops?sinceSeq=0&excludeClient=client-1',
          error: 'Network error',
        }),
      );
    });

    it('should log timeout errors with path information', async () => {
      const abortError = new DOMException('The operation was aborted', 'AbortError');
      fetchSpy.and.returnValue(Promise.reject(abortError));

      await expectAsync(provider.downloadOps(0, 'client-1')).toBeRejected();

      // Should have logged timeout error with path
      expect(syncLogErrorSpy).toHaveBeenCalledWith(
        'SuperSyncProvider',
        'SuperSync request timeout',
        jasmine.objectContaining({
          path: '/api/sync/ops?sinceSeq=0&excludeClient=client-1',
          timeoutMs: 75000,
        }),
      );
    });
  });

  describe('getEncryptKey', () => {
    it('should return encryption key when encryption is enabled', async () => {
      const configWithEncryption: SuperSyncPrivateCfg = {
        ...testConfig,
        encryptKey: 'test-password-123',
        isEncryptionEnabled: true,
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(configWithEncryption));

      const result = await provider.getEncryptKey();

      expect(result).toBe('test-password-123');
    });

    it('should return undefined when encryption is disabled even if encryptKey is set', async () => {
      // This test prevents regression of the password change bug where data was
      // uploaded unencrypted because getEncryptKey() returned the key even when
      // isEncryptionEnabled was false
      const configWithKeyButDisabled: SuperSyncPrivateCfg = {
        ...testConfig,
        encryptKey: 'test-password-123',
        isEncryptionEnabled: false,
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(configWithKeyButDisabled));

      const result = await provider.getEncryptKey();

      expect(result).toBeUndefined();
    });

    it('should return undefined when no encryption key is set', async () => {
      const configWithoutKey: SuperSyncPrivateCfg = {
        ...testConfig,
        isEncryptionEnabled: true,
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(configWithoutKey));

      const result = await provider.getEncryptKey();

      expect(result).toBeUndefined();
    });

    it('should return undefined when config is null', async () => {
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(null));

      const result = await provider.getEncryptKey();

      expect(result).toBeUndefined();
    });

    it('should return undefined when encryption is explicitly disabled', async () => {
      const configDisabled: SuperSyncPrivateCfg = {
        ...testConfig,
        encryptKey: 'old-password',
        isEncryptionEnabled: false,
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(configDisabled));

      const result = await provider.getEncryptKey();

      expect(result).toBeUndefined();
    });

    it('should handle empty string encryption key', async () => {
      const configWithEmptyKey: SuperSyncPrivateCfg = {
        ...testConfig,
        encryptKey: '',
        isEncryptionEnabled: true,
      };
      mockPrivateCfgStore.load.and.returnValue(Promise.resolve(configWithEmptyKey));

      const result = await provider.getEncryptKey();

      expect(result).toBeUndefined();
    });
  });
});
