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
  const createTaskReplayState = (tasks: Task[], projectTaskIds: string[]): RootState => {
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
            backlogTaskIds: [],
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
