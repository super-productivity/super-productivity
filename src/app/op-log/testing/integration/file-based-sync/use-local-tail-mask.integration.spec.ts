import { TestBed } from '@angular/core/testing';
import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import {
  FileBasedSyncTestHarness,
  HarnessClient,
} from '../helpers/file-based-sync-test-harness';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';

/**
 * #9170: client B chooses "Keep local" (USE_LOCAL), which replaces the remote
 * with its snapshot and resets syncVersion to 1. A tail op from B then walks
 * syncVersion back up to the value established client A expects and makes
 * recentOps non-empty, masking the syncVersion/recentOps replacement checks.
 * A must still detect the gap and re-hydrate B's snapshot instead of applying
 * the tail alone on top of its stale state.
 *
 * Detection runs on the decrypted file, so encryption is covered only to prove
 * it stays outside the branch.
 */
const stateWithTask = (taskId: string): unknown => ({
  task: { ids: [taskId], entities: { [taskId]: { id: taskId, title: taskId } } },
});

for (const isUseSplitSyncFiles of [false, true]) {
  for (const isEncrypt of [false, true]) {
    describe(`#9170 USE_LOCAL snapshot masked by a tail op (split=${isUseSplitSyncFiles}, encrypt=${isEncrypt})`, () => {
      let harness: FileBasedSyncTestHarness;
      const TIMEOUT = 10000;

      beforeAll(() => {
        setArgon2ParamsForTesting({ parallelism: 1, memorySize: 8, iterations: 1 });
      });

      afterAll(() => {
        setArgon2ParamsForTesting();
        clearSessionKeyCache();
      });

      beforeEach(() => {
        clearSessionKeyCache();
        const opLogStoreSpy = jasmine.createSpyObj<OperationLogStoreService>(
          'OperationLogStoreService',
          ['getLatestFullStateOpEntry'],
        );
        opLogStoreSpy.getLatestFullStateOpEntry.and.resolveTo(undefined);
        TestBed.configureTestingModule({
          providers: [{ provide: OperationLogStoreService, useValue: opLogStoreSpy }],
        });
        harness = FileBasedSyncTestHarness.create({
          isUseSplitSyncFiles,
          ...(isEncrypt
            ? {
                encryptAndCompressCfg: { isEncrypt: true, isCompress: false },
                encryptKey: 'test-encryption-key-9170',
              }
            : {}),
        });
      });

      afterEach(() => {
        harness.reset();
      });

      const addTaskOp = (
        client: HarnessClient,
        taskId: string,
      ): ReturnType<HarnessClient['createOp']> =>
        client.createOp('TASK', taskId, 'CRT', '[Task] Add', { title: taskId });

      /** A has uploaded twice, so it expects syncVersion 2. */
      const seedFromA = async (clientA: HarnessClient): Promise<void> => {
        harness.setMockState(stateWithTask('task-a'));
        await clientA.uploadOps([addTaskOp(clientA, 'task-a')]);
        const response = await clientA.uploadOps([addTaskOp(clientA, 'task-a2')]);
        // As OperationLogUploadService does after a file-based upload.
        await clientA.adapter.setLastServerSeq(response.latestSeq);
      };

      /** B keeps its local data, then uploads one tail op (syncVersion back to 2). */
      const replaceFromBWithTail = async (clientB: HarnessClient): Promise<string> => {
        harness.setMockState(stateWithTask('task-b'));
        await clientB.adapter.uploadSnapshot(
          stateWithTask('task-b'),
          clientB.clientId,
          'recovery',
          clientB.getCurrentClock(),
          1,
          undefined,
          'use-local-op',
        );
        const tailOp = addTaskOp(clientB, 'task-b2');
        const response = await clientB.uploadOps([tailOp]);
        expect(response.latestSeq).toBe(2);
        return tailOp.id;
      };

      const expectReplacementHydrated = async (
        reader: HarnessClient,
        readerClientId: string,
        sinceSeq: number,
        tailOpId: string,
      ): Promise<void> => {
        const incremental = await reader.adapter.downloadOps(sinceSeq, readerClientId);
        expect(incremental.gapDetected).toBeTrue();

        const full = await reader.adapter.downloadOps(0, readerClientId);
        const taskIds = (full.snapshotState as { task: { ids: string[] } }).task.ids;
        expect(taskIds).toContain('task-b');
        expect(taskIds).not.toContain('task-a');
        expect(full.ops.map(({ op }) => op.id)).toContain(tailOpId);
      };

      it(
        'flags a gap for a reader that only uploaded before the replacement',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);

          const tailOpId = await replaceFromBWithTail(clientB);

          await expectReplacementHydrated(clientA, 'client-a', 2, tailOpId);
        },
        TIMEOUT,
      );

      it(
        'flags a gap for a reader that restarted before the replacement',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);
          // A fresh adapter service stands in for A after an app restart. It
          // loads A's persisted state now, before B's writes share localStorage.
          const restartedA = harness.createClient('client-a-restarted');
          expect(await restartedA.adapter.getLastServerSeq()).toBe(2);

          const tailOpId = await replaceFromBWithTail(clientB);

          await expectReplacementHydrated(restartedA, 'client-a', 2, tailOpId);
        },
        TIMEOUT,
      );

      it(
        'control: no gap when B builds on the file A last saw',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);

          const seen = await clientB.downloadOps(0);
          clientB.mergeRemoteClock(seen.snapshotVectorClock ?? {});
          await clientB.uploadOps([addTaskOp(clientB, 'task-b2')]);

          const incremental = await clientA.adapter.downloadOps(2, 'client-a');
          expect(incremental.gapDetected).toBeFalse();
          expect(incremental.ops.map(({ op }) => op.entityId)).toContain('task-b2');
        },
        TIMEOUT,
      );
    });
  }
}
