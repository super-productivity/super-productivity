import { AppStateSnapshot } from '../../../backup/state-snapshot.service';
import { VectorClock } from '../../../core/operation.types';
import { fuzzDay, Intent } from './sync-fuzz-actions';
import { checkPreservation, Ledger, LedgerEntry, Replacement } from './sync-fuzz-runner';

/**
 * Negative controls for the preservation oracles on hand-built ledgers and
 * converged states: each rule must report the shape it is for, and each
 * scope exclusion must hold only for its shape.
 */

let time = 0;

/**
 * An intent of `device` with the given vector clock after it, one tick
 * later. `uploadedAt` is the sync that uploaded it (default: right after it,
 * so each intent is its own side); `opaque` marks a planning `track`.
 */
const entry = (
  device: string,
  clock: VectorClock,
  intent: Intent,
  { uploadedAt, opaque = false }: { uploadedAt?: number; opaque?: boolean } = {},
): LedgerEntry => {
  const writes =
    intent[0] === 'renameTask'
      ? [{ entity: `task:${intent[1]}`, field: 'title', value: intent[2] }]
      : intent[0] === 'editTaskNotes'
        ? [{ entity: `task:${intent[1]}`, field: 'notes', value: intent[2] }]
        : intent[0] === 'doneTask'
          ? [{ entity: `task:${intent[1]}`, field: 'isDone', value: intent[2] }]
          : intent[0] === 'editNote'
            ? [{ entity: `note:${intent[1]}`, field: intent[2], value: intent[3] }]
            : intent[0] === 'editHabit'
              ? [{ entity: `habit:${intent[1]}`, field: intent[2], value: intent[3] }]
              : [];
  time++;
  return {
    intent,
    writes,
    device,
    clientId: `fuzzDev${device}`,
    clock: Object.fromEntries(
      Object.entries(clock).map(([name, counter]) => [`fuzzDev${name}`, counter]),
    ),
    counterBefore: 0,
    time,
    uploadedAt: uploadedAt ?? time,
    opaque,
  };
};

interface Converged {
  tasks?: Record<string, Record<string, unknown>>;
  archived?: Record<string, Record<string, unknown>>;
  notes?: Record<string, Record<string, unknown>>;
  habits?: Record<string, Record<string, unknown>>;
}

const snapshot = ({
  tasks = {},
  archived = {},
  notes = {},
  habits = {},
}: Converged): AppStateSnapshot =>
  ({
    task: { ids: Object.keys(tasks), entities: tasks },
    archiveYoung: { task: { ids: Object.keys(archived), entities: archived } },
    project: { ids: [], entities: {} },
    note: { ids: Object.keys(notes), entities: notes, todayOrder: [] },
    simpleCounter: { ids: Object.keys(habits), entities: habits },
  }) as unknown as AppStateSnapshot;

const signatures = (
  converged: Converged,
  entries: LedgerEntry[],
  replacement?: Replacement,
): string[] => {
  const found: string[] = [];
  checkPreservation(snapshot(converged), new Ledger(entries), replacement, (s) =>
    found.push(s),
  );
  return found;
};

describe('sync fuzz preservation oracles', () => {
  describe('latest write per field', () => {
    // A writes notes, C writes newer notes; both concurrent (#10422's shape).
    const a = entry('A', { A: 1 }, ['editTaskNotes', 't1', 'A notes']);
    const c = entry('C', { C: 1 }, ['editTaskNotes', 't1', 'C notes']);

    it('passes when the latest write wins', () => {
      expect(
        signatures({ tasks: { t1: { id: 't1', notes: 'C notes' } } }, [a, c]),
      ).toEqual([]);
    });

    it('reports an older write that beats a newer concurrent one', () => {
      expect(
        signatures({ tasks: { t1: { id: 't1', notes: 'A notes' } } }, [a, c]),
      ).toEqual(['older-write-won:task.notes']);
    });

    it('reports an older write that the newer one had already seen', () => {
      const later = entry('C', { A: 1, C: 1 }, ['editTaskNotes', 't1', 'C notes']);
      expect(
        signatures({ tasks: { t1: { id: 't1', notes: 'A notes' } } }, [a, later]),
      ).toEqual(['older-write-won:task.notes']);
    });

    it('accepts an older write whose side wins by a later edit of another field', () => {
      // A's notes and rename are pending together and upload after C's
      // notes: A resolves, its side wins by the rename and patches its notes.
      const notesA = entry('A', { A: 1 }, ['editTaskNotes', 't1', 'A notes'], {
        uploadedAt: 100,
      });
      const notesC = entry('C', { C: 1 }, ['editTaskNotes', 't1', 'C notes']);
      const rename = entry('A', { A: 2 }, ['renameTask', 't1', 'A title'], {
        uploadedAt: 100,
      });
      const converged = {
        tasks: { t1: { id: 't1', notes: 'A notes', title: 'A title' } },
      };
      expect(signatures(converged, [notesA, notesC, rename])).toEqual([]);
      // ...but not when A's notes uploaded before C's: that crossing was
      // resolved earlier, and C won it. The later rename does not write notes
      // (review of #10428, finding 2: the #10421 class).
      const earlyNotesA = entry('A', { A: 1 }, ['editTaskNotes', 't1', 'A notes']);
      const laterNotesC = entry('C', { C: 1 }, ['editTaskNotes', 't1', 'C notes']);
      const laterRename = entry('A', { A: 2 }, ['renameTask', 't1', 'A title']);
      expect(signatures(converged, [earlyNotesA, laterNotesC, laterRename])).toEqual([
        'older-write-won:task.notes',
      ]);
    });

    it('reports a loss when the losing, resolving device only tracked locally', () => {
      // #10422's shape with the loser tracking first (review of #10428,
      // finding 1): A's own delta stays pending and still admits the patch,
      // so A's side, which loses to C's newer notes, must not win.
      const trackA = entry('A', { A: 1 }, ['track', 't1', 1000], { uploadedAt: 100 });
      const notesA = entry('A', { A: 2 }, ['editTaskNotes', 't1', 'A notes'], {
        uploadedAt: 100,
      });
      const notesC = entry('C', { C: 1 }, ['editTaskNotes', 't1', 'C notes']);
      const converged = {
        tasks: {
          t1: { id: 't1', notes: 'A notes', timeSpentOnDay: { [fuzzDay()]: 1000 } },
        },
      };
      expect(signatures(converged, [trackA, notesA, notesC])).toEqual([
        'older-write-won:task.notes',
      ]);
    });

    describe('a whole-entity winner', () => {
      // B's notes, then C's newer notes (C had seen B's). A, which had also
      // seen B's notes, tracks last; its snapshot carries B's notes.
      const notesB = entry('B', { B: 1 }, ['editTaskNotes', 't1', 'B notes']);
      const notesC = entry('C', { B: 1, C: 1 }, ['editTaskNotes', 't1', 'C notes'], {
        uploadedAt: 200,
      });
      const track = (uploadedAt: number, opaque = false): LedgerEntry =>
        entry('A', { A: 1, B: 1 }, ['track', 't1', 1000], { uploadedAt, opaque });
      const converged = {
        tasks: {
          t1: { id: 't1', notes: 'B notes', timeSpentOnDay: { [fuzzDay()]: 1000 } },
        },
      };

      it('accounts for any value when its delta is remote to the resolver', () => {
        // A uploads first: C resolves against A's remote delta, whole-entity.
        expect(signatures(converged, [notesB, notesC, track(100)])).toEqual([]);
      });

      it('accounts for any value when its intent plans the task (opaque)', () => {
        expect(signatures(converged, [notesB, notesC, track(300, true)])).toEqual([]);
      });

      it('does not when its plain delta is local to the resolver', () => {
        // A uploads last: A resolves with its own delta, through the patch,
        // which writes no notes.
        expect(signatures(converged, [notesB, notesC, track(300)])).toEqual([
          'older-write-won:task.notes',
        ]);
      });
    });

    it('leaves notes and habit counts to whole-entity LWW', () => {
      const lockA = entry('A', { A: 1 }, ['editNote', 'n1', 'isLock', true]);
      const lockC = entry('C', { C: 1 }, ['editNote', 'n1', 'isLock', false]);
      expect(
        signatures({ notes: { n1: { id: 'n1', isLock: true } } }, [lockA, lockC]),
      ).toEqual([]);
      // Habit titles are patched like task fields, so they are checked.
      const titleA = entry('A', { A: 1 }, ['editHabit', 'h1', 'title', 'A']);
      const titleC = entry('C', { C: 1 }, ['editHabit', 'h1', 'title', 'C']);
      expect(
        signatures({ habits: { h1: { id: 'h1', title: 'A' } } }, [titleA, titleC]),
      ).toEqual(['older-write-won:habit.title']);
    });
  });

  describe('archived tasks', () => {
    const rename = entry('A', { A: 1 }, ['renameTask', 't1', 'renamed']);

    it('checks an archived task’s fields in the archive', () => {
      const archive = entry('A', { A: 2 }, ['archiveTask', 't1']);
      expect(
        signatures({ archived: { t1: { id: 't1', title: 'renamed' } } }, [
          rename,
          archive,
        ]),
      ).toEqual([]);
      expect(
        signatures({ archived: { t1: { id: 't1', title: 'old' } } }, [rename, archive]),
      ).toEqual(['field-reverted:task.title']);
    });

    it('excuses an edit that crosses the archive, which wins by design', () => {
      const archive = entry('B', { B: 1 }, ['archiveTask', 't1']);
      expect(
        signatures({ archived: { t1: { id: 't1', title: 'old' } } }, [rename, archive]),
      ).toEqual([]);
    });

    it('checks time tracked before the archive, and excuses time that crosses it', () => {
      const day = fuzzDay();
      const track = entry('A', { A: 1 }, ['track', 't1', 2000]);
      const archived = (ms: number): Converged => ({
        archived: { t1: { id: 't1', timeSpentOnDay: { [day]: ms } } },
      });
      const after = entry('A', { A: 2 }, ['archiveTask', 't1']);
      expect(signatures(archived(2000), [track, after])).toEqual([]);
      expect(signatures(archived(0), [track, after])).toEqual(['time-loss:task']);
      const crossing = entry('B', { B: 1 }, ['archiveTask', 't1']);
      expect(signatures(archived(0), [track, crossing])).toEqual([]);
    });
  });

  describe('deleted tasks', () => {
    it('counts a deleted task that came back apart, as recreated', () => {
      const rename = entry('A', { A: 1 }, ['renameTask', 't1', 'renamed']);
      const del = entry('B', { B: 1 }, ['deleteTask', 't1']);
      // Gone: nothing to check.
      expect(signatures({}, [rename, del])).toEqual([]);
      // Recreated without the rename (decision 2's defaults): counted.
      expect(
        signatures({ tasks: { t1: { id: 't1', title: 'old' } } }, [rename, del]),
      ).toEqual(['recreated:field-reverted:task.title']);
      // ...and the same task without a delete is an ordinary loss.
      expect(signatures({ tasks: { t1: { id: 't1', title: 'old' } } }, [rename])).toEqual(
        ['field-reverted:task.title'],
      );
    });
  });

  describe('replacement content', () => {
    const replacement = (title: string): Replacement => ({
      clock: { fuzzDevA: 5 },
      clientId: 'fuzzDevA',
      entities: new Set(['task:t1']),
      time: new Map([['task:t1', 0]]),
      fields: new Map<string, unknown>([
        ['task:t1|title', title],
        ['task:t1|notes', ''],
        ['task:t1|isDone', false],
      ]),
    });
    const converged = (title: string): Converged => ({
      tasks: { t1: { id: 't1', title, notes: '', isDone: false } },
    });

    it('checks the replacement’s field values', () => {
      expect(signatures(converged('imported'), [], replacement('imported'))).toEqual([]);
      expect(signatures(converged('other'), [], replacement('imported'))).toEqual([
        'import-field-changed:task.title',
      ]);
    });

    it('leaves a field a kept intent wrote after the replacement to the ledger', () => {
      const rename = entry('B', { A: 5, B: 1 }, ['renameTask', 't1', 'after']);
      expect(signatures(converged('after'), [rename], replacement('imported'))).toEqual(
        [],
      );
      expect(
        signatures(converged('imported'), [rename], replacement('imported')),
      ).toEqual(['field-reverted:task.title']);
    });
  });
});
