import { isExampleTaskCreateOp } from './is-example-task-op.util';
import { ActionType, OperationLogEntry, OpType } from '../core/operation.types';

const entry = (over: {
  actionType?: ActionType | string;
  opType?: OpType;
  entityType?: string;
  payload?: unknown;
}): OperationLogEntry =>
  ({
    seq: 1,
    op: {
      id: 'op-1',
      clientId: 'client-1',
      actionType: (over.actionType ?? ActionType.TASK_SHARED_ADD) as ActionType,
      opType: over.opType ?? OpType.Create,
      entityType: over.entityType ?? 'TASK',
      entityId: 'task-1',
      payload: over.payload ?? {
        actionPayload: { task: { id: 'task-1' }, isExampleTask: true },
        entityChanges: [],
      },
      vectorClock: { client1: 1 },
      timestamp: 1,
      schemaVersion: 1,
    },
    appliedAt: 1,
    source: 'local',
  }) as OperationLogEntry;

describe('isExampleTaskCreateOp', () => {
  it('returns true for a TASK_SHARED_ADD Create op carrying the isExampleTask marker', () => {
    expect(isExampleTaskCreateOp(entry({}))).toBe(true);
  });

  it('returns false for a task create without the marker', () => {
    expect(
      isExampleTaskCreateOp(
        entry({
          payload: { actionPayload: { task: { id: 'task-1' } }, entityChanges: [] },
        }),
      ),
    ).toBe(false);
  });

  it('returns false for a non-TASK_SHARED_ADD action even with the marker', () => {
    expect(isExampleTaskCreateOp(entry({ actionType: '[Task] Add Task' }))).toBe(false);
  });

  it('returns false for an Update op even with the marker', () => {
    expect(isExampleTaskCreateOp(entry({ opType: OpType.Update }))).toBe(false);
  });

  it('returns false for a Delete op even with the marker', () => {
    expect(isExampleTaskCreateOp(entry({ opType: OpType.Delete }))).toBe(false);
  });

  it('returns false for a non-TASK entity type', () => {
    expect(isExampleTaskCreateOp(entry({ entityType: 'PROJECT' }))).toBe(false);
  });

  it('does not throw on an empty payload (treats it as non-example)', () => {
    expect(isExampleTaskCreateOp(entry({ payload: {} }))).toBe(false);
  });
});
