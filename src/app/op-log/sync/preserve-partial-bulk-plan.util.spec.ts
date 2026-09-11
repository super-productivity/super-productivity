/* eslint-disable @typescript-eslint/naming-convention */
import type { LwwResolvedConflict } from '@sp/sync-core';
import { ActionType, EntityConflict, Operation, OpType } from '../core/operation.types';
import { buildScopedBulkPlanReplacements } from './preserve-partial-bulk-plan.util';

describe('buildScopedBulkPlanReplacements', () => {
  const CLIENT_ID = 'local-client';

  const planOp = (over: Partial<Operation> = {}): Operation => ({
    id: 'plan-op-1',
    actionType: ActionType.TASK_SHARED_PLAN_FOR_TODAY,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-a',
    entityIds: ['task-a', 'task-b', 'task-c'],
    payload: {
      actionPayload: {
        taskIds: ['task-a', 'task-b', 'task-c'],
        today: '2026-07-30',
        startOfNextDayDiffMs: 0,
        parentTaskMap: { 'task-a': 'parent-x', 'task-b': undefined },
      },
      entityChanges: [],
    },
    clientId: CLIENT_ID,
    vectorClock: { [CLIENT_ID]: 3 },
    timestamp: 1000,
    schemaVersion: 1,
    ...over,
  });

  const remoteOp = (entityId: string, over: Partial<Operation> = {}): Operation => ({
    id: `remote-${entityId}`,
    actionType: '[Task Shared] updateTask' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId,
    payload: { task: { id: entityId, changes: { title: 'remote' } } },
    clientId: 'remote-client',
    vectorClock: { 'remote-client': 7 },
    timestamp: 2000,
    schemaVersion: 1,
    ...over,
  });

  const resolutionOf = (
    localOps: Operation[],
    entityId: string,
    winner: 'local' | 'remote',
    localWinOp?: Operation,
  ): LwwResolvedConflict<Operation, EntityConflict> => ({
    winner,
    localWinOp,
    conflict: {
      entityType: 'TASK',
      entityId,
      localOps,
      remoteOps: [remoteOp(entityId)],
      suggestedResolution: 'manual',
    },
  });

  it('narrows taskIds AND parentTaskMap to the surviving siblings', () => {
    const op = planOp();
    const replacements = buildScopedBulkPlanReplacements(
      [resolutionOf([op], 'task-a', 'remote')],
      CLIENT_ID,
    );

    expect(replacements.length).toBe(1);
    const [replacement] = replacements;
    expect(replacement.entityIds).toEqual(['task-b', 'task-c']);
    expect(replacement.entityId).toBe('task-b');
    const actionPayload = (
      replacement.payload as { actionPayload: Record<string, unknown> }
    ).actionPayload;
    expect(actionPayload['taskIds']).toEqual(['task-b', 'task-c']);
    // task-a's entry must not survive into the narrowed row.
    expect(actionPayload['parentTaskMap']).toEqual({ 'task-b': undefined });
    expect(actionPayload['today']).toBe('2026-07-30');
    expect(replacement.timestamp).toBe(op.timestamp);
    expect(replacement.id).not.toBe(op.id);
    expect(replacement.clientId).toBe(CLIENT_ID);
  });

  it('retains an uncovered local-win target (no snapshot op) instead of dropping its intent', () => {
    const op = planOp();
    const replacements = buildScopedBulkPlanReplacements(
      [resolutionOf([op], 'task-a', 'local', undefined)],
      CLIENT_ID,
    );

    expect(replacements.length).toBe(1);
    expect(replacements[0].entityIds).toEqual(['task-a', 'task-b', 'task-c']);
  });

  it('drops a covered local-win target (snapshot op exists)', () => {
    const op = planOp();
    const snapshot = remoteOp('task-a', { id: 'snapshot-a', clientId: CLIENT_ID });
    const replacements = buildScopedBulkPlanReplacements(
      [resolutionOf([op], 'task-a', 'local', snapshot)],
      CLIENT_ID,
    );

    expect(replacements.length).toBe(1);
    expect(replacements[0].entityIds).toEqual(['task-b', 'task-c']);
  });

  it('emits nothing when every id was a covered conflict target', () => {
    const op = planOp({
      entityIds: ['task-a'],
      payload: {
        actionPayload: { taskIds: ['task-a'], today: '2026-07-30' },
        entityChanges: [],
      },
    });
    expect(
      buildScopedBulkPlanReplacements(
        [resolutionOf([op], 'task-a', 'remote')],
        CLIENT_ID,
      ),
    ).toEqual([]);
  });

  it('skips (never replays un-narrowed) a row whose payload carries no taskIds array', () => {
    // Membership-contract violation: a future SCOPED_PLAN action whose payload
    // names its ids differently must degrade to plain rejection, not silently
    // re-impose the full id set on every client.
    const op = planOp({
      payload: {
        actionPayload: { ids: ['task-a', 'task-b', 'task-c'] },
        entityChanges: [],
      },
    });
    expect(
      buildScopedBulkPlanReplacements(
        [resolutionOf([op], 'task-a', 'remote')],
        CLIENT_ID,
      ),
    ).toEqual([]);
  });

  it('orders multiple groups deterministically by timestamp with op-id tie-break', () => {
    const older = planOp({ id: 'op-bbb', timestamp: 1000 });
    const tiedA = planOp({
      id: 'op-aaa',
      timestamp: 1000,
      entityIds: ['task-a', 'task-b'],
      payload: {
        actionPayload: { taskIds: ['task-a', 'task-b'], today: '2026-07-31' },
        entityChanges: [],
      },
    });
    // One conflict pulls BOTH rows in (both touch task-a).
    const resolution = resolutionOf([older, tiedA], 'task-a', 'remote');
    const replacements = buildScopedBulkPlanReplacements([resolution], CLIENT_ID);

    expect(replacements.length).toBe(2);
    // Equal timestamps: op id decides — 'op-aaa' before 'op-bbb'.
    expect(replacements[0].payload).toEqual(
      jasmine.objectContaining({
        actionPayload: jasmine.objectContaining({ today: '2026-07-31' }),
      }),
    );
    expect(replacements[1].entityIds).toEqual(['task-b', 'task-c']);
  });

  it('dominates every clock of every conflict the row appears in', () => {
    const op = planOp({ vectorClock: { [CLIENT_ID]: 3, other: 5 } });
    const [replacement] = buildScopedBulkPlanReplacements(
      [resolutionOf([op], 'task-a', 'remote')],
      CLIENT_ID,
    );

    expect(replacement.vectorClock[CLIENT_ID]).toBe(4);
    expect(replacement.vectorClock['other']).toBe(5);
    expect(replacement.vectorClock['remote-client']).toBe(7);
  });
});
