import { Injector, runInInjectionContext } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, ActionReducer, Store } from '@ngrx/store';
import { of, Subject, Subscription } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { roundTimeSpentForDay } from '../../../features/tasks/store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import {
  clearDeferredActions,
  operationCaptureMetaReducer,
} from '../../capture/operation-capture.meta-reducer';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { UnsupportedMultiEntityConflictError } from '../../core/errors/sync-errors';
import { ActionType, EntityConflict, Operation } from '../../core/operation.types';
import {
  isPersistentAction,
  PersistentAction,
} from '../../core/persistent-action.interface';
import { OperationLogCompactionService } from '../../persistence/operation-log-compaction.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ConflictJournalService } from '../../sync/conflict-journal.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ImmediateUploadService } from '../../sync/immediate-upload.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { toEntityKey } from '../../util/entity-key.util';
import { ValidateStateService } from '../../validation/validate-state.service';
import { buildArchiveWinOp } from '../../sync/bulk-archive-intent.util';
import { compareVectorClocks, VectorClockComparison } from '@sp/sync-core';
import {
  ApplyOperationsOptions,
  ApplyOperationsResult,
} from '../../core/types/apply.types';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import {
  BulkReplayReducerFailure,
  runWithBulkReplayFailureCollector,
} from '../../apply/bulk-replay-failure-collector';
import { META_REDUCERS } from '../../../root-store/meta/meta-reducer-registry';
import { reducerFailureGuardMetaReducer } from '../../../root-store/meta/reducer-failure-guard.meta-reducer';
import {
  PROJECT_FEATURE_NAME,
  projectReducer,
} from '../../../features/project/store/project.reducer';
import { createStateWithExistingTasks } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../../root-store/root-state';
import {
  TASK_FEATURE_NAME,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { TAG_FEATURE_NAME, tagReducer } from '../../../features/tag/store/tag.reducer';
import { SECTION_FEATURE_NAME } from '../../../features/section/store/section.reducer';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { OperationLogHydratorService } from '../../persistence/operation-log-hydrator.service';
import { OperationLogMigrationService } from '../../persistence/operation-log-migration.service';
import { OperationLogSnapshotService } from '../../persistence/operation-log-snapshot.service';
import { OperationLogRecoveryService } from '../../persistence/operation-log-recovery.service';
import { SyncHydrationService } from '../../persistence/sync-hydration.service';
import { ArchiveMigrationService } from '../../persistence/archive-migration.service';
import { CURRENT_SCHEMA_VERSION } from '../../persistence/schema-migration.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { HydrationStateService } from '../../apply/hydration-state.service';

/**
 * #9537 / #9405: both devices archiving overlapping done tasks concurrently
 * (each side's "Finish day" emits ONE atomic multi-task `moveToArchive` op)
 * used to fail the multi-entity preflight with
 * `SYNC_MULTI_ENTITY_UNSUPPORTED side=local actionType=moveToArchive` and
 * wedge sync on every retry. These specs pin the resolution behavior: the
 * batch resolves, the losing bulk archive row is rejected, and a scoped
 * replacement re-uploads the archive intent for the tasks no remote archive
 * covered (mirroring the bulk-delete preserve mechanism).
 */
describe('bulk archive conflict resolution integration (#9537)', () => {
  const LOCAL_CLIENT_ID = 'archive-client';
  const REMOTE_CLIENT_ID = 'remote-client';
  const TASK_A = 'task-a';
  const TASK_B = 'task-b';
  const TASK_C = 'task-c';
  const TASK_D = 'task-d';
  const SIBLING_X = 'task-sibling-x';

  let opLogStore: OperationLogStoreService;
  let capture: OperationCaptureService;
  let writeFlush: OperationWriteFlushService;
  let resolver: ConflictResolutionService;
  let journal: ConflictJournalService;
  let operationApplier: jasmine.SpyObj<OperationApplierService>;
  let store: jasmine.SpyObj<Store>;
  let actions$: Subject<Action>;
  let effectSubscription: Subscription;
  let taskStateById: Record<string, Task | undefined>;

  const doneTask = (id: string, subTasks: Task[] = []): TaskWithSubTasks => ({
    ...DEFAULT_TASK,
    id,
    title: `Done ${id}`,
    projectId: 'project1',
    isDone: true,
    doneOn: 1_000,
    subTaskIds: subTasks.map(({ id: subId }) => subId),
    subTasks,
  });

  beforeEach(async () => {
    resetTestUuidCounter();
    clearDeferredActions();
    actions$ = new Subject<Action>();
    store = jasmine.createSpyObj<Store>('Store', ['dispatch', 'select']);
    taskStateById = {
      [SIBLING_X]: {
        ...DEFAULT_TASK,
        id: SIBLING_X,
        title: 'Sibling X',
        projectId: 'project1',
      },
    };
    // Serve current entity state for reconciliation snapshots from a plain map.
    // The registry's TASK selectById is a props-based selector: (selector, {id}).
    store.select.and.callFake(((_selector: unknown, props?: { id?: string }): unknown =>
      of(props?.id ? taskStateById[props.id] : undefined)) as Store['select']);

    operationApplier = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
    // Mimic the real applier's contract: report every op as reducer-committed
    // and applied, so the resolution's markApplied/checkpoint bookkeeping runs.
    operationApplier.applyOperations.and.callFake((async (
      ops: Operation[],
      options: ApplyOperationsOptions = {},
    ): Promise<ApplyOperationsResult> => {
      await options.onReducersCommitted?.(ops, []);
      return { appliedOps: ops };
    }) as OperationApplierService['applyOperations']);
    const validateState = jasmine.createSpyObj<ValidateStateService>(
      'ValidateStateService',
      ['validateAndRepairCurrentState'],
    );
    validateState.validateAndRepairCurrentState.and.resolveTo(true);
    const compaction = jasmine.createSpyObj<OperationLogCompactionService>(
      'OperationLogCompactionService',
      ['compact', 'emergencyCompact'],
    );
    compaction.compact.and.resolveTo(true);
    compaction.emergencyCompact.and.resolveTo(true);
    const clientId = jasmine.createSpyObj<ClientIdService>('ClientIdService', [
      'getOrGenerateClientId',
    ]);
    clientId.getOrGenerateClientId.and.resolveTo(LOCAL_CLIENT_ID);

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogEffects,
        OperationLogStoreService,
        OperationCaptureService,
        provideMockActions(() => actions$),
        { provide: Store, useValue: store },
        { provide: OperationApplierService, useValue: operationApplier },
        { provide: ValidateStateService, useValue: validateState },
        { provide: OperationLogCompactionService, useValue: compaction },
        {
          provide: ImmediateUploadService,
          useValue: jasmine.createSpyObj<ImmediateUploadService>(
            'ImmediateUploadService',
            ['trigger'],
          ),
        },
        { provide: ClientIdService, useValue: clientId },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: () => Promise.resolve(LOCAL_CLIENT_ID),
            getOrGenerateClientId: () => Promise.resolve(LOCAL_CLIENT_ID),
            clearCache: () => {},
          },
        },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
      ],
    });

    opLogStore = TestBed.inject(OperationLogStoreService);
    capture = TestBed.inject(OperationCaptureService);
    writeFlush = TestBed.inject(OperationWriteFlushService);
    resolver = TestBed.inject(ConflictResolutionService);
    journal = TestBed.inject(ConflictJournalService);
    capture.clear();
    store.dispatch.and.callFake(((action: Action): void => {
      if (!isPersistentAction(action)) {
        throw new Error('Expected a persistent action');
      }
      capture.incrementPending(action);
      actions$.next(action);
    }) as Store['dispatch']);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await journal.clearAll();
    effectSubscription =
      TestBed.inject(OperationLogEffects).persistOperation$.subscribe();
  });

  afterEach(async () => {
    await writeFlush.flushPendingWrites();
    effectSubscription.unsubscribe();
    actions$.complete();
    capture.clear();
    clearDeferredActions();
    await opLogStore._clearAllDataForTesting();
    await journal.clearAll();
    TestBed.resetTestingModule();
  });

  const dispatchAndFlush = async (action: PersistentAction): Promise<Operation[]> => {
    store.dispatch(action);
    await writeFlush.flushPendingWrites();
    return (await opLogStore.getUnsynced()).map(({ op }) => op);
  };

  const remoteClient = (): TestClient => new TestClient(REMOTE_CLIENT_ID);

  const buildRemoteArchiveOp = (
    client: TestClient,
    taskIds: string[],
    timestamp: number,
  ): Operation => {
    const remoteAction = TaskSharedActions.moveToArchive({
      tasks: taskIds.map((id) => doneTask(id)),
    }) as PersistentAction;
    const { type, meta, ...actionPayload } = remoteAction;
    return {
      ...client.createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: taskIds[0],
        entityIds: taskIds,
        payload: { actionPayload, entityChanges: [] },
      }),
      timestamp,
    };
  };

  const buildRemoteTaskEdit = (
    client: TestClient,
    targetTaskId: string,
    timestamp: number,
  ): Operation => {
    const remoteAction = TaskSharedActions.updateTask({
      task: { id: targetTaskId, changes: { title: 'Concurrent remote edit' } },
    }) as PersistentAction;
    const { type, meta, ...actionPayload } = remoteAction;
    return {
      ...client.createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: targetTaskId,
        payload: { actionPayload, entityChanges: [] },
      }),
      timestamp,
    };
  };

  const detectConflictsFor = async (
    remoteOperation: Operation,
  ): Promise<EntityConflict[]> => {
    const detection = await resolver.checkOpForConflicts(remoteOperation, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detection.conflicts.length).toBeGreaterThan(0);
    return detection.conflicts;
  };

  const unsyncedOps = async (): Promise<Operation[]> =>
    (await opLogStore.getUnsynced()).map(({ op }) => op);

  const appliedOps = (): Operation[] =>
    operationApplier.applyOperations.calls.allArgs().flatMap(([ops]) => ops);

  const expectDominates = (dominating: Operation, dominated: Operation): void => {
    expect(compareVectorClocks(dominating.vectorClock, dominated.vectorClock)).toBe(
      VectorClockComparison.GREATER_THAN,
    );
  };

  const payloadTaskIds = (op: Operation): string[] => {
    const actionPayload = (op.payload as { actionPayload: { tasks: Task[] } })
      .actionPayload;
    return actionPayload.tasks.map(({ id }) => id);
  };

  const fullLog = async (): Promise<Operation[]> =>
    (await opLogStore.getOpsAfterSeq(0)).map(({ op }) => op);

  // Production meta-reducers in registry order over the task, project and tag
  // feature reducers; capture and the throw-swallowing guard are dropped so
  // replay failures surface in `failures` instead.
  const replayReducer = META_REDUCERS.filter(
    (m) => m !== operationCaptureMetaReducer && m !== reducerFailureGuardMetaReducer,
  ).reduceRight<ActionReducer<RootState, Action>>(
    (inner, metaReducer) => metaReducer(inner),
    (state, action) => ({
      ...(state as RootState),
      [TASK_FEATURE_NAME]: taskReducer((state as RootState)[TASK_FEATURE_NAME], action),
      [PROJECT_FEATURE_NAME]: projectReducer(
        (state as RootState)[PROJECT_FEATURE_NAME],
        action,
      ),
      [TAG_FEATURE_NAME]: tagReducer((state as RootState)[TAG_FEATURE_NAME], action),
    }),
  );

  const replayBatch = (
    state: RootState,
    ops: Operation[],
  ): { state: RootState; failures: BulkReplayReducerFailure[] } => {
    const failures: BulkReplayReducerFailure[] = [];
    const nextState = runWithBulkReplayFailureCollector(
      (failure) => failures.push(failure),
      () => replayReducer(state, bulkApplyOperations({ operations: ops })),
    );
    return { state: nextState, failures };
  };

  // `doneIds` held active + done in project1, as a device that never saw the
  // archive has them.
  const doneState = (doneIds: string[]): RootState => {
    const base = createStateWithExistingTasks(doneIds);
    return {
      ...base,
      [TASK_FEATURE_NAME]: {
        ...base[TASK_FEATURE_NAME],
        entities: Object.fromEntries(
          doneIds.map((id) => [
            id,
            { ...base[TASK_FEATURE_NAME].entities[id]!, isDone: true, doneOn: 1_000 },
          ]),
        ),
      },
      [SECTION_FEATURE_NAME]: { ids: [], entities: {} },
    } as RootState;
  };

  // Either another device that never saw the archive replaying our uploads,
  // or this device restarting (hydration replays the whole log status-blind).
  const replayWithRealReducers = (
    doneIds: string[],
    ops: Operation[],
  ): { state: RootState; failures: BulkReplayReducerFailure[] } =>
    replayBatch(doneState(doneIds), ops);

  const replayOpByOp = (
    state: RootState,
    ops: Operation[],
  ): { state: RootState; failures: BulkReplayReducerFailure[] } =>
    ops.reduce(
      (acc, op) => {
        const next = replayBatch(acc.state, [op]);
        return { state: next.state, failures: [...acc.failures, ...next.failures] };
      },
      { state, failures: [] as BulkReplayReducerFailure[] },
    );

  // Boots the REAL hydrator on the on-disk log: snapshot load, the
  // status-blind tail read, tail migration and the bulk dispatch. Only the
  // NgRx store (a state holder over `replayReducer`) and services outside
  // that path are stubbed.
  const bootRealHydrator = async (
    snapshotState: RootState,
    lastAppliedOpSeq: number,
  ): Promise<RootState | undefined> => {
    await opLogStore.saveStateCache({
      state: snapshotState,
      lastAppliedOpSeq,
      vectorClock: {},
      compactedAt: Date.now(),
      schemaVersion: CURRENT_SCHEMA_VERSION,
    });
    let state: RootState | undefined;
    const hydrationStore = {
      dispatch: (action: Action): void => {
        if (action.type === loadAllData.type) {
          state = (action as ReturnType<typeof loadAllData>)
            .appDataComplete as unknown as RootState;
        } else if (action.type === bulkApplyOperations.type) {
          state = replayReducer(state, action);
        } else {
          throw new Error(`Unexpected hydration dispatch: ${action.type}`);
        }
      },
    };
    const recovery = jasmine.createSpyObj<OperationLogRecoveryService>(
      'OperationLogRecoveryService',
      ['recoverPendingRemoteOps', 'cleanupCorruptOps', 'attemptRecovery'],
    );
    recovery.recoverPendingRemoteOps.and.callFake(() => opLogStore.getPendingRemoteOps());
    recovery.cleanupCorruptOps.and.resolveTo();
    recovery.attemptRecovery.and.resolveTo();
    const injector = Injector.create({
      parent: TestBed.inject(Injector),
      providers: [
        { provide: Store, useValue: hydrationStore },
        { provide: OperationLogRecoveryService, useValue: recovery },
        {
          provide: OperationLogMigrationService,
          useValue: { checkAndMigrate: () => Promise.resolve() },
        },
        {
          provide: OperationLogSnapshotService,
          useValue: {
            isValidSnapshot: () => true,
            saveCurrentStateAsSnapshot: () => Promise.resolve(false),
          },
        },
        {
          provide: OperationLogCompactionService,
          useValue: { compactIfBloated: () => Promise.resolve() },
        },
        {
          provide: ValidateStateService,
          useValue: {
            validateState: () => Promise.resolve({ isValid: true, typiaErrors: [] }),
          },
        },
        { provide: SyncHydrationService, useValue: {} },
        {
          provide: ArchiveMigrationService,
          useValue: { migrateArchivesIfNeeded: () => Promise.resolve() },
        },
        { provide: StateSnapshotService, useValue: { getStateSnapshot: () => state } },
        {
          provide: HydrationStateService,
          useValue: {
            startApplyingRemoteOps: () => {},
            endApplyingRemoteOps: () => {},
            setHydrationInProgress: () => {},
            setHydrationFallbackActive: () => {},
          },
        },
      ],
    });
    await runInInjectionContext(
      injector,
      () => new OperationLogHydratorService(),
    ).hydrateStore();
    // Recovery means the replay threw (e.g. a local op's reducer failed).
    expect(recovery.attemptRecovery).not.toHaveBeenCalled();
    return state;
  };

  // Reducers stamp `modified` with the wall clock, which differs per replay.
  const withoutModified = (state: RootState): RootState[typeof TASK_FEATURE_NAME] => {
    const taskState = state[TASK_FEATURE_NAME];
    return {
      ...taskState,
      entities: Object.fromEntries(
        Object.entries(taskState.entities).map(([id, task]) => [
          id,
          task && { ...task, modified: undefined },
        ]),
      ),
    };
  };

  // Restart: hydration replays the whole log status-blind, rejected entries
  // included, in seq order (operation-log-hydrator `_replayTailOps`). A
  // snapshot can sit at any seq and holds whatever the device applied up to
  // there — one batch (an earlier hydration) or op by op (live local
  // dispatches) — so every split must end in the same state once the tail
  // replays as one batch, through the simulated replay and the real hydrator.
  const expectRestartKeeps = async (
    doneIds: string[],
    expected: { ids: string[]; id: string; title: string },
  ): Promise<void> => {
    const entries = await opLogStore.getOpsAfterSeq(0);
    const log = entries.map(({ op }) => op);
    for (let snapshotAt = 0; snapshotAt < log.length; snapshotAt++) {
      const prefix = log.slice(0, snapshotAt);
      for (const [kind, snapshot] of [
        ['batch', replayWithRealReducers(doneIds, prefix)],
        ['op-by-op', replayOpByOp(doneState(doneIds), prefix)],
      ] as const) {
        const context = `${kind} snapshot after ${snapshotAt} ops`;
        const { state, failures } = replayBatch(snapshot.state, log.slice(snapshotAt));
        expect([...snapshot.failures, ...failures])
          .withContext(context)
          .toEqual([]);
        expect(state[TASK_FEATURE_NAME].ids).withContext(context).toEqual(expected.ids);
        expect(state[TASK_FEATURE_NAME].entities[expected.id])
          .withContext(context)
          .toEqual(jasmine.objectContaining({ isDone: false, title: expected.title }));

        const hydrated = await bootRealHydrator(
          snapshot.state,
          snapshotAt === 0 ? 0 : entries[snapshotAt - 1].seq,
        );
        const hydratedContext = `${context}, real hydrator`;
        expect(hydrated?.[TASK_FEATURE_NAME].ids)
          .withContext(hydratedContext)
          .toEqual(expected.ids);
        expect(hydrated?.[TASK_FEATURE_NAME].entities[expected.id])
          .withContext(hydratedContext)
          .toEqual(jasmine.objectContaining({ isDone: false, title: expected.title }));
        expect(hydrated && withoutModified(hydrated))
          .withContext(hydratedContext)
          .toEqual(withoutModified(state));
      }
    }
  };

  it('re-scopes a losing bulk archive to the tasks the remote archive did not cover (finish-day race)', async () => {
    // LOCAL: the Mac's "Finish day" archives 4 done tasks in one atomic op.
    // Task C carries a subtask to pin that nested subtasks survive scoping.
    const subTaskC: Task = {
      ...DEFAULT_TASK,
      id: 'task-c-sub-1',
      title: 'Subtask of C',
      projectId: 'project1',
      parentId: TASK_C,
      isDone: true,
    };
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [
          doneTask(TASK_A),
          doneTask(TASK_B),
          doneTask(TASK_C, [subTaskC]),
          doneTask(TASK_D),
        ],
      }) as PersistentAction,
    );
    expect(bulkOp.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    // The footprint declares the subtask the archive cascades to, parents first.
    expect(bulkOp.entityIds).toEqual([TASK_A, TASK_B, TASK_C, TASK_D, 'task-c-sub-1']);

    // REMOTE: the other device archived one of the SAME tasks concurrently.
    const remoteOp = buildRemoteArchiveOp(remoteClient(), [TASK_A], bulkOp.timestamp + 1);
    const conflicts = await detectConflictsFor(remoteOp);

    await resolver.autoResolveConflictsLWW(conflicts);

    // The atomic bulk row is rejected; ONE scoped replacement re-uploads the
    // archive intent for the tasks the remote archive did not cover.
    const pending = await unsyncedOps();
    expect(pending.length).toBe(1);
    const replacement = pending[0];
    expect(replacement.id).not.toBe(bulkOp.id);
    expect(replacement.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    expect(replacement.entityId).toBe(TASK_B);
    // Re-derived from the scoped tasks, so C's subtask rides along with C.
    expect(replacement.entityIds).toEqual([TASK_B, TASK_C, TASK_D, 'task-c-sub-1']);
    expect(payloadTaskIds(replacement)).toEqual([TASK_B, TASK_C, TASK_D]);
    const retainedC = (
      replacement.payload as { actionPayload: { tasks: TaskWithSubTasks[] } }
    ).actionPayload.tasks.find(({ id }) => id === TASK_C);
    expect(retainedC!.subTasks).toEqual([subTaskC]);
    expect(replacement.timestamp).toBe(bulkOp.timestamp);
    expectDominates(replacement, bulkOp);
    expectDominates(replacement, remoteOp);
    // A plain clock merge would already dominate both concurrent originals —
    // pin the increment, which is what protects against third parties.
    expect(replacement.vectorClock[LOCAL_CLIENT_ID]).toBe(
      (bulkOp.vectorClock[LOCAL_CLIENT_ID] ?? 0) + 1,
    );

    // The remote archive is applied (its snapshot wins for the shared task);
    // the replacement is upload-only — local state already reflects it.
    expect(operationApplier.applyOperations).toHaveBeenCalled();
    const appliedIds = appliedOps().map(({ id }) => id);
    expect(appliedIds).toContain(remoteOp.id);
    expect(appliedIds).not.toContain(replacement.id);
  });

  it('rejects the bulk archive outright when the remote archive covers every task', async () => {
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B)],
      }) as PersistentAction,
    );

    const remoteOp = buildRemoteArchiveOp(
      remoteClient(),
      [TASK_A, TASK_B],
      bulkOp.timestamp + 1,
    );
    const conflicts = await detectConflictsFor(remoteOp);
    expect(conflicts.length).toBe(2);

    await resolver.autoResolveConflictsLWW(conflicts);

    // Both sides archived both tasks — plain rejection converges with no
    // replacement op left behind.
    expect(await unsyncedOps()).toEqual([]);
    expect(appliedOps().map(({ id }) => id)).toContain(remoteOp.id);
  });

  it('swaps the archive-win recreation for the scoped op when winners are mixed', async () => {
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B)],
      }) as PersistentAction,
    );

    // Remote archived task A (remote archive wins A) AND edited task B (the
    // local archive wins B via archive precedence).
    const client = remoteClient();
    const remoteArchiveOp = buildRemoteArchiveOp(client, [TASK_A], bulkOp.timestamp + 1);
    const remoteEditOp = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 2);
    const conflicts = [
      ...(await detectConflictsFor(remoteArchiveOp)),
      ...(await detectConflictsFor(remoteEditOp)),
    ];

    await resolver.autoResolveConflictsLWW(conflicts);

    // Exactly ONE replacement, scoped to task B: the archive-win recreation
    // must not re-assert task A's stale local snapshot over the remote archive.
    const pending = await unsyncedOps();
    expect(pending.length).toBe(1);
    const replacement = pending[0];
    expect(replacement.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    expect(replacement.entityIds).toEqual([TASK_B]);
    expect(payloadTaskIds(replacement)).toEqual([TASK_B]);
    expectDominates(replacement, bulkOp);
    expectDominates(replacement, remoteArchiveOp);
    expectDominates(replacement, remoteEditOp);

    // The remote archive is applied; the losing remote edit and the
    // upload-only replacement are not.
    const appliedIds = appliedOps().map(({ id }) => id);
    expect(appliedIds).toContain(remoteArchiveOp.id);
    expect(appliedIds).not.toContain(remoteEditOp.id);
    expect(appliedIds).not.toContain(replacement.id);
  });

  it('resolves a winning bulk archive that shares an entity with a decomposable bulk op', async () => {
    // #9537 (second shape): "Finish day" rounds time spent (bulk) and then
    // archives (bulk) — both ops touch task A. The old preflight required
    // EVERY local multi-entity op to be a moveToArchive for the archive-win
    // excusal, so the excused-but-present rounding op wedged sync anyway.
    store.dispatch(
      roundTimeSpentForDay({
        day: '2026-08-13',
        taskIds: [TASK_A, SIBLING_X],
        roundTo: '5M',
        isRoundUp: true,
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B)],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    const [roundOp, bulkOp] = await unsyncedOps();
    expect(roundOp.actionType).toBe(ActionType.TASK_ROUND_TIME_SPENT);
    expect(bulkOp.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);

    const remoteEditOp = buildRemoteTaskEdit(
      remoteClient(),
      TASK_A,
      bulkOp.timestamp + 1,
    );
    const conflicts = await detectConflictsFor(remoteEditOp);

    await resolver.autoResolveConflictsLWW(conflicts);

    // The archive wins task A (archive precedence) and is re-created for the
    // full set; the rounding op's sibling is preserved as a field patch.
    const pending = await unsyncedOps();
    const recreation = pending.find(
      (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    );
    expect(recreation).toBeDefined();
    expect(recreation!.id).not.toBe(bulkOp.id);
    expect(recreation!.entityIds).toEqual([TASK_A, TASK_B]);
    const siblingPatch = pending.find((op) => op.entityId === SIBLING_X);
    expect(siblingPatch).toBeDefined();

    // The losing remote edit is rejected, not applied.
    expect(appliedOps().map(({ id }) => id)).not.toContain(remoteEditOp.id);
  });

  it('drops a retained task from the replacement when it was restored from archive meanwhile', async () => {
    // Between the bulk archive and the resolving sync, the user restored B —
    // B is back in the ACTIVE store and a restoreTask op is pending. The
    // replacement must not re-assert B's stale archival with a dominating
    // clock, or the restore would be silently overridden fleet-wide.
    const restoredB = doneTask(TASK_B);
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), restoredB, doneTask(TASK_C)],
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.restoreTask({
        task: restoredB,
        subTasks: [],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    taskStateById[TASK_B] = restoredB;

    const remoteOp = buildRemoteArchiveOp(remoteClient(), [TASK_A], bulkOp.timestamp + 1);
    const conflicts = await detectConflictsFor(remoteOp);

    await resolver.autoResolveConflictsLWW(conflicts);

    const pending = await unsyncedOps();
    const replacement = pending.find(
      (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    );
    expect(replacement).toBeDefined();
    expect(replacement!.entityIds).toEqual([TASK_C]);
    expect(payloadTaskIds(replacement!)).toEqual([TASK_C]);
    // The restore op itself stays pending and uploads normally.
    const restoreOp = pending.find(
      (op) => op.actionType === ActionType.TASK_SHARED_RESTORE,
    );
    expect(restoreOp).toBeDefined();
    // Other devices never saw the archive and ignore a restore of an active
    // task, so B's current state follows the restore (#10220).
    const restoredState = pending.find(
      (op) => op.entityId === TASK_B && op !== restoreOp && op !== replacement,
    );
    expect(restoredState).toBeDefined();
    expectDominates(restoredState!, restoreOp!);
    expect(pending.length).toBe(3);
  });

  it('re-asserts a restored task via a current-state op when its own row is conflicted', async () => {
    // The restored task B here has its OWN conflict row (a concurrent remote
    // edit), so row rejection discards the pending restoreTask op along with
    // the bulk archive. The resolution must emit a current-state compensation
    // for B — with neither a replacement archive nor a compensation, the
    // restore would silently never reach other devices.
    const restoredB: Task = {
      ...doneTask(TASK_B),
      title: 'Restored B current title',
      isDone: false,
    };
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B)],
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.restoreTask({
        task: restoredB,
        subTasks: [],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    taskStateById[TASK_B] = restoredB;

    const client = remoteClient();
    const remoteArchiveOp = buildRemoteArchiveOp(client, [TASK_A], bulkOp.timestamp + 1);
    const remoteEditOp = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 2);
    const conflicts = [
      ...(await detectConflictsFor(remoteArchiveOp)),
      ...(await detectConflictsFor(remoteEditOp)),
    ];

    await resolver.autoResolveConflictsLWW(conflicts);

    const pending = await unsyncedOps();
    // No archive op survives (A remote-archived, B restored)...
    expect(
      pending.some((op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE),
    ).toBe(false);
    // ...but B's restored state is re-asserted by a compensation op.
    const compensation = pending.find((op) => op.entityId === TASK_B);
    expect(compensation).toBeDefined();
    const compensationPayload = compensation!.payload as {
      actionPayload?: { title?: string };
    };
    expect(compensationPayload.actionPayload?.title).toBe('Restored B current title');
    expectDominates(compensation!, remoteEditOp);
    expectDominates(compensation!, bulkOp);

    const appliedIds = appliedOps().map(({ id }) => id);
    expect(appliedIds).toContain(remoteArchiveOp.id);
    expect(appliedIds).not.toContain(remoteEditOp.id);
    await expectRestartKeeps([TASK_A, TASK_B], {
      ids: [TASK_B],
      id: TASK_B,
      title: 'Restored B current title',
    });
  });

  it('compensates a restored task instead of wedging when a remote BULK delete shares its row', async () => {
    // Same restored-task shape, but the remote loser on B is a MULTI-entity
    // deleteTasks op: with a bare undefined localWinOp the mixed-winner
    // machinery would throw 'Cannot safely compensate mixed multi-entity
    // winners' and wedge sync — the current-state compensation keeps the row
    // coverable and the uncontested sibling delete applies.
    const restoredB: Task = {
      ...doneTask(TASK_B),
      title: 'Restored B survives delete',
      isDone: false,
    };
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B)],
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.restoreTask({
        task: restoredB,
        subTasks: [],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    taskStateById[TASK_B] = restoredB;

    const client = remoteClient();
    const remoteArchiveOp = buildRemoteArchiveOp(client, [TASK_A], bulkOp.timestamp + 1);
    const remoteDeleteAction = TaskSharedActions.deleteTasks({
      taskIds: [TASK_B, 'task-remote-only'],
    }) as PersistentAction;
    const { type, meta, ...actionPayload } = remoteDeleteAction;
    const remoteDeleteOp: Operation = {
      ...client.createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: TASK_B,
        entityIds: [TASK_B, 'task-remote-only'],
        payload: { actionPayload, entityChanges: [] },
      }),
      timestamp: bulkOp.timestamp + 2,
    };
    const conflicts = [
      ...(await detectConflictsFor(remoteArchiveOp)),
      ...(await detectConflictsFor(remoteDeleteOp)),
    ];

    await resolver.autoResolveConflictsLWW(conflicts);

    const pending = await unsyncedOps();
    expect(
      pending.some((op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE),
    ).toBe(false);
    const compensation = pending.find((op) => op.entityId === TASK_B);
    expect(compensation).toBeDefined();
    expectDominates(compensation!, remoteDeleteOp);

    // The remote bulk delete applies (its uncontested sibling wins), followed
    // by B's compensation in the same batch.
    const appliedIds = appliedOps().map(({ id }) => id);
    expect(appliedIds).toContain(remoteDeleteOp.id);
    expect(appliedIds).toContain(compensation!.id);
    await expectRestartKeeps([TASK_A, TASK_B], {
      ids: [TASK_B],
      id: TASK_B,
      title: 'Restored B survives delete',
    });
  });

  it('splits one group between a scoped replacement and a restore compensation', async () => {
    // One group containing BOTH kinds of local-win rows: C stays archived
    // (its row takes the scoped replacement), B was restored (its row takes
    // the current-state compensation). Pins the branch condition itself — an
    // inverted check would hand B's row the C-scoped replacement and leave
    // C's row without any local-win op, silently losing the restore.
    const restoredB: Task = {
      ...doneTask(TASK_B),
      title: 'Restored B stays',
      isDone: false,
    };
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.restoreTask({
        task: restoredB,
        subTasks: [],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    taskStateById[TASK_B] = restoredB;

    const client = remoteClient();
    const remoteArchiveOp = buildRemoteArchiveOp(client, [TASK_A], bulkOp.timestamp + 1);
    const remoteEditB = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 2);
    const remoteEditC = buildRemoteTaskEdit(client, TASK_C, bulkOp.timestamp + 3);
    const conflicts = [
      ...(await detectConflictsFor(remoteArchiveOp)),
      ...(await detectConflictsFor(remoteEditB)),
      ...(await detectConflictsFor(remoteEditC)),
    ];

    await resolver.autoResolveConflictsLWW(conflicts);

    const pending = await unsyncedOps();
    const replacement = pending.find(
      (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    );
    expect(replacement).toBeDefined();
    expect(replacement!.entityIds).toEqual([TASK_C]);
    expect(payloadTaskIds(replacement!)).toEqual([TASK_C]);
    const compensation = pending.find(
      (op) =>
        op.entityId === TASK_B &&
        op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
    );
    expect(compensation).toBeDefined();
    expect(
      (compensation!.payload as { actionPayload?: { title?: string } }).actionPayload
        ?.title,
    ).toBe('Restored B stays');
    expect(pending.length).toBe(2);
    expectDominates(replacement!, bulkOp);
    expectDominates(compensation!, remoteEditB);
  });

  it('accumulates remote-archived tasks across archive ops from several clients', async () => {
    // Three-device finish-day race: client B archived A, client C archived B,
    // the local bulk covered A, B and C — ONE replacement scoped to C, with a
    // clock dominating every involved row.
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
      }) as PersistentAction,
    );
    const remoteArchiveA = buildRemoteArchiveOp(
      new TestClient('remote-client-b'),
      [TASK_A],
      bulkOp.timestamp + 1,
    );
    const remoteArchiveB = buildRemoteArchiveOp(
      new TestClient('remote-client-c'),
      [TASK_B],
      bulkOp.timestamp + 2,
    );
    const conflicts = [
      ...(await detectConflictsFor(remoteArchiveA)),
      ...(await detectConflictsFor(remoteArchiveB)),
    ];

    await resolver.autoResolveConflictsLWW(conflicts);

    const pending = await unsyncedOps();
    expect(pending.length).toBe(1);
    const replacement = pending[0];
    expect(replacement.entityIds).toEqual([TASK_C]);
    expect(payloadTaskIds(replacement)).toEqual([TASK_C]);
    expectDominates(replacement, bulkOp);
    expectDominates(replacement, remoteArchiveA);
    expectDominates(replacement, remoteArchiveB);
    const appliedIds = appliedOps().map(({ id }) => id);
    expect(appliedIds).toContain(remoteArchiveA.id);
    expect(appliedIds).toContain(remoteArchiveB.id);
  });

  it('emits ONE replacement when several archive-win rows share the same bulk op', async () => {
    // Remote archived A; two SEPARATE remote edits hit B and C — two
    // archive-win rows for the same bulk op. Both rows must end up pointing at
    // the SAME scoped replacement (deduped by id), never one op per row.
    const [bulkOp] = await dispatchAndFlush(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
      }) as PersistentAction,
    );
    const client = remoteClient();
    const remoteArchiveOp = buildRemoteArchiveOp(client, [TASK_A], bulkOp.timestamp + 1);
    const remoteEditB = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 2);
    const remoteEditC = buildRemoteTaskEdit(client, TASK_C, bulkOp.timestamp + 3);
    const conflicts = [
      ...(await detectConflictsFor(remoteArchiveOp)),
      ...(await detectConflictsFor(remoteEditB)),
      ...(await detectConflictsFor(remoteEditC)),
    ];

    await resolver.autoResolveConflictsLWW(conflicts);

    const pending = await unsyncedOps();
    expect(pending.length).toBe(1);
    expect(pending[0].entityIds).toEqual([TASK_B, TASK_C]);
    expect(payloadTaskIds(pending[0])).toEqual([TASK_B, TASK_C]);
  });

  it('fails closed when two pending bulk archives share a conflicted task', async () => {
    // Archive → restore → re-archive without a sync in between leaves TWO
    // pending bulk archives containing the same task. Per-op scoped
    // replacement cannot express a coherent cross-op supersession order here,
    // so the preflight must keep the safe stop instead of silently dropping
    // one op's uniquely-retained tasks.
    store.dispatch(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_D)],
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_C)],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    const [bulkOp1, bulkOp2] = await unsyncedOps();

    const remoteEditOp = buildRemoteTaskEdit(
      remoteClient(),
      TASK_A,
      bulkOp1.timestamp + 1,
    );
    const conflicts = await detectConflictsFor(remoteEditOp);

    let thrown: unknown;
    try {
      await resolver.autoResolveConflictsLWW(conflicts);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
    expect((thrown as Error).message).toBe(
      'SYNC_MULTI_ENTITY_UNSUPPORTED side=local ' +
        `actionType=${ActionType.TASK_SHARED_MOVE_TO_ARCHIVE} entityCount=3`,
    );
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
    // Fail-closed means pre-mutation: both bulk rows stay pending untouched.
    expect((await unsyncedOps()).map(({ id }) => id)).toEqual([bulkOp1.id, bulkOp2.id]);
  });

  it('fails closed when a bulk archive overlaps a pending bulk delete', async () => {
    // A bulk archive and a bulk delete both covering task A re-assert
    // contradictory whole-entity intents for A if scoped independently — keep
    // the safe stop (pre-fix parity: this shape always wedged).
    store.dispatch(
      TaskSharedActions.moveToArchive({
        tasks: [doneTask(TASK_A), doneTask(TASK_B)],
      }) as PersistentAction,
    );
    store.dispatch(
      TaskSharedActions.deleteTasks({
        taskIds: [TASK_A, TASK_C],
      }) as PersistentAction,
    );
    await writeFlush.flushPendingWrites();
    const [bulkArchiveOp, bulkDeleteOp] = await unsyncedOps();

    const remoteEditOp = buildRemoteTaskEdit(
      remoteClient(),
      TASK_A,
      bulkArchiveOp.timestamp + 1,
    );
    const conflicts = await detectConflictsFor(remoteEditOp);

    let thrown: unknown;
    try {
      await resolver.autoResolveConflictsLWW(conflicts);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
    expect((thrown as Error).message).toBe(
      'SYNC_MULTI_ENTITY_UNSUPPORTED side=local ' +
        `actionType=${ActionType.TASK_SHARED_MOVE_TO_ARCHIVE} entityCount=2`,
    );
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
    // Fail-closed means pre-mutation: both bulk rows stay pending untouched.
    expect((await unsyncedOps()).map(({ id }) => id)).toEqual([
      bulkArchiveOp.id,
      bulkDeleteOp.id,
    ]);
  });
  describe('#10102 repro: all-local-win bulk archive', () => {
    it('emits ONE archive-win op when several rows of one bulk archive win locally', async () => {
      // Android "Finish day" archives A, B, C; the PC concurrently edited B
      // and C (no remote archive). Every row wins locally via archive
      // precedence, so no scoped replacement runs.
      const [bulkOp] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        }) as PersistentAction,
      );
      const client = remoteClient();
      const remoteEditB = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 1);
      const remoteEditC = buildRemoteTaskEdit(client, TASK_C, bulkOp.timestamp + 2);
      const conflicts = [
        ...(await detectConflictsFor(remoteEditB)),
        ...(await detectConflictsFor(remoteEditC)),
      ];
      expect(conflicts.length).toBe(2);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      // The ONE recreation keeps the full set and dominates every won row.
      const [recreation] = pending;
      expect(recreation.id).not.toBe(bulkOp.id);
      expect(payloadTaskIds(recreation)).toEqual([TASK_A, TASK_B, TASK_C]);
      expect(recreation.timestamp).toBe(bulkOp.timestamp);
      expectDominates(recreation, bulkOp);
      expectDominates(recreation, remoteEditB);
      expectDominates(recreation, remoteEditC);
    });

    it('does not wedge the NEXT sync when the archive-win ops are still pending', async () => {
      const [bulkOp] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        }) as PersistentAction,
      );
      const client = remoteClient();
      const remoteEditB = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 1);
      const remoteEditC = buildRemoteTaskEdit(client, TASK_C, bulkOp.timestamp + 2);
      await resolver.autoResolveConflictsLWW([
        ...(await detectConflictsFor(remoteEditB)),
        ...(await detectConflictsFor(remoteEditC)),
      ]);

      // Upload did not happen (interrupted / next download first); the PC
      // edits A concurrently with the archive-win ops.
      const laterEdit = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 3);

      const conflicts = await detectConflictsFor(laterEdit);

      let thrown: unknown;
      try {
        await resolver.autoResolveConflictsLWW(conflicts);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeUndefined();
      expect((await unsyncedOps()).length).toBe(1);
    });

    it('emits one archive-win op PER intent when two bulk archives win in one batch', async () => {
      const [archiveAB] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B)],
        }) as PersistentAction,
      );
      const [, archiveCD] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_C), doneTask(TASK_D)],
        }) as PersistentAction,
      );
      const client = remoteClient();
      const remoteEdits = [TASK_A, TASK_B, TASK_C, TASK_D].map((id, i) =>
        buildRemoteTaskEdit(client, id, archiveCD.timestamp + i + 1),
      );
      const conflicts = (
        await Promise.all(remoteEdits.map((edit) => detectConflictsFor(edit)))
      ).flat();
      expect(conflicts.length).toBe(4);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      expect(pending.map(payloadTaskIds)).toEqual([
        [TASK_A, TASK_B],
        [TASK_C, TASK_D],
      ]);
      const [recreationAB, recreationCD] = pending;
      expect(recreationAB.timestamp).toBe(archiveAB.timestamp);
      expect(recreationCD.timestamp).toBe(archiveCD.timestamp);
      expectDominates(recreationAB, archiveAB);
      expectDominates(recreationCD, archiveCD);
      remoteEdits.slice(0, 2).forEach((edit) => expectDominates(recreationAB, edit));
      remoteEdits.slice(2).forEach((edit) => expectDominates(recreationCD, edit));
    });

    it('compensates a remote multi-entity op ONCE with the shared archive-win op', async () => {
      // A remote bulk op hits two archived tasks (both win locally, sharing
      // one recreation) plus an uncontested sibling, so the remote op applies
      // and the shared recreation replays after it as the compensation.
      const [bulkOp] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        }) as PersistentAction,
      );
      const taskIds = [TASK_B, TASK_C, SIBLING_X];
      const remoteAction = roundTimeSpentForDay({
        day: '2026-08-13',
        taskIds,
        roundTo: '5M',
        isRoundUp: true,
      }) as PersistentAction;
      const { type, meta, ...actionPayload } = remoteAction;
      const remoteBulkOp: Operation = {
        ...remoteClient().createOperation({
          actionType: type,
          opType: meta.opType,
          entityType: meta.entityType,
          entityId: TASK_B,
          entityIds: taskIds,
          payload: { actionPayload, entityChanges: [] },
        }),
        timestamp: bulkOp.timestamp + 1,
      };
      const conflicts = await detectConflictsFor(remoteBulkOp);
      expect(conflicts.map(({ entityId }) => entityId).sort()).toEqual([TASK_B, TASK_C]);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      const [recreation] = pending;
      expect(payloadTaskIds(recreation)).toEqual([TASK_A, TASK_B, TASK_C]);
      expectDominates(recreation, remoteBulkOp);
      const appliedIds = appliedOps().map(({ id }) => id);
      expect(appliedIds.filter((id) => id === remoteBulkOp.id).length).toBe(1);
      expect(appliedIds.filter((id) => id === recreation.id).length).toBe(1);
      expect(appliedIds.indexOf(recreation.id)).toBeGreaterThan(
        appliedIds.indexOf(remoteBulkOp.id),
      );
    });
  });

  describe('#10220: restore after an all-local-win bulk archive', () => {
    // Finish Day archived the tasks, the user restored some of them before the
    // archive uploaded, and remote edits make every row win locally. The
    // full-set archive-win recreation must not re-archive the restored tasks.
    const restoredTitle = (id: string): string => `Restored ${id}`;

    const archiveThenRestore = async (
      tasks: TaskWithSubTasks[],
      restoredIds: string[],
    ): Promise<Operation> => {
      const [bulkOp] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({ tasks }) as PersistentAction,
      );
      for (const id of restoredIds) {
        const task: Task = { ...doneTask(id), title: restoredTitle(id), isDone: false };
        store.dispatch(
          TaskSharedActions.restoreTask({ task, subTasks: [] }) as PersistentAction,
        );
        taskStateById[id] = task;
      }
      await writeFlush.flushPendingWrites();
      return bulkOp;
    };

    const archivedIds = (ops: Operation[]): string[] =>
      ops
        .filter((op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE)
        .flatMap((op) => [...(op.entityIds ?? []), ...payloadTaskIds(op)]);

    const compensationFor = (ops: Operation[], id: string): Operation | undefined =>
      ops.find(
        (op) =>
          op.entityId === id &&
          op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE &&
          op.actionType !== ActionType.TASK_SHARED_RESTORE,
      );

    const titleOf = (op: Operation): string | undefined =>
      (op.payload as { actionPayload?: { title?: string } }).actionPayload?.title;

    // A task without its own row keeps its pending restoreTask, which other
    // devices (A still active + done there) ignore — the restored state must
    // follow it as a current-state update dominating the restore.
    const expectRowlessRestoreReasserted = (ops: Operation[], id: string): void => {
      const restoreOp = ops.find(
        (op) => op.actionType === ActionType.TASK_SHARED_RESTORE && op.entityId === id,
      );
      const update = compensationFor(ops, id);
      expect(restoreOp).toBeDefined();
      expect(update).toBeDefined();
      expect(
        (update!.payload as { actionPayload?: { isDone?: boolean } }).actionPayload
          ?.isDone,
      ).toBe(false);
      expect(titleOf(update!)).toBe(restoredTitle(id));
      expectDominates(update!, restoreOp!);
      expect(ops.indexOf(update!)).toBeGreaterThan(ops.indexOf(restoreOp!));
    };

    it('keeps a restore whose own row a remote edit conflicts with', async () => {
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      const remoteEditA = buildRemoteTaskEdit(
        remoteClient(),
        TASK_A,
        bulkOp.timestamp + 10,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditA));

      const pending = await unsyncedOps();
      const archive = pending.find(
        (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      expect(archive).toBeDefined();
      expect(archive!.entityIds).toEqual([TASK_B, TASK_C]);
      expect(payloadTaskIds(archive!)).toEqual([TASK_B, TASK_C]);
      expectDominates(archive!, bulkOp);
      expectDominates(archive!, remoteEditA);
      // The row rejection discarded the raw restoreTask op; the restored
      // current state is re-asserted over the concurrent remote edit instead
      // (same outcome as the mixed-winner path).
      const compensation = compensationFor(pending, TASK_A);
      expect(compensation).toBeDefined();
      expect(titleOf(compensation!)).toBe(restoredTitle(TASK_A));
      expectDominates(compensation!, remoteEditA);
      expect(pending.length).toBe(2);
      expect(appliedOps().map(({ id }) => id)).not.toContain(remoteEditA.id);
      await expectRestartKeeps([TASK_A, TASK_B, TASK_C], {
        ids: [TASK_A],
        id: TASK_A,
        title: restoredTitle(TASK_A),
      });
    });

    it('keeps a restore of a task with NO conflict row of its own', async () => {
      // A was restored, the remote edit hits B: A's restoreTask stays pending,
      // but a full-set recreation queued after it would re-archive A on every
      // other device (and here on status-blind replay).
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      const remoteEditB = buildRemoteTaskEdit(
        remoteClient(),
        TASK_B,
        bulkOp.timestamp + 10,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditB));

      const pending = await unsyncedOps();
      expect(archivedIds(pending)).not.toContain(TASK_A);
      const archive = pending.find(
        (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      expect(archive!.entityIds).toEqual([TASK_B, TASK_C]);
      expectDominates(archive!, remoteEditB);
      expectRowlessRestoreReasserted(pending, TASK_A);
      expect(pending.length).toBe(3);

      // The other device ignores the restoreTask (A is active there); the
      // update after it must still un-finish A while B and C archive.
      const { state, failures } = replayWithRealReducers(
        [TASK_A, TASK_B, TASK_C],
        pending,
      );
      expect(failures).toEqual([]);
      expect(state[TASK_FEATURE_NAME].ids).toEqual([TASK_A]);
      expect(state[PROJECT_FEATURE_NAME].entities['project1']!.taskIds).toEqual([TASK_A]);
      expect(state[TASK_FEATURE_NAME].entities[TASK_A]).toEqual(
        jasmine.objectContaining({ isDone: false, title: restoredTitle(TASK_A) }),
      );

      // Restart here: replaying every entry, rejected ones included, lands on
      // the same restored A.
      const restart = replayWithRealReducers([TASK_A, TASK_B, TASK_C], await fullLog());
      expect(restart.failures).toEqual([]);
      expect(restart.state[TASK_FEATURE_NAME].ids).toEqual([TASK_A]);
      expect(restart.state[TASK_FEATURE_NAME].entities[TASK_A]).toEqual(
        jasmine.objectContaining({ isDone: false, title: restoredTitle(TASK_A) }),
      );
    });

    it('resolves a LATER concurrent remote edit of a rowless-restored task by plain LWW', async () => {
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      const client = remoteClient();
      await resolver.autoResolveConflictsLWW(
        await detectConflictsFor(
          buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 10),
        ),
      );
      const update = compensationFor(await unsyncedOps(), TASK_A)!;

      // The remote device edits A (concurrently, later) before our update
      // reaches it: an ordinary single-entity LWW row, no archive precedence.
      const laterEditA = buildRemoteTaskEdit(client, TASK_A, update.timestamp + 60_000);
      await resolver.autoResolveConflictsLWW(await detectConflictsFor(laterEditA));

      const pending = await unsyncedOps();
      expect(archivedIds(pending)).toEqual([TASK_B, TASK_C, TASK_B, TASK_C]);
      expect(pending.some((op) => op.entityId === TASK_A)).toBe(false);
      expect(appliedOps().map(({ id }) => id)).toContain(laterEditA.id);
    });

    it('keeps a restore when a remote BULK delete hits it and an archived task', async () => {
      // Both rows win locally, but the remote deleteTasks also carries an
      // uncontested id: the mixed-winner compensation must find a covering
      // local-win op for BOTH rows (scoped archive for B, current-state
      // update for A) or it throws and wedges sync.
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      const remoteDeleteIds = [TASK_A, TASK_B, 'task-remote-only'];
      const remoteDeleteAction = TaskSharedActions.deleteTasks({
        taskIds: remoteDeleteIds,
      }) as PersistentAction;
      const { type, meta, ...actionPayload } = remoteDeleteAction;
      const remoteDeleteOp: Operation = {
        ...remoteClient().createOperation({
          actionType: type,
          opType: meta.opType,
          entityType: meta.entityType,
          entityId: TASK_A,
          entityIds: remoteDeleteIds,
          payload: { actionPayload, entityChanges: [] },
        }),
        timestamp: bulkOp.timestamp + 10,
      };

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteDeleteOp));

      const pending = await unsyncedOps();
      const archive = pending.find(
        (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      expect(archive!.entityIds).toEqual([TASK_B, TASK_C]);
      expectDominates(archive!, remoteDeleteOp);
      const compensation = compensationFor(pending, TASK_A);
      expect(titleOf(compensation!)).toBe(restoredTitle(TASK_A));
      expectDominates(compensation!, remoteDeleteOp);
      // The delete applies for its uncontested id; A's recreation replays
      // after it so the restore survives the delete's cascade.
      expect(
        (compensation!.payload as { recreatesEntityAfterDelete?: boolean })
          .recreatesEntityAfterDelete,
      ).toBe(true);
      const appliedIds = appliedOps().map(({ id }) => id);
      expect(appliedIds).toContain(remoteDeleteOp.id);
      expect(appliedIds.indexOf(compensation!.id)).toBeGreaterThan(
        appliedIds.indexOf(remoteDeleteOp.id),
      );
      expect(pending.length).toBe(2);

      // The deleting device already dropped A and B: A's recreation brings
      // the restored task back there, and C still archives.
      const { state, failures } = replayWithRealReducers([TASK_C], pending);
      expect(failures).toEqual([]);
      expect(state[TASK_FEATURE_NAME].ids).toEqual([TASK_A]);
      expect(state[PROJECT_FEATURE_NAME].entities['project1']!.taskIds).toEqual([TASK_A]);
      expect(state[TASK_FEATURE_NAME].entities[TASK_A]).toEqual(
        jasmine.objectContaining({ isDone: false, title: restoredTitle(TASK_A) }),
      );
      await expectRestartKeeps([TASK_A, TASK_B, TASK_C], {
        ids: [TASK_A],
        id: TASK_A,
        title: restoredTitle(TASK_A),
      });
    });

    it('re-asserts a restored task when two remote edits hit its row in one batch', async () => {
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      const client = remoteClient();
      const firstEdit = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 10);
      const secondEdit = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 20);

      await resolver.autoResolveConflictsLWW([
        ...(await detectConflictsFor(firstEdit)),
        ...(await detectConflictsFor(secondEdit)),
      ]);

      // One current-state update per row, like any plain local win over two
      // remote ops: every one carries the restore, and the last dominates both.
      const pending = await unsyncedOps();
      expect(archivedIds(pending)).toEqual([TASK_B, TASK_C, TASK_B, TASK_C]);
      const updates = pending.filter((op) => op.entityId === TASK_A);
      expect(updates.length).toBe(2);
      // ONE scoped archive for the intent, not one per conflicted row (#10102).
      expect(
        pending.filter((op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE)
          .length,
      ).toBe(1);
      updates.forEach((update) => expect(titleOf(update)).toBe(restoredTitle(TASK_A)));
      expectDominates(updates.at(-1)!, firstEdit);
      expectDominates(updates.at(-1)!, secondEdit);
    });

    describe('same-batch archive → restore replay', () => {
      const SUB = 'task-a-sub';
      const clock = { [REMOTE_CLIENT_ID]: 1 };
      const subTask: Task = { ...doneTask(SUB), parentId: TASK_A };

      // A (with subtask SUB) and B active + done, as before the archive.
      const initialState = (): RootState => {
        const base = doneState([TASK_A, TASK_B, SUB]);
        const entities = base[TASK_FEATURE_NAME].entities;
        return {
          ...base,
          [TASK_FEATURE_NAME]: {
            ...base[TASK_FEATURE_NAME],
            entities: {
              ...entities,
              [TASK_A]: { ...entities[TASK_A]!, subTaskIds: [SUB] },
              [SUB]: { ...entities[SUB]!, parentId: TASK_A },
            },
          },
        };
      };

      const opFor = (action: PersistentAction, timestamp: number): Operation => {
        const { type, meta, ...actionPayload } = action;
        return {
          ...remoteClient().createOperation({
            actionType: type,
            opType: meta.opType,
            entityType: meta.entityType,
            entityId: meta.entityId ?? meta.entityIds![0],
            entityIds: meta.entityIds,
            payload: { actionPayload, entityChanges: [] },
          }),
          timestamp,
        };
      };

      const archiveOp = (): Operation =>
        opFor(
          TaskSharedActions.moveToArchive({
            tasks: [doneTask(TASK_A, [subTask]), doneTask(TASK_B)],
          }) as PersistentAction,
          1_000,
        );
      const restoreOp = (): Operation =>
        opFor(
          TaskSharedActions.restoreTask({
            task: {
              ...doneTask(TASK_A),
              subTaskIds: [SUB],
              title: restoredTitle(TASK_A),
              isDone: false,
            },
            subTasks: [subTask],
          }) as PersistentAction,
          3_000,
        );
      const taskUpdateOp = (timestamp: number): Operation =>
        resolver.createLWWUpdateOp(
          'TASK',
          TASK_A,
          {
            ...doneTask(TASK_A),
            subTasks: undefined,
            subTaskIds: [SUB],
            title: 'LWW title',
          },
          REMOTE_CLIENT_ID,
          clock,
          timestamp,
        );
      const projectUpdateOp = (timestamp: number): Operation =>
        resolver.createLWWUpdateOp(
          'PROJECT',
          'project1',
          {
            ...initialState()[PROJECT_FEATURE_NAME].entities['project1'],
            taskIds: [TASK_A],
          },
          REMOTE_CLIENT_ID,
          clock,
          timestamp,
        );

      it('applies LWW Updates AFTER the restore exactly like op-by-op apply', () => {
        const initial = initialState();
        const ops = [
          archiveOp(),
          restoreOp(),
          taskUpdateOp(4_000),
          projectUpdateOp(4_500),
        ];

        // Reducers stamp `modified` from the wall clock; freeze it to compare.
        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(5_000));
        const batch = replayBatch(initial, ops);
        const opByOp = replayOpByOp(initial, ops);
        jasmine.clock().uninstall();

        expect(batch.failures).toEqual([]);
        expect(opByOp.failures).toEqual([]);
        expect(batch.state[TASK_FEATURE_NAME]).toEqual(opByOp.state[TASK_FEATURE_NAME]);
        expect(batch.state[PROJECT_FEATURE_NAME]).toEqual(
          opByOp.state[PROJECT_FEATURE_NAME],
        );
        expect(batch.state[TAG_FEATURE_NAME]).toEqual(opByOp.state[TAG_FEATURE_NAME]);
        expect(batch.state[TASK_FEATURE_NAME].entities[TASK_A]!.title).toBe('LWW title');
        expect(batch.state[PROJECT_FEATURE_NAME].entities['project1']!.taskIds).toEqual([
          TASK_A,
        ]);
      });

      it('still skips a stale LWW Update BETWEEN the archive and the restore', () => {
        // Un-skipping it would recreate A from the stale snapshot, turn the
        // restore into a no-op (A already active) and drop its subtask.
        const { state, failures } = replayBatch(initialState(), [
          archiveOp(),
          taskUpdateOp(2_000),
          restoreOp(),
        ]);

        expect(failures).toEqual([]);
        expect([...state[TASK_FEATURE_NAME].ids].sort()).toEqual([TASK_A, SUB].sort());
        expect(state[TASK_FEATURE_NAME].entities[TASK_A]).toEqual(
          jasmine.objectContaining({ title: restoredTitle(TASK_A), isDone: false }),
        );
        expect(state[TASK_FEATURE_NAME].entities[SUB]!.parentId).toBe(TASK_A);
      });

      it('keeps the winning update after a restore preceded by an ordinary update of the archived task', () => {
        // Rejected remote updates remain in the status-blind restart log.
        // Updating an absent task is a no-op, so it cannot make the restore
        // a duplicate or suppress the winning state following that restore.
        const ops = [
          archiveOp(),
          opFor(
            TaskSharedActions.updateTask({
              task: { id: TASK_A, changes: { title: 'Rejected edit' } },
            }) as PersistentAction,
            2_000,
          ),
          restoreOp(),
          taskUpdateOp(4_000),
        ];
        const batch = replayBatch(initialState(), ops);
        const opByOp = replayOpByOp(initialState(), ops);

        expect(batch.failures).toEqual([]);
        expect(opByOp.failures).toEqual([]);
        expect(opByOp.state[TASK_FEATURE_NAME].entities[TASK_A]!.title).toBe('LWW title');
        expect(batch.state[TASK_FEATURE_NAME].entities[TASK_A]!.title).toBe('LWW title');
        expect(batch.state[TASK_FEATURE_NAME].entities[SUB]!.parentId).toBe(TASK_A);
      });

      it('keeps a deleted child removed when a duplicate restore of its active parent precedes a stale update', () => {
        const deleteOp = opFor(
          TaskSharedActions.deleteTasks({ taskIds: [SUB] }) as PersistentAction,
          2_000,
        );
        const staleChildUpdate = resolver.createLWWUpdateOp(
          'TASK',
          SUB,
          subTask,
          REMOTE_CLIENT_ID,
          clock,
          4_000,
        );
        const { state, failures } = replayBatch(initialState(), [
          deleteOp,
          restoreOp(),
          staleChildUpdate,
        ]);

        expect(failures).toEqual([]);
        expect(state[TASK_FEATURE_NAME].ids).not.toContain(SUB);
        expect(state[TASK_FEATURE_NAME].entities[SUB]).toBeUndefined();
        expect(state[TASK_FEATURE_NAME].entities[TASK_A]!.subTaskIds).toEqual([]);
      });

      it('preserves an update between a successful restore and its duplicate', () => {
        const { state, failures } = replayBatch(initialState(), [
          archiveOp(),
          restoreOp(),
          taskUpdateOp(4_000),
          restoreOp(),
        ]);

        expect(failures).toEqual([]);
        expect(state[TASK_FEATURE_NAME].entities[TASK_A]!.title).toBe('LWW title');
        expect(state[TASK_FEATURE_NAME].entities[SUB]!.parentId).toBe(TASK_A);
      });

      // Outcome pin, not a guard for the batch strip: `lwwUpdateMetaReducer`'s
      // orphan filter also drops A there (A is absent until the restore).
      it('keeps the task in its project once when a PROJECT LWW Update sits BETWEEN the archive and the restore', () => {
        const { state, failures } = replayBatch(initialState(), [
          archiveOp(),
          projectUpdateOp(2_000),
          restoreOp(),
        ]);

        expect(failures).toEqual([]);
        // Only the restore puts A back — once, not also via the stale update.
        expect(state[PROJECT_FEATURE_NAME].entities['project1']!.taskIds).toEqual([
          TASK_A,
        ]);
      });

      it('matches op-by-op apply when the task is restored, edited, re-archived and restored again', () => {
        // Only the LAST restore index is kept, so the edit between the two
        // restores is skipped in the batch; the second restore replays A
        // from its own payload either way, so the outcome must not differ.
        const initial = initialState();
        const reArchiveOp = opFor(
          TaskSharedActions.moveToArchive({
            tasks: [{ ...doneTask(TASK_A, [subTask]), title: restoredTitle(TASK_A) }],
          }) as PersistentAction,
          5_000,
        );
        const ops = [
          archiveOp(),
          restoreOp(),
          taskUpdateOp(4_000),
          reArchiveOp,
          restoreOp(),
        ];

        jasmine.clock().install();
        jasmine.clock().mockDate(new Date(7_000));
        const batch = replayBatch(initial, ops);
        const opByOp = replayOpByOp(initial, ops);
        jasmine.clock().uninstall();

        expect(batch.failures).toEqual([]);
        expect(opByOp.failures).toEqual([]);
        expect(batch.state[TASK_FEATURE_NAME]).toEqual(opByOp.state[TASK_FEATURE_NAME]);
        expect(batch.state[PROJECT_FEATURE_NAME]).toEqual(
          opByOp.state[PROJECT_FEATURE_NAME],
        );
        expect(batch.state[TAG_FEATURE_NAME]).toEqual(opByOp.state[TAG_FEATURE_NAME]);
        expect([...batch.state[TASK_FEATURE_NAME].ids].sort()).toEqual(
          [TASK_A, SUB].sort(),
        );
      });

      it('skips LWW Updates again once a later archive re-archives the task', () => {
        const reArchiveOp = opFor(
          TaskSharedActions.moveToArchive({
            tasks: [{ ...doneTask(TASK_A, [subTask]), title: restoredTitle(TASK_A) }],
          }) as PersistentAction,
          4_000,
        );
        const { state, failures } = replayBatch(initialState(), [
          archiveOp(),
          restoreOp(),
          reArchiveOp,
          taskUpdateOp(5_000),
        ]);

        expect(failures).toEqual([]);
        expect(state[TASK_FEATURE_NAME].ids).toEqual([]);
      });
    });

    it('re-asserts a restore that already uploaded while the archive was rejected', async () => {
      // Upload race: the server accepted A's restoreTask but rejected the bulk
      // archive (concurrent with the edit on B), so only the archive is still
      // pending for A. Built from pending ops alone, the update's clock would
      // EQUAL the synced restore's: the server accepts that as a same-client
      // retry and receivers skip it as a duplicate. The durable append rebases
      // it onto this client's clock, which already covers the restore.
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      const restoreEntry = (await opLogStore.getUnsynced()).find(
        ({ op }) => op.actionType === ActionType.TASK_SHARED_RESTORE,
      )!;
      await opLogStore.markSynced([restoreEntry.seq]);
      const remoteEditB = buildRemoteTaskEdit(
        remoteClient(),
        TASK_B,
        bulkOp.timestamp + 10,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditB));

      const pending = await unsyncedOps();
      expect(archivedIds(pending)).not.toContain(TASK_A);
      const update = compensationFor(pending, TASK_A);
      expect(update).toBeDefined();
      expectDominates(update!, restoreEntry.op);
      // A receiver that applied the uploaded restore must not drop the update.
      const receiverView = await resolver.checkOpForConflicts(update!, {
        localPendingOpsByEntity: new Map(),
        appliedFrontierByEntity: new Map([
          [toEntityKey('TASK', TASK_A), restoreEntry.op.vectorClock],
        ]),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      });
      expect(receiverView.isSupersededOrDuplicate).toBe(false);
    });

    it('keeps several restores across conflicted and unconflicted rows', async () => {
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C), doneTask(TASK_D)],
        [TASK_A, TASK_B],
      );
      const client = remoteClient();
      const remoteEditA = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 10);
      const remoteEditC = buildRemoteTaskEdit(client, TASK_C, bulkOp.timestamp + 11);

      await resolver.autoResolveConflictsLWW([
        ...(await detectConflictsFor(remoteEditA)),
        ...(await detectConflictsFor(remoteEditC)),
      ]);

      const pending = await unsyncedOps();
      const archives = pending.filter(
        (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      expect(archives.length).toBe(1);
      expect(archives[0].entityIds).toEqual([TASK_C, TASK_D]);
      expectDominates(archives[0], remoteEditA);
      expectDominates(archives[0], remoteEditC);
      expect(titleOf(compensationFor(pending, TASK_A)!)).toBe(restoredTitle(TASK_A));
      // B had no row: its own restoreTask op stays pending and uploads.
      expectRowlessRestoreReasserted(pending, TASK_B);
      expect(pending.length).toBe(4);
    });

    it('keeps the full set when the restored task was archived again', async () => {
      // Only tasks back in the ACTIVE store are dropped: a restore undone by a
      // later single-task archive must not leave the task active elsewhere.
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        [TASK_A],
      );
      store.dispatch(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A)],
        }) as PersistentAction,
      );
      await writeFlush.flushPendingWrites();
      taskStateById[TASK_A] = undefined;
      const remoteEditA = buildRemoteTaskEdit(
        remoteClient(),
        TASK_A,
        bulkOp.timestamp + 10,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditA));

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      expect(payloadTaskIds(pending[0])).toEqual([TASK_A, TASK_B, TASK_C]);
      expectDominates(pending[0], remoteEditA);
    });

    it('emits no archive op at all when every task was restored', async () => {
      const bulkOp = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B)],
        [TASK_A, TASK_B],
      );
      const remoteEditA = buildRemoteTaskEdit(
        remoteClient(),
        TASK_A,
        bulkOp.timestamp + 10,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditA));

      const pending = await unsyncedOps();
      expect(archivedIds(pending)).toEqual([]);
      const compensation = compensationFor(pending, TASK_A);
      expect(titleOf(compensation!)).toBe(restoredTitle(TASK_A));
      expectDominates(compensation!, remoteEditA);
      expectRowlessRestoreReasserted(pending, TASK_B);
      expect(pending.length).toBe(3);
    });

    const SUB_A = 'task-a-sub';
    [SUB_A, TASK_A].forEach((editedId) => {
      it(`keeps a restored parent + subtask out of the recreation (edit on ${editedId})`, async () => {
        const subTask: Task = { ...doneTask(SUB_A), parentId: TASK_A };
        const [bulkOp] = await dispatchAndFlush(
          TaskSharedActions.moveToArchive({
            tasks: [doneTask(TASK_A, [subTask]), doneTask(TASK_B)],
          }) as PersistentAction,
        );
        const restoredParent: Task = {
          ...doneTask(TASK_A, [subTask]),
          title: restoredTitle(TASK_A),
          isDone: false,
        };
        const restoredSub: Task = { ...subTask, title: restoredTitle(SUB_A) };
        store.dispatch(
          TaskSharedActions.restoreTask({
            task: restoredParent,
            subTasks: [restoredSub],
          }) as PersistentAction,
        );
        await writeFlush.flushPendingWrites();
        taskStateById[TASK_A] = restoredParent;
        taskStateById[SUB_A] = restoredSub;
        const remoteEdit = buildRemoteTaskEdit(
          remoteClient(),
          editedId,
          bulkOp.timestamp + 10,
        );

        await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEdit));

        const pending = await unsyncedOps();
        const archives = pending.filter(
          (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
        );
        expect(archives.length).toBe(1);
        expect(archives[0].entityIds).toEqual([TASK_B]);
        expect(payloadTaskIds(archives[0])).toEqual([TASK_B]);
        expectDominates(archives[0], remoteEdit);
        const compensation = compensationFor(pending, editedId);
        expect(titleOf(compensation!)).toBe(restoredTitle(editedId));
        expectDominates(compensation!, remoteEdit);
        // The parent's restore (isDone: false) must reach other devices too.
        expect(compensationFor(pending, TASK_A)).toBeDefined();
        expect(
          (
            compensationFor(pending, TASK_A)!.payload as {
              actionPayload?: { isDone?: boolean };
            }
          ).actionPayload?.isDone,
        ).toBe(false);
      });
    });

    it('re-asserts a task restored from TWO pending archives only once', async () => {
      // archive{A,B} → restore A → archive{A,C} → restore A: A is retained by
      // both groups but has no row, so exactly one current-state update.
      const firstArchive = await archiveThenRestore(
        [doneTask(TASK_A), doneTask(TASK_B)],
        [TASK_A],
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      await archiveThenRestore([doneTask(TASK_A), doneTask(TASK_C)], [TASK_A]);
      const client = remoteClient();
      const remoteEditB = buildRemoteTaskEdit(
        client,
        TASK_B,
        firstArchive.timestamp + 10,
      );
      const remoteEditC = buildRemoteTaskEdit(
        client,
        TASK_C,
        firstArchive.timestamp + 11,
      );

      await resolver.autoResolveConflictsLWW([
        ...(await detectConflictsFor(remoteEditB)),
        ...(await detectConflictsFor(remoteEditC)),
      ]);

      const pending = await unsyncedOps();
      expect(archivedIds(pending)).not.toContain(TASK_A);
      const updatesForA = pending.filter(
        (op) =>
          op.entityId === TASK_A &&
          op.actionType !== ActionType.TASK_SHARED_MOVE_TO_ARCHIVE &&
          op.actionType !== ActionType.TASK_SHARED_RESTORE,
      );
      expect(updatesForA.length).toBe(1);
      pending
        .filter((op) => op.actionType === ActionType.TASK_SHARED_RESTORE)
        .forEach((restoreOp) => expectDominates(updatesForA[0], restoreOp));
    });

    it('keeps a restore after a ONE-task archive', async () => {
      const bulkOp = await archiveThenRestore([doneTask(TASK_A)], [TASK_A]);
      const remoteEditA = buildRemoteTaskEdit(
        remoteClient(),
        TASK_A,
        bulkOp.timestamp + 10,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditA));

      const pending = await unsyncedOps();
      expect(archivedIds(pending)).toEqual([]);
      const compensation = compensationFor(pending, TASK_A);
      expect(titleOf(compensation!)).toBe(restoredTitle(TASK_A));
      expectDominates(compensation!, remoteEditA);
      expect(pending.length).toBe(1);
    });
  });

  describe('#10102 heal: pending archive-win copies left by pre-fix clients', () => {
    // Pre-fix clients built one recreation per local-win row — exactly
    // `buildArchiveWinOp` over that single row. Seed that durable state.
    const seedPreFixCopies = async ({ keepOriginalPending = false } = {}): Promise<{
      bulkOp: Operation;
      copies: Operation[];
      client: TestClient;
    }> => {
      const [bulkOp] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B), doneTask(TASK_C)],
        }) as PersistentAction,
      );
      const client = remoteClient();
      const rows = [
        ...(await detectConflictsFor(
          buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 1),
        )),
        ...(await detectConflictsFor(
          buildRemoteTaskEdit(client, TASK_C, bulkOp.timestamp + 2),
        )),
      ];
      const copies = rows.map((conflict) =>
        buildArchiveWinOp({ archiveOp: bulkOp, conflicts: [conflict] }, LOCAL_CLIENT_ID),
      );
      if (!keepOriginalPending) {
        await opLogStore.markRejected([bulkOp.id]);
      }
      await opLogStore.appendBatch(copies, 'local');
      expect((await unsyncedOps()).map(({ id }) => id)).toEqual(
        [...(keepOriginalPending ? [bulkOp] : []), ...copies].map(({ id }) => id),
      );
      return { bulkOp, copies, client };
    };

    it('collapses the copies into ONE dominating archive op instead of wedging', async () => {
      const { bulkOp, copies, client } = await seedPreFixCopies();
      const laterEdit = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 3);

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(laterEdit));

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      const [healed] = pending;
      expect(copies.map(({ id }) => id)).not.toContain(healed.id);
      expect(healed.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
      expect(healed.entityIds).toEqual(bulkOp.entityIds);
      expect(healed.payload).toEqual(bulkOp.payload);
      expect(healed.timestamp).toBe(bulkOp.timestamp);
      copies.forEach((copy) => expectDominates(healed, copy));
      expectDominates(healed, laterEdit);
      expect(appliedOps().map(({ id }) => id)).not.toContain(laterEdit.id);
    });

    it('folds the still-pending original and its copies into ONE op when edits hit several tasks', async () => {
      // Reporter's shape: the original bulk archive never left the device, so
      // it sits pending next to its pre-fix copies (same intent, dominating
      // clocks). Remote edits on two archived tasks are all-local-win rows.
      const { bulkOp, copies, client } = await seedPreFixCopies({
        keepOriginalPending: true,
      });
      const remoteEditA = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 3);
      const remoteEditB = buildRemoteTaskEdit(client, TASK_B, bulkOp.timestamp + 4);

      await resolver.autoResolveConflictsLWW([
        ...(await detectConflictsFor(remoteEditA)),
        ...(await detectConflictsFor(remoteEditB)),
      ]);

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      const [healed] = pending;
      expect([bulkOp, ...copies].map(({ id }) => id)).not.toContain(healed.id);
      expect(healed.entityIds).toEqual(bulkOp.entityIds);
      expect(healed.payload).toEqual(bulkOp.payload);
      expect(healed.timestamp).toBe(bulkOp.timestamp);
      [bulkOp, ...copies, remoteEditA, remoteEditB].forEach((op) =>
        expectDominates(healed, op),
      );
      for (const { id } of [bulkOp, ...copies]) {
        expect((await opLogStore.getOpById(id))?.rejectedAt).toEqual(jasmine.any(Number));
      }
    });

    it('scopes the copies into ONE replacement when a remote archive wins a task', async () => {
      const { bulkOp, copies, client } = await seedPreFixCopies();
      const remoteArchiveA = buildRemoteArchiveOp(client, [TASK_A], bulkOp.timestamp + 3);

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteArchiveA));

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      const [replacement] = pending;
      expect(replacement.entityIds).toEqual([TASK_B, TASK_C]);
      expect(payloadTaskIds(replacement)).toEqual([TASK_B, TASK_C]);
      copies.forEach((copy) => expectDominates(replacement, copy));
      expectDominates(replacement, remoteArchiveA);
      expect(appliedOps().map(({ id }) => id)).toContain(remoteArchiveA.id);
    });

    it('keeps a later restore instead of re-archiving it with the healed op (#10220)', async () => {
      const { bulkOp, copies, client } = await seedPreFixCopies();
      const restoredA: Task = { ...doneTask(TASK_A), title: 'Restored A', isDone: false };
      store.dispatch(
        TaskSharedActions.restoreTask({
          task: restoredA,
          subTasks: [],
        }) as PersistentAction,
      );
      await writeFlush.flushPendingWrites();
      taskStateById[TASK_A] = restoredA;
      const remoteEditA = buildRemoteTaskEdit(client, TASK_A, bulkOp.timestamp + 10);

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditA));

      const pending = await unsyncedOps();
      expect(pending.length).toBe(2);
      const archive = pending.find(
        (op) => op.actionType === ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      );
      expect(archive!.entityIds).toEqual([TASK_B, TASK_C]);
      expect(payloadTaskIds(archive!)).toEqual([TASK_B, TASK_C]);
      copies.forEach((copy) => expectDominates(archive!, copy));
      expectDominates(archive!, remoteEditA);
      const compensation = pending.find((op) => op !== archive);
      expect(compensation!.entityId).toBe(TASK_A);
      expect(
        (compensation!.payload as { actionPayload?: { title?: string } }).actionPayload
          ?.title,
      ).toBe('Restored A');
      expectDominates(compensation!, remoteEditA);
    });

    it('still fails closed for a re-archive of the SAME tasks after a restore', async () => {
      // Same task set and footprint, but a separate later intent: collapsing
      // it with the first archive would erase the restore → re-archive order.
      const [firstArchive] = await dispatchAndFlush(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B)],
        }) as PersistentAction,
      );
      await new Promise((resolve) => setTimeout(resolve, 5));
      store.dispatch(
        TaskSharedActions.restoreTask({
          task: doneTask(TASK_A),
          subTasks: [],
        }) as PersistentAction,
      );
      store.dispatch(
        TaskSharedActions.moveToArchive({
          tasks: [doneTask(TASK_A), doneTask(TASK_B)],
        }) as PersistentAction,
      );
      await writeFlush.flushPendingWrites();
      const pendingBefore = await unsyncedOps();
      const reArchive = pendingBefore[2];
      expect(reArchive.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
      expect(reArchive.entityIds).toEqual(firstArchive.entityIds);
      expect(reArchive.timestamp).toBeGreaterThan(firstArchive.timestamp);

      const remoteEditOp = buildRemoteTaskEdit(
        remoteClient(),
        TASK_A,
        reArchive.timestamp + 1,
      );
      let thrown: unknown;
      try {
        await resolver.autoResolveConflictsLWW(await detectConflictsFor(remoteEditOp));
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
      expect(operationApplier.applyOperations).not.toHaveBeenCalled();
      expect((await unsyncedOps()).map(({ id }) => id)).toEqual(
        pendingBefore.map(({ id }) => id),
      );
    });
  });
});
