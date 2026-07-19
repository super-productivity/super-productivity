import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConflictResolutionService } from './conflict-resolution.service';
import { ConflictJournalService } from './conflict-journal.service';
import { Action, Store } from '@ngrx/store';
import { OperationApplierService } from '../apply/operation-applier.service';
import { convertOpToAction } from '../apply/operation-converter.util';
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
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { appStateFeatureKey } from '../../root-store/app-state/app-state.reducer';
import { getDbDateStr } from '../../util/get-db-date-str';

/**
 * Minimal RootState for exercising the PRODUCTION `lwwUpdateMetaReducer` on a
 * single TASK. Includes the slices its relationship-repair reads (project INBOX,
 * TODAY tag, appState) so applying an LWW Update never throws on a missing slice.
 */
const buildRootStateWithTask = (task: Record<string, unknown>): unknown => ({
  [TASK_FEATURE_NAME]: {
    ids: [task['id']],
    entities: { [task['id'] as string]: task },
    currentTaskId: null,
    selectedTaskId: null,
    taskDetailTargetPanel: null,
    isDataLoaded: true,
    lastCurrentTaskId: null,
  },
  [PROJECT_FEATURE_NAME]: {
    ids: [INBOX_PROJECT.id],
    entities: {
      [INBOX_PROJECT.id]: {
        id: INBOX_PROJECT.id,
        title: 'Inbox',
        taskIds: [],
        backlogTaskIds: [],
        noteIds: [],
      },
    },
  },
  [TAG_FEATURE_NAME]: {
    ids: [TODAY_TAG.id],
    entities: { [TODAY_TAG.id]: { ...TODAY_TAG, taskIds: [] } },
  },
  [appStateFeatureKey]: { todayStr: getDbDateStr(), startOfNextDayDiffMs: 0 },
});

/**
 * Disjoint-field auto-merge acceptance tests.
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
describe('ConflictResolutionService — disjoint-field merge', () => {
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
      'appendWithVectorClockOverwrite',
      'markApplied',
      'markRejected',
      'markFailed',
      'getUnsyncedByEntity',
      'getOpById',
      'mergeRemoteOpClocks',
      'markReducersCommittedAndMergeClocks',
    ]);
    mockOpLogStore.getOpById.and.resolveTo(undefined);
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
    mockOpLogStore.appendWithVectorClockOverwrite.and.resolveTo(1);
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

    // appendWithVectorClockOverwrite REPLACES the durable clock with the caller's
    // clock (built only from the conflict's ops) — the batch rebases instead.
    expect(mockOpLogStore.appendWithVectorClockOverwrite).not.toHaveBeenCalled();
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

  // ── (a0) #9095 regression: rename vs mark-done → merge both ────────────────
  // With disjoint merge disabled this pair resolves by whole-entity LWW: the
  // later mark-done side wins a full 'replace' snapshot carrying its stale
  // title, and the rename is permanently lost on every client.
  it('(a0) merges a remote rename with a later local mark-done, losing neither (#9095)', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Original title', isDone: true }),
    );

    const localOp = op({
      id: 'local-done',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 2000,
      payload: { task: { id: 'task-1', changes: { isDone: true } } },
    });
    const remoteOp = op({
      id: 'remote-rename',
      clientId: 'A',
      vectorClock: { A: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Renamed by A' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = extractActionPayload(merged!.payload);
    expect(payload['title']).toBe('Renamed by A');
    expect(payload['isDone']).toBe(true);
    expect((merged!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('patch');

    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toContain('local-done');
    expect(rejected).toContain('remote-rename');
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

  // ── (a3) disjoint-merge fix: partial-delta merged op, no un-conflicted ride-along ──
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

  // ── (a4) disjoint-merge fix: refuse merge when the entity has >1 conflict this batch
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

  // ── (a5) disjoint-merge fix: refuse merge for fallback-less entity types ───────────
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

    it("the merged DELTA is independent of each client's divergent current state (disjoint-merge divergence fix)", () => {
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
        'appendWithVectorClockOverwrite',
        'markApplied',
        'markRejected',
        'markFailed',
        'getUnsyncedByEntity',
        'getOpById',
        'mergeRemoteOpClocks',
        'markReducersCommittedAndMergeClocks',
      ]);
      opLogStore.getOpById.and.resolveTo(undefined);
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
      opLogStore.appendWithVectorClockOverwrite.and.resolveTo(1);
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

  // A FOCUSED COMPOSITION TEST, not a transport e2e: it drives
  // ConflictResolutionService with hand-built EntityConflicts and composes the
  // ops it emits with a local LWW `applyOp` helper. It does NOT exercise real
  // conflict detection, the OperationApplierService, or any sync transport —
  // cross-client propagation is MODELLED (justified by the dominating-clock
  // assertions below), not executed. Client B contributes only an input op, not
  // a tracked client. Its value: it goes red if `_createLocalWinUpdateOp` ever
  // emits a partial delta instead of a full snapshot — a NECESSARY (not
  // sufficient) condition for the local-win side to reconstruct every field.
  // The first test pins that op shape and checks the fields both sides share.
  // The second test goes further: it drives the real production seam
  // (convertOpToAction + lwwUpdateMetaReducer) and shows that a receiver-only
  // field the loser absorbed IS cleared, because the local-win op carries
  // `lwwUpdateMode: 'replace'` and the reducer applies it via setOne — so the
  // clients CONVERGE at the task entity, but ONLY for receivers that honour
  // replace-mode (see the scope note on the describe below). Neither test makes
  // a whole-normalized-state or all-orderings convergence claim.
  describe('composition (3-client): a later overlapping edit beats the merged op', () => {
    // Adjudicates the "partial merged delta is not closed under later LWW
    // composition" concern: after a merged op loses whole-op LWW to a newer
    // overlapping edit from a third client, the clients are TRANSIENTLY apart
    // (the remote-win side keeps the merged delta's other field; the local-win
    // side never applied it) — reconciling the SHARED fields depends on the
    // local-win side emitting a FULL-SNAPSHOT op. The first test pins that op
    // property (full snapshot + dominating clock) and checks the shared fields
    // line up; it does NOT assert whole-state cross-client convergence. The
    // second test drives the production seam and pins the CONVERGENT outcome:
    // because the local-win op carries `lwwUpdateMode: 'replace'`, the reducer
    // applies it via setOne, CLEARING a receiver-only field the loser absorbed,
    // so A converges onto C for this upload ordering.
    //
    // SCOPE — this convergence is receiver-version-dependent. The disjoint merge
    // that sets up the scenario is enabled in production (unfrozen by #9095), and
    // its merged op is an ordinary 'patch' that any client applies via updateOne.
    // But the replace-mode local-win op is newer: a receiver predating replace-mode
    // treats it as a plain LWW Update, applies C's snapshot via updateOne, keeps
    // the absorbed field, and the receiver-only-field divergence persists. So in a
    // mixed fleet this pins replace-aware behaviour only, not universal convergence;
    // the residual older-client divergence is tracked separately as a runtime fix.
    const resolveCapturing = async (
      clientId: string,
      currentState: Record<string, unknown>,
      conflict: EntityConflict,
    ): Promise<{ appended: Operation[]; applied: Operation[] }> => {
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
        'appendWithVectorClockOverwrite',
        'markApplied',
        'markRejected',
        'markFailed',
        'getUnsyncedByEntity',
        'getOpById',
        'mergeRemoteOpClocks',
        'markReducersCommittedAndMergeClocks',
      ]);
      opLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
      opLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
      opLogStore.getUnsyncedByEntity.and.resolveTo(new Map());
      opLogStore.getOpById.and.resolveTo(undefined);
      opLogStore.markRejected.and.resolveTo(undefined);
      opLogStore.markApplied.and.resolveTo(undefined);
      opLogStore.markFailed.and.resolveTo(undefined);
      opLogStore.appendWithVectorClockOverwrite.and.resolveTo(1);
      opLogStore.appendBatchSkipDuplicates.and.callFake((ops: Operation[]) =>
        Promise.resolve({
          seqs: ops.map((_, i) => i + 1),
          writtenOps: ops,
          skippedCount: 0,
        }),
      );
      // #8900 seam: local-win / merged ops now persist through the atomic
      // mixed-source batch, mirroring the outer suite's setup.
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

      const appended = opLogStore.appendMixedSourceBatchSkipDuplicates.calls
        .allArgs()
        .flatMap(([batches]) => batches)
        .filter((batch) => batch.source === 'local')
        .flatMap((batch) => [...batch.ops])
        .filter((o: Operation) => o.entityId === 'task-1' && o.opType === OpType.Update);
      const applied = applier.applyOperations.calls
        .allArgs()
        .flatMap(([ops]) => ops as Operation[])
        .filter((o) => o.entityId === 'task-1');
      return { appended, applied };
    };

    // Content model: reconstruct the entity from the op's carried fields,
    // mirroring the consumer paths — adapter `{ task: { id, changes } }` -> merge
    // changes; nested `{ actionPayload }` (#8980/#8990) or flat LWW payload ->
    // shallow-merge fields minus id (updateOne). This asserts WHICH fields the op
    // transports for the no-receiver-only-field case, where every field is present
    // on both sides so nothing is cleared. The receiver-only CLEARING that the
    // 'replace'/setOne path performs is exercised through the real production
    // reducer in the sibling test, which is where it actually matters (#8933).
    const applyOp = (
      state: Record<string, unknown>,
      o: Operation,
    ): Record<string, unknown> => {
      const p = o.payload as Record<string, unknown>;
      const task = p['task'] as Record<string, unknown> | undefined;
      if (task && typeof task['changes'] === 'object') {
        return { ...state, ...(task['changes'] as Record<string, unknown>) };
      }
      const actionPayload = p['actionPayload'] as Record<string, unknown> | undefined;
      if (actionPayload && typeof actionPayload === 'object') {
        const changed = { ...actionPayload };
        delete changed['id'];
        return { ...state, ...changed };
      }
      const flat = { ...p };
      delete flat['id'];
      return { ...state, ...flat };
    };

    const pick = (s: Record<string, unknown>): Record<string, unknown> => ({
      title: s['title'],
      notes: s['notes'],
    });

    it('the full-snapshot local-win op reconciles fields present on both sides (no receiver-only field in play)', async () => {
      // Round 1: A (title) and B (notes) conflict -> disjoint merge on A.
      const opA = op({
        id: 'op-A',
        clientId: 'clientA',
        vectorClock: { clientA: 1 },
        timestamp: 2000,
        payload: { task: { id: 'task-1', changes: { title: 'A-title' } } },
      });
      const opB = op({
        id: 'op-B',
        clientId: 'clientB',
        vectorClock: { clientB: 1 },
        timestamp: 3000,
        payload: { task: { id: 'task-1', changes: { notes: 'B-notes' } } },
      });

      const r1 = await resolveCapturing(
        'clientA',
        { id: 'task-1', title: 'A-title', notes: 'base' },
        conflictOf([opA], [opB]),
      );
      const mergedOp = r1.appended[0];
      expect(mergedOp).toBeDefined();

      // A's state after applying the merged delta.
      let stateA = applyOp({ id: 'task-1', title: 'A-title', notes: 'base' }, mergedOp);
      expect(pick(stateA)).toEqual({ title: 'A-title', notes: 'B-notes' });

      // Concurrent third client C: overlapping title edit, NEWER timestamp,
      // clock concurrent with everything (C never saw opA/opB/merged).
      const opC = op({
        id: 'op-C',
        clientId: 'clientC',
        vectorClock: { clientC: 1 },
        timestamp: 4000,
        payload: { task: { id: 'task-1', changes: { title: 'C-title' } } },
      });
      let stateC: Record<string, unknown> = {
        id: 'task-1',
        title: 'C-title',
        notes: 'base',
        // A field touched by NEITHER opC nor the merged delta. A partial
        // (changed-fields-only) local-win op would drop it, so it makes the
        // "full snapshot" assertion below test more than the two edited fields.
        tagIds: ['keep-me'],
      };

      // Round 2 on A: local merged op vs remote opC. Fields overlap on title
      // and the merged op is flat/opaque -> no re-merge -> whole-op LWW ->
      // opC (newer) wins -> A applies opC AS-IS (partial).
      const r2a = await resolveCapturing(
        'clientA',
        stateA,
        conflictOf([mergedOp], [opC]),
      );
      expect(r2a.appended.length).toBe(0); // remote win: no new op from A
      for (const o of r2a.applied) {
        stateA = applyOp(stateA, o);
      }

      // TRANSIENT LIMB (documented, not asserted as final): A now holds
      // { title: C, notes: B-notes } while C holds { title: C, notes: base }.
      expect(pick(stateA)).toEqual({ title: 'C-title', notes: 'B-notes' });

      // Round 2 on C: local opC vs remote merged op -> LOCAL win -> C must
      // emit a reconciling local-win op carrying its FULL entity snapshot.
      const r2c = await resolveCapturing(
        'clientC',
        stateC,
        conflictOf([opC], [mergedOp]),
      );
      for (const o of r2c.applied) {
        stateC = applyOp(stateC, o);
      }
      const localWinOp = r2c.appended[0];
      expect(localWinOp).toBeDefined();
      // Full snapshot, not a partial changed-fields-only delta: applied to a
      // BARE base the op alone must reconstruct C's COMPLETE entity — every
      // field, including notes (=base, untouched by opC) AND tagIds (touched by
      // neither opC nor the merged delta). This is the closure property; a
      // partial op would drop these and never reconcile A's B-notes with C.
      expect(applyOp({ id: 'task-1' }, localWinOp)).toEqual({
        id: 'task-1',
        title: 'C-title',
        notes: 'base',
        tagIds: ['keep-me'],
      });

      // The local-win op's clock DOMINATES both inputs (opC and the merged op),
      // so in production it reaches A as a plain non-conflicting remote op that
      // applies directly — which is what the modelled propagation below assumes.
      expect(compareVectorClocks(localWinOp.vectorClock, opC.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
      expect(compareVectorClocks(localWinOp.vectorClock, mergedOp.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );

      // Modelled propagation (justified by the dominating clock above): the
      // local-win op reaches A as a plain remote op and applies directly.
      stateA = applyOp(stateA, localWinOp);

      // SHARED-FIELD RECONCILIATION (deliberately NOT whole-state convergence):
      // the fields both sides carry line up — A's `notes` (absorbed from the
      // merged delta) is overwritten by C's snapshot value, and `title` already
      // agreed. We do NOT assert byte-identical whole-state equality: the real
      // lwwUpdateMetaReducer also stamps `modified` and repairs relationships
      // (project.taskIds, tag/TODAY membership) that this field-level `applyOp`
      // model omits. Whole-state, cross-client convergence is not established at
      // this layer — in particular the inverse upload ordering (opC accepted
      // first, the merged op rejected, so C never downloads it and emits no
      // reconciling op) can leave the clients apart even on shared fields. That
      // is a real-transport property for a dedicated multi-client harness, not
      // this service-level composition test.
      expect(pick(stateA)).toEqual(pick(stateC));
      expect(pick(stateA)).toEqual({ title: 'C-title', notes: 'base' });
    });

    // Pins the receiver-only CLEARING behavior. B edits an OPTIONAL field
    // (`dueDay`) that C never has: A absorbs it via the merged delta, then C's
    // later full local-win snapshot omits it. Because that snapshot rides an
    // `lwwUpdateMode: 'replace'` op, the production meta-reducer applies it via
    // setOne (a full entity swap), so A's absorbed `dueDay` — and B's `notes` —
    // are CLEARED and the clients CONVERGE. This is the behavior the
    // replace/setOne work established; the earlier shallow-`updateOne` path (and a
    // hand-built action that keeps `lwwUpdateMode` out of `meta`) would instead
    // strand the absorbed field on A. This guards against regressing to that
    // non-clearing path. Ops travel the real wire shape (JSON round-trip) and are
    // applied through the production `convertOpToAction` + meta-reducer seam.
    it('clears a receiver-only field the loser absorbed via the replace-mode local-win op — A converges onto C for this ordering (production reducer + JSON round-trip)', async () => {
      // Round 1: A (title) vs B (notes + an OPTIONAL dueDay that C never has).
      const opA = op({
        id: 'op-A',
        clientId: 'clientA',
        vectorClock: { clientA: 1 },
        timestamp: 2000,
        payload: { task: { id: 'task-1', changes: { title: 'A-title' } } },
      });
      const opB = op({
        id: 'op-B',
        clientId: 'clientB',
        vectorClock: { clientB: 1 },
        timestamp: 3000,
        payload: {
          task: { id: 'task-1', changes: { notes: 'B-notes', dueDay: '2026-07-15' } },
        },
      });

      const r1 = await resolveCapturing(
        'clientA',
        { id: 'task-1', title: 'A-title', notes: 'base' },
        conflictOf([opA], [opB]),
      );
      const mergedOp = r1.appended[0];
      expect(mergedOp).toBeDefined();

      // A absorbs the merged delta, INCLUDING the receiver-only dueDay.
      let stateA = applyOp({ id: 'task-1', title: 'A-title', notes: 'base' }, mergedOp);
      expect(stateA['dueDay']).toBe('2026-07-15');

      // Third client C: overlapping newer title edit; its entity never had dueDay.
      const opC = op({
        id: 'op-C',
        clientId: 'clientC',
        vectorClock: { clientC: 1 },
        timestamp: 4000,
        payload: { task: { id: 'task-1', changes: { title: 'C-title' } } },
      });
      let stateC: Record<string, unknown> = {
        id: 'task-1',
        title: 'C-title',
        notes: 'base',
      };
      expect('dueDay' in stateC).toBe(false);

      // Round 2 on A: merged op vs newer opC -> opC wins -> A applies it (partial).
      const r2a = await resolveCapturing(
        'clientA',
        stateA,
        conflictOf([mergedOp], [opC]),
      );
      for (const o of r2a.applied) {
        stateA = applyOp(stateA, o);
      }

      // Round 2 on C: local opC vs remote merged op -> LOCAL win -> full snapshot.
      const r2c = await resolveCapturing(
        'clientC',
        stateC,
        conflictOf([opC], [mergedOp]),
      );
      for (const o of r2c.applied) {
        stateC = applyOp(stateC, o);
      }
      const localWinOp = r2c.appended[0];
      expect(localWinOp).toBeDefined();

      // JSON round-trip — SuperSync serializes ops with JSON.stringify, so C's flat
      // snapshot (which never had dueDay) reaches A with dueDay simply ABSENT from
      // the snapshot; the wire cannot encode "clear this field" explicitly.
      const wirePayload = JSON.parse(JSON.stringify(localWinOp.payload)) as Record<
        string,
        unknown
      >;
      expect('dueDay' in (wirePayload['actionPayload'] as Record<string, unknown>)).toBe(
        false,
      );

      // Apply the round-tripped local-win op to A through the PRODUCTION seam.
      // convertOpToAction routes the op's `lwwUpdateMode: 'replace'` into
      // action.meta, so lwwUpdateMetaReducer applies it via setOne — a full
      // snapshot swap. (A hand-built action spreading lwwUpdateMode at the top
      // level instead of meta silently takes the updateOne shallow-merge branch
      // and hides this.) A's task carries the modelled post-round-2 state (title
      // reconciled to C, notes still B's, dueDay absorbed) plus the structural
      // fields the reducer's relationship-repair reads.
      const mockBase = jasmine.createSpy('base').and.callFake((s: unknown) => s);
      const prodReducer = lwwUpdateMetaReducer(mockBase);
      const aRootState = buildRootStateWithTask({
        ...stateA,
        dueWithTime: null,
        projectId: null,
        tagIds: [],
        parentId: null,
        subTaskIds: [],
        modified: 1000,
      });
      const action = convertOpToAction({
        ...localWinOp,
        payload: wirePayload,
      } as Operation) as unknown as Action;
      prodReducer(aRootState, action);
      const aTask = (
        mockBase.calls.mostRecent().args[0] as Record<
          string,
          { entities: Record<string, Record<string, unknown>> }
        >
      )[TASK_FEATURE_NAME].entities['task-1'];

      // ACTUAL CURRENT BEHAVIOR: A's task entity converges onto C's snapshot. C's
      // later local-win op is `lwwUpdateMode: 'replace'`, so the production reducer
      // applies it via setOne — replacing A's whole task with C's snapshot (a
      // COMPLETE current-state snapshot in production; createLWWUpdateOp warns that
      // a partial one would lose data). Every field that snapshot omits is CLEARED.
      // This is the replace/setOne behavior; a shallow updateOne (the
      // pre-#8990 path, or a mis-built action that keeps lwwUpdateMode out of meta)
      // would instead strand dueDay on A and leave the clients divergent.
      //
      // The DISCRIMINATING proof is `notes` and `dueDay` below: `notes` only flips
      // from the absorbed 'B-notes' to 'base', and `dueDay` only disappears, if the
      // reducer actually engaged setOne (updateOne would keep dueDay). `title` was
      // already 'C-title' on A before this step (absorbed in round 2a), so it
      // corroborates but does not by itself prove the op was applied. Convergence
      // here is at the task-entity level for THIS upload ordering (see the round-2
      // scoping note above); it is not a whole-normalized-state / all-orderings claim.
      expect(aTask['title']).toBe('C-title'); // already C's pre-reducer; unchanged by the replace
      expect(aTask['notes']).toBe('base'); // 'B-notes' → 'base': setOne took C's snapshot
      expect(aTask['dueDay']).toBeUndefined(); // absorbed field CLEARED by setOne (updateOne would keep it)
      expect('dueDay' in stateC).toBe(false); // C never had it — A now matches C
    });
  });
});
