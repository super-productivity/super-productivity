import { TestBed } from '@angular/core/testing';
import { clearSessionKeyCache, setArgon2ParamsForTesting } from '@sp/sync-core';
import {
  FileBasedSyncTestHarness,
  HarnessClient,
} from '../helpers/file-based-sync-test-harness';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { FILE_BASED_SYNC_CONSTANTS } from '../../../sync-providers/file-based/file-based-sync.types';
import { ActionType } from '../../../core/action-types.enum';
import { FileSnapshotOpDownloadResponse } from '../../../sync-providers/provider.interface';
import { UploadRevToMatchMismatchAPIError } from '../../../core/errors/sync-errors';
import { SnackService } from '../../../../core/snack/snack.service';

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
const stateWithTask = (...taskIds: string[]): unknown => ({
  task: {
    ids: taskIds,
    entities: Object.fromEntries(taskIds.map((id) => [id, { id, title: id }])),
  },
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
          providers: [
            { provide: OperationLogStoreService, useValue: opLogStoreSpy },
            // .bak recovery surfaces a notice.
            {
              provide: SnackService,
              useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
            },
          ],
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
        harness.setMockState(stateWithTask('task-a', 'task-a2'));
        const response = await clientA.uploadOps([addTaskOp(clientA, 'task-a2')]);
        // As OperationLogUploadService does after a file-based upload.
        await clientA.adapter.setLastServerSeq(response.latestSeq);
      };

      /** B keeps its local data, then uploads one tail op (syncVersion back to 2). */
      const replaceFromBWithTail = async (clientB: HarnessClient): Promise<string> => {
        addTaskOp(clientB, 'task-b');
        harness.setMockState(stateWithTask('task-b'));
        const replacement = clientB.createOp(
          'ALL',
          'ALL',
          'SYNC_IMPORT',
          ActionType.LOAD_ALL_DATA,
          stateWithTask('task-b'),
        );
        await clientB.adapter.uploadSnapshot(
          stateWithTask('task-b'),
          clientB.clientId,
          'recovery',
          replacement.vectorClock,
          1,
          undefined,
          replacement.id,
        );
        // The next sync downloads the replacement before appending its tail.
        await clientB.adapter.downloadOps(1, clientB.clientId);
        await clientB.adapter.setLastServerSeq(1);
        const tailOp = addTaskOp(clientB, 'task-b2');
        harness.setMockState(stateWithTask('task-b', 'task-b2'));
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

        const full = (await reader.adapter.downloadOps(
          0,
          readerClientId,
        )) as FileSnapshotOpDownloadResponse;
        const taskIds = (full.snapshotState as { task: { ids: string[] } }).task.ids;
        expect(taskIds).toContain('task-b');
        expect(taskIds).not.toContain('task-a');
        expect(full.ops.map(({ op }) => op.id)).toContain(tailOpId);
        // The monolith already includes the tail; a split snapshot can precede
        // it. Check the hydration/replay contract used by the sync service.
        const included = new Set(full.snapshotAppliedOpIds);
        const hydratedIds = new Set(taskIds);
        for (const { op } of full.ops) {
          if (!included.has(op.id) && op.opType === 'CRT') {
            hydratedIds.add(op.entityId!);
          }
        }
        expect([...hydratedIds].sort()).toEqual(['task-b', 'task-b2']);
        // A cancelled hydration must not advance the baseline.
        expect(
          (await reader.adapter.downloadOps(sinceSeq, readerClientId)).gapDetected,
        ).toBeTrue();
        await reader.adapter.setLastServerSeq(full.latestSeq);
        expect(
          (await reader.adapter.downloadOps(full.latestSeq, readerClientId)).gapDetected,
        ).toBeFalse();
        await reader.adapter.setLastServerSeq(full.latestSeq);
      };

      for (const restart of [false, true]) {
        it(
          `flags a dominating replacement after shared history (restart=${restart})`,
          async () => {
            const clientA = harness.createClient('client-a');
            const clientB = harness.createClient('client-b');
            await seedFromA(clientA);
            const seen = await clientB.downloadOps(0);
            clientB.mergeRemoteClock(seen.snapshotVectorClock ?? {});
            for (const { op } of seen.ops) {
              clientB.mergeRemoteClock(op.vectorClock);
            }
            await clientB.adapter.setLastServerSeq(seen.latestSeq);
            const reader = restart ? harness.createClient('client-a-restarted') : clientA;

            const tailOpId = await replaceFromBWithTail(clientB);

            await expectReplacementHydrated(reader, 'client-a', 2, tailOpId);
          },
          TIMEOUT,
        );
      }

      it(
        'detects a replacement even when the reader only saw version 1',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          harness.setMockState(stateWithTask('task-a'));
          const uploaded = await clientA.uploadOps([addTaskOp(clientA, 'task-a')]);
          await clientA.adapter.setLastServerSeq(uploaded.latestSeq);
          clientB.mergeRemoteClock(clientA.getCurrentClock());

          const tailOpId = await replaceFromBWithTail(clientB);

          await expectReplacementHydrated(clientA, 'client-a', 1, tailOpId);
        },
        TIMEOUT,
      );

      it(
        'retains replacement detection after all reused-version tail ops are trimmed',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);
          clientB.mergeRemoteClock(clientA.getCurrentClock());
          await replaceFromBWithTail(clientB);

          // One batch trims every sv=2 op. The retained floor is now 3, exactly
          // sinceSeq+1, so neither version reuse nor the trimming check can help.
          const tail = Array.from(
            { length: FILE_BASED_SYNC_CONSTANTS.MAX_RECENT_OPS + 1 },
            () => addTaskOp(clientB, 'task-b2'),
          );
          await clientB.uploadOps(tail);

          await expectReplacementHydrated(clientA, 'client-a', 2, tail.at(-1)!.id);
        },
        TIMEOUT,
      );

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
        'refuses to append to a replacement the uploader never hydrated',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);
          clientB.mergeRemoteClock(clientA.getCurrentClock());

          // B replaces after A's last poll, so A's upload reads it fresh.
          const tailOpId = await replaceFromBWithTail(clientB);
          harness.setMockState(stateWithTask('task-a', 'task-a2', 'task-a3'));
          await expectAsync(
            clientA.uploadOps([addTaskOp(clientA, 'task-a3')]),
          ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);

          // Appending would have overwritten B's snapshot with A's stale state
          // and marked it seen; instead A's next download hydrates it.
          await expectReplacementHydrated(clientA, 'client-a', 2, tailOpId);
          // Once hydrated, the refused upload goes through.
          await expectAsync(
            clientA.uploadOps([addTaskOp(clientA, 'task-b3')]),
          ).toBeResolved();
        },
        TIMEOUT,
      );

      it(
        'treats a replacement recovered from the backup file as unseen',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);
          clientB.mergeRemoteClock(clientA.getCurrentClock());
          await replaceFromBWithTail(clientB);

          // A torn tail write leaves only the .bak, which holds B's replacement.
          const provider = harness.getProvider();
          const primary = isUseSplitSyncFiles
            ? FILE_BASED_SYNC_CONSTANTS.OPS_FILE
            : FILE_BASED_SYNC_CONSTANTS.SYNC_FILE;
          const { data } = provider.getFileContent(primary)!;
          provider.setFileContent(primary, data.slice(0, data.length / 2));
          const recovered = await clientA.adapter.downloadOps(2, 'client-a');
          expect(recovered.gapDetected).toBeTrue();

          // The upload reuses the recovered data; healing the primary from it
          // before hydrating would write A's stale state over B's replacement.
          harness.setMockState(stateWithTask('task-a', 'task-a2', 'task-a3'));
          await expectAsync(
            clientA.uploadOps([addTaskOp(clientA, 'task-a3')]),
          ).toBeRejectedWithError(UploadRevToMatchMismatchAPIError);

          const full = (await clientA.adapter.downloadOps(
            0,
            'client-a',
          )) as FileSnapshotOpDownloadResponse;
          const taskIds = (full.snapshotState as { task: { ids: string[] } }).task.ids;
          expect(taskIds).toEqual(['task-b']);
          await clientA.adapter.setLastServerSeq(full.latestSeq);
          harness.setMockState(stateWithTask('task-b', 'task-b3'));
          await expectAsync(
            clientA.uploadOps([addTaskOp(clientA, 'task-b3')]),
          ).toBeResolved();
        },
        TIMEOUT,
      );

      it(
        'control: no gap when B appends to a snapshot base A already knows',
        async () => {
          const clientA = harness.createClient('client-a');
          const clientB = harness.createClient('client-b');
          await seedFromA(clientA);
          await clientA.adapter.uploadSnapshot(
            stateWithTask('task-a', 'task-a2'),
            clientA.clientId,
            'recovery',
            clientA.getCurrentClock(),
            1,
            undefined,
            'known-base',
          );

          const seen = await clientB.downloadOps(0);
          clientB.mergeRemoteClock(seen.snapshotVectorClock ?? {});
          // As the sync service does once the snapshot is hydrated.
          await clientB.adapter.setLastServerSeq(seen.latestSeq);
          await clientB.uploadOps([addTaskOp(clientB, 'task-b2')]);

          const incremental = await clientA.adapter.downloadOps(1, 'client-a');
          expect(incremental.gapDetected).toBeFalse();
          expect(incremental.ops.map(({ op }) => op.entityId)).toContain('task-b2');
        },
        TIMEOUT,
      );
    });
  }
}
