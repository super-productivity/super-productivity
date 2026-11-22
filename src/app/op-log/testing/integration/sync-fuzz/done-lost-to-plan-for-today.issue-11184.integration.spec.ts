import { Task } from '../../../../features/tasks/task.model';
import {
  syncTimeSpent,
  TimeTrackingActions,
} from '../../../../features/time-tracking/store/time-tracking.actions';
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
const TRACKED_MS = 5000;
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

  // Several tasks at once: the day-change auto-plan or a multi-select add.
  // Tracked: time tracked on the task right before the done, so its
  // `syncTimeSpent` delta is pending beside the done. The delta stays pending
  // beside a remote add to today for one task (`timeDeltasSurvivingLww`).
  for (const [planned, taskIds, isTracked] of [
    ['alone', [TASK_ID], false],
    ['with another task', [TASK_ID, 't1'], false],
    ['alone', [TASK_ID], true],
  ] as const) {
    const tracked = isTracked ? ', time tracked before the done' : '';
    it(`reaches the other device (planned ${planned}${tracked})`, async () => {
      const harness = await SyncFuzzHarness.create({
        providerId: SyncProviderId.Dropbox,
      });
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

      if (isTracked) {
        // TaskService's tick and flush, without the auto-plan of `track`:
        // the task is not planned for today when the desktop works on it.
        await harness.as(desktop, async () => {
          const root = (await harness.state()) as {
            tasks: { entities: Record<string, Task> };
          };
          const task = root.tasks.entities[TASK_ID];
          await harness.dispatch(
            TimeTrackingActions.addTimeSpent({
              task,
              date: fuzzDay(),
              duration: TRACKED_MS,
              isFromTrackingReminder: false,
            }),
          );
          await harness.dispatch(
            syncTimeSpent({ taskId: TASK_ID, date: fuzzDay(), duration: TRACKED_MS }),
          );
        });
      }
      await run(desktop, ['doneTask', TASK_ID, true]);
      // A minute later, before the desktop has synced.
      harness.tick();
      await harness.as(phone, () =>
        harness.dispatch(
          TaskSharedActions.planTasksForToday({
            taskIds: [...taskIds],
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
      // Replay is status-blind: a kept delta must not count twice.
      await harness.restart(desktop);
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
      // The tracked time arrives once, beside the done.
      const timeSpentOn = (device: FuzzDevice): Promise<number | undefined> =>
        harness.as(
          device,
          async () =>
            viewOf(await harness.state()).tasks.find((t) => t.id === TASK_ID)?.timeSpent,
        );
      const time = isTracked ? TRACKED_MS : 0;
      expect({
        desktop: await timeSpentOn(desktop),
        reinstalled: await timeSpentOn(reinstalled),
        phone: await timeSpentOn(phone),
      }).toEqual({ desktop: time, reinstalled: time, phone: time });
    });
  }
});
