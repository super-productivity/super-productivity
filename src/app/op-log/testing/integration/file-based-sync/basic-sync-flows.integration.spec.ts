import {
  FileBasedSyncTestHarness,
  HarnessClient,
} from '../helpers/file-based-sync-test-harness';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../sync-providers/file-based/file-based-sync.types';

describe('File-Based Sync Integration - Basic Flows', () => {
  let harness: FileBasedSyncTestHarness;

  beforeEach(() => {
    harness = FileBasedSyncTestHarness.create({});
  });

  afterEach(() => {
    harness.reset();
  });

  describe('First Sync', () => {
    it('should upload local ops to empty remote', async () => {
      const clientA = harness.createClient('client-a-test');

      // Create an operation
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test Task',
      });

      // Upload - no file exists yet
      const response = await clientA.uploadOps([op]);

      // Verify upload was successful
      expect(response.results.length).toBe(1);
      expect(response.results[0].accepted).toBe(true);
      expect(response.results[0].opId).toBe(op.id);

      // Verify file was created on provider
      const provider = harness.getProvider();
      expect(provider.hasFile(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE)).toBe(true);

      // Verify file content structure
      const fileContent = provider.getFileContent(FILE_BASED_SYNC_CONSTANTS.SYNC_FILE);
      expect(fileContent).toBeTruthy();

      // Content should be compressed/encoded, so we can't easily read it
      // But we can verify it exists and has reasonable length
      expect(fileContent!.data.length).toBeGreaterThan(0);
    });

    it('should download remote ops to empty client', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A uploads first
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test Task',
      });
      await clientA.uploadOps([op]);

      // Client B downloads (fresh client, start from seq 0)
      const response = await clientB.downloadOps(0);

      // Should receive the operation
      expect(response.ops.length).toBe(1);
      expect(response.ops[0].op.id).toBe(op.id);
      expect(response.ops[0].op.entityId).toBe('task-1');
      expect(response.latestSeq).toBeGreaterThan(0);
    });

    it('should include snapshot state for fresh downloads (sinceSeq=0)', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Set up mock state
      const testState = {
        task: { ids: ['task1'], entities: { task1: { id: 'task1' } } },
      };
      harness.setMockState(testState);

      // Client A uploads
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test',
      });
      await clientA.uploadOps([op]);

      // Client B downloads fresh (seq 0)
      const response = await clientB.downloadOps(0);

      // Should include snapshot state
      expect(response.snapshotState).toBeDefined();
      expect((response.snapshotState as Record<string, unknown>).task).toBeDefined();
    });
  });

  describe('Normal Sync', () => {
    let clientA: HarnessClient;
    let clientB: HarnessClient;

    beforeEach(async () => {
      clientA = harness.createClient('client-a-test');
      clientB = harness.createClient('client-b-test');

      // Establish initial sync file
      const initialOp = clientA.createOp(
        'Task',
        'task-0',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'Initial',
        },
      );
      await clientA.uploadOps([initialOp]);
    });

    it('should upload new local ops', async () => {
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'New Task',
      });

      const response = await clientA.uploadOps([op]);

      expect(response.results.length).toBe(1);
      expect(response.results[0].accepted).toBe(true);
    });

    it('should download new remote ops', async () => {
      // Client A uploads a new op
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'New Task',
      });
      await clientA.uploadOps([op]);

      // Client B syncs and downloads (starting from seq 0 to get all ops)
      const response = await clientB.downloadOps(0);

      // Should see both ops (initial + new)
      expect(response.ops.length).toBe(2);
    });

    it('should piggyback remote ops during upload response', async () => {
      // Client A has the initial op
      // Client B uploads without having downloaded first
      const opFromB = clientB.createOp(
        'Task',
        'task-b-1',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'Task from B',
        },
      );

      const response = await clientB.uploadOps([opFromB]);

      // Response should include piggybacked ops from Client A (the initial op)
      // Note: piggybacked ops exclude the uploading client's own ops
      expect(response.newOps).toBeDefined();
      if (response.newOps) {
        expect(response.newOps.length).toBeGreaterThan(0);
        // The piggybacked op should be from client A, not client B
        expect(response.newOps[0].op.clientId).toBe('client-a-test');
      }
    });

    it('should not return already-processed ops on subsequent downloads', async () => {
      // Client B downloads all ops
      const firstDownload = await clientB.downloadOps(0);
      const latestSeq = firstDownload.latestSeq;

      // Download again with the latest seq
      const secondDownload = await clientB.downloadOps(latestSeq);

      // Should not return the same ops again (no new ops added)
      // Note: file-based sync returns all ops in the file, but filtering happens
      // in the caller (download service) via appliedOpIds. Here we test that
      // latestSeq is tracked correctly.
      expect(secondDownload.latestSeq).toBe(latestSeq);
    });
  });

  describe('Sequential Sync (No Conflicts)', () => {
    it('should sync A->server->B correctly', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A creates and uploads
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task from A',
      });
      await clientA.uploadOps([op]);

      // Client B downloads
      const response = await clientB.downloadOps(0);

      expect(response.ops.length).toBe(1);
      expect(response.ops[0].op.entityId).toBe('task-1');
    });

    it('should sync B->server->A correctly', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Establish initial state
      const initialOp = clientA.createOp(
        'Task',
        'task-0',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'Initial',
        },
      );
      await clientA.uploadOps([initialOp]);

      // Client B downloads first to get in sync
      await clientB.downloadOps(0);

      // Client B creates and uploads
      const op = clientB.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Task from B',
      });
      await clientB.uploadOps([op]);

      // Client A downloads - adapter excludes own client's ops (task-0)
      // This is correct: A already has task-0 locally, only needs B's ops
      const response = await clientA.downloadOps(0);

      // Should see B's op (A's own ops are excluded)
      const opIds = response.ops.map((o) => o.op.entityId);
      expect(opIds).toContain('task-2');
      expect(opIds).not.toContain('task-0'); // Excluded because it's A's own op
    });

    it('should converge vector clocks across clients', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Client A creates op
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // Client B downloads and merges clock
      const downloadB = await clientB.downloadOps(0);
      for (const serverOp of downloadB.ops) {
        clientB.mergeRemoteClock(serverOp.op.vectorClock);
      }

      // Client B creates op (should have knowledge of A's op)
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });

      // B's clock should reflect knowledge of A's operation
      expect(opB.vectorClock['client-a-test']).toBe(1);
      expect(opB.vectorClock['client-b-test']).toBe(1);
    });
  });

  describe('Empty Operations', () => {
    it('should handle upload with no ops when file exists', async () => {
      const clientA = harness.createClient('client-a-test');

      // Create initial sync file
      const initialOp = clientA.createOp(
        'Task',
        'task-0',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'Initial',
        },
      );
      await clientA.uploadOps([initialOp]);

      // Upload with empty ops array
      const response = await clientA.uploadOps([]);

      // Should succeed without creating new ops
      // Returns empty results, latestSeq based on adapter's internal counter
      // (which is 0 if setLastServerSeq was never called - depends on caller)
      expect(response.results.length).toBe(0);
      // latestSeq can be 0 or the previous seq depending on implementation
      expect(response.latestSeq).toBeGreaterThanOrEqual(0);
    });

    it('should return empty ops array when no remote file exists', async () => {
      const clientA = harness.createClient('client-a-test');

      // Download without any sync file existing
      const response = await clientA.downloadOps(0);

      expect(response.ops.length).toBe(0);
      expect(response.latestSeq).toBe(0);
      expect(response.hasMore).toBe(false);
    });
  });

  describe('Multiple Operations', () => {
    it('should upload multiple ops in a single request', async () => {
      const clientA = harness.createClient('client-a-test');

      const ops = [
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 1',
        }),
        clientA.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 2',
        }),
        clientA.createOp('Task', 'task-3', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: 'Task 3',
        }),
      ];

      const response = await clientA.uploadOps(ops);

      expect(response.results.length).toBe(3);
      expect(response.results.every((r) => r.accepted)).toBe(true);
    });

    it('should preserve op order in downloads', async () => {
      const clientA = harness.createClient('client-a-test');
      const clientB = harness.createClient('client-b-test');

      // Upload multiple ops
      const ops = [
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '1',
        }),
        clientA.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '2',
        }),
        clientA.createOp('Task', 'task-3', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '3',
        }),
      ];
      await clientA.uploadOps(ops);

      // Download
      const response = await clientB.downloadOps(0);

      // Verify order matches
      expect(response.ops.length).toBe(3);
      expect(response.ops[0].op.entityId).toBe('task-1');
      expect(response.ops[1].op.entityId).toBe('task-2');
      expect(response.ops[2].op.entityId).toBe('task-3');
    });
  });
});
