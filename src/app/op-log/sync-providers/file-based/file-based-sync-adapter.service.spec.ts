import { TestBed } from '@angular/core/testing';
import { FileBasedSyncAdapterService } from './file-based-sync-adapter.service';
import { SyncProviderId } from '../provider.const';
import {
  FileSyncProvider,
  OperationSyncCapable,
  SyncOperation,
} from '../provider.interface';
import {
  FILE_BASED_SYNC_CONSTANTS,
  FileBasedSyncData,
  FileBasedOpsFile,
  FileBasedStateFile,
} from './file-based-sync.types';
import {
  EncryptNoPasswordError,
  InvalidDataSPError,
  RemoteFileNotFoundAPIError,
  SplitSyncFormatDetectedError,
  SyncDataCorruptedError,
  UploadRevToMatchMismatchAPIError,
} from '../../core/errors/sync-errors';
import { GlobalConfigService } from '../../../features/config/global-config.service';
import { T } from '../../../t.const';
import { EncryptAndCompressCfg } from '../../core/types/sync.types';
import { getSyncFilePrefix } from '../../util/sync-file-prefix';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { ArchiveModel } from '../../../features/time-tracking/time-tracking.model';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { DEFAULT_GLOBAL_CONFIG } from '../../../features/config/default-global-config.const';
import { SnackService } from '../../../core/snack/snack.service';

describe('FileBasedSyncAdapterService', () => {
  let service: FileBasedSyncAdapterService;
  let mockProvider: jasmine.SpyObj<FileSyncProvider<SyncProviderId>>;
  let mockArchiveDbAdapter: jasmine.SpyObj<ArchiveDbAdapter>;
  let mockStateSnapshotService: jasmine.SpyObj<StateSnapshotService>;
  let mockSnackService: jasmine.SpyObj<SnackService>;
  let adapter: OperationSyncCapable;
  // SPAP-11: toggles the opt-in split-file ("Surgical sync") setting for the
  // adapter under test. Default OFF so every existing test runs the single-file
  // path unchanged; split tests flip it ON.
  let splitSyncEnabled = false;

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
      globalConfig: {
        ...DEFAULT_GLOBAL_CONFIG,
        sync: {
          ...DEFAULT_GLOBAL_CONFIG.sync,
          syncProvider: SyncProviderId.WebDAV,
          syncInterval: 300000,
          isManualSyncOnly: true,
          isCompressionEnabled: true,
        },
      },
    } as any);

    mockSnackService = jasmine.createSpyObj('SnackService', ['open']);

    // SPAP-11: default OFF each test. The adapter reads this lazily via the
    // injector (GlobalConfigService.sync().isUseSplitSyncFiles).
    splitSyncEnabled = false;
    const fakeGlobalConfigService = {
      sync: () => ({ isUseSplitSyncFiles: splitSyncEnabled }),
    } as unknown as GlobalConfigService;

    TestBed.configureTestingModule({
      providers: [
        FileBasedSyncAdapterService,
        { provide: ArchiveDbAdapter, useValue: mockArchiveDbAdapter },
        { provide: StateSnapshotService, useValue: mockStateSnapshotService },
        { provide: SnackService, useValue: mockSnackService },
        { provide: GlobalConfigService, useValue: fakeGlobalConfigService },
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
    // Default: no legacy __meta_ file present → treat missing sync-data.json as fresh start
    mockProvider.getFileRev.and.callFake(async (_path: string) => {
      throw new RemoteFileNotFoundAPIError('not found');
    });

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

    it('should throw UploadRevToMatchMismatchAPIError on genuine concurrent upload (rev changed)', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      // Initial download: rev-1
      mockProvider.downloadFile.and.returnValues(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
        // Re-download after mismatch returns rev-2 (another client uploaded for real)
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-2' }),
      );
      // All upload attempts fail with rev mismatch
      mockProvider.uploadFile.and.returnValue(
        Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch')),
      );

      await adapter.downloadOps(0);

      const op = createMockSyncOp();
      // Genuine mismatch: adapter throws so next sync cycle can fix the snapshot
      await expectAsync(adapter.uploadOps([op], 'client1')).toBeRejectedWithError(
        UploadRevToMatchMismatchAPIError,
      );

      // Only one CONDITIONAL attempt on the MAIN sync file (no retry loop), and it
      // must never force-overwrite. A separate .bak backup write is allowed.
      const mainUploads = mockProvider.uploadFile.calls
        .allArgs()
        .filter((args) => args[0] === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
      expect(mainUploads.length).toBe(1);
      expect(mainUploads.every((args) => args[3] === false)).toBe(true);
      // Download called twice: initial cache + re-download to check rev
      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(2);
    });

    it('retries CONDITIONALLY (never force) when freshRev equals original revToMatch (SPAP-8)', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      // Every download returns the same rev-1 → server rev inconsistency, NOT a real
      // concurrent upload. The old code force-overwrote here; the new code must retry
      // the conditional upload and NEVER pass isForceOverwrite=true.
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const mainUploadForceFlags: (boolean | undefined)[] = [];
      let mainUploadAttempts = 0;
      mockProvider.uploadFile.and.callFake(
        (path: string, _dataStr: string, _rev: string | null, force?: boolean) => {
          if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
            // Non-fatal backup write — irrelevant to the force assertion.
            return Promise.resolve({ rev: 'bak-1' });
          }
          mainUploadAttempts++;
          mainUploadForceFlags.push(force);
          if (mainUploadAttempts === 1) {
            // First conditional attempt hits a spurious rev mismatch.
            return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
          }
          return Promise.resolve({ rev: 'rev-2' });
        },
      );

      // Download to populate cache with rev-1
      await adapter.downloadOps(0);

      const op = createMockSyncOp();
      const result = await adapter.uploadOps([op], 'client1');

      expect(result.results[0].accepted).toBe(true);
      // Two attempts on the main file: initial + one conditional retry.
      expect(mainUploadAttempts).toBe(2);
      // CRUCIAL (SPAP-8): no attempt on the main sync file used force-overwrite.
      expect(mainUploadForceFlags.every((f) => f === false)).toBe(true);
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

  // GHSA-9544-hjjr-fg8h: encryption enabled but key missing (silently dropped
  // credentials). Every upload path must refuse to transmit plaintext — the
  // leak scenario is an absent remote file, where no decrypt error trips first.
  describe('encryption enabled but key missing', () => {
    let encryptedAdapter: OperationSyncCapable;

    beforeEach(() => {
      encryptedAdapter = service.createAdapter(
        mockProvider,
        { isEncrypt: true, isCompress: false },
        undefined,
      );
      // Fresh remote — the advisory's exposure scenario
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
    });

    it('should reject uploadOps and never upload plaintext', async () => {
      const op = createMockSyncOp();

      await expectAsync(
        encryptedAdapter.uploadOps([op], 'client1'),
      ).toBeRejectedWithError(EncryptNoPasswordError);
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should reject the no-ops initial file creation and never upload plaintext', async () => {
      await expectAsync(encryptedAdapter.uploadOps([], 'client1')).toBeRejectedWithError(
        EncryptNoPasswordError,
      );
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should reject uploadSnapshot and never upload plaintext', async () => {
      await expectAsync(
        encryptedAdapter.uploadSnapshot(
          { tasks: [] },
          'client1',
          'recovery',
          { client1: 1 },
          1,
          true,
          'op-id-1',
        ),
      ).toBeRejectedWithError(EncryptNoPasswordError);
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('should report enabled + key-missing via the upload-guard hooks', async () => {
      expect(await encryptedAdapter.isEncryptionEnabled!()).toBe(true);
      expect(await encryptedAdapter.isEncryptionKeyMissing!()).toBe(true);
    });
  });

  describe('encryption enabled with a key present', () => {
    it('should report enabled and key NOT missing (no false block)', async () => {
      const keyedAdapter = service.createAdapter(
        mockProvider,
        { isEncrypt: true, isCompress: false },
        'a-key',
      );
      expect(await keyedAdapter.isEncryptionEnabled!()).toBe(true);
      expect(await keyedAdapter.isEncryptionKeyMissing!()).toBe(false);
    });
  });

  describe('encryption disabled (plaintext)', () => {
    it('should report disabled and key not missing', async () => {
      // The default `adapter` (outer beforeEach) is created with isEncrypt=false.
      expect(await adapter.isEncryptionEnabled!()).toBe(false);
      expect(await adapter.isEncryptionKeyMissing!()).toBe(false);
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

    // File-based providers have no server-side cursor (they re-download the whole
    // file each call and ignore sinceSeq), so a caller-supplied `limit` below the
    // buffer size must NOT truncate — otherwise the caller loops on hasMore and can
    // never advance past the oldest slice, stranding a behind client short of its
    // newest ops. The buffer is bounded by MAX_RECENT_OPS, so the whole buffer is
    // returned in a single page (hasMore=false).
    it('returns the whole buffer in one page even when limit is below buffer size', async () => {
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

      // All 10 ops returned in one page despite limit=5; no second page needed.
      expect(result.ops.length).toBe(10);
      expect(result.hasMore).toBe(false);
    });

    // Regression: a buffer larger than the real DOWNLOAD_PAGE_SIZE must still
    // deliver the NEWEST ops. Previously the download returned only the oldest
    // `limit` ops and set hasMore=true, so the caller (which advances sinceSeq by
    // the returned index-based serverSeq while this method ignores sinceSeq) kept
    // re-fetching the same oldest slice and never received op-600.
    it('delivers the newest ops when the buffer exceeds the page size (single-file)', async () => {
      const PAGE = 500;
      const total = 600;
      const manyOps = Array.from({ length: total }, (_, i) => ({
        id: `op-${i + 1}`,
        c: 'client1',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: `task-${i + 1}`,
        v: { client1: i + 1 },
        t: Date.now(),
        s: 1,
        p: {},
      }));
      const syncData = createMockSyncData({ syncVersion: total, recentOps: manyOps });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(1, 'client2', PAGE);

      expect(result.ops.length).toBe(total);
      expect(result.hasMore).toBe(false);
      expect(result.ops.some((o) => o.op.id === 'op-600')).toBe(true);
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
      expect(uploadedData.state).toEqual(
        jasmine.objectContaining({ tasks: [], projects: [] }) as any,
      );
      const uploadedState = uploadedData.state as Record<string, unknown>;
      const globalConfig = uploadedState['globalConfig'] as Record<string, unknown>;
      const sync = globalConfig['sync'] as Record<string, unknown>;
      expect(sync['syncProvider']).toBeNull();
      expect(sync['syncInterval']).toBeUndefined();
      expect(sync['isManualSyncOnly']).toBeUndefined();
      expect(sync['isCompressionEnabled']).toBe(true);
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

      it('flags a gap when a dominating-clock reset compacted ops the client had not yet seen', async () => {
        // Review follow-up (SPAP-9): a syncVersion regression whose remote clock is
        // only GREATER_THAN last-seen must NOT be treated as cosmetic. GREATER_THAN
        // proves the writer did more work, not that this client received it.

        // First download: client syncs up to syncVersion 5, last-seen {client1:5}.
        const compactOp = (
          id: string,
          v: number,
        ): FileBasedSyncData['recentOps'][number] => ({
          id,
          c: 'client1',
          a: 'HA',
          o: 'ADD',
          e: 'TASK',
          d: id,
          v: { client1: v },
          t: Date.now(),
          s: 1,
          p: {},
        });
        const first = createMockSyncData({
          syncVersion: 5,
          vectorClock: { client1: 5 },
          recentOps: [compactOp('op-5', 5)],
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(first), rev: 'rev-1' }),
        );
        await adapter.downloadOps(1);

        // Writer made ops 6..10 (client never saw them), took a snapshot compacting
        // 1..10 into `state` and reset recentOps, then made op 11. The file's clock
        // {client1:11} is GREATER_THAN last-seen {client1:5}, but ops 6..10 survive
        // only inside `state` — they are NOT in recentOps.
        const second = createMockSyncData({
          syncVersion: 2, // reset to 1 by snapshot, +1 for op 11
          vectorClock: { client1: 11 }, // GREATER_THAN {client1:5}
          recentOps: [compactOp('op-11', 11)],
          oldestOpSyncVersion: 2,
          state: { tasks: [] },
        });
        mockProvider.downloadFile.and.returnValue(
          Promise.resolve({ dataStr: addPrefix(second), rev: 'rev-2' }),
        );

        const result = await adapter.downloadOps(5); // client's real cursor is 5
        // The compacted ops 6..10 would be lost without a full seq-0 resync, so the
        // regression must be reported as a gap (was false under the EQUAL||GREATER_THAN
        // suppression).
        expect(result.gapDetected).toBe(true);
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
        const uploadedState = uploadedData.state as Record<string, unknown>;
        const globalConfig = uploadedState['globalConfig'] as Record<string, unknown>;
        const sync = globalConfig['sync'] as Record<string, unknown>;
        expect(sync['syncProvider']).toBeNull();
        expect(sync['syncInterval']).toBeUndefined();
        expect(sync['isManualSyncOnly']).toBeUndefined();
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

    it('should NOT detect gap at the boundary sinceSeq === oldestOpSyncVersion - 1 (SPAP-9 off-by-one)', async () => {
      // Boundary: the oldest surviving op has sv = sinceSeq + 1. The client
      // already has everything up to sinceSeq, and the very next op it needs
      // (sinceSeq + 1) is present — nothing was trimmed out from under it, so
      // this must NOT be treated as a gap. The old `> sinceSeq` test flagged it.
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
        sv: 6 + Math.floor(i / 10), // oldest sv=6
      }));

      const data = createMockSyncData({
        syncVersion: 60,
        recentOps: fullOps,
        oldestOpSyncVersion: 6,
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(5); // sinceSeq=5, oldest=6 → contiguous
      expect(result.gapDetected).toBeFalsy();
    });

    it('should still detect gap when oldestOpSyncVersion > sinceSeq + 1 (ops actually trimmed)', async () => {
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
        sv: 7 + Math.floor(i / 10), // oldest sv=7
      }));

      const data = createMockSyncData({
        syncVersion: 60,
        recentOps: fullOps,
        oldestOpSyncVersion: 7,
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(data), rev: 'rev-1' }),
      );

      const result = await adapter.downloadOps(5); // sinceSeq=5, oldest=7 → op 6 missing
      expect(result.gapDetected).toBe(true);
    });

    // SPAP-33: a gap is proven by oldestOpSyncVersion > sinceSeq+1 alone — the
    // buffer does NOT have to be full. Here the client is at sinceSeq=1 while the
    // oldest retained op is sv=5, so the ops at sv 2..4 (which provably existed —
    // syncVersion reached 10) were trimmed away. The client must fall back to the
    // snapshot; suppressing the gap just because recentOps is short (as the old
    // `recentOps.length >= MAX_RECENT_OPS` clause did) would silently diverge.
    it('detects gap when oldestOpSyncVersion > sinceSeq+1 even if recentOps is short (SPAP-33)', async () => {
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

      const result = await adapter.downloadOps(1); // sinceSeq=1, oldest=5 → sv 2..4 trimmed
      expect(result.gapDetected).toBe(true);
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

    it('should disable gap detection when the oldest op has no sync version', async () => {
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

  describe('benign syncVersion reset gating (SPAP-9)', () => {
    const opAt = (sv: number): FileBasedSyncData['recentOps'][number] => ({
      id: `op-${sv}`,
      c: 'client1',
      a: 'HA',
      o: 'ADD',
      e: 'TASK',
      d: `task-${sv}`,
      v: { client1: sv },
      t: Date.now(),
      s: 1,
      p: {},
      sv,
    });

    it('does NOT flag a gap when syncVersion regresses but the vector clock is unchanged (cosmetic reset)', async () => {
      // First download establishes the expected syncVersion (5) and the last-seen
      // vector clock ({client1:5}).
      const first = createMockSyncData({
        syncVersion: 5,
        vectorClock: { client1: 5 },
        recentOps: [opAt(5)],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(first), rev: 'rev-1' }),
      );
      await adapter.downloadOps(1);

      // Second download: syncVersion regressed 5 -> 2 (would normally look like a
      // reset), but the causal vector clock is IDENTICAL, so nothing was actually
      // lost. Must NOT trigger the full-gap resync path.
      const second = createMockSyncData({
        syncVersion: 2,
        vectorClock: { client1: 5 },
        recentOps: [opAt(5)],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(second), rev: 'rev-2' }),
      );
      const result = await adapter.downloadOps(1);
      expect(result.gapDetected).toBeFalsy();
    });

    it('flags a gap when the reset clock strictly dominates the last-seen clock (GREATER_THAN is not proof the ops were received)', async () => {
      // Review follow-up: a strictly-dominating (GREATER_THAN) remote clock is NOT
      // treated as cosmetic. It only proves the writer did more work, not that this
      // client received the intervening ops — a snapshot can compact ops we never
      // saw — so the regression must conservatively trigger a seq-0 resync.
      const first = createMockSyncData({
        syncVersion: 5,
        vectorClock: { client1: 5 },
        recentOps: [opAt(5)],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(first), rev: 'rev-1' }),
      );
      await adapter.downloadOps(1);

      const second = createMockSyncData({
        syncVersion: 2,
        vectorClock: { client1: 6 }, // GREATER_THAN last-seen — remote strictly ahead
        recentOps: [opAt(6)],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(second), rev: 'rev-2' }),
      );
      const result = await adapter.downloadOps(1);
      expect(result.gapDetected).toBeTruthy();
    });

    it('STILL flags a gap when the reset clock is causally behind / concurrent (genuine reset)', async () => {
      const first = createMockSyncData({
        syncVersion: 5,
        vectorClock: { client1: 5 },
        recentOps: [opAt(5)],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(first), rev: 'rev-1' }),
      );
      await adapter.downloadOps(1);

      const second = createMockSyncData({
        syncVersion: 2,
        vectorClock: { client1: 3 }, // LESS_THAN last-seen — remote regressed
        recentOps: [opAt(3)],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(second), rev: 'rev-2' }),
      );
      const result = await adapter.downloadOps(1);
      expect(result.gapDetected).toBe(true);
    });
  });

  describe('legacy pfapi format detection (v16.x cross-version guard)', () => {
    it('throws LegacySyncFormatDetectedError when __meta_ exists but sync-data.json does not', async () => {
      // Simulate a v16.x provider: __meta_ present, sync-data.json absent
      mockProvider.downloadFile.and.rejectWith(
        new RemoteFileNotFoundAPIError('not found'),
      );
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.LEGACY_META_FILE)
          return { rev: 'rev-meta' };
        throw new RemoteFileNotFoundAPIError('not found');
      });

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWithError(
        /Sync format mismatch/,
      );
    });

    it('throws LegacySyncFormatDetectedError when __meta_ exists but is unreadable (WebDAV corrupt body)', async () => {
      // Simulate a WebDAV provider with a present-but-corrupt legacy file:
      // downloadFile throws InvalidDataSPError for the legacy probe, but
      // the file exists → still proves v16.x touched this target.
      mockProvider.downloadFile.and.rejectWith(
        new RemoteFileNotFoundAPIError('not found'),
      );
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.LEGACY_META_FILE)
          throw new InvalidDataSPError('empty body', path);
        throw new RemoteFileNotFoundAPIError('not found');
      });

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWithError(
        /Sync format mismatch/,
      );
    });

    it('treats missing __meta_ as a genuine fresh start (not an error)', async () => {
      // Both sync-data.json and __meta_ absent → fresh install
      mockProvider.downloadFile.and.callFake(async (_path: string) => {
        throw new RemoteFileNotFoundAPIError('not found');
      });
      mockProvider.getFileRev.and.callFake(async (_path: string) => {
        throw new RemoteFileNotFoundAPIError('not found');
      });
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      const result = await adapter.downloadOps(0);
      expect(result.ops).toEqual([]);
    });
  });

  describe('atomic remote writes (SPAP-8)', () => {
    const compactOp = (id: string, client = 'client1'): Record<string, unknown> => ({
      id,
      c: client,
      a: 'HA',
      o: 'ADD',
      e: 'TASK',
      d: `task-${id}`,
      v: { [client]: 1 },
      t: Date.now(),
      s: 1,
      p: { title: `Task ${id}` },
    });

    it('(a) writes .bak with the PREVIOUS remote content before overwriting sync-data.json', async () => {
      const prevData = createMockSyncData({
        syncVersion: 3,
        clientId: 'prev-client',
        recentOps: [compactOp('prev-op') as never],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(prevData), rev: 'rev-1' }),
      );

      const uploadOrder: string[] = [];
      let backupDataStr = '';
      mockProvider.uploadFile.and.callFake((path: string, dataStr: string) => {
        uploadOrder.push(path);
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          backupDataStr = dataStr;
        }
        return Promise.resolve({ rev: 'rev-2' });
      });

      // Populate the sync-cycle cache (mirrors a real download→upload cycle).
      await adapter.downloadOps(0);

      const op = createMockSyncOp();
      await adapter.uploadOps([op], 'client1');

      const bakIdx = uploadOrder.indexOf(FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE);
      const mainIdx = uploadOrder.indexOf(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
      // Backup must exist AND be written strictly before the main overwrite.
      expect(bakIdx).toBeGreaterThanOrEqual(0);
      expect(mainIdx).toBeGreaterThanOrEqual(0);
      expect(bakIdx).toBeLessThan(mainIdx);

      // The backup must contain the PREVIOUS remote content, not the new upload.
      const bak = parseWithPrefix(backupDataStr);
      expect(bak.syncVersion).toBe(3);
      expect(bak.clientId).toBe('prev-client');
      expect(bak.recentOps[0].id).toBe('prev-op');
    });

    it('(a) does NOT write a backup on first sync when no remote file exists yet', async () => {
      mockProvider.downloadFile.and.throwError(
        new RemoteFileNotFoundAPIError('sync-data.json'),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-1' }));

      await adapter.uploadOps([createMockSyncOp()], 'client1');

      expect(mockProvider.uploadFile).not.toHaveBeenCalledWith(
        FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE,
        jasmine.any(String),
        jasmine.anything(),
        jasmine.anything(),
      );
    });

    it('(a) backup-write failure is non-fatal — the main upload still succeeds', async () => {
      const prevData = createMockSyncData({ syncVersion: 2 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(prevData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          // Provider without copy support / transient failure on the backup.
          return Promise.reject(new Error('backup not supported'));
        }
        return Promise.resolve({ rev: 'rev-2' });
      });

      await adapter.downloadOps(0);

      const result = await adapter.uploadOps([createMockSyncOp()], 'client1');
      expect(result.results[0].accepted).toBe(true);
    });

    it('(b) recovers from .bak when the main file is corrupt and surfaces a recovery snack', async () => {
      const backupData = createMockSyncData({
        syncVersion: 2,
        recentOps: [compactOp('recovered-op') as never],
      });
      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          return Promise.resolve({ dataStr: addPrefix(backupData), rev: 'bak-rev-1' });
        }
        return Promise.reject(
          new SyncDataCorruptedError('corrupt', FILE_BASED_SYNC_CONSTANTS.SYNC_FILE),
        );
      });

      const result = await adapter.downloadOps(0);

      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.id).toBe('recovered-op');
      expect(result.latestSeq).toBe(2);
      // User-visible recovery notice.
      expect(mockSnackService.open).toHaveBeenCalled();
    });

    it('(b) recovers from .bak when the main file is empty (InvalidDataSPError)', async () => {
      const backupData = createMockSyncData({
        syncVersion: 4,
        recentOps: [compactOp('from-empty-recovery') as never],
      });
      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          return Promise.resolve({ dataStr: addPrefix(backupData), rev: 'bak-rev-2' });
        }
        return Promise.reject(
          new InvalidDataSPError('empty body', FILE_BASED_SYNC_CONSTANTS.SYNC_FILE),
        );
      });

      const result = await adapter.downloadOps(0);

      expect(result.ops.length).toBe(1);
      expect(result.latestSeq).toBe(4);
      expect(mockSnackService.open).toHaveBeenCalled();
    });

    it('(b) rethrows the original corruption error when no usable backup exists', async () => {
      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          return Promise.reject(new RemoteFileNotFoundAPIError('no backup'));
        }
        return Promise.reject(
          new SyncDataCorruptedError('corrupt', FILE_BASED_SYNC_CONSTANTS.SYNC_FILE),
        );
      });

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWith(
        jasmine.any(SyncDataCorruptedError),
      );
      expect(mockSnackService.open).not.toHaveBeenCalled();
    });

    it('(b) recovers from .bak when the primary file fails to DECODE (real DecompressError, not an injected error)', async () => {
      // The tests above inject SyncDataCorruptedError/InvalidDataSPError directly.
      // This one drives a REAL decode failure end-to-end: the primary file's prefix
      // claims gzip compression but the body is not valid gzip, so the actual
      // decompressAndDecryptData path throws DecompressError. The encrypted-file
      // case (DecryptError) is symmetric. Without both in _isRecoverableCorruption,
      // recovery silently no-ops for users who enable compression or encryption.
      const backupData = createMockSyncData({
        syncVersion: 5,
        recentOps: [compactOp('recovered-from-decode-failure') as never],
      });
      const undecodableMain =
        getSyncFilePrefix({ isCompress: true, isEncrypt: false, modelVersion: 2 }) +
        'this-is-not-valid-gzip-base64';
      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          return Promise.resolve({
            dataStr: addPrefix(backupData),
            rev: 'bak-rev-decode',
          });
        }
        return Promise.resolve({ dataStr: undecodableMain, rev: 'corrupt-main-rev' });
      });

      const result = await adapter.downloadOps(0);

      expect(result.ops.length).toBe(1);
      expect(result.ops[0].op.id).toBe('recovered-from-decode-failure');
      expect(result.latestSeq).toBe(5);
      expect(mockSnackService.open).toHaveBeenCalled();
    });

    it('(b) after recovery, the next upload heals the corrupt primary via ITS rev (no revToMatch pollution)', async () => {
      // Regression for the self-perpetuating degraded state: recovery must seed the
      // cache with the CORRUPT PRIMARY rev, not the .bak rev, so the follow-up
      // conditional upload matches sync-data.json and overwrites (heals) it.
      const backupData = createMockSyncData({ syncVersion: 2 });
      const CORRUPT_MAIN_REV = 'corrupt-main-rev-42';
      const undecodableMain =
        getSyncFilePrefix({ isCompress: true, isEncrypt: false, modelVersion: 2 }) +
        'not-valid-gzip';
      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          return Promise.resolve({ dataStr: addPrefix(backupData), rev: 'bak-rev-heal' });
        }
        return Promise.resolve({ dataStr: undecodableMain, rev: CORRUPT_MAIN_REV });
      });

      const mainRevToMatch: (string | null)[] = [];
      mockProvider.uploadFile.and.callFake(
        (path: string, _dataStr: string, revToMatch: string | null) => {
          if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) {
            mainRevToMatch.push(revToMatch);
          }
          return Promise.resolve({ rev: 'healed-rev' });
        },
      );

      // Download recovers from .bak; a subsequent upload should heal the primary.
      await adapter.downloadOps(0);
      await adapter.uploadOps([createMockSyncOp()], 'client1');

      expect(mainRevToMatch).toContain(CORRUPT_MAIN_REV);
      expect(mainRevToMatch).not.toContain('bak-rev-heal');
    });

    it('(c) never issues isForceOverwrite=true on the rev-mismatch retry path', async () => {
      const syncData = createMockSyncData({ syncVersion: 1 });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      const mainForceFlags: (boolean | undefined)[] = [];
      let mainAttempts = 0;
      mockProvider.uploadFile.and.callFake(
        (path: string, _d: string, _r: string | null, force?: boolean) => {
          if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
            return Promise.resolve({ rev: 'bak-1' });
          }
          mainAttempts++;
          mainForceFlags.push(force);
          // Deterministic conditional rejection → exhausts retries → retryable throw.
          return Promise.reject(new UploadRevToMatchMismatchAPIError('Rev mismatch'));
        },
      );

      await adapter.downloadOps(0);

      await expectAsync(
        adapter.uploadOps([createMockSyncOp()], 'client1'),
      ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);

      // Multiple attempts occurred, but NOT ONE forced.
      expect(mainAttempts).toBeGreaterThan(1);
      expect(mainForceFlags.every((f) => f === false)).toBe(true);
    });

    it("(d) interleaved clients: client A's ops survive when B races; B fails retryably without forcing", async () => {
      // Honest rev model: the remote rev changes whenever its content changes.
      let remote = {
        dataStr: addPrefix(createMockSyncData({ syncVersion: 1, recentOps: [] })),
        rev: 'rev-1',
      };
      const aOp = compactOp('op-A', 'client-A');

      mockProvider.downloadFile.and.callFake((path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
          return Promise.reject(new RemoteFileNotFoundAPIError('no bak'));
        }
        return Promise.resolve({ dataStr: remote.dataStr, rev: remote.rev });
      });

      let sawForceOnMain = false;
      mockProvider.uploadFile.and.callFake(
        (path: string, dataStr: string, revToMatch: string | null, force?: boolean) => {
          if (path === FILE_BASED_SYNC_CONSTANTS.BACKUP_FILE) {
            return Promise.resolve({ rev: 'bak-1' });
          }
          if (force) {
            sawForceOnMain = true;
          }
          // Conditional upload: reject if the expected rev no longer matches remote.
          if (!force && revToMatch !== null && revToMatch !== remote.rev) {
            return Promise.reject(new UploadRevToMatchMismatchAPIError('rev changed'));
          }
          remote = { dataStr, rev: `rev-${Math.random()}` };
          return Promise.resolve({ rev: remote.rev });
        },
      );

      // Client B downloads (caches rev-1).
      await adapter.downloadOps(0);

      // Client A concurrently commits op-A → remote advances to rev-2.
      remote = {
        dataStr: addPrefix(
          createMockSyncData({ syncVersion: 2, recentOps: [aOp as never] }),
        ),
        rev: 'rev-2',
      };

      // Client B now uploads its own op; its cached rev-1 is stale.
      const bOp = createMockSyncOp({ id: 'op-B', clientId: 'client-B' });
      await expectAsync(adapter.uploadOps([bOp], 'client-B')).toBeRejectedWithError(
        UploadRevToMatchMismatchAPIError,
      );

      // A's op must NOT have vanished from the remote, and B must not have forced.
      const finalRemote = parseWithPrefix(remote.dataStr);
      expect(finalRemote.recentOps.some((o) => o.id === 'op-A')).toBe(true);
      expect(sawForceOnMain).toBe(false);
    });

    it('(guard) reconciles a stale in-memory expected syncVersion that is ahead of remote', async () => {
      // Establish expected syncVersion = 5.
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({
          dataStr: addPrefix(createMockSyncData({ syncVersion: 5, recentOps: [] })),
          rev: 'rev-5',
        }),
      );
      await adapter.downloadOps(0);

      // Remote regresses to syncVersion 2 (e.g. another client's recovery snapshot).
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({
          dataStr: addPrefix(createMockSyncData({ syncVersion: 2, recentOps: [] })),
          rev: 'rev-2',
        }),
      );
      const dl = await adapter.downloadOps(1);
      expect(dl.gapDetected).toBe(true);

      // The next upload must build on the REMOTE version (→ 3), proving the stale
      // in-memory counter (5) was reconciled rather than trusted.
      let uploadedMain = '';
      mockProvider.uploadFile.and.callFake((path: string, dataStr: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) {
          uploadedMain = dataStr;
        }
        return Promise.resolve({ rev: 'rev-new' });
      });
      await adapter.uploadOps([createMockSyncOp()], 'client1');
      expect(parseWithPrefix(uploadedMain).syncVersion).toBe(3);
    });
  });

  describe('remote-rev pre-check (SPAP-10)', () => {
    const STATE_KEY = FILE_BASED_SYNC_CONSTANTS.SYNC_VERSION_STORAGE_KEY_PREFIX + 'state';

    // Simulate crossing a poll boundary: the intra-cycle cache is only meant to
    // dedupe the download+upload of a SINGLE sync cycle. On the next poll it is
    // stale/absent. Clearing it here reproduces that cross-poll condition without
    // waiting out the real 30s TTL.
    const crossPollBoundary = (): void => {
      (
        service as unknown as { _syncCycleCache: Map<string, unknown> }
      )._syncCycleCache.clear();
    };

    // The rev pre-check is enabled for providers with a cheap, content-stable rev.
    // WebDAV (the default mock) is deliberately NOT one of them, so exercise the
    // optimization on Dropbox. Re-create the adapter AFTER switching the id so the
    // provider key captured by the adapter's closures matches.
    beforeEach(() => {
      mockProvider.id = SyncProviderId.Dropbox;
      adapter = service.createAdapter(mockProvider, mockCfg, mockEncryptKey);
    });

    it('(a) skips the full download when the remote rev is unchanged (zero downloadFile calls)', async () => {
      const syncData = createMockSyncData({ syncVersion: 2, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // First poll: seeds last-seen rev = 'rev-1' and expected syncVersion = 2.
      await adapter.downloadOps(0);
      // Simulate the caller durably applying the ops: this promotes the rev staged
      // during download to last-seen (same ordering as the seq cursor).
      await adapter.setLastServerSeq(2);

      crossPollBoundary();
      mockProvider.downloadFile.calls.reset();
      // getFileRev reports the SAME rev → remote is byte-identical → nothing new.
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) return { rev: 'rev-1' };
        throw new RemoteFileNotFoundAPIError('not found');
      });

      const result = await adapter.downloadOps(2);

      // No full download happened.
      expect(mockProvider.downloadFile).not.toHaveBeenCalled();
      // Empty, non-regressing "nothing new" response.
      expect(result.ops).toEqual([]);
      expect(result.hasMore).toBe(false);
      expect(result.latestSeq).toBe(2);
      expect(result.gapDetected).toBeFalsy();
    });

    it('(b) proceeds with the full download when the remote rev changed', async () => {
      const seed = createMockSyncData({ syncVersion: 2, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(seed), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0);
      // Simulate the caller durably applying the ops: this promotes the rev staged
      // during download to last-seen (same ordering as the seq cursor).
      await adapter.setLastServerSeq(2);

      crossPollBoundary();
      mockProvider.downloadFile.calls.reset();

      // Remote rev advanced → must NOT short-circuit.
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) return { rev: 'rev-2' };
        throw new RemoteFileNotFoundAPIError('not found');
      });
      const changed = createMockSyncData({
        syncVersion: 3,
        recentOps: [
          {
            id: 'op-new',
            c: 'client2',
            a: 'HA',
            o: 'ADD',
            e: 'TASK',
            d: 'task-new',
            v: { client2: 1 },
            t: Date.now(),
            s: 1,
            p: {},
          },
        ],
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(changed), rev: 'rev-2' }),
      );

      const result = await adapter.downloadOps(2);

      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(1);
      expect(result.ops.length).toBe(1);
      expect(result.latestSeq).toBe(3);
    });

    it('(c) falls through to the full download when getFileRev throws (generic error)', async () => {
      const seed = createMockSyncData({ syncVersion: 2, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(seed), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0);
      // Simulate the caller durably applying the ops: this promotes the rev staged
      // during download to last-seen (same ordering as the seq cursor).
      await adapter.setLastServerSeq(2);

      crossPollBoundary();
      mockProvider.downloadFile.calls.reset();

      mockProvider.getFileRev.and.callFake(async () => {
        throw new Error('network blip');
      });

      const result = await adapter.downloadOps(2);

      // The cheap check failed but the sync did NOT fail — full download ran.
      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(1);
      expect(result.latestSeq).toBe(2);
    });

    it('(c2) falls through to the full download when getFileRev throws RemoteFileNotFoundAPIError', async () => {
      const seed = createMockSyncData({ syncVersion: 2, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(seed), rev: 'rev-1' }),
      );
      await adapter.downloadOps(0);
      // Simulate the caller durably applying the ops: this promotes the rev staged
      // during download to last-seen (same ordering as the seq cursor).
      await adapter.setLastServerSeq(2);

      crossPollBoundary();
      mockProvider.downloadFile.calls.reset();

      mockProvider.getFileRev.and.callFake(async () => {
        throw new RemoteFileNotFoundAPIError('gone');
      });

      const result = await adapter.downloadOps(2);

      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(1);
      expect(result.latestSeq).toBe(2);
    });

    it('(d) persists the upload rev so the very next poll short-circuits', async () => {
      const syncData = createMockSyncData({ syncVersion: 1, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );
      mockProvider.uploadFile.and.returnValue(Promise.resolve({ rev: 'rev-up' }));

      // Poll 1: download (seeds cache + rev) then upload (clears cache, records upload rev).
      await adapter.downloadOps(0);
      await adapter.uploadOps([createMockSyncOp()], 'client1');

      // Persisted state carries the upload rev.
      const persisted = JSON.parse(localStorage.getItem(STATE_KEY) as string);
      expect(persisted.revs[SyncProviderId.Dropbox]).toBe('rev-up');

      // Poll 2: the cache was cleared by the upload → pre-check is eligible.
      mockProvider.downloadFile.calls.reset();
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) return { rev: 'rev-up' };
        throw new RemoteFileNotFoundAPIError('not found');
      });

      const result = await adapter.downloadOps(2);

      expect(mockProvider.downloadFile).not.toHaveBeenCalled();
      expect(result.ops).toEqual([]);
      // expected syncVersion after the upload was 2 → no seq regression.
      expect(result.latestSeq).toBe(2);
    });

    it('(e) does NOT skip on the next poll when the ops were never durably applied (no setLastServerSeq)', async () => {
      // Blocking-1 regression: the download stages the rev as pending; it becomes
      // the last-seen rev only after the caller confirms the ops were applied
      // (setLastServerSeq). If processing throws before that, the next poll MUST
      // re-download rather than short-circuit and skip the un-applied ops forever.
      const syncData = createMockSyncData({ syncVersion: 2, recentOps: [] });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // Poll 1: download only. Crucially setLastServerSeq is NOT called (simulating
      // a crash/throw while applying the downloaded ops).
      await adapter.downloadOps(0);

      crossPollBoundary();
      mockProvider.downloadFile.calls.reset();
      // Same rev as poll 1 — a buggy eager-persist would treat this as "nothing new".
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) return { rev: 'rev-1' };
        throw new RemoteFileNotFoundAPIError('not found');
      });

      const result = await adapter.downloadOps(2);

      // The rev was never promoted, so there is no last-seen rev to match and the
      // full download runs — the un-applied ops are re-fetched, not skipped.
      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(1);
      expect(result.latestSeq).toBe(2);
    });

    it('does NOT pre-check for LocalFile (mtime revs cannot guarantee change detection)', async () => {
      const localMock = jasmine.createSpyObj<FileSyncProvider<SyncProviderId>>(
        'LocalFileProvider',
        ['downloadFile', 'uploadFile', 'removeFile', 'getFileRev'],
      );
      localMock.id = SyncProviderId.LocalFile;
      const seed = createMockSyncData({ syncVersion: 2, recentOps: [] });
      localMock.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(seed), rev: 'rev-1' }),
      );
      // No sync-ops.json on this single-file folder, so the SPAP-11 OFF-path probe
      // sees it absent; SYNC_FILE keeps a stable rev to exercise the SPAP-10 gating.
      localMock.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.OPS_FILE) {
          throw new RemoteFileNotFoundAPIError(path);
        }
        return { rev: 'rev-1' };
      });

      const localAdapter = service.createAdapter(localMock, mockCfg, mockEncryptKey);
      await localAdapter.downloadOps(0);

      (
        service as unknown as { _syncCycleCache: Map<string, unknown> }
      )._syncCycleCache.clear();
      localMock.downloadFile.calls.reset();

      await localAdapter.downloadOps(2);

      // LocalFile is gated out → the full download still runs even though the rev matches.
      expect(localMock.downloadFile).toHaveBeenCalledTimes(1);
    });

    it('(f) forceFromSeq0 (sinceSeq=0) still full-downloads and returns snapshotState when the rev is unchanged', async () => {
      // Review follow-up: a seq-0 download rebuilds local state FROM the remote
      // snapshot (e.g. USE_REMOTE, which first clears local state), so it must NOT
      // be short-circuited by the rev pre-check even when remoteRev === lastSeenRev
      // — otherwise the cleared local state is never repopulated (silent loss).
      const syncData = createMockSyncData({
        syncVersion: 2,
        recentOps: [],
        state: { tasks: [{ id: 'remote-task' }] },
      });
      mockProvider.downloadFile.and.returnValue(
        Promise.resolve({ dataStr: addPrefix(syncData), rev: 'rev-1' }),
      );

      // Seed last-seen rev = 'rev-1' via a completed cycle (download + durable apply).
      await adapter.downloadOps(0);
      await adapter.setLastServerSeq(2);

      crossPollBoundary(); // empty cache — no warm-cache bypass of the precheck
      mockProvider.downloadFile.calls.reset();
      // Remote rev is UNCHANGED — a sinceSeq-blind precheck would wrongly skip.
      // Scope the rev to sync-data.json so the split-migration probe (SPAP-11 Q4,
      // which getFileRev's the ops file when split-sync is OFF) sees no ops file.
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === FILE_BASED_SYNC_CONSTANTS.SYNC_FILE) return { rev: 'rev-1' };
        throw new RemoteFileNotFoundAPIError(path);
      });

      const result = await adapter.downloadOps(0); // forceFromSeq0

      // Must perform the full download and return the snapshot used to rebuild local.
      expect(mockProvider.downloadFile).toHaveBeenCalledTimes(1);
      expect(result.snapshotState).toBeDefined();
    });
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // SPAP-11: split-file ("Surgical sync") format
  // ═══════════════════════════════════════════════════════════════════════════
  describe('SPAP-11: split-file (Surgical sync) format', () => {
    const C = FILE_BASED_SYNC_CONSTANTS;

    const makeOpsFile = (o: Partial<FileBasedOpsFile> = {}): FileBasedOpsFile => ({
      version: 3,
      syncVersion: 1,
      schemaVersion: 1,
      vectorClock: { client1: 1 },
      lastModified: Date.now(),
      clientId: 'client1',
      recentOps: [],
      snapshotRef: { syncVersion: 1, vectorClock: { client1: 1 }, rev: 'state-rev-1' },
      ...o,
    });

    // Valid compact op (short-key encoded) so _compactToSyncOp() can decode it.
    const makeCompactOp = (over: Record<string, unknown> = {}): never =>
      ({
        id: 'op-1',
        c: 'client1',
        a: 'HA',
        o: 'ADD',
        e: 'TASK',
        d: 'task-1',
        v: { client1: 1 },
        t: Date.now(),
        s: 1,
        p: { title: 'Task 1' },
        ...over,
      }) as never;

    const makeStateFile = (o: Partial<FileBasedStateFile> = {}): FileBasedStateFile => ({
      version: 3,
      syncVersion: 1,
      schemaVersion: 1,
      vectorClock: { client1: 1 },
      lastModified: Date.now(),
      clientId: 'client1',
      state: { tasks: [] },
      ...o,
    });

    // Routes downloadFile by path; unknown paths 404.
    const routeDownloads = (map: Record<string, string>): void => {
      mockProvider.downloadFile.and.callFake(async (path: string) => {
        if (path in map) return { dataStr: map[path], rev: `${path}-rev` };
        throw new RemoteFileNotFoundAPIError(path);
      });
    };

    const recordUploads = (): void => {
      mockProvider.uploadFile.and.callFake(async (path: string) => ({
        rev: `${path}-newrev`,
      }));
    };

    const uploadedPaths = (): string[] =>
      mockProvider.uploadFile.calls.allArgs().map((args) => args[0] as string);

    beforeEach(() => {
      splitSyncEnabled = true;
      recordUploads();
      // No rev pre-check short-circuit by default.
      mockProvider.getFileRev.and.callFake(async () => {
        throw new RemoteFileNotFoundAPIError('no rev');
      });
    });

    // (a) op-only sync uploads/downloads ONLY sync-ops.json and never snapshots.
    it('(a) op-only upload touches ONLY sync-ops.json and never calls getStateSnapshot()', async () => {
      const opsFile = makeOpsFile({ syncVersion: 3, recentOps: [] });
      routeDownloads({ [C.OPS_FILE]: addPrefix(opsFile, 3) });

      await adapter.uploadOps([createMockSyncOp()], 'client1');

      // Never builds a snapshot on the op-only path.
      expect(mockStateSnapshotService.getStateSnapshot).not.toHaveBeenCalled();
      // Every upload targeted the ops file only.
      const paths = uploadedPaths();
      expect(paths.length).toBeGreaterThan(0);
      paths.forEach((p) => expect(p).toBe(C.OPS_FILE));
      // Only the ops file was downloaded.
      mockProvider.downloadFile.calls.allArgs().forEach((args) => {
        expect(args[0]).toBe(C.OPS_FILE);
      });
    });

    it('(a) op-only download reads ONLY sync-ops.json (no sync-state.json fetch)', async () => {
      const opsFile = makeOpsFile({
        syncVersion: 5,
        recentOps: [makeCompactOp()],
      });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        [C.STATE_FILE]: addPrefix(makeStateFile({ syncVersion: 1 }), 3),
      });

      await adapter.downloadOps(5, 'client2');

      const downloaded = mockProvider.downloadFile.calls
        .allArgs()
        .map((a) => a[0] as string);
      expect(downloaded).toContain(C.OPS_FILE);
      expect(downloaded).not.toContain(C.STATE_FILE);
      expect(mockStateSnapshotService.getStateSnapshot).not.toHaveBeenCalled();
    });

    // (a2) Regression: the split ops buffer floor is SPLIT_COMPACTION_THRESHOLD
    // (1000), so it routinely exceeds DOWNLOAD_PAGE_SIZE (500). A behind client
    // must receive the NEWEST ops in a single page — the old code returned only
    // the oldest `limit` ops with hasMore=true, and since the caller advances
    // sinceSeq by the returned index-based serverSeq while the adapter ignores
    // sinceSeq, it kept re-fetching the same oldest slice and never converged.
    it('(a2) split download delivers the newest ops when buffer exceeds the page size', async () => {
      const PAGE = 500;
      const total = 600;
      const recentOps = Array.from({ length: total }, (_, i) =>
        makeCompactOp({
          id: `op-${i + 1}`,
          d: `task-${i + 1}`,
          v: { client1: i + 1 },
          sv: i + 1,
        }),
      );
      const opsFile = makeOpsFile({
        syncVersion: total,
        vectorClock: { client1: total },
        recentOps,
        oldestOpSyncVersion: 1,
      });
      routeDownloads({ [C.OPS_FILE]: addPrefix(opsFile, 3) });

      const result = await adapter.downloadOps(1, 'client2', PAGE);

      expect(result.ops.length).toBe(total);
      expect(result.hasMore).toBe(false);
      expect(result.ops.some((o) => o.op.id === 'op-600')).toBe(true);
    });

    // (a3) SPAP-33: a short ops buffer (fewer than SPLIT_COMPACTION_THRESHOLD ops)
    // still signals a gap and loads the snapshot when the oldest retained op is
    // past sinceSeq+1. The old `recentOps.length >= SPLIT_COMPACTION_THRESHOLD`
    // clause suppressed this, so a behind client applied ops without the snapshot
    // base and silently diverged.
    it('(a3) split download detects gap + loads snapshot for a short trimmed buffer', async () => {
      const shortOps = Array.from({ length: 3 }, (_, i) =>
        makeCompactOp({ id: `op-${i + 1}`, d: `task-${i + 1}`, sv: 10 }),
      );
      const opsFile = makeOpsFile({
        syncVersion: 20,
        vectorClock: { client1: 20 },
        recentOps: shortOps,
        oldestOpSyncVersion: 10, // oldest sv=10, far past sinceSeq+1
      });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        [C.STATE_FILE]: addPrefix(makeStateFile({ syncVersion: 1 }), 3),
      });

      const result = await adapter.downloadOps(2, 'client2'); // sinceSeq=2, oldest=10

      expect(result.gapDetected).toBe(true);
      expect(result.snapshotState).toBeDefined();
    });

    // (b) compaction triggers when the buffer exceeds MAX_RECENT_OPS, writing
    // state THEN ops.
    it('(b) compaction past MAX_RECENT_OPS writes sync-state.json BEFORE sync-ops.json', async () => {
      const many = Array.from({ length: C.MAX_RECENT_OPS }, () => ({ sv: 1 }) as never);
      const opsFile = makeOpsFile({ syncVersion: 5, recentOps: many });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        [C.STATE_FILE]: addPrefix(makeStateFile({ syncVersion: 1 }), 3),
      });

      await adapter.uploadOps([createMockSyncOp()], 'client1');

      // Compaction builds a fresh snapshot.
      expect(mockStateSnapshotService.getStateSnapshot).toHaveBeenCalled();
      const paths = uploadedPaths();
      const stateIdx = paths.indexOf(C.STATE_FILE);
      const opsIdx = paths.lastIndexOf(C.OPS_FILE);
      expect(stateIdx).toBeGreaterThanOrEqual(0);
      expect(opsIdx).toBeGreaterThanOrEqual(0);
      // sync-state.json is written before the ops file that references it.
      expect(stateIdx).toBeLessThan(opsIdx);
    });

    // (b2) Review regression: once the folder is past SPLIT_COMPACTION_THRESHOLD but
    // still under MAX_RECENT_OPS, op-bearing syncs must stay cheap (no snapshot
    // rebuild). The old code triggered compaction at SPLIT_COMPACTION_THRESHOLD, so
    // it recompacted on EVERY op-bearing sync once the folder crossed 1000.
    it('(b2) does NOT recompact on every op-bearing sync between the threshold and the cap', async () => {
      // Buffer sits between the trim target (1000) and the trigger (2000).
      const between = C.SPLIT_COMPACTION_THRESHOLD + 200;
      let recentOps = Array.from({ length: between }, () => ({ sv: 1 }) as never);

      // Two consecutive op-bearing syncs, each appending one op (1201, then 1202) —
      // both still under MAX_RECENT_OPS, so neither may rebuild the snapshot.
      for (let sync = 0; sync < 2; sync++) {
        const opsFile = makeOpsFile({ syncVersion: 5 + sync, recentOps });
        routeDownloads({
          [C.OPS_FILE]: addPrefix(opsFile, 3),
          [C.STATE_FILE]: addPrefix(makeStateFile({ syncVersion: 1 }), 3),
        });
        await adapter.uploadOps([createMockSyncOp()], 'client1');
        recentOps = [...recentOps, { sv: 1 } as never];
      }

      // At most one snapshot build across both syncs — ideally zero here.
      expect(mockStateSnapshotService.getStateSnapshot.calls.count()).toBeLessThanOrEqual(
        1,
      );
      expect(mockStateSnapshotService.getStateSnapshot).not.toHaveBeenCalled();
    });

    // (c) crash between the two writes (state written, ops write failed) recovers.
    it('(c) recovers from state-backup when sync-state.json is newer than snapshotRef (crash between writes)', async () => {
      // Old ops file references snapshot syncVersion 1; sync-state.json was
      // overwritten to syncVersion 2 (unreferenced); .bak still holds v1.
      const opsFile = makeOpsFile({
        syncVersion: 5,
        recentOps: [makeCompactOp()],
        snapshotRef: { syncVersion: 1, vectorClock: { client1: 1 }, rev: 'sr1' },
      });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        [C.STATE_FILE]: addPrefix(
          makeStateFile({
            syncVersion: 2,
            vectorClock: { client1: 2 },
            state: { tasks: ['from-new-unreferenced'] },
          }),
          3,
        ),
        [C.STATE_FILE + '.bak']: addPrefix(
          makeStateFile({
            syncVersion: 1,
            vectorClock: { client1: 1 },
            state: { tasks: ['from-bak'] },
          }),
          3,
        ),
      });

      const res = await adapter.downloadOps(0, 'client2');

      // No throw, no conflict — recovered the referenced snapshot from .bak.
      expect(res.snapshotState).toBeDefined();
      expect((res.snapshotState as { tasks: string[] }).tasks).toEqual(['from-bak']);
    });

    // (d) snapshotRef mismatch (and no usable backup) is treated as a gap.
    it('(d) snapshotRef mismatch with no backup signals a gap (full re-download)', async () => {
      const opsFile = makeOpsFile({
        syncVersion: 5,
        recentOps: [makeCompactOp()],
        snapshotRef: { syncVersion: 5, vectorClock: { client1: 5 }, rev: 'sr5' },
      });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        // On-disk snapshot is stale (syncVersion 3) → does not match ref (5).
        [C.STATE_FILE]: addPrefix(makeStateFile({ syncVersion: 3 }), 3),
        // no .bak
      });

      const res = await adapter.downloadOps(0, 'client2');

      expect(res.gapDetected).toBe(true);
      expect(res.snapshotState).toBeUndefined();
    });

    // (e) legacy v2 sync-data.json migrates in place: state+ops written, tombstone
    // over sync-data.json, .bak neutralized, sync-data.json NOT removed.
    it('(e) migrates legacy v2 sync-data.json to split format with a v3 tombstone', async () => {
      const legacy = createMockSyncData({
        syncVersion: 7,
        vectorClock: { client1: 7 },
        recentOps: [],
        state: { tasks: ['legacy'] },
      });
      routeDownloads({
        [C.SYNC_FILE]: addPrefix(legacy, 2),
        // ops/state files not present yet
      });

      await adapter.uploadOps([createMockSyncOp()], 'client1');

      const paths = uploadedPaths();
      // state written before ops before the tombstone.
      const stateIdx = paths.indexOf(C.STATE_FILE);
      const opsIdx = paths.indexOf(C.OPS_FILE);
      const tombIdx = paths.indexOf(C.SYNC_FILE);
      expect(stateIdx).toBeGreaterThanOrEqual(0);
      expect(opsIdx).toBeGreaterThanOrEqual(0);
      expect(tombIdx).toBeGreaterThanOrEqual(0);
      expect(stateIdx).toBeLessThan(opsIdx);
      expect(opsIdx).toBeLessThan(tombIdx);

      // sync-data.json overwritten with a v3 split tombstone (never removed).
      expect(mockProvider.removeFile).not.toHaveBeenCalled();
      const tombCall = mockProvider.uploadFile.calls
        .allArgs()
        .find((a) => a[0] === C.SYNC_FILE);
      const tomb = parseWithPrefix(tombCall![1] as string) as unknown as {
        version: number;
        format: string;
      };
      expect(tomb.version).toBe(C.SPLIT_FILE_VERSION);
      expect(tomb.format).toBe(C.SPLIT_TOMBSTONE_FORMAT);

      // .bak neutralized to a v3 tombstone too.
      const bakCall = mockProvider.uploadFile.calls
        .allArgs()
        .find((a) => a[0] === C.BACKUP_FILE);
      expect(bakCall).toBeDefined();
      const bak = parseWithPrefix(bakCall![1] as string) as unknown as {
        version: number;
      };
      expect(bak.version).toBe(C.SPLIT_FILE_VERSION);
    });

    // (f) setting-OFF client seeing the tombstone raises the actionable notice
    // and does NOT upload/diverge.
    it('(f) OFF client hitting a split tombstone surfaces the enable-setting notice and does not upload', async () => {
      splitSyncEnabled = false; // setting OFF for this client
      const tombstone = {
        version: 3,
        format: 'split',
        migratedAt: Date.now(),
        note: 'x',
      };
      routeDownloads({ [C.SYNC_FILE]: addPrefix(tombstone, 3) });

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWithError(
        SplitSyncFormatDetectedError,
      );

      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.F.SYNC.S.SPLIT_FORMAT_ENABLE_SETTING,
      });
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    // (g) SPAP-11 Q4: migration crash window. sync-data.json is still a valid v2
    // file but sync-ops.json already exists (crash after the ops commit, before
    // the tombstone write). An OFF client must NOT proceed on the stale v2 file;
    // the ops-file probe surfaces the enable-setting notice and pauses.
    it('(g) OFF client sees v2 sync-data.json + an existing sync-ops.json → notice, no upload', async () => {
      splitSyncEnabled = false; // setting OFF for this client
      const legacyV2 = {
        version: 2,
        syncVersion: 1,
        schemaVersion: 1,
        vectorClock: { client1: 1 },
        lastModified: Date.now(),
        clientId: 'client1',
        state: { tasks: [] },
        recentOps: [],
      };
      routeDownloads({ [C.SYNC_FILE]: addPrefix(legacyV2, 2) });
      // sync-ops.json is present (migration in progress) → getFileRev resolves for it.
      mockProvider.getFileRev.and.callFake(async (path: string) => {
        if (path === C.OPS_FILE) return { rev: 'ops-rev' };
        throw new RemoteFileNotFoundAPIError(path);
      });

      await expectAsync(adapter.downloadOps(0)).toBeRejectedWithError(
        SplitSyncFormatDetectedError,
      );
      expect(mockSnackService.open).toHaveBeenCalledWith({
        type: 'ERROR',
        msg: T.F.SYNC.S.SPLIT_FORMAT_ENABLE_SETTING,
      });
      expect(mockProvider.uploadFile).not.toHaveBeenCalled();
    });

    it('(g) split download stages the ops rev as pending (not committed) until setLastServerSeq', async () => {
      // Crash-safety mirror of the single-file path: a crash between download and
      // durable apply must not strand the rev ahead of the un-applied ops (which
      // the next poll's precheck would then skip for good).
      mockProvider.id = SyncProviderId.Dropbox;
      adapter = service.createAdapter(mockProvider, mockCfg, mockEncryptKey);
      const opsFile = makeOpsFile({ syncVersion: 5, recentOps: [makeCompactOp()] });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        [C.STATE_FILE]: addPrefix(makeStateFile({ syncVersion: 1 }), 3),
      });
      const lastSeen = (service as unknown as { _lastSeenRevs: Map<string, string> })
        ._lastSeenRevs;

      await adapter.downloadOps(5, 'client2'); // ops downloaded, not yet applied

      // Staged in _pendingRevs, NOT committed to _lastSeenRevs yet.
      expect(lastSeen.get('Dropbox')).toBeUndefined();

      await adapter.setLastServerSeq(5); // caller confirms durable apply
      expect(lastSeen.get('Dropbox')).toBe(`${C.OPS_FILE}-rev`); // now promoted
    });

    it('(h) split forceFromSeq0 (sinceSeq=0) does NOT short-circuit on an unchanged ops rev', async () => {
      // USE_REMOTE / fresh hydration re-pulls the snapshot to rebuild local state,
      // so a seq-0 split download must fetch ops AND state even when the rev matches.
      mockProvider.id = SyncProviderId.Dropbox;
      adapter = service.createAdapter(mockProvider, mockCfg, mockEncryptKey);
      const opsFile = makeOpsFile({ syncVersion: 5, recentOps: [] });
      routeDownloads({
        [C.OPS_FILE]: addPrefix(opsFile, 3),
        [C.STATE_FILE]: addPrefix(
          makeStateFile({ syncVersion: 5, state: { tasks: [{ id: 't' }] } }),
          3,
        ),
      });
      // Seed a matching last-seen rev so an INCREMENTAL poll would short-circuit.
      (service as unknown as { _lastSeenRevs: Map<string, string> })._lastSeenRevs.set(
        'Dropbox',
        `${C.OPS_FILE}-rev`,
      );
      mockProvider.getFileRev.and.callFake(async () => ({ rev: `${C.OPS_FILE}-rev` }));

      await adapter.downloadOps(0, 'client2'); // forceFromSeq0

      const downloaded = mockProvider.downloadFile.calls
        .allArgs()
        .map((a) => a[0] as string);
      expect(downloaded).toContain(C.OPS_FILE);
      expect(downloaded).toContain(C.STATE_FILE);
    });
  });
});
