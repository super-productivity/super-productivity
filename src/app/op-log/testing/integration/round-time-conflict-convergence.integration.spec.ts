import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, createSelector, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ConflictJournalService } from '../../sync/conflict-journal.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { ValidateStateService } from '../../validation/validate-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { PersistentAction } from '../../core/persistent-action.interface';
import { Operation } from '../../core/operation.types';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { roundTimeSpentForDay } from '../../../features/tasks/store/task.actions';
import { taskReducer } from '../../../features/tasks/store/task.reducer';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Task } from '../../../features/tasks/task.model';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { RootState } from '../../../root-store/root-state';
import { createStateWithExistingTasks } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import {
  createCombinedTaskSharedMetaReducer,
  updateTaskEntity,
} from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

describe('round-time conflict convergence integration (#8944)', () => {
  const DAY = '2026-07-10';
  const TASK_X = 'task-x';
  const TASK_Y = 'task-y';
  const MINUTE = 60_000;
  const CLIENT_A = 'round-client-a';
  const CLIENT_B = 'title-client-b';

  let opLogStore: OperationLogStoreService;
  let journal: ConflictJournalService;
  let initialState: RootState;
  let localState: RootState;
  let reducer: ActionReducer<RootState, Action>;

  const captureOperation = (
    action: PersistentAction,
    client: TestClient,
    capture: OperationCaptureService,
    timestamp: number,
  ): Operation => {
    const { type, meta, ...actionPayload } = action;
    const entityIds = meta.entityIds ?? (meta.entityId ? [meta.entityId] : undefined);
    const entityId = meta.entityId ?? entityIds?.[0];
    if (!entityId) {
      throw new Error('Persistent test action has no entity id');
    }

    return {
      ...client.createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId,
        entityIds,
        payload: {
          actionPayload,
          entityChanges: capture.extractEntityChanges(action),
        },
      }),
      timestamp,
    };
  };

  const createReducer = (baseState: RootState): ActionReducer<RootState, Action> => {
    const rootReducer: ActionReducer<RootState, Action> = (
      state = baseState,
      action,
    ) => ({
      ...state,
      [TASK_FEATURE_NAME]: taskReducer(state[TASK_FEATURE_NAME], action),
    });
    return createCombinedTaskSharedMetaReducer(
      lwwUpdateMetaReducer(rootReducer),
    ) as ActionReducer<RootState, Action>;
  };

  const getTask = (state: RootState, taskId: string): Task =>
    state[TASK_FEATURE_NAME].entities[taskId] as Task;

  const taskSyncProjection = (state: RootState, taskId: string): object => {
    const task = getTask(state, taskId);
    return {
      id: task.id,
      title: task.title,
      timeSpent: task.timeSpent,
      timeSpentOnDay: task.timeSpentOnDay,
    };
  };

  beforeEach(async () => {
    resetTestUuidCounter();

    initialState = createStateWithExistingTasks([TASK_X, TASK_Y]);
    initialState = updateTaskEntity(initialState, TASK_X, {
      title: 'Task X',
      timeSpent: 10 * MINUTE,
      timeSpentOnDay: { [DAY]: 10 * MINUTE },
    });
    initialState = updateTaskEntity(initialState, TASK_Y, {
      title: 'Task Y',
      timeSpent: 20 * MINUTE,
      timeSpentOnDay: { [DAY]: 20 * MINUTE },
    });

    reducer = createReducer(initialState);
    localState = initialState;

    const storeSpy = jasmine.createSpyObj<Store>('Store', ['select']);
    storeSpy.select.and.callFake((selector: unknown, props?: unknown) => {
      if (typeof selector !== 'function') {
        return of(undefined) as ReturnType<Store['select']>;
      }
      const selected = (
        selector as (state: RootState, selectorProps?: unknown) => unknown
      )(localState, props);
      return of(selected) as ReturnType<Store['select']>;
    });

    const applierSpy = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
    applierSpy.applyOperations.and.callFake(async (ops, options) => {
      for (const op of ops) {
        localState = reducer(localState, convertOpToAction(op));
      }
      await options?.onReducersCommitted?.(ops);
      return { appliedOps: ops };
    });

    const validateSpy = jasmine.createSpyObj<ValidateStateService>(
      'ValidateStateService',
      ['validateAndRepairCurrentState'],
    );
    validateSpy.validateAndRepairCurrentState.and.resolveTo(true);

    const effectsSpy = jasmine.createSpyObj<OperationLogEffects>('OperationLogEffects', [
      'processDeferredActions',
    ]);
    effectsSpy.processDeferredActions.and.resolveTo();

    // Use a test-local selector. MockStore.overrideSelector mutates shared selector
    // instances, so an unrelated spec can otherwise leak a zero-time task into
    // this integration test when Jasmine randomizes file order.
    const entityRegistry = buildEntityRegistry();
    const taskConfig = entityRegistry.TASK;
    if (!taskConfig) {
      throw new Error('TASK entity config is required for this integration test.');
    }
    taskConfig.selectById = createSelector(
      (state: RootState) => state[TASK_FEATURE_NAME],
      (state, props: { id: string }) => state.entities[props.id] as Task,
    ) as unknown as NonNullable<typeof taskConfig.selectById>;

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogStoreService,
        OperationCaptureService,
        { provide: Store, useValue: storeSpy },
        { provide: OperationApplierService, useValue: applierSpy },
        { provide: ValidateStateService, useValue: validateSpy },
        { provide: OperationLogEffects, useValue: effectsSpy },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj<SnackService>('SnackService', ['open']),
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: () => Promise.resolve(CLIENT_A),
            getOrGenerateClientId: () => Promise.resolve(CLIENT_A),
            clearCache: () => {},
          },
        },
        { provide: ENTITY_REGISTRY, useValue: entityRegistry },
      ],
    });

    opLogStore = TestBed.inject(OperationLogStoreService);
    journal = TestBed.inject(ConflictJournalService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await journal.clearAll();
  });

  afterEach(async () => {
    await opLogStore._clearAllDataForTesting();
    await journal.clearAll();
    TestBed.resetTestingModule();
  });

  it('captures, resolves, uploads, replays, and restart-replays without cross-entity corruption', async () => {
    const capture = TestBed.inject(OperationCaptureService);
    const resolver = TestBed.inject(ConflictResolutionService);
    const server = new MockSyncServer();
    const clientA = new TestClient(CLIENT_A);
    const clientB = new TestClient(CLIENT_B);

    const roundAction = roundTimeSpentForDay({
      day: DAY,
      taskIds: [TASK_X, TASK_Y],
      roundTo: 'QUARTER',
      isRoundUp: true,
    }) as PersistentAction;
    localState = reducer(localState, roundAction);
    const localBulkOp = captureOperation(roundAction, clientA, capture, 1_000);

    // Current capture intentionally stores action semantics rather than state
    // diffs for this reducer-driven bulk action.
    expect((localBulkOp.payload as { entityChanges: unknown[] }).entityChanges).toEqual(
      [],
    );
    await opLogStore.append(localBulkOp, 'local');

    const remoteTitleAction = TaskSharedActions.updateTask({
      task: { id: TASK_Y, changes: { title: 'Remote title for Y' } },
    }) as PersistentAction;
    let remoteState = reducer(initialState, remoteTitleAction);
    const remoteTitleOp = captureOperation(remoteTitleAction, clientB, capture, 2_000);
    server.uploadOps([remoteTitleOp], CLIENT_B);

    const detection = await resolver.checkOpForConflicts(remoteTitleOp, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detection.conflicts[0]?.entityId).toBe(TASK_Y);

    const resolution = await resolver.autoResolveConflictsLWW(detection.conflicts);
    expect(resolution.localWinOpsCreated).toBe(2);

    const rejectedBulk = await opLogStore.getOpById(localBulkOp.id);
    expect(rejectedBulk?.rejectedAt).toBeDefined();

    const reconciliationEntries = await opLogStore.getUnsynced();
    const reconciliationOps = reconciliationEntries.map((entry) => entry.op);
    expect(reconciliationOps.map((op) => op.entityId).sort()).toEqual([TASK_X, TASK_Y]);
    expect(reconciliationEntries.every((entry) => entry.rejectedAt === undefined)).toBe(
      true,
    );

    server.uploadOps(reconciliationOps, CLIENT_A);
    const downloadedByB = server
      .downloadOps(0, CLIENT_B)
      .ops.map((entry) => entry.op as Operation);
    expect(downloadedByB.length).toBe(2);
    for (const op of downloadedByB) {
      remoteState = reducer(remoteState, convertOpToAction(op));
    }

    expect(taskSyncProjection(localState, TASK_X)).toEqual(
      taskSyncProjection(remoteState, TASK_X),
    );
    expect(taskSyncProjection(localState, TASK_Y)).toEqual(
      taskSyncProjection(remoteState, TASK_Y),
    );
    expect(getTask(localState, TASK_Y).title).toBe('Remote title for Y');
    expect(getTask(localState, TASK_X).timeSpent).toBe(15 * MINUTE);
    expect(getTask(localState, TASK_Y).timeSpent).toBe(30 * MINUTE);

    // Simulated restart: rebuild state exclusively from the durable operation
    // log, including rejected rows (hydration is deliberately status-blind).
    let restartedState = initialState;
    const durableEntries = await opLogStore.getOpsAfterSeq(0);
    for (const entry of durableEntries) {
      restartedState = reducer(restartedState, convertOpToAction(entry.op));
    }
    expect(taskSyncProjection(restartedState, TASK_X)).toEqual(
      taskSyncProjection(localState, TASK_X),
    );
    expect(taskSyncProjection(restartedState, TASK_Y)).toEqual(
      taskSyncProjection(localState, TASK_Y),
    );
  });

  it('resolves a REMOTE bulk rounding op against a newer local edit and converges (#9601)', async () => {
    const capture = TestBed.inject(OperationCaptureService);
    const resolver = TestBed.inject(ConflictResolutionService);
    const server = new MockSyncServer();
    const clientA = new TestClient(CLIENT_A);
    const clientB = new TestClient(CLIENT_B);

    // Device B ("finish day"): rounds BOTH tasks up to the quarter hour in one
    // atomic op and uploads it. X: 10m → 15m, Y: 20m → 30m on device B.
    const roundAction = roundTimeSpentForDay({
      day: DAY,
      taskIds: [TASK_X, TASK_Y],
      roundTo: 'QUARTER',
      isRoundUp: true,
    }) as PersistentAction;
    let remoteState = reducer(initialState, roundAction);
    const remoteRoundOp = captureOperation(roundAction, clientB, capture, 1_000);
    server.uploadOps([remoteRoundOp], CLIENT_B);

    // This device (A, next morning): a NEWER pending edit on task Y.
    const localEditAction = TaskSharedActions.updateTask({
      task: { id: TASK_Y, changes: { title: 'Local title for Y' } },
    }) as PersistentAction;
    localState = reducer(localState, localEditAction);
    const localEditOp = captureOperation(localEditAction, clientA, capture, 2_000);
    await opLogStore.append(localEditOp, 'local');

    const detection = await resolver.checkOpForConflicts(remoteRoundOp, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detection.conflicts.length).toBe(1);
    expect(detection.conflicts[0]?.entityId).toBe(TASK_Y);

    const resolution = await resolver.autoResolveConflictsLWW(detection.conflicts);
    expect(resolution.localWinOpsCreated).toBe(1);

    // The original edit is superseded by the compensation snapshot.
    const rejectedEdit = await opLogStore.getOpById(localEditOp.id);
    expect(rejectedEdit?.rejectedAt).toBeDefined();
    const pendingEntries = await opLogStore.getUnsynced();
    expect(pendingEntries.length).toBe(1);
    const compensationOp = pendingEntries[0].op;
    expect(compensationOp.entityId).toBe(TASK_Y);

    // Through the REAL reducer: the uncontested sibling X converges to the
    // sender's rounded value; the local winner Y keeps its title AND its
    // unrounded time (the atomic replay's transient rounding of Y is undone by
    // the compensation snapshot applied after it).
    expect(getTask(localState, TASK_X).timeSpent).toBe(15 * MINUTE);
    expect(getTask(localState, TASK_Y).title).toBe('Local title for Y');
    expect(getTask(localState, TASK_Y).timeSpent).toBe(20 * MINUTE);

    // Device B downloads the compensation and converges on both tasks.
    server.uploadOps([compensationOp], CLIENT_A);
    const downloadedByB = server
      .downloadOps(1, CLIENT_B)
      .ops.map((entry) => entry.op as Operation);
    expect(downloadedByB.map(({ id }) => id)).toEqual([compensationOp.id]);
    for (const op of downloadedByB) {
      remoteState = reducer(remoteState, convertOpToAction(op));
    }
    expect(taskSyncProjection(remoteState, TASK_X)).toEqual(
      taskSyncProjection(localState, TASK_X),
    );
    expect(taskSyncProjection(remoteState, TASK_Y)).toEqual(
      taskSyncProjection(localState, TASK_Y),
    );

    // Status-blind restart: replaying the durable log by seq (rejected edit,
    // remote rounding row, compensation) reproduces the live-apply result.
    let restartedState = initialState;
    const durableEntries = await opLogStore.getOpsAfterSeq(0);
    for (const entry of durableEntries) {
      restartedState = reducer(restartedState, convertOpToAction(entry.op));
    }
    expect(taskSyncProjection(restartedState, TASK_X)).toEqual(
      taskSyncProjection(localState, TASK_X),
    );
    expect(taskSyncProjection(restartedState, TASK_Y)).toEqual(
      taskSyncProjection(localState, TASK_Y),
    );
  });

  it('resolves a remote rounding op overlapping a pending local archive (#9601 both-finish-day)', async () => {
    // Both devices ran "Finish day": the remote client rounded X, Y and Z in
    // one atomic op; this client archived X before syncing. The rounding op
    // replays against a store where X is gone — the reducer must skip the
    // missing id (uncontested siblings still round) instead of throwing, which
    // the conflict path would escalate into IncompleteRemoteOperationsError
    // and a permanently re-wedged sync.
    const TASK_Z = 'task-z';
    initialState = createStateWithExistingTasks([TASK_X, TASK_Y, TASK_Z]);
    initialState = updateTaskEntity(initialState, TASK_X, {
      title: 'Task X',
      isDone: true,
      timeSpent: 10 * MINUTE,
      timeSpentOnDay: { [DAY]: 10 * MINUTE },
    });
    initialState = updateTaskEntity(initialState, TASK_Y, {
      title: 'Task Y',
      timeSpent: 20 * MINUTE,
      timeSpentOnDay: { [DAY]: 20 * MINUTE },
    });
    initialState = updateTaskEntity(initialState, TASK_Z, {
      title: 'Task Z',
      timeSpent: 7 * MINUTE,
      timeSpentOnDay: { [DAY]: 7 * MINUTE },
    });
    reducer = createReducer(initialState);
    localState = initialState;

    const capture = TestBed.inject(OperationCaptureService);
    const resolver = TestBed.inject(ConflictResolutionService);
    const server = new MockSyncServer();
    const clientA = new TestClient(CLIENT_A);
    const clientB = new TestClient(CLIENT_B);

    // Remote finish day: X 10m → 15m, Y 20m → 30m, Z 7m → 15m.
    const roundAction = roundTimeSpentForDay({
      day: DAY,
      taskIds: [TASK_X, TASK_Y, TASK_Z],
      roundTo: 'QUARTER',
      isRoundUp: true,
    }) as PersistentAction;
    let remoteState = reducer(initialState, roundAction);
    const remoteRoundOp = captureOperation(roundAction, clientB, capture, 1_000);
    server.uploadOps([remoteRoundOp], CLIENT_B);

    // Local finish day (NEWER): X is done and gets bulk-archived.
    const archiveAction = TaskSharedActions.moveToArchive({
      tasks: [{ ...getTask(localState, TASK_X), subTasks: [] }],
    }) as PersistentAction;
    localState = reducer(localState, archiveAction);
    expect(localState[TASK_FEATURE_NAME].entities[TASK_X]).toBeUndefined();
    const localArchiveOp = captureOperation(archiveAction, clientA, capture, 2_000);
    await opLogStore.append(localArchiveOp, 'local');

    const detection = await resolver.checkOpForConflicts(remoteRoundOp, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detection.conflicts.length).toBe(1);
    expect(detection.conflicts[0]?.entityId).toBe(TASK_X);

    // The load-bearing claim: this resolves instead of wedging.
    await resolver.autoResolveConflictsLWW(detection.conflicts);

    // X stays archived (archive precedence); the atomic replay skipped the
    // missing id and still rounded the uncontested siblings.
    expect(localState[TASK_FEATURE_NAME].entities[TASK_X]).toBeUndefined();
    expect(getTask(localState, TASK_Y).timeSpent).toBe(30 * MINUTE);
    expect(getTask(localState, TASK_Z).timeSpent).toBe(15 * MINUTE);

    // The archive intent survives as an uploadable op for X.
    const pendingEntries = await opLogStore.getUnsynced();
    expect(pendingEntries.length).toBeGreaterThan(0);
    const pendingOps = pendingEntries.map((entry) => entry.op);
    expect(
      pendingOps.every((op) => op.actionType === TaskSharedActions.moveToArchive.type),
    ).toBe(true);

    // Remote client downloads the archive ops and converges.
    server.uploadOps(pendingOps, CLIENT_A);
    const downloadedByB = server
      .downloadOps(1, CLIENT_B)
      .ops.map((entry) => entry.op as Operation);
    for (const op of downloadedByB) {
      remoteState = reducer(remoteState, convertOpToAction(op));
    }
    expect(remoteState[TASK_FEATURE_NAME].entities[TASK_X]).toBeUndefined();
    expect(taskSyncProjection(remoteState, TASK_Y)).toEqual(
      taskSyncProjection(localState, TASK_Y),
    );
    expect(taskSyncProjection(remoteState, TASK_Z)).toEqual(
      taskSyncProjection(localState, TASK_Z),
    );

    // Status-blind restart replay reproduces the live result.
    let restartedState = initialState;
    const durableEntries = await opLogStore.getOpsAfterSeq(0);
    for (const entry of durableEntries) {
      restartedState = reducer(restartedState, convertOpToAction(entry.op));
    }
    expect(restartedState[TASK_FEATURE_NAME].entities[TASK_X]).toBeUndefined();
    expect(taskSyncProjection(restartedState, TASK_Y)).toEqual(
      taskSyncProjection(localState, TASK_Y),
    );
    expect(taskSyncProjection(restartedState, TASK_Z)).toEqual(
      taskSyncProjection(localState, TASK_Z),
    );
  });
});
