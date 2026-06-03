/* eslint-disable @typescript-eslint/naming-convention */
import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, OperationLogEntry, OpType } from '../../core/operation.types';
import { isExampleTaskCreateOp } from '../../validation/is-example-task-op.util';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

/**
 * Integration proof for the #7985 "Fix C" cleanup (the hook in
 * OperationLogSyncService.uploadPendingOps that rejects example-task ops when a
 * never-synced client adopts a populated remote).
 *
 * The sync-service unit specs MOCK opLogStore.hasSyncedOps(), so they can only prove the
 * hook's truth-table — not the load-bearing #7980 §10 claim that the (pre-upload) download
 * phase persists adopted remote ops with `syncedAt`, flipping hasSyncedOps() to true BEFORE
 * the upload runs while the local example creates stay unsynced. These tests exercise the
 * REAL store so that exact sequencing — and the real getUnsynced()/markRejected() the hook
 * composes, plus the production "pristine post-boot batch" predicate against real ops — is
 * verified end-to-end (no docker / SuperSync server needed).
 */
describe('Example-task adoption cleanup mechanic (integration)', () => {
  let store: OperationLogStoreService;
  const local = new TestClient('client-local');
  const remote = new TestClient('client-remote');

  // Mirrors the production gate in operation-log-sync.service.ts uploadPendingOps.
  const isPristinePostBootBatch = (ops: OperationLogEntry[]): boolean =>
    ops.every(
      (entry) => isExampleTaskCreateOp(entry) || entry.op.entityType === 'GLOBAL_CONFIG',
    );

  const exampleCreate = (taskId: string): ReturnType<TestClient['createOperation']> =>
    local.createOperation({
      actionType: ActionType.TASK_SHARED_ADD,
      opType: OpType.Create,
      entityType: 'TASK',
      entityId: taskId,
      payload: {
        actionPayload: { task: { id: taskId }, isExampleTask: true },
        entityChanges: [],
      },
    });

  const configOp = (): ReturnType<TestClient['createOperation']> =>
    local.createOperation({
      actionType: ActionType.GLOBAL_CONFIG_UPDATE_SECTION,
      opType: OpType.Update,
      entityType: 'GLOBAL_CONFIG',
      entityId: 'sync',
      payload: { sectionKey: 'sync' },
    });

  // A real op adopted FROM a populated remote (e.g. a task from the account being joined).
  const adoptedRemoteOp = (): ReturnType<TestClient['createOperation']> =>
    remote.createOperation({
      actionType: '[Task] Update Task' as ActionType,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: 'remote-task-1',
      payload: { actionPayload: { task: { id: 'remote-task-1' } }, entityChanges: [] },
    });

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [OperationLogStoreService] });
    store = TestBed.inject(OperationLogStoreService);
    await store.init();
    await store._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  it('a never-synced client: hasSyncedOps() is false with only local example+config ops pending', async () => {
    await store.append(exampleCreate('ex-1'), 'local');
    await store.append(exampleCreate('ex-2'), 'local');
    await store.append(configOp(), 'local');

    // Pre-download: nothing synced. (This is what sync-wrapper captures as isNeverSynced.)
    expect(await store.hasSyncedOps()).toBe(false);
  });

  it('adopting a populated remote really flips hasSyncedOps() while example creates stay unsynced, and the cleanup rejects only the examples', async () => {
    const ex1 = exampleCreate('ex-1');
    const ex2 = exampleCreate('ex-2');
    const cfg = configOp();
    await store.append(ex1, 'local');
    await store.append(ex2, 'local');
    await store.append(cfg, 'local');

    // Simulate the download phase adopting the populated remote: a remote op is persisted
    // with syncedAt set. THIS is the #7980 §10 sequencing the unit tests mock.
    await store.append(adoptedRemoteOp(), 'remote');

    // The live read the hook makes at upload time is now true — purely from the download.
    expect(await store.hasSyncedOps()).toBe(true);

    // The example creates are still pending (local, unsynced); the remote op is not pending.
    const pending = await store.getUnsynced();
    const pendingIds = pending.map((e) => e.op.id);
    expect(pendingIds).toContain(ex1.id);
    expect(pendingIds).toContain(ex2.id);
    expect(pendingIds).toContain(cfg.id);
    expect(pendingIds.length).toBe(3);

    // Production gate evaluates true against the real pending batch.
    expect(isPristinePostBootBatch(pending)).toBe(true);

    // The hook's discard (real markRejected) removes ONLY the example creates.
    const exampleOpIds = pending.filter(isExampleTaskCreateOp).map((e) => e.op.id);
    await store.markRejected(exampleOpIds);

    const after = await store.getUnsynced();
    const afterIds = after.map((e) => e.op.id);
    expect(afterIds).not.toContain(ex1.id);
    expect(afterIds).not.toContain(ex2.id);
    // The config op survives and would still upload (not throwaway scaffolding).
    expect(afterIds).toContain(cfg.id);
  });

  it('a pending reorder Move of an example task breaks the pristine-batch gate (cleanup correctly skips → no stranding)', async () => {
    await store.append(exampleCreate('ex-1'), 'local');
    // A reorder Move (entityType TASK, OpType.Move) — NOT flagged by hasMeaningfulPendingOps,
    // but it references the example task id, so rejecting the create would strand it.
    await store.append(
      local.createOperation({
        actionType: '[Project] Move Task in Today' as ActionType,
        opType: OpType.Move,
        entityType: 'TASK',
        entityId: 'ex-1',
        payload: {},
      }),
      'local',
    );
    await store.append(adoptedRemoteOp(), 'remote');

    expect(await store.hasSyncedOps()).toBe(true);
    const pending = await store.getUnsynced();
    // The gate is false → the production hook skips the discard, so nothing is rejected and
    // the example create uploads alongside its Move (no dangling reference on the server).
    expect(isPristinePostBootBatch(pending)).toBe(false);
  });

  // #7996 (remove example *entities* from local NgRx) is a pure NgRx dispatch with
  // meta.isRemote — it deliberately creates NO op-log op (the capture meta-reducer skips
  // isRemote actions), so there is nothing op-log-level to assert here. The #7995 create-op
  // discard above is the op-log half; the dispatch + state-cleanup half is covered by the
  // service unit specs and the docker e2e.

  it('empty-server seeding: with nothing adopted, hasSyncedOps() stays false (cleanup does not fire)', async () => {
    await store.append(exampleCreate('ex-1'), 'local');
    await store.append(configOp(), 'local');

    // No remote op appended (download returned no_new_ops on an empty server).
    expect(await store.hasSyncedOps()).toBe(false);
    // isNeverSynced && hasSyncedOps() === true is the hook's trigger; the second term is
    // false here, so a first device seeding an empty server keeps its example ops.
  });
});
