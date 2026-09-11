import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { of, Subject, Subscription } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';
import { roundTimeSpentForDay } from '../../../features/tasks/store/task.actions';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { UnsupportedMultiEntityConflictError } from '../../core/errors/sync-errors';
import {
  ActionType,
  EntityConflict,
  Operation,
  OpType,
} from '../../core/operation.types';
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
 * #9601: device A's "Finish day" rounds time spent across many tasks in ONE
 * atomic multi-task `roundTimeSpentForDay` op. When device B has concurrent
 * pending edits on any of those tasks, the downloaded rounding op used to fail
 * the multi-entity preflight with
 * `SYNC_MULTI_ENTITY_UNSUPPORTED side=remote actionType=[Task] RoundTimeSpentForDay`
 * and wedge sync on every retry — the same action type already had a local-side
 * decomposable path (#9561), but no remote-side exemption. These specs pin the
 * resolution behavior: the rounding op replays atomically (uncontested siblings
 * converge exactly — no concurrent ops means their values equal the sender's
 * pre-rounding values), local winners are re-asserted by compensation snapshots
 * applied after it, and a malformed payload whose declared entity ids disagree
 * with its replay write set keeps the fail-closed stop.
 */
describe('remote round-time-spent conflict resolution integration (#9601)', () => {
  const LOCAL_CLIENT_ID = 'round-client';
  const REMOTE_CLIENT_ID = 'remote-client';
  const TASK_A = 'task-a';
  const TASK_B = 'task-b';
  const TASK_C = 'task-c';
  const ROUND_DAY = '2026-08-14';

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

  beforeEach(async () => {
    resetTestUuidCounter();
    clearDeferredActions();
    actions$ = new Subject<Action>();
    store = jasmine.createSpyObj<Store>('Store', ['dispatch', 'select']);
    taskStateById = {};
    // Serve current entity state for compensation snapshots from a plain map.
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

  const buildRemoteRoundTimeOp = (
    client: TestClient,
    taskIds: string[],
    timestamp: number,
    entityIds: string[] = taskIds,
    projectId?: string | null,
  ): Operation => {
    const remoteAction = roundTimeSpentForDay({
      day: ROUND_DAY,
      taskIds,
      roundTo: '5M',
      isRoundUp: true,
      projectId,
    }) as PersistentAction;
    const { type, meta, ...actionPayload } = remoteAction;
    return {
      ...client.createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: entityIds[0],
        entityIds,
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

  it('resolves a remote finish-day rounding op racing a newer local edit (mixed winners)', async () => {
    // LOCAL (device B, next morning): a pending edit on one of the tasks the
    // remote rounding covers — the newer timestamp makes it the local winner.
    const [localEditOp] = await dispatchAndFlush(
      TaskSharedActions.updateTask({
        task: { id: TASK_A, changes: { title: 'Local morning edit' } },
      }) as PersistentAction,
    );
    taskStateById[TASK_A] = {
      ...DEFAULT_TASK,
      id: TASK_A,
      title: 'Local morning edit',
      projectId: 'project1',
    };

    // REMOTE (device A, previous evening): "Finish day" rounded 3 tasks at once.
    const remoteRoundOp = buildRemoteRoundTimeOp(
      remoteClient(),
      [TASK_A, TASK_B, TASK_C],
      localEditOp.timestamp - 1,
    );
    const conflicts = await detectConflictsFor(remoteRoundOp);

    await resolver.autoResolveConflictsLWW(conflicts);

    // The original local edit is rejected; ONLY the compensation snapshot
    // stays pending for upload, dominating both concurrent originals and
    // keeping the local winner's timestamp.
    const pending = await unsyncedOps();
    expect(pending.length).toBe(1);
    const compensation = pending[0];
    expect(compensation.id).not.toBe(localEditOp.id);
    expect(compensation.entityId).toBe(TASK_A);
    expect(
      (compensation.payload as { actionPayload?: { title?: string } }).actionPayload
        ?.title,
    ).toBe('Local morning edit');
    expect(compensation.timestamp).toBe(localEditOp.timestamp);
    expectDominates(compensation, localEditOp);
    expectDominates(compensation, remoteRoundOp);

    // The atomic rounding op is applied once (uncontested siblings B and C get
    // their rounding), then task A's local-win compensation replays after it.
    const appliedIds = appliedOps().map(({ id }) => id);
    expect(appliedIds).toContain(remoteRoundOp.id);
    expect(appliedIds).toContain(compensation.id);
    expect(appliedIds.indexOf(remoteRoundOp.id)).toBeLessThan(
      appliedIds.indexOf(compensation.id),
    );
  });

  it('applies the rounding atomically when the remote side wins the shared task', async () => {
    const [localEditOp] = await dispatchAndFlush(
      TaskSharedActions.updateTask({
        task: { id: TASK_A, changes: { title: 'Older local edit' } },
      }) as PersistentAction,
    );
    // The conflicted task IS writable by the rounding op (no project limit, no
    // subtasks) — pins that the unwritable-target local-win override below
    // does NOT fire for genuinely rounded targets.
    taskStateById[TASK_A] = {
      ...DEFAULT_TASK,
      id: TASK_A,
      title: 'Older local edit',
      projectId: 'project1',
    };

    const remoteRoundOp = buildRemoteRoundTimeOp(
      remoteClient(),
      [TASK_A, TASK_B, TASK_C],
      localEditOp.timestamp + 1,
    );
    const conflicts = await detectConflictsFor(remoteRoundOp);

    await resolver.autoResolveConflictsLWW(conflicts);

    // Remote wins outright: the rounding applies once, the stale local edit is
    // rejected, and nothing is left pending — no compensation is needed.
    expect(appliedOps().map(({ id }) => id)).toContain(remoteRoundOp.id);
    expect(await unsyncedOps()).toEqual([]);
  });

  /**
   * A production rounding op declares EVERY task id of the day, but its
   * reducer writes only tasks matching the payload's project limit that are
   * not parents-with-subtasks. A remote win on a declared-but-unwritten
   * target would reject the local pending edit while the replay writes
   * nothing to that entity — the edit would stay visible locally but never
   * upload. Such rows must resolve as LOCAL wins instead, re-asserting and
   * re-uploading the local state via a compensation snapshot.
   */
  describe('declared-but-unwritten targets resolve as local wins', () => {
    const expectLocalStatePreserved = async (
      localEditOp: Operation,
      remoteRoundOp: Operation,
      expectedTitle: string,
    ): Promise<void> => {
      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      const compensation = pending[0];
      expect(compensation.id).not.toBe(localEditOp.id);
      expect(compensation.entityId).toBe(TASK_A);
      expect(
        (compensation.payload as { actionPayload?: { title?: string } }).actionPayload
          ?.title,
      ).toBe(expectedTitle);
      expectDominates(compensation, localEditOp);
      expectDominates(compensation, remoteRoundOp);

      // The rounding op still applies atomically for its writable targets.
      const appliedIds = appliedOps().map(({ id }) => id);
      expect(appliedIds).toContain(remoteRoundOp.id);
      expect(appliedIds).toContain(compensation.id);
    };

    it('keeps an OLDER local edit when the op is limited to another project', async () => {
      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: TASK_A, changes: { title: 'Cross-project edit' } },
        }) as PersistentAction,
      );
      taskStateById[TASK_A] = {
        ...DEFAULT_TASK,
        id: TASK_A,
        title: 'Cross-project edit',
        projectId: 'project1',
      };

      // The remote per-project rounding covers only 'other-project' tasks but
      // declares task A anyway; its timestamp is NEWER, so plain LWW would
      // pick remote and silently drop the local edit from the upload stream.
      const remoteRoundOp = buildRemoteRoundTimeOp(
        remoteClient(),
        [TASK_A, TASK_B, TASK_C],
        localEditOp.timestamp + 1,
        [TASK_A, TASK_B, TASK_C],
        'other-project',
      );
      const conflicts = await detectConflictsFor(remoteRoundOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      await expectLocalStatePreserved(localEditOp, remoteRoundOp, 'Cross-project edit');
    });

    it('keeps an OLDER local edit when the conflicted task is a parent with subtasks', async () => {
      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: TASK_A, changes: { title: 'Parent edit' } },
        }) as PersistentAction,
      );
      taskStateById[TASK_A] = {
        ...DEFAULT_TASK,
        id: TASK_A,
        title: 'Parent edit',
        projectId: 'project1',
        subTaskIds: ['task-a-sub-1'],
      };

      const remoteRoundOp = buildRemoteRoundTimeOp(
        remoteClient(),
        [TASK_A, TASK_B, TASK_C],
        localEditOp.timestamp + 1,
      );
      const conflicts = await detectConflictsFor(remoteRoundOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      await expectLocalStatePreserved(localEditOp, remoteRoundOp, 'Parent edit');
    });
  });

  it('fails closed when the declared entity ids disagree with the replay write set', async () => {
    // A payload whose `taskIds` exceed `entityIds` would round a task that
    // conflict detection never checked — that shape must keep the safe stop.
    const [localEditOp] = await dispatchAndFlush(
      TaskSharedActions.updateTask({
        task: { id: TASK_A, changes: { title: 'Local edit' } },
      }) as PersistentAction,
    );

    const malformedRemoteOp = buildRemoteRoundTimeOp(
      remoteClient(),
      [TASK_A, TASK_B, TASK_C],
      localEditOp.timestamp - 1,
      [TASK_A, TASK_B],
    );
    const conflicts = await detectConflictsFor(malformedRemoteOp);

    let thrown: unknown;
    try {
      await resolver.autoResolveConflictsLWW(conflicts);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
    expect((thrown as Error).message).toBe(
      'SYNC_MULTI_ENTITY_UNSUPPORTED side=remote ' +
        `actionType=${ActionType.TASK_ROUND_TIME_SPENT} entityCount=2`,
    );
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
    expect(await journal.list('history')).toEqual([]);
    // Fail-closed means pre-mutation: the local edit stays pending untouched.
    expect((await unsyncedOps()).map(({ id }) => id)).toEqual([localEditOp.id]);
  });

  it('fails closed with the TYPED error on a rounding op without an action payload', async () => {
    // The gate runs on attacker-influenceable remote input: a payload shaped
    // `{entityChanges: []}` (no actionPayload) must yield the typed
    // fail-closed error, not a TypeError thrown from inside the validator.
    const [localEditOp] = await dispatchAndFlush(
      TaskSharedActions.updateTask({
        task: { id: TASK_A, changes: { title: 'Local edit' } },
      }) as PersistentAction,
    );

    const malformedRemoteOp: Operation = {
      ...remoteClient().createOperation({
        actionType: ActionType.TASK_ROUND_TIME_SPENT,
        opType: OpType.Update,
        entityType: 'TASK',
        entityId: TASK_A,
        entityIds: [TASK_A, TASK_B],
        payload: { entityChanges: [] },
      }),
      timestamp: localEditOp.timestamp - 1,
    };
    const conflicts = await detectConflictsFor(malformedRemoteOp);

    let thrown: unknown;
    try {
      await resolver.autoResolveConflictsLWW(conflicts);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
    expect((await unsyncedOps()).map(({ id }) => id)).toEqual([localEditOp.id]);
  });
});
