import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { BannerService } from '../../core/banner/banner.service';
import { SnackService } from '../../core/snack/snack.service';
import { DEFAULT_TASK, Task } from '../../features/tasks/task.model';
import { TASK_FEATURE_NAME, taskReducer } from '../../features/tasks/store/task.reducer';
import { PROJECT_FEATURE_NAME } from '../../features/project/store/project.reducer';
import { TIME_TRACKING_FEATURE_KEY } from '../../features/time-tracking/store/time-tracking.reducer';
import { RootState } from '../../root-store/root-state';
import { createCombinedTaskSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { createBaseState } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { lwwUpdateMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { bulkApplyOperations } from '../apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../apply/bulk-hydration.meta-reducer';
import { OperationApplierService } from '../apply/operation-applier.service';
import { OperationLogEffects } from '../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../core/entity-registry';
import { ActionType, EntityConflict, Operation, OpType } from '../core/operation.types';
import { toLwwUpdateActionType } from '../core/lww-update-action-types';
import { OpLogDbAdapter } from '../persistence/op-log-db-adapter';
import { STORE_NAMES } from '../persistence/db-keys.const';
import { OperationLogRecoveryService } from '../persistence/operation-log-recovery.service';
import { OperationLogStoreService } from '../persistence/operation-log-store.service';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';
import { LegacyPfDbService } from '../../core/persistence/legacy-pf-db.service';
import { ClientIdService } from '../../core/util/client-id.service';
import { VectorClockService } from './vector-clock.service';
import { CLIENT_ID_PROVIDER, ClientIdProvider } from '../util/client-id.provider';
import { ValidateStateService } from '../validation/validate-state.service';
import { ConflictJournalService } from './conflict-journal.service';
import { ConflictResolutionService } from './conflict-resolution.service';
import { SyncConflictBannerService } from './sync-conflict-banner.service';
import { SyncSessionValidationService } from './sync-session-validation.service';

describe('ConflictResolutionService persistence (integration, real store)', () => {
  const LOCAL_CLIENT_ID = 'local-client';
  const REMOTE_CLIENT_ID = 'remote-client';
  const ENTITY_ID = '*';
  const initialState = {
    [TIME_TRACKING_FEATURE_KEY]: { marker: 'initial' },
  };
  const localEntityState = { marker: 'local-winner' };

  let service: ConflictResolutionService;
  let recoveryService: OperationLogRecoveryService;
  let opLogStore: OperationLogStoreService;
  let store: jasmine.SpyObj<Store>;
  let operationApplier: jasmine.SpyObj<OperationApplierService>;
  let liveResolutionOps: Operation[];

  const clientIdProvider: ClientIdProvider = {
    loadClientId: () => Promise.resolve(LOCAL_CLIENT_ID),
    getOrGenerateClientId: () => Promise.resolve(LOCAL_CLIENT_ID),
    clearCache: () => {},
  };

  const createLwwOp = (
    id: string,
    clientId: string,
    timestamp: number,
    marker: string,
    vectorClock: Record<string, number>,
  ): Operation => ({
    id,
    actionType: toLwwUpdateActionType('TIME_TRACKING'),
    opType: OpType.Update,
    entityType: 'TIME_TRACKING',
    entityId: ENTITY_ID,
    payload: {
      actionPayload: { marker },
      entityChanges: [],
      lwwUpdateMode: 'replace',
    },
    clientId,
    vectorClock,
    timestamp,
    schemaVersion: CURRENT_SCHEMA_VERSION,
  });

  const createConflicts = (): {
    localOp: Operation;
    remoteLoser: Operation;
    remoteWinner: Operation;
    conflicts: EntityConflict[];
  } => {
    const localOp = createLwwOp('local-op', LOCAL_CLIENT_ID, 2_000, 'local-winner', {
      [LOCAL_CLIENT_ID]: 1,
    });
    const remoteLoser = createLwwOp(
      'remote-loser',
      REMOTE_CLIENT_ID,
      1_000,
      'remote-loser',
      { [REMOTE_CLIENT_ID]: 1 },
    );
    const remoteWinner = createLwwOp(
      'remote-winner',
      REMOTE_CLIENT_ID,
      3_000,
      'remote-winner',
      { [REMOTE_CLIENT_ID]: 2 },
    );
    return {
      localOp,
      remoteLoser,
      remoteWinner,
      conflicts: [
        {
          entityType: 'TIME_TRACKING',
          entityId: ENTITY_ID,
          localOps: [localOp],
          remoteOps: [remoteLoser],
          suggestedResolution: 'manual',
        },
        {
          entityType: 'TIME_TRACKING',
          entityId: ENTITY_ID,
          localOps: [localOp],
          remoteOps: [remoteWinner],
          suggestedResolution: 'manual',
        },
      ],
    };
  };

  const baseReducer: ActionReducer<typeof initialState> = (state = initialState) => state;
  const reducer = bulkOperationsMetaReducer(
    lwwUpdateMetaReducer(baseReducer) as ActionReducer<typeof initialState>,
  );
  const applyOperations = (
    state: typeof initialState,
    operations: Operation[],
  ): typeof initialState =>
    reducer(state, bulkApplyOperations({ operations, localClientId: LOCAL_CLIENT_ID }));

  const taskRootReducer: ActionReducer<RootState, Action> = (
    state = createBaseState(),
    action,
  ) => ({
    ...state,
    [TASK_FEATURE_NAME]: taskReducer(state[TASK_FEATURE_NAME], action),
  });
  const taskReplayReducer = bulkOperationsMetaReducer(
    createCombinedTaskSharedMetaReducer(lwwUpdateMetaReducer(taskRootReducer)),
  ) as ActionReducer<RootState, Action>;
  const createTaskReplayState = (
    tasks: Task[],
    projectTaskIds: string[],
    projectBacklogTaskIds: string[] = [],
  ): RootState => {
    const state = createBaseState();
    const project = state[PROJECT_FEATURE_NAME].entities.project1;
    if (!project) {
      throw new Error('Test fixture project1 is missing.');
    }
    return {
      ...state,
      [TASK_FEATURE_NAME]: {
        ...state[TASK_FEATURE_NAME],
        ids: tasks.map(({ id }) => id),
        entities: Object.fromEntries(tasks.map((task) => [task.id, task])),
      },
      [PROJECT_FEATURE_NAME]: {
        ...state[PROJECT_FEATURE_NAME],
        entities: {
          ...state[PROJECT_FEATURE_NAME].entities,
          project1: {
            ...project,
            taskIds: projectTaskIds,
            backlogTaskIds: projectBacklogTaskIds,
          },
        },
      },
    };
  };
  const applyTaskOperations = (
    state: RootState,
    operations: Operation[],
    localClientId: string,
  ): RootState =>
    taskReplayReducer(state, bulkApplyOperations({ operations, localClientId }));
  const taskShape = (state: RootState): unknown => ({
    ids: [...(state[TASK_FEATURE_NAME].ids as string[])].sort(),
    tasks: Object.fromEntries(
      Object.entries(state[TASK_FEATURE_NAME].entities).map(([id, task]) => [
        id,
        task && {
          title: task.title,
          parentId: task.parentId,
          subTaskIds: task.subTaskIds,
        },
      ]),
    ),
    projectTaskIds: state[PROJECT_FEATURE_NAME].entities.project1?.taskIds.slice() ?? [],
  });

  beforeEach(async () => {
    store = jasmine.createSpyObj<Store>('Store', ['select']);
    store.select.and.returnValue(of(localEntityState));
    operationApplier = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
    operationApplier.applyOperations.and.callFake(async (operations, options) => {
      liveResolutionOps = operations;
      await options?.onReducersCommitted?.(operations);
      return { appliedOps: operations };
    });

    const snackService = jasmine.createSpyObj<SnackService>('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    snackService.hasPendingPersistentAction.and.returnValue(false);
    const validateStateService = jasmine.createSpyObj<ValidateStateService>(
      'ValidateStateService',
      ['validateAndRepairCurrentState'],
    );
    validateStateService.validateAndRepairCurrentState.and.resolveTo(true);
    const operationLogEffects = jasmine.createSpyObj<OperationLogEffects>(
      'OperationLogEffects',
      ['processDeferredActions'],
    );
    operationLogEffects.processDeferredActions.and.resolveTo();
    const conflictJournal = jasmine.createSpyObj<ConflictJournalService>(
      'ConflictJournalService',
      ['record'],
    );
    conflictJournal.record.and.resolveTo();
    const syncConflictBanner = jasmine.createSpyObj<SyncConflictBannerService>(
      'SyncConflictBannerService',
      ['maybeShowSummaryBanner', 'navigateToReview'],
    );
    syncConflictBanner.maybeShowSummaryBanner.and.resolveTo();

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogRecoveryService,
        OperationLogStoreService,
        VectorClockService,
        { provide: Store, useValue: store },
        { provide: OperationApplierService, useValue: operationApplier },
        { provide: SnackService, useValue: snackService },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj('BannerService', ['open']),
        },
        { provide: ValidateStateService, useValue: validateStateService },
        {
          provide: LegacyPfDbService,
          useValue: jasmine.createSpyObj<LegacyPfDbService>('LegacyPfDbService', [
            'hasUsableEntityData',
            'loadAllEntityData',
          ]),
        },
        {
          provide: ClientIdService,
          useValue: jasmine.createSpyObj<ClientIdService>('ClientIdService', [
            'loadClientId',
          ]),
        },
        {
          provide: SyncSessionValidationService,
          useValue: jasmine.createSpyObj('SyncSessionValidationService', ['setFailed']),
        },
        { provide: OperationLogEffects, useValue: operationLogEffects },
        { provide: ConflictJournalService, useValue: conflictJournal },
        { provide: SyncConflictBannerService, useValue: syncConflictBanner },
        { provide: CLIENT_ID_PROVIDER, useValue: clientIdProvider },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
      ],
    });

    service = TestBed.inject(ConflictResolutionService);
    recoveryService = TestBed.inject(OperationLogRecoveryService);
    opLogStore = TestBed.inject(OperationLogStoreService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    liveResolutionOps = [];
  });

  it('hydrates to the same winner that was applied live', async () => {
    const { localOp, conflicts } = createConflicts();
    await opLogStore.append(localOp, 'local');

    await service.autoResolveConflictsLWW(conflicts);

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    expect(storedEntries.length).toBe(4);
    expect(storedEntries[0].op.id).toBe('local-op');
    expect(storedEntries[1].op.id).toBe('remote-loser');
    expect(storedEntries[2].op.clientId).toBe(LOCAL_CLIENT_ID);
    expect(storedEntries[2].op.actionType).toBe(toLwwUpdateActionType('TIME_TRACKING'));
    expect(storedEntries[3].op.id).toBe('remote-winner');

    const stateBeforeResolution = applyOperations(initialState, [localOp]);
    const liveState = applyOperations(stateBeforeResolution, liveResolutionOps);
    const hydratedState = applyOperations(
      initialState,
      storedEntries.map(({ op }) => op),
    );

    expect(hydratedState).toEqual(liveState);
    expect(hydratedState[TIME_TRACKING_FEATURE_KEY]).toEqual({
      marker: 'remote-winner',
    });
  });

  it('rolls back loser and compensation when inserting the final winner fails', async () => {
    const { localOp, conflicts } = createConflicts();
    await opLogStore.setVectorClock({ [LOCAL_CLIENT_ID]: 1 });
    await opLogStore.append(localOp, 'local');

    const adapter = (
      opLogStore as unknown as {
        _adapter: OpLogDbAdapter;
      }
    )._adapter;
    const originalTransaction = adapter.transaction.bind(adapter);
    spyOn(adapter, 'transaction').and.callFake(async (stores, mode, callback) =>
      originalTransaction(stores, mode, async (tx) => {
        const failingTx = new Proxy(tx, {
          get: (target, property): unknown => {
            if (property === 'add') {
              return async (storeName: string, value: unknown) => {
                const operationId = (
                  value as { op?: { id?: unknown } } | null | undefined
                )?.op?.id;
                if (storeName === STORE_NAMES.OPS && operationId === 'remote-winner') {
                  throw new Error('injected final-winner persistence failure');
                }
                return target.add(storeName, value);
              };
            }
            const value = Reflect.get(target, property);
            return typeof value === 'function' ? value.bind(target) : value;
          },
        });
        return callback(failingTx);
      }),
    );

    await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeRejectedWithError(
      'injected final-winner persistence failure',
    );

    expect((await opLogStore.getOpsAfterSeq(0)).map(({ op }) => op.id)).toEqual([
      'local-op',
    ]);
    opLogStore.clearVectorClockCache();
    expect(await opLogStore.getVectorClock()).toEqual({ [LOCAL_CLIENT_ID]: 1 });
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
  });

  it('recovers a crash after the reducer checkpoint without replaying reducers', async () => {
    const { localOp, remoteWinner, conflicts } = createConflicts();
    await opLogStore.append(localOp, 'local');
    operationApplier.applyOperations.and.callFake(async (operations, options) => {
      liveResolutionOps = operations;
      await options?.onReducersCommitted?.(operations);
      throw new Error('simulated crash after reducer checkpoint');
    });

    await expectAsync(service.autoResolveConflictsLWW(conflicts)).toBeRejectedWithError(
      'simulated crash after reducer checkpoint',
    );

    const storedWinner = await opLogStore.getOpById(remoteWinner.id);
    expect(storedWinner?.applicationStatus).toBe('archive_pending');
    expect(await opLogStore.getPendingRemoteOps()).toEqual([]);
    expect((await opLogStore.getFailedRemoteOps()).map(({ op }) => op.id)).toEqual([
      remoteWinner.id,
    ]);

    await recoveryService.recoverPendingRemoteOps();
    expect((await opLogStore.getOpById(remoteWinner.id))?.applicationStatus).toBe(
      'archive_pending',
    );

    await opLogStore.markApplied([storedWinner!.seq]);
    expect(await opLogStore.getFailedRemoteOps()).toEqual([]);
    expect((await opLogStore.getOpById(remoteWinner.id))?.applicationStatus).toBe(
      'applied',
    );
  });

  it('recovers a crash-interrupted mixed bulk delete and converges independent clients', async () => {
    const parentId = 'parent';
    const subtaskId = 'subtask';
    const remoteWinnerId = 'remote-winner';
    const createTask = (id: string, overrides: Partial<Task> = {}): Task =>
      ({
        ...DEFAULT_TASK,
        id,
        title: id,
        projectId: 'project1',
        subTaskIds: [],
        ...overrides,
      }) as Task;
    const parent = createTask(parentId, {
      title: 'Local winning parent',
      subTaskIds: [subtaskId],
    });
    const subtask = createTask(subtaskId, {
      title: 'Surviving subtask',
      parentId,
    });
    const remoteWinner = createTask(remoteWinnerId);
    const initialTaskState = createTaskReplayState(
      [parent, subtask, remoteWinner],
      [parentId, remoteWinnerId],
    );

    const localParentEdit: Operation = {
      id: 'local-parent-edit',
      actionType: toLwwUpdateActionType('TASK'),
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: parentId,
      payload: {
        actionPayload: parent,
        entityChanges: [],
        lwwUpdateMode: 'replace',
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 2_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteBulkDelete: Operation = {
      id: 'remote-bulk-delete',
      actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
      opType: OpType.Delete,
      entityType: 'TASK',
      entityId: parentId,
      entityIds: [parentId, remoteWinnerId],
      payload: {
        actionPayload: { taskIds: [parentId, remoteWinnerId] },
        entityChanges: [],
      },
      clientId: REMOTE_CLIENT_ID,
      vectorClock: { [REMOTE_CLIENT_ID]: 1 },
      timestamp: 1_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    store.select.and.callFake((_selector: unknown, props?: { id?: string }) =>
      of(props?.id === parentId ? parent : props?.id === subtaskId ? subtask : undefined),
    );
    await opLogStore.append(localParentEdit, 'local');
    operationApplier.applyOperations.and.callFake(async (operations) => {
      liveResolutionOps = operations;
      throw new Error('simulated crash before reducer checkpoint');
    });

    await expectAsync(
      service.autoResolveConflictsLWW([
        {
          entityType: 'TASK',
          entityId: parentId,
          localOps: [localParentEdit],
          remoteOps: [remoteBulkDelete],
          suggestedResolution: 'manual',
        },
      ]),
    ).toBeRejectedWithError('simulated crash before reducer checkpoint');

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    const remoteEntry = storedEntries.find(({ op }) => op.id === remoteBulkDelete.id);
    const compensationOps = storedEntries
      .filter(({ op, source }) => source === 'local' && op.id !== localParentEdit.id)
      .map(({ op }) => op);
    expect(remoteEntry?.applicationStatus).toBe('pending');
    expect(remoteEntry?.rejectedAt).toBeUndefined();
    expect(compensationOps.map(({ entityId }) => entityId)).toEqual([
      parentId,
      subtaskId,
    ]);
    expect((await opLogStore.getPendingRemoteOps()).map(({ op }) => op.id)).toEqual([
      remoteBulkDelete.id,
    ]);

    const liveClientState = applyTaskOperations(
      initialTaskState,
      liveResolutionOps,
      LOCAL_CLIENT_ID,
    );
    const restartedClientState = applyTaskOperations(
      initialTaskState,
      storedEntries.map(({ op }) => op),
      LOCAL_CLIENT_ID,
    );
    const remoteClientState = applyTaskOperations(
      initialTaskState,
      [remoteBulkDelete, ...compensationOps],
      REMOTE_CLIENT_ID,
    );
    expect(taskShape(restartedClientState)).toEqual(taskShape(liveClientState));
    expect(taskShape(remoteClientState)).toEqual(taskShape(liveClientState));
    expect(taskShape(liveClientState)).toEqual({
      ids: [parentId, subtaskId].sort(),
      tasks: {
        [parentId]: {
          title: 'Local winning parent',
          parentId: undefined,
          subTaskIds: [subtaskId],
        },
        [subtaskId]: {
          title: 'Surviving subtask',
          parentId,
          subTaskIds: [],
        },
      },
      projectTaskIds: [parentId],
    });

    const recoveredPendingOps = await recoveryService.recoverPendingRemoteOps();
    expect(recoveredPendingOps.map(({ op }) => op.id)).toEqual([remoteBulkDelete.id]);
    expect((await opLogStore.getOpById(remoteBulkDelete.id))?.applicationStatus).toBe(
      'pending',
    );

    await opLogStore.markReducersCommittedAndMergeClocks(
      [remoteEntry!.seq],
      [remoteEntry!.op],
    );
    expect(await opLogStore.getPendingRemoteOps()).toEqual([]);
    expect((await opLogStore.getOpById(remoteBulkDelete.id))?.applicationStatus).toBe(
      'archive_pending',
    );

    const frontier = await TestBed.inject(VectorClockService).getEntityFrontier();
    expect(frontier.get(`TASK:${remoteWinnerId}`)).toEqual(remoteBulkDelete.vectorClock);
    expect(frontier.get(`TASK:${parentId}`)?.[REMOTE_CLIENT_ID]).toBe(1);
    expect(frontier.get(`TASK:${subtaskId}`)?.[REMOTE_CLIENT_ID]).toBe(1);

    await opLogStore.markApplied([remoteEntry!.seq]);
    expect(await opLogStore.getFailedRemoteOps()).toEqual([]);
    expect((await opLogStore.getOpById(remoteBulkDelete.id))?.applicationStatus).toBe(
      'applied',
    );
  });

  it('converges an outright-losing remote delete of a parent with subtasks (#8956)', async () => {
    // Pure loser: the remote delete conflicts only with the winning parent
    // edit — no uncontested sibling, so nothing is applied live. Status-blind
    // hydration still replays the durable loser (cascading the subtask), and
    // the originating client applied it long ago. Both must converge to the
    // winning subtree via the persisted compensations.
    const parentId = 'parent';
    const subtaskId = 'subtask';
    const parent: Task = {
      ...DEFAULT_TASK,
      id: parentId,
      title: 'Local winning parent',
      projectId: 'project1',
      subTaskIds: [subtaskId],
    } as Task;
    const subtask: Task = {
      ...DEFAULT_TASK,
      id: subtaskId,
      title: 'Surviving subtask',
      projectId: 'project1',
      parentId,
      subTaskIds: [],
    } as Task;
    const initialTaskState = createTaskReplayState([parent, subtask], [parentId]);

    const localParentEdit: Operation = {
      id: 'local-parent-edit',
      actionType: toLwwUpdateActionType('TASK'),
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: parentId,
      payload: {
        actionPayload: parent,
        entityChanges: [],
        lwwUpdateMode: 'replace',
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 2_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteDelete: Operation = {
      id: 'remote-delete',
      actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
      opType: OpType.Delete,
      entityType: 'TASK',
      entityId: parentId,
      entityIds: [parentId],
      payload: {
        actionPayload: { taskIds: [parentId] },
        entityChanges: [],
      },
      clientId: REMOTE_CLIENT_ID,
      vectorClock: { [REMOTE_CLIENT_ID]: 1 },
      timestamp: 1_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    store.select.and.callFake((_selector: unknown, props?: { id?: string }) =>
      of(props?.id === parentId ? parent : props?.id === subtaskId ? subtask : undefined),
    );
    await opLogStore.append(localParentEdit, 'local');

    await service.autoResolveConflictsLWW([
      {
        entityType: 'TASK',
        entityId: parentId,
        localOps: [localParentEdit],
        remoteOps: [remoteDelete],
        suggestedResolution: 'manual',
      },
    ]);

    // Nothing applies live: local state already holds the winning subtree.
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    const compensationOps = storedEntries
      .filter(({ op, source }) => source === 'local' && op.id !== localParentEdit.id)
      .map(({ op }) => op);
    expect(compensationOps.map(({ entityId }) => entityId)).toEqual([
      parentId,
      subtaskId,
    ]);
    // The durable loser precedes its compensations in seq order.
    expect(storedEntries.map(({ op }) => op.id)).toEqual([
      localParentEdit.id,
      remoteDelete.id,
      ...compensationOps.map(({ id }) => id),
    ]);

    // Restart: status-blind seq-order replay of the full log (loser + comps
    // in ONE batch — exercises the same-batch recreate exemption).
    const restartedClientState = applyTaskOperations(
      initialTaskState,
      storedEntries.map(({ op }) => op),
      LOCAL_CLIENT_ID,
    );
    // Originating client: applied its own delete earlier, then downloads the
    // compensations in a later batch (cross-batch recreate path).
    const remoteClientAfterDelete = applyTaskOperations(
      initialTaskState,
      [remoteDelete],
      REMOTE_CLIENT_ID,
    );
    expect(taskShape(remoteClientAfterDelete)).toEqual({
      ids: [],
      tasks: {},
      projectTaskIds: [],
    });
    const remoteClientState = applyTaskOperations(
      remoteClientAfterDelete,
      compensationOps,
      REMOTE_CLIENT_ID,
    );

    const expectedShape = {
      ids: [parentId, subtaskId].sort(),
      tasks: {
        [parentId]: {
          title: 'Local winning parent',
          parentId: undefined,
          subTaskIds: [subtaskId],
        },
        [subtaskId]: {
          title: 'Surviving subtask',
          parentId,
          subTaskIds: [],
        },
      },
      projectTaskIds: [parentId],
    };
    expect(taskShape(initialTaskState))
      .withContext('live state (nothing applied)')
      .toEqual(expectedShape);
    expect(taskShape(restartedClientState)).withContext('restart').toEqual(expectedShape);
    expect(taskShape(remoteClientState))
      .withContext('originating client')
      .toEqual(expectedShape);
  });

  it('converges an outright-losing remote deleteProject with exact task membership (#8997)', async () => {
    const regularTaskId = 'regular-task';
    const backlogTaskId = 'backlog-task';
    const subtaskId = 'subtask';
    const regularTask: Task = {
      ...DEFAULT_TASK,
      id: regularTaskId,
      title: 'Regular task',
      projectId: 'project1',
      subTaskIds: [subtaskId],
    } as Task;
    const backlogTask: Task = {
      ...DEFAULT_TASK,
      id: backlogTaskId,
      title: 'Backlog task',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const subtask: Task = {
      ...DEFAULT_TASK,
      id: subtaskId,
      title: 'Project subtask',
      projectId: 'project1',
      parentId: regularTaskId,
      subTaskIds: [],
    } as Task;
    const initialTaskState = createTaskReplayState(
      [regularTask, backlogTask, subtask],
      [regularTaskId],
      [backlogTaskId],
    );
    const project = initialTaskState[PROJECT_FEATURE_NAME].entities.project1;
    if (!project) {
      throw new Error('Test fixture project1 is missing.');
    }

    const localProjectEdit: Operation = {
      id: 'local-project-edit',
      actionType: toLwwUpdateActionType('PROJECT'),
      opType: OpType.Update,
      entityType: 'PROJECT',
      entityId: 'project1',
      payload: {
        actionPayload: project as unknown as Record<string, unknown>,
        entityChanges: [],
        lwwUpdateMode: 'replace',
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 2_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteProjectDelete: Operation = {
      id: 'remote-project-delete',
      actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
      opType: OpType.Delete,
      entityType: 'PROJECT',
      entityId: 'project1',
      payload: {
        actionPayload: {
          projectId: 'project1',
          // Stale deleting client knew only this root. Replay expands through
          // current project relationships; recovery must recreate the same set.
          allTaskIds: [regularTaskId],
          noteIds: [],
        },
        entityChanges: [],
      },
      clientId: REMOTE_CLIENT_ID,
      vectorClock: { [REMOTE_CLIENT_ID]: 1 },
      timestamp: 1_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    store.select.and.callFake((_selector: unknown, props?: { id?: string }) =>
      of(
        props?.id === 'project1'
          ? project
          : props?.id === regularTaskId
            ? regularTask
            : props?.id === backlogTaskId
              ? backlogTask
              : props?.id === subtaskId
                ? subtask
                : undefined,
      ),
    );
    await opLogStore.append(localProjectEdit, 'local');

    await service.autoResolveConflictsLWW([
      {
        entityType: 'PROJECT',
        entityId: 'project1',
        localOps: [localProjectEdit],
        remoteOps: [remoteProjectDelete],
        suggestedResolution: 'manual',
      },
    ]);

    expect(operationApplier.applyOperations).not.toHaveBeenCalled();

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    const compensationOps = storedEntries
      .filter(({ op, source }) => source === 'local' && op.id !== localProjectEdit.id)
      .map(({ op }) => op);
    expect(compensationOps.filter(({ entityType }) => entityType === 'TASK').length).toBe(
      4,
    );
    expect(storedEntries.map(({ op }) => op.id)).toEqual([
      localProjectEdit.id,
      remoteProjectDelete.id,
      ...compensationOps.map(({ id }) => id),
    ]);

    const restartedClientState = applyTaskOperations(
      initialTaskState,
      storedEntries.map(({ op }) => op),
      LOCAL_CLIENT_ID,
    );
    let remoteClientState = applyTaskOperations(
      initialTaskState,
      [remoteProjectDelete],
      REMOTE_CLIENT_ID,
    );
    for (const compensationOp of compensationOps) {
      remoteClientState = applyTaskOperations(
        remoteClientState,
        [compensationOp],
        REMOTE_CLIENT_ID,
      );
    }

    const assertExactWinningState = (state: RootState, context: string): void => {
      expect(taskShape(state)).withContext(context).toEqual(taskShape(initialTaskState));
      expect(state[PROJECT_FEATURE_NAME].entities.project1?.taskIds)
        .withContext(`${context}: regular task order`)
        .toEqual([regularTaskId]);
      expect(state[PROJECT_FEATURE_NAME].entities.project1?.backlogTaskIds)
        .withContext(`${context}: backlog task order`)
        .toEqual([backlogTaskId]);
    };
    assertExactWinningState(initialTaskState, 'live state (nothing applied)');
    assertExactWinningState(restartedClientState, 'restart');
    assertExactWinningState(remoteClientState, 'originating client');

    const projectCompensations = compensationOps.filter(
      ({ entityType }) => entityType === 'PROJECT',
    );
    const taskRecreations = compensationOps.filter(
      ({ entityType }) => entityType === 'TASK',
    );
    const laterProjectDelete: Operation = {
      ...remoteProjectDelete,
      id: 'later-project-delete',
      clientId: 'third-client',
      // This client saw only the first uploaded recreation before deleting the
      // partially restored project. Later task compensations must not survive.
      payload: {
        actionPayload: {
          projectId: 'project1',
          allTaskIds: [regularTaskId],
          noteIds: [],
        },
        entityChanges: [],
      },
      vectorClock: {
        [LOCAL_CLIENT_ID]: 2,
        [REMOTE_CLIENT_ID]: 1,
        ['third-client']: 1,
      },
      timestamp: 3_000,
    };
    const partiallyAcceptedServerState = applyTaskOperations(
      initialTaskState,
      [
        remoteProjectDelete,
        projectCompensations[0],
        taskRecreations[0],
        laterProjectDelete,
        ...taskRecreations.slice(1),
        // The final PROJECT compensation conflicts with laterProjectDelete and
        // is rejected, while later TASK rows are independently accepted.
      ],
      'fresh-client',
    );

    expect(partiallyAcceptedServerState[PROJECT_FEATURE_NAME].entities.project1)
      .withContext('later delete keeps the partially restored project deleted')
      .toBeUndefined();
    expect(partiallyAcceptedServerState[TASK_FEATURE_NAME].ids)
      .withContext('later task compensations cannot outlive their deleted project')
      .toEqual([]);

    const taskReplacementOps = taskRecreations.filter(
      ({ payload }) =>
        (payload as { lwwUpdateMode?: string }).lwwUpdateMode === 'replace',
    );
    const taskRelationshipOps = taskRecreations.filter(
      ({ payload }) => (payload as { lwwUpdateMode?: string }).lwwUpdateMode === 'patch',
    );
    const alreadyAcceptedTaskServerState = applyTaskOperations(
      initialTaskState,
      [
        remoteProjectDelete,
        projectCompensations[0],
        ...taskReplacementOps,
        // This delete was authored from a stale prefix that knew only about
        // regularTaskId. Its reducer must also follow the project's currently
        // established root/child relationships, without scanning all tasks.
        laterProjectDelete,
        ...taskRelationshipOps,
      ],
      'fresh-client',
    );

    expect(alreadyAcceptedTaskServerState[PROJECT_FEATURE_NAME].entities.project1)
      .withContext('stale later delete still removes the restored project')
      .toBeUndefined();
    expect(alreadyAcceptedTaskServerState[TASK_FEATURE_NAME].ids)
      .withContext('stale later delete removes already accepted roots and children')
      .toEqual([]);

    const project2 = { ...project, id: 'project2', taskIds: [], backlogTaskIds: [] };
    const initialStateWithMoveTarget: RootState = {
      ...initialTaskState,
      [PROJECT_FEATURE_NAME]: {
        ...initialTaskState[PROJECT_FEATURE_NAME],
        ids: [...(initialTaskState[PROJECT_FEATURE_NAME].ids as string[]), 'project2'],
        entities: {
          ...initialTaskState[PROJECT_FEATURE_NAME].entities,
          project2,
        },
      },
    };
    const remoteMove: Operation = {
      id: 'remote-parent-move',
      actionType: ActionType.TASK_SHARED_MOVE_TO_PROJECT,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: regularTaskId,
      payload: {
        actionPayload: {
          task: { ...regularTask, subTasks: [subtask] },
          targetProjectId: 'project2',
        },
        entityChanges: [],
      },
      clientId: 'third-client',
      vectorClock: { ['third-client']: 2 },
      timestamp: 4_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const parentRecreation = taskRecreations.find(
      ({ entityId, payload }) =>
        entityId === regularTaskId &&
        (payload as { lwwUpdateMode?: string }).lwwUpdateMode === 'replace',
    );
    if (!parentRecreation) {
      throw new Error('Expected the parent TASK recreation.');
    }
    const originalLocalOpIds = new Set(
      storedEntries.filter(({ source }) => source === 'local').map(({ op }) => op.id),
    );
    const movedRegularTask = { ...regularTask, projectId: 'project2' };
    const movedSubtask = { ...subtask, projectId: 'project2' };
    store.select.and.callFake((_selector: unknown, props?: { id?: string }) =>
      of(
        props?.id === regularTaskId
          ? movedRegularTask
          : props?.id === subtaskId
            ? movedSubtask
            : props?.id === 'project2'
              ? { ...project2, taskIds: [regularTaskId] }
              : props?.id === 'project1'
                ? { ...project, taskIds: [], backlogTaskIds: [backlogTaskId] }
                : props?.id === backlogTaskId
                  ? backlogTask
                  : undefined,
      ),
    );

    await service.autoResolveConflictsLWW([
      {
        entityType: 'TASK',
        entityId: regularTaskId,
        localOps: [parentRecreation],
        remoteOps: [remoteMove],
        suggestedResolution: 'manual',
      },
    ]);

    const remoteWinnerCompensations = (await opLogStore.getOpsAfterSeq(0))
      .filter(({ op, source }) => source === 'local' && !originalLocalOpIds.has(op.id))
      .map(({ op }) => op);
    expect(remoteWinnerCompensations.length).toBeGreaterThan(0);
    const moveWinnerState = applyTaskOperations(
      initialStateWithMoveTarget,
      [
        remoteProjectDelete,
        // The move is accepted first but cannot recreate the task removed by
        // deleteProject on a fresh client.
        remoteMove,
        projectCompensations[0],
        // The parent recovery is rejected. Independently accepted sibling rows
        // must stay harmless until the reconstructive remote-winner group lands.
        ...taskRecreations.filter(({ entityId }) => entityId !== regularTaskId),
        projectCompensations[projectCompensations.length - 1],
        ...remoteWinnerCompensations,
      ],
      'fresh-client',
    );

    expect(moveWinnerState[TASK_FEATURE_NAME].entities[regularTaskId]?.projectId).toBe(
      'project2',
    );
    expect(moveWinnerState[TASK_FEATURE_NAME].entities[subtaskId]?.projectId).toBe(
      'project2',
    );
    expect(
      moveWinnerState[TASK_FEATURE_NAME].entities[regularTaskId]?.subTaskIds,
    ).toEqual([subtaskId]);
    expect(moveWinnerState[TASK_FEATURE_NAME].entities[subtaskId]?.parentId).toBe(
      regularTaskId,
    );
    expect(moveWinnerState[PROJECT_FEATURE_NAME].entities.project1?.taskIds).toEqual([]);
    expect(
      moveWinnerState[PROJECT_FEATURE_NAME].entities.project1?.backlogTaskIds,
    ).toEqual([backlogTaskId]);
    expect(moveWinnerState[PROJECT_FEATURE_NAME].entities.project2?.taskIds).toEqual([
      regularTaskId,
    ]);
  });

  it('keeps concurrently bulk-deleted tasks deleted on every client during project recovery (#8997)', async () => {
    // A wins a project rename vs B's deleteProject (B loses LWW). In the same
    // batch, C's bulk deleteTasks([bulk-1, bulk-2]) lands as a non-conflicting
    // op. Verified at REPLAY level (not just emission): a client that applied
    // C's delete must NOT have bulk-1/bulk-2 resurrected by the recovery rows.
    const survivorId = 'survivor-task';
    const bulkId1 = 'bulk-1';
    const bulkId2 = 'bulk-2';
    const survivorTask: Task = {
      ...DEFAULT_TASK,
      id: survivorId,
      title: 'Survivor',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const bulkTask1: Task = {
      ...DEFAULT_TASK,
      id: bulkId1,
      title: 'Bulk one',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const bulkTask2: Task = {
      ...DEFAULT_TASK,
      id: bulkId2,
      title: 'Bulk two',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const initialTaskState = createTaskReplayState(
      [survivorTask, bulkTask1, bulkTask2],
      [survivorId, bulkId1, bulkId2],
    );
    const project = initialTaskState[PROJECT_FEATURE_NAME].entities.project1;
    if (!project) {
      throw new Error('Test fixture project1 is missing.');
    }

    const localProjectEdit: Operation = {
      id: 'local-project-edit',
      actionType: toLwwUpdateActionType('PROJECT'),
      opType: OpType.Update,
      entityType: 'PROJECT',
      entityId: 'project1',
      payload: {
        actionPayload: project as unknown as Record<string, unknown>,
        entityChanges: [],
        lwwUpdateMode: 'replace',
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 2_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteProjectDelete: Operation = {
      id: 'remote-project-delete',
      actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
      opType: OpType.Delete,
      entityType: 'PROJECT',
      entityId: 'project1',
      payload: {
        actionPayload: {
          projectId: 'project1',
          allTaskIds: [survivorId, bulkId1, bulkId2],
          noteIds: [],
        },
        entityChanges: [],
      },
      clientId: REMOTE_CLIENT_ID,
      vectorClock: { [REMOTE_CLIENT_ID]: 1 },
      timestamp: 1_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    // A bulk deleteTasks op carries every id in entityIds and only the first in
    // entityId, with an empty entityChanges — the shape the guard must union.
    const remoteBulkDelete: Operation = {
      id: 'remote-bulk-delete',
      actionType: ActionType.TASK_SHARED_DELETE_MULTIPLE,
      opType: OpType.Delete,
      entityType: 'TASK',
      entityId: bulkId1,
      entityIds: [bulkId1, bulkId2],
      payload: {
        actionPayload: { taskIds: [bulkId1, bulkId2] },
        entityChanges: [],
      },
      clientId: 'third-client',
      vectorClock: { ['third-client']: 1 },
      timestamp: 1_500,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    store.select.and.callFake((_selector: unknown, props?: { id?: string }) =>
      of(
        props?.id === 'project1'
          ? project
          : props?.id === survivorId
            ? survivorTask
            : props?.id === bulkId1
              ? bulkTask1
              : props?.id === bulkId2
                ? bulkTask2
                : undefined,
      ),
    );
    await opLogStore.append(localProjectEdit, 'local');

    await service.autoResolveConflictsLWW(
      [
        {
          entityType: 'PROJECT',
          entityId: 'project1',
          localOps: [localProjectEdit],
          remoteOps: [remoteProjectDelete],
          suggestedResolution: 'manual',
        },
      ],
      [remoteBulkDelete],
    );

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    const compensationOps = storedEntries
      .filter(({ op, source }) => source === 'local' && op.id !== localProjectEdit.id)
      .map(({ op }) => op);

    // A fresh client that applied B's project delete AND C's bulk delete, then
    // replays the recovery rows.
    const remoteClientState = applyTaskOperations(
      initialTaskState,
      [remoteProjectDelete, remoteBulkDelete, ...compensationOps],
      REMOTE_CLIENT_ID,
    );
    const ids = remoteClientState[TASK_FEATURE_NAME].ids as string[];
    expect(ids).withContext('the uncontested task is recovered').toContain(survivorId);
    expect(ids)
      .withContext('bulk-deleted tasks must stay deleted, not resurrected')
      .not.toContain(bulkId1);
    expect(ids)
      .withContext('every trailing bulk-deleted id must stay deleted')
      .not.toContain(bulkId2);
  });

  it('keeps a task whose delete won its own conflict deleted on every client during project recovery (#8997)', async () => {
    // A edits project P (wins vs B's deleteProject) and also edits task T; C
    // deletes T. T's own LWW conflict resolves to C's delete (remote wins).
    // Verified at REPLAY level: recovery must not resurrect T on a client that
    // applied C's delete — the borrowed `modified` timestamp does NOT make the
    // recreation lose, because it dominates the delete by clock/seq.
    const survivorId = 'survivor-task';
    const contestedId = 'contested-task';
    const survivorTask: Task = {
      ...DEFAULT_TASK,
      id: survivorId,
      title: 'Survivor',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const contestedTask: Task = {
      ...DEFAULT_TASK,
      id: contestedId,
      title: 'Contested',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const initialTaskState = createTaskReplayState(
      [survivorTask, contestedTask],
      [survivorId, contestedId],
    );
    const project = initialTaskState[PROJECT_FEATURE_NAME].entities.project1;
    if (!project) {
      throw new Error('Test fixture project1 is missing.');
    }

    const localProjectEdit: Operation = {
      id: 'local-project-edit',
      actionType: toLwwUpdateActionType('PROJECT'),
      opType: OpType.Update,
      entityType: 'PROJECT',
      entityId: 'project1',
      payload: {
        actionPayload: project as unknown as Record<string, unknown>,
        entityChanges: [],
        lwwUpdateMode: 'replace',
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 2_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteProjectDelete: Operation = {
      id: 'remote-project-delete',
      actionType: ActionType.TASK_SHARED_DELETE_PROJECT,
      opType: OpType.Delete,
      entityType: 'PROJECT',
      entityId: 'project1',
      payload: {
        actionPayload: {
          projectId: 'project1',
          allTaskIds: [survivorId, contestedId],
          noteIds: [],
        },
        entityChanges: [],
      },
      clientId: REMOTE_CLIENT_ID,
      vectorClock: { [REMOTE_CLIENT_ID]: 1 },
      timestamp: 1_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    // This client's own edit to T loses to C's delete.
    const localTaskEdit: Operation = {
      id: 'local-task-edit',
      actionType: ActionType.TASK_SHARED_UPDATE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: contestedId,
      payload: {
        actionPayload: { task: { id: contestedId, changes: { title: 'Mine' } } },
        entityChanges: [],
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 500,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteTaskDelete: Operation = {
      id: 'remote-task-delete',
      actionType: ActionType.TASK_SHARED_DELETE,
      opType: OpType.Delete,
      entityType: 'TASK',
      entityId: contestedId,
      payload: {
        actionPayload: { task: contestedTask as unknown as Record<string, unknown> },
        entityChanges: [],
      },
      clientId: 'third-client',
      vectorClock: { ['third-client']: 1 },
      timestamp: 3_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    store.select.and.callFake((_selector: unknown, props?: { id?: string }) =>
      of(
        props?.id === 'project1'
          ? project
          : props?.id === survivorId
            ? survivorTask
            : props?.id === contestedId
              ? contestedTask
              : undefined,
      ),
    );
    await opLogStore.append(localProjectEdit, 'local');
    await opLogStore.append(localTaskEdit, 'local');

    await service.autoResolveConflictsLWW([
      {
        entityType: 'PROJECT',
        entityId: 'project1',
        localOps: [localProjectEdit],
        remoteOps: [remoteProjectDelete],
        suggestedResolution: 'manual',
      },
      {
        entityType: 'TASK',
        entityId: contestedId,
        localOps: [localTaskEdit],
        remoteOps: [remoteTaskDelete],
        suggestedResolution: 'manual',
      },
    ]);

    const storedEntries = await opLogStore.getOpsAfterSeq(0);
    const compensationOps = storedEntries
      .filter(
        ({ op, source }) =>
          source === 'local' &&
          op.id !== localProjectEdit.id &&
          op.id !== localTaskEdit.id,
      )
      .map(({ op }) => op);

    // A fresh client that applied B's project delete AND C's winning task
    // delete, then replays the recovery rows.
    const remoteClientState = applyTaskOperations(
      initialTaskState,
      [remoteProjectDelete, remoteTaskDelete, ...compensationOps],
      REMOTE_CLIENT_ID,
    );
    const ids = remoteClientState[TASK_FEATURE_NAME].ids as string[];
    expect(ids).withContext('the uncontested task is recovered').toContain(survivorId);
    expect(ids)
      .withContext('a task whose delete won its conflict must stay deleted')
      .not.toContain(contestedId);
  });

  it('keeps a winning remote archive as an archive on every client', async () => {
    const taskId = 'task-to-archive';
    const task = {
      ...DEFAULT_TASK,
      id: taskId,
      title: 'Task to archive',
      projectId: 'project1',
      subTaskIds: [],
    } as Task;
    const initialArchiveState = createTaskReplayState([task], [taskId]);
    const localDelete: Operation = {
      id: 'local-delete',
      actionType: ActionType.TASK_SHARED_DELETE,
      opType: OpType.Delete,
      entityType: 'TASK',
      entityId: taskId,
      payload: {
        actionPayload: { task },
        entityChanges: [],
      },
      clientId: LOCAL_CLIENT_ID,
      vectorClock: { [LOCAL_CLIENT_ID]: 1 },
      timestamp: 2_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    const remoteArchive: Operation = {
      id: 'remote-archive',
      actionType: ActionType.TASK_SHARED_MOVE_TO_ARCHIVE,
      opType: OpType.Update,
      entityType: 'TASK',
      entityId: taskId,
      entityIds: [taskId],
      payload: {
        actionPayload: { tasks: [{ ...task, subTasks: [] }] },
        entityChanges: [],
      },
      clientId: REMOTE_CLIENT_ID,
      vectorClock: { [REMOTE_CLIENT_ID]: 1 },
      timestamp: 1_000,
      schemaVersion: CURRENT_SCHEMA_VERSION,
    };
    store.select.and.returnValue(of(undefined));
    await opLogStore.append(localDelete, 'local');

    await service.autoResolveConflictsLWW([
      {
        entityType: 'TASK',
        entityId: taskId,
        localOps: [localDelete],
        remoteOps: [remoteArchive],
        suggestedResolution: 'manual',
      },
    ]);

    expect(liveResolutionOps).toEqual([remoteArchive]);
    const storedArchive = await opLogStore.getOpById(remoteArchive.id);
    expect(storedArchive?.op.actionType).toBe(ActionType.TASK_SHARED_MOVE_TO_ARCHIVE);
    expect(storedArchive?.applicationStatus).toBe('applied');
    expect(storedArchive?.rejectedAt).toBeUndefined();

    const locallyDeletedState = applyTaskOperations(
      initialArchiveState,
      [localDelete],
      LOCAL_CLIENT_ID,
    );
    const localClientResult = applyTaskOperations(
      locallyDeletedState,
      liveResolutionOps,
      LOCAL_CLIENT_ID,
    );
    const remoteClientResult = applyTaskOperations(
      initialArchiveState,
      [remoteArchive],
      REMOTE_CLIENT_ID,
    );
    expect(localClientResult[TASK_FEATURE_NAME]).toEqual(
      remoteClientResult[TASK_FEATURE_NAME],
    );
    expect(localClientResult[TASK_FEATURE_NAME].ids).toEqual([]);
  });
});
