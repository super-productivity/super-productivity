import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, createSelector, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { BannerService } from '../../../core/banner/banner.service';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ArchiveModel } from '../../../features/archive/archive.model';
import { ArchiveService } from '../../../features/archive/archive.service';
import { TaskArchiveService } from '../../../features/archive/task-archive.service';
import { TAG_FEATURE_NAME } from '../../../features/tag/store/tag.reducer';
import { TODAY_TAG } from '../../../features/tag/tag.const';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import {
  TASK_FEATURE_NAME,
  taskReducer,
} from '../../../features/tasks/store/task.reducer';
import { TimeTrackingService } from '../../../features/time-tracking/time-tracking.service';
import { createCombinedTaskSharedMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { createBaseState } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { RootState } from '../../../root-store/root-state';
import { ArchiveOperationHandler } from '../../apply/archive-operation-handler.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { convertOpToAction } from '../../apply/operation-converter.util';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { EntityConflict, Operation } from '../../core/operation.types';
import { PersistentAction } from '../../core/persistent-action.interface';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ConflictJournalService } from '../../sync/conflict-journal.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { SyncConflictBannerService } from '../../sync/sync-conflict-banner.service';
import { SyncSessionValidationService } from '../../sync/sync-session-validation.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { ValidateStateService } from '../../validation/validate-state.service';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

describe('restoreTask delete-conflict integration (#9263)', () => {
  const LOCAL_CLIENT_ID = 'delete-client';
  const REMOTE_CLIENT_ID = 'restore-client';
  const PARENT_ID = 'archived-parent';
  const SUBTASK_ID = 'archived-subtask';
  const RESTORE_DAY = '2026-07-23';

  let resolver: ConflictResolutionService;
  let opLogStore: OperationLogStoreService;
  let capture: OperationCaptureService;
  let archiveDb: ArchiveDbAdapter;
  let archiveHandler: ArchiveOperationHandler;
  let reducer: ActionReducer<RootState, Action>;
  let initialState: RootState;
  let localState: RootState;
  let currentClientId: string;

  const subtask: Task = {
    ...DEFAULT_TASK,
    id: SUBTASK_ID,
    title: 'Archived subtask',
    projectId: 'project1',
    parentId: PARENT_ID,
  };
  const deletedParent: Task = {
    ...DEFAULT_TASK,
    id: PARENT_ID,
    title: 'Archived parent',
    projectId: 'project1',
    subTaskIds: [SUBTASK_ID],
  };
  const deletedParentWithSubtasks: TaskWithSubTasks = {
    ...deletedParent,
    subTasks: [subtask],
  };

  const archiveModel = (tasks: Task[]): ArchiveModel =>
    ({
      task: {
        ids: tasks.map(({ id }) => id),
        entities: Object.fromEntries(tasks.map((task) => [task.id, task])),
      },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    }) as ArchiveModel;

  const captureOperation = (
    action: PersistentAction,
    client: TestClient,
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

  const replay = (state: RootState, operations: Operation[]): RootState =>
    operations.reduce(
      (currentState, operation) => reducer(currentState, convertOpToAction(operation)),
      state,
    );

  const restoredProjection = (state: RootState): object => {
    const parent = state.tasks.entities[PARENT_ID];
    const restoredSubtask = state.tasks.entities[SUBTASK_ID];
    return {
      parent: {
        id: parent?.id,
        projectId: parent?.projectId,
        subTaskIds: parent?.subTaskIds,
        dueDay: parent?.dueDay,
        dueWithTime: parent?.dueWithTime,
        remindAt: parent?.remindAt,
        isDone: parent?.isDone,
      },
      subtask: {
        id: restoredSubtask?.id,
        parentId: restoredSubtask?.parentId,
        projectId: restoredSubtask?.projectId,
        dueDay: restoredSubtask?.dueDay,
        dueWithTime: restoredSubtask?.dueWithTime,
        remindAt: restoredSubtask?.remindAt,
      },
      projectTaskIds: state.projects.entities.project1?.taskIds,
      todayTaskIds: state[TAG_FEATURE_NAME].entities[TODAY_TAG.id]?.taskIds,
    };
  };

  beforeEach(async () => {
    resetTestUuidCounter();
    currentClientId = LOCAL_CLIENT_ID;

    const baseState = createBaseState();
    const project = baseState.projects.entities.project1;
    if (!project) {
      throw new Error('Test fixture project1 is missing');
    }
    initialState = {
      ...baseState,
      tasks: {
        ...baseState.tasks,
        ids: [PARENT_ID, SUBTASK_ID],
        entities: {
          [PARENT_ID]: deletedParent,
          [SUBTASK_ID]: subtask,
        },
      },
      projects: {
        ...baseState.projects,
        entities: {
          ...baseState.projects.entities,
          project1: {
            ...project,
            taskIds: [PARENT_ID],
          },
        },
      },
    };

    const rootReducer: ActionReducer<RootState, Action> = (
      state = initialState,
      action,
    ) => ({
      ...state,
      [TASK_FEATURE_NAME]: taskReducer(state[TASK_FEATURE_NAME], action),
    });
    reducer = createCombinedTaskSharedMetaReducer(
      lwwUpdateMetaReducer(rootReducer),
    ) as ActionReducer<RootState, Action>;

    const deleteAction = TaskSharedActions.deleteTask({
      task: deletedParentWithSubtasks,
    }) as PersistentAction;
    localState = reducer(initialState, deleteAction);

    const store = jasmine.createSpyObj<Store>('Store', ['select']);
    store.select.and.callFake((selector: unknown, props?: unknown) => {
      if (typeof selector !== 'function') {
        return of(undefined) as ReturnType<Store['select']>;
      }
      return of(
        (selector as (state: RootState, selectorProps?: unknown) => unknown)(
          localState,
          props,
        ),
      ) as ReturnType<Store['select']>;
    });

    const operationApplier = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
    operationApplier.applyOperations.and.callFake(async (operations, options) => {
      localState = replay(localState, operations);
      await options?.onReducersCommitted?.(operations);
      return { appliedOps: operations };
    });

    const validateState = jasmine.createSpyObj<ValidateStateService>(
      'ValidateStateService',
      ['validateAndRepairCurrentState'],
    );
    validateState.validateAndRepairCurrentState.and.resolveTo(true);
    const operationLogEffects = jasmine.createSpyObj<OperationLogEffects>(
      'OperationLogEffects',
      ['processDeferredActions'],
    );
    operationLogEffects.processDeferredActions.and.resolveTo();
    const conflictJournal = jasmine.createSpyObj<ConflictJournalService>(
      'ConflictJournalService',
      ['record'],
      { unreviewedCount: signal(0) },
    );
    conflictJournal.record.and.resolveTo();
    const syncConflictBanner = jasmine.createSpyObj<SyncConflictBannerService>(
      'SyncConflictBannerService',
      ['maybeShowSummaryBanner', 'navigateToReview'],
    );
    syncConflictBanner.maybeShowSummaryBanner.and.resolveTo();
    const snack = jasmine.createSpyObj<SnackService>('SnackService', [
      'open',
      'hasPendingPersistentAction',
    ]);
    snack.hasPendingPersistentAction.and.returnValue(false);

    const entityRegistry = buildEntityRegistry();
    const taskConfig = entityRegistry.TASK;
    if (!taskConfig) {
      throw new Error('TASK entity config is required');
    }
    taskConfig.selectById = createSelector(
      (state: RootState) => state[TASK_FEATURE_NAME],
      (state, props: { id: string }) => state.entities[props.id] as Task | undefined,
    ) as NonNullable<typeof taskConfig.selectById>;

    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogStoreService,
        OperationCaptureService,
        ArchiveDbAdapter,
        ArchiveOperationHandler,
        TaskArchiveService,
        { provide: Store, useValue: store },
        { provide: OperationApplierService, useValue: operationApplier },
        { provide: ValidateStateService, useValue: validateState },
        { provide: OperationLogEffects, useValue: operationLogEffects },
        { provide: ConflictJournalService, useValue: conflictJournal },
        { provide: SyncConflictBannerService, useValue: syncConflictBanner },
        { provide: SnackService, useValue: snack },
        {
          provide: BannerService,
          useValue: jasmine.createSpyObj<BannerService>('BannerService', ['open']),
        },
        {
          provide: SyncSessionValidationService,
          useValue: jasmine.createSpyObj<SyncSessionValidationService>(
            'SyncSessionValidationService',
            ['setFailed'],
          ),
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: () => Promise.resolve(currentClientId),
            getOrGenerateClientId: () => Promise.resolve(currentClientId),
            clearCache: () => {},
          },
        },
        { provide: ENTITY_REGISTRY, useValue: entityRegistry },
        { provide: ArchiveService, useValue: {} },
        { provide: TimeTrackingService, useValue: {} },
      ],
    });

    resolver = TestBed.inject(ConflictResolutionService);
    opLogStore = TestBed.inject(OperationLogStoreService);
    capture = TestBed.inject(OperationCaptureService);
    archiveDb = TestBed.inject(ArchiveDbAdapter);
    archiveHandler = TestBed.inject(ArchiveOperationHandler);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await archiveDb.saveArchiveYoung(archiveModel([deletedParent, subtask]));
    await archiveDb.saveArchiveOld(archiveModel([]));
  });

  afterEach(async () => {
    await archiveDb.saveArchiveYoung(archiveModel([]));
    await archiveDb.saveArchiveOld(archiveModel([]));
    await opLogStore._clearAllDataForTesting();
    TestBed.resetTestingModule();
  });

  it('replays a winning remote restore after a local delete without leaving archived copies', async () => {
    const localClient = new TestClient(LOCAL_CLIENT_ID);
    const remoteClient = new TestClient(REMOTE_CLIENT_ID);
    const deleteAction = TaskSharedActions.deleteTask({
      task: deletedParentWithSubtasks,
    }) as PersistentAction;
    const restoreAction = TaskSharedActions.restoreTask({
      task: deletedParent,
      subTasks: [subtask],
      restoreToToday: {
        today: RESTORE_DAY,
        startOfNextDayDiffMs: 0,
      },
    }) as PersistentAction;
    const localDelete = captureOperation(deleteAction, localClient, 1_000);
    const remoteRestore = captureOperation(restoreAction, remoteClient, 2_000);
    const conflict: EntityConflict = {
      entityType: 'TASK',
      entityId: PARENT_ID,
      localOps: [localDelete],
      remoteOps: [remoteRestore],
      suggestedResolution: 'manual',
    };

    await opLogStore.append(localDelete, 'local');
    await resolver.autoResolveConflictsLWW([conflict]);

    const storedOperations = (await opLogStore.getOpsAfterSeq(0)).map(({ op }) => op);
    const storedRestore = storedOperations.find(({ id }) => id === remoteRestore.id);
    if (!storedRestore) {
      throw new Error('Resolved restore operation was not persisted');
    }
    const storedRestoreAction = convertOpToAction(storedRestore) as ReturnType<
      typeof TaskSharedActions.restoreTask
    >;
    expect(storedRestoreAction.type).toBe(TaskSharedActions.restoreTask.type);
    expect(storedRestoreAction.restoreToToday).toEqual({
      today: RESTORE_DAY,
      startOfNextDayDiffMs: 0,
    });
    expect(storedRestoreAction.subTasks.map(({ id }) => id)).toEqual([SUBTASK_ID]);

    const restartedState = replay(initialState, storedOperations);

    expect(restartedState.tasks.ids).toContain(PARENT_ID);
    expect(restartedState.tasks.ids).toContain(SUBTASK_ID);
    expect(restartedState.tasks.entities[PARENT_ID]?.subTaskIds).toEqual([SUBTASK_ID]);
    expect(restartedState.tasks.entities[SUBTASK_ID]?.parentId).toBe(PARENT_ID);
    expect(restartedState.tasks.entities[PARENT_ID]?.dueDay).toBe(RESTORE_DAY);
    expect(restartedState.tasks.entities[SUBTASK_ID]?.dueDay).toBeUndefined();
    expect(restartedState.tasks.entities[PARENT_ID]?.tagIds).not.toContain(TODAY_TAG.id);
    expect(restartedState.tasks.entities[SUBTASK_ID]?.tagIds).not.toContain(TODAY_TAG.id);
    expect(restartedState[TAG_FEATURE_NAME].entities[TODAY_TAG.id]?.taskIds).toEqual([
      PARENT_ID,
    ]);

    for (const operation of storedOperations) {
      await archiveHandler.handleOperation(convertOpToAction(operation));
    }

    expect((await archiveDb.loadArchiveYoung())?.task.ids).toEqual([]);
    expect((await archiveDb.loadArchiveOld())?.task.ids).toEqual([]);

    const deleteClientProjection = restoredProjection(localState);
    expect(restoredProjection(restartedState)).toEqual(deleteClientProjection);
  });

  it('re-emits a winning local restore after a remote delete for replay and archive convergence', async () => {
    currentClientId = REMOTE_CLIENT_ID;

    const deleteClient = new TestClient(LOCAL_CLIENT_ID);
    const restoreClient = new TestClient(REMOTE_CLIENT_ID);
    const deleteAction = TaskSharedActions.deleteTask({
      task: deletedParentWithSubtasks,
    }) as PersistentAction;
    const restoreAction = TaskSharedActions.restoreTask({
      task: deletedParent,
      subTasks: [subtask],
      restoreToToday: {
        today: RESTORE_DAY,
        startOfNextDayDiffMs: 0,
      },
    }) as PersistentAction;
    const remoteDelete = captureOperation(deleteAction, deleteClient, 1_000);
    const localRestore = captureOperation(restoreAction, restoreClient, 2_000);

    localState = reducer(localState, restoreAction);
    await archiveHandler.handleOperation(restoreAction);
    await opLogStore.append(localRestore, 'local');

    await resolver.autoResolveConflictsLWW([
      {
        entityType: 'TASK',
        entityId: PARENT_ID,
        localOps: [localRestore],
        remoteOps: [remoteDelete],
        suggestedResolution: 'manual',
      },
    ]);

    const restoreClientOperations = (await opLogStore.getOpsAfterSeq(0)).map(
      ({ op }) => op,
    );
    const replacementRestore = restoreClientOperations.find(
      (operation) =>
        operation.id !== localRestore.id &&
        operation.actionType === TaskSharedActions.restoreTask.type,
    );

    if (!replacementRestore) {
      throw new Error('Semantic replacement restore was not persisted');
    }
    expect(replacementRestore.payload).toEqual(localRestore.payload);
    const remoteDeleteIndex = restoreClientOperations.findIndex(
      ({ id }) => id === remoteDelete.id,
    );
    const replacementRestoreIndex = restoreClientOperations.findIndex(
      ({ id }) => id === replacementRestore.id,
    );
    expect(remoteDeleteIndex).toBeGreaterThan(-1);
    expect(remoteDeleteIndex).toBeLessThan(replacementRestoreIndex);

    const replacementRestoreAction = convertOpToAction(replacementRestore) as ReturnType<
      typeof TaskSharedActions.restoreTask
    >;
    expect(replacementRestoreAction.type).toBe(TaskSharedActions.restoreTask.type);
    expect(replacementRestoreAction.restoreToToday).toEqual({
      today: RESTORE_DAY,
      startOfNextDayDiffMs: 0,
    });
    expect(replacementRestoreAction.subTasks.map(({ id }) => id)).toEqual([SUBTASK_ID]);

    const restartedState = replay(initialState, restoreClientOperations);
    expect(restoredProjection(restartedState)).toEqual(restoredProjection(localState));
    expect(restartedState.tasks.entities[PARENT_ID]?.subTaskIds).toEqual([SUBTASK_ID]);
    expect(restartedState.tasks.entities[SUBTASK_ID]?.parentId).toBe(PARENT_ID);
    expect(restartedState[TAG_FEATURE_NAME].entities[TODAY_TAG.id]?.taskIds).toEqual([
      PARENT_ID,
    ]);

    const receivingState = replay(reducer(initialState, deleteAction), [
      replacementRestore,
    ]);
    expect(restoredProjection(receivingState)).toEqual(restoredProjection(localState));

    await archiveDb.saveArchiveYoung(archiveModel([deletedParent]));
    await archiveDb.saveArchiveOld(archiveModel([subtask]));
    await archiveHandler.handleOperation(replacementRestoreAction);
    expect((await archiveDb.loadArchiveYoung())?.task.ids).toEqual([]);
    expect((await archiveDb.loadArchiveOld())?.task.ids).toEqual([]);
  });
});
