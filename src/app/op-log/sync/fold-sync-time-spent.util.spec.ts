import {
  buildTimeAwareResolutionBatches,
  foldSyncTimeSpentDeltas,
  orderIncomingPrefix,
  remoteWinsInServerOrder,
} from './fold-sync-time-spent.util';
import { ActionType, EntityType, OpType, Operation } from '../core/operation.types';

const DAY = '2026-07-10';
const PREV_DAY = '2026-07-09';
const NEXT_DAY = '2026-07-11';

const deltaOp = (actionPayload: Record<string, unknown>): Operation => ({
  id: 'op-delta',
  actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
  opType: OpType.Update,
  entityType: 'TASK' as EntityType,
  entityId: 'task-1',
  payload: { actionPayload, entityChanges: [] },
  clientId: 'B',
  vectorClock: { B: 1 },
  timestamp: 1000,
  schemaVersion: 1,
});

describe('foldSyncTimeSpentDeltas', () => {
  const changes = { timeSpent: 900, timeSpentOnDay: { [DAY]: 600, [PREV_DAY]: 300 } };

  it('adds the delta to its day and recomputes timeSpent', () => {
    expect(
      foldSyncTimeSpentDeltas('task-1', changes, [
        deltaOp({ taskId: 'task-1', date: DAY, duration: 50 }),
        deltaOp({ taskId: 'task-1', date: NEXT_DAY, duration: 7 }),
      ]),
    ).toEqual({
      timeSpent: 957,
      timeSpentOnDay: { [DAY]: 650, [PREV_DAY]: 300, [NEXT_DAY]: 7 },
    });
  });

  it('ignores deltas for other tasks, other action types and malformed payloads', () => {
    const otherAction = {
      ...deltaOp({ taskId: 'task-1', date: DAY, duration: 50 }),
      actionType: '[Task] Update' as ActionType,
    };
    const ops = [
      deltaOp({ taskId: 'task-2', date: DAY, duration: 50 }),
      deltaOp({ taskId: 'task-1', date: DAY, duration: Number.NaN }),
      { ...deltaOp({}), payload: null },
      otherAction,
    ];

    expect(foldSyncTimeSpentDeltas('task-1', changes, ops)).toBe(changes);
  });

  it('leaves a projection without timeSpentOnDay untouched', () => {
    const titleOnly = { title: 'x' };
    expect(
      foldSyncTimeSpentDeltas('task-1', titleOnly, [
        deltaOp({ taskId: 'task-1', date: DAY, duration: 50 }),
      ]),
    ).toBe(titleOnly);
  });

  it('includes child deltas in a parent projection without emitting relationship fields', () => {
    expect(
      foldSyncTimeSpentDeltas(
        'parent',
        changes,
        [
          deltaOp({ taskId: 'child', date: DAY, duration: 50 }),
          deltaOp({ taskId: 'other-task', date: DAY, duration: 100 }),
        ],
        ['child'],
      ),
    ).toEqual({
      timeSpent: 950,
      timeSpentOnDay: { [DAY]: 650, [PREV_DAY]: 300 },
    });
  });

  // The reducer adds a child's delta to the parent's stored timeSpent; the fold
  // recomputes it from timeSpentOnDay. On a drifted parent the two differ, but
  // every device applies the same folded snapshot, so they still converge.
  it('recomputes a drifted parent timeSpent from timeSpentOnDay', () => {
    const drifted = { ...changes, timeSpent: 1234 };
    expect(
      foldSyncTimeSpentDeltas(
        'parent',
        drifted,
        [deltaOp({ taskId: 'child', date: DAY, duration: 50 })],
        ['child'],
      ),
    ).toEqual({
      timeSpent: 950,
      timeSpentOnDay: { [DAY]: 650, [PREV_DAY]: 300 },
    });
  });
});

describe('buildTimeAwareResolutionBatches: readable fields of nonconflicting ops', () => {
  const localWin = (
    lwwUpdateMode: 'replace' | 'patch' = 'replace',
    actionPayload: Record<string, unknown> = { id: 'task-1', title: 'T', isDone: true },
  ): Operation => ({
    id: 'op-local-win',
    actionType: '[TASK] LWW Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId: 'task-1',
    payload: { actionPayload, entityChanges: [], lwwUpdateMode },
    clientId: 'B',
    vectorClock: { A: 2, B: 3 },
    timestamp: 3000,
    schemaVersion: 1,
  });
  const taskUpdate = (
    id: string,
    changes: Record<string, unknown>,
    extra: Partial<Operation> & { clearedFields?: string[] } = {},
  ): Operation => {
    const { clearedFields, ...opExtra } = extra;
    return {
      id,
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK' as EntityType,
      entityId: 'task-1',
      payload: {
        actionPayload: {
          task: { id: opExtra.entityId ?? 'task-1', changes },
          ...(clearedFields ? { clearedFields } : {}),
        },
        entityChanges: [],
      },
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      schemaVersion: 1,
      ...opExtra,
    };
  };
  const build = (
    newLocalWinOps: Operation[],
    nonConflictingOps: Operation[],
    remoteWinsOps: Operation[] = [],
  ): ReturnType<typeof buildTimeAwareResolutionBatches> =>
    buildTimeAwareResolutionBatches({
      unappliedRemoteLosers: [],
      compensatedRemoteOps: [],
      newLocalWinOps,
      remoteWinsOps,
      localMultiReconciliationOps: [],
      nonConflictingOps,
      getTask: async () => undefined,
    });
  const localBatchOps = (
    batches: Awaited<ReturnType<typeof build>>['batches'],
  ): readonly Operation[] => batches.find((batch) => batch.source === 'local')!.ops;

  // #10385: a notes edit that commutes with a pending time delta arrives in
  // the same download as a done toggle this device wins.
  it('overlays the edit onto a replace snapshot and keeps its clock and position', async () => {
    const notesEdit = taskUpdate(
      'op-notes',
      { notes: 'from A' },
      { vectorClock: { A: 4 } },
    );
    const { batches, precedingOps } = await build([localWin()], [notesEdit]);

    // Merging the edit's clock would also claim its author's earlier,
    // uncarried writes to the task, so the server would accept a snapshot it
    // rejects on master (review of #10398). The edit stays after the snapshot
    // and re-applies the same value there on replay.
    expect(precedingOps).toEqual([]);
    expect(batches.map((batch) => batch.source)).toEqual(['local']);
    const [snapshot] = localBatchOps(batches);
    expect((snapshot.payload as { actionPayload: unknown }).actionPayload).toEqual({
      id: 'task-1',
      title: 'T',
      isDone: true,
      notes: 'from A',
    });
    expect(snapshot.vectorClock).toEqual({ A: 2, B: 3 });
  });

  it('carries a clear, and lets the later of two edits win a field', async () => {
    const first = taskUpdate('op-1', { notes: 'first', title: 'renamed' });
    const clear = taskUpdate('op-2', {}, { clearedFields: ['notes'] });
    const { batches } = await build([localWin()], [first, clear]);

    const actionPayload = (
      localBatchOps(batches)[0].payload as {
        actionPayload: Record<string, unknown>;
      }
    ).actionPayload;
    expect(actionPayload['title']).toBe('renamed');
    expect('notes' in actionPayload).toBeTrue();
    expect(actionPayload['notes']).toBeUndefined();
  });

  it('leaves the snapshot alone for ops that are not plain field edits of this task', async () => {
    const snapshot = localWin();
    const ignored = [
      taskUpdate('op-other-task', { notes: 'x' }, { entityId: 'task-2' }),
      taskUpdate('op-multi', { notes: 'x' }, { entityIds: ['task-1', 'task-2'] }),
      taskUpdate('op-opaque', {}),
      taskUpdate('op-time-only', { timeSpentOnDay: { [DAY]: 1 }, timeSpent: 1 }),
      // `isDone` also sets `doneOn` in the reducer; an overlay cannot.
      taskUpdate('op-reopen', { isDone: false }),
      taskUpdate('op-notes-and-done', { notes: 'x', isDone: false }),
      { ...localWin(), id: 'op-remote-lww', clientId: 'A' },
      // A delta's arguments are not task fields (#10147), although capture
      // records them as its entity change.
      {
        ...deltaOp({ taskId: 'task-1', date: DAY, duration: 50 }),
        payload: {
          actionPayload: { taskId: 'task-1', date: DAY, duration: 50 },
          entityChanges: [
            {
              entityType: 'TASK' as EntityType,
              entityId: 'task-1',
              opType: OpType.Update,
              changes: { taskId: 'task-1', date: DAY, duration: 50 },
            },
          ],
        },
      },
    ];
    const { batches, precedingOps } = await build([snapshot], ignored);

    expect(precedingOps).toEqual([]);
    expect(localBatchOps(batches)).toEqual([snapshot]);
  });

  // The remote winner is applied after the snapshot, so a folded field could
  // differ from this device's post-batch value.
  it('leaves the snapshot alone when a remote winner of the task follows it', async () => {
    const snapshot = localWin();
    const remoteWinner = { ...localWin(), id: 'op-remote-winner', clientId: 'C' };
    const { batches, precedingOps } = await build(
      [snapshot],
      [taskUpdate('op-rename', { title: 'older' })],
      [remoteWinner],
    );

    expect(precedingOps).toEqual([]);
    expect(localBatchOps(batches)).toEqual([snapshot]);
  });

  // #10423: a remote winner of a task without a local win goes right after
  // the incoming op it dominates, ahead of the local rows; one beside a local
  // win of its task stays after it, so it overrides the snapshot on replay.
  it('orders a remote winner after the incoming op it dominates', async () => {
    const snapshot = localWin();
    const rename = taskUpdate('op-rename', { title: 'older' }, { entityId: 'task-2' });
    const winner = {
      ...localWin(),
      id: 'op-remote-winner',
      clientId: 'C',
      entityId: 'task-2',
    };
    const besideLocalWin = { ...localWin(), id: 'op-beside', clientId: 'C' };
    const { batches, precedingOps } = await build(
      [snapshot],
      [rename],
      [winner, besideLocalWin],
    );

    expect(precedingOps).toEqual([rename]);
    expect(batches.map(({ ops }) => ops.map(({ id }) => id))).toEqual([
      ['op-rename', 'op-remote-winner'],
      ['op-local-win'],
      ['op-beside'],
    ]);
  });

  // Review of #10398, finding 1: the estimate edit is hoisted before the
  // snapshot and dominated by the notes edit's clock, but not carried.
  it('leaves the snapshot alone when an unfoldable op on the task comes before a plain edit', async () => {
    const snapshot = localWin();
    const { batches, precedingOps } = await build(
      [snapshot],
      [
        taskUpdate('op-estimate', { timeEstimate: 3600000 }, { vectorClock: { A: 2 } }),
        taskUpdate('op-notes', { notes: 'from A' }, { vectorClock: { A: 3 } }),
      ],
    );

    expect(precedingOps).toEqual([]);
    expect(localBatchOps(batches)).toEqual([snapshot]);
  });

  // Finding 2: a later unfoldable write of the same field is applied after
  // the snapshot, so the overlay would carry a stale value.
  it('leaves the snapshot alone when an unfoldable op on the task follows a plain edit', async () => {
    const snapshot = localWin();
    const { batches } = await build(
      [snapshot],
      [
        taskUpdate('op-notes', { notes: 'first' }),
        taskUpdate('op-notes-and-done', { notes: 'second', isDone: false }),
      ],
    );

    expect(localBatchOps(batches)).toEqual([snapshot]);
  });

  it('counts an op that only names the task, like a new subtask, as unfoldable', async () => {
    const snapshot = localWin();
    const addSubTask: Operation = {
      ...taskUpdate('op-add-sub', {}),
      actionType: '[Task Shared] addSubTask' as ActionType,
      opType: OpType.Create,
      entityId: 'sub-1',
      payload: {
        actionPayload: { task: { id: 'sub-1', parentId: 'task-1' }, parentId: 'task-1' },
        entityChanges: [],
      },
    };
    const { batches } = await build(
      [snapshot],
      [addSubTask, taskUpdate('op-notes', { notes: 'from A' })],
    );

    expect(localBatchOps(batches)).toEqual([snapshot]);
  });

  // Review of #10398, finding 3: a winning delta is folded before the
  // snapshot and writes no plain field, so it must not disable the fold.
  it('still folds beside a winning time delta of the task', async () => {
    const { batches } = await build(
      [localWin()],
      [taskUpdate('op-notes', { notes: 'from A' })],
      [deltaOp({ taskId: 'task-1', date: DAY, duration: 50 })],
    );

    const snapshot = localBatchOps(batches).find((op) => op.id === 'op-local-win')!;
    expect(
      (snapshot.payload as { actionPayload: Record<string, unknown> }).actionPayload[
        'notes'
      ],
    ).toBe('from A');
  });

  // Two local-win snapshots of one task in a batch: each needs the overlay,
  // or the one without it erases the edit (fuzz sweep, tasks:20725016).
  it('overlays every snapshot of the task, not just the first', async () => {
    const { batches } = await build(
      [localWin(), { ...localWin(), id: 'op-local-win-2' }],
      [taskUpdate('op-notes', { notes: 'from A' })],
    );

    const notes = localBatchOps(batches).map(
      (op) =>
        (op.payload as { actionPayload: Record<string, unknown> }).actionPayload['notes'],
    );
    expect(notes).toEqual(['from A', 'from A']);
  });

  it('leaves a patch snapshot alone: it does not erase fields it does not carry', async () => {
    const patch = localWin('patch', { isDone: true });
    const { batches, precedingOps } = await build(
      [patch],
      [taskUpdate('op-notes', { notes: 'from A' })],
    );

    expect(precedingOps).toEqual([]);
    expect(localBatchOps(batches)).toEqual([patch]);
  });
});

describe('buildTimeAwareResolutionBatches: field-patch re-sends (#10422)', () => {
  const taskOp = (
    id: string,
    vectorClock: Record<string, number>,
    entityId = 'task-1',
    clientId = 'B',
  ): Operation => ({
    id,
    actionType: ActionType.TASK_SHARED_UPDATE,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId,
    payload: {
      actionPayload: { task: { id: entityId, changes: { title: id } } },
      entityChanges: [],
    },
    clientId,
    vectorClock,
    timestamp: 1000,
    schemaVersion: 1,
  });
  const build = (
    remoteWinsOps: Operation[],
    nonConflictingOps: Operation[],
    resendOps?: Operation[],
  ): ReturnType<typeof buildTimeAwareResolutionBatches> =>
    buildTimeAwareResolutionBatches({
      unappliedRemoteLosers: [],
      compensatedRemoteOps: [],
      newLocalWinOps: [],
      remoteWinsOps,
      localMultiReconciliationOps: [],
      nonConflictingOps,
      resendOps,
      getTask: async () => undefined,
    });

  // One transaction: a crash cannot leave the remote winners without the
  // re-sent local fields that beat them, and the re-sends follow every
  // incoming op in seq order, as they did when written separately.
  it('writes the re-sends last, after the whole incoming batch', async () => {
    const first = taskOp('first', { B: 1 });
    const winner = taskOp('winner', { B: 2 });
    const concurrent = taskOp('concurrent', { C: 1 }, 'task-2', 'C');
    const later = taskOp('later', { C: 2 }, 'task-2', 'C');
    const resend = taskOp('resend', { A: 2, B: 2 }, 'task-1', 'A');

    const { batches, precedingOps } = await build(
      [winner],
      [first, concurrent, later],
      [resend],
    );

    expect(
      batches.map(({ ops, source, options }) => ({
        ids: ops.map(({ id }) => id),
        source,
        pendingApply: options?.pendingApply ?? false,
      })),
    ).toEqual([
      { ids: ['first', 'winner'], source: 'remote', pendingApply: true },
      { ids: ['concurrent', 'later'], source: 'remote', pendingApply: true },
      { ids: ['resend'], source: 'local', pendingApply: false },
    ]);
    expect(precedingOps).toEqual([first, concurrent, later]);
  });

  it('leaves the incoming batch alone without re-sends', async () => {
    const first = taskOp('first', { B: 1 });
    const winner = taskOp('winner', { B: 2 });
    const concurrent = taskOp('concurrent', { C: 1 }, 'task-2', 'C');

    const { batches, precedingOps } = await build([winner], [first, concurrent]);

    expect(batches.flatMap(({ ops }) => ops.map(({ id }) => id))).toEqual([
      'first',
      'winner',
    ]);
    expect(precedingOps).toEqual([first]);
  });
});

// #10423: on one entity, server order is causal order. A remote winner goes
// after the incoming ops it dominates and before those that dominate it.
describe('orderIncomingPrefix', () => {
  const taskOp = (
    id: string,
    vectorClock: Record<string, number>,
    entityId = 'task-1',
  ): Operation => ({
    id,
    actionType: ActionType.TASK_SHARED_UPDATE,
    opType: OpType.Update,
    entityType: 'TASK' as EntityType,
    entityId,
    payload: {
      actionPayload: { task: { id: entityId, changes: {} } },
      entityChanges: [],
    },
    clientId: 'B',
    vectorClock,
    timestamp: 1000,
    schemaVersion: 1,
  });
  const ids = (ops: Operation[]): string[] => ops.map(({ id }) => id);

  it('places a winner right after the last op it dominates', () => {
    const first = taskOp('first', { B: 1 });
    const second = taskOp('second', { B: 2 });
    const later = taskOp('later', { B: 4 });
    const winner = taskOp('winner', { B: 3 });

    const { ordered, precedingOps, moved } = orderIncomingPrefix(
      [first, second, later],
      [winner],
    );

    expect(ids(ordered)).toEqual(['first', 'second', 'winner']);
    expect(ids(precedingOps)).toEqual(['first', 'second']);
    expect([...moved]).toEqual([winner]);
  });

  it('interleaves several winners in server order', () => {
    const done = taskOp('done', { A: 1 });
    const undone = taskOp('undone', { A: 1, B: 3 });
    const patch = taskOp('patch', { A: 1, B: 2 });
    const rename = taskOp('rename', { A: 1, B: 7 });

    const { ordered } = orderIncomingPrefix([done, undone], [patch, rename]);

    expect(ids(ordered)).toEqual(['done', 'patch', 'undone', 'rename']);
  });

  it('keeps winners in place that dominate no incoming op', () => {
    const concurrent = taskOp('concurrent', { A: 1 });
    const otherTask = taskOp('other-task', { B: 1 }, 'task-2');
    const winner = taskOp('winner', { B: 2 });

    const { ordered, precedingOps, moved } = orderIncomingPrefix(
      [concurrent, otherTask],
      [winner],
    );

    expect(ordered).toEqual([]);
    expect(precedingOps).toEqual([]);
    expect(moved.size).toBe(0);
  });

  it('puts a winner first when an op of the prefix dominates it', () => {
    const folded = taskOp('folded', { B: 2 });
    const winner = taskOp('winner', { B: 1 });

    const { ordered, precedingOps } = orderIncomingPrefix([folded], [winner], 1);

    expect(ids(ordered)).toEqual(['winner', 'folded']);
    expect(ids(precedingOps)).toEqual(['folded']);
  });

  it('puts the other winners first when no local row is written', () => {
    const first = taskOp('first', { B: 1 });
    const dominating = taskOp('dominating', { B: 2 });
    const concurrent = taskOp('concurrent', { C: 1 }, 'task-2');

    expect(ids(remoteWinsInServerOrder([first], [concurrent, dominating]))).toEqual([
      'concurrent',
      'first',
      'dominating',
    ]);
  });
});
