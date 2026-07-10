import {
  computeWinCounts,
  groupByEntityType,
  loserChangesFor,
  reasonI18nKey,
  statusI18nKey,
  winnerChangesFor,
  winnerI18nKey,
} from './sync-conflict-review.util';
import { ConflictJournalEntry } from './conflict-journal.model';
import { EntityType } from '../core/operation.types';
import { T } from '../../t.const';

const makeEntry = (over: Partial<ConflictJournalEntry> = {}): ConflictJournalEntry => ({
  id: 'e',
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  entityTitle: 'Test Task',
  resolvedAt: 1000,
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

describe('sync-conflict-review.util', () => {
  describe('computeWinCounts', () => {
    it('tallies remote/local winners and excludes merged from the breakdown', () => {
      const counts = computeWinCounts([
        makeEntry({ winner: 'remote' }),
        makeEntry({ winner: 'remote' }),
        makeEntry({ winner: 'local' }),
        makeEntry({ winner: 'merged' }),
      ]);
      expect(counts).toEqual({ total: 4, remoteWins: 2, localWins: 1 });
    });

    it('is all-zero for an empty list', () => {
      expect(computeWinCounts([])).toEqual({ total: 0, remoteWins: 0, localWins: 0 });
    });
  });

  describe('loserChangesFor / winnerChangesFor', () => {
    const entry = makeEntry({
      winner: 'remote',
      fieldDiffs: [
        {
          field: 'title',
          localVal: 'Local title',
          remoteVal: 'Remote title',
          pickedSide: 'remote',
        },
        {
          field: 'notes',
          localVal: 'Local notes',
          remoteVal: 'Remote notes',
          pickedSide: 'remote',
        },
      ],
    });

    it('loserChangesFor returns the discarded (losing) side values', () => {
      // remote won, so the loser is local
      expect(loserChangesFor(entry)).toEqual({
        title: 'Local title',
        notes: 'Local notes',
      });
    });

    it('winnerChangesFor returns the kept (winning) side values', () => {
      expect(winnerChangesFor(entry)).toEqual({
        title: 'Remote title',
        notes: 'Remote notes',
      });
    });

    it('skips diffs with no pickedSide (merged fields)', () => {
      const merged = makeEntry({
        winner: 'merged',
        fieldDiffs: [
          // pickedSide 'local' but remote never changed the field → no loser value
          { field: 'title', localVal: 'L', remoteVal: undefined, pickedSide: 'local' },
          { field: 'x', localVal: 1, remoteVal: 2 }, // no pickedSide
        ],
      });
      expect(loserChangesFor(merged)).toEqual({});
    });

    it('loserChangesFor omits fields the losing side never changed', () => {
      // local (loser) changed only title; remote (winner) changed title + notes.
      // Emitting notes: undefined would CLEAR the winner-only field on flip.
      const e = makeEntry({
        winner: 'remote',
        fieldDiffs: [
          {
            field: 'title',
            localVal: 'Local title',
            remoteVal: 'Remote title',
            localChanged: true,
            remoteChanged: true,
            pickedSide: 'remote',
          },
          {
            field: 'notes',
            localVal: undefined,
            remoteVal: 'Remote notes',
            localChanged: false,
            remoteChanged: true,
            pickedSide: 'remote',
          },
        ],
      });
      const changes = loserChangesFor(e);
      expect(changes).toEqual({ title: 'Local title' });
      expect(Object.prototype.hasOwnProperty.call(changes, 'notes')).toBe(false);
    });

    it('loserChangesFor falls back to value-presence for legacy diffs without flags', () => {
      const e = makeEntry({
        winner: 'remote',
        fieldDiffs: [
          {
            field: 'notes',
            localVal: undefined,
            remoteVal: 'Remote notes',
            pickedSide: 'remote',
          },
        ],
      });
      expect(Object.prototype.hasOwnProperty.call(loserChangesFor(e), 'notes')).toBe(
        false,
      );
    });

    it('returns nothing for merged entries even when a tiebroken noise diff has a pickedSide', () => {
      // buildMergedFieldDiffs sets pickedSide on EVERY diff (incl. the noise
      // tiebreak), so per-diff pickedSide checks alone don't exclude merged
      // entries — nothing was discarded, so there is no loser/winner side.
      const merged = makeEntry({
        winner: 'merged',
        fieldDiffs: [
          {
            field: 'modified',
            localVal: 1111,
            remoteVal: 2222,
            localChanged: true,
            remoteChanged: true,
            pickedSide: 'remote',
          },
        ],
      });
      expect(loserChangesFor(merged)).toEqual({});
      expect(winnerChangesFor(merged)).toEqual({});
    });

    it('excludes action-payload diffs from both loser and winner changes', () => {
      // kind: 'action' diffs carry a raw action payload, not an entity field —
      // dispatching or stale-comparing them would corrupt the entity.
      const e = makeEntry({
        winner: 'remote',
        fieldDiffs: [
          {
            field: '[Task] Convert to sub task',
            localVal: { taskId: 'task-1', targetParentId: 'parent-1' },
            remoteVal: undefined,
            localChanged: true,
            remoteChanged: false,
            pickedSide: 'remote',
            kind: 'action',
          },
        ],
      });
      expect(loserChangesFor(e)).toEqual({});
      expect(winnerChangesFor(e)).toEqual({});
    });

    it('winnerChangesFor omits fields the winning side never changed', () => {
      // Loser-only field: leaking winner-side undefined into the stale compare
      // would flag EVERY such entry stale (undefined never equals current value).
      const e = makeEntry({
        winner: 'local',
        fieldDiffs: [
          {
            field: 'notes',
            localVal: undefined,
            remoteVal: 'Remote notes',
            localChanged: false,
            remoteChanged: true,
            pickedSide: 'local',
          },
        ],
      });
      expect(Object.prototype.hasOwnProperty.call(winnerChangesFor(e), 'notes')).toBe(
        false,
      );
    });
  });

  describe('i18n key mappers', () => {
    it('maps reasons', () => {
      expect(reasonI18nKey('delete-wins')).toBe(
        T.F.SYNC.CONFLICT_REVIEW.REASON_DELETE_WINS,
      );
      expect(reasonI18nKey('disjoint-merge')).toBe(
        T.F.SYNC.CONFLICT_REVIEW.REASON_DISJOINT_MERGE,
      );
    });

    it('maps winners and statuses', () => {
      expect(winnerI18nKey('local')).toBe(T.F.SYNC.CONFLICT_REVIEW.WINNER_LOCAL);
      expect(statusI18nKey('flipped')).toBe(T.F.SYNC.CONFLICT_REVIEW.STATUS_FLIPPED);
    });
  });

  describe('groupByEntityType', () => {
    it('groups by entity type preserving order', () => {
      const groups = groupByEntityType([
        makeEntry({ id: 't1', entityType: 'TASK' as EntityType }),
        makeEntry({ id: 'p1', entityType: 'PROJECT' as EntityType }),
        makeEntry({ id: 't2', entityType: 'TASK' as EntityType }),
      ]);
      expect(groups.map((g) => g.entityType)).toEqual(['TASK', 'PROJECT']);
      expect(groups[0].entries.map((e) => e.id)).toEqual(['t1', 't2']);
      expect(groups[0].labelKey).toBe(T.F.SYNC.CONFLICT_REVIEW.GROUP_TASK);
    });
  });
});
