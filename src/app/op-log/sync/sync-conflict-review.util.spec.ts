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
          { field: 'title', localVal: 'L', remoteVal: undefined, pickedSide: 'local' },
          { field: 'x', localVal: 1, remoteVal: 2 }, // no pickedSide
        ],
      });
      expect(loserChangesFor(merged)).toEqual({ title: undefined });
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
