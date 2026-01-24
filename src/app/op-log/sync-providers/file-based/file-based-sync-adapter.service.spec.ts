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
  });

  beforeEach(() => {
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
      FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'processedOps',
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

    it('should handle version mismatch gracefully with piggybacking', async () => {
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
      const otherClientOp = createMockSyncOp({
        id: 'other-op',
        clientId: 'other-client',
      });
      const syncDataV3 = createMockSyncData({
        syncVersion: 3,
        recentOps: [otherClientOp].map((op) => ({
          id: op.id,
          c: op.clientId,
          a: op.actionType,
          o: 'CREATE',
          e: 'Task',
          ei: op.entityId || 'entity1',
          p: op.payload,
          v: op.vectorClock,
          t: op.timestamp,
          s: op.schemaVersion || 1,
        })),
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncDataV3), rev: 'rev-3' }),
      );

      // Our next upload should succeed and return piggybacked ops
      const op2 = createMockSyncOp({ id: 'op-456' });
      const result = await adapter.uploadOps([op2], 'client1');

      // Should succeed (not throw)
      expect(result.results.length).toBe(1);
      expect(result.results[0].accepted).toBe(true);

      // Should return the other client's op as piggybacked
      expect(result.newOps?.length).toBe(1);
      expect(result.newOps![0].op.id).toBe('other-op');
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
    it('should create new sync file with state', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      let uploadedDataStr: string = '';
      mockProvider.uploadFile.and.callFake((_path: string, dataStr: string) => {
        uploadedDataStr = dataStr;
        return Promise.resolve({ rev: 'rev-1' });
      });

      const state = { tasks: [{ id: 't1', title: 'Test' }] };
      const vectorClock = { client1: 5 };

      const result = await adapter.uploadSnapshot(
        state,
        'client1',
        'initial',
        vectorClock,
        2,
        undefined, // isPayloadEncrypted
        'test-op-id-1', // opId
      );

      expect(result.accepted).toBe(true);
      const uploadedData = parseWithPrefix(uploadedDataStr);
      expect(uploadedData.state).toEqual(state);
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
      mockProvider.removeFile.and.throwError(new Error('File not found'));

      const result = await adapter.deleteAllData();

      expect(result.success).toBe(true);
    });

    it('should reset local state after delete', async () => {
      mockProvider.removeFile.and.returnValue(Promise.resolve());

      // Set some state first
      await adapter.setLastServerSeq(50);

      await adapter.deleteAllData();

      const seq = await adapter.getLastServerSeq();
      expect(seq).toBe(0);
    });
  });

  describe('getCurrentSyncData', () => {
    it('should return sync data when file exists', async () => {
      const syncData = createMockSyncData();
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await service.getCurrentSyncData(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      expect(result).toBeDefined();
      expect(result?.version).toBe(2);
    });

    it('should return null when no file exists', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );

      const result = await service.getCurrentSyncData(
        mockProvider,
        mockCfg,
        mockEncryptKey,
      );

      expect(result).toBeNull();
    });
  });

  describe('wouldConflict', () => {
    it('should return true when versions differ', () => {
      // No expected version set yet (0)
      expect(service.wouldConflict('test-key', 5)).toBe(true);
    });

    it('should return false when versions match', async () => {
      // Set expected version by downloading
      const syncData = createMockSyncData({ syncVersion: 3 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      await adapter.downloadOps(0);

      const key = mockProvider.id;
      expect(service.wouldConflict(key, 3)).toBe(false);
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
      it('should write archive to IndexedDB on first download (sinceSeq=0)', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
          archiveOld: mockArchiveOld,
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(0);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          mockArchiveYoung,
        );
        expect(mockArchiveDbAdapter.saveArchiveOld).toHaveBeenCalledWith(mockArchiveOld);
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
        const syncData = createMockSyncData();
        delete (syncData as any).archiveYoung;
        delete (syncData as any).archiveOld;

        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(0);

        // Should not attempt to save undefined archive
        expect(mockArchiveDbAdapter.saveArchiveYoung).not.toHaveBeenCalled();
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
      });

      it('should handle partial archive (only archiveYoung)', async () => {
        const syncData = createMockSyncData({
          archiveYoung: mockArchiveYoung,
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        );

        await adapter.downloadOps(0);

        expect(mockArchiveDbAdapter.saveArchiveYoung).toHaveBeenCalledWith(
          mockArchiveYoung,
        );
        expect(mockArchiveDbAdapter.saveArchiveOld).not.toHaveBeenCalled();
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
});
