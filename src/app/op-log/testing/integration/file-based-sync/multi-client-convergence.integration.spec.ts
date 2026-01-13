import { FileBasedSyncTestHarness } from '../helpers/file-based-sync-test-harness';

describe('File-Based Sync Integration - Multi-Client Convergence', () => {
  let harness: FileBasedSyncTestHarness;

  beforeEach(() => {
    harness = FileBasedSyncTestHarness.create({});
  });

  afterEach(() => {
    harness.reset();
  });

  describe('Three-Client Chain Convergence', () => {
    it('should converge A→B→C sync chain correctly', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const clientC = harness.createClient('client-c');

      // Client A creates and uploads
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'From A',
      });
      await clientA.uploadOps([opA]);

      // Client B downloads and creates its own op
      await clientB.downloadOps(0);
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'From B',
      });
      await clientB.uploadOps([opB]);

      // Client C downloads all
      const downloadC = await clientC.downloadOps(0);

      // C should see both A and B's ops
      const entityIds = downloadC.ops.map((o) => o.op.entityId);
      expect(entityIds).toContain('task-a');
      expect(entityIds).toContain('task-b');
    });

    it('should handle C→B→A reverse sync correctly', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const clientC = harness.createClient('client-c');

      // Establish initial state with A
      const initialOp = clientA.createOp(
        'Task',
        'task-initial',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        { title: 'Initial' },
      );
      await clientA.uploadOps([initialOp]);

      // All clients sync
      await clientB.downloadOps(0);
      await clientC.downloadOps(0);

      // C creates and uploads
      const opC = clientC.createOp('Task', 'task-c', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'From C',
      });
      await clientC.uploadOps([opC]);

      // B downloads and adds
      await clientB.downloadOps(0);
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'From B',
      });
      await clientB.uploadOps([opB]);

      // A downloads and should see both B and C's ops
      const downloadA = await clientA.downloadOps(0);
      const entityIds = downloadA.ops.map((o) => o.op.entityId);
      expect(entityIds).toContain('task-b');
      expect(entityIds).toContain('task-c');
    });

    it('should converge all three clients to same state after round-trip', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const clientC = harness.createClient('client-c');
      const observer = harness.createClient('observer');

      // Each client creates an op
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      const opC = clientC.createOp('Task', 'task-c', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'C',
      });

      // All upload (with potential conflicts/merges)
      await clientA.uploadOps([opA]);
      await clientB.uploadOps([opB]);
      await clientC.uploadOps([opC]);

      // All download to get final state
      const finalDownload = await observer.downloadOps(0);
      const entityIds = finalDownload.ops.map((o) => o.op.entityId);

      // All three ops should be present
      expect(entityIds).toContain('task-a');
      expect(entityIds).toContain('task-b');
      expect(entityIds).toContain('task-c');
    });
  });

  describe('Late Joiner Bootstrapping', () => {
    it('should bootstrap late joiner with snapshot state', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Set up mock state
      const mockState = {
        task: {
          ids: ['existing-task'],
          // eslint-disable-next-line @typescript-eslint/naming-convention
          entities: { 'existing-task': { id: 'existing-task', title: 'Existing' } },
        },
      };
      harness.setMockState(mockState);

      // Client A creates some ops
      const ops = [
        clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '1',
        }),
        clientA.createOp('Task', 'task-2', 'CRT', 'TaskActionTypes.ADD_TASK', {
          title: '2',
        }),
      ];
      await clientA.uploadOps(ops);

      // Client B joins late (fresh download from seq 0)
      const download = await clientB.downloadOps(0);

      // Should include snapshot state
      expect(download.snapshotState).toBeDefined();
      expect((download.snapshotState as Record<string, unknown>).task).toBeDefined();

      // Should also include ops
      expect(download.ops.length).toBeGreaterThan(0);
    });

    it('should allow late joiner to upload after bootstrapping', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Client A syncs first
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // Client B bootstraps
      await clientB.downloadOps(0);

      // Merge A's clock knowledge
      const downloadB = await clientB.downloadOps(0);
      for (const serverOp of downloadB.ops) {
        clientB.mergeRemoteClock(serverOp.op.vectorClock);
      }

      // Client B should be able to upload
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      const uploadResponse = await clientB.uploadOps([opB]);

      expect(uploadResponse.results[0].accepted).toBe(true);
    });
  });

  describe('Vector Clock Convergence', () => {
    it('should merge vector clocks across three clients', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const clientC = harness.createClient('client-c');

      // A creates op
      const opA = clientA.createOp('Task', 'task-a', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'A',
      });
      await clientA.uploadOps([opA]);

      // B downloads and creates op (knows about A)
      const downloadB = await clientB.downloadOps(0);
      for (const serverOp of downloadB.ops) {
        clientB.mergeRemoteClock(serverOp.op.vectorClock);
      }
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      await clientB.uploadOps([opB]);

      // B's op should have knowledge of A
      expect(opB.vectorClock['client-a']).toBe(1);
      expect(opB.vectorClock['client-b']).toBe(1);

      // C downloads and creates op (knows about A and B)
      const downloadC = await clientC.downloadOps(0);
      for (const serverOp of downloadC.ops) {
        clientC.mergeRemoteClock(serverOp.op.vectorClock);
      }
      const opC = clientC.createOp('Task', 'task-c', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'C',
      });

      // C's clock should have knowledge of both A and B
      expect(opC.vectorClock['client-a']).toBe(1);
      expect(opC.vectorClock['client-b']).toBe(1);
      expect(opC.vectorClock['client-c']).toBe(1);
    });

    it('should preserve causality in vector clock after sync cycle', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // A creates first op
      const opA1 = clientA.createOp(
        'Task',
        'task-a1',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'A1',
        },
      );
      expect(opA1.vectorClock['client-a']).toBe(1);
      await clientA.uploadOps([opA1]);

      // B downloads, knows about A1
      const downloadB = await clientB.downloadOps(0);
      clientB.mergeRemoteClock(downloadB.ops[0].op.vectorClock);

      // B creates op
      const opB = clientB.createOp('Task', 'task-b', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'B',
      });
      expect(opB.vectorClock['client-a']).toBe(1);
      expect(opB.vectorClock['client-b']).toBe(1);
      await clientB.uploadOps([opB]);

      // A downloads, knows about B
      const downloadA = await clientA.downloadOps(0);
      for (const serverOp of downloadA.ops) {
        clientA.mergeRemoteClock(serverOp.op.vectorClock);
      }

      // A creates second op, should know about B
      const opA2 = clientA.createOp(
        'Task',
        'task-a2',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'A2',
        },
      );
      expect(opA2.vectorClock['client-a']).toBe(2);
      expect(opA2.vectorClock['client-b']).toBe(1);
    });
  });

  describe('Server Migration Detection', () => {
    it('should detect when server is empty but client has synced ops', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Establish sync state
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Test',
      });
      await clientA.uploadOps([op]);

      // Client B syncs
      const firstDownload = await clientB.downloadOps(0);
      expect(firstDownload.ops.length).toBeGreaterThan(0);

      // Simulate server migration: reset the provider (clear all files)
      harness.getProvider().reset();

      // Client B tries to download from where it left off
      const secondDownload = await clientB.downloadOps(firstDownload.latestSeq);

      // Should get empty ops (file doesn't exist)
      expect(secondDownload.ops.length).toBe(0);
      expect(secondDownload.latestSeq).toBe(0);
    });

    it('should handle re-initialization after server reset', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');

      // Initial sync
      const op = clientA.createOp('Task', 'task-1', 'CRT', 'TaskActionTypes.ADD_TASK', {
        title: 'Before Reset',
      });
      await clientA.uploadOps([op]);
      await clientB.downloadOps(0);

      // Server reset
      harness.getProvider().reset();

      // Client A re-initializes with new data
      const newOp = clientA.createOp(
        'Task',
        'task-new',
        'CRT',
        'TaskActionTypes.ADD_TASK',
        {
          title: 'After Reset',
        },
      );
      await clientA.uploadOps([newOp]);

      // Client B downloads fresh
      const download = await clientB.downloadOps(0);

      // Should see the new data (task-1 is gone, only task-new exists)
      const entityIds = download.ops.map((o) => o.op.entityId);
      expect(entityIds).toContain('task-new');
      expect(entityIds).not.toContain('task-1');
    });
  });

  describe('Rapid Multi-Client Sync', () => {
    it('should handle rapid sequential syncs from multiple clients', async () => {
      const clientA = harness.createClient('client-a');
      const clientB = harness.createClient('client-b');
      const clientC = harness.createClient('client-c');
      const observer = harness.createClient('observer');

      // Rapid sequential uploads
      for (let i = 0; i < 3; i++) {
        await clientA.uploadOps([
          clientA.createOp('Task', `task-a-${i}`, 'CRT', 'TaskActionTypes.ADD_TASK', {
            title: `A${i}`,
          }),
        ]);
        await clientB.uploadOps([
          clientB.createOp('Task', `task-b-${i}`, 'CRT', 'TaskActionTypes.ADD_TASK', {
            title: `B${i}`,
          }),
        ]);
        await clientC.uploadOps([
          clientC.createOp('Task', `task-c-${i}`, 'CRT', 'TaskActionTypes.ADD_TASK', {
            title: `C${i}`,
          }),
        ]);
      }

      // Final download should have all 9 ops
      const download = await observer.downloadOps(0);
      expect(download.ops.length).toBe(9);

      // Verify all ops present
      const entityIds = download.ops.map((o) => o.op.entityId);
      for (let i = 0; i < 3; i++) {
        expect(entityIds).toContain(`task-a-${i}`);
        expect(entityIds).toContain(`task-b-${i}`);
        expect(entityIds).toContain(`task-c-${i}`);
      }
    });
  });
});
