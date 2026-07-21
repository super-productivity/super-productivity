import {
  computeWholeDatasetDiff,
  countWholeDatasetDiff,
} from './whole-dataset-diff.util';

const adapter = (
  entities: Record<string, Record<string, unknown>>,
): { ids: string[]; entities: Record<string, Record<string, unknown>> } => ({
  ids: Object.keys(entities),
  entities,
});

describe('computeWholeDatasetDiff', () => {
  it('classifies differing / only-local / only-remote and counts them', () => {
    const local = {
      task: adapter({
        t1: { id: 't1', title: 'Local title', modified: 200 },
        t2: { id: 't2', title: 'Only local', modified: 100 },
        same: { id: 'same', title: 'Same', modified: 50 },
      }),
    };
    const remote = {
      task: adapter({
        t1: { id: 't1', title: 'Remote title', modified: 300 },
        t3: { id: 't3', title: 'Only remote', modified: 400 },
        same: { id: 'same', title: 'Same', modified: 50 },
      }),
    };

    const diff = computeWholeDatasetDiff(local, remote);
    const counts = countWholeDatasetDiff(diff);

    expect(counts).toEqual({ differing: 1, onlyLocal: 1, onlyRemote: 1, total: 3 });

    expect(diff.differing[0].entityId).toBe('t1');
    expect(diff.onlyLocal[0].entityId).toBe('t2');
    expect(diff.onlyRemote[0].entityId).toBe('t3');
  });

  it('captures per-field local/remote values for the differing entity', () => {
    const local = {
      task: adapter({ t1: { id: 't1', title: 'A', notes: 'keep', modified: 1 } }),
    };
    const remote = {
      task: adapter({ t1: { id: 't1', title: 'B', notes: 'keep', modified: 2 } }),
    };

    const diff = computeWholeDatasetDiff(local, remote);
    expect(diff.differing.length).toBe(1);
    expect(diff.differing[0].fieldDiffs).toEqual([
      { field: 'title', localVal: 'A', remoteVal: 'B' },
    ]);
    // Unchanged fields (and the noise field) are not part of fieldDiffs.
    expect(diff.differing[0].fieldDiffs.map((d) => d.field)).not.toContain('notes');
    expect(diff.differing[0].fieldDiffs.map((d) => d.field)).not.toContain('modified');
    expect(diff.differing[0].localModified).toBe(1);
    expect(diff.differing[0].remoteModified).toBe(2);
  });

  it('excludes entities whose only difference is a NOISE field (modified)', () => {
    const local = {
      task: adapter({ t1: { id: 't1', title: 'Same', modified: 100 } }),
    };
    const remote = {
      task: adapter({ t1: { id: 't1', title: 'Same', modified: 999 } }),
    };

    const diff = computeWholeDatasetDiff(local, remote);
    expect(diff.differing.length).toBe(0);
    expect(diff.onlyLocal.length).toBe(0);
    expect(diff.onlyRemote.length).toBe(0);
  });

  it('diffs array-shaped slices (reminders) by id', () => {
    const local = {
      reminders: [
        { id: 'r1', remindAt: 10 },
        { id: 'r2', remindAt: 20 },
      ],
    };
    const remote = {
      reminders: [
        { id: 'r1', remindAt: 99 },
        { id: 'r3', remindAt: 30 },
      ],
    };
    const diff = computeWholeDatasetDiff(local, remote);
    expect(diff.differing.map((d) => d.entityId)).toEqual(['r1']);
    expect(diff.onlyLocal.map((d) => d.entityId)).toEqual(['r2']);
    expect(diff.onlyRemote.map((d) => d.entityId)).toEqual(['r3']);
  });

  it('tolerates missing / empty slices on either side', () => {
    const diff = computeWholeDatasetDiff({}, { task: adapter({}) });
    expect(countWholeDatasetDiff(diff).total).toBe(0);
  });
});
