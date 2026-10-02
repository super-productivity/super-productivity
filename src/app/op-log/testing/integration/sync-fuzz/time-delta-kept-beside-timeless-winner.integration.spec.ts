import { TestBed } from '@angular/core/testing';
import { OperationLogSyncService } from '../../../sync/operation-log-sync.service';
import { SyncSessionValidationService } from '../../../sync/sync-session-validation.service';
import { executeIntent, Intent, SETUP_INTENTS, viewOf } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * #10378 through the real rejection, download and rebase paths, with an
 * upload race the trace runner cannot express: B tracks the unscheduled task
 * t3 (auto-plan + delta) and then renames t1, B downloads, A uploads a
 * concurrent edit of t3, and only then B uploads. The server rejects B's t3
 * ops (CONFLICT_CONCURRENT) and accepts the rename, so A's next edit of t3
 * carries B's counter without having received B's delta: the clock covers the
 * delta by inherited knowledge only (D10 refined, case 3). The delta must
 * still count once on every device.
 */
describe('time delta beside a timeless winner, through an upload race (#10378)', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  const run = (
    harness: SyncFuzzHarness,
    device: FuzzDevice,
    intent: Intent,
  ): Promise<unknown> => harness.as(device, () => executeIntent(harness, intent));
  const inSession = (
    harness: SyncFuzzHarness,
    device: FuzzDevice,
    fn: (sync: OperationLogSyncService) => Promise<unknown>,
  ): Promise<unknown> =>
    harness.as(device, () =>
      TestBed.inject(SyncSessionValidationService).withSession(() =>
        fn(TestBed.inject(OperationLogSyncService)),
      ),
    );
  const timeOf = async (
    harness: SyncFuzzHarness,
    device: FuzzDevice,
  ): Promise<number | undefined> =>
    viewOf(await harness.as(device, () => harness.state())).tasks.find(
      (t) => t.id === 't3',
    )?.timeSpent;

  const raceTimes = async (raceIntent: Intent): Promise<(number | undefined)[]> => {
    const harness = await SyncFuzzHarness.create();
    const [a, b, c] = [
      await harness.addDevice('A'),
      await harness.addDevice('B'),
      await harness.addDevice('C'),
    ];
    for (const intent of SETUP_INTENTS) await run(harness, a, intent);
    for (const device of [a, b, c]) await harness.sync(device);

    await run(harness, b, ['track', 't3', 3000]);
    await run(harness, b, ['renameTask', 't1', 'B later']);
    await inSession(harness, b, (sync) =>
      sync.downloadRemoteOps(b.client, {
        isNeverSynced: false,
        keepDecryptedPrefix: true,
      }),
    );
    await run(harness, a, raceIntent);
    await harness.sync(a);
    await inSession(harness, b, (sync) =>
      sync.uploadPendingOps(b.client, { isNeverSynced: false }),
    );
    // A learns B's accepted rename, then edits t3 again: a clock that covers
    // B's counter without B's delta. Retries: every device syncs until quiet.
    await harness.sync(a);
    await run(harness, a, ['renameTask', 't3', 'A again']);
    await harness.sync(a);
    for (let round = 0; round < 3; round++) {
      for (const device of [b, a, c]) await harness.sync(device);
    }
    expect(harness.events).toEqual([]);
    const times: (number | undefined)[] = [];
    for (const device of [a, b, c]) times.push(await timeOf(harness, device));
    // A restart replays each op log: the delta still counts once.
    for (const device of [a, b, c]) await harness.restart(device);
    const restarted: (number | undefined)[] = [];
    for (const device of [a, b, c]) restarted.push(await timeOf(harness, device));
    expect(restarted).toEqual(times);
    return times;
  };

  // On master A and C showed 0: B's rejected delta never reached them.
  it('counts B tracked time once on every device when A races a rename', async () => {
    expect(await raceTimes(['renameTask', 't3', 'A'])).toEqual([3000, 3000, 3000]);
  }, 60_000);

  // Pins today's loss, the same on master. B's delta is rebased and accepted,
  // but A's no-pending crossing then emits a whole-task LWW row whose merged
  // clock claims B's knowledge while its total lacks B's 3000, and the row
  // overwrites it everywhere: the resolution-row mechanism of #10438, outside
  // this fix (decision 5a: row values are not read). Expected once fixed: 5000.
  it('pins the #10438 row loss when A races its own tick', async () => {
    expect(await raceTimes(['track', 't3', 2000])).toEqual([2000, 2000, 2000]);
  }, 60_000);
});
