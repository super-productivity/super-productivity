import { TestBed } from '@angular/core/testing';
import { OpType } from '../../../core/operation.types';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { executeIntent, Intent, SETUP_INTENTS, viewOf } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

/**
 * Regression test for #11660: the first change a device made after a force
 * upload was lost on another device of a file-based sync target (WebDAV,
 * Dropbox, local file).
 *
 * The force upload's SYNC_IMPORT was appended without advancing the stored
 * vector clock, so the next local op got the import's clock again. A device
 * that took the forced snapshot and compacted (here B, after applying A's
 * edit) uses its snapshot clock, which contains the import's counter, as
 * every entity's frontier: the op was "superseded" and skipped for good, with
 * nothing pending and no error. A fresh device still got the change.
 */
describe('#11660 first change after a force upload on file sync', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('reaches every device that already took the forced state', async () => {
    const harness = await SyncFuzzHarness.create({});
    const a = await harness.addDevice('A');
    const b = await harness.addDevice('B');
    const c = await harness.addDevice('C');
    const devices = [a, b, c];
    const run = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
      harness.as(device, () => executeIntent(harness, intent));
    const titleOn = async (device: FuzzDevice, id: string): Promise<string | undefined> =>
      viewOf(await harness.as(device, () => harness.state())).tasks.find(
        (t) => t.id === id,
      )?.title;
    // C's own op log: the clock of the last op matching `isWanted`.
    const clockOnC = (
      isWanted: (opType: string, entityId?: string) => boolean,
    ): Promise<string> =>
      harness.as(c, async () => {
        const entries = await TestBed.inject(OperationLogStoreService).getOpsAfterSeq(0);
        const op = entries
          .map((e) => e.op)
          .filter((o) => isWanted(o.opType, o.entityId))
          .pop();
        return JSON.stringify(op?.vectorClock);
      });

    for (const intent of SETUP_INTENTS) await run(a, intent);
    for (const device of devices) await harness.sync(device);

    await run(c, ['forceUpload']);
    await harness.sync(a);
    // C's first change after the force upload, not uploaded yet.
    await run(c, ['renameTask', 't3', 'X']);
    await harness.sync(b);
    await run(a, ['renameTask', 't2', 'Y']);
    const importClock = await clockOnC((opType) => opType === OpType.SyncImport);
    const nextOpClock = await clockOnC(
      (opType, entityId) => opType === OpType.Update && entityId === 't3',
    );

    // The root cause, at the append every force-upload entry point shares
    // (settings, "Keep local", "use local" all reach handleServerMigration).
    expect(nextOpClock)
      .withContext('next op clock must differ from the SYNC_IMPORT clock')
      .not.toBe(importClock);

    for (let round = 0; round < 3; round++) {
      for (const device of devices) await harness.sync(device);
    }

    // Silent: no dialog, stop or sync error on any device.
    expect(harness.events).toEqual([]);
    const clocks = `SYNC_IMPORT clock ${importClock}, next op clock ${nextOpClock}`;
    for (const device of devices) {
      expect(await titleOn(device, 't2'))
        .withContext(`${device.name} t2; ${clocks}`)
        .toBe('Y');
      expect(await titleOn(device, 't3'))
        .withContext(`${device.name} t3; ${clocks}`)
        .toBe('X');
    }
  }, 60_000);
});
