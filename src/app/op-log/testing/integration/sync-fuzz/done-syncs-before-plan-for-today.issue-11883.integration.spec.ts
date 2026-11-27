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
 * today, neither has synced. Whichever syncs second resolves its pending op
 * against the other's: a pending `planTasksForToday` (an opaque op) against a
 * remote done, or a pending done against a remote plan.
 */
describe('#11883 a done that syncs before "add to today" from another device', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  // SuperSync rejects the auto-plan's upload; a file provider never rejects.
  for (const providerId of [undefined, SyncProviderId.Dropbox]) {
    // Not yet the auto-plan tracking emits beside its time delta: see the
    // shortcut in isPlanForTodayBesideDisjointUpdates.
    for (const [doneIsNewer, desktopSyncsFirst] of [
      [true, true],
      [false, true],
      [true, false],
      [false, false],
    ]) {
      const order = `done is ${doneIsNewer ? 'newer' : 'older'}, ${desktopSyncsFirst ? 'desktop' : 'phone'} syncs first`;
      const provider = providerId ?? 'SuperSync';
      it(`keeps both edits on every device (${provider}, ${order})`, async () => {
        const [first, second] = desktopSyncsFirst
          ? (['D', 'P'] as const)
          : (['P', 'D'] as const);
        const harness = await SyncFuzzHarness.create({ providerId });
        const desktop = await harness.addDevice('D');
        const phone = await harness.addDevice('P');
        const run = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
          harness.as(device, () => executeIntent(harness, intent));
        const planOnPhone = (): Promise<unknown> =>
          harness.as(phone, () =>
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
        const byName = { D: desktop, P: phone };
        await harness.sync(byName[first]);
        await harness.sync(byName[second]);

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
        ): Promise<{ isDone?: boolean; dueDay?: string | null } | undefined> =>
          harness.as(device, async () => {
            const t = viewOf(await harness.state()).tasks.find((x) => x.id === TASK_ID);
            return t && { isDone: t.isDone, dueDay: t.dueDay ?? null };
          });
        const expected = { isDone: true, dueDay: fuzzDay() };
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
