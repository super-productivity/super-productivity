import { ActionType, Operation, OpType } from '../core/operation.types';
import { scopeBulkArchivePayload } from './scope-bulk-archive-payload.util';

const archiveOp = (payload: unknown): Operation =>
  ({
    id: 'archive-op',
    actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    entityType: 'TASK',
    opType: OpType.Update,
    entityId: 'p1',
    entityIds: ['p1', 'p2', 'c1', 'c2'],
    payload,
  }) as unknown as Operation;

const tasks = [
  { id: 'p1', subTaskIds: ['c1'], subTasks: [{ id: 'c1' }] },
  { id: 'p2', subTaskIds: ['c2'], subTasks: [{ id: 'c2' }] },
];

describe('scopeBulkArchivePayload', () => {
  it('keeps only retained top-level tasks and re-derives the cascaded footprint', () => {
    const { payload, entityIds } = scopeBulkArchivePayload(archiveOp({ tasks }), ['p1']);

    expect((payload as { tasks: { id: string }[] }).tasks.map((t) => t.id)).toEqual([
      'p1',
    ]);
    expect(entityIds).toEqual(['p1', 'c1']);
  });

  it('narrows entityChanges of a multi-entity payload to the scoped footprint', () => {
    const multi = {
      actionPayload: { tasks },
      entityChanges: ['p1', 'c1', 'p2', 'c2'].map((entityId) => ({
        entityId,
        entityType: 'TASK',
        opType: OpType.Update,
      })),
    };

    const { payload } = scopeBulkArchivePayload(archiveOp(multi), ['p2']);

    expect(
      (payload as { entityChanges: { entityId: string }[] }).entityChanges.map(
        (c) => c.entityId,
      ),
    ).toEqual(['p2', 'c2']);
  });

  it('throws a clean error for a payload without a tasks array', () => {
    expect(() =>
      scopeBulkArchivePayload(archiveOp({ tasks: null }), ['p1']),
    ).toThrowError(/Cannot scope bulk archive/);
  });
});
