import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { Subject, Subscription } from 'rxjs';
import { ArchiveDbAdapter } from '../../../core/persistence/archive-db-adapter.service';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { ArchiveModel } from '../../../features/archive/archive.model';
import { TaskArchiveService } from '../../../features/archive/task-archive.service';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { UnsupportedMultiEntityConflictError } from '../../core/errors/sync-errors';
import { ActionType, Operation } from '../../core/operation.types';
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
import { ValidateStateService } from '../../validation/validate-state.service';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

describe('unsupported archive multi-entity conflict integration (#9405)', () => {
  const LOCAL_CLIENT_ID = 'archive-client';
  const REMOTE_CLIENT_ID = 'remote-client';
  const YOUNG_TASK_ID = 'rpt_cfg-young_2026-07-30';
  const OLD_TASK_ID = 'rpt_cfg-old_2026-06-30';

  let archiveDb: ArchiveDbAdapter;
  let taskArchive: TaskArchiveService;
  let opLogStore: OperationLogStoreService;
  let capture: OperationCaptureService;
  let writeFlush: OperationWriteFlushService;
  let resolver: ConflictResolutionService;
  let journal: ConflictJournalService;
  let operationApplier: jasmine.SpyObj<OperationApplierService>;
  let store: jasmine.SpyObj<Store>;
  let actions$: Subject<Action>;
  let effectSubscription: Subscription;

  const createArchivedTask = (id: string): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Archived ${id}`,
    projectId: 'project1',
    isDone: true,
    doneOn: 1_000,
  });

  const archiveModel = (tasks: Task[]): ArchiveModel =>
    ({
      task: {
        ids: tasks.map(({ id }) => id),
        entities: Object.fromEntries(tasks.map((task) => [task.id, task])),
      },
      timeTracking: { project: {}, tag: {} },
      lastTimeTrackingFlush: 0,
    }) as ArchiveModel;

  beforeEach(async () => {
    resetTestUuidCounter();
    clearDeferredActions();
    actions$ = new Subject<Action>();
    store = jasmine.createSpyObj<Store>('Store', ['dispatch']);

    operationApplier = jasmine.createSpyObj<OperationApplierService>(
      'OperationApplierService',
      ['applyOperations'],
    );
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

    const entityRegistry = buildEntityRegistry();
    TestBed.configureTestingModule({
      providers: [
        ConflictResolutionService,
        OperationLogEffects,
        OperationLogStoreService,
        OperationCaptureService,
        TaskArchiveService,
        ArchiveDbAdapter,
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
        { provide: ENTITY_REGISTRY, useValue: entityRegistry },
      ],
    });

    archiveDb = TestBed.inject(ArchiveDbAdapter);
    taskArchive = TestBed.inject(TaskArchiveService);
    opLogStore = TestBed.inject(OperationLogStoreService);
    capture = TestBed.inject(OperationCaptureService);
    writeFlush = TestBed.inject(OperationWriteFlushService);
    resolver = TestBed.inject(ConflictResolutionService);
    journal = TestBed.inject(ConflictJournalService);
    capture.clear();
    store.dispatch.and.callFake(((action: Action): void => {
      if (!isPersistentAction(action)) {
        throw new Error('Expected a persistent archive action');
      }
      capture.incrementPending(action);
      actions$.next(action);
    }) as Store['dispatch']);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
    await journal.clearAll();
    await archiveDb.saveArchiveYoung(archiveModel([createArchivedTask(YOUNG_TASK_ID)]));
    await archiveDb.saveArchiveOld(archiveModel([createArchivedTask(OLD_TASK_ID)]));
    effectSubscription =
      TestBed.inject(OperationLogEffects).persistOperation$.subscribe();
  });

  afterEach(async () => {
    await writeFlush.flushPendingWrites();
    effectSubscription.unsubscribe();
    actions$.complete();
    capture.clear();
    clearDeferredActions();
    await archiveDb.saveArchiveYoung(archiveModel([]));
    await archiveDb.saveArchiveOld(archiveModel([]));
    await opLogStore._clearAllDataForTesting();
    await journal.clearAll();
    TestBed.resetTestingModule();
  });

  /**
   * Races the pending local operation against one concurrent remote edit of
   * `targetTaskId` and returns whatever `autoResolveConflictsLWW` threw.
   */
  const raceConcurrentRemoteEdit = async (
    targetTaskId: string,
    localOperation: Operation,
  ): Promise<unknown> => {
    const remoteAction = TaskSharedActions.updateTask({
      task: { id: targetTaskId, changes: { title: 'Concurrent remote occurrence' } },
    }) as PersistentAction;
    const { type, meta, ...actionPayload } = remoteAction;
    const remoteOperation = {
      ...new TestClient(REMOTE_CLIENT_ID).createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: targetTaskId,
        payload: {
          actionPayload,
          entityChanges: capture.extractEntityChanges(remoteAction),
        },
      }),
      timestamp: localOperation.timestamp + 1,
    };
    const detection = await resolver.checkOpForConflicts(remoteOperation, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detection.conflicts.length).toBeGreaterThan(0);

    try {
      await resolver.autoResolveConflictsLWW(detection.conflicts);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  const pendingLocalOperation = async (): Promise<Operation> => {
    await writeFlush.flushPendingWrites();
    const unsynced = await opLogStore.getUnsynced();
    expect(unsynced.length).toBe(1);
    return unsynced[0]!.op;
  };

  it('reports the captured archive action and fails closed before mutation', async () => {
    // Reproduces the updateTasks defect class, not the unconfirmed action in #9405.
    const updates = [
      { id: YOUNG_TASK_ID, changes: { title: 'Updated young occurrence' } },
      { id: OLD_TASK_ID, changes: { title: 'Updated old occurrence' } },
    ];
    await taskArchive.updateTasks(updates);

    const localOperation = await pendingLocalOperation();
    expect(localOperation.actionType).toBe(ActionType.TASK_SHARED_UPDATE_MULTIPLE);
    expect(localOperation.entityIds).toEqual([YOUNG_TASK_ID, OLD_TASK_ID]);
    expect(localOperation.payload).toEqual({
      actionPayload: { tasks: updates },
      entityChanges: [],
    });

    const thrown = await raceConcurrentRemoteEdit(YOUNG_TASK_ID, localOperation);

    expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
    expect((thrown as Error).message).toBe(
      'SYNC_MULTI_ENTITY_UNSUPPORTED side=local ' +
        `actionType=${ActionType.TASK_SHARED_UPDATE_MULTIPLE} entityCount=2`,
    );
    expect((thrown as Error).message).not.toContain(YOUNG_TASK_ID);
    expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).toEqual([
      localOperation.id,
    ]);
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
  });

  describe('reachability of the guard beyond bulk actions', () => {
    // The report reads as a recurring-task problem, but the guard is not
    // scoped to one. Every action below carries >1 entityId and is neither an
    // independent multi-delete, decomposable, a resolvable Today-list op, nor
    // a bulk archive, so one pending local op plus one concurrent remote edit
    // of the same task is enough to stop sync. This pins the REMAINING blocked
    // surface; the formerly-pinned Today-list cases (moveTaskInTodayTagList,
    // planTasksForToday, removeTasksFromTodayTag) resolve since #9426 and are
    // covered by today-plan-conflict-resolution.integration.spec.ts, and the
    // formerly-pinned finish-day archive-vs-archive race resolves via the
    // scoped-replacement path (#9537) covered by
    // archive-conflict-resolution.integration.spec.ts.
    //
    // Each case notes its production dispatcher, because "an action creator
    // exists" is not the same claim as "a user can trigger it".
    const CASES: { name: string; action: () => PersistentAction }[] = [
      {
        // No production dispatcher since 6bb0472549 (v18.14.0) removed the tag
        // dialog; tag edits now go through the single-entity updateTask. Kept
        // because the op shape still arrives from older peers and from local
        // ops captured before that release, and both reach this guard.
        name: 'a legacy addTagToTask op from an older client',
        action: () =>
          TaskSharedActions.addTagToTask({
            taskId: YOUNG_TASK_ID,
            tagId: 'tag-1',
          }) as PersistentAction,
      },
    ];

    CASES.forEach(({ name, action }) => {
      it(`names the blocked action for ${name}`, async () => {
        const dispatched = action();
        store.dispatch(dispatched);

        const localOperation = await pendingLocalOperation();
        const thrown = await raceConcurrentRemoteEdit(YOUNG_TASK_ID, localOperation);

        expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
        expect((thrown as Error).message).toBe(
          'SYNC_MULTI_ENTITY_UNSUPPORTED side=local ' +
            `actionType=${dispatched.type} entityCount=2`,
        );
        expect(operationApplier.applyOperations).not.toHaveBeenCalled();
      });
    });
  });
});
