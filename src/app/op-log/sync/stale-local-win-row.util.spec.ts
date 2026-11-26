import { staleLocalWinRowPatches } from './stale-local-win-row.util';
import { ActionType, LwwUpdatePayload, Operation, OpType } from '../core/operation.types';

describe('staleLocalWinRowPatches', () => {
  const snapshot = {
    id: 't1',
    title: 'Write report',
    isDone: false,
    projectId: 'INBOX_PROJECT',
    timeSpent: 1000,
    modified: 1,
  };
  const row = (payload: Partial<LwwUpdatePayload> = {}): Operation => ({
    id: 'row-1',
    actionType: '[TASK] LWW Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 't1',
    payload: {
      actionPayload: snapshot,
      entityChanges: [],
      lwwUpdateMode: 'replace',
      ...payload,
    },
    clientId: 'client-c',
    vectorClock: { clientA: 3, clientC: 2 },
    timestamp: 300,
    schemaVersion: 4,
  });
  const doneOp: Operation = {
    id: 'done-1',
    actionType: ActionType.TASK_SHARED_UPDATE,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 't1',
    payload: { actionPayload: { task: { id: 't1', changes: { isDone: true } } } },
    clientId: 'client-a',
    vectorClock: { clientA: 1 },
    timestamp: 100,
    schemaVersion: 4,
  };
  const otherTaskOp: Operation = { ...doneOp, id: 'other-1', entityId: 't2' };
  otherTaskOp.payload = {
    actionPayload: { task: { id: 't2', changes: { isDone: true } } },
  };
  const stateOf = (state: unknown) => async (): Promise<unknown> => state;

  it('returns the post-apply values a whole snapshot would revert', async () => {
    const live = { ...snapshot, isDone: true, doneOn: 200, timeSpent: 3000, modified: 9 };

    const result = await staleLocalWinRowPatches([row()], [doneOp], stateOf(live));

    // Time and noise stay out; the missing-before `doneOn` is carried too.
    expect(result).toEqual([
      { row: row(), touchingOps: [doneOp], fields: { isDone: true, doneOn: 200 } },
    ]);
  });

  it('returns nothing when no applied op touches the row entity', async () => {
    const live = { ...snapshot, isDone: true };

    const result = await staleLocalWinRowPatches([row()], [otherTaskOp], stateOf(live));

    expect(result).toEqual([]);
  });

  it('returns nothing when the row already carries the post-apply state', async () => {
    const result = await staleLocalWinRowPatches(
      [row()],
      [doneOp],
      stateOf({ ...snapshot, timeSpent: 3000 }),
    );

    expect(result).toEqual([]);
  });

  it('compares only the fields and clears a patch row writes', async () => {
    const patchRow = row({
      actionPayload: { id: 't1', title: 'Write report' },
      lwwUpdateMode: 'patch',
      clearedFields: ['notes'],
    });
    const live = { ...snapshot, isDone: true, notes: 'added remotely' };

    const result = await staleLocalWinRowPatches([patchRow], [doneOp], stateOf(live));

    expect(result.map((patch) => patch.fields)).toEqual([{ notes: 'added remotely' }]);
  });

  it('ignores an op that only names the task in its payload', async () => {
    const childOp: Operation = {
      ...otherTaskOp,
      payload: { actionPayload: { task: { id: 't2', changes: { parentId: 't1' } } } },
    };

    const result = await staleLocalWinRowPatches(
      [row()],
      [childOp],
      stateOf({ ...snapshot, isDone: true }),
    );

    expect(result).toEqual([]);
  });

  it('leaves rows of other entity types alone', async () => {
    const noteRow: Operation = { ...row(), entityType: 'NOTE' };
    const noteOp: Operation = { ...doneOp, entityType: 'NOTE' };

    const result = await staleLocalWinRowPatches(
      [noteRow],
      [noteOp],
      stateOf({ ...snapshot, isDone: true }),
    );

    expect(result).toEqual([]);
  });

  it('skips a row that was itself applied in the batch', async () => {
    const result = await staleLocalWinRowPatches(
      [row()],
      [row(), doneOp],
      stateOf({ ...snapshot, isDone: true }),
    );

    expect(result).toEqual([]);
  });

  it('skips a row whose entity is gone after the apply', async () => {
    const result = await staleLocalWinRowPatches([row()], [doneOp], stateOf(undefined));

    expect(result).toEqual([]);
  });
});
