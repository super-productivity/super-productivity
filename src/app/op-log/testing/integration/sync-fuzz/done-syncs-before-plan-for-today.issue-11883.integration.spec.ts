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

/**
 * #11883: the desktop marks a task done, the phone adds the same task to
 * today, neither has synced. The desktop syncs first, so the phone resolves
 * its pending `planTasksForToday` (an opaque op) against the remote done.
 * Tracking the unscheduled task adds it to today too, beside its time delta.
 */
describe('#11883 a done that syncs before "add to today" from another device', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  // SuperSync rejects the auto-plan's upload; a file provider never rejects.
  for (const providerId of [undefined, SyncProviderId.Dropbox]) {
    for (const [doneIsNewer, isTracked] of [
      [true, false],
      [false, false],
      [true, true],
      [false, true],
    ]) {
      const order = doneIsNewer ? 'done is newer' : 'done is older';
      const provider = providerId ?? 'SuperSync';
      const how = isTracked ? 'by tracking' : 'directly';
      it(`keeps both edits on every device (${provider}, ${order}, ${how})`, async () => {
        const harness = await SyncFuzzHarness.create({ providerId });
        const desktop = await harness.addDevice('D');
        const phone = await harness.addDevice('P');
        const run = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
          harness.as(device, () => executeIntent(harness, intent));
        const planOnPhone = (): Promise<unknown> =>
          isTracked
            ? run(phone, ['track', TASK_ID, 3000])
            : harness.as(phone, () =>
                harness.dispatch(
                  TaskSharedActions.planTasksForToday({
                    taskIds: [TASK_ID],
                    today: fuzzDay(),
                    startOfNextDayDiffMs: 0,
                  }),
                ),
              );

        for (const intent of SETUP_INTENTS) await run(desktop, intent);
        await harness.sync(desktop);
        await harness.sync(phone);

        if (doneIsNewer) {
          await planOnPhone();
          harness.tick();
          await run(desktop, ['doneTask', TASK_ID, true]);
        } else {
          await run(desktop, ['doneTask', TASK_ID, true]);
          harness.tick();
          await planOnPhone();
        }
        await harness.sync(desktop);
        await harness.sync(phone);

        for (let round = 0; round < 3; round++) {
          harness.tick();
          await harness.sync(desktop);
          await harness.sync(phone);
        }
        await harness.restart(phone);
        await harness.restart(desktop);
        const reinstalled = await harness.addDevice('N');
        await harness.sync(reinstalled);

        const taskOn = (
          device: FuzzDevice,
        ): Promise<
          { isDone?: boolean; dueDay?: string | null; timeSpent?: number } | undefined
        > =>
          harness.as(device, async () => {
            const t = viewOf(await harness.state()).tasks.find((x) => x.id === TASK_ID);
            return (
              t && { isDone: t.isDone, dueDay: t.dueDay ?? null, timeSpent: t.timeSpent }
            );
          });
        const expected = {
          isDone: true,
          dueDay: fuzzDay(),
          timeSpent: isTracked ? 3000 : 0,
        };
        expect(harness.events).toEqual([]);
        expect({
          desktop: await taskOn(desktop),
          phone: await taskOn(phone),
          reinstalled: await taskOn(reinstalled),
        }).toEqual({ desktop: expected, phone: expected, reinstalled: expected });
      });
    }
  }
});
