import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ConflictJournalService } from './conflict-journal.service';
import { Store } from '@ngrx/store';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { SnackService } from '../../core/snack/snack.service';
import { ValidateStateService } from '../validation/validate-state.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { CLIENT_ID_PROVIDER } from '../util/client-id.provider';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../core/entity-registry';
import {
  ActionType,
  EntityConflict,
  extractActionPayload,
  OpType,
  Operation,
} from '../core/operation.types';
import {
  compareVectorClocks,
  incrementVectorClock,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import {
  synthesizeMergedChanges,
  isDisjointMergeEligible,
} from './conflict-disjoint-merge.util';

/**
 * SPAP-14 — disjoint-field auto-merge acceptance tests.
 *
 * (a) title-vs-notes concurrent edit → merged entity keeps BOTH; journal
 *     merged/disjoint-merge/info; not in unreviewed.
 * (b) title-vs-title (same field) → LWW unchanged; journal unreviewed.
 * (c) disjoint real fields + both bumped a NOISE field → still merges; noise
 *     field resolved deterministically.
 * (d) edit-vs-delete → delete wins, NO merge.
 * (e) two-client convergence: both orderings yield identical entity + dominating
 *     clocks.
 */
describe('ConflictResolutionService — SPAP-14 disjoint-field merge', () => {
  let service: ConflictResolutionService;
  let journal: ConflictJournalService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockOperationApplier: jasmine.SpyObj<OperationApplierService>;

  const CLIENT_ID = 'client-local';

  const op = (over: Partial<Operation> = {}): Operation => ({
    id: `op-${Math.random().toString(36).slice(2)}`,
    clientId: 'A',
    actionType: '[Task] Update' as ActionType,
    opType: OpType.Update,
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { task: { id: 'task-1', changes: {} } },
    vectorClock: { A: 1 },
    timestamp: 1000,
    schemaVersion: 1,
    ...over,
  });

  const conflictOf = (
    localOps: Operation[],
    remoteOps: Operation[],
    entityId = 'task-1',
  ): EntityConflict => ({
    entityType: 'TASK',
    entityId,
    localOps,
    remoteOps,
    suggestedResolution: 'manual',
  });

  const mergedOpArgs = (entityId = 'task-1'): Operation | undefined =>
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local')
      .flatMap((batch) => [...batch.ops])
      .find((o) => o.entityId === entityId && o.opType === OpType.Update);

  beforeEach(() => {
    mockStore = jasmine.createSpyObj('Store', ['select']);
    mockStore.select.and.returnValue(of(undefined));

    mockOperationApplier = jasmine.createSpyObj('OperationApplierService', [
      'applyOperations',
    ]);
    mockOperationApplier.applyOperations.and.resolveTo({ appliedOps: [] });

    mockOpLogStore = jasmine.createSpyObj('OperationLogStoreService', [
      'appendBatchSkipDuplicates',
      'appendMixedSourceBatchSkipDuplicates',
      'appendWithVectorClockUpdate',
      'markApplied',
      'markRejected',
      'markFailed',
      'getUnsyncedByEntity',
      'mergeRemoteOpClocks',
      'markReducersCommittedAndMergeClocks',
    ]);
    mockOpLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
    mockOpLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
      written: batches.flatMap((batch) =>
        batch.ops.map((batchOp, index) => ({
          seq: index + 1,
          op: batchOp,
          source: batch.source,
        })),
      ),
      skippedCount: 0,
    }));
    mockOpLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
    mockOpLogStore.markRejected.and.resolveTo(undefined);
    mockOpLogStore.markApplied.and.resolveTo(undefined);
    mockOpLogStore.appendWithVectorClockUpdate.and.resolveTo(1);
    mockOpLogStore.appendBatchSkipDuplicates.and.callFake((ops: Operation[]) =>
      Promise.resolve({
        seqs: ops.map((_, i) => i + 1),
        writtenOps: ops,
        skippedCount: 0,
      }),
    );

    const mockValidate = jasmine.createSpyObj('ValidateStateService', [
      'validateAndRepairCurrentState',
    ]);
    mockValidate.validateAndRepairCurrentState.and.resolveTo(true);

    const mockEffects = jasmine.createSpyObj('OperationLogEffects', [
      'processDeferredActions',
    ]);
    mockEffects.processDeferredActions.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        { provide: Store, useValue: mockStore },
        { provide: OperationApplierService, useValue: mockOperationApplier },
        { provide: OperationLogStoreService, useValue: mockOpLogStore },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('SnackService', ['open']),
        },
        { provide: ValidateStateService, useValue: mockValidate },
        { provide: OperationLogEffects, useValue: mockEffects },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: { loadClientId: () => Promise.resolve(CLIENT_ID) },
        },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
      ],
    });

    service = TestBed.inject(ConflictResolutionService);
    journal = TestBed.inject(ConflictJournalService);
  });

  // ── regression: checkpoint contract vs synthetic merged ops (#8900 seam) ───
  it('resolves without checkpointing the synthetic merged op when the applier reports reducer commit', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base notes' }),
    );
    // Honor the coordinator contract: the reducer-commit callback receives the
    // ENTIRE apply batch (including the synthetic merged local op).
    mockOperationApplier.applyOperations.and.callFake(async (ops, options) => {
      await options?.onReducersCommitted?.(ops);
      return { appliedOps: ops };
    });
    // Enforce the real store's pending-only checkpoint assertion: only rows
    // appended with pendingApply may be checkpointed.
    const pendingAppendedIds = new Set<string>();
    mockOpLogStore.appendBatchSkipDuplicates.and.callFake(
      (ops: Operation[], _source, options) => {
        if (options?.pendingApply) {
          ops.forEach((o) => pendingAppendedIds.add(o.id));
        }
        return Promise.resolve({
          seqs: ops.map((_, i) => i + 1),
          writtenOps: ops,
          skippedCount: 0,
        });
      },
    );
    mockOpLogStore.markReducersCommittedAndMergeClocks.and.callFake(
      async (_seqs, ops) => {
        for (const o of ops) {
          if (!pendingAppendedIds.has(o.id)) {
            throw new Error(
              `Reducer checkpoint requires pending remote operation (${o.id}).`,
            );
          }
        }
      },
    );

    const localOp = op({
      id: 'local-cp',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-cp',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]),
    ).toBeResolved();

    // The merged op reached the reducers…
    const appliedOps = mockOperationApplier.applyOperations.calls.mostRecent()
      .args[0] as Operation[];
    expect(
      appliedOps.some((o) => o.opType === OpType.Update && o.entityId === 'task-1'),
    ).toBeTrue();
    // …but only pending-appended rows were ever checkpointed.
    const checkpointedOps = mockOpLogStore.markReducersCommittedAndMergeClocks.calls
      .allArgs()
      .flatMap(([, ops]) => ops);
    expect(checkpointedOps.every((o) => pendingAppendedIds.has(o.id))).toBeTrue();
  });

  it('persists merge writes through the atomic mixed-source batch, never the clock-overwriting append', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base notes' }),
    );

    const localOp = op({
      id: 'local-mb',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-mb',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    // appendWithVectorClockUpdate REPLACES the durable clock with the caller's
    // clock (built only from the conflict's ops) — the batch rebases instead.
    expect(mockOpLogStore.appendWithVectorClockUpdate).not.toHaveBeenCalled();
    const batches =
      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.mostRecent().args[0];
    const remoteBatch = batches.find((b) => b.source === 'remote');
    const localBatch = batches.find((b) => b.source === 'local');
    expect(remoteBatch!.ops.map((o) => o.id)).toEqual(['remote-mb']);
    expect(localBatch!.ops.length).toBe(1);
    expect(localBatch!.ops[0].opType).toBe(OpType.Update);
  });

  // ── (a) title vs notes → merge both ────────────────────────────────────────
  it('(a) merges concurrent title-vs-notes edits into one op keeping BOTH', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base notes' }),
    );

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    // A single synthesized merged op carries BOTH changes.
    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = extractActionPayload(merged!.payload);
    expect(payload['title']).toBe('Local title');
    expect(payload['notes']).toBe('Remote notes');
    expect((merged!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('patch');

    // BOTH original ops are superseded (rejected).
    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toContain('local-1');
    expect(rejected).toContain('remote-1');

    // Merged clock dominates both original ops.
    expect(compareVectorClocks(merged!.vectorClock, { A: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    expect(compareVectorClocks(merged!.vectorClock, { B: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );

    // Journal: merged / disjoint-merge / info, and NOT counted as unreviewed.
    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].winner).toBe('merged');
    expect(entries[0].reason).toBe('disjoint-merge');
    expect(entries[0].status).toBe('info');
    expect((await journal.list('unreviewed')).length).toBe(0);
  });

  it('(a1) fails closed before mutating the op log for a legacy remote bulk op', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-2', title: 'Local title', timeSpent: 0 }),
    );

    const localOp = op({
      id: 'local-task-2',
      entityId: 'task-2',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-2', changes: { title: 'Local title' } } },
    });
    const remoteBulkOp = op({
      id: 'remote-bulk',
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: {
        actionPayload: {
          day: '2026-07-10',
          taskIds: ['task-1', 'task-2'],
          roundTo: 15,
          isRoundUp: true,
        },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localOp], [remoteBulkOp], 'task-2')]),
    ).toBeRejectedWithError(/Cannot safely auto-resolve remote multi-entity operation/);

    expect(mergedOpArgs('task-2')).toBeUndefined();
    expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
  });

  it('(a1 mirror) refuses disjoint merge for a legacy local bulk op', async () => {
    // A later local edit superseded the bulk's captured 111. Reconciliation
    // must project the current 333, not resurrect the stale captured value.
    let selectCount = 0;
    mockStore.select.and.callFake(() =>
      of(
        selectCount++ === 0
          ? { id: 'task-1', timeSpent: 333 }
          : { id: 'task-2', timeSpent: 222 },
      ),
    );
    mockOpLogStore.getUnsyncedByEntity.and.callFake(async () => {
      const writtenTargetReconciliation =
        mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
          .allArgs()
          .flatMap(([batches]) => batches)
          .filter((batch) => batch.source === 'local')
          .flatMap((batch) => batch.ops)
          .find((batchOp) => batchOp.entityId === 'task-2');
      return new Map([
        ['TASK:task-2', writtenTargetReconciliation ? [writtenTargetReconciliation] : []],
      ]);
    });

    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: {
        actionPayload: {
          day: '2026-07-10',
          taskIds: ['task-1', 'task-2'],
          roundTo: 15,
          isRoundUp: true,
        },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-2', changes: { title: 'Remote title' } } },
    });

    await service.autoResolveConflictsLWW([
      conflictOf([localBulkOp], [remoteOp], 'task-2'),
    ]);

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].winner).toBe('remote');
    expect(entries[0].reason).not.toBe('disjoint-merge');
    const timeSpentDiff = entries[0].fieldDiffs.find(
      (diff) => diff.field === 'timeSpent',
    );
    expect(timeSpentDiff?.localVal).toBe(222);

    const localBatches = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local');
    const siblingReconciliation = localBatches
      .flatMap((batch) => batch.ops)
      .find((batchOp) => batchOp.entityId === 'task-1');
    const targetReconciliation = localBatches
      .flatMap((batch) => batch.ops)
      .find((batchOp) => batchOp.entityId === 'task-2');
    expect(siblingReconciliation).toBeDefined();
    expect(extractActionPayload(siblingReconciliation!.payload)).toEqual({
      id: 'task-1',
      timeSpent: 333,
    });
    expect(extractActionPayload(targetReconciliation!.payload)).toEqual({
      id: 'task-2',
      timeSpent: 222,
    });
    expect(
      (siblingReconciliation!.payload as { lwwUpdateMode?: string }).lwwUpdateMode,
    ).toBe('patch');
    expect(
      (targetReconciliation!.payload as { lwwUpdateMode?: string }).lwwUpdateMode,
    ).toBe('patch');
    expect(compareVectorClocks(siblingReconciliation!.vectorClock, { A: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    expect(compareVectorClocks(siblingReconciliation!.vectorClock, { B: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    expect(compareVectorClocks(targetReconciliation!.vectorClock, { B: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    const rejectedIds = mockOpLogStore.markRejected.calls
      .allArgs()
      .flatMap(([ids]) => ids);
    expect(rejectedIds).toContain(localBulkOp.id);
    expect(rejectedIds).not.toContain(targetReconciliation!.id);
  });

  it('does not preserve local bulk target fields that overlap a remote winner', async () => {
    mockStore.select.and.returnValue(of({ id: 'task-1', timeSpent: 333 }));

    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: {
        actionPayload: { taskIds: ['task-1', 'task-2'] },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-2', changes: { timeSpent: 999 } } },
    });

    await service.autoResolveConflictsLWW([
      conflictOf([localBulkOp], [remoteOp], 'task-2'),
    ]);

    const localOps = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local')
      .flatMap((batch) => batch.ops);
    expect(localOps.map((batchOp) => batchOp.entityId)).toEqual(['task-1']);
    expect(extractActionPayload(localOps[0].payload)).toEqual({
      id: 'task-1',
      timeSpent: 333,
    });
    expect((localOps[0].payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe(
      'patch',
    );
  });

  it('fails closed when a remote winner partially overlaps coupled bulk fields', async () => {
    const day = '2026-07-10';
    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: {
        actionPayload: { taskIds: ['task-1', 'task-2'] },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111, timeSpentOnDay: { [day]: 111 } },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222, timeSpentOnDay: { [day]: 222 } },
          },
        ],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-2', changes: { timeSpent: 999 } } },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localBulkOp], [remoteOp], 'task-2')]),
    ).toBeRejectedWithError(/partially overlapping remote winner/);

    expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
  });

  it('fails closed when a remote winner is opaque for a local bulk target', async () => {
    mockStore.select.and.returnValue(of({ id: 'task-1', timeSpent: 333 }));

    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: {
        actionPayload: { taskIds: ['task-1', 'task-2'] },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { actionPayload: { taskId: 'task-2' } },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localBulkOp], [remoteOp], 'task-2')]),
    ).toBeRejectedWithError(/opaque remote winner/);

    expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
  });

  it('does not recreate a bulk sibling deleted by a later local operation', async () => {
    let selectCount = 0;
    mockStore.select.and.callFake(() =>
      of(selectCount++ === 0 ? undefined : { id: 'task-2', timeSpent: 222 }),
    );

    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: {
        actionPayload: { taskIds: ['task-1', 'task-2'] },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-2', changes: { title: 'Remote title' } } },
    });

    await service.autoResolveConflictsLWW([
      conflictOf([localBulkOp], [remoteOp], 'task-2'),
    ]);

    const localOps = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local')
      .flatMap((batch) => batch.ops);
    expect(localOps.map((batchOp) => batchOp.entityId)).toEqual(['task-2']);
    expect(extractActionPayload(localOps[0].payload)).toEqual({
      id: 'task-2',
      timeSpent: 222,
    });
    expect((localOps[0].payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe(
      'patch',
    );
  });

  it('fails closed for a local bulk action without an explicit decomposition rule', async () => {
    const localBulkOp = op({
      id: 'local-opaque-bulk',
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: {
        actionPayload: { taskIds: ['task-1', 'task-2'] },
        entityChanges: [],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-2', changes: { title: 'Remote title' } } },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localBulkOp], [remoteOp], 'task-2')]),
    ).toBeRejectedWithError(/Cannot safely auto-resolve local multi-entity operation/);

    expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
  });

  it('re-emits a decomposable local bulk sibling when the local bulk wins', async () => {
    let selectCount = 0;
    mockStore.select.and.callFake(() =>
      of(
        selectCount++ === 0
          ? { id: 'task-1', timeSpent: 333 }
          : { id: 'task-2', title: 'Base title', timeSpent: 222 },
      ),
    );

    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: {
        actionPayload: {
          day: '2026-07-10',
          taskIds: ['task-1', 'task-2'],
          roundTo: 15,
          isRoundUp: true,
        },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });
    const remoteOp = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-2', changes: { title: 'Remote title' } } },
    });

    await service.autoResolveConflictsLWW([
      conflictOf([localBulkOp], [remoteOp], 'task-2'),
    ]);

    const localOps = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local')
      .flatMap((batch) => batch.ops);
    const targetWinner = localOps.find((batchOp) => batchOp.entityId === 'task-2');
    const siblingReconciliation = localOps.find(
      (batchOp) => batchOp.entityId === 'task-1',
    );
    expect(extractActionPayload(targetWinner!.payload)).toEqual({
      id: 'task-2',
      title: 'Base title',
      timeSpent: 222,
    });
    expect(extractActionPayload(siblingReconciliation!.payload)).toEqual({
      id: 'task-1',
      timeSpent: 333,
    });
    expect(
      (siblingReconciliation!.payload as { lwwUpdateMode?: string }).lwwUpdateMode,
    ).toBe('patch');
  });

  it('does not duplicate targets when one local bulk op wins multiple conflicts', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'selected-task', title: 'Local title', timeSpent: 333 }),
    );

    const localBulkOp = op({
      id: 'local-bulk',
      actionType: ActionType.TASK_ROUND_TIME_SPENT,
      entityId: 'task-1',
      entityIds: ['task-1', 'task-2'],
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: {
        actionPayload: {
          day: '2026-07-10',
          taskIds: ['task-1', 'task-2'],
          roundTo: 15,
          isRoundUp: true,
        },
        entityChanges: [
          {
            entityType: 'TASK',
            entityId: 'task-1',
            opType: OpType.Update,
            changes: { timeSpent: 111 },
          },
          {
            entityType: 'TASK',
            entityId: 'task-2',
            opType: OpType.Update,
            changes: { timeSpent: 222 },
          },
        ],
      },
    });
    const remoteTask1 = op({
      id: 'remote-task-1',
      entityId: 'task-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Remote task 1' } } },
    });
    const remoteTask2 = op({
      id: 'remote-task-2',
      entityId: 'task-2',
      clientId: 'B',
      vectorClock: { B: 2 },
      timestamp: 1000,
      payload: { task: { id: 'task-2', changes: { title: 'Remote task 2' } } },
    });

    await service.autoResolveConflictsLWW([
      conflictOf([localBulkOp], [remoteTask1], 'task-1'),
      conflictOf([localBulkOp], [remoteTask2], 'task-2'),
    ]);

    const localOps = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local')
      .flatMap((batch) => batch.ops);
    expect(localOps.filter((batchOp) => batchOp.entityId === 'task-1').length).toBe(1);
    expect(localOps.filter((batchOp) => batchOp.entityId === 'task-2').length).toBe(1);
    expect(localOps.length).toBe(2);
  });

  // ── (a2) merge-only sync counts the synthesized op for re-upload ────────────
  it('(a2) counts the synthesized merged op in localWinOpsCreated (drives re-upload)', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base notes' }),
    );

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    const result = await service.autoResolveConflictsLWW([
      conflictOf([localOp], [remoteOp]),
    ]);

    // No LWW local-win ops here — the single synthesized merged op is the sole
    // pending-local op. It MUST be counted or the caller's immediate re-upload
    // is skipped and the sync falsely reports IN_SYNC while the merge is unsynced.
    expect(mergedOpArgs()).toBeDefined();
    expect(result.localWinOpsCreated).toBe(1);
  });

  // ── (a3) SPAP-14 fix: partial-delta merged op, no un-conflicted ride-along ──
  it('(a3) synthesizes a partial-delta merged op that excludes un-conflicted fields', async () => {
    // Current entity carries a field NEITHER side touched (timeSpentOnDay). A
    // full-entity snapshot would embed it and diverge across clients whose
    // current state differs (staggered third-device sync); the delta must carry
    // ONLY the two sides' changed fields.
    mockStore.select.and.returnValue(
      of({
        id: 'task-1',
        title: 'Local title',
        notes: 'base notes',
        // An un-conflicted field present in current state (value shape is
        // irrelevant — the delta must not read current state at all).
        timeSpentOnDay: {},
      }),
    );
    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = extractActionPayload(merged!.payload);
    expect(payload['title']).toBe('Local title');
    expect(payload['notes']).toBe('Remote notes');
    // The un-conflicted field must NOT ride along in the synthesized op.
    expect('timeSpentOnDay' in payload).toBe(false);
  });

  // ── (a4) SPAP-14 fix: refuse merge when the entity has >1 conflict this batch
  it('(a4) refuses disjoint-merge for an entity with multiple conflicts (falls back to LWW)', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'base', notes: 'base', timeEstimate: 5 }),
    );
    const localEst = op({
      id: 'local-est',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 3000,
      payload: { task: { id: 'task-1', changes: { timeEstimate: 9 } } },
    });
    const remoteTitle = op({
      id: 'remote-title',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 3100,
      payload: { task: { id: 'task-1', changes: { title: 'B title' } } },
    });
    const remoteNotes = op({
      id: 'remote-notes',
      clientId: 'B',
      vectorClock: { B: 2 },
      timestamp: 3200,
      payload: { task: { id: 'task-1', changes: { notes: 'B notes' } } },
    });

    // detectConflicts emits one conflict per remote op → two conflicts, same
    // entity. Merging each independently would let the clock-dominating sibling
    // silently drop the other's field, falsely journaled as "kept both".
    await service.autoResolveConflictsLWW([
      conflictOf([localEst], [remoteTitle]),
      conflictOf([localEst], [remoteNotes]),
    ]);

    // No merged op was synthesized; both conflicts fell back to whole-entity LWW.
    const entries = await journal.list('history');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.winner !== 'merged')).toBe(true);
    expect((await journal.list('unreviewed')).length).toBeGreaterThan(0);
  });

  it('(a5) refuses disjoint-merge for a multi-entity remote operation (#8956)', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base notes' }),
    );
    const localOp = op({
      id: 'local-multi-guard',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-multi-guard',
      clientId: 'B',
      entityIds: ['task-1', 'task-2'],
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]),
    ).toBeRejectedWithError(/Cannot safely auto-resolve remote multi-entity operation/);
    expect(mergedOpArgs()).toBeUndefined();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
  });

  // ── (a5) SPAP-14 fix: refuse merge for fallback-less entity types ───────────
  it('(a5) refuses disjoint-merge for a type without a RECREATE_FALLBACK (NOTE → LWW)', async () => {
    // A partial-delta merged op that later wins over a concurrent delete would
    // recreate a schema-INVALID NOTE (no RECREATE_FALLBACK). So NOTE disjoint
    // conflicts must fall back to whole-entity LWW, not merge.
    mockStore.select.and.returnValue(
      of({ id: 'note-1', content: 'base', backgroundColor: 'base' }),
    );
    const localOp = op({
      id: 'local-note',
      clientId: 'A',
      entityType: 'NOTE',
      entityId: 'note-1',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { note: { id: 'note-1', changes: { content: 'Local content' } } },
    });
    const remoteOp = op({
      id: 'remote-note',
      clientId: 'B',
      entityType: 'NOTE',
      entityId: 'note-1',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { note: { id: 'note-1', changes: { backgroundColor: 'Remote color' } } },
    });

    await service.autoResolveConflictsLWW([
      {
        entityType: 'NOTE',
        entityId: 'note-1',
        localOps: [localOp],
        remoteOps: [remoteOp],
        suggestedResolution: 'manual',
      },
    ]);

    const entries = await journal.list('history');
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every((e) => e.winner !== 'merged')).toBe(true);
  });

  // ── (a6) merge journaled only AFTER the merged op is durably appended ──────
  it('(a6) does not journal a merge when appending the merged op fails', async () => {
    // A `merged` entry claims "both sides kept" — that is only true once the
    // merged op is persisted. If the append throws, the journal must not
    // contain a phantom merge (STEP 3b journals post-append, not at plan time).
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base' }),
    );
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.rejectWith(
      new Error('append failed'),
    );

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { notes: 'Remote notes' } } },
    });

    await expectAsync(
      service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]),
    ).toBeRejected();

    const history = await journal.list('history');
    expect(history.filter((e) => e.winner === 'merged')).toEqual([]);
  });

  // ── (b) title vs title → LWW unchanged ─────────────────────────────────────
  it('(b) leaves same-field (title-vs-title) conflicts to LWW (journal unreviewed)', async () => {
    mockStore.select.and.returnValue(of({ id: 'task-1', title: 'Local title' }));

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Remote title' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('newer'); // local ts newer, same field
    expect(entries[0].winner).toBe('local');
    expect(entries[0].status).toBe('unreviewed');
    expect((await journal.list('unreviewed')).length).toBe(1);
  });

  // ── (c) disjoint real fields + both bumped a noise field → still merges ─────
  it('(c) merges when disjoint real fields also both bump a NOISE field (deterministic tiebreak)', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Local title', notes: 'base', modified: 1111 }),
    );

    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000, // older → loses the noise tiebreak
      payload: {
        task: { id: 'task-1', changes: { title: 'Local title', modified: 1111 } },
      },
    });
    const remoteOp = op({
      id: 'remote-1',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000, // newer → wins the noise tiebreak
      payload: {
        task: { id: 'task-1', changes: { notes: 'Remote notes', modified: 2222 } },
      },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = extractActionPayload(merged!.payload);
    expect(payload['title']).toBe('Local title');
    expect(payload['notes']).toBe('Remote notes');
    // The noise field resolves to the greater-(timestamp) side, NOT simply the
    // local current-state value.
    expect(payload['modified']).toBe(2222);

    const entries = await journal.list('history');
    expect(entries[0].reason).toBe('disjoint-merge');
    expect(entries[0].status).toBe('info');
  });

  // ── (d) edit vs delete → delete wins, NO merge ─────────────────────────────
  it('(d) never merges an edit-vs-delete conflict (delete-wins path unchanged)', async () => {
    const localOp = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteDelete = op({
      id: 'remote-1',
      clientId: 'B',
      opType: OpType.Delete,
      vectorClock: { B: 1 },
      timestamp: 2000, // delete newer → wins
      payload: { task: { id: 'task-1' } },
    });

    // Sanity: eligibility must reject a delete-containing conflict outright.
    expect(
      isDisjointMergeEligible({
        localOps: [localOp],
        remoteOps: [remoteDelete],
        payloadKey: 'task',
        entityId: 'task-1',
      }),
    ).toBe(false);

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteDelete])]);

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('delete-wins');
    expect(entries[0].reason).not.toBe('disjoint-merge');
    // No synthesized merged UPDATE op was created for this entity.
    expect(mergedOpArgs()).toBeUndefined();
  });

  // ── (d2) archive vs disjoint edit → archive wins whole entity, NO merge ─────
  it('(d2) never merges an archive-vs-disjoint-edit conflict (archive-plan guard, not eligibility, blocks it)', async () => {
    // An archive is an UPDATE op (not a Delete), so `isDisjointMergeEligible`
    // does NOT reject it: an archive that carries its own disjoint non-noise
    // field alongside a concurrent disjoint edit is field-level merge-eligible.
    // The ONLY thing preventing a partial-resurrection merge is the
    // `_isArchivePlan` guard in `_tryCreateDisjointMergeOp`. This asserts
    // eligibility is TRUE yet no merged op is synthesized — so a regression that
    // dropped the guard would fail here (and nowhere else).
    const localEdit = op({
      id: 'local-1',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Local title' } } },
    });
    const remoteArchive = op({
      id: 'remote-1',
      clientId: 'B',
      actionType: '[Task Shared] moveToArchive' as ActionType,
      vectorClock: { B: 1 },
      timestamp: 2000, // archive newer → wins
      payload: { task: { id: 'task-1', changes: { isDone: true } } },
    });

    // Field-level eligibility PASSES (disjoint non-noise fields, no Delete op):
    // the archive-plan guard is the sole reason the merge must not happen.
    expect(
      isDisjointMergeEligible({
        localOps: [localEdit],
        remoteOps: [remoteArchive],
        payloadKey: 'task',
        entityId: 'task-1',
      }),
    ).toBe(true);

    await service.autoResolveConflictsLWW([conflictOf([localEdit], [remoteArchive])]);

    // No synthesized merged UPDATE op — the archive wins the WHOLE entity.
    expect(mergedOpArgs()).toBeUndefined();

    const entries = await journal.list('history');
    expect(entries.length).toBe(1);
    expect(entries[0].reason).toBe('delete-wins');
    expect(entries[0].reason).not.toBe('disjoint-merge');
    expect(entries[0].winner).toBe('remote');
  });

  // ── (e) two-client convergence ─────────────────────────────────────────────
  describe('(e) two-client convergence', () => {
    // side1 authored by client A; side2 authored by client B.
    const side1Changes = { title: 'A-title', modified: 1500 };
    const side2Changes = { notes: 'B-notes', modified: 1600 };
    const side1Meta = { timestamp: 1500, clientId: 'A' };
    const side2Meta = { timestamp: 1600, clientId: 'B' };

    it('both clients synthesize the byte-identical merged DELTA (either ordering)', () => {
      // Client A: local = side1, remote = side2.
      const mergedA = synthesizeMergedChanges(
        side1Changes,
        side2Changes,
        side1Meta,
        side2Meta,
      );
      // Client B: local = side2, remote = side1 (mirror).
      const mergedB = synthesizeMergedChanges(
        side2Changes,
        side1Changes,
        side2Meta,
        side1Meta,
      );

      expect(mergedA).toEqual(mergedB);
      // Explicit expected delta: both real fields kept; noise → newer (side2).
      // No `id` and NO untouched fields — the delta carries ONLY changed fields.
      expect(mergedA).toEqual({
        title: 'A-title',
        notes: 'B-notes',
        modified: 1600,
      });
    });

    it("the merged DELTA is independent of each client's divergent current state (SPAP-14 divergence fix)", () => {
      // The two clients' current entities differ on an UN-conflicted field
      // (timeSpentOnDay) — e.g. one already applied a third device's edit the
      // other has not. A full-entity snapshot would drag that field along and
      // diverge forever; the delta is derived only from the two sides' ops, so
      // it is identical regardless. Neither delta may contain timeSpentOnDay.
      const mergedA = synthesizeMergedChanges(
        side1Changes,
        side2Changes,
        side1Meta,
        side2Meta,
      );
      const mergedB = synthesizeMergedChanges(
        side2Changes,
        side1Changes,
        side2Meta,
        side1Meta,
      );
      expect(mergedA).toEqual(mergedB);
      expect('timeSpentOnDay' in mergedA).toBe(false);
    });

    it('both merged clocks dominate BOTH original ops', () => {
      const clockSide1 = { clientA: 2 };
      const clockSide2 = { clientB: 2 };
      const merge = (...cs: Array<Record<string, number>>): Record<string, number> =>
        cs.reduce((acc, c) => mergeVectorClocks(acc, c), {});

      const clockA = incrementVectorClock(merge(clockSide1, clockSide2), 'clientA');
      const clockB = incrementVectorClock(merge(clockSide1, clockSide2), 'clientB');

      for (const clk of [clockA, clockB]) {
        expect(compareVectorClocks(clk, clockSide1)).toBe(
          VectorClockComparison.GREATER_THAN,
        );
        expect(compareVectorClocks(clk, clockSide2)).toBe(
          VectorClockComparison.GREATER_THAN,
        );
      }
      // The two independently-synthesized merged ops are concurrent by clock,
      // but carry identical payloads (previous test) → resolve by ordinary LWW,
      // never re-merging, so entity state converges.
      expect(compareVectorClocks(clockA, clockB)).toBe(VectorClockComparison.CONCURRENT);
    });
  });

  // ── (e2e) full two-client round-trip: both clients merge independently to the
  //    IDENTICAL entity, then the two merged ops meet and are NOT re-merge-
  //    eligible (→ ordinary LWW on identical payloads → convergence, no ping-pong).
  describe('(e2e) two-client sync round-trip convergence', () => {
    const resolveAsClient = async (
      clientId: string,
      currentState: Record<string, unknown>,
      conflict: EntityConflict,
    ): Promise<{ synthesized?: Operation }> => {
      TestBed.resetTestingModule();

      const store = jasmine.createSpyObj('Store', ['select']);
      store.select.and.returnValue(of(currentState));

      const applier = jasmine.createSpyObj('OperationApplierService', [
        'applyOperations',
      ]);
      applier.applyOperations.and.resolveTo({ appliedOps: [] });

      const opLogStore = jasmine.createSpyObj('OperationLogStoreService', [
        'appendBatchSkipDuplicates',
        'appendMixedSourceBatchSkipDuplicates',
        'appendWithVectorClockUpdate',
        'markApplied',
        'markRejected',
        'markFailed',
        'getUnsyncedByEntity',
        'mergeRemoteOpClocks',
        'markReducersCommittedAndMergeClocks',
      ]);
      opLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
      opLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
      opLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
        written: batches.flatMap((batch) =>
          batch.ops.map((batchOp, index) => ({
            seq: index + 1,
            op: batchOp,
            source: batch.source,
          })),
        ),
        skippedCount: 0,
      }));
      opLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
      opLogStore.markRejected.and.resolveTo(undefined);
      opLogStore.markApplied.and.resolveTo(undefined);
      opLogStore.markFailed.and.resolveTo(undefined);
      opLogStore.appendWithVectorClockUpdate.and.resolveTo(1);
      opLogStore.appendBatchSkipDuplicates.and.callFake((ops: Operation[]) =>
        Promise.resolve({
          seqs: ops.map((_, i) => i + 1),
          writtenOps: ops,
          skippedCount: 0,
        }),
      );

      const validate = jasmine.createSpyObj('ValidateStateService', [
        'validateAndRepairCurrentState',
      ]);
      validate.validateAndRepairCurrentState.and.resolveTo(true);

      const effects = jasmine.createSpyObj('OperationLogEffects', [
        'processDeferredActions',
      ]);
      effects.processDeferredActions.and.resolveTo();

      TestBed.configureTestingModule({
        providers: [
          ConflictResolutionService,
          { provide: Store, useValue: store },
          { provide: OperationApplierService, useValue: applier },
          { provide: OperationLogStoreService, useValue: opLogStore },
          {
            provide: SnackService,
            useValue: jasmine.createSpyObj('SnackService', ['open']),
          },
          { provide: ValidateStateService, useValue: validate },
          { provide: OperationLogEffects, useValue: effects },
          {
            provide: CLIENT_ID_PROVIDER,
            useValue: { loadClientId: () => Promise.resolve(clientId) },
          },
          { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
        ],
      });

      const svc = TestBed.inject(ConflictResolutionService);
      await svc.autoResolveConflictsLWW([conflict]);

      const synthesized = opLogStore.appendMixedSourceBatchSkipDuplicates.calls
        .allArgs()
        .flatMap(([batches]) => batches)
        .filter((batch) => batch.source === 'local')
        .flatMap((batch) => [...batch.ops])
        .find((o) => o.entityId === 'task-1' && o.opType === OpType.Update);
      return { synthesized };
    };

    const entityOf = (o: Operation): Record<string, unknown> => {
      const p = extractActionPayload(o.payload);
      return { title: p['title'], notes: p['notes'] };
    };

    it('both clients synthesize the identical merged entity, and the two merged ops do not re-merge (converge)', async () => {
      const titleOp = op({
        id: 'op-A',
        clientId: 'clientA',
        vectorClock: { clientA: 1 },
        timestamp: 2000,
        payload: { task: { id: 'task-1', changes: { title: 'A-title' } } },
      });
      const notesOp = op({
        id: 'op-B',
        clientId: 'clientB',
        vectorClock: { clientB: 1 },
        timestamp: 3000,
        payload: { task: { id: 'task-1', changes: { notes: 'B-notes' } } },
      });

      const a1 = await resolveAsClient(
        'clientA',
        { id: 'task-1', title: 'A-title', notes: 'base' },
        conflictOf([titleOp], [notesOp]),
      );
      const b1 = await resolveAsClient(
        'clientB',
        { id: 'task-1', title: 'base', notes: 'B-notes' },
        conflictOf([notesOp], [titleOp]),
      );

      expect(a1.synthesized).toBeDefined();
      expect(b1.synthesized).toBeDefined();
      expect(entityOf(a1.synthesized!)).toEqual({ title: 'A-title', notes: 'B-notes' });
      expect(entityOf(a1.synthesized!)).toEqual(entityOf(b1.synthesized!));

      const mA = a1.synthesized!;
      const mB = b1.synthesized!;
      expect(
        isDisjointMergeEligible({
          localOps: [mA],
          remoteOps: [mB],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);
      expect(
        isDisjointMergeEligible({
          localOps: [mB],
          remoteOps: [mA],
          payloadKey: 'task',
          entityId: 'task-1',
        }),
      ).toBe(false);
    });
  });
});
