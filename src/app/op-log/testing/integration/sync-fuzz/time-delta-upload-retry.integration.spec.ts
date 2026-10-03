import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { OperationLogSyncService } from '../../../sync/operation-log-sync.service';
import { SyncSessionValidationService } from '../../../sync/sync-session-validation.service';
import { OperationApplierService } from '../../../apply/operation-applier.service';
import {
  ActionType,
  isLwwUpdatePayload,
  OperationLogEntry,
} from '../../../core/operation.types';
import { executeIntent, Intent, SETUP_INTENTS, viewOf } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';
import { runFuzz } from './sync-fuzz-runner';

describe('time delta upload retries', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('preserves time when a recovered delta follows its own acknowledged patch', async () => {
    // Minimized from original tasks:20725005, whose 9000 ms became 5000.
    // Tracking the done task reopens it through the real production actions.
    const result = await runFuzz({
      steps: [
        { d: 'A', a: ['doneTask', 't2', true], s: 1, r: 1 },
        { d: 'B', a: ['track', 't2', 2000], s: 1 },
        { d: 'C', a: ['renameTask', 't2', 'C16'], s: 1 },
        { d: 'B', a: ['track', 't2', 4000] },
        { d: 'A', a: ['track', 't2', 3000] },
      ],
    });
    expect(result.failures).toEqual([]);
  }, 60000);

  for (const boundary of [
    'application',
    'download',
    'rejection',
    'acceptance',
  ] as const) {
    it(`counts a rejected delta once after restart at ${boundary}`, async () => {
      const harness = await SyncFuzzHarness.create();
      const [a, b, c] = [
        await harness.addDevice('A'),
        await harness.addDevice('B'),
        await harness.addDevice('C'),
      ];
      const run = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
        harness.as(device, () => executeIntent(harness, intent));
      const pending = (): Promise<OperationLogEntry[]> =>
        harness.as(b, () => TestBed.inject(OperationLogStoreService).getUnsynced());
      const inSession = (
        fn: (sync: OperationLogSyncService) => Promise<unknown>,
      ): Promise<unknown> =>
        harness.as(b, () =>
          TestBed.inject(SyncSessionValidationService).withSession(() =>
            fn(TestBed.inject(OperationLogSyncService)),
          ),
        );
      for (const intent of SETUP_INTENTS) await run(a, intent);
      for (const device of [a, b, c]) await harness.sync(device);
      await run(a, ['renameTask', 't1', 'A remote']);
      await harness.sync(a);
      await run(b, ['track', 't1', 3000]);
      await run(b, ['renameTask', 't1', 'B local']);
      const original = (await pending()).find(
        ({ op }) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
      )!;
      const download = (): Promise<unknown> =>
        inSession(async (sync) => {
          const applier = TestBed.inject(OperationApplierService);
          const apply = applier.applyOperations.bind(applier);
          const interrupted =
            boundary === 'application'
              ? spyOn(applier, 'applyOperations').and.rejectWith(
                  new Error('test: before apply'),
                )
              : undefined;
          try {
            return await sync.downloadRemoteOps(b.client, {
              isNeverSynced: false,
              keepDecryptedPrefix: true,
            });
          } finally {
            interrupted?.and.callFake(apply);
          }
        });
      if (boundary === 'application') {
        await expectAsync(download()).toBeRejectedWithError('test: before apply');
      } else {
        await download();
      }
      expect((await pending()).find(({ op }) => op.id === original.op.id)).toEqual(
        original,
      );

      const patch = (await pending()).find(({ op }) => isLwwUpdatePayload(op.payload))!;
      expect(patch).toBeDefined();
      const upload = b.client.uploadOps.bind(b.client);
      let rejectedDelta = false;
      let acceptedPatch = false;
      let lostResponse = false;
      b.client.uploadOps = async (...args) => {
        const result = await upload(...args);
        rejectedDelta ||= result.results.some(
          (r) => r.opId === original.op.id && !r.accepted,
        );
        acceptedPatch ||= result.results.some(
          (r) => r.opId === patch.op.id && r.accepted,
        );
        const deltaAccepted = result.results.some(
          (r) => r.opId === original.op.id && r.accepted,
        );
        if (
          !lostResponse &&
          ((boundary === 'rejection' && rejectedDelta && acceptedPatch) ||
            (boundary === 'acceptance' && deltaAccepted))
        ) {
          lostResponse = true;
          throw new Error('test: upload response lost');
        }
        return result;
      };
      if (boundary === 'rejection' || boundary === 'acceptance') {
        for (let attempt = 0; attempt < 3 && !lostResponse; attempt++) {
          try {
            await inSession((sync) =>
              sync.uploadPendingOps(b.client, { isNeverSynced: false }),
            );
          } catch (error) {
            expect((error as Error).message).toContain('test: upload response lost');
          }
        }
        expect(lostResponse).toBeTrue();
      }
      await harness.restart(b);
      for (let round = 0; round < 3; round++) {
        for (const device of [b, a, c]) await harness.sync(device);
      }
      expect(rejectedDelta).toBeTrue();
      expect(acceptedPatch).toBeTrue();
      expect(harness.events).toEqual([]);
      expect(await pending()).toEqual([]);
      const delivered = await harness.as(b, () =>
        TestBed.inject(OperationLogStoreService).getOpById(original.op.id),
      );
      if (boundary === 'application') {
        // The interrupted resolution also left the original rename pending.
        // It cannot commute past the accepted title patch, so the existing
        // snapshot fallback retires both originals without copying the delta.
        expect(delivered?.syncedAt).toBeUndefined();
        expect(delivered?.rejectedAt).toBeDefined();
        expect(delivered?.op).toEqual(original.op);
      } else {
        expect(delivered?.syncedAt).toBeDefined();
        expect(delivered?.rejectedAt).toBeUndefined();
      }
      expect(delivered?.seq).toBe(original.seq);
      expect(delivered?.op.payload).toEqual(original.op.payload);
      for (const device of [a, b, c]) {
        const deltaIds = await harness.as(device, async () =>
          (await TestBed.inject(OperationLogStoreService).getOpsAfterSeq(0))
            .filter(
              ({ op }) => op.actionType === ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
            )
            .map(({ op }) => op.id),
        );
        expect(deltaIds.every((id) => id === original.op.id)).toBeTrue();
        expect(deltaIds.length).toBeLessThanOrEqual(1);
        for (let restart = 0; restart < 2; restart++) {
          const task = viewOf(await harness.as(device, () => harness.state())).tasks.find(
            (t) => t.id === 't1',
          );
          expect(task?.timeSpent).toBe(3000);
          expect(task?.title).toBe('B local');
          await harness.restart(device);
        }
      }
    }, 60000);
  }
});
