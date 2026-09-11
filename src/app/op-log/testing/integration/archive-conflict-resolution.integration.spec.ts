import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { of, Subject, Subscription } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { DEFAULT_TASK, Task, TaskWithSubTasks } from '../../../features/tasks/task.model';
import { roundTimeSpentForDay } from '../../../features/tasks/store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
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
import { ValidateStateService } from '../../validation/validate-state.service';
import { compareVectorClocks, VectorClockComparison } from '@sp/sync-core';
import {
  ApplyOperationsOptions,
  ApplyOperationsResult,
} from '../../core/types/apply.types';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

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
    expect(bulkOp.entityIds).toEqual([TASK_A, TASK_B, TASK_C, TASK_D]);

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
    expect(replacement.entityIds).toEqual([TASK_B, TASK_C, TASK_D]);
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
    // Exactly the replacement + the restore op — nothing else re-asserted.
    expect(pending.length).toBe(2);
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
});
