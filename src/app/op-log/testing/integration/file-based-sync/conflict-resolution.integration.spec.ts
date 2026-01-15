import { FileBasedSyncTestHarness } from '../helpers/file-based-sync-test-harness';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../sync-providers/file-based/file-based-sync.types';
import { UploadRevToMatchMismatchAPIError } from '../../../core/errors/sync-errors';

describe('File-Based Sync Integration - Conflict Resolution', () => {
  let harness: FileBasedSyncTestHarness;

  beforeEach(() => {
    harness = FileBasedSyncTestHarness.create({});
  });

  afterEach(() => {
    harness.reset();
  });

  describe('syncVersion Mismatch', () => {
    it('should detect version mismatch when another client synced', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A syncs first
      const opA1 = clientA.createOp(
        'Task',
        'task-a1',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'Task A1',
        },
      );
      await clientA.uploadOps([opA1]);

      // Client B downloads to get in sync
      await clientB.downloadOps(0);

      // Client B syncs while A has stale view
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task B',
      });
      await clientB.uploadOps([opB]);

      // Client A uploads with stale expected version
      // (A hasn't downloaded B's change yet)
      const opA2 = clientA.createOp(
        'Task',
        'task-a2',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'Task A2',
        },
      );

      // This should succeed due to merging, but piggyback B's op
      const response = await clientA.uploadOps([opA2]);

      // Upload should succeed
      expect(response.results[0].accepted).toBe(true);

      // Should have piggybacked B's op
      expect(response.newOps).toBeDefined();
      expect(response.newOps!.length).toBeGreaterThan(0);
      expect(response.newOps!.some((o) => o.op.entityId === 'task-b')).toBe(true);
    });

    it('should handle rev mismatch and retry upload', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');
      const provider = harness.getProvider();

      // Set up initial sync file
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Initial Task',
      });
      await clientA.uploadOps([opA]);

      // Client B downloads
      await clientB.downloadOps(0);

      // Simulate race condition: inject rev mismatch error on first upload attempt
      provider.injectNextError(
        new UploadRevToMatchMismatchAPIError('Rev changed during upload'),
      );

      // Client B uploads - should handle the retry internally
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task B',
      });

      // This tests the retry logic in _uploadOps (lines 459-516)
      // The first upload fails with rev mismatch, then it re-downloads and retries
      const response = await clientB.uploadOps([opB]);

      // Upload should eventually succeed after retry
      expect(response.results[0].accepted).toBe(true);
    });
  });

  describe('Gap Detection', () => {
    it('should detect gap when syncVersion resets', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A syncs multiple times to build up syncVersion
      const ops = [
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '1',
        }),
        clientA.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '2',
        }),
      ];
      await clientA.uploadOps(ops);

      // Client B syncs to get up to date
      const firstDownload = await clientB.downloadOps(0);
      expect(firstDownload.latestSeq).toBeGreaterThan(0);

      // Client A uploads a snapshot (resets syncVersion to 1)
      await clientA.adapter.uploadSnapshot(
        // eslint-disable-next-line @typescript-eslint/naming-convention
        { task: { ids: ['new-task'], entities: { 'new-task': { id: 'new-task' } } } },
        'client-a-test',
        'recovery',
        {},
        1,
        undefined, // isPayloadEncrypted
        'test-snapshot-op-id-1', // opId
      );

      // Client B downloads again - should detect gap (syncVersion reset)
      const secondDownload = await clientB.downloadOps(firstDownload.latestSeq);

      // gapDetected should be true because syncVersion went from higher to lower
      expect(secondDownload.gapDetected).toBe(true);
    });

    it('should detect snapshot replacement when recentOps is empty', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A syncs
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Initial',
      });
      await clientA.uploadOps([op]);

      // Client B syncs
      const firstDownload = await clientB.downloadOps(0);
      const latestSeq = firstDownload.latestSeq;

      // Client A uploads snapshot with empty recentOps (simulates "Use Local" conflict resolution)
      await clientA.adapter.uploadSnapshot(
        { task: { ids: [], entities: {} } },
        'client-a-test',
        'recovery',
        {},
        1,
        undefined, // isPayloadEncrypted
        'test-snapshot-op-id-2', // opId
      );

      // Client B downloads expecting ops from sinceSeq > 0, but finds empty recentOps
      const secondDownload = await clientB.downloadOps(latestSeq);

      // gapDetected should be true because this is snapshot replacement
      expect(secondDownload.gapDetected).toBe(true);
      // snapshotState should be available when re-downloading from 0
      const freshDownload = await clientB.downloadOps(0);
      expect(freshDownload.snapshotState).toBeDefined();
    });
  });

  describe('Concurrent Edits Merge', () => {
    it('should merge concurrent edits to different entities', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');
      // Third client to observe all ops (downloads exclude own client's ops)
      const clientC = harness.createClient('client-c-observer');

      // Both clients start from the same state
      const initialOp = clientA.createOp(
        'Task',
        'task-0',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        { title: 'Initial' },
      );
      await clientA.uploadOps([initialOp]);
      await clientB.downloadOps(0);

      // Both clients create operations concurrently (different entities)
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task A',
      });
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task B',
      });

      // Client A uploads first
      await clientA.uploadOps([opA]);

      // Client B uploads (should merge without conflict)
      const responseB = await clientB.uploadOps([opB]);
      expect(responseB.results[0].accepted).toBe(true);

      // Both ops should be in the file - use observer client to see all ops
      const finalDownload = await clientC.downloadOps(0);
      const entityIds = finalDownload.ops.map((o) => o.op.entityId);
      expect(entityIds).toContain('task-a');
      expect(entityIds).toContain('task-b');
    });

    it('should merge vector clocks correctly during concurrent sync', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A creates op
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // Client B creates op without downloading A's changes
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      await clientB.uploadOps([opB]);

      // Download and check merged vector clock contains knowledge of both clients
      const download = await clientA.downloadOps(0);
      expect(download.snapshotVectorClock).toBeDefined();
      expect(download.snapshotVectorClock!['client-a-test']).toBeGreaterThan(0);
      expect(download.snapshotVectorClock!['client-b-test']).toBeGreaterThan(0);
    });
  });

  describe('Processed Op ID Tracking', () => {
    it('should not return same ops on subsequent downloads', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A uploads
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task 1',
      });
      await clientA.uploadOps([op]);

      // Client B downloads (first time)
      const firstDownload = await clientB.downloadOps(0);
      expect(firstDownload.ops.length).toBe(1);
      expect(firstDownload.ops[0].op.id).toBeDefined();

      // Client B downloads again with latestSeq
      // Note: download service filters using appliedOpIds, but adapter returns all ops
      // This test verifies that latestSeq tracking works correctly
      const secondDownload = await clientB.downloadOps(firstDownload.latestSeq);
      expect(secondDownload.latestSeq).toBe(firstDownload.latestSeq);
    });

    it('should use operation IDs not array indices for tracking', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Create many ops to potentially cause array trimming
      const ops = [
        clientA.createOp('Task', 'task-0', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 0',
        }),
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 1',
        }),
        clientA.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 2',
        }),
        clientA.createOp('Task', 'task-3', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 3',
        }),
        clientA.createOp('Task', 'task-4', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 4',
        }),
      ];
      await clientA.uploadOps(ops);

      // Client B downloads
      const download = await clientB.downloadOps(0);

      // Verify ops are identified by ID, not index
      expect(download.ops.every((o) => typeof o.op.id === 'string')).toBe(true);
      expect(download.ops.every((o) => o.op.id.length > 0)).toBe(true);
    });

    it('should prevent duplicate ops during piggybacking', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Initial sync
      const initialOp = clientA.createOp(
        'Task',
        'task-0',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        { title: 'Initial' },
      );
      await clientA.uploadOps([initialOp]);

      // Client B uploads without downloading first (should get A's op piggybacked)
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      const uploadResponse = await clientB.uploadOps([opB]);

      // Should have piggybacked the initial op
      expect(uploadResponse.newOps).toBeDefined();
      const piggybackedIds = uploadResponse.newOps!.map((o) => o.op.id);
      expect(piggybackedIds.length).toBeGreaterThan(0);

      // Upload again with another op - should not re-piggyback same ops
      const opB2 = clientB.createOp(
        'Task',
        'task-b2',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'B2',
        },
      );
      const secondUpload = await clientB.uploadOps([opB2]);

      // If there are piggybacked ops, they should NOT include the already-piggybacked ones
      if (secondUpload.newOps && secondUpload.newOps.length > 0) {
        const newPiggybackedIds = secondUpload.newOps.map((o) => o.op.id);
        for (const id of piggybackedIds) {
          expect(newPiggybackedIds).not.toContain(id);
        }
      }
    });

    it('should exclude own client ops from piggybacking', async () => {
      const clientA = harness.createClient('client-a-test');
      // Create client B to initialize shared provider state
      harness.createClient('client-b-test');

      // Client A uploads
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // Client A uploads again - should not get own op piggybacked
      const opA2 = clientA.createOp(
        'Task',
        'task-a2',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'A2',
        },
      );
      const response = await clientA.uploadOps([opA2]);

      // newOps should not contain client A's ops
      if (response.newOps) {
        const clientIds = response.newOps.map((o) => o.op.clientId);
        expect(clientIds).not.toContain('client-a-test');
      }
    });
  });

  describe('Error Recovery', () => {
    it('should handle RemoteFileNotFoundAPIError during upload gracefully', async () => {
      const clientA = harness.createClient('client-a-test');

      // Upload to empty remote (no existing file)
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'First Task',
      });

      // This should create the file successfully
      const response = await clientA.uploadOps([op]);
      expect(response.results[0].accepted).toBe(true);

      // File should now exist
      const provider = harness.getProvider();
      expect(provider.hasFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE)).toBe(true);
    });

    it('should handle RemoteFileNotFoundAPIError during download gracefully', async () => {
      const clientA = harness.createClient('client-a-test');

      // Download from empty remote (no existing file)
      const response = await clientA.downloadOps(0);

      // Should return empty result, not throw
      expect(response.ops).toEqual([]);
      expect(response.latestSeq).toBe(0);
      expect(response.hasMore).toBe(false);
    });
  });
});
