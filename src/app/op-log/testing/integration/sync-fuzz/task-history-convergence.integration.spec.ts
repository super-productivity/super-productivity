import { TaskHistoryEvent } from '../../../../features/tasks/task-history/task-history.model';
import { TaskState } from '../../../../features/tasks/task.model';
import { PluginUserDataState } from '../../../../plugins/plugin-persistence.model';
import { executeIntent, FuzzStep, SETUP_INTENTS } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

describe('Task history delivery convergence', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('preserves exact author facts and delivery rows across retry, fresh hydration and restart', async () => {
    const harness = await SyncFuzzHarness.create();
    const snapshotOf = async (
      device: FuzzDevice,
    ): Promise<{ task: TaskState; pluginUserData: PluginUserDataState }> =>
      (await harness.syncedState(device)) as unknown as {
        task: TaskState;
        pluginUserData: PluginUserDataState;
      };
    const devices = await Promise.all(
      ['A', 'B', 'C'].map((name) => harness.addDevice(name)),
    );
    const a = devices[0];
    await harness.as(a, async () => {
      for (const intent of SETUP_INTENTS) await executeIntent(harness, intent);
    });
    for (const device of devices) await harness.sync(device);

    // The real upload-retry trace that first exposed the delivery divergence.
    const steps: FuzzStep[] = [
      { d: 'A', a: ['doneTask', 't2', true], s: 1, r: 1 },
      { d: 'B', a: ['track', 't2', 2000], s: 1 },
      { d: 'C', a: ['renameTask', 't2', 'C16'], s: 1 },
      { d: 'B', a: ['track', 't2', 4000] },
      { d: 'A', a: ['track', 't2', 3000] },
    ];
    const expectedEvents: Record<string, TaskHistoryEvent> = {};
    for (const step of steps) {
      harness.tick();
      const device = devices.find((candidate) => candidate.name === step.d)!;
      await harness.as(device, () => executeIntent(harness, step.a!));
      const snapshot = await snapshotOf(device);
      Object.assign(expectedEvents, snapshot.task.taskHistory?.t2?.events);
      if (step.s) await harness.sync(device);
      if (step.r) await harness.restart(device);
    }
    expect(Object.keys(expectedEvents).length).toBeGreaterThan(0);
    for (let round = 0; round < 6; round++) {
      for (const device of devices) await harness.sync(device);
    }
    const fresh = await harness.addDevice('F');
    await harness.sync(fresh);
    const reference = await snapshotOf(fresh);
    const byId = (rows: PluginUserDataState | undefined): Record<string, string> =>
      Object.fromEntries((rows ?? []).map(({ id, data }) => [id, data]));
    expect(reference.pluginUserData!.length).toBeGreaterThan(1);

    for (const device of [...devices, fresh]) {
      for (let restart = 0; restart < 2; restart++) {
        const snapshot = await snapshotOf(device);
        const context = `${device.name}, restart ${restart}`;
        // Distinguish an ordering mismatch from missing IDs or changed payloads.
        expect(byId(snapshot.pluginUserData))
          .withContext(`${context}: full delivery IDs and contents`)
          .toEqual(byId(reference.pluginUserData));
        expect(snapshot.task.taskHistory)
          .withContext(`${context}: complete history projection`)
          .toEqual(reference.task.taskHistory);
        expect(snapshot.task.taskHistory?.t2?.events)
          .withContext(`${context}: original author facts`)
          .toEqual(expectedEvents);
        expect(snapshot.pluginUserData)
          .withContext(`${context}: deterministic delivery order`)
          .toEqual(reference.pluginUserData);
        expect(await harness.pendingOpCount(device)).toBe(0);
        await harness.restart(device);
      }
    }
    expect(harness.events).toEqual([]);
  }, 60_000);
});
