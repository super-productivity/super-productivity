import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, createSelector, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { ValidateStateService } from '../../validation/validate-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { PersistentAction } from '../../core/persistent-action.interface';
import { EntityConflict, Operation } from '../../core/operation.types';
import { convertOpToAction } from '../../apply/operation-converter.util';
import {
  removeTimeSpent,
  roundTimeSpentForDay,
} from '../../../features/tasks/store/task.actions';
import { taskReducer } from '../../../features/tasks/store/task.reducer';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { syncTimeSpent } from '../../../features/time-tracking/store/time-tracking.actions';
import { Task } from '../../../features/tasks/task.model';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';
import { RootState } from '../../../root-store/root-state';
import { createStateWithExistingTasks } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import {
  createCombinedTaskSharedMetaReducer,
  updateTaskEntity,
} from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { compareVectorClocks, VectorClockComparison } from '@sp/sync-core';
import { MockSyncServer } from './helpers/mock-sync-server.helper';
import { mergeVectorClocks } from '../../../core/util/vector-clock';
import { SupersededOperationResolverService } from '../../sync/superseded-operation-resolver.service';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { isSyncTimeSpentOp } from '../../sync/fold-sync-time-spent.util';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

describe('round-time conflict convergence integration (#8944)', () => {
  const DAY = '2026-07-10';
  const TASK_X = 'task-x';
  const TASK_Y = 'task-y';
  const MINUTE = 60_000;
  const CLIENT_A = 'round-client-a';
  const CLIENT_B = 'title-client-b';

  let opLogStore: OperationLogStoreService;
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
        { provide: StateSnapshotService, useValue: {} },
      ],
    });

    opLogStore = TestBed.inject(OperationLogStoreService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
  });

  afterEach(async () => {
    await opLogStore._clearAllDataForTesting();
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

  for (const [form, taskIds] of [
    ['direct', [TASK_X, TASK_Y]],
    ['deferred', [TASK_X, TASK_Y]],
    ['direct', [TASK_X]],
    ['deferred', [TASK_X]],
  ] as const) {
    it(`keeps a newer remote syncTimeSpent (${form} form) crossing a pending local rounding op of ${taskIds.length} task(s) (#10215)`, async () => {
      const capture = TestBed.inject(OperationCaptureService);
      const resolver = TestBed.inject(ConflictResolutionService);
      const server = new MockSyncServer();
      const clientA = new TestClient(CLIENT_A);
      const clientB = new TestClient(CLIENT_B);

      // Device A ("finish day"): rounds X (10m → 15m), and Y (20m → 30m)
      // unless it rounds X alone (a single-entity op).
      const roundAction = roundTimeSpentForDay({
        day: DAY,
        taskIds: [...taskIds],
        roundTo: 'QUARTER',
        isRoundUp: true,
      }) as PersistentAction;
      localState = reducer(localState, roundAction);
      const localBulkOp = captureOperation(roundAction, clientA, capture, 1_000);
      await opLogStore.append(localBulkOp, 'local');

      // Device B: tracks 3 more minutes on X (its store already holds them).
      const syncAction = syncTimeSpent({
        taskId: TASK_X,
        date: DAY,
        duration: 3 * MINUTE,
      }) as PersistentAction;
      const capturedDeltaOp = captureOperation(syncAction, clientB, capture, 2_000);
      const remoteDeltaOp: Operation =
        form === 'direct'
          ? capturedDeltaOp
          : {
              ...capturedDeltaOp,
              payload: {
                ...(capturedDeltaOp.payload as object),
                entityChanges: [],
              },
            };
      let remoteState = updateTaskEntity(initialState, TASK_X, {
        timeSpent: 13 * MINUTE,
        timeSpentOnDay: { [DAY]: 13 * MINUTE },
      });
      server.uploadOps([remoteDeltaOp], CLIENT_B);

      const detection = await resolver.checkOpForConflicts(remoteDeltaOp, {
        localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      });
      expect(detection.conflicts.map((c) => c.entityId)).toEqual([TASK_X]);

      await resolver.autoResolveConflictsLWW(detection.conflicts);

      const pendingOps = (await opLogStore.getUnsynced()).map((entry) => entry.op);
      server.uploadOps(pendingOps, CLIENT_A);
      const downloadedByB = server
        .downloadOps(1, CLIENT_B)
        .ops.map((entry) => entry.op as Operation);
      for (const op of downloadedByB) {
        remoteState = reducer(remoteState, convertOpToAction(op));
      }

      // Both devices keep A's rounding AND B's tracked time: round(10m) + 3m
      // (the same bounded order effect as a remote rounding op, #9601).
      expect(getTask(remoteState, TASK_X).timeSpent).toBe(18 * MINUTE);
      expect(taskSyncProjection(localState, TASK_X)).toEqual(
        taskSyncProjection(remoteState, TASK_X),
      );
      expect(taskSyncProjection(localState, TASK_Y)).toEqual(
        taskSyncProjection(remoteState, TASK_Y),
      );

      // Status-blind restart replay reproduces the live result.
      let restartedState = initialState;
      for (const entry of await opLogStore.getOpsAfterSeq(0)) {
        restartedState = reducer(restartedState, convertOpToAction(entry.op));
      }
      expect(taskSyncProjection(restartedState, TASK_X)).toEqual(
        taskSyncProjection(localState, TASK_X),
      );
      expect(taskSyncProjection(restartedState, TASK_Y)).toEqual(
        taskSyncProjection(localState, TASK_Y),
      );
    });
  }

  // Mirrors the real server (super-sync-server conflict.ts): an upload must
  // dominate the entity's latest op; only two concurrent timer deltas commute.
  const uploadLikeServer = (
    server: MockSyncServer,
    ops: Operation[],
    clientId: string,
  ): Operation[] => {
    const rejected: Operation[] = [];
    for (const op of ops) {
      const latest = server.getOpsForEntity(op.entityType, op.entityId!).at(-1)?.op;
      const comparison =
        latest && compareVectorClocks(op.vectorClock, latest.vectorClock);
      const commutes =
        comparison === VectorClockComparison.CONCURRENT &&
        isSyncTimeSpentOp(op) &&
        isSyncTimeSpentOp(latest as Operation);
      if (comparison && comparison !== VectorClockComparison.GREATER_THAN && !commutes) {
        rejected.push(op);
      } else {
        server.uploadOps([op], clientId);
      }
    }
    return rejected;
  };

  for (const order of ['delta-first', 'rename-first'] as const) {
    it(`keeps both timer deltas when a remote delta crosses a pending local delta + rename (${order}, #10214)`, async () => {
      const capture = TestBed.inject(OperationCaptureService);
      const resolver = TestBed.inject(ConflictResolutionService);
      const server = new MockSyncServer();
      const clientA = new TestClient(CLIENT_A);
      const clientB = new TestClient(CLIENT_B);

      // Device A: tracks 2m on X (the timer already wrote them to its store)
      // and renames it; both ops still pending.
      localState = updateTaskEntity(localState, TASK_X, {
        timeSpent: 12 * MINUTE,
        timeSpentOnDay: { [DAY]: 12 * MINUTE },
      });
      const deltaAction = syncTimeSpent({
        taskId: TASK_X,
        date: DAY,
        duration: 2 * MINUTE,
      });
      const renameAction = TaskSharedActions.updateTask({
        task: { id: TASK_X, changes: { title: 'A' } },
      });
      const localActions = (
        order === 'delta-first'
          ? [deltaAction, renameAction]
          : [renameAction, deltaAction]
      ) as PersistentAction[];
      for (const [i, action] of localActions.entries()) {
        localState = reducer(localState, action);
        const op = captureOperation(action, clientA, capture, 1_000 + i);
        // Capture's write path: the durable clock follows each local op.
        await opLogStore.appendWithVectorClockOverwrite(op, 'local');
      }

      // Device B: tracks 3m on X and syncs first.
      const remoteDelta = captureOperation(
        syncTimeSpent({
          taskId: TASK_X,
          date: DAY,
          duration: 3 * MINUTE,
        }) as PersistentAction,
        clientB,
        capture,
        2_000,
      );
      let remoteState = reducer(initialState, convertOpToAction(remoteDelta));
      expect(uploadLikeServer(server, [remoteDelta], CLIENT_B)).toEqual([]);

      // The deltas commute and the rename touches no time field: no conflict,
      // B's delta applies on A like any non-conflicting remote op.
      const detection = await resolver.checkOpForConflicts(remoteDelta, {
        localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      });
      expect(detection.conflicts).toEqual([]);
      await opLogStore.append(remoteDelta, 'remote');
      await opLogStore.mergeRemoteOpClocks([remoteDelta]);
      localState = reducer(localState, convertOpToAction(remoteDelta));

      // A uploads. Delta first: A's delta commutes with B's, and the rename
      // then dominates A's own delta. Rename first: the rename is concurrent
      // to B's delta and rejected; the superseded path re-sends a snapshot.
      const uploadPending = async (): Promise<Operation[]> => {
        const pending = await opLogStore.getUnsynced();
        const rejectedOps = uploadLikeServer(
          server,
          pending.map((entry) => entry.op),
          CLIENT_A,
        );
        await opLogStore.markSynced(
          pending.filter((entry) => !rejectedOps.includes(entry.op)).map((e) => e.seq),
        );
        return rejectedOps;
      };
      const rejected = await uploadPending();
      expect(rejected.length).toBe(order === 'delta-first' ? 0 : 1);
      if (rejected.length > 0) {
        await TestBed.inject(
          SupersededOperationResolverService,
        ).resolveSupersededLocalOps(
          rejected.map((op) => ({ opId: op.id, op })),
          [remoteDelta.vectorClock],
        );
        expect(await uploadPending()).toEqual([]);
      }
      // B has no pending ops; run its no-pending conflict check against its
      // applied frontier before applying each download.
      const appliedOnB: Operation[] = [remoteDelta];
      for (const { op } of server.downloadOps(1, CLIENT_B).ops) {
        const downloaded = op as Operation;
        const onB = await resolver.checkOpForConflicts(downloaded, {
          localPendingOpsByEntity: new Map(),
          appliedFrontierByEntity: new Map([
            [
              `TASK:${TASK_X}`,
              appliedOnB.reduce(
                (clock, applied) => mergeVectorClocks(clock, applied.vectorClock),
                {},
              ),
            ],
          ]),
          retainedOpsByEntity: new Map([[`TASK:${TASK_X}`, [...appliedOnB]]]),
          snapshotVectorClock: undefined,
          snapshotEntityKeys: undefined,
          hasNoSnapshotClock: true,
        });
        expect(onB).toEqual({ isSupersededOrDuplicate: false, conflicts: [] });
        appliedOnB.push(downloaded);
        remoteState = reducer(remoteState, convertOpToAction(downloaded));
      }

      expect(getTask(localState, TASK_X).timeSpent).toBe(15 * MINUTE);
      expect(getTask(localState, TASK_X).title).toBe('A');
      expect(taskSyncProjection(remoteState, TASK_X)).toEqual(
        taskSyncProjection(localState, TASK_X),
      );
      let restartedState = initialState;
      for (const entry of await opLogStore.getOpsAfterSeq(0)) {
        restartedState = reducer(restartedState, convertOpToAction(entry.op));
      }
      expect(taskSyncProjection(restartedState, TASK_X)).toEqual(
        taskSyncProjection(localState, TASK_X),
      );
    });
  }

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
  for (const scenario of [
    'task',
    'parent',
    'child-absolute-then-delta',
    'child-remove-then-delta',
    'child-round-then-delta',
    'unrelated-create',
    'third-client',
  ] as const) {
    it(`preserves incoming timer deltas beside a losing rename (${scenario})`, async () => {
      const hasParent = scenario === 'parent' || scenario.startsWith('child-');
      if (hasParent) {
        initialState = updateTaskEntity(initialState, TASK_X, { parentId: TASK_Y });
        initialState = updateTaskEntity(initialState, TASK_Y, {
          subTaskIds: [TASK_X],
          timeSpent: 10 * MINUTE,
          timeSpentOnDay: { [DAY]: 10 * MINUTE },
        });
        reducer = createReducer(initialState);
        localState = initialState;
      }
      const capture = TestBed.inject(OperationCaptureService);
      const resolver = TestBed.inject(ConflictResolutionService);
      const clientA = new TestClient(CLIENT_A);
      const clientB = new TestClient(CLIENT_B);
      const renameId = hasParent ? TASK_Y : TASK_X;
      // The rename's author may not have seen the timer delta: the snapshot
      // that folds it in must still dominate it.
      const deltaClient =
        scenario === 'third-client' ? new TestClient('timer-client-c') : clientB;
      const localRename = TaskSharedActions.updateTask({
        task: { id: renameId, changes: { title: 'A winner' } },
      }) as PersistentAction;
      localState = reducer(localState, localRename);
      await opLogStore.append(
        captureOperation(localRename, clientA, capture, 3_000),
        'local',
      );

      let predecessorAction: PersistentAction | undefined;
      if (scenario === 'child-absolute-then-delta') {
        predecessorAction = TaskSharedActions.updateTask({
          task: {
            id: TASK_X,
            changes: {
              timeSpent: 20 * MINUTE,
              timeSpentOnDay: { [DAY]: 20 * MINUTE },
            },
          },
        }) as PersistentAction;
      } else if (scenario === 'child-remove-then-delta') {
        predecessorAction = removeTimeSpent({
          id: TASK_X,
          date: DAY,
          duration: 2 * MINUTE,
        }) as PersistentAction;
      } else if (scenario === 'child-round-then-delta') {
        predecessorAction = roundTimeSpentForDay({
          day: DAY,
          taskIds: [TASK_X],
          roundTo: 'QUARTER',
          isRoundUp: true,
        }) as PersistentAction;
      }
      let remotePredecessor = predecessorAction
        ? captureOperation(predecessorAction, clientB, capture, 900)
        : undefined;
      if (scenario === 'child-round-then-delta' && remotePredecessor) {
        remotePredecessor = {
          ...remotePredecessor,
          payload: { ...(remotePredecessor.payload as object), entityChanges: [] },
        };
      }
      const remoteDelta = captureOperation(
        syncTimeSpent({
          taskId: TASK_X,
          date: DAY,
          duration: 3 * MINUTE,
        }) as PersistentAction,
        deltaClient,
        capture,
        1_000,
      );
      const remoteRename = captureOperation(
        TaskSharedActions.updateTask({
          task: { id: renameId, changes: { title: 'B loser' } },
        }) as PersistentAction,
        clientB,
        capture,
        2_000,
      );
      let remoteState = remotePredecessor
        ? reducer(initialState, convertOpToAction(remotePredecessor))
        : initialState;
      remoteState = reducer(remoteState, convertOpToAction(remoteDelta));
      remoteState = reducer(remoteState, convertOpToAction(remoteRename));
      const nonConflicting = remotePredecessor
        ? [remotePredecessor, remoteDelta]
        : [remoteDelta];
      if (scenario === 'unrelated-create') {
        // This delta needs its CREATE; only deltas folded into snapshots may
        // move into the earlier atomic resolution batch.
        const create = captureOperation(
          TaskSharedActions.addTask({
            task: {
              ...getTask(initialState, TASK_X),
              id: 'new-task',
              timeSpent: 0,
              timeSpentOnDay: {},
            },
            workContextId: 'project1',
            workContextType: WorkContextType.PROJECT,
            isAddToBacklog: false,
            isAddToBottom: true,
          }) as PersistentAction,
          clientB,
          capture,
          2_100,
        );
        const delta = captureOperation(
          syncTimeSpent({
            taskId: 'new-task',
            date: DAY,
            duration: 2 * MINUTE,
          }) as PersistentAction,
          clientB,
          capture,
          2_200,
        );
        nonConflicting.push(create, delta);
        remoteState = reducer(remoteState, convertOpToAction(create));
        remoteState = reducer(remoteState, convertOpToAction(delta));
      }
      const context = {
        localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      };
      for (const op of nonConflicting) {
        expect((await resolver.checkOpForConflicts(op, context)).conflicts).toEqual([]);
      }
      const detection = await resolver.checkOpForConflicts(remoteRename, context);
      expect(detection.conflicts.length).toBe(1);
      await resolver.autoResolveConflictsLWW(detection.conflicts, nonConflicting);
      const expectedTime =
        scenario === 'child-absolute-then-delta'
          ? 23
          : scenario === 'child-remove-then-delta'
            ? 11
            : scenario === 'child-round-then-delta'
              ? 18
              : 13;
      if (remotePredecessor) {
        expect(getTask(localState, TASK_X).timeSpent)
          .withContext('live child must retain the preceding edit followed by the delta')
          .toBe(expectedTime * MINUTE);
        expect(getTask(localState, TASK_Y).timeSpent)
          .withContext('live parent must retain its child contribution')
          .toBe(expectedTime * MINUTE);
      }
      const snapshots = (await opLogStore.getUnsynced())
        .map(({ op }) => op)
        .filter((op) => op.entityId === renameId);
      expect(snapshots.length).toBe(1);
      expect(compareVectorClocks(snapshots[0].vectorClock, remoteDelta.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
      for (const entry of await opLogStore.getUnsynced()) {
        remoteState = reducer(remoteState, convertOpToAction(entry.op));
      }
      let restartedState = initialState;
      for (const entry of await opLogStore.getOpsAfterSeq(0)) {
        restartedState = reducer(restartedState, convertOpToAction(entry.op));
      }
      expect(getTask(localState, TASK_X).timeSpent).toBe(expectedTime * MINUTE);
      expect(getTask(remoteState, TASK_X).timeSpent).toBe(expectedTime * MINUTE);
      const ids =
        scenario === 'unrelated-create' ? [TASK_X, TASK_Y, 'new-task'] : [TASK_X, TASK_Y];
      for (const taskId of ids) {
        expect(taskSyncProjection(remoteState, taskId)).toEqual(
          taskSyncProjection(localState, taskId),
        );
        expect(taskSyncProjection(restartedState, taskId)).toEqual(
          taskSyncProjection(localState, taskId),
        );
      }
      if (scenario === 'unrelated-create')
        expect(getTask(localState, 'new-task').timeSpent).toBe(2 * MINUTE);
    });
  }

  // Split winners on one task: the local rename beats an older remote rename,
  // a newer remote delta beats the local side. The local-win snapshot must
  // carry the delta, or receivers keep the pre-delta time.
  for (const roundIds of [[TASK_X], [TASK_X, TASK_Y]]) {
    it(`converges a rounding of ${roundIds.length} task(s) + newer rename against an older remote rename + newer delta`, async () => {
      const capture = TestBed.inject(OperationCaptureService);
      const resolver = TestBed.inject(ConflictResolutionService);
      const clientA = new TestClient(CLIENT_A);
      const clientB = new TestClient(CLIENT_B);
      const rename = (title: string): PersistentAction =>
        TaskSharedActions.updateTask({
          task: { id: TASK_X, changes: { title } },
        }) as PersistentAction;
      const localActions: [PersistentAction, number][] = [
        [
          roundTimeSpentForDay({
            day: DAY,
            taskIds: roundIds,
            roundTo: 'QUARTER',
            isRoundUp: true,
          }) as PersistentAction,
          1_000,
        ],
        [rename('A'), 3_000],
      ];
      for (const [action, timestamp] of localActions) {
        localState = reducer(localState, action);
        await opLogStore.append(
          captureOperation(action, clientA, capture, timestamp),
          'local',
        );
      }
      const delta = syncTimeSpent({ taskId: TASK_X, date: DAY, duration: 3 * MINUTE });
      const remoteOps = [
        captureOperation(rename('B'), clientB, capture, 2_000),
        captureOperation(delta as PersistentAction, clientB, capture, 4_000),
      ];
      let remoteState = initialState;
      for (const op of remoteOps) {
        remoteState = reducer(remoteState, convertOpToAction(op));
      }
      const context = {
        localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      };
      const conflicts: EntityConflict[] = [];
      for (const op of remoteOps) {
        conflicts.push(...(await resolver.checkOpForConflicts(op, context)).conflicts);
      }
      expect(conflicts.length).toBe(2);
      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = (await opLogStore.getUnsynced()).map(({ op }) => op);
      const snapshot = pending.find((op) => op.entityId === TASK_X);
      expect(compareVectorClocks(snapshot!.vectorClock, remoteOps[1].vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
      for (const op of pending) {
        remoteState = reducer(remoteState, convertOpToAction(op));
      }
      let restartedState = initialState;
      for (const entry of await opLogStore.getOpsAfterSeq(0)) {
        restartedState = reducer(restartedState, convertOpToAction(entry.op));
      }
      for (const state of [localState, remoteState, restartedState]) {
        expect(getTask(state, TASK_X).title).toBe('A');
        expect(getTask(state, TASK_X).timeSpent).toBe(18 * MINUTE);
        expect(taskSyncProjection(state, TASK_Y)).toEqual(
          taskSyncProjection(localState, TASK_Y),
        );
      }
    });
  }

  it('keeps parent totals on receivers and restart after rounding crosses a child timer delta', async () => {
    initialState = updateTaskEntity(initialState, TASK_X, {
      parentId: TASK_Y,
      timeSpent: 10 * MINUTE,
      timeSpentOnDay: { [DAY]: 10 * MINUTE },
    });
    initialState = updateTaskEntity(initialState, TASK_Y, {
      subTaskIds: [TASK_X],
      timeSpent: 10 * MINUTE,
      timeSpentOnDay: { [DAY]: 10 * MINUTE },
    });
    reducer = createReducer(initialState);
    localState = initialState;
    const capture = TestBed.inject(OperationCaptureService);
    const resolver = TestBed.inject(ConflictResolutionService);
    const clientA = new TestClient(CLIENT_A);
    const clientB = new TestClient(CLIENT_B);
    const roundAction = roundTimeSpentForDay({
      day: DAY,
      taskIds: [TASK_Y, TASK_X],
      roundTo: 'QUARTER',
      isRoundUp: true,
    }) as PersistentAction;
    localState = reducer(localState, roundAction);
    await opLogStore.append(
      captureOperation(roundAction, clientA, capture, 1_000),
      'local',
    );
    const delta = captureOperation(
      syncTimeSpent({
        taskId: TASK_X,
        date: DAY,
        duration: 3 * MINUTE,
      }) as PersistentAction,
      clientB,
      capture,
      2_000,
    );
    let remoteState = reducer(initialState, convertOpToAction(delta));
    const detection = await resolver.checkOpForConflicts(delta, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detection.conflicts.length).toBe(1);
    await resolver.autoResolveConflictsLWW(detection.conflicts);
    for (const entry of await opLogStore.getUnsynced()) {
      remoteState = reducer(remoteState, convertOpToAction(entry.op));
    }
    let restartedState = initialState;
    for (const entry of await opLogStore.getOpsAfterSeq(0)) {
      restartedState = reducer(restartedState, convertOpToAction(entry.op));
    }
    for (const state of [localState, remoteState, restartedState]) {
      expect(getTask(state, TASK_X).timeSpent).toBe(18 * MINUTE);
      expect(getTask(state, TASK_Y).timeSpent).toBe(18 * MINUTE);
    }
  });
});
