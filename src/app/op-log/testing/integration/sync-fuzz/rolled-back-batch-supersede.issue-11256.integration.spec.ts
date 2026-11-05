import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { MAX_OPS_PER_UPLOAD_REQUEST } from '../../../core/operation-log.const';
import { ProjectState } from '../../../../features/project/project.model';
import { Task } from '../../../../features/tasks/task.model';
import { executeIntent, Intent, SETUP_INTENTS, viewOf } from './sync-fuzz-actions';
import { FuzzDevice, SyncFuzzHarness } from './sync-fuzz-harness';

// LWW replay stamps the receiving client's arrival time.
const withoutArrivalTime = (task: Task): Omit<Task, 'modified'> => {
  const copy = { ...task };
  delete copy.modified;
  return copy;
};

/**
 * #11256: a rolled-back upload batch (INTERNAL_ERROR for every op) does not stop
 * the batch loop, so A's later batch is accepted first and the older ops are
 * CONFLICT_SUPERSEDED on retry. This checks whether that loses content or
 * leaves the devices diverged, including a create whose own later update
 * reaches the server (and B) before the create itself.
 */
describe('#11256 rolled-back upload batch followed by an accepted one', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('converges with every edit kept after the older batch is superseded', async () => {
    const harness = await SyncFuzzHarness.create();
    const a = await harness.addDevice('A');
    const b = await harness.addDevice('B');
    const run = (device: FuzzDevice, intent: Intent): Promise<unknown> =>
      harness.as(device, () => executeIntent(harness, intent));
    const unsyncedOnA = (): Promise<number> =>
      harness.as(
        a,
        async () => (await TestBed.inject(OperationLogStoreService).getUnsynced()).length,
      );

    for (const intent of SETUP_INTENTS) await run(a, intent);
    await harness.sync(a);
    await harness.sync(b);

    // Batch 1 (rolled back): a create, a notes edit, a title edit.
    await run(a, ['addTask', 'x1', 'P']);
    await run(a, ['editTaskNotes', 't1', 'notes from A']);
    await run(a, ['renameTask', 't2', 'A old']);
    for (let i = 0; (await unsyncedOnA()) < MAX_OPS_PER_UPLOAD_REQUEST; i++) {
      await run(a, ['editHabit', 'h1', 'title', `filler ${i}`]);
    }
    expect(await unsyncedOnA()).toBe(MAX_OPS_PER_UPLOAD_REQUEST);
    // Batch 2 (accepted): later edits to the same entities.
    await run(a, ['renameTask', 'x1', 'x1 renamed']);
    await run(a, ['renameTask', 't1', 'A title']);
    await run(a, ['renameTask', 't2', 'A new']);

    const upload = a.client.uploadOps.bind(a.client);
    const codes: (string | undefined)[] = [];
    const superseded: string[] = [];
    let call = 0;
    a.client.uploadOps = async (ops, clientId, lastKnownServerSeq) => {
      call++;
      if (call === 1) {
        // The server's transaction catch: nothing committed, every op retryable.
        expect(ops.length).toBe(MAX_OPS_PER_UPLOAD_REQUEST);
        return {
          results: ops.map((op) => ({
            opId: op.id,
            accepted: false,
            error: 'Concurrent transaction conflict - please retry',
            errorCode: 'INTERNAL_ERROR',
          })),
          latestSeq: lastKnownServerSeq ?? 0,
        };
      }
      const result = await upload(ops, clientId, lastKnownServerSeq);
      codes.push(...result.results.map((r) => r.errorCode));
      for (const r of result.results) {
        const op = ops.find((o) => o.id === r.opId);
        if (r.errorCode === 'CONFLICT_SUPERSEDED' && op) {
          superseded.push(`${op.opType}:${op.entityType}:${op.entityId}`);
        }
      }
      return result;
    };

    // B syncs between A's partial upload and A's retry: it sees x1's rename
    // before x1's create.
    await harness.sync(a);
    await harness.sync(b);
    for (let round = 0; round < 3; round++) {
      await harness.sync(a);
      await harness.sync(b);
    }
    a.client.uploadOps = upload;

    // The reported path was reached.
    expect(call).toBeGreaterThan(2);
    expect(codes).toContain('CONFLICT_SUPERSEDED');
    // The create, the notes edit and the older title edit were all superseded.
    expect(superseded).toEqual(
      jasmine.arrayContaining(['CRT:TASK:x1', 'UPD:TASK:t1', 'UPD:TASK:t2']),
    );
    expect(harness.events).toEqual([]);
    expect(await unsyncedOnA()).toBe(0);

    for (const device of [a, b]) {
      for (let restart = 0; restart < 2; restart++) {
        const root = await harness.as(device, () => harness.state());
        const tasks = viewOf(root).tasks;
        const byId = (id: string): Task | undefined => tasks.find((t) => t.id === id);
        expect(byId('x1')?.title).withContext(device.name).toBe('x1 renamed');
        expect(byId('t1')?.title).withContext(device.name).toBe('A title');
        expect(byId('t1')?.notes).withContext(device.name).toBe('notes from A');
        expect(byId('t2')?.title).withContext(device.name).toBe('A new');
        expect((root['projects'] as ProjectState).entities['INBOX_PROJECT']?.taskIds)
          .withContext(device.name)
          .toContain('x1');
        await harness.restart(device);
      }
    }
    const viewA = viewOf(await harness.as(a, () => harness.state()));
    const viewB = viewOf(await harness.as(b, () => harness.state()));
    expect(viewB.tasks.map(withoutArrivalTime)).toEqual(
      viewA.tasks.map(withoutArrivalTime),
    );
    expect(viewB.habits).toEqual(viewA.habits);
  }, 60_000);
});
