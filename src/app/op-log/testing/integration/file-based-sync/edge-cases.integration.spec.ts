import { FileBasedSyncTestHarness } from '../helpers/file-based-sync-test-harness';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../sync-providers/file-based/file-based-sync.types';
import { SyncOperation } from '../../../sync-providers/provider.interface';

describe('File-Based Sync Integration - Edge Cases', () => {
  let harness: FileBasedSyncTestHarness;

  beforeEach(() => {
    harness = FileBasedSyncTestHarness.create({});
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Empty Remote States', () => {
    it('should handle download when remote file does not exist', async () => {
      const clientA = harness.createClient('client-a');

      // Download from empty remote
      const response = await clientA.downloadOps(0);

      expect(response.ops).toEqual([]);
      expect(response.latestSeq).toBe(0);
      expect(response.hasMore).toBe(false);
    });

    it('should create sync file on first upload to empty remote', async () => {
      const clientA = harness.createClient('client-a');
      const provider = harness.getProvider();

      // Verify no file exists
      expect(provider.hasFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE)).toBe(false);

      // Upload first op
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'First Task',
      });
      await clientA.uploadOps([op]);

      // File should now exist
      expect(provider.hasFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE)).toBe(true);
    });

    it('should handle upload with empty ops array to existing file', async () => {
      const clientA = harness.createClient('client-a');

      // Create initial file
      const initialOp = clientA.createOp(
        'Task',
        'task-1',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        { title: 'Initial' },
      );
      await clientA.uploadOps([initialOp]);

      // Upload empty ops
      const response = await clientA.uploadOps([]);

      expect(response.results).toEqual([]);
      expect(response.latestSeq).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Provider Error Handling', () => {
    it('should propagate provider download errors', async () => {
      const clientA = harness.createClient('client-a');
      const provider = harness.getProvider();

      // Inject a generic error
      const testError = new Error('Network error');
      provider.injectMethodError('downloadFile', testError);

      // First, we need to create a file so RemoteFileNotFoundAPIError isn't thrown
      provider.setFileContent(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE, '{}');

      await expectAsync(clientA.downloadOps(0)).toBeRejectedWith(testError);

      provider.clearMethodError('downloadFile');
    });

    it('should propagate provider upload errors', async () => {
      const clientA = harness.createClient('client-a');
      const provider = harness.getProvider();

      // Inject error
      const testError = new Error('Disk full');
      provider.injectMethodError('uploadFile', testError);

      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test',
      });

      await expectAsync(clientA.uploadOps([op])).toBeRejectedWith(testError);

      provider.clearMethodError('uploadFile');
    });

    it('should handle getFileRev errors gracefully', async () => {
      const clientA = harness.createClient('client-a');
      const provider = harness.getProvider();

      // Create a file first
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test',
      });
      await clientA.uploadOps([op]);

      // Inject error on getFileRev
      const testError = new Error('Permission denied');
      provider.injectMethodError('getFileRev', testError);

      // getFileRev might be called during some operations
      // but for our adapter, download/upload use downloadFile directly
      // This test ensures errors are propagated when getFileRev fails
      await expectAsync(
        provider.getFileRev(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE, null),
      ).toBeRejectedWith(testError);

      provider.clearMethodError('getFileRev');
    });
  });

  describe('Large Operation Sets', () => {
    it('should handle MAX_RECENT_OPS limit during upload', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Create more ops than MAX_RECENT_OPS
      const numOps = FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS + 10;
      const ops: SyncOperation[] = [];
      for (let i = 0; i < numOps; i++) {
        ops.push(
          clientA.createOp('Task', `task-${i}`, 'CRT', 'TaskActionTypes.ADD_TASK', {
            title: `Task ${i}`,
          }),
        );
      }

      // Upload in batches to avoid timeout
      const batchSize = 50;
      for (let i = 0; i < ops.length; i += batchSize) {
        const batch = ops.slice(i, i + batchSize);
        await clientA.uploadOps(batch);
      }

      // Download should return at most MAX_RECENT_OPS
      const download = await clientB.downloadOps(0);

      // Due to trimming, we might not have all ops
      expect(download.ops.length).toBeLessThanOrEqual(
        FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS,
      );
    });

    it('should preserve most recent ops when trimming', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Create ops with identifiable sequence
      const ops = [
        clientA.createOp('Task', 'task-old-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Old 1',
        }),
        clientA.createOp('Task', 'task-old-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Old 2',
        }),
      ];
      await clientA.uploadOps(ops);

      const moreOps = [
        clientA.createOp('Task', 'task-new-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'New 1',
        }),
        clientA.createOp('Task', 'task-new-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'New 2',
        }),
      ];
      await clientA.uploadOps(moreOps);

      // Download and verify newer ops are present
      const download = await clientB.downloadOps(0);
      const entityIds = download.ops.map((o) => o.op.entityId);

      expect(entityIds).toContain('task-new-1');
      expect(entityIds).toContain('task-new-2');
    });
  });

  describe('Sync Cycle Cache', () => {
    it('should use cached data when downloading then uploading in same cycle', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const provider = harness.getProvider();

      // Client A creates initial file
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // Clear call history
      provider.clearHistory();

      // Client B downloads (caches the data)
      await clientB.downloadOps(0);

      // Get download call count
      const downloadCallsAfterDownload = provider.getCallsTo('downloadFile').length;
      expect(downloadCallsAfterDownload).toBe(1);

      // Client B immediately uploads (should use cached data)
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      await clientB.uploadOps([opB]);

      // Should not have made another download call (cache was used)
      const totalDownloadCalls = provider.getCallsTo('downloadFile').length;
      expect(totalDownloadCalls).toBe(1); // Same as before, cache was used
    });

    it('should invalidate cache after upload', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const provider = harness.getProvider();

      // Client A creates initial file
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // Client B downloads (caches data)
      await clientB.downloadOps(0);

      // Client B uploads (invalidates cache)
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      await clientB.uploadOps([opB]);

      provider.clearHistory();

      // Client B downloads again (should fetch fresh, not use stale cache)
      await clientB.downloadOps(0);

      // Should have made a new download call
      expect(provider.getCallsTo('downloadFile').length).toBe(1);
    });
  });

  describe('Operation Schema', () => {
    it('should preserve all operation fields through sync', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Create op with all fields
      const op = clientA.createOp(
        'Task',
        'task-1',
        'UPD',
        'TaskActionTypes.UPDATE_TASK',
        {
          title: 'Updated Title',
          completed: true,
        },
      );
      await clientA.uploadOps([op]);

      // Download and verify fields preserved
      const download = await clientB.downloadOps(0);
      const downloadedOp = download.ops[0].op;

      expect(downloadedOp.id).toBe(op.id);
      expect(downloadedOp.clientId).toBe('client-a');
      expect(downloadedOp.entityType).toBe('Task');
      expect(downloadedOp.entityId).toBe('task-1');
      expect(downloadedOp.opType).toBe('UPD');
      expect(downloadedOp.actionType).toBe('TaskActionTypes.UPDATE_TASK');
      expect(downloadedOp.payload).toEqual({
        title: 'Updated Title',
        completed: true,
      });
      expect(downloadedOp.vectorClock).toEqual(op.vectorClock);
      expect(downloadedOp.timestamp).toBe(op.timestamp);
      expect(downloadedOp.schemaVersion).toBe(op.schemaVersion);
    });

    it('should handle operations with different entity types', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Create ops with different entity types
      const ops = [
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task',
        }),
        clientA.createOp(
          'Project',
          'project-1',
          'CRT',
          'ProjectActionTypes.ADD_PROJECT',
          {
            title: 'Project',
          },
        ),
        clientA.createOp('Tag', 'tag-1', 'CRT', 'TagActionTypes.ADD_TAG', {
          title: 'Tag',
        }),
      ];
      await clientA.uploadOps(ops);

      const download = await clientB.downloadOps(0);

      expect(download.ops.length).toBe(3);
      const entityTypes = download.ops.map((o) => o.op.entityType);
      expect(entityTypes).toContain('Task');
      expect(entityTypes).toContain('Project');
      expect(entityTypes).toContain('Tag');
    });

    it('should handle DEL operations', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Create then delete
      const createOp = clientA.createOp(
        'Task',
        'task-1',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        { title: 'To Delete' },
      );
      const deleteOp = clientA.createOp(
        'Task',
        'task-1',
        'DEL',
        'TaskActionTypes.DELETE_TASK',
        null,
      );

      await clientA.uploadOps([createOp, deleteOp]);

      const download = await clientB.downloadOps(0);
      const ops = download.ops.map((o) => ({
        entityId: o.op.entityId,
        opType: o.op.opType,
      }));

      expect(ops).toContain(
        jasmine.objectContaining({ entityId: 'task-1', opType: 'DEL' }),
      );
    });
  });

  describe('Timestamp Handling', () => {
    it('should preserve timestamps through sync', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      const beforeCreate = Date.now();
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test',
      });
      const afterCreate = Date.now();

      await clientA.uploadOps([op]);

      const download = await clientB.downloadOps(0);
      const downloadedOp = download.ops[0].op;

      // Timestamp should be within the creation window
      expect(downloadedOp.timestamp).toBeGreaterThanOrEqual(beforeCreate);
      expect(downloadedOp.timestamp).toBeLessThanOrEqual(afterCreate);
    });

    it('should track receivedAt timestamp on download', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test',
      });
      await clientA.uploadOps([op]);

      // Wait a bit
      await new Promise((resolve) => setTimeout(resolve, 10));

      const download = await clientB.downloadOps(0);
      const afterDownload = Date.now();

      // receivedAt should be set during download
      expect(download.ops[0].receivedAt).toBeDefined();
      expect(download.ops[0].receivedAt).toBeLessThanOrEqual(afterDownload);
    });
  });
});

describe('File-Based Sync Integration - Encryption Round-Trip', () => {
  let harness: FileBasedSyncTestHarness;

  beforeEach(() => {
    harness = FileBasedSyncTestHarness.create({
      encryptAndCompressCfg: { isEncrypt: true, isCompress: false },
      encryptKey: 'test-encryption-key-12345',
    });
  });

  afterEach(() => {
    harness.reset();
  });

  // Encryption tests need longer timeout due to Web Crypto key derivation
  const ENCRYPT_TIMEOUT = 10000;

  it(
    'should upload and download ops with encryption enabled',
    async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Client A uploads encrypted ops
      const ops = [
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Encrypted Task 1',
        }),
        clientA.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Encrypted Task 2',
        }),
      ];
      const uploadResponse = await clientA.uploadOps(ops);
      expect(uploadResponse.results.length).toBe(2);
      expect(uploadResponse.results[0].accepted).toBe(true);

      // Client B downloads and decrypts
      const download = await clientB.downloadOps(0);
      expect(download.ops.length).toBe(2);

      // Verify fields are preserved through encrypt/decrypt cycle
      const entityIds = download.ops.map((o) => o.op.entityId);
      expect(entityIds).toContain('task-1');
      expect(entityIds).toContain('task-2');

      const payloads = download.ops.map((o) => o.op.payload as { title: string });
      expect(payloads).toContain(jasmine.objectContaining({ title: 'Encrypted Task 1' }));
      expect(payloads).toContain(jasmine.objectContaining({ title: 'Encrypted Task 2' }));
    },
    ENCRYPT_TIMEOUT,
  );

  it(
    'should upload and download snapshot with encryption enabled',
    async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Client A uploads a snapshot (simulates USE_LOCAL conflict resolution)
      // Note: uploadSnapshot uses getStateSnapshot() internally (double-encryption fix),
      // so we must set the mock state BEFORE calling uploadSnapshot.
      const taskId = 'snapTask1';
      const snapshotState = {
        task: {
          ids: [taskId],
          entities: { [taskId]: { id: taskId, title: 'Snapshot Task' } },
        },
      };
      harness.setMockState(snapshotState);
      await clientA.adapter.uploadSnapshot(
        snapshotState,
        'client-a',
        'recovery',
        {},
        1,
        undefined,
        'test-snapshot-op-id',
      );

      // Client B downloads from 0 — should get decrypted snapshot
      const download = await clientB.downloadOps(0);
      expect(download.snapshotState).toBeDefined();
      expect((download.snapshotState as any).task.ids).toContain(taskId);
    },
    ENCRYPT_TIMEOUT,
  );

  it(
    'should handle encrypted concurrent uploads without corruption',
    async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const observer = harness.createClient('observer');

      // Both clients start from the same state
      const initialOp = clientA.createOp(
        'Task',
        'task-init',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        { title: 'Initial' },
      );
      await clientA.uploadOps([initialOp]);
      await clientB.downloadOps(0);

      // Client A uploads
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'From A',
      });
      await clientA.uploadOps([opA]);

      // Client B uploads (merges with A's data)
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'From B',
      });
      const responseB = await clientB.uploadOps([opB]);
      expect(responseB.results[0].accepted).toBe(true);

      // Observer downloads — should see all ops decrypted correctly
      const download = await observer.downloadOps(0);
      const entityIds = download.ops.map((o) => o.op.entityId);
      expect(entityIds).toContain('task-init');
      expect(entityIds).toContain('task-a');
      expect(entityIds).toContain('task-b');
    },
    ENCRYPT_TIMEOUT,
  );
});
