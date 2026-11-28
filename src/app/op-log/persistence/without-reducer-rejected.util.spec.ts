import {
  MAX_LOGGED_REDUCER_REJECTED,
  withoutReducerRejected,
} from './without-reducer-rejected.util';
import { OpLog } from '../../core/log';
import {
  ActionType,
  Operation,
  OperationLogEntry,
  OpType,
} from '../core/operation.types';

describe('withoutReducerRejected', () => {
  const entry = (seq: number, reducerRejectedAt?: number): OperationLogEntry => ({
    seq,
    op: {
      id: `op-${seq}`,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: `task-${seq}`,
      actionType: '[Task] Update Task' as ActionType,
      payload: { task: { id: `task-${seq}`, changes: { title: 'Call Anna' } } },
      vectorClock: { clientA: seq },
      clientId: 'clientA',
      timestamp: 1000 + seq,
      schemaVersion: 1,
    } as Operation,
    appliedAt: 2000 + seq,
    source: 'remote',
    ...(reducerRejectedAt === undefined ? {} : { reducerRejectedAt }),
  });

  it('returns every entry and logs nothing when none is reducer-rejected', () => {
    const warnSpy = spyOn(OpLog, 'warn');
    const entries = [entry(1), entry(2)];

    expect(withoutReducerRejected(entries)).toEqual(entries);
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('drops reducer-rejected entries and names them without their payload', () => {
    const warnSpy = spyOn(OpLog, 'warn');

    const result = withoutReducerRejected([entry(1), entry(2, 5000), entry(3)]);

    expect(result.map((e) => e.seq)).toEqual([1, 3]);
    expect(warnSpy).toHaveBeenCalledOnceWith(
      'Hydration: skipping 1 op(s) that failed to apply earlier; their changes are missing on this device',
      {
        opId: 'op-2',
        actionType: '[Task] Update Task',
        entityType: 'TASK',
        entityIds: ['task-2'],
        entityCount: 1,
        source: 'remote',
        reducerRejectedAt: 5000,
      },
    );
    expect(JSON.stringify(warnSpy.calls.allArgs())).not.toContain('Call Anna');
  });

  it('reports the full count but lists only the first few ops', () => {
    const warnSpy = spyOn(OpLog, 'warn');
    const entries = Array.from({ length: 8 }, (_, i) => entry(i + 1, 5000));

    expect(withoutReducerRejected(entries)).toEqual([]);

    const [message, ...listed] = warnSpy.calls.mostRecent().args;
    expect(message).toContain('skipping 8 op(s)');
    expect(listed.length).toBe(MAX_LOGGED_REDUCER_REJECTED);
    expect(MAX_LOGGED_REDUCER_REJECTED).toBe(5);
  });
});
