import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { ConflictJournalService } from './conflict-journal.service';
import {
  ConflictJournalEntry,
  JOURNAL_MAX_ENTRIES,
  JOURNAL_RETENTION_DAYS,
} from './conflict-journal.model';
import { buildConflictJournalEntry } from './conflict-journal-emission.util';
import { ActionType, EntityType, OpType, Operation } from '../core/operation.types';
import { uuidv7 } from '../../util/uuid-v7';

const DAY_MS = 24 * 60 * 60 * 1000;
const staleOffsetMs = (days: number): number => days * DAY_MS;

const makeEntry = (over: Partial<ConflictJournalEntry> = {}): ConflictJournalEntry => ({
  id: uuidv7(),
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  entityTitle: 'Test Task',
  resolvedAt: Date.now(),
  winner: 'remote',
  reason: 'newer',
  fieldDiffs: [],
  localClientId: 'A',
  remoteClientId: 'B',
  localTs: 1000,
  remoteTs: 2000,
  status: 'unreviewed',
  ...over,
});

describe('ConflictJournalService (store)', () => {
  let service: ConflictJournalService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [ConflictJournalService] });
    service = TestBed.inject(ConflictJournalService);
  });

  it('records and reads back an entry', async () => {
    const entry = makeEntry({ id: 'e1' });
    await service.record(entry);

    const read = await service.getEntry('e1');
    expect(read).toBeTruthy();
    expect(read?.id).toBe('e1');
    expect(read?.reason).toBe('newer');
  });

  it('list("history") returns everything newest-first; list("unreviewed") filters', async () => {
    await service.record(
      makeEntry({ id: 'old', resolvedAt: 1000, status: 'unreviewed' }),
    );
    await service.record(makeEntry({ id: 'mid', resolvedAt: 2000, status: 'info' }));
    await service.record(
      makeEntry({ id: 'new', resolvedAt: 3000, status: 'unreviewed' }),
    );

    const history = await service.list('history');
    expect(history.map((e) => e.id)).toEqual(['new', 'mid', 'old']);

    const unreviewed = await service.list('unreviewed');
    expect(unreviewed.map((e) => e.id)).toEqual(['new', 'old']);
  });

  it('unreviewedCount$ reflects the number of unreviewed entries', async () => {
    expect(await firstValueFrom(service.unreviewedCount$)).toBe(0);

    await service.record(makeEntry({ id: 'a', status: 'unreviewed' }));
    await service.record(makeEntry({ id: 'b', status: 'unreviewed' }));
    await service.record(makeEntry({ id: 'c', status: 'info' }));

    expect(await firstValueFrom(service.unreviewedCount$)).toBe(2);
  });

  it('markKept / markFlipped update status and the unreviewed count', async () => {
    await service.record(makeEntry({ id: 'a', status: 'unreviewed' }));
    await service.record(makeEntry({ id: 'b', status: 'unreviewed' }));

    await service.markKept('a');
    await service.markFlipped('b');

    expect((await service.getEntry('a'))?.status).toBe('kept');
    expect((await service.getEntry('b'))?.status).toBe('flipped');
    expect(await firstValueFrom(service.unreviewedCount$)).toBe(0);
  });

  it('clearAll() removes every entry and resets the unreviewed count (profile switch)', async () => {
    await service.record(makeEntry({ id: 'a', status: 'unreviewed' }));
    await service.record(makeEntry({ id: 'b', status: 'kept' }));
    expect(await firstValueFrom(service.unreviewedCount$)).toBe(1);

    await service.clearAll();

    expect(await service.getEntry('a')).toBeUndefined();
    expect(await service.getEntry('b')).toBeUndefined();
    expect((await service.list('history')).length).toBe(0);
    expect(await firstValueFrom(service.unreviewedCount$)).toBe(0);
  });

  describe('retention (pruneOnStart)', () => {
    it('prunes an entry older than JOURNAL_RETENTION_DAYS and keeps a fresh one', async () => {
      const now = Date.now();
      await service.record(
        makeEntry({
          id: 'stale',
          resolvedAt: now - staleOffsetMs(JOURNAL_RETENTION_DAYS + 1),
        }),
      );
      await service.record(makeEntry({ id: 'fresh', resolvedAt: now }));

      const deleted = await service.pruneOnStart(now);

      expect(deleted).toBe(1);
      expect(await service.getEntry('stale')).toBeUndefined();
      expect(await service.getEntry('fresh')).toBeTruthy();
    });

    it('prunes stale kept/flipped entries exactly like others', async () => {
      const now = Date.now();
      const oldTs = now - staleOffsetMs(JOURNAL_RETENTION_DAYS + 5);
      await service.record(
        makeEntry({ id: 'kept-old', resolvedAt: oldTs, status: 'kept' }),
      );
      await service.record(
        makeEntry({ id: 'flipped-old', resolvedAt: oldTs, status: 'flipped' }),
      );

      const deleted = await service.pruneOnStart(now);

      expect(deleted).toBe(2);
      expect(await service.getEntry('kept-old')).toBeUndefined();
      expect(await service.getEntry('flipped-old')).toBeUndefined();
    });

    it('prunes the oldest overflow beyond JOURNAL_MAX_ENTRIES (the 201st entry)', async () => {
      const now = Date.now();
      // JOURNAL_MAX_ENTRIES + 1 fresh entries, oldest = index 0.
      for (let i = 0; i <= JOURNAL_MAX_ENTRIES; i++) {
        await service.record(
          makeEntry({ id: `entry-${i}`, resolvedAt: now - (JOURNAL_MAX_ENTRIES - i) }),
        );
      }

      const deleted = await service.pruneOnStart(now);

      expect(deleted).toBe(1);
      // The single oldest entry is gone; exactly JOURNAL_MAX_ENTRIES remain.
      expect(await service.getEntry('entry-0')).toBeUndefined();
      expect((await service.list('history')).length).toBe(JOURNAL_MAX_ENTRIES);
      expect(await service.getEntry(`entry-${JOURNAL_MAX_ENTRIES}`)).toBeTruthy();
    });
  });

  describe('failure hardening (never-throw contract)', () => {
    it('list/getEntry/markKept/markFlipped degrade to safe defaults when the DB cannot open', async () => {
      // list() is awaited inside conflict resolution's notification step — a
      // DB failure must degrade to "no entries", never reject into the sync.
      spyOn(globalThis.indexedDB, 'open').and.throwError('idb down');

      await expectAsync(service.list('history')).toBeResolvedTo([]);
      await expectAsync(service.getEntry('nope')).toBeResolvedTo(undefined);
      await expectAsync(service.markKept('nope')).toBeResolved();
      await expectAsync(service.markFlipped('nope')).toBeResolved();
    });

    it('recovers after an abnormal DB termination (handles reset, next call reopens)', async () => {
      await service.record(makeEntry({ id: 'before-term' }));

      // Fire the `close` event idb's `terminated` option listens for (what the
      // browser dispatches on abnormal termination). This pins the wiring
      // itself: if the `terminated` callback were removed, the handles would
      // survive and the expectation below fails. fake-indexeddb's dispatchEvent
      // rejects DOM Events (it checks its own FakeEvent flags), so this is a
      // minimal duck-typed FakeEvent; the distinct phase constants matter —
      // all-undefined phases make its `stopped()` check skip the listener.
      const db = await service['_ensureDb']();
      db.dispatchEvent({
        type: 'close',
        initialized: true,
        dispatched: false,
        eventPath: [],
        bubbles: false,
        CAPTURING_PHASE: 1,
        AT_TARGET: 2,
        BUBBLING_PHASE: 3,
      } as unknown as Event);
      expect(service['_db']).toBeUndefined();

      // Next call reopens instead of failing on a dead connection.
      await service.record(makeEntry({ id: 'after-term' }));
      const ids = (await service.list('history')).map((e) => e.id);
      expect(ids).toContain('before-term');
      expect(ids).toContain('after-term');
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Taxonomy classification (pure) — one entry per SPAP-12 taxonomy row.
// ─────────────────────────────────────────────────────────────────────────────

describe('buildConflictJournalEntry (taxonomy)', () => {
  const resolvePayloadKey = (): string => 'task';

  const op = (over: Partial<Operation> = {}): Operation => ({
    id: uuidv7(),
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: 'task-1',
    payload: { task: { id: 'task-1' } },
    clientId: 'A',
    vectorClock: { A: 1 },
    timestamp: 1000,
    schemaVersion: 1,
    ...over,
  });

  it('same-field edit, local newer → reason "newer", status "unreviewed"', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'local',
      planReason: 'local-timestamp',
      localOps: [
        op({ payload: { task: { id: 'task-1', title: 'Local' } }, timestamp: 2000 }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 1000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('newer');
    expect(entry.status).toBe('unreviewed');
    expect(entry.winner).toBe('local');
    const titleDiff = entry.fieldDiffs.find((d) => d.field === 'title');
    expect(titleDiff).toEqual({
      field: 'title',
      localVal: 'Local',
      remoteVal: 'Remote',
      localChanged: true,
      remoteChanged: true,
      pickedSide: 'local',
    });
  });

  it('classifies a lost non-adapter structural action as a real loss, not noise', () => {
    // Production shape of convertToSubTask: the mutation lives in
    // { taskId, targetParentId, afterTaskId } (no adapter { task: { changes } })
    // and OperationCaptureService emits entityChanges: []. The discarded
    // structural move must surface as unreviewed and keep its payload visible.
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({
          actionType: '[Task] Convert to sub task' as ActionType,
          payload: {
            actionPayload: {
              taskId: 'task-1',
              targetParentId: 'parent-1',
              afterTaskId: null,
            },
            entityChanges: [],
          },
          timestamp: 1000,
        }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).not.toBe('noise');
    expect(entry.status).toBe('unreviewed');
    // The discarded action payload is preserved verbatim for review.
    const actionDiff = entry.fieldDiffs.find((d) => d.kind === 'action');
    expect(actionDiff?.field).toBe('[Task] Convert to sub task');
    expect(actionDiff?.localVal).toEqual({
      taskId: 'task-1',
      targetParentId: 'parent-1',
      afterTaskId: null,
    });
    expect(actionDiff?.localChanged).toBe(true);
    expect(actionDiff?.remoteChanged).toBe(false);
  });

  it('uses capture-time entityChanges as the delta source for non-adapter payloads', () => {
    // syncTimeSpent: reducer-relevant fields live in entityChanges, not in an
    // adapter-shaped actionPayload. The loser's real fields must be read from
    // there instead of misclassifying the loss as noise.
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({
          actionType: '[TimeTracking] Sync time spent' as ActionType,
          payload: {
            actionPayload: { taskId: 'task-1', date: '2026-07-10', duration: 100 },
            entityChanges: [
              {
                entityType: 'TASK' as EntityType,
                entityId: 'task-1',
                opType: OpType.Update,
                changes: { taskId: 'task-1', date: '2026-07-10', duration: 100 },
              },
            ],
          },
          timestamp: 1000,
        }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('newer');
    expect(entry.status).toBe('unreviewed');
    const durationDiff = entry.fieldDiffs.find((d) => d.field === 'duration');
    expect(durationDiff?.localVal).toBe(100);
    expect(durationDiff?.localChanged).toBe(true);
  });

  it('records per-side presence so winner-only fields are not attributed to the loser', () => {
    // local (loser) changed only title; remote (winner) changed title + notes.
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({ payload: { task: { id: 'task-1', title: 'Local' } }, timestamp: 1000 }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote', notes: 'Remote notes' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    const titleDiff = entry.fieldDiffs.find((d) => d.field === 'title');
    expect(titleDiff?.localChanged).toBe(true);
    expect(titleDiff?.remoteChanged).toBe(true);
    const notesDiff = entry.fieldDiffs.find((d) => d.field === 'notes');
    expect(notesDiff?.localChanged).toBe(false);
    expect(notesDiff?.remoteChanged).toBe(true);
  });

  it('same-field edit, equal timestamps, remote wins → reason "tie"', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({ payload: { task: { id: 'task-1', title: 'Local' } }, timestamp: 1000 }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 1000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('tie');
    expect(entry.status).toBe('unreviewed');
  });

  it('edit vs delete (delete wins) → reason "delete-wins", status "unreviewed"', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({ payload: { task: { id: 'task-1', title: 'Local' } }, timestamp: 1000 }),
      ],
      remoteOps: [
        op({
          opType: OpType.Delete,
          actionType: '[Task] Delete' as ActionType,
          payload: { task: { id: 'task-1' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('delete-wins');
    expect(entry.status).toBe('unreviewed');
  });

  it('archive plan reason → reason "delete-wins"', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'local',
      planReason: 'local-archive',
      localOps: [
        op({
          actionType: '[Task] Move to archive' as ActionType,
          payload: { task: { id: 'task-1', title: 'Local' } },
          timestamp: 1000,
        }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('delete-wins');
  });

  it('delete vs edit (edit wins, delete lost) → reason "delete-lost", status "unreviewed"', () => {
    // Local deleted the task; remote edited it concurrently and newer, so LWW
    // resurrects the entity and the local DELETE is discarded. The loser side is
    // a pure Delete op (no field changes) — without the delete-lost branch this
    // would fall through to `noise`/`info` and never surface for review.
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote', // the edit side won
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({
          opType: OpType.Delete,
          actionType: '[Task] Delete' as ActionType,
          payload: { task: { id: 'task-1' } },
          timestamp: 1000,
        }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('delete-lost');
    expect(entry.status).toBe('unreviewed');
    expect(entry.winner).toBe('remote');
  });

  it('loser changed only NOISE fields → reason "noise", status "info"', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      // loser (local) only bumped `modified` — a NOISE field: nothing real lost.
      localOps: [
        op({ payload: { task: { id: 'task-1', modified: 111 } }, timestamp: 1000 }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', modified: 222 } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('noise');
    expect(entry.status).toBe('info');
  });

  it('loser changed an ordering/membership array (subTaskIds) → reviewable, NOT noise (SPAP-13 safety)', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      // loser (local) changed subTaskIds — membership-bearing, so deliberately
      // NOT a NOISE field: a dropped member must surface as reviewable, not info.
      localOps: [
        op({
          payload: { task: { id: 'task-1', subTaskIds: ['s1', 's2'] } },
          timestamp: 1000,
        }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', subTaskIds: ['s1'] } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('newer');
    expect(entry.status).toBe('unreviewed');
  });

  it('clock-corruption escalation → reason "clock-corruption-suspected", status "unreviewed"', () => {
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote',
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({ payload: { task: { id: 'task-1', title: 'Local' } }, timestamp: 1000 }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Remote' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: true,
      resolvePayloadKey,
    });

    expect(entry.reason).toBe('clock-corruption-suspected');
    expect(entry.status).toBe('unreviewed');
  });

  it('preserves the LOSER values verbatim (incl. nested objects)', () => {
    const discarded = { steps: ['a', 'b'], nested: { x: 1 } };
    const entry = buildConflictJournalEntry({
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      winner: 'remote', // local is the loser
      planReason: 'remote-timestamp-or-tie',
      localOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Loser', notes: discarded } },
          timestamp: 1000,
        }),
      ],
      remoteOps: [
        op({
          payload: { task: { id: 'task-1', title: 'Winner' } },
          timestamp: 2000,
          clientId: 'B',
        }),
      ],
      isCorruptionSuspected: false,
      resolvePayloadKey,
    });

    const notesDiff = entry.fieldDiffs.find((d) => d.field === 'notes');
    expect(notesDiff?.localVal).toEqual(discarded);
    const titleDiff = entry.fieldDiffs.find((d) => d.field === 'title');
    expect(titleDiff?.localVal).toBe('Loser');
    expect(titleDiff?.remoteVal).toBe('Winner');
  });
});
