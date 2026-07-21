import { computeWholeDatasetDiff } from './whole-dataset-diff.util';
import {
  buildDefaultPicks,
  buildMergedState,
  MergePicks,
  pickKey,
  preselectDiffering,
} from './whole-dataset-merge.util';

const adapter = (
  entities: Record<string, Record<string, unknown>>,
): { ids: string[]; entities: Record<string, Record<string, unknown>> } => ({
  ids: Object.keys(entities),
  entities,
});

describe('whole-dataset-merge.util', () => {
  describe('preselectDiffering (newest-wins)', () => {
    it('picks remote when remote.modified is newer, else local', () => {
      const base = {
        modelKey: 'task',
        entityType: 'TASK' as const,
        entityId: 't1',
        title: 't1',
        fieldDiffs: [],
        local: {},
        remote: {},
      };
      expect(preselectDiffering({ ...base, localModified: 1, remoteModified: 2 })).toBe(
        'remote',
      );
      expect(preselectDiffering({ ...base, localModified: 5, remoteModified: 2 })).toBe(
        'local',
      );
      // tie → local
      expect(preselectDiffering({ ...base, localModified: 3, remoteModified: 3 })).toBe(
        'local',
      );
    });
  });

  describe('buildMergedState', () => {
    const local = {
      task: adapter({
        differLocalWins: { id: 'differLocalWins', title: 'L', modified: 500 },
        differRemoteWins: { id: 'differRemoteWins', title: 'L', modified: 100 },
        onlyLocalKeep: { id: 'onlyLocalKeep', title: 'keepme', modified: 1 },
        onlyLocalDiscard: { id: 'onlyLocalDiscard', title: 'dropme', modified: 1 },
        untouched: { id: 'untouched', title: 'same', modified: 1 },
      }),
    };
    const remote = {
      task: adapter({
        differLocalWins: { id: 'differLocalWins', title: 'R', modified: 200 },
        differRemoteWins: { id: 'differRemoteWins', title: 'R', modified: 900 },
        onlyRemoteAdd: { id: 'onlyRemoteAdd', title: 'addme', modified: 1 },
        onlyRemoteSkip: { id: 'onlyRemoteSkip', title: 'skipme', modified: 1 },
        untouched: { id: 'untouched', title: 'same', modified: 1 },
      }),
    };

    it('produces exactly the picked entities (LOCAL/REMOTE/KEEP/DISCARD/ADD/SKIP)', () => {
      const diff = computeWholeDatasetDiff(local, remote);
      const picks: MergePicks = {
        differing: {
          [pickKey('task', 'differLocalWins')]: 'local',
          [pickKey('task', 'differRemoteWins')]: 'remote',
        },
        onlyLocal: {
          [pickKey('task', 'onlyLocalKeep')]: 'keep',
          [pickKey('task', 'onlyLocalDiscard')]: 'discard',
        },
        onlyRemote: {
          [pickKey('task', 'onlyRemoteAdd')]: 'add',
          [pickKey('task', 'onlyRemoteSkip')]: 'skip',
        },
      };

      const merged = buildMergedState(local, diff, picks) as {
        task: { ids: string[]; entities: Record<string, { title: string }> };
      };
      const e = merged.task.entities;

      // differing → LOCAL keeps local value
      expect(e['differLocalWins'].title).toBe('L');
      // differing → REMOTE takes remote value
      expect(e['differRemoteWins'].title).toBe('R');
      // only-local KEEP present, DISCARD gone
      expect(e['onlyLocalKeep']).toBeDefined();
      expect(e['onlyLocalDiscard']).toBeUndefined();
      expect(merged.task.ids).not.toContain('onlyLocalDiscard');
      // only-remote ADD present, SKIP absent
      expect(e['onlyRemoteAdd']).toBeDefined();
      expect(merged.task.ids).toContain('onlyRemoteAdd');
      expect(e['onlyRemoteSkip']).toBeUndefined();
      expect(merged.task.ids).not.toContain('onlyRemoteSkip');
      // untouched identical entity preserved
      expect(e['untouched'].title).toBe('same');
    });

    it('does not mutate the input local state', () => {
      const diff = computeWholeDatasetDiff(local, remote);
      const picks = buildDefaultPicks(diff);
      const before = JSON.stringify(local);
      buildMergedState(local, diff, picks);
      expect(JSON.stringify(local)).toBe(before);
    });

    it('default picks resolve differing via newest-wins, keep-all-local, add-all-remote', () => {
      const diff = computeWholeDatasetDiff(local, remote);
      const merged = buildMergedState(local, diff, buildDefaultPicks(diff)) as {
        task: { entities: Record<string, { title: string }> };
      };
      const e = merged.task.entities;
      // differLocalWins: local newer (500 > 200) → local 'L'
      expect(e['differLocalWins'].title).toBe('L');
      // differRemoteWins: remote newer (900 > 100) → remote 'R'
      expect(e['differRemoteWins'].title).toBe('R');
      // only-local kept, only-remote added by default
      expect(e['onlyLocalKeep']).toBeDefined();
      expect(e['onlyLocalDiscard']).toBeDefined();
      expect(e['onlyRemoteAdd']).toBeDefined();
      expect(e['onlyRemoteSkip']).toBeDefined();
    });
  });
});
