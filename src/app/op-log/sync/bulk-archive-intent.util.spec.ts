import {
  compareVectorClocks,
  type LwwConflictResolutionPlan,
  VectorClockComparison,
} from '@sp/sync-core';
import { ActionType, EntityConflict, Operation, OpType } from '../core/operation.types';
import {
  buildArchiveWinOp,
  getBulkArchiveIntentKey,
  groupArchiveWinConflicts,
} from './bulk-archive-intent.util';

const archiveOp = (overrides: Partial<Operation> = {}): Operation => ({
  id: 'archive-op',
  actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
  opType: OpType.Update,
  entityType: 'TASK',
  entityId: 'a',
  entityIds: ['a', 'b', 'c'],
  payload: { actionPayload: { tasks: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] } },
  clientId: 'local',
  vectorClock: { local: 1 },
  timestamp: 1_000,
  schemaVersion: 1,
  ...overrides,
});

const remoteEdit = (entityId: string, remoteCounter: number): Operation => ({
  id: `remote-${entityId}`,
  actionType: ActionType.TASK_SHARED_UPDATE,
  opType: OpType.Update,
  entityType: 'TASK',
  entityId,
  payload: {},
  clientId: 'remote',
  vectorClock: { remote: remoteCounter },
  timestamp: 2_000,
  schemaVersion: 1,
});

const row = (localOps: Operation[], remoteOp: Operation): EntityConflict => ({
  entityType: 'TASK',
  entityId: remoteOp.entityId!,
  localOps,
  remoteOps: [remoteOp],
  suggestedResolution: 'manual',
});

const archiveWinPlan = (
  conflict: EntityConflict,
): LwwConflictResolutionPlan<EntityConflict> => ({
  conflict,
  winner: 'local',
  reason: 'local-archive',
  localWinOperationKind: 'archive-win',
});

describe('getBulkArchiveIntentKey', () => {
  it('ignores op id, clock, client and footprint order', () => {
    const copy = archiveOp({
      id: 'copy',
      clientId: 'other',
      vectorClock: { local: 7, remote: 3 },
      entityIds: ['c', 'a', 'b'],
    });

    expect(getBulkArchiveIntentKey(copy)).toBe(getBulkArchiveIntentKey(archiveOp()));
  });

  it('keeps a later re-archive of the same task set distinct', () => {
    expect(getBulkArchiveIntentKey(archiveOp({ timestamp: 1_001 }))).not.toBe(
      getBulkArchiveIntentKey(archiveOp()),
    );
  });

  it('keeps a different payload distinct', () => {
    const otherPayload = archiveOp({
      payload: { actionPayload: { tasks: [{ id: 'a', title: 'x' }] } },
    });

    expect(getBulkArchiveIntentKey(otherPayload)).not.toBe(
      getBulkArchiveIntentKey(archiveOp()),
    );
  });
});

describe('groupArchiveWinConflicts', () => {
  it('groups every archive-win row of one bulk archive into ONE group', () => {
    const bulk = archiveOp();
    const rowB = row([bulk], remoteEdit('b', 1));
    const rowC = row([bulk], remoteEdit('c', 2));

    const groups = groupArchiveWinConflicts([archiveWinPlan(rowB), archiveWinPlan(rowC)]);

    expect(groups.length).toBe(1);
    expect(groups[0].archiveOp).toBe(bulk);
    expect(groups[0].conflicts).toEqual([rowB, rowC]);
  });

  it('folds pending exact copies of one intent into one group (#10102 heal)', () => {
    const copyB = archiveOp({ id: 'copy-b', vectorClock: { local: 2, remote: 1 } });
    const copyC = archiveOp({ id: 'copy-c', vectorClock: { local: 2, remote: 2 } });
    const rowA = row([copyB, copyC], remoteEdit('a', 3));
    const rowB = row([copyC, copyB], remoteEdit('b', 4));

    const groups = groupArchiveWinConflicts([archiveWinPlan(rowA), archiveWinPlan(rowB)]);

    expect(groups.length).toBe(1);
    expect(groups[0].conflicts).toEqual([rowA, rowB]);
  });

  it('keeps distinct archive intents apart and ignores other plan kinds', () => {
    const first = archiveOp();
    const second = archiveOp({ id: 'second', timestamp: 5_000 });
    const rowA = row([first], remoteEdit('a', 1));
    const rowB = row([second], remoteEdit('b', 2));
    const updateRow = row([], remoteEdit('c', 3));

    const groups = groupArchiveWinConflicts([
      archiveWinPlan(rowA),
      archiveWinPlan(rowB),
      { ...archiveWinPlan(updateRow), localWinOperationKind: 'update' },
    ]);

    expect(groups.map(({ archiveOp: op }) => op.id)).toEqual(['archive-op', 'second']);
  });
});

describe('buildArchiveWinOp', () => {
  it('copies the intent and dominates every op of every won row', () => {
    const copyB = archiveOp({ id: 'copy-b', vectorClock: { local: 2, remote: 1 } });
    const copyC = archiveOp({ id: 'copy-c', vectorClock: { local: 2, remote: 2 } });
    const editA = remoteEdit('a', 3);
    const editB = remoteEdit('b', 4);
    const conflicts = [row([copyB, copyC], editA), row([copyB, copyC], editB)];

    const op = buildArchiveWinOp({ archiveOp: copyB, conflicts }, 'local');

    expect(getBulkArchiveIntentKey(op)).toBe(getBulkArchiveIntentKey(copyB));
    expect(op.id).not.toBe(copyB.id);
    expect(op.clientId).toBe('local');
    expect(op.vectorClock).toEqual({ local: 3, remote: 4 });
    for (const dominated of [copyB, copyC, editA, editB]) {
      expect(compareVectorClocks(op.vectorClock, dominated.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
    }
  });
});
