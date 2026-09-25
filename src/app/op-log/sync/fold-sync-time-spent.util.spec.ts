import { foldSyncTimeSpentDeltas } from './fold-sync-time-spent.util';
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
});
