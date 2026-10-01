import { TestBed } from '@angular/core/testing';
import { of } from 'rxjs';
import { ConflictResolutionService } from './conflict-resolution.service';
import { Action, Store } from '@ngrx/store';
import { OperationApplierService } from '../apply/operation-applier.service';
import { convertOpToAction } from '../apply/operation-converter.util';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { PersistentAction } from '../core/persistent-action.interface';
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
import { isDisjointMergeEligible } from './conflict-disjoint-merge.util';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { TASK_FEATURE_NAME } from '../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TAG_FEATURE_NAME } from '../../features/tag/store/tag.reducer';
import { INBOX_PROJECT } from '../../features/project/project.const';
import { TODAY_TAG } from '../../features/tag/tag.const';
import { appStateFeatureKey } from '../../root-store/app-state/app-state.reducer';
import { getDbDateStr } from '../../util/get-db-date-str';
import { UnsupportedMultiEntityConflictError } from '../core/errors/sync-errors';

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
 * (a) title-vs-notes concurrent edit → merged entity keeps BOTH.
 * (b) title-vs-title (same field) → LWW unchanged.
 * (c) disjoint real fields + both bumped a NOISE field → still merges; noise
 *     field resolved deterministically.
 * (d) edit-vs-delete → delete wins, NO merge.
 * (e) two-client convergence: both orderings yield identical entity + dominating
 *     clocks.
 */
describe('ConflictResolutionService — disjoint-field merge', () => {
  let service: ConflictResolutionService;
  let mockStore: jasmine.SpyObj<Store>;
  let mockOpLogStore: jasmine.SpyObj<OperationLogStoreService>;
  let mockOperationApplier: jasmine.SpyObj<OperationApplierService>;

  const CLIENT_ID = 'client-local';
  /** Durable seqs grow across appends, as in the real store. */
  let lastSeq = 0;

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

  /** The ids of every op the resolution applied, in apply order. */
  const appliedOpIds = (): string[] =>
    mockOperationApplier.applyOperations.calls
      .allArgs()
      .flatMap(([ops]) => ops.map((o) => o.id));

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
      'rebasePendingLocalOps',
    ]);
    mockOpLogStore.getOpById.and.resolveTo(undefined);
    mockOpLogStore.rebasePendingLocalOps.and.resolveTo([]);
    mockOpLogStore.mergeRemoteOpClocks.and.resolveTo(undefined);
    mockOpLogStore.markReducersCommittedAndMergeClocks.and.resolveTo(undefined);
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
      written: batches.flatMap((batch) =>
        batch.ops.map((batchOp) => ({
          seq: ++lastSeq,
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
        seqs: ops.map(() => ++lastSeq),
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
          seqs: ops.map(() => ++lastSeq),
          writtenOps: ops,
          skippedCount: 0,
        });
      },
    );
    mockOpLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
      written: batches.flatMap((batch) =>
        batch.ops.map((batchOp) => {
          if (batch.options?.pendingApply) pendingAppendedIds.add(batchOp.id);
          return { seq: ++lastSeq, op: batchOp, source: batch.source };
        }),
      ),
      skippedCount: 0,
    }));
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
    // One transaction: the remote side, then the patch (#10422 crash window).
    expect(batches.map((b) => b.source)).toEqual(['remote', 'local']);
    expect(batches[0].ops.map((o) => o.id)).toEqual(['remote-mb']);
    expect(batches[1].ops.length).toBe(1);
    expect(batches[1].ops[0].opType).toBe(OpType.Update);
    // The remote side applies as itself, before the patch.
    expect(appliedOpIds()).toEqual(['remote-mb', batches[1].ops[0].id]);
  });

  // ── (a) title vs notes → merge both ────────────────────────────────────────
  it('(a) keeps BOTH concurrent title-vs-notes edits: the remote op applies, the local field is re-sent', async () => {
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

    // The patch re-sends only the local field, at the local op's own time;
    // the remote op applies as itself before it (#10422).
    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = extractActionPayload(merged!.payload);
    expect(payload['title']).toBe('Local title');
    expect('notes' in payload).toBeFalse();
    expect(merged!.timestamp).toBe(2000);
    expect((merged!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('patch');
    expect(appliedOpIds()).toEqual(['remote-1', merged!.id]);

    // The local op is superseded (rejected); the remote one is not.
    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toContain('local-1');
    expect(rejected).not.toContain('remote-1');

    // Merged clock dominates both original ops.
    expect(compareVectorClocks(merged!.vectorClock, { A: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    expect(compareVectorClocks(merged!.vectorClock, { B: 1 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
  });

  // ── (a-time) #10147 regression: pending edit vs remote syncTimeSpent ───────
  // A syncTimeSpent op is an additive delta. Its wire entityChanges carry the
  // delta's arguments ({ taskId, date, duration }, direct write) or nothing
  // (deferred write); a synthesized merge would write those keys onto the task
  // and reject the delta. The pair must fall to whole-entity LWW, and whichever
  // side wins must leave the task's time history intact.
  describe('(a-time) pending edit vs remote syncTimeSpent (#10147)', () => {
    const DAY = '2024-01-15';
    const HISTORY = {
      ['2024-01-10']: 7200000,
      ['2024-01-12']: 3600000,
      [DAY]: 7200000,
    };
    const HISTORY_TOTAL = 18000000;
    const currentTask = {
      id: 'task-1',
      title: 'T',
      isDone: true,
      timeSpent: HISTORY_TOTAL,
      timeSpentOnDay: HISTORY,
      dueWithTime: null,
      projectId: null,
      tagIds: [],
      parentId: null,
      subTaskIds: [],
      modified: 1000,
    };

    const capturedSyncTimeSpent = (form: 'direct' | 'deferred'): Operation => {
      const actionPayload = { taskId: 'task-1', date: DAY, duration: 60000 };
      return op({
        id: `remote-time-${form}`,
        clientId: 'B',
        vectorClock: { B: 1 },
        timestamp: 1000,
        actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        payload: {
          actionPayload,
          entityChanges:
            form === 'direct'
              ? new OperationCaptureService().extractEntityChanges({
                  type: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
                  ...actionPayload,
                  meta: {
                    isPersistent: true,
                    entityType: 'TASK',
                    entityId: 'task-1',
                    opType: OpType.Update,
                  },
                } as unknown as PersistentAction)
              : [],
        },
      });
    };

    const pendingDoneEdit = (): Operation =>
      op({
        id: 'local-done',
        clientId: 'A',
        vectorClock: { A: 1 },
        timestamp: 2000,
        payload: { task: { id: 'task-1', changes: { isDone: true } } },
      });

    const expectNoSynthesizedMerge = async (): Promise<void> => {
      const localOps = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
        .allArgs()
        .flatMap(([batches]) => batches)
        .filter((batch) => batch.source === 'local')
        .flatMap((batch) => [...batch.ops]);
      for (const emitted of localOps) {
        const payload = extractActionPayload(emitted.payload);
        expect(Object.keys(payload)).not.toContain('taskId');
        expect(Object.keys(payload)).not.toContain('date');
        expect(Object.keys(payload)).not.toContain('duration');
        expect((emitted.payload as { lwwUpdateMode?: string }).lwwUpdateMode).not.toBe(
          'patch',
        );
      }
    };

    for (const form of ['direct', 'deferred'] as const) {
      it(`never synthesizes a merged patch from a ${form}-form delta and keeps the time history on the local-win path`, async () => {
        mockStore.select.and.returnValue(of(currentTask));

        await service.autoResolveConflictsLWW([
          conflictOf([pendingDoneEdit()], [capturedSyncTimeSpent(form)]),
        ]);
        await expectNoSynthesizedMerge();

        // Local (ts 2000) wins: the local-win op is a full snapshot. Applied
        // through the production reducer on the other client, it carries the
        // whole timeSpentOnDay map — not a single-day delta.
        const localWin = mergedOpArgs();
        expect(localWin).toBeDefined();
        const mockBase = jasmine.createSpy('base').and.callFake((st: unknown) => st);
        const prodReducer = lwwUpdateMetaReducer(mockBase);
        const otherClientState = buildRootStateWithTask({
          ...currentTask,
          isDone: false,
          timeSpent: HISTORY_TOTAL + 60000,
          timeSpentOnDay: { ...HISTORY, [DAY]: HISTORY[DAY] + 60000 },
        });
        prodReducer(
          otherClientState,
          convertOpToAction(
            JSON.parse(JSON.stringify(localWin)) as Operation,
          ) as unknown as Action,
        );
        const task = (
          mockBase.calls.mostRecent().args[0] as Record<
            string,
            { entities: Record<string, Record<string, unknown>> }
          >
        )[TASK_FEATURE_NAME].entities['task-1'];
        expect(task['isDone']).toBe(true);
        expect(task['timeSpentOnDay']).toEqual(HISTORY);
        expect(task['timeSpent']).toBe(HISTORY_TOTAL);
      });
    }

    it('never synthesizes a merged patch when the pending side is a removeTimeSpent delta', async () => {
      mockStore.select.and.returnValue(of(currentTask));
      const localRemove = op({
        id: 'local-remove',
        clientId: 'A',
        vectorClock: { A: 1 },
        timestamp: 2000,
        actionType: ActionType.TASK_REMOVE_TIME_SPENT,
        payload: {
          actionPayload: { id: 'task-1', date: DAY, duration: 60000 },
          entityChanges: [],
        },
      });
      const remoteTitle = op({
        id: 'remote-title',
        clientId: 'B',
        vectorClock: { B: 1 },
        timestamp: 1000,
        payload: { task: { id: 'task-1', changes: { title: 'Remote' } } },
      });

      await service.autoResolveConflictsLWW([conflictOf([localRemove], [remoteTitle])]);

      await expectNoSynthesizedMerge();
    });
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
    expect('title' in payload).toBeFalse();
    expect(payload['isDone']).toBe(true);
    expect((merged!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('patch');
    expect(appliedOpIds()).toEqual(['remote-rename', merged!.id]);

    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toContain('local-done');
    expect(rejected).not.toContain('remote-rename');
  });

  // ── (a0b) #9776 follow-up: a cleared field must survive the disjoint merge ──
  // The clear op arrives over the wire with its undefined-valued key dropped by
  // JSON and only the out-of-band `clearedFields` marking it. Pre-fix the
  // receiver classified it as opaque (no merge → whole-entity LWW) while the
  // author merged — divergent strategies for the same conflict — and even the
  // author's merged op lost the clear on upload (no `clearedFields` on the
  // synthesized payload).
  it('(a0b) re-sends a local field clear beside a disjoint remote edit and re-lists the clear', async () => {
    mockStore.select.and.returnValue(
      of({ id: 'task-1', title: 'Remote title', _hideSubTasksMode: undefined }),
    );

    // A local clear as it reads after a restart: `changes` lost the
    // undefined-valued key to JSON serialization; `clearedFields` survives.
    const localOp: Operation = JSON.parse(
      JSON.stringify(
        op({
          id: 'local-clear',
          clientId: 'A',
          vectorClock: { A: 1 },
          timestamp: 2000,
          payload: {
            actionPayload: {
              task: { id: 'task-1', changes: { _hideSubTasksMode: undefined } },
              clearedFields: ['_hideSubTasksMode'],
            },
            entityChanges: [],
          },
        }),
      ),
    );
    const remoteOp = op({
      id: 'remote-title',
      clientId: 'B',
      vectorClock: { B: 1 },
      timestamp: 1000,
      payload: { task: { id: 'task-1', changes: { title: 'Remote title' } } },
    });

    await service.autoResolveConflictsLWW([conflictOf([localOp], [remoteOp])]);

    const merged = mergedOpArgs();
    expect(merged).toBeDefined();
    const payload = extractActionPayload(merged!.payload);
    expect('title' in payload).toBeFalse();
    // The clear is present in the delta AND re-listed out-of-band so it
    // survives the merged op's own JSON upload.
    expect(Object.keys(payload)).toContain('_hideSubTasksMode');
    expect(payload['_hideSubTasksMode']).toBeUndefined();
    expect((merged!.payload as { clearedFields?: string[] }).clearedFields).toEqual([
      '_hideSubTasksMode',
    ]);
    expect((merged!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('patch');

    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toContain('local-clear');
    expect(rejected).not.toContain('remote-title');
  });

  // ── (a0c) clearedFields is scoped to disjoint merges ──
  // Other patch-mode producers build payloads from live state, where an
  // undefined-valued key is an accident of the object literal (e.g.
  // taskRelationshipPatch materializes `parentId: undefined` for every root
  // task), NOT a user intent. Listing those as clears would broadcast an
  // explicit `parentId` clear on 100% of relationship patches and force-detach
  // concurrently-created subtask links on receivers.
  it('(a0c) does NOT list clearedFields on non-merge patch ops with accidental undefined keys', () => {
    const opResult = service.createLWWUpdateOp(
      'TASK',
      'task-1',
      // Shape of taskRelationshipPatch for a root task: parentId materialized
      // but undefined.
      { id: 'task-1', projectId: 'p1', parentId: undefined, subTaskIds: ['sub-1'] },
      'clientA',
      { clientA: 1 },
      1000,
      'patch',
    );

    expect(
      (opResult.payload as { clearedFields?: string[] }).clearedFields,
    ).toBeUndefined();
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
    ).toBeRejectedWithError(UnsupportedMultiEntityConflictError);

    expect(mergedOpArgs('task-2')).toBeUndefined();
    expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
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
    ).toBeRejectedWithError(UnsupportedMultiEntityConflictError);

    expect(mockOpLogStore.appendBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
    expect(mockOpLogStore.markRejected).not.toHaveBeenCalled();
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
    expect('notes' in payload).toBe(false);
    // The un-conflicted field must NOT ride along in the synthesized op.
    expect('timeSpentOnDay' in payload).toBe(false);
  });

  // ── (a4) one patch per entity: its conflicts are resolved together
  it('(a4) resolves an entity with multiple conflicts together, as ONE re-send', async () => {
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
    // entity. Patching each independently would let the clock-dominating
    // sibling silently drop the other's field.
    await service.autoResolveConflictsLWW([
      conflictOf([localEst], [remoteTitle]),
      conflictOf([localEst], [remoteNotes]),
    ]);
    const localOps = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
      .allArgs()
      .flatMap(([batches]) => batches)
      .filter((batch) => batch.source === 'local')
      .flatMap((batch) => [...batch.ops]);
    expect(localOps.length).toBe(1);
    expect(extractActionPayload(localOps[0].payload)).toEqual({
      timeEstimate: 9,
      id: 'task-1',
    });
    expect(compareVectorClocks(localOps[0].vectorClock, { A: 1, B: 2 })).toBe(
      VectorClockComparison.GREATER_THAN,
    );
    expect(appliedOpIds()).toEqual(['remote-title', 'remote-notes', localOps[0].id]);
    const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
    expect(rejected).toEqual(['local-est']);
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
    ).toBeRejectedWithError(UnsupportedMultiEntityConflictError);
    expect(mergedOpArgs()).toBeUndefined();
    expect(mockOpLogStore.appendMixedSourceBatchSkipDuplicates).not.toHaveBeenCalled();
  });

  // ── (a5) disjoint-merge fix: refuse merge for fallback-less entity types ───────────
  it('(a5) refuses disjoint-merge for a type without a RECREATE_FALLBACK (NOTE → LWW)', async () => {
    // A partial-delta merged op that later wins over a concurrent delete would
    // recreate a schema-INVALID NOTE (no RECREATE_FALLBACK). So NOTE disjoint
    // conflicts must fall back to whole-entity LWW, not merge.
    mockStore.select.and.returnValue(
      of({ id: 'note-1', content: 'Local content', backgroundColor: 'base' }),
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
    const replacement = mergedOpArgs('note-1');
    expect(replacement).toBeDefined();
    expect(extractActionPayload(replacement!.payload)['content']).toBe('Local content');
    expect((replacement!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe(
      'replace',
    );
    expect(mockOpLogStore.markRejected).toHaveBeenCalledWith(['remote-note']);
  });

  it('(a6) aborts resolution when appending the merged op fails', async () => {
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
    expect(mockOperationApplier.applyOperations).not.toHaveBeenCalled();
  });

  // ── (b) title vs title → LWW unchanged ─────────────────────────────────────
  it("(b) re-sends a same-field (title-vs-title) local win at the local op's time", async () => {
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
    const patch = mergedOpArgs();
    expect(patch).toBeDefined();
    expect(extractActionPayload(patch!.payload)).toEqual({
      title: 'Local title',
      id: 'task-1',
    });
    expect((patch!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe('patch');
    expect(patch!.timestamp).toBe(2000);
    expect(appliedOpIds()).toEqual(['remote-1', patch!.id]);
    expect(mockOpLogStore.markRejected.calls.allArgs().flat(2)).toEqual(['local-1']);
  });

  // ── field patch (#10379, #10260): overlapping fields ────────────────────────
  describe('field patch of overlapping conflicts', () => {
    const titleAndDone = (over: Partial<Operation>): Operation =>
      op({
        payload: {
          task: { id: 'task-1', changes: { title: 'A title', isDone: true } },
        },
        ...over,
      });
    const title = (over: Partial<Operation>, value: string): Operation =>
      op({ payload: { task: { id: 'task-1', changes: { title: value } } }, ...over });

    it("keeps the losing side's other fields when the remote side wins (#10260)", async () => {
      mockStore.select.and.returnValue(
        of({ id: 'task-1', title: 'A title', isDone: true }),
      );
      const local = titleAndDone({ id: 'l', clientId: 'A', vectorClock: { A: 1 } });
      const remote = title(
        { id: 'r', clientId: 'B', vectorClock: { B: 1 }, timestamp: 2000 },
        'B title',
      );

      await service.autoResolveConflictsLWW([conflictOf([local], [remote])]);

      // Only the losing side's own field is re-sent, at its own time (#10422).
      const patch = mergedOpArgs()!;
      expect(extractActionPayload(patch.payload)).toEqual({
        isDone: true,
        id: 'task-1',
      });
      expect(patch.timestamp).toBe(1000);
      expect(appliedOpIds()).toEqual(['r', patch.id]);
    });

    it("keeps the other side's fields when the local side wins (#10379)", async () => {
      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'B title' }));
      const local = title(
        { id: 'l', clientId: 'B', vectorClock: { B: 1 }, timestamp: 2000 },
        'B title',
      );
      const remote = titleAndDone({ id: 'r', clientId: 'A', vectorClock: { A: 1 } });

      await service.autoResolveConflictsLWW([conflictOf([local], [remote])]);

      // The other side's done toggle applies as itself, not inside the patch.
      const patch = mergedOpArgs()!;
      expect(extractActionPayload(patch.payload)).toEqual({
        title: 'B title',
        id: 'task-1',
      });
      expect(patch.timestamp).toBe(2000);
      expect(appliedOpIds()).toEqual(['r', patch.id]);
    });

    it('re-sends each winning local op as its own row at its own time, oldest first, each dominating the one before (#10422)', async () => {
      mockStore.select.and.returnValue(
        of({ id: 'task-1', title: 'A title', notes: 'A notes', isDone: true }),
      );
      const notes = op({
        id: 'l-notes',
        clientId: 'A',
        vectorClock: { A: 1 },
        timestamp: 1000,
        payload: { task: { id: 'task-1', changes: { notes: 'A notes' } } },
      });
      const rename = title(
        { id: 'l-title', clientId: 'A', vectorClock: { A: 2 }, timestamp: 3000 },
        'A title',
      );
      const remote = op({
        id: 'r',
        clientId: 'B',
        vectorClock: { B: 1 },
        timestamp: 2000,
        payload: { task: { id: 'task-1', changes: { isDone: true } } },
      });

      await service.autoResolveConflictsLWW([conflictOf([notes, rename], [remote])]);

      const resends = mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls
        .allArgs()
        .flatMap(([batches]) => batches)
        .filter((batch) => batch.source === 'local')
        .flatMap((batch) => [...batch.ops]);
      expect(resends.map((o) => extractActionPayload(o.payload))).toEqual([
        { notes: 'A notes', id: 'task-1' },
        { title: 'A title', id: 'task-1' },
      ]);
      expect(resends.map((o) => o.timestamp)).toEqual([1000, 3000]);
      expect(compareVectorClocks(resends[1].vectorClock, resends[0].vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
      for (const original of [notes, rename, remote]) {
        expect(compareVectorClocks(resends[0].vectorClock, original.vectorClock)).toBe(
          VectorClockComparison.GREATER_THAN,
        );
      }
      expect(appliedOpIds()).toEqual(['r', resends[0].id, resends[1].id]);
      const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
      expect(rejected).toEqual(jasmine.arrayWithExactContents(['l-notes', 'l-title']));
    });

    it('assigns each field to the same side on both devices for a timestamp tie', async () => {
      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'x' }));
      const onA = titleAndDone({
        id: 'a',
        clientId: 'clientA',
        vectorClock: { clientA: 1 },
        timestamp: 1000,
      });
      const onB = title(
        { id: 'b', clientId: 'clientB', vectorClock: { clientB: 1 }, timestamp: 1000 },
        'B title',
      );

      await service.autoResolveConflictsLWW([conflictOf([onA], [onB])]);
      const patchOnA = mergedOpArgs()!;
      mockOpLogStore.appendMixedSourceBatchSkipDuplicates.calls.reset();
      await service.autoResolveConflictsLWW([conflictOf([onB], [onA])]);
      const patchOnB = mergedOpArgs()!;

      // 'clientB' > 'clientA' gives B the shared title on both devices: A
      // re-sends only its done toggle, B only its title.
      expect(extractActionPayload(patchOnA.payload)).toEqual({
        isDone: true,
        id: 'task-1',
      });
      expect(extractActionPayload(patchOnB.payload)).toEqual({
        title: 'B title',
        id: 'task-1',
      });
    });

    it('keeps the whole-entity path when an overlapping patch would clear a reminder', async () => {
      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'A title' }));
      const local = op({
        id: 'l',
        clientId: 'A',
        vectorClock: { A: 1 },
        timestamp: 2000,
        payload: {
          task: {
            id: 'task-1',
            changes: { title: 'A title', dueWithTime: undefined },
          },
          clearedFields: ['dueWithTime'],
        },
      });
      const remote = title(
        { id: 'r', clientId: 'B', vectorClock: { B: 1 }, timestamp: 1000 },
        'B title',
      );

      await service.autoResolveConflictsLWW([conflictOf([local], [remote])]);

      expect((mergedOpArgs()!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe(
        'replace',
      );
    });

    it('keeps a local time delta pending and rebases it, even when no field is re-sent', async () => {
      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'A title' }));
      const rename = title({ id: 'l-rename', clientId: 'A', vectorClock: { A: 1 } }, 'A');
      const delta = op({
        id: 'l-delta',
        clientId: 'A',
        actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        vectorClock: { A: 2 },
        timestamp: 1100,
        payload: {
          actionPayload: { taskId: 'task-1', date: '2026-01-01', duration: 3000 },
          entityChanges: [],
        },
      });
      const remote = title(
        { id: 'r', clientId: 'B', vectorClock: { B: 1 }, timestamp: 2000 },
        'B title',
      );
      mockOpLogStore.getOpById.and.callFake(async (id: string) =>
        id === 'l-delta' ? ({ source: 'local', op: delta, seq: 2 } as never) : undefined,
      );

      await service.autoResolveConflictsLWW([conflictOf([rename, delta], [remote])]);

      // The rename lost and the delta's arguments are no fields: nothing is
      // re-sent, and the delta stays pending, rebased past the remote side.
      expect(mergedOpArgs()).toBeUndefined();
      expect(appliedOpIds()).toEqual(['r']);
      const rejected = mockOpLogStore.markRejected.calls.allArgs().flat(2);
      expect(rejected).toContain('l-rename');
      expect(rejected).not.toContain('l-delta');
      expect(mockOpLogStore.rebasePendingLocalOps).toHaveBeenCalledWith(['l-delta'], {
        B: 1,
      });
    });

    it('re-sends a pending edit beside a newer remote patch row that does not write its field (#10260, #10422)', async () => {
      mockStore.select.and.returnValue(
        of({ id: 'task-1', title: 'B title', isDone: true, doneOn: 900 }),
      );
      const local = op({
        id: 'l-done',
        clientId: 'A',
        vectorClock: { A: 2 },
        timestamp: 900,
        payload: { task: { id: 'task-1', changes: { isDone: true, doneOn: 900 } } },
      });
      const row = op({
        id: 'r-row',
        clientId: 'B',
        actionType: '[TASK] LWW Update' as ActionType,
        vectorClock: { A: 1, B: 3 },
        timestamp: 2000,
        payload: {
          actionPayload: { id: 'task-1', title: 'B title' },
          entityChanges: [],
          lwwUpdateMode: 'patch',
        },
      });

      await service.autoResolveConflictsLWW([conflictOf([local], [row])]);

      // Only the row's keys are read: it writes no done toggle. It applies as
      // itself, and the toggle is re-sent after it.
      const reemitted = mergedOpArgs()!;
      expect(appliedOpIds()).toEqual(['r-row', reemitted.id]);
      expect(extractActionPayload(reemitted.payload)).toEqual({
        isDone: true,
        doneOn: 900,
        id: 'task-1',
      });
      expect(compareVectorClocks(reemitted.vectorClock, row.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
      expect(reemitted.timestamp).toBe(900);
    });

    it('refuses the patch beside a remote time delta', async () => {
      mockStore.select.and.returnValue(of({ id: 'task-1', title: 'A title' }));
      const local = title({ id: 'l', clientId: 'A', vectorClock: { A: 1 } }, 'A');
      const remoteRename = title(
        { id: 'r', clientId: 'B', vectorClock: { B: 1 }, timestamp: 900 },
        'B',
      );
      const remoteDelta = op({
        id: 'r-delta',
        clientId: 'B',
        actionType: ActionType.TIME_TRACKING_SYNC_TIME_SPENT,
        vectorClock: { B: 2 },
        timestamp: 950,
        payload: {
          actionPayload: { taskId: 'task-1', date: '2026-01-01', duration: 3000 },
          entityChanges: [],
        },
      });

      await service.autoResolveConflictsLWW([
        conflictOf([local], [remoteRename, remoteDelta]),
      ]);

      expect((mergedOpArgs()!.payload as { lwwUpdateMode?: string }).lwwUpdateMode).toBe(
        'replace',
      );
      expect(mockOpLogStore.rebasePendingLocalOps).not.toHaveBeenCalled();
    });
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
    expect('notes' in payload).toBe(false);
    // The noise field is the newer remote side's: the local one is not
    // re-sent, so the remote op's value stands.
    expect('modified' in payload).toBe(false);
    expect(appliedOpIds()).toEqual(['remote-1', merged!.id]);
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
    // No synthesized merged UPDATE op was created for this entity.
    expect(mergedOpArgs()).toBeUndefined();
  });

  // ── (d2) archive vs disjoint edit → archive wins whole entity, NO merge ─────
  it('(d2) never merges an archive-vs-disjoint-edit conflict (archive-plan guard, not eligibility, blocks it)', async () => {
    // An archive is an UPDATE op (not a Delete), so `isDisjointMergeEligible`
    // does NOT reject it: an archive that carries its own disjoint non-noise
    // field alongside a concurrent disjoint edit is field-level merge-eligible.
    // The ONLY thing preventing a partial-resurrection merge is the
    // `_isWholeEntityWinPlan` guard in `_tryCreateFieldPatch`. This asserts
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
  });

  // ── (e) two-client convergence ─────────────────────────────────────────────
  describe('(e) two-client convergence', () => {
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
      // The two independently built re-sends are concurrent by clock; each
      // carries only its own side's fields (see the round-trip test below).
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
          batch.ops.map((batchOp) => ({
            seq: ++lastSeq,
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
          seqs: ops.map(() => ++lastSeq),
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

    it('each client re-sends only its own field, and both reach the identical entity (converge)', async () => {
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

      expect(entityOf(a1.synthesized!)).toEqual({ title: 'A-title', notes: undefined });
      expect(entityOf(b1.synthesized!)).toEqual({ title: undefined, notes: 'B-notes' });

      // Each device applied the other's op as itself, then its own re-send;
      // a third device applies both originals and both re-sends.
      const apply = (
        state: Record<string, unknown>,
        ...ops: Operation[]
      ): Record<string, unknown> =>
        ops.reduce((acc, o) => {
          const p = extractActionPayload(o.payload);
          const changes =
            (p['task'] as { changes?: Record<string, unknown> } | undefined)?.changes ??
            p;
          return { ...acc, ...changes, id: 'task-1' };
        }, state);
      const base = { id: 'task-1', title: 'base', notes: 'base' };
      const onA = apply(base, titleOp, notesOp, a1.synthesized!);
      const onB = apply(base, notesOp, titleOp, b1.synthesized!);
      const onC = apply(base, titleOp, notesOp, a1.synthesized!, b1.synthesized!);
      expect(onA).toEqual({ id: 'task-1', title: 'A-title', notes: 'B-notes' });
      expect(onB).toEqual(onA);
      expect(onC).toEqual(onA);
    });
  });

  // A FOCUSED COMPOSITION TEST, not a transport e2e: it drives
  // ConflictResolutionService with hand-built EntityConflicts and composes the
  // ops it emits with a field-level `applyOp` model. Cross-client propagation
  // is modelled in server order, justified by the dominating-clock assertions.
  describe('composition (3-client): a later overlapping edit beats a re-send', () => {
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
          seqs: ops.map(() => ++lastSeq),
          writtenOps: ops,
          skippedCount: 0,
        }),
      );
      // #8900 seam: local-win / merged ops now persist through the atomic
      // mixed-source batch, mirroring the outer suite's setup.
      opLogStore.appendMixedSourceBatchSkipDuplicates.and.callFake(async (batches) => ({
        written: batches.flatMap((batch) =>
          batch.ops.map((batchOp) => ({
            seq: ++lastSeq,
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

    it("a third client's newer title beats a re-send per field and keeps the other side's notes (#10422)", async () => {
      // Round 1: A (title, 2000) loses nothing to B (notes, 3000): A applies
      // B's op and re-sends only its title, at its own time.
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
      const [reSendA] = r1.appended;
      expect(r1.appended.length).toBe(1);
      expect(reSendA.timestamp).toBe(2000);
      expect(r1.applied.map((o) => o.id)).toEqual(['op-B', reSendA.id]);

      // Round 2 on C: a newer overlapping title (4000) against B's op and A's
      // re-send, which C reads only by its keys (title). C wins the title, so
      // it applies both remote ops as themselves and re-sends its title.
      const opC = op({
        id: 'op-C',
        clientId: 'clientC',
        vectorClock: { clientC: 1 },
        timestamp: 4000,
        payload: { task: { id: 'task-1', changes: { title: 'C-title' } } },
      });
      const r2 = await resolveCapturing(
        'clientC',
        { id: 'task-1', title: 'C-title', notes: 'base' },
        conflictOf([opC], [opB, reSendA]),
      );
      const [reSendC] = r2.appended;
      expect(r2.appended.length).toBe(1);
      expect(extractActionPayload(reSendC.payload)).toEqual({
        title: 'C-title',
        id: 'task-1',
      });
      expect(reSendC.timestamp).toBe(4000);
      expect(r2.applied.map((o) => o.id)).toEqual(['op-B', reSendA.id, reSendC.id]);
      expect(compareVectorClocks(reSendC.vectorClock, reSendA.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );

      // Every device ends on the latest write of each field.
      const base = { id: 'task-1', title: 'base', notes: 'base' };
      const onA = [opA, opB, reSendA, reSendC].reduce(applyOp, base);
      const onB = [opB, reSendA, reSendC].reduce(applyOp, base);
      const onC = [opC, opB, reSendA, reSendC].reduce(applyOp, base);
      const expected = { title: 'C-title', notes: 'B-notes' };
      expect(pick(onA)).toEqual(expected);
      expect(pick(onB)).toEqual(expected);
      expect(pick(onC)).toEqual(expected);
    });
  });
});
