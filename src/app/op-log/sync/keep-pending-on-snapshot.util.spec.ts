import { ActionType, OperationLogEntry, OpType } from '../core/operation.types';
import { T } from '../../t.const';
import {
  canKeepPendingOnSnapshot,
  reapplyKeptPendingOps,
} from './keep-pending-on-snapshot.util';

const entry = (seq: number, opType: OpType = OpType.Update): OperationLogEntry => ({
  seq,
  op: {
    id: `op-${seq}`,
    clientId: 'local',
    actionType: ActionType.TASK_SHARED_UPDATE,
    opType,
    entityType: 'TASK',
    entityId: `task-${seq}`,
    payload: {},
    vectorClock: { local: seq },
    timestamp: seq,
    schemaVersion: 1,
  },
  appliedAt: seq,
  source: 'local',
});

describe('canKeepPendingOnSnapshot (#10972)', () => {
  const extends_ = { snapshotExtendsLastSeen: true };

  it('keeps pending ops on a catch-up snapshot after a completed sync', () => {
    expect(canKeepPendingOnSnapshot(extends_, [entry(1)], true)).toBe(true);
  });

  it('asks the user when the snapshot does not only extend the last-seen file', () => {
    expect(canKeepPendingOnSnapshot({}, [entry(1)], true)).toBe(false);
  });

  it('asks the user on a client that never completed a sync', () => {
    expect(canKeepPendingOnSnapshot(extends_, [entry(1)], false)).toBe(false);
  });

  it('asks the user when a pending op replaces the whole state', () => {
    expect(
      canKeepPendingOnSnapshot(extends_, [entry(1), entry(2, OpType.SyncImport)], true),
    ).toBe(false);
  });
});

describe('reapplyKeptPendingOps (#10972)', () => {
  type Deps = Parameters<typeof reapplyKeptPendingOps>[0];
  type Spies = Record<
    'store' | 'applier' | 'snack' | 'frontier',
    jasmine.SpyObj<Record<string, jasmine.Spy>>
  >;
  const setup = (
    pending: OperationLogEntry[],
    result: Record<string, unknown>,
  ): Spies & { deps: Deps } => {
    const store = jasmine.createSpyObj('store', [
      'getUnsynced',
      'markReducersCommittedAndMergeClocks',
    ]);
    store.getUnsynced.and.resolveTo(pending);
    store.markReducersCommittedAndMergeClocks.and.resolveTo();
    const applier = jasmine.createSpyObj('applier', ['applyOperations']);
    applier.applyOperations.and.resolveTo(result);
    const snack = jasmine.createSpyObj('snack', ['open']);
    const frontier = jasmine.createSpyObj('frontier', ['establishFrontier']);
    const deps = {
      opLogStore: store,
      operationApplier: applier,
      snackService: snack,
      tabSeqFrontier: frontier,
    } as unknown as Deps;
    return { deps, store, applier, snack, frontier };
  };

  it('replays kept ops in seq order', async () => {
    const [a, b] = [entry(3), entry(1)];
    const { deps, applier, snack, frontier } = setup([a, b], {
      appliedOps: [b.op, a.op],
    });

    await reapplyKeptPendingOps(deps);

    expect(applier.applyOperations).toHaveBeenCalledWith(
      [b.op, a.op],
      jasmine.objectContaining({ isLocalHydration: true }),
    );
    expect(snack.open).not.toHaveBeenCalled();
    // Live state now holds the kept rows, so this tab may save past them.
    expect(frontier.establishFrontier).toHaveBeenCalledOnceWith(3);
  });

  it('drops a kept op the snapshot state cannot take instead of failing sync', async () => {
    const [a, b] = [entry(1), entry(2)];
    const { deps, store, snack } = setup([a, b], {
      appliedOps: [a.op],
      reducerFailures: [{ op: b.op, error: new Error('Project gone') }],
    });

    await reapplyKeptPendingOps(deps);

    // Reducer-rejected: startup replay skips it instead of throwing on it.
    expect(store.markReducersCommittedAndMergeClocks).toHaveBeenCalledWith(
      [],
      [],
      [b.op.id],
    );
    expect(snack.open).toHaveBeenCalledWith(
      jasmine.objectContaining({
        msg: T.F.SYNC.S.LOCAL_CHANGES_DISCARDED_SNAPSHOT,
        translateParams: { count: 1 },
      }),
    );
  });

  it('fails when an op is neither applied nor reducer-rejected', async () => {
    const { deps, store, frontier } = setup([entry(1), entry(2)], {
      appliedOps: [entry(1).op],
    });

    await expectAsync(reapplyKeptPendingOps(deps)).toBeRejectedWithError(
      /kept local changes not re-applied/,
    );
    expect(store.markReducersCommittedAndMergeClocks).not.toHaveBeenCalled();
    expect(frontier.establishFrontier).not.toHaveBeenCalled();
  });
});
