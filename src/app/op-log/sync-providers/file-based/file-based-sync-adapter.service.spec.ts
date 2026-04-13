import { TestBed } from '@angular/core/testing';
import { FileBasedSyncAdapterService } from './file-based-sync-adapter.service';
import { SyncProviderId } from '../provider.const';
import {
  SyncProviderServiceInterface,
  OperationSyncCapable,
  SyncOperation,
} from '../provider.interface';
import {
  FILE_BASED_SYNC_CONSTANTS,
  FileBasedSyncData,
  SyncDataCorruptedError,
} from './file-based-sync.types';
import {
  RemoteFileNotFoundAPIError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { getSyncFilePrefix } from '../../util/sync-file-prefix';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';
import { StateSnapshotService } from '../../backup/state-snapshot.service';

describe('FileBasedSyncAdapterService', () => {
  let service: FileBasedSyncAdapterService;
  let mockProvider: jasmine.SpyObj<SyncProviderServiceInterface<SyncProviderId>>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let adapter: OperationSyncCapable;

  const mockCfg: EncryptAndCompressCfg = {
    isEncrypt: false,
    isCompress: false,
  };

  const mockEncryptKey: string | undefined = undefined;

  const mockArchiveYoung: ArchiveModel = {
    task: {
      ids: ['archivedTask1'],
      entities: {
        archivedTask1: { id: 'archivedTask1', title: 'Archived 1' } as any,
      },
    },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  };

  const mockArchiveOld: ArchiveModel = {
    task: {
      ids: ['oldTask1'],
      entities: { oldTask1: { id: 'oldTask1', title: 'Old Archived' } as any },
    },
    timeTracking: { project: {}, tag: {} },
    lastTimeTrackingFlush: 0,
  };

  // Helper to add PFAPI prefix for mock file downloads
  const addPrefix = (data: unknown, version = 2): string => {
    const prefix = getSyncFilePrefix({
      isCompress: mockCfg.isCompress,
      isEncrypt: mockCfg.isEncrypt,
      modelVersion: version,
    });
    return prefix + JSON.stringify(data);
  };

  // Helper to parse prefixed data from uploads
  const parseWithPrefix = (dataStr: string): FileBasedSyncData => {
    const prefixEnd = dataStr.indexOf('__') + 2;
    const jsonStr = dataStr.slice(prefixEnd);
    return JSON.parse(jsonStr) as FileBasedSyncData;
  };

  const createMockSyncData = (
    overrides: Partial<FileBasedSyncData> = {},
  ): FileBasedSyncData => ({
    version: 2,
    syncVersion: 1,
    schemaVersion: 1,
    vectorClock: { client1: 1 },
    lastModified: Date.now(),
    clientId: 'client1',
    state: { tasks: [] },
    recentOps: [],
    ...overrides,
  });

  const createMockSyncOp = (
    overrides: Partial<{
      id: string;
      clientId: string;
      actionType: string;
      opType: string;
      entityType: string;
      entityId: string;
      vectorClock: Record<string, number>;
      timestamp: number;
      schemaVersion: number;
      payload: unknown;
    }> = {},
  ): SyncOperation => ({
    id: 'op-123',
    clientId: 'client1',
    actionType: '[Task] Add Task',
    opType: 'ADD' as const,
    entityType: 'TASK' as const,
    entityId: 'task-1',
    vectorClock: { client1: 2 },
    timestamp: Date.now(),
    schemaVersion: 1,
    payload: { title: 'Test Task' },
    ...overrides,
  });

  afterEach(() => {
    // Reset TestBed to ensure fresh service instance for each test
    // This is critical because FileBasedSyncAdapterService caches state in memory
    TestBed.resetTestingModule();
    (FILE_BASED_SYNC_CONSTANTS as any).RETRY_BASE_DELAY_MS = 500;
  });

  beforeEach(() => {
    // Eliminate real retry delays to prevent slow tests and timer accumulation
    (FILE_BASED_SYNC_CONSTANTS as any).RETRY_BASE_DELAY_MS = 0;
    mockArchiveDbAdapter = jasmine.createSpyObj('ArchiveDbAdapter', [
      'loadArchiveYoung',
      'loadArchiveOld',
      'saveArchiveYoung',
      'saveArchiveOld',
    ]);
    mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(
      Promise.resolve(mockArchiveYoung),
    );
    mockArchiveDbAdapter.loadArchiveOld.and.returnValue(Promise.resolve(mockArchiveOld));
    mockArchiveDbAdapter.saveArchiveYoung.and.returnValue(Promise.resolve());
    mockArchiveDbAdapter.saveArchiveOld.and.returnValue(Promise.resolve());

    mockStateSnapshotService = jasmine.createSpyObj('StateSnapshotService', [
      'getStateSnapshot',
    ]);
    mockStateSnapshotService.getStateSnapshot.and.returnValue({
      tasks: [],
      projects: [],
    } as any);

    TestBed.configureTestingModule({
      providers: [
        FileBasedSyncAdapterService,
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
      ],
    });

    service = TestBed.inject(FileBasedSyncAdapterService);

    mockProvider = jasmine.createSpyObj('SyncProvider', [
      'downloadFile',
      'uploadFile',
      'removeFile',
      'getFileRev',
    ]);
    mockProvider.id = SyncProviderId.WebDAV;

    // Clear localStorage to prevent state leaking between tests
    // Note: Must clear both old keys (for migration code path) and new atomic key
    localStorage.removeItem(
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
    );
    localStorage.removeItem(
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
    );
    localStorage.removeItem(
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'state',
    );

    adapter = service.createAdapter(mockProvider, mockCfg, mockEncryptKey);
  });

  describe('createAdapter', () => {
    it('should create an adapter that supports operation sync', () => {
      expect(adapter.supportsOperationSync).toBe(true);
    });

    it('should create an adapter with all required methods', () => {
      expect(adapter.uploadOps).toBeDefined();
      expect(adapter.downloadOps).toBeDefined();
      expect(adapter.getLastServerSeq).toBeDefined();
      expect(adapter.setLastServerSeq).toBeDefined();
      expect(adapter.uploadSnapshot).toBeDefined();
      expect(adapter.deleteAllData).toBeDefined();
    });
  });

  describe('uploadOps', () => {
    it('should return empty results when no ops to upload and file exists', async () => {
      // Mock that a sync file already exists
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.uploadOps([], 'client1');

      expect(result.results).toEqual([]);
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should create sync file with state even when no ops to upload and file does not exist', async () => {
      // Mock that no sync file exists yet
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      const result = await adapter.uploadOps([], 'client1');

      // Should still create the sync file with current state
      // Uses conditional upload (isForceOverwrite: false) with null rev for new file
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        null,
        false, // Conditional upload - provider handles null rev for new file creation
      );
      expect(result.results).toEqual([]);
    });

    it('should create new sync file when none exists', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(true);
      // Uses conditional upload with null rev for new file
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        null,
        false, // Conditional upload - provider handles null rev for new file creation
      );
    });

    it('should handle version mismatch gracefully without piggybacking', async () => {
      // First, download to set expected version
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0); // Sets expected version to 1

      // Now configure for upload - upload will download again and expect version 1
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      const op1 = createMockSyncOp();
      await adapter.uploadOps([op1], 'client1'); // Expected=1, file=1, uploads OK -> expected becomes 2

      // Another client syncs, adding an op and incrementing version to 3 (we expect 2)
      const syncDataV3 = createMockSyncData({
        syncVersion: 3,
        recentOps: [
          {
            id: 'other-op',
            c: 'other-client',
            a: '[Task] Add',
            o: 'CREATE',
            e: 'Task',
            d: 'entity1',
            p: { title: 'Test Task' },
            v: { otherClient: 1 },
            t: Date.now(),
            s: 1,
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncDataV3), rev: 'rev-3' }),
      );

      // Our next upload should succeed — no piggybacked ops returned
      const op2 = createMockSyncOp({ id: 'op-456' });
      const result = await adapter.uploadOps([op2], 'client1');

      // Should succeed (not throw)
      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(true);

      // Should NOT return piggybacked ops (piggybacking removed)
      expect(result.newOps).toBeUndefined();
    });

    it('should merge vector clocks from all ops', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      let uploadedDataStr: string = '';
      mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
        uploadedDataStr = dataStr;
        return Promise.resolve({ rev: 'rev-1' });
      });

      const op1 = createMockSyncOp({
        id: 'op-1',
        vectorClock: { client1: 1, client2: 2 },
      });
      const op2 = createMockSyncOp({
        id: 'op-2',
        vectorClock: { client1: 3, client3: 1 },
      });

      await adapter.uploadOps([op1, op2], 'client1');

      const uploadedData = parseWithPrefix(uploadedDataStr);
      expect(uploadedData.vectorClock).toEqual({ client1: 3, client2: 2, client3: 1 });
    });

    it('should use cached data from downloadOps when uploading (avoids redundant download)', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      // First, download to populate cache
      await adapter.downloadOps(0);

      // Reset download spy call count
      mockProvider.downloadFile.calls.reset();

      // Upload should use cached data, not download again
      const op = createMockSyncOp();
      await adapter.uploadOps([op], 'client1');

      // Download should NOT be called again during upload (cache hit)
      expect(mockProvider.downloadFile).not.toHaveBeenCalled();
    });

    it('should use conditional upload with revToMatch from cache', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-123' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-124' }));

      // Download to populate cache
      await adapter.downloadOps(0);
      mockProvider.downloadFile.calls.reset();

      // Upload should pass revToMatch parameter
      const op = createMockSyncOp();
      await adapter.uploadOps([op], 'client1');

      // Verify upload was called with revToMatch (cached rev)
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        'rev-123', // revToMatch from cached download
        false,
      );
    });

    it('should retry upload once when UploadRevToMatchMismatchAPIError occurs', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // First upload fails with rev mismatch, second succeeds
      let uploadCalls = 0;
      mockProvider.uploadFile.and.callFake(() => {
        uploadCalls++;
        if (uploadCalls === 1) {
          return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
        }
        return Promise.resolve({ rev: 'rev-3' });
      });

      // Download to populate cache
      await adapter.downloadOps(0);

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      // Should succeed after retry
      expect(result.results[0].accepted).toBe(true);
      // Upload was called twice (initial + retry)
      expect(uploadCalls).toBe(2);
      // Download was called twice (initial cache + re-download on retry)
      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(2);
    });

    it('should force upload on retry when freshRev equals original revToMatch', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      // Initial download returns rev-1
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      let uploadCalls = 0;
      mockProvider.uploadFile.and.callFake(
        (_path: string, _dataStr: string, _rev: string | null, _force: boolean) => {
          uploadCalls++;
          if (uploadCalls === 1) {
            return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
          }
          return Promise.resolve({ rev: 'rev-2' });
        },
      );

      // Download to populate cache with rev-1
      await adapter.downloadOps(0);

      // Re-download on retry also returns rev-1 (same rev = server timestamp inconsistency)
      // mockProvider.downloadFile already returns rev-1

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      expect(result.results[0].accepted).toBe(true);
      expect(uploadCalls).toBe(2);

      // Retry upload should be called with isForceOverwrite: true
      const retryCall = mockProvider.uploadFile.calls.argsFor(1);
      expect(retryCall[3]).toBe(true); // isForceOverwrite
    });

    it('should use conditional upload on retry when freshRev differs', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      // Initial download returns rev-1
      mockProvider.downloadFile.and.returnValues(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        // Re-download on retry returns rev-2 (different rev = real concurrent modification)
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-2' }),
      );

      let uploadCalls = 0;
      mockProvider.uploadFile.and.callFake(
        (_path: string, _dataStr: string, _rev: string | null, _force: boolean) => {
          uploadCalls++;
          if (uploadCalls === 1) {
            return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
          }
          return Promise.resolve({ rev: 'rev-3' });
        },
      );

      // Download to populate cache with rev-1
      await adapter.downloadOps(0);

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      expect(result.results[0].accepted).toBe(true);
      expect(uploadCalls).toBe(2);

      // Retry upload should be called with isForceOverwrite: false
      const retryCall = mockProvider.uploadFile.calls.argsFor(1);
      expect(retryCall[3]).toBe(false); // isForceOverwrite
    });

    describe('oldestOpSyncVersion and sv tagging in retry path', () => {
      it('should tag retry compact ops with the correct sv (freshData.syncVersion + 1)', async () => {
        // Existing file at syncVersion=3 with an op tagged sv=3
        const existingData = createMockSyncData({
          syncVersion: 3,
          recentOps: [
            {
              id: 'existing-op',
              c: 'other-client',
              a: 'HA',
              o: 'ADD',
              e: 'TASK',
              d: 'task-existing',
              v: { otherClient: 1 },
              t: Date.now() - 10_000,
              s: 1,
              p: {},
              sv: 3,
            },
          ],
        });

        // First download populates cache
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(existingData), rev: 'rev-1' }),
        );
        await adapter.downloadOps(0);

        // Upload: first attempt fails, retry re-downloads and succeeds
        let uploadCallCount = 0;
        let retryUploadedDataStr = '';
        mockProvider.uploadFile.and.callFake(
          (_path: string, dataStr: string, _rev: string | null, _force: boolean) => {
            uploadCallCount++;
            if (uploadCallCount === 1) {
              return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
            }
            retryUploadedDataStr = dataStr;
            return Promise.resolve({ rev: 'rev-3' });
          },
        );

        // Re-download on retry returns file at syncVersion=5 (another client uploaded twice)
        const freshData = createMockSyncData({
          syncVersion: 5,
          recentOps: [
            {
              id: 'existing-op',
              c: 'other-client',
              a: 'HA',
              o: 'ADD',
              e: 'TASK',
              d: 'task-existing',
              v: { otherClient: 1 },
              t: Date.now() - 10_000,
              s: 1,
              p: {},
              sv: 3,
            },
          ],
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(freshData), rev: 'rev-2' }),
        );

        const newOp = createMockSyncOp({ id: 'new-op' });
        await adapter.uploadOps([newOp], 'client1');

        const uploadedData = parseWithPrefix(retryUploadedDataStr);
        // New op should be tagged with freshData.syncVersion + 1 = 6
        const newCompactOp = uploadedData.recentOps.find((op: any) => op.id === 'new-op');
        expect(newCompactOp).toBeDefined();
        expect((newCompactOp as any).sv).toBe(6);
        // Existing op keeps its original sv=3
        const existingOp = uploadedData.recentOps.find(
          (op: any) => op.id === 'existing-op',
        );
        expect((existingOp as any).sv).toBe(3);
      });

      it('should compute oldestOpSyncVersion from first op in merged array', async () => {
        // Existing file has an op tagged sv=2
        const existingData = createMockSyncData({
          syncVersion: 3,
          recentOps: [
            {
              id: 'old-op',
              c: 'other-client',
              a: 'HA',
              o: 'ADD',
              e: 'TASK',
              d: 'task-old',
              v: { otherClient: 1 },
              t: Date.now() - 60_000,
              s: 1,
              p: {},
              sv: 2,
            },
          ],
        });

        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(existingData), rev: 'rev-1' }),
        );
        await adapter.downloadOps(0);

        let uploadCallCount = 0;
        let retryUploadedDataStr = '';
        mockProvider.uploadFile.and.callFake(
          (_path: string, dataStr: string, _rev: string | null, _force: boolean) => {
            uploadCallCount++;
            if (uploadCallCount === 1) {
              return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
            }
            retryUploadedDataStr = dataStr;
            return Promise.resolve({ rev: 'rev-3' });
          },
        );

        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(existingData), rev: 'rev-2' }),
        );

        const newOp = createMockSyncOp({ id: 'newer-op' });
        await adapter.uploadOps([newOp], 'client1');

        const uploadedData = parseWithPrefix(retryUploadedDataStr);
        // oldestOpSyncVersion should be sv of first (oldest) op = 2
        expect(uploadedData.oldestOpSyncVersion).toBe(2);
      });
    });

    it('should clear cache after successful upload', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      // Download to populate cache
      await adapter.downloadOps(0);

      // Upload (should clear cache)
      const op = createMockSyncOp();
      await adapter.uploadOps([op], 'client1');

      mockProvider.downloadFile.calls.reset();

      // Another upload should re-download since cache was cleared
      const op2 = createMockSyncOp({ id: 'op-2' });
      await adapter.uploadOps([op2], 'client1');

      // Download should be called because cache was cleared after first upload
      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(1);
    });
  });

  describe('downloadOps', () => {
    it('should return empty when no sync file exists', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      const result = await adapter.downloadOps(0);

      expect(result.ops).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.latestSeq).toBe(0);
    });

    it('should return ops from sync file', async () => {
      const syncData = createMockSyncData({
        syncVersion: 2, // syncVersion matches number of ops added
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA', // short code for [Task Shared] addTask
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: { title: 'Task 1' },
          },
          {
            id: 'op-2',
            c: 'client2',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client2: 1 },
            t: Date.now(),
            s: 1,
            p: { title: 'Task 2' },
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0);

      expect(result.ops.length).toBe(2);
      // latestSeq is now syncVersion, not recentOps.length
      expect(result.latestSeq).toBe(2);
    });

    it('should filter ops by excludeClient', async () => {
      const syncData = createMockSyncData({
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-2',
            c: 'client2',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client2: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0, 'client1');

      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.clientId).toBe('client2');
    });

    it('should return ALL ops (filtering by appliedOpIds happens in download service)', async () => {
      // NOTE: The file-based adapter no longer filters by processedOpIds.
      // It returns ALL ops from the file, and the download service filters
      // using appliedOpIds (from IndexedDB) as the source of truth.
      // This prevents sync failures when ops are downloaded but not applied.
      const syncData = createMockSyncData({
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-2',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client1: 2 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-3',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-3',
            v: { client1: 3 },
            t: Date.now(),
            s: 1,
            p: {},
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // First download returns all 3 ops
      const result1 = await adapter.downloadOps(1);
      expect(result1.ops.length).toBe(3);

      // Subsequent download ALSO returns all 3 ops (no longer filtered by adapter)
      // The download service's appliedOpIds filter determines what's actually new
      const result2 = await adapter.downloadOps(1);
      expect(result2.ops.length).toBe(3);
    });

    it('should limit results and indicate hasMore', async () => {
      const manyOps = Array.from({ length: 10 }, (_, i) => ({
        id: `op-${i}`,
        c: 'client1',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { client1: i + 1 },
        t: Date.now(),
        s: 1,
        p: {},
      }));

      const syncData = createMockSyncData({ recentOps: manyOps });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0, undefined, 5);

      expect(result.ops.length).toBe(5);
      expect(result.hasMore).toBe(true);
    });

    it('should throw SyncDataCorruptedError for wrong file version', async () => {
      const badSyncData = createMockSyncData();
      (badSyncData as any).version = 1; // Wrong version
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(badSyncData), rev: 'rev-1' }),
      );

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWith(
        jasmine.any(SyncDataCorruptedError),
      );
    });
  });

  describe('getLastServerSeq / setLastServerSeq', () => {
    it('should return 0 initially', async () => {
      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(0);
    });

    it('should persist and retrieve seq', async () => {
      await adapter.setLastServerSeq(42);
      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(42);
    });
  });

  describe('uploadSnapshot', () => {
    it('should create new sync file with state from getStateSnapshot (not the passed parameter)', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      let uploadedDataStr: string = '';
      mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
        uploadedDataStr = dataStr;
        return Promise.resolve({ rev: 'rev-1' });
      });

      // The passed state should be IGNORED — file adapter uses getStateSnapshot() instead
      // to prevent double-encryption when the upload service encrypts the payload.
      const passedState = { tasks: [{ id: 't1', title: 'Test' }] };
      const vectorClock = { client1: 5 };

      const result = await adapter.uploadSnapshot(
        passedState,
        'client1',
        'initial',
        vectorClock,
        2,
        undefined, // isPayloadEncrypted
        'test-op-id-1', // opId
      );

      expect(result.accepted).toBe(true);
      const uploadedData = parseWithPrefix(uploadedDataStr);
      // State should come from getStateSnapshot(), not the passed parameter
      expect(uploadedData.state).toEqual({ tasks: [], projects: [] } as any);
      expect(uploadedData.vectorClock).toEqual(vectorClock);
      expect(uploadedData.schemaVersion).toBe(2);
      expect(uploadedData.syncVersion).toBe(1);
      expect(uploadedData.recentOps).toEqual([]); // Fresh start
    });

    it('should upload snapshot directly without backup (snapshots replace state completely)', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      await adapter.uploadSnapshot(
        {},
        'client1',
        'recovery',
        { client1: 1 },
        1,
        undefined, // isPayloadEncrypted
        'test-op-id-2', // opId
      );

      // Should upload to main sync file with force overwrite (no backup created)
      expect(mockProvider.uploadFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
        jasmine.any(String),
        null,
        true, // Force overwrite - snapshots replace state completely
      );
      // Should NOT create backup file
      expect(mockProvider.uploadFile).not.toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        jasmine.any(String),
        jasmine.anything(),
        jasmine.anything(),
      );
    });

    describe('uploadSnapshot gap detection', () => {
      it('should not trigger false gap detection after snapshot upload when own client uploaded', async () => {
        // Step 1: Download to set expected sync version
        const initialData = createMockSyncData({
          syncVersion: 1,
          recentOps: [],
          clientId: 'client-a',
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(initialData), rev: 'rev-1' }),
        );
        await adapter.downloadOps(0);

        // Step 2: Upload snapshot as client-a
        mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));
        await adapter.uploadSnapshot(
          {},
          'client-a',
          'initial',
          { client_a: 1 },
          1,
          undefined,
          'test-op-snap',
        );

        // Step 3: Download with excludeClient matching own client
        const snapshotData = createMockSyncData({
          syncVersion: 1,
          recentOps: [],
          clientId: 'client-a',
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(snapshotData), rev: 'rev-2' }),
        );

        const result = await adapter.downloadOps(1, 'client-a');

        // Should NOT detect gap because excludeClient === syncData.clientId
        expect(result.gapDetected).toBe(false);
      });
    });

    it('should set seq counter to syncVersion after snapshot upload', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      // First set a seq value
      await adapter.setLastServerSeq(100);

      // Upload snapshot (syncVersion becomes 1)
      await adapter.uploadSnapshot(
        {},
        'client1',
        'initial',
        { client1: 1 },
        1,
        undefined, // isPayloadEncrypted
        'test-op-id-3', // opId
      );

      // Seq should match syncVersion (1), not reset to 0
      // This prevents repeated conflict dialogs after USE_LOCAL resolution
      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(1);
    });
  });

  describe('deleteAllData', () => {
    it('should delete sync file and backup', async () => {
      mockProvider.removeFile.and.returnValue(Promise.resolve());

      const result = await adapter.deleteAllData();

      expect(result.success).toBe(true);
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.SYNC_FILE,
      );
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
      );
      expect(mockProvider.removeFile).toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.MIGRATION_LOCK_FILE,
      );
    });

    it('should succeed even if files do not exist', async () => {
      mockProvider.removeFile.and.rejectWith(
        new RemoteFileNotFoundAPIError('File not found'),
      );

      const result = await adapter.deleteAllData();

      expect(result.success).toBe(true);
    });

    it('should return failure when main sync file deletion fails with real error', async () => {
      mockProvider.removeFile.and.rejectWith(new Error('Permission denied'));

      const result = await adapter.deleteAllData();

      expect(result.success).toBe(false);
    });

    it('should reset local state after delete', async () => {
      mockProvider.removeFile.and.returnValue(Promise.resolve());

      // Set some state first
      await adapter.setLastServerSeq(50);

      await adapter.deleteAllData();

      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(0);
    });

    it('should allow fresh sync after deleteAllData', async () => {
      // Step 1: Do an initial sync cycle
      const syncData = createMockSyncData({ syncVersion: 1, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0);
      await adapter.setLastServerSeq(1);

      // Step 2: Delete all data
      mockProvider.removeFile.and.returnValue(Promise.resolve());
      await adapter.deleteAllData();

      // Step 3: Upload new ops from scratch
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-new' }));

      const op = createMockSyncOp({ id: 'fresh-op-1' });
      const uploadResult = await adapter.uploadOps([op], 'client1');
      expect(uploadResult.results[0].accepted).toBe(true);

      // Step 4: Download the freshly uploaded data
      const freshData = createMockSyncData({
        syncVersion: 1,
        recentOps: [
          {
            id: 'fresh-op-1',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: { title: 'Test Task' },
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(freshData), rev: 'rev-new' }),
      );

      const downloadResult = await adapter.downloadOps(0);
      expect(downloadResult.ops.length).toBe(1);
      expect(downloadResult.latestSeq).toBe(1);
    });
  });

  describe('latestSeq and snapshotState behavior', () => {
    it('should return latestSeq based on syncVersion (not recentOps.length) to prevent repeated fresh downloads', async () => {
      // This test ensures that after a snapshot upload (where recentOps is empty),
      // subsequent syncs don't treat the client as "fresh" by returning latestSeq=0.
      // If latestSeq=0, then setLastServerSeq(0) is called, and the next sync
      // has sinceSeq=0, which triggers snapshotState on every sync - causing
      // conflict dialogs on every change.

      // Simulate state after snapshot upload: recentOps is empty, but syncVersion is 1
      const syncData = createMockSyncData({
        syncVersion: 1,
        recentOps: [], // Empty after snapshot
        state: { tasks: [] },
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0);

      // latestSeq should be syncVersion (1), NOT recentOps.length (0)
      // This ensures setLastServerSeq(1) is called, preventing repeated fresh downloads
      expect(result.latestSeq).toBe(1);
    });

    it('should only return snapshotState on first download (sinceSeq=0)', async () => {
      const syncData = createMockSyncData({
        syncVersion: 1,
        recentOps: [],
        state: { tasks: [{ id: 't1' }] },
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // First download (sinceSeq=0) should include snapshotState
      const result1 = await adapter.downloadOps(0);
      expect(result1.snapshotState).toBeDefined();

      // Subsequent download (sinceSeq=1) should NOT include snapshotState
      const result2 = await adapter.downloadOps(1);
      expect(result2.snapshotState).toBeUndefined();
    });

    it('should return latestSeq matching syncVersion even with multiple ops', async () => {
      const syncData = createMockSyncData({
        syncVersion: 5, // Higher syncVersion
        recentOps: [
          {
            id: 'op-1',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { client1: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
          {
            id: 'op-2',
            c: 'client1',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-2',
            v: { client1: 2 },
            t: Date.now(),
            s: 1,
            p: {},
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0);

      // latestSeq should be syncVersion (5), not recentOps.length (2)
      expect(result.latestSeq).toBe(5);
    });
  });

  describe('archive handling', () => {
    describe('uploadOps', () => {
      it('should include archiveYoung and archiveOld in upload', async () => {
        mockProvider.downloadFile.and.throwError(
          new RemoteFileNotFoundAPIError('sync-data.json'),
        );

        let uploadedDataStr: string = '';
        mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
          uploadedDataStr = dataStr;
          return Promise.resolve({ rev: 'rev-1' });
        });

        const op = createMockSyncOp();
        await adapter.uploadOps([op], 'client1');

        const uploadedData = parseWithPrefix(uploadedDataStr);
        expect(uploadedData.archiveYoung).toEqual(mockArchiveYoung);
        expect(uploadedData.archiveOld).toEqual(mockArchiveOld);
        expect(mockArchiveDbAdapter.loadArchiveYoung).toHaveBeenCalled();
        expect(mockArchiveDbAdapter.loadArchiveOld).toHaveBeenCalled();
      });

      it('should handle undefined archive gracefully', async () => {
        mockArchiveDbAdapter.loadArchiveYoung.and.returnValue(Promise.resolve(undefined));
        mockArchiveDbAdapter.loadArchiveOld.and.returnValue(Promise.resolve(undefined));

        mockProvider.downloadFile.and.throwError(
          new RemoteFileNotFoundAPIError('sync-data.json'),
        );

        let uploadedDataStr: string = '';
        mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
          uploadedDataStr = dataStr;
          return Promise.resolve({ rev: 'rev-1' });
        });

        const op = createMockSyncOp();
        await adapter.uploadOps([op], 'client1');

        const uploadedData = parseWithPrefix(uploadedDataStr);
        expect(uploadedData.archiveYoung).toBeUndefined();
        expect(uploadedData.archiveOld).toBeUndefined();
      });
    });

    describe('uploadSnapshot', () => {
      it('should include archive data in snapshot', async () => {
        mockProvider.downloadFile.and.throwError(
          new RemoteFileNotFoundAPIError('sync-data.json'),
        );

        let uploadedDataStr: string = '';
        mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
          uploadedDataStr = dataStr;
          return Promise.resolve({ rev: 'rev-1' });
        });

        await adapter.uploadSnapshot(
          {},
          'client1',
          'initial',
          { client1: 1 },
          1,
          undefined, // isPayloadEncrypted
          'test-op-id-4', // opId
        );

        const uploadedData = parseWithPrefix(uploadedDataStr);
        expect(uploadedData.archiveYoung).toEqual(mockArchiveYoung);
        expect(uploadedData.archiveOld).toEqual(mockArchiveOld);
      });
    });

    describe('downloadOps', () => {
      // NOTE: Archives are NOT written to IndexedDB during downloadOps anymore.
      // They are included in snapshotState and written during hydrateFromRemoteSync.
      // This prevents corrupting local archives if user chooses "Keep local" in conflict dialog.

      it('should NOT write archive to IndexedDB on first download - archives go in snapshotState', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
          archiveOld: mockArchiveOld,
          state: { tasks: [] },
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        const result = await adapter.downloadOps(0);

        // Archives should NOT be written during downloadOps
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();

        // Archives should be included in snapshotState instead
        expect(result.snapshotState).toBeDefined();
        expect((result.snapshotState as any).archiveYoung).toEqual(mockArchiveYoung);
        expect((result.snapshotState as any).archiveOld).toEqual(mockArchiveOld);
      });

      it('should NOT write archive on subsequent downloads (sinceSeq > 0)', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
          archiveOld: mockArchiveOld,
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(1); // Not first download

        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should handle missing archive gracefully (backward compatibility)', async () => {
        // Old sync file without archive fields
        const syncData = createMockSyncData({ state: { tasks: [] } });
        delete (syncData as any).archiveYoung;
        delete (syncData as any).archiveOld;

        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        const result = await adapter.downloadOps(0);

        // Should not attempt to save undefined archive
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();

        // snapshotState should still be returned but without archives
        expect(result.snapshotState).toBeDefined();
        expect((result.snapshotState as any).archiveYoung).toBeUndefined();
        expect((result.snapshotState as any).archiveOld).toBeUndefined();
      });

      it('should include partial archive (only archiveYoung) in snapshotState', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
          state: { tasks: [] },
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        const result = await adapter.downloadOps(0);

        // Archives should NOT be written during downloadOps
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();

        // Only archiveYoung should be in snapshotState
        expect(result.snapshotState).toBeDefined();
        expect((result.snapshotState as any).archiveYoung).toEqual(mockArchiveYoung);
        expect((result.snapshotState as any).archiveOld).toBeUndefined();
      });
    });
  });

  describe('conflict prevention after snapshot upload', () => {
    it('should not return snapshotState on download after snapshot upload', async () => {
      // Setup: Simulate that a snapshot was just uploaded
      // The sync file has syncVersion=1, state exists, recentOps is empty
      const snapshotData = createMockSyncData({
        syncVersion: 1,
        state: { tasks: [{ id: 't1' }] },
        recentOps: [],
      });

      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(snapshotData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      // Act: Upload a snapshot (simulates USE_LOCAL conflict resolution)
      await adapter.uploadSnapshot(
        {},
        'client1',
        'initial',
        { client1: 1 },
        1,
        undefined, // isPayloadEncrypted
        'test-op-id-5', // opId
      );

      // Verify: lastServerSeq should be 1 (not 0)
      const lastSeq = await adapter.getLastServerSeq();
      expect(lastSeq).toBe(1);

      // Act: Download with the stored seq (simulates next sync cycle)
      const downloadResult = await adapter.downloadOps(lastSeq);

      // Verify: snapshotState should NOT be returned (because sinceSeq > 0)
      // If snapshotState were returned, it would trigger LocalDataConflictError
      expect(downloadResult.snapshotState).toBeUndefined();
    });

    it('should prevent repeated conflict dialogs after USE_LOCAL resolution', async () => {
      // This test simulates the exact bug scenario:
      // 1. Snapshot is uploaded (USE_LOCAL resolution)
      // 2. User makes a change (new op pending)
      // 3. Next download should NOT return snapshotState

      const snapshotData = createMockSyncData({
        syncVersion: 1,
        state: { tasks: [] },
        recentOps: [],
      });

      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(snapshotData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      // Step 1: Upload snapshot (simulates USE_LOCAL)
      await adapter.uploadSnapshot(
        {},
        'client1',
        'initial',
        { client1: 1 },
        1,
        undefined, // isPayloadEncrypted
        'test-op-id-6', // opId
      );

      // Step 2: Verify seq is set correctly to syncVersion
      const seqAfterUpload = await adapter.getLastServerSeq();
      expect(seqAfterUpload).toBe(1);

      // Step 3: Simulate next download (should NOT trigger conflict)
      const result = await adapter.downloadOps(seqAfterUpload);

      // snapshotState should be undefined - this is the key assertion
      // If this is defined, it would trigger LocalDataConflictError
      expect(result.snapshotState).toBeUndefined();
      expect(result.ops).toEqual([]); // No new ops
    });

    it('should return snapshotState only on fresh download (sinceSeq=0)', async () => {
      // This verifies that snapshotState IS returned when expected
      const snapshotData = createMockSyncData({
        syncVersion: 1,
        state: { tasks: [{ id: 't1' }] },
        recentOps: [],
      });

      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(snapshotData), rev: 'rev-1' }),
      );

      // Fresh download (sinceSeq=0) should return snapshotState
      const result = await adapter.downloadOps(0);

      expect(result.snapshotState).toEqual({ tasks: [{ id: 't1' }] });
    });

    it('should detect snapshot replacement when syncVersion remains at 1 (with excludeClient)', async () => {
      // This test verifies the false negative fix using the clientId-based detection.
      // Scenario:
      // 1. Client A has synced before (lastServerSeq=1, syncVersion=1)
      // 2. Client B uploads a snapshot: syncVersion=1, recentOps=[], clientId=client-b
      // 3. Client A downloads with excludeClient='client-a'
      // Expected: Should detect gap because snapshot.clientId !== excludeClient

      // Step 1: Simulate initial download for client-a (has ops)
      const initialData = createMockSyncData({
        syncVersion: 1,
        clientId: 'client-a',
        recentOps: [
          {
            id: 'op1',
            c: 'client-a',
            a: 'HA',
            o: 'CRT',
            e: 'TASK',
            d: 't1',
            p: { title: 'Task 1' },
            v: { client_a: 1 },
            t: Date.now(),
            s: 1,
          },
        ],
      });

      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(initialData), rev: 'rev-1' }),
      );

      // Download with excludeClient='client-a' to establish baseline
      const initialResult = await adapter.downloadOps(0, 'client-a');
      expect(initialResult.ops.length).toBe(0); // Own op filtered out
      expect(initialResult.latestSeq).toBe(1);

      // Update lastServerSeq to 1 (simulates that client-a has synced)
      await adapter.setLastServerSeq(1);

      // Step 2: Another client (client-b) uploads a snapshot
      // syncVersion STAYS at 1 (doesn't increment), recentOps cleared, clientId changes
      const snapshotData = createMockSyncData({
        syncVersion: 1, // SAME VERSION as before
        clientId: 'client-b', // DIFFERENT CLIENT
        recentOps: [], // Snapshot cleared ops
        state: { tasks: [{ id: 't2', title: 'Task 2' }] },
      });

      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(snapshotData), rev: 'rev-2' }),
      );

      // Step 3: Client A downloads again with sinceSeq=1 and excludeClient='client-a'
      const result = await adapter.downloadOps(1, 'client-a');

      // Should detect gap because:
      // - syncData.clientId ('client-b') !== excludeClient ('client-a')
      // - This means another client uploaded, so gap should be detected
      expect(result.gapDetected).toBe(true);
      expect(result.ops.length).toBe(0); // Gap detected, no ops returned
    });

    it('should NOT detect gap when own client uploads snapshot (with excludeClient)', async () => {
      // This test verifies false positive prevention using clientId-based detection.
      // Scenario:
      // 1. Client A uploads a snapshot: syncVersion=1, recentOps=[], clientId=client-a
      // 2. Client A immediately downloads with excludeClient='client-a'
      // Expected: Should NOT detect gap because snapshot.clientId === excludeClient

      // Step 1: Upload snapshot as client-a
      const snapshotData = createMockSyncData({
        syncVersion: 1,
        clientId: 'client-a',
        recentOps: [],
        state: { tasks: [] },
      });

      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(snapshotData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-2' }));

      await adapter.uploadSnapshot(
        {},
        'client-a',
        'initial',
        { client_a: 1 },
        1,
        undefined,
        'test-op-id-snapshot',
      );

      const seqAfterUpload = await adapter.getLastServerSeq();
      expect(seqAfterUpload).toBe(1);

      // Step 2: Download with excludeClient='client-a' (same client that uploaded)
      const result = await adapter.downloadOps(1, 'client-a');

      // Should NOT detect gap because:
      // - syncData.clientId ('client-a') === excludeClient ('client-a')
      // - This means we just uploaded, so no gap
      expect(result.gapDetected).toBe(false);
      expect(result.snapshotState).toBeUndefined(); // No snapshot state when sinceSeq > 0
    });
  });

  describe('state migration from legacy localStorage keys', () => {
    // These tests create the adapter AFTER setting localStorage, so they need
    // their own setup that bypasses the beforeEach adapter creation.

    it('should migrate from old separate keys to atomic format', async () => {
      const oldVersions = { [SyncProviderId.WebDAV]: 5 };
      const oldSeqCounters = { [SyncProviderId.WebDAV]: 3 };

      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
        JSON.stringify(oldVersions),
      );
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
        JSON.stringify(oldSeqCounters),
      );

      // Create a fresh service instance that will pick up legacy keys
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          FileBasedSyncAdapterService,
          { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
          { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        ],
      });
      const freshService = TestBed.inject(FileBasedSyncAdapterService);
      const freshAdapter = freshService.createAdapter(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      // Verify migrated state works correctly
      const seq = await freshAdapter.getLastServerSeq();
      expect(seq).toBe(3);

      // Verify old keys are removed
      expect(
        localStorage.getItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
        ),
      ).toBeNull();
      expect(
        localStorage.getItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
        ),
      ).toBeNull();

      // Verify atomic key is written
      const atomicState = JSON.parse(
        localStorage.getItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'state',
        )!,
      );
      expect(atomicState.syncVersions[SyncProviderId.WebDAV]).toBe(5);
      expect(atomicState.seqCounters[SyncProviderId.WebDAV]).toBe(3);
    });

    it('should clean up orphaned processedOps key during migration', async () => {
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
        JSON.stringify({ [SyncProviderId.WebDAV]: 1 }),
      );
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
        JSON.stringify({ someOp: true }),
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          FileBasedSyncAdapterService,
          { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
          { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        ],
      });
      const freshService = TestBed.inject(FileBasedSyncAdapterService);
      freshService.createAdapter(mockProvider, mockCfg, mockEncryptKey);

      // Verify processedOps key is removed
      expect(
        localStorage.getItem(
          FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
        ),
      ).toBeNull();
    });

    it('should handle missing old keys gracefully (fresh install)', async () => {
      // Ensure NO localStorage keys at all
      localStorage.removeItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
      );
      localStorage.removeItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
      );
      localStorage.removeItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'state',
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          FileBasedSyncAdapterService,
          { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
          { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        ],
      });
      const freshService = TestBed.inject(FileBasedSyncAdapterService);
      const freshAdapter = freshService.createAdapter(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      // Should start with empty state and no errors
      const seq = await freshAdapter.getLastServerSeq();
      expect(seq).toBe(0);
    });

    it('should prefer atomic key over old separate keys', async () => {
      // Set both atomic and old keys with different values
      const atomicState = {
        syncVersions: { [SyncProviderId.WebDAV]: 10 },
        seqCounters: { [SyncProviderId.WebDAV]: 8 },
      };
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'state',
        JSON.stringify(atomicState),
      );
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'versions',
        JSON.stringify({ [SyncProviderId.WebDAV]: 2 }),
      );
      localStorage.setItem(
        FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'seqCounters',
        JSON.stringify({ [SyncProviderId.WebDAV]: 1 }),
      );

      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          FileBasedSyncAdapterService,
          { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
          { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        ],
      });
      const freshService = TestBed.inject(FileBasedSyncAdapterService);
      const freshAdapter = freshService.createAdapter(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      // Should use atomic key value (8), not old key value (1)
      const seq = await freshAdapter.getLastServerSeq();
      expect(seq).toBe(8);
    });
  });

  describe('partial-trimming gap detection (syncVersion-based)', () => {
    it('should detect gap when oldestOpSyncVersion > sinceSeq and recentOps is full', async () => {
      // Client last downloaded at sinceSeq=1, but the oldest surviving op was uploaded at sv=5
      // AND the buffer is full → trimming happened → gap
      const maxOps = FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;
      const fullOps = Array.from({ length: maxOps }, (_, i) => ({
        id: `op-${i}`,
        c: 'other-client',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { otherClient: i + 1 },
        t: Date.now() + i,
        s: 1,
        p: {},
        sv: 5 + Math.floor(i / 10), // oldest sv=5
      }));

      const data = createMockSyncData({
        syncVersion: 60,
        recentOps: fullOps,
        oldestOpSyncVersion: 5,
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(1); // sinceSeq=1 < oldestOpSyncVersion=5
      expect(result.gapDetected).toBe(true);
    });

    it('should NOT detect gap when oldestOpSyncVersion <= sinceSeq', async () => {
      const maxOps = FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;
      const fullOps = Array.from({ length: maxOps }, (_, i) => ({
        id: `op-${i}`,
        c: 'other-client',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { otherClient: i + 1 },
        t: Date.now() + i,
        s: 1,
        p: {},
        sv: 1 + Math.floor(i / 10),
      }));

      const data = createMockSyncData({
        syncVersion: 60,
        recentOps: fullOps,
        oldestOpSyncVersion: 1, // oldest sv=1 <= sinceSeq=5
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(5); // sinceSeq=5 >= oldestOpSyncVersion=1
      expect(result.gapDetected).toBeFalsy();
    });

    it('should NOT detect gap when recentOps < MAX_RECENT_OPS (not trimmed)', async () => {
      // Even if oldestOpSyncVersion > sinceSeq, buffer not full → no trimming → no gap
      const data = createMockSyncData({
        syncVersion: 10,
        recentOps: [
          {
            id: 'op-1',
            c: 'other-client',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-1',
            v: { otherClient: 1 },
            t: Date.now(),
            s: 1,
            p: {},
            sv: 5,
          },
        ],
        oldestOpSyncVersion: 5,
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(1); // sinceSeq=1 < sv=5, but not full
      expect(result.gapDetected).toBeFalsy();
    });

    it('should NOT detect gap when oldestOpSyncVersion is undefined (backward compat)', async () => {
      // Old sync file without sv on ops → oldestOpSyncVersion is undefined
      const maxOps = FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;
      const fullOps = Array.from({ length: maxOps }, (_, i) => ({
        id: `op-${i}`,
        c: 'other-client',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { otherClient: i + 1 },
        t: Date.now() + i,
        s: 1,
        p: {},
        // no sv field — old format
      }));

      const data = createMockSyncData({
        syncVersion: 10,
        recentOps: fullOps,
        // oldestOpSyncVersion intentionally omitted (undefined)
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(1);
      expect(result.gapDetected).toBeFalsy();
    });

    it('should NOT detect gap when sinceSeq is 0 (fresh download)', async () => {
      // sinceSeq=0 guard prevents false positives on first sync
      const maxOps = FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;
      const fullOps = Array.from({ length: maxOps }, (_, i) => ({
        id: `op-${i}`,
        c: 'other-client',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { otherClient: i + 1 },
        t: Date.now() + i,
        s: 1,
        p: {},
        sv: 5,
      }));

      const data = createMockSyncData({
        syncVersion: 60,
        recentOps: fullOps,
        oldestOpSyncVersion: 5,
        state: { tasks: [] },
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(0); // sinceSeq=0
      // gapDetected should be false — sinceSeq > 0 guard
      expect(result.gapDetected).toBeFalsy();
    });

    it('should detect gap when mixed old/new ops and oldestOpSyncVersion > sinceSeq', async () => {
      // First op has sv=undefined (old), second has sv=3 — oldestOpSyncVersion from first = undefined
      // This tests backward compat: if head op lacks sv, gap detection is disabled
      const maxOps = FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS;
      const mixedOps = Array.from({ length: maxOps }, (_, i) => ({
        id: `op-${i}`,
        c: 'other-client',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i}`,
        v: { otherClient: i + 1 },
        t: Date.now() + i,
        s: 1,
        p: {},
        ...(i > 0 ? { sv: 3 + Math.floor(i / 10) } : {}), // first op has no sv
      }));

      const data = createMockSyncData({
        syncVersion: 60,
        recentOps: mixedOps,
        oldestOpSyncVersion: undefined, // first op has no sv
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(1);
      // Gap detection disabled because oldestOpSyncVersion is undefined
      expect(result.gapDetected).toBeFalsy();
    });

    it('should include oldestOpSyncVersion and sv in uploaded sync data', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      let uploadedDataStr: string = '';
      mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
        uploadedDataStr = dataStr;
        return Promise.resolve({ rev: 'rev-1' });
      });

      const op1 = createMockSyncOp({ id: 'op-1' });
      const op2 = createMockSyncOp({ id: 'op-2' });

      await adapter.uploadOps([op1, op2], 'client1');

      const uploadedData = parseWithPrefix(uploadedDataStr);
      // Both ops should have sv=1 (first upload, syncVersion=0+1)
      expect(uploadedData.recentOps[0].sv).toBe(1);
      expect(uploadedData.recentOps[1].sv).toBe(1);
      // oldestOpSyncVersion should be sv of first op = 1
      expect(uploadedData.oldestOpSyncVersion).toBe(1);
    });
  });
});
