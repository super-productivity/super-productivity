import { TestBed } from '@angular/core/testing';
import { DEFAULT_TASK, Task } from '../../../../features/tasks/task.model';
import { WorkContextType } from '../../../../features/work-context/work-context.model';
import { addNote } from '../../../../features/note/store/note.actions';
import { Note } from '../../../../features/note/note.model';
import { EMPTY_SIMPLE_COUNTER } from '../../../../features/simple-counter/simple-counter.const';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { VectorClock } from '../../../core/operation.types';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import {
  DEFAULT_WEIGHTS,
  DeviceView,
  executeIntent,
  FuzzStep,
  generateIntent,
  Intent,
  isUiPossible,
  REPLACEMENT_INTENTS,
  REPLACEMENT_WEIGHTS,
} from './sync-fuzz-actions';
import { FakeSuperSyncServer } from './fake-super-sync-server';
import { FuzzDevice, FuzzEvent, SyncFuzzHarness } from './sync-fuzz-harness';
import { comparable, createRandom, runFuzz } from './sync-fuzz-runner';

const addTask = (
  id: string,
  title: string,
): ReturnType<typeof TaskSharedActions.addTask> =>
  TaskSharedActions.addTask({
    task: { ...DEFAULT_TASK, id, title, projectId: 'INBOX_PROJECT', created: Date.now() },
    workContextId: 'INBOX_PROJECT',
    workContextType: WorkContextType.PROJECT,
    isAddToBacklog: false,
    isAddToBottom: false,
  });

const taskTitle = async (
  harness: SyncFuzzHarness,
  device: FuzzDevice,
  id: string,
): Promise<string | undefined> =>
  harness.as(device, async () => {
    const tasks = (await harness.state())['tasks'] as { entities: Record<string, Task> };
    return tasks.entities[id]?.title;
  });

describe('SyncFuzzHarness: two devices on one injector', () => {
  let harness: SyncFuzzHarness;
  let a: FuzzDevice;
  let b: FuzzDevice;

  beforeEach(async () => {
    harness = await SyncFuzzHarness.create();
    a = await harness.addDevice('A');
    b = await harness.addDevice('B');
  }, 60_000);

  afterEach(() => SyncFuzzHarness.dispose());

  it('keeps each device’s store, op log, clock and cursor apart', async () => {
    await harness.as(a, async () => {
      await harness.dispatch(addTask('t1', 'from A'));
      await harness.dispatch(
        addNote({
          note: {
            id: 'n1',
            projectId: 'INBOX_PROJECT',
            isPinnedToToday: false,
            content: 'note A',
            created: Date.now(),
            modified: Date.now(),
          },
        }),
      );
    });
    expect(await taskTitle(harness, a, 't1')).toBe('from A');
    expect(await taskTitle(harness, b, 't1')).toBeUndefined();
    expect(await harness.pendingOpCount(a)).toBe(2);
    expect(await harness.pendingOpCount(b)).toBe(0);

    expect(await harness.sync(a)).toBe(true);
    expect(harness.server.rows.length).toBe(2);
    expect(await harness.sync(b)).toBe(true);
    expect(await taskTitle(harness, b, 't1')).toBe('from A');
    expect(await harness.pendingOpCount(b)).toBe(0);

    await harness.as(b, () =>
      harness.dispatch(
        TaskSharedActions.updateTask({
          task: { id: 't1', changes: { title: 'from B' } },
        }),
      ),
    );
    expect(await taskTitle(harness, a, 't1')).toBe('from A');
    expect(await harness.sync(b)).toBe(true);
    expect(await harness.sync(a)).toBe(true);
    expect(await taskTitle(harness, a, 't1')).toBe('from B');

    const clocks: (VectorClock | null)[] = [];
    for (const device of [a, b]) {
      clocks.push(
        await harness.as(device, () =>
          TestBed.inject(OperationLogStoreService).getVectorClock(),
        ),
      );
    }
    expect(clocks[0]).toEqual({ fuzzDevA: 2, fuzzDevB: 1 });
    expect(clocks[1]).toEqual({ fuzzDevA: 2, fuzzDevB: 1 });
    expect(await a.client.getLastServerSeq()).toBe(3);
    expect(await b.client.getLastServerSeq()).toBe(3);
    expect(comparable(await harness.syncedState(a))).toEqual(
      comparable(await harness.syncedState(b)),
    );
    expect(harness.events).toEqual([]);
  }, 60_000);

  it('tells two devices apart when one has not synced', async () => {
    // Guards the state comparison above against a vacuous pass.
    await harness.as(a, () => harness.dispatch(addTask('t1', 'only A')));
    expect(comparable(await harness.syncedState(a))).not.toEqual(
      comparable(await harness.syncedState(b)),
    );
  }, 60_000);

  it('stops a harness that a newer harness replaced', async () => {
    await SyncFuzzHarness.create();
    await expectAsync(harness.as(a, async () => undefined)).toBeRejectedWithError(
      /stale harness/,
    );
  }, 60_000);

  it('reopens a done task that a device tracks, as starting it does in the app', async () => {
    await harness.as(a, async () => {
      await harness.dispatch(addTask('t1', 'task'));
      await executeIntent(harness, ['doneTask', 't1', true]);
      await executeIntent(harness, ['track', 't1', 2000]);
    });
    expect(await harness.sync(a)).toBe(true);
    expect(await harness.sync(b)).toBe(true);
    for (const device of [a, b]) {
      const t1 = await harness.as(device, async () => {
        const tasks = (await harness.state())['tasks'] as {
          entities: Record<string, Task>;
        };
        return tasks.entities['t1'];
      });
      expect({ isDone: t1?.isDone, timeSpent: t1?.timeSpent })
        .withContext(device.name)
        .toEqual({ isDone: false, timeSpent: 2000 });
    }
  }, 60_000);
});

/**
 * The fake server drops every uploaded op whose payload contains `marker`
 * while acknowledging it, so the write is lost without any sync error.
 */
const loseUploadsOf = (marker: string): void => {
  const uploadBatch = FakeSuperSyncServer.prototype.uploadBatch;
  spyOn(FakeSuperSyncServer.prototype, 'uploadBatch').and.callFake(function (
    this: FakeSuperSyncServer,
    ...args: Parameters<FakeSuperSyncServer['uploadBatch']>
  ) {
    const [ops, ...rest] = args;
    const isLost = (op: (typeof ops)[number]): boolean =>
      JSON.stringify(op.payload).includes(marker);
    const results = uploadBatch.call(
      this,
      ops.filter((op) => !isLost(op)),
      ...rest,
    );
    return ops.map(
      (op) =>
        results.find((r) => r.opId === op.id) ?? {
          opId: op.id,
          accepted: true,
          serverSeq: this.latestSeq,
        },
    );
  });
};

describe('SyncFuzzHarness: negative control', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  it('the oracles report device B reusing device A’s database', async () => {
    // The setup trace alone converges...
    expect((await runFuzz({ steps: [] })).failures).toEqual([]);

    // ...until the per-device database isolation breaks: B's op log is A's.
    // B then skips the ops A already applied in that database.
    const addDevice = SyncFuzzHarness.prototype.addDevice;
    let first: FuzzDevice | undefined;
    spyOn(SyncFuzzHarness.prototype, 'addDevice').and.callFake(async function (
      this: SyncFuzzHarness,
      name: string,
    ): Promise<FuzzDevice> {
      const device = await addDevice.call(this, name);
      first ??= device;
      return name === 'B' ? { ...device, db: first.db } : device;
    });

    const { failures } = await runFuzz({ steps: [] });

    expect(failures.some((f) => f.signature.startsWith('divergence:')))
      .withContext(JSON.stringify(failures))
      .toBeTrue();
  }, 60_000);

  it('the oracles still check a write made after a replacement', async () => {
    // B applies A's force upload, then renames: a write after the
    // replacement, which the oracles check, unlike B's discarded edit.
    const steps: FuzzStep[] = [
      { d: 'B', a: ['renameTask', 't2', 'discarded'] },
      { d: 'A', a: ['forceUpload'] },
      { d: 'B', s: 1, k: 'R' },
      { d: 'B', a: ['renameTask', 't1', 'after'], s: 1 },
    ];
    const kept = await runFuzz({ steps, debug: true });
    // The replacement happened: A's force upload is on the server, and B
    // answered the dialog with the remote data in its own sync (step 3),
    // before the rename, not only in settle.
    expect(kept.dump!.some((line) => /^srv .* SYNC_IMPORT FORCE_UPLOAD /.test(line)))
      .withContext(kept.dump!.join('\n'))
      .toBeTrue();
    const events = kept
      .dump!.filter((line) => line.startsWith('evt '))
      .map((line) => JSON.parse(line.slice(4)) as FuzzEvent);
    expect(events)
      .withContext(kept.dump!.join('\n'))
      .toContain({ step: 3, device: 'B', kind: 'import-dialog', detail: 'USE_REMOTE' });
    expect(kept.failures.map((f) => f.signature))
      .withContext(JSON.stringify(kept.failures))
      .not.toContain('field-reverted:task.title');

    // ...until the server loses the rename while acknowledging it.
    loseUploadsOf('"after"');

    const { failures } = await runFuzz({ steps });

    expect(failures.map((f) => f.signature))
      .withContext(JSON.stringify(failures))
      .toContain('field-reverted:task.title');
  }, 60_000);

  it('the oracles report an older notes edit that beats a newer concurrent one', async () => {
    // Two concurrent notes edits: B's is newer, and every device converges
    // on it.
    const steps: FuzzStep[] = [
      { d: 'A', a: ['editTaskNotes', 't1', 'older'] },
      { d: 'B', a: ['editTaskNotes', 't1', 'newer'] },
      { d: 'A', s: 1 },
      { d: 'B', s: 1 },
    ];
    expect((await runFuzz({ steps })).failures).toEqual([]);

    // ...until the server loses B's edit while acknowledging it: A's older
    // edit then wins on every device but B.
    loseUploadsOf('"newer"');

    const { failures } = await runFuzz({ steps });

    expect(failures.map((f) => f.signature))
      .withContext(JSON.stringify(failures))
      .toContain('older-write-won:task.notes');
  }, 60_000);

  it('the oracles hold a field to its own latest write, not its side’s (#10422)', async () => {
    // A's notes stay pending while C writes newer notes and uploads; A then
    // renames and uploads. A's side has the latest intent, but C's notes win
    // per field, as the field patch resolves them.
    const steps: FuzzStep[] = [
      { d: 'A', a: ['editTaskNotes', 't1', 'A notes'] },
      { d: 'C', a: ['editTaskNotes', 't1', 'C notes'], s: 1 },
      { d: 'A', a: ['renameTask', 't1', 'A title'], s: 1 },
    ];
    const { failures } = await runFuzz({ steps });

    expect(failures).withContext(JSON.stringify(failures)).toEqual([]);
  }, 60_000);

  /**
   * The pinned kept stop (a Today note reorder crossing an unpin): C, the
   * unpinning device, stops at step 6 and answers the whole-dataset dialog.
   */
  const stopThenWrite = (k: 'L' | 'R'): FuzzStep[] => [
    { d: 'A', a: ['editNote', 'n1', 'isPinnedToToday', true], s: 1 },
    { d: 'B', s: 1 },
    { d: 'C', s: 1 },
    { d: 'C', a: ['editNote', 'n1', 'isPinnedToToday', false] },
    { d: 'B', a: ['reorderNotes', 'T', 0, 1], s: 1 },
    { d: 'C', s: 1, k },
    { d: 'C', a: ['renameTask', 't1', 'after'], s: 1 },
  ];
  const STOP =
    'stop:SYNC_MULTI_ENTITY_UNSUPPORTED side=remote actionType=[Note] Update Note Order';

  for (const [k, answer] of [
    ['L', 'USE_LOCAL'],
    ['R', 'USE_REMOTE'],
  ] as const) {
    it(`the oracles still check a write made after a stop answered with ${answer}`, async () => {
      // C answers the dialog in its own sync (step 6), before the rename; the
      // stop stays a failure.
      const steps = stopThenWrite(k);
      const kept = await runFuzz({ steps, debug: true });
      const events = kept
        .dump!.filter((line) => line.startsWith('evt '))
        .map((line) => JSON.parse(line.slice(4)) as FuzzEvent);
      expect(events)
        .withContext(kept.dump!.join('\n'))
        .toContain({ step: 6, device: 'C', kind: 'stop-dialog', detail: answer });
      expect(events.filter((e) => e.kind === 'stop').map((e) => e.step))
        .withContext(kept.dump!.join('\n'))
        .toEqual([6]);
      // USE_LOCAL replaces the server's state with C's (B's reorder is
      // dropped by design); USE_REMOTE rebuilds C from the server's history.
      expect(kept.dump!.some((line) => /^srv .* SYNC_IMPORT FORCE_UPLOAD /.test(line)))
        .withContext(kept.dump!.join('\n'))
        .toBe(k === 'L');
      const signatures = kept.failures.map((f) => f.signature);
      expect(signatures).withContext(JSON.stringify(kept.failures)).toContain(STOP);
      expect(signatures)
        .withContext(JSON.stringify(kept.failures))
        .not.toContain('field-reverted:task.title');

      // ...until the server loses the rename while acknowledging it.
      loseUploadsOf('"after"');

      const { failures } = await runFuzz({ steps });

      expect(failures.map((f) => f.signature))
        .withContext(JSON.stringify(failures))
        .toContain('field-reverted:task.title');
    }, 60_000);
  }

  it('does not excuse a write the server lost before a stop answered with USE_REMOTE', async () => {
    // C's rename is uploaded (and acknowledged) before C stops; USE_REMOTE
    // discards only what C still had unsynced (the unpin), not the rename.
    const steps: FuzzStep[] = [
      { d: 'A', a: ['editNote', 'n1', 'isPinnedToToday', true], s: 1 },
      { d: 'B', s: 1 },
      { d: 'C', s: 1 },
      { d: 'C', a: ['renameTask', 't1', 'after'], s: 1 },
      { d: 'C', a: ['editNote', 'n1', 'isPinnedToToday', false] },
      { d: 'B', a: ['reorderNotes', 'T', 0, 1], s: 1 },
      { d: 'C', s: 1, k: 'R' },
    ];
    const kept = await runFuzz({ steps, debug: true });
    const events = kept
      .dump!.filter((line) => line.startsWith('evt '))
      .map((line) => JSON.parse(line.slice(4)) as FuzzEvent);
    expect(events)
      .withContext(kept.dump!.join('\n'))
      .toContain({ step: 7, device: 'C', kind: 'stop-dialog', detail: 'USE_REMOTE' });
    expect(kept.failures.map((f) => f.signature))
      .withContext(JSON.stringify(kept.failures))
      .not.toContain('field-reverted:task.title');

    // ...until the server loses the rename while acknowledging it.
    loseUploadsOf('"after"');

    const { failures } = await runFuzz({ steps });

    expect(failures.map((f) => f.signature))
      .withContext(JSON.stringify(failures))
      .toContain('field-reverted:task.title');
  }, 60_000);

  it('excuses a write dropped by a second stop answered with USE_REMOTE', async () => {
    // C stops twice and answers USE_REMOTE both times. Its rebuild resets
    // its own counter, so the rename after the first rebuild reuses a
    // discarded counter; the second USE_REMOTE drops that unsynced rename
    // by design, which must not read as a lost write.
    const stop: FuzzStep[] = [
      { d: 'C', a: ['editNote', 'n1', 'isPinnedToToday', false] },
      { d: 'B', a: ['reorderNotes', 'T', 0, 1], s: 1 },
    ];
    const steps: FuzzStep[] = [
      { d: 'A', a: ['editNote', 'n1', 'isPinnedToToday', true], s: 1 },
      { d: 'B', s: 1 },
      { d: 'C', s: 1 },
      { d: 'C', a: ['renameTask', 't1', 'one'] },
      ...stop,
      { d: 'C', s: 1, k: 'R' },
      { d: 'C', a: ['renameTask', 't1', 'two'] },
      ...stop,
      { d: 'C', s: 1, k: 'R' },
    ];
    const { failures, dump } = await runFuzz({ steps, debug: true });
    const answers = dump!
      .filter((line) => line.startsWith('evt '))
      .map((line) => JSON.parse(line.slice(4)) as FuzzEvent)
      .filter((e) => e.kind === 'stop-dialog');
    expect(answers.map((e) => `${e.step} ${e.device} ${e.detail}`))
      .withContext(dump!.join('\n'))
      .toEqual(['7 C USE_REMOTE', '11 C USE_REMOTE']);
    const signatures = failures.map((f) => f.signature);
    expect(signatures).withContext(JSON.stringify(failures)).toContain(STOP);
    expect(signatures)
      .withContext(JSON.stringify(failures))
      .not.toContain('field-reverted:task.title');
  }, 60_000);

  it('leaves a stop unanswered in a trace without a dialog answer or a replacement', async () => {
    const steps = stopThenWrite('L').map(({ k, ...step }) => step);
    const { failures } = await runFuzz({ steps, debug: true });
    const signatures = failures.map((f) => f.signature);
    expect(signatures).withContext(JSON.stringify(failures)).toContain(STOP);
    expect(signatures).withContext(JSON.stringify(failures)).toContain('pending');
  }, 60_000);
});

describe('sync fuzz generator', () => {
  const note = (id: string, projectId: string | null): Note => ({
    id,
    projectId,
    isPinnedToToday: !projectId,
    content: id,
    created: 0,
    modified: 0,
  });
  const view: DeviceView = {
    tasks: [],
    notes: [note('nP', 'INBOX_PROJECT'), note('nT', null)],
    projectNoteIds: ['nP'],
    todayNoteIds: ['nT'],
    habits: [
      { ...EMPTY_SIMPLE_COUNTER, id: 'hOn', isEnabled: true },
      { ...EMPTY_SIMPLE_COUNTER, id: 'hOff', isEnabled: false },
    ],
    timeTracking: { project: {}, tag: {} },
  };

  it('emits only steps the UI offers', () => {
    const random = createRandom(7);
    let id = 0;
    const seen = new Set<string>();
    for (let i = 0; i < 3_000; i++) {
      const intent = generateIntent(random, view, [], `L${i}`, (p) => `${p}${++id}`);
      if (!intent) continue;
      expect(isUiPossible(intent, view)).withContext(JSON.stringify(intent)).toBeTrue();
      if (intent[0] === 'editNote' || intent[0] === 'countHabit') {
        seen.add(intent.slice(0, intent[0] === 'editNote' ? 3 : 2).join(' '));
      }
    }
    // Pin toggles only on the project note, counts only on the enabled habit.
    expect([...seen].sort()).toEqual([
      'countHabit hOn',
      'editNote nP content',
      'editNote nP isLock',
      'editNote nP isPinnedToToday',
      'editNote nT content',
      'editNote nT isLock',
    ]);
    expect(isUiPossible(['editNote', 'nT', 'isPinnedToToday', false], view)).toBeFalse();
    expect(isUiPossible(['countHabit', 'hOff'], view)).toBeFalse();
  });

  it('replaces state only in the replacement mix, and imports only exported backups', () => {
    const random = createRandom(11);
    let id = 0;
    const kinds = new Set<Intent[0]>();
    for (let i = 0; i < 3_000; i++) {
      const backups = i < 1_500 ? [] : ['b1'];
      const intent = generateIntent(
        random,
        view,
        [],
        `L${i}`,
        (p) => `${p}${++id}`,
        REPLACEMENT_WEIGHTS,
        backups,
      );
      if (!intent) continue;
      expect(isUiPossible(intent, view)).withContext(JSON.stringify(intent)).toBeTrue();
      if (intent[0] === 'importBackup') expect(backups).toContain(intent[1]);
      kinds.add(intent[0]);
      const plain = generateIntent(random, view, [], `M${i}`, (p) => `${p}${++id}`);
      expect(plain && REPLACEMENT_INTENTS.has(plain[0])).toBeFalsy();
    }
    expect([...kinds].filter((kind) => REPLACEMENT_INTENTS.has(kind)).sort()).toEqual([
      'exportBackup',
      'forceUpload',
      'importBackup',
    ]);
    expect(DEFAULT_WEIGHTS.some(([kind]) => REPLACEMENT_INTENTS.has(kind))).toBeFalse();
  });
});
