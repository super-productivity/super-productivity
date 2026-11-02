import { TestBed } from '@angular/core/testing';
import { AppStateSnapshot } from '../../../backup/state-snapshot.service';
import { OperationLogStoreService } from '../../../persistence/operation-log-store.service';
import { TaskSharedActions } from '../../../../root-store/meta/task-shared.actions';
import { executeIntent, FuzzStep, fuzzDay } from './sync-fuzz-actions';
import { SyncFuzzHarness } from './sync-fuzz-harness';
import { runFuzz } from './sync-fuzz-runner';

interface Entities {
  ids: string[];
  entities: Record<string, Record<string, unknown>>;
}

/** Corrupt only snapshots read by the oracles, after the real pipeline ran. */
const corruptOutcome = (corrupt: (state: AppStateSnapshot) => void): void => {
  const original = SyncFuzzHarness.prototype.syncedState;
  spyOn(SyncFuzzHarness.prototype, 'syncedState').and.callFake(async function (
    this: SyncFuzzHarness,
    device,
  ) {
    const state = structuredClone(await original.call(this, device));
    corrupt(state);
    return state;
  });
};

const removeNote = (state: AppStateSnapshot, id: string): void => {
  const notes = state.note as Entities;
  delete notes.entities[id];
  notes.ids = notes.ids.filter((n) => n !== id);
};

describe('sync fuzz oracle real-path negative controls', () => {
  afterEach(() => SyncFuzzHarness.dispose());

  for (const first of ['A', 'B']) {
    it(`detects a missing newer note edit after an isolated delete (${first} uploads first)`, async () => {
      const steps: FuzzStep[] = [
        { d: 'A', a: ['deleteNote', 'n1'] },
        { d: 'B', a: ['editNote', 'n1', 'content', 'newer'] },
        { d: first, s: 1 },
        { d: first === 'A' ? 'B' : 'A', s: 1 },
      ];
      const kept = await runFuzz({ steps });
      expect(kept.failures).withContext(JSON.stringify(kept.failures)).toEqual([]);
      corruptOutcome((state) => removeNote(state, 'n1'));
      const lost = await runFuzz({ steps });
      expect(lost.failures.map((f) => f.signature)).toContain('lost-entity:note');
    }, 60_000);
  }

  it('checks supplied creation values without treating defaults as user edits', async () => {
    expect((await runFuzz({ steps: [] })).failures).toEqual([]);
    corruptOutcome((state) => {
      (state.task as Entities).entities['t1']['title'] = 'corrupted';
      (state.task as Entities).entities['t1']['dueDay'] = undefined;
      (state.note as Entities).entities['n1']['content'] = 'corrupted';
      (state.simpleCounter as Entities).entities['h1']['title'] = 'corrupted';
    });
    const { failures } = await runFuzz({ steps: [] });
    expect(failures.map((f) => f.signature)).toEqual(
      jasmine.arrayContaining([
        'field-reverted:task.title',
        'field-reverted:task.dueDay',
        'field-reverted:note.content',
        'field-reverted:habit.title',
      ]),
    );
  }, 60_000);

  it('records implicit reopen and planning writes at their own op times', async () => {
    const harness = await SyncFuzzHarness.create();
    const a = await harness.addDevice('A');
    await harness.as(a, async () => {
      await executeIntent(harness, ['addTask', 't1', 'P']);
      await executeIntent(harness, ['doneTask', 't1', true]);
      const store = TestBed.inject(OperationLogStoreService);
      const before = await store.getLastSeq();
      const writes = await executeIntent(harness, ['track', 't1', 1000]);
      const ops = (await store.getOpsAfterSeq(before)).map((e) => e.op);
      const reopen = ops.find(
        (op) => op.actionType === TaskSharedActions.updateTask.type,
      )!;
      const plan = ops.find(
        (op) => op.actionType === TaskSharedActions.planTasksForToday.type,
      )!;
      expect(writes).toEqual(
        jasmine.arrayContaining([
          jasmine.objectContaining({
            field: 'isDone',
            value: false,
            time: reopen.timestamp,
          }),
          jasmine.objectContaining({
            field: 'dueDay',
            value: fuzzDay(),
            time: plan.timestamp,
          }),
        ]),
      );
      expect(reopen.timestamp).toBeLessThan(plan.timestamp);
      expect(plan.timestamp).toBeLessThan(ops[ops.length - 1].timestamp);
      // Tracking it again changes neither field.
      expect(await executeIntent(harness, ['track', 't1', 1000])).toEqual([]);
    });
  }, 60_000);

  it('detects a lost implicit due day after tracking an unscheduled task', async () => {
    const steps: FuzzStep[] = [{ d: 'B', a: ['track', 't3', 1000], s: 1 }];
    expect((await runFuzz({ steps })).failures).toEqual([]);
    corruptOutcome((state) => {
      (state.task as Entities).entities['t3']['dueDay'] = undefined;
    });
    const { failures } = await runFuzz({ steps });
    expect(failures.map((f) => f.signature)).toContain('older-write-won:task.dueDay');
  }, 60_000);

  it('accepts a whole-entity winner carrying the creation baseline, but not invented content', async () => {
    const steps: FuzzStep[] = [
      { d: 'B', a: ['renameTask', 't3', 'newer title'] },
      { d: 'C', a: ['track', 't3', 1000] },
      { d: 'B', s: 1 },
      { d: 'C', s: 1 },
    ];
    const kept = await runFuzz({ steps });
    // The existing Today-order divergence remains a failure; the baseline
    // title carried by the whole-entity winner is independently permissible.
    expect(kept.failures.map((f) => f.signature))
      .withContext(JSON.stringify(kept.failures))
      .toEqual(['divergence:.tag.entities.*.taskIds.*']);
    corruptOutcome((state) => {
      (state.task as Entities).entities['t3']['title'] = 'never supplied';
    });
    const { failures } = await runFuzz({ steps });
    expect(failures.map((f) => f.signature)).toContain('field-unwritten:task.title');
  }, 60_000);

  it('accepts an unscheduled baseline carried by the newer whole-entity rename', async () => {
    const steps: FuzzStep[] = [
      { d: 'B', a: ['track', 't3', 1000] },
      { d: 'C', a: ['renameTask', 't3', 'newer'] },
      { d: 'B', s: 1 },
      { d: 'C', s: 1 },
    ];
    const { failures } = await runFuzz({ steps });
    expect(failures).withContext(JSON.stringify(failures)).toEqual([]);
  }, 60_000);

  it('also recognizes an imported unscheduled baseline in a whole-entity winner', async () => {
    const { failures } = await runFuzz({
      steps: [
        { d: 'A', a: ['forceUpload'] },
        { d: 'B', s: 1, k: 'R' },
        { d: 'C', s: 1, k: 'R' },
        { d: 'B', a: ['track', 't3', 1000] },
        { d: 'C', a: ['renameTask', 't3', 'newer'] },
        { d: 'B', s: 1 },
        { d: 'C', s: 1 },
      ],
    });
    expect(failures).withContext(JSON.stringify(failures)).toEqual([]);
  }, 60_000);

  it('does not let a supplied baseline excuse an isolated lost note edit', async () => {
    const steps: FuzzStep[] = [
      { d: 'A', a: ['editNote', 'n1', 'content', 'edited'], s: 1 },
    ];
    expect((await runFuzz({ steps })).failures).toEqual([]);
    corruptOutcome((state) => {
      (state.note as Entities).entities['n1']['content'] = 'n1';
    });
    const { failures } = await runFuzz({ steps });
    expect(failures.map((f) => f.signature)).toContain('older-write-won:note.content');
  }, 60_000);

  for (const first of ['A', 'B']) {
    for (const conflict of ['content', 'delete'] as const) {
      it(`rejects lost note content in a ${conflict} crossing (${first} uploads first)`, async () => {
        const steps: FuzzStep[] = [
          {
            d: 'A',
            a:
              conflict === 'delete'
                ? ['deleteNote', 'n1']
                : ['editNote', 'n1', 'content', 'A content'],
          },
          { d: 'B', a: ['editNote', 'n1', 'content', 'B content'] },
          { d: first, s: 1 },
          { d: first === 'A' ? 'B' : 'A', s: 1 },
        ];
        expect((await runFuzz({ steps })).failures).toEqual([]);
        corruptOutcome((state) => {
          (state.note as Entities).entities['n1']['content'] = 'n1';
        });
        const { failures } = await runFuzz({ steps });
        expect(failures.map((f) => f.signature)).toContain(
          'older-write-won:note.content',
        );
      }, 60_000);
    }
  }

  for (const context of ['P', 'T'] as const) {
    it(`checks an isolated note edit after a completed ${context} reorder`, async () => {
      const steps: FuzzStep[] = [];
      if (context === 'T') steps.push({ d: 'A', a: ['addNote', 'n4', 'T'], s: 1 });
      steps.push(
        { d: 'A', a: ['reorderNotes', context, 0, 1], s: 1 },
        { d: 'A', a: ['editNote', 'n1', 'content', 'after reorder'], s: 1 },
      );
      const kept = await runFuzz({ steps });
      expect(kept.steps.some((step) => step.a?.[0] === 'reorderNotes')).toBeTrue();
      expect(kept.failures).toEqual([]);
      corruptOutcome((state) => {
        (state.note as Entities).entities['n1']['content'] = 'n1';
      });
      const { failures } = await runFuzz({ steps });
      expect(failures.map((f) => f.signature)).toContain('older-write-won:note.content');
    }, 60_000);
  }

  it('records archive scheduling clears, including against imported content', async () => {
    const steps: FuzzStep[] = [
      { d: 'A', a: ['doneTask', 't1', true] },
      { d: 'A', a: ['forceUpload'] },
      { d: 'A', a: ['archiveTask', 't1'], s: 1 },
    ];
    const kept = await runFuzz({ steps });
    expect(kept.failures).withContext(JSON.stringify(kept.failures)).toEqual([]);
    corruptOutcome((state) => {
      (state.archiveYoung.task as unknown as Entities).entities['t1']['dueDay'] =
        fuzzDay();
    });
    const { failures } = await runFuzz({ steps });
    expect(failures.map((f) => f.signature)).toContain('older-write-won:task.dueDay');
  }, 60_000);

  it('retains scheduling clears from both concurrent archives', async () => {
    const { failures } = await runFuzz({
      steps: [
        { d: 'A', a: ['doneTask', 't1', true], s: 1 },
        { d: 'B', s: 1 },
        { d: 'C', s: 1 },
        { d: 'A', a: ['archiveTask', 't1'] },
        { d: 'B', a: ['archiveTask', 't1'] },
        { d: 'A', s: 1 },
        { d: 'B', s: 1 },
      ],
    });
    // Existing archive flush-metadata divergence is not a lost due date.
    expect(failures.map((f) => f.signature).sort())
      .withContext(JSON.stringify(failures))
      .toEqual([
        'divergence:.archiveOld.lastTimeTrackingFlush',
        'divergence:.archiveYoung.lastTimeTrackingFlush',
      ]);
  }, 60_000);

  it('checks the new lifetime after a causal recreation, allowing intentional resets', async () => {
    const steps: FuzzStep[] = [
      { d: 'A', a: ['track', 't1', 1000] },
      { d: 'A', a: ['editTaskNotes', 't1', 'old lifetime'] },
      { d: 'A', a: ['forceUpload'] },
      { d: 'A', a: ['deleteTask', 't1'], s: 1 },
      { d: 'A', a: ['addTask', 't1', 'P'], s: 1 },
    ];
    const kept = await runFuzz({ steps });
    expect(kept.failures).withContext(JSON.stringify(kept.failures)).toEqual([]);
    corruptOutcome((state) => {
      delete (state.task as Entities).entities['t1'];
      (state.task as Entities).ids = (state.task as Entities).ids.filter(
        (id) => id !== 't1',
      );
    });
    const { failures } = await runFuzz({ steps });
    expect(failures.map((f) => f.signature)).toContain('lost-entity:task');
  }, 60_000);

  it('allows import to discard old/concurrent work but checks retained creation and edits', async () => {
    const steps: FuzzStep[] = [
      { d: 'A', a: ['exportBackup', 'before'] },
      { d: 'A', a: ['addNote', 'old', 'P'], s: 1 },
      { d: 'B', a: ['editNote', 'n1', 'content', 'discarded'] },
      { d: 'A', a: ['importBackup', 'before'], s: 1, k: 'L' },
      { d: 'B', s: 1, k: 'R' },
      { d: 'B', a: ['addNote', 'after', 'P'], s: 1 },
      { d: 'B', a: ['editNote', 'n1', 'content', 'retained'], s: 1 },
    ];
    const kept = await runFuzz({ steps });
    expect(kept.failures).withContext(JSON.stringify(kept.failures)).toEqual([]);
    let missing = 'after';
    corruptOutcome((state) => removeNote(state, missing));
    for (const id of ['after', 'n1']) {
      missing = id;
      const { failures } = await runFuzz({ steps });
      expect(failures).toContain(
        jasmine.objectContaining({
          signature: 'lost-entity:note',
          detail: `note:${id} was never deleted`,
        }),
      );
    }
  }, 60_000);
});
