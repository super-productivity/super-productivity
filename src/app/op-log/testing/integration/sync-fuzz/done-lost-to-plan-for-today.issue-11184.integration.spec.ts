import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { SyncProviderId } from '../../../sync-providers/provider.const';
import {
  executeIntent,
  fuzzDay,
  Intent,
  SETUP_INTENTS,
  viewOf,
} from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

const TASK_ID = 't3';
const SYNC_FILE = 'sync-data.json';

/** `isDone` of the task in the full-state snapshot the remote file carries. */
const isDoneInRemoteFile = (harness: SyncFuzzHarness): boolean | undefined => {
  const data = harness.fileTransport?.provider.getFileContent(SYNC_FILE)?.data ?? '';
  // The file starts with a version prefix; the JSON follows it.
  const file = JSON.parse(data.slice(data.indexOf('{'))) as {
    state: { task: { entities: Record<string, { isDone: boolean } | undefined> } };
  };
  return file.state.task.entities[TASK_ID]?.isDone;
};

/**
 * #11184 (Dropbox): tasks completed on the desktop stay open on the phone with
 * no error, later changes still arrive, the remote file says `isDone: true`
 * and only a reinstall fixes the phone.
 *
 * Shape: the desktop completes a task and has not synced yet; the phone then
 * adds the same task to today (`planTasksForToday`, also what tracking an
 * unscheduled task dispatches) and syncs first. On the desktop the done loses
 * LWW to that op, which is not a field patch, so the done is rejected: it stays
 * in the desktop's state but no op carries it any more (#10260). The desktop's
 * next upload writes its state, done included, into the file's snapshot, which
 * only a fresh install reads.
 *
 * No reducer throws here: the op is applied, not rejected by a reducer.
 */
describe('#11184 a done that loses to "add to today" from another device', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('reaches the other device', async () => {
    const harness = await SyncFuzzHarness.create({ providerId: SyncProviderId.Dropbox });
    const desktop = await harness.addDevice('D');
    const phone = await harness.addDevice('P');
    const run = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
      harness.as(device, () => executeIntent(harness, intent));
    const isDoneOn = (device: FuzzDevice): Promise<boolean | undefined> =>
      harness.as(
        device,
        async () =>
          viewOf(await harness.state()).tasks.find((t) => t.id === TASK_ID)?.isDone,
      );

    for (const intent of SETUP_INTENTS) await run(desktop, intent);
    await harness.sync(desktop);
    await harness.sync(phone);

    await run(desktop, ['doneTask', TASK_ID, true]);
    // A minute later, before the desktop has synced.
    harness.tick();
    await harness.as(phone, () =>
      harness.dispatch(
        TaskSharedActions.planTasksForToday({
          taskIds: [TASK_ID],
          today: fuzzDay(),
          startOfNextDayDiffMs: 0,
        }),
      ),
    );
    await harness.sync(phone);
    await harness.sync(desktop);

    // More syncs, a later desktop change and a phone reload.
    for (let round = 0; round < 3; round++) {
      harness.tick();
      await harness.sync(phone);
      await harness.sync(desktop);
    }
    await run(desktop, ['addTask', 'x1', 'T']);
    await harness.sync(desktop);
    await harness.sync(phone);
    await harness.restart(phone);
    const phoneTaskIds = await harness.as(phone, async () =>
      viewOf(await harness.state()).tasks.map((t) => t.id),
    );
    const reinstalled = await harness.addDevice('N');
    await harness.sync(reinstalled);

    // The reported symptom, as it is today: silent, and later changes arrive.
    expect(harness.events).toEqual([]);
    expect(phoneTaskIds).toContain('x1');
    // What has to hold instead: every device agrees and the done is kept.
    expect({
      desktop: await isDoneOn(desktop),
      remoteFile: isDoneInRemoteFile(harness),
      reinstalled: await isDoneOn(reinstalled),
      phone: await isDoneOn(phone),
    }).toEqual({ desktop: true, remoteFile: true, reinstalled: true, phone: true });
  });
});
