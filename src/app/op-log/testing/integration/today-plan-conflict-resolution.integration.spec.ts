import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, ActionReducer, Store } from '@ngrx/store';
import { of, Subject, Subscription } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { DEFAULT_TASK, Task } from '../../../features/tasks/task.model';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { bulkApplyOperations } from '../../apply/bulk-hydration.action';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { ActionType, Operation, OpType } from '../../core/operation.types';
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
import { EntityConflict } from '../../core/operation.types';
import {
  ApplyOperationsOptions,
  ApplyOperationsResult,
} from '../../core/types/apply.types';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import { RootState } from '../../../root-store/root-state';
import { createStateWithExistingTasks } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { createCombinedTaskSharedMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import {
  plannerFeatureKey,
  plannerReducer,
} from '../../../features/planner/store/planner.reducer';
import { PlannerActions } from '../../../features/planner/store/planner.actions';
import { TASK_FEATURE_NAME } from '../../../features/tasks/store/task.reducer';

/**
 * #9426 / #9405: a pending local multi-entity Today-list op (the automatic
 * day-rollover `planTasksForToday`, a Today drag, a bulk unplan) in ANY
 * conflict must not wedge the whole batch. These specs pin the resolution
 * behavior: the batch resolves, the atomic bulk row is rejected, and for
 * `planTasksForToday` a scoped replacement re-emits the surviving siblings'
 * intent (mirroring the bulk-delete preserve mechanism).
 */
describe('today-list multi-entity conflict resolution integration (#9426)', () => {
  const LOCAL_CLIENT_ID = 'today-client';
  const REMOTE_CLIENT_ID = 'remote-client';
  const CONFLICT_TASK_ID = 'rpt_cfg-a_2026-07-28';
  const SIBLING_1 = 'task-sibling-1';
  const SIBLING_2 = 'task-sibling-2';
  const CONCURRENT_TASK_ID = 'task-concurrent-placement';
  const TODAY = '2026-07-30';
  const FUTURE_DAY = '2026-08-03';

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
  let plannerDaysByDay: Record<string, string[]>;

  const liveTask = (id: string): Task => ({
    ...DEFAULT_TASK,
    id,
    title: `Task ${id}`,
    projectId: 'project1',
    dueDay: TODAY,
  });

  beforeEach(async () => {
    resetTestUuidCounter();
    clearDeferredActions();
    actions$ = new Subject<Action>();
    store = jasmine.createSpyObj<Store>('Store', ['dispatch', 'select']);
    taskStateById = {
      [CONFLICT_TASK_ID]: liveTask(CONFLICT_TASK_ID),
      [SIBLING_1]: liveTask(SIBLING_1),
      [SIBLING_2]: liveTask(SIBLING_2),
      [CONCURRENT_TASK_ID]: liveTask(CONCURRENT_TASK_ID),
    };
    plannerDaysByDay = {};
    // Serve current entity state for local-win snapshots from a plain map. The
    // registry's TASK selectById is a props-based selector: (selector, {id}).
    store.select.and.callFake(((_selector: unknown, props?: { id?: string }): unknown =>
      of(
        props?.id
          ? taskStateById[props.id]
          : {
              days: plannerDaysByDay,
              addPlannedTasksDialogLastShown: undefined,
            },
      )) as Store['select']);

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

  const buildRemoteTaskUpdate = (targetTaskId: string, timestamp: number): Operation => {
    const remoteAction = TaskSharedActions.updateTask({
      task: { id: targetTaskId, changes: { title: 'Concurrent remote edit' } },
    }) as PersistentAction;
    const { type, meta, ...actionPayload } = remoteAction;
    return {
      ...new TestClient(REMOTE_CLIENT_ID).createOperation({
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

  describe('local planTasksForToday bulk op in a conflict', () => {
    const planAllThree = (): PersistentAction =>
      TaskSharedActions.planTasksForToday({
        taskIds: [CONFLICT_TASK_ID, SIBLING_1, SIBLING_2],
        today: TODAY,
        startOfNextDayDiffMs: 0,
      }) as PersistentAction;

    it('resolves a remote-win conflict and re-emits the surviving siblings as a scoped replacement', async () => {
      const [bulkOp] = await dispatchAndFlush(planAllThree());
      expect(bulkOp.actionType).toBe(ActionType.TASK_SHARED_PLAN_FOR_TODAY);

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, bulkOp.timestamp + 1);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      const replacement = pending[0];
      expect(replacement.id).not.toBe(bulkOp.id);
      expect(replacement.actionType).toBe(ActionType.TASK_SHARED_PLAN_FOR_TODAY);
      expect(replacement.entityIds).toEqual([SIBLING_1, SIBLING_2]);
      const actionPayload = (
        replacement.payload as { actionPayload: Record<string, unknown> }
      ).actionPayload;
      expect(actionPayload['taskIds']).toEqual([SIBLING_1, SIBLING_2]);
      expect(actionPayload['today']).toBe(TODAY);
      expect(replacement.timestamp).toBe(bulkOp.timestamp);
      expectDominates(replacement, bulkOp);
      expectDominates(replacement, remoteOp);

      // The remote winner is queued for apply; the losing bulk row is rejected.
      expect(operationApplier.applyOperations).toHaveBeenCalled();
      expect(appliedOps().map(({ id }) => id)).toContain(remoteOp.id);
    });

    it('excludes a local-win conflict target from the replacement (covered by its snapshot op)', async () => {
      const [bulkOp] = await dispatchAndFlush(planAllThree());

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, bulkOp.timestamp - 1000);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      const replacement = pending.find(
        (op) => op.actionType === ActionType.TASK_SHARED_PLAN_FOR_TODAY,
      );
      const snapshotOp = pending.find(
        (op) => op.actionType !== ActionType.TASK_SHARED_PLAN_FOR_TODAY,
      );
      expect(pending.length).toBe(2);
      expect(replacement).toBeDefined();
      expect(replacement!.entityIds).toEqual([SIBLING_1, SIBLING_2]);
      // The local-win target is carried by its whole-state snapshot op instead.
      expect(snapshotOp).toBeDefined();
      expect(snapshotOp!.entityId).toBe(CONFLICT_TASK_ID);
      expect(snapshotOp!.opType).toBe(OpType.Update);
    });

    it('retains a local-win target that has NO covering snapshot (entity absent from store)', async () => {
      const [bulkOp] = await dispatchAndFlush(planAllThree());
      // The conflict target vanished from the live store (e.g. archived
      // meanwhile), so the local win cannot produce a whole-state snapshot.
      taskStateById[CONFLICT_TASK_ID] = undefined;

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, bulkOp.timestamp - 1000);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      // No snapshot op exists, so the replacement must RETAIN the target id —
      // dropping it would silently lose the plan intent with no covering op.
      // Replaying it elsewhere is at worst a no-op (reducers skip unknown ids).
      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      expect(pending[0].entityIds).toEqual([CONFLICT_TASK_ID, SIBLING_1, SIBLING_2]);
      expect(pending[0].id).not.toBe(bulkOp.id);
    });

    it('resolves a deadline auto-plan bulk op (planDeadlineTasksForToday) the same way', async () => {
      // Dispatched by the SAME day-rollover effect as planTasksForToday, with
      // every deadline-due task id — leaving it out would keep deadline users
      // permanently wedged.
      const [bulkOp] = await dispatchAndFlush(
        TaskSharedActions.planDeadlineTasksForToday({
          taskIds: [CONFLICT_TASK_ID, SIBLING_1],
          today: TODAY,
          startOfNextDayDiffMs: 0,
        }) as PersistentAction,
      );
      expect(bulkOp.actionType).toBe(ActionType.TASK_SHARED_PLAN_DEADLINE_FOR_TODAY);

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, bulkOp.timestamp + 1);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      expect(pending.length).toBe(1);
      expect(pending[0].actionType).toBe(ActionType.TASK_SHARED_PLAN_DEADLINE_FOR_TODAY);
      expect(pending[0].entityIds).toEqual([SIBLING_1]);
      expect(
        (pending[0].payload as { actionPayload: Record<string, unknown> }).actionPayload[
          'taskIds'
        ],
      ).toEqual([SIBLING_1]);
    });

    it('rejects all bulk rows and writes ordered replacement clocks for the multi-day compounding case', async () => {
      const [dayOneOp] = await dispatchAndFlush(planAllThree());
      const pendingAfterSecond = await dispatchAndFlush(
        TaskSharedActions.planTasksForToday({
          taskIds: [CONFLICT_TASK_ID, SIBLING_1],
          today: '2026-07-31',
          startOfNextDayDiffMs: 0,
        }) as PersistentAction,
      );
      expect(pendingAfterSecond.length).toBe(2);
      const dayTwoOp = pendingAfterSecond.find(({ id }) => id !== dayOneOp.id)!;

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, dayTwoOp.timestamp + 1);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const pending = await unsyncedOps();
      expect(pending.length).toBe(2);
      // Same-millisecond timestamps are possible, so identify the replacements
      // by their surviving id sets instead of by timestamp order.
      const firstReplacement = pending.find((op) => op.entityIds?.length === 2)!;
      const secondReplacement = pending.find((op) => op.entityIds?.length === 1)!;
      expect(firstReplacement.entityIds).toEqual([SIBLING_1, SIBLING_2]);
      expect(secondReplacement.entityIds).toEqual([SIBLING_1]);
      // Ordered, not concurrent: the later WRITTEN replacement must dominate
      // the earlier one so receiving clients never see two concurrent ops on
      // SIBLING_1. Guaranteed by the local-append clock rebase in
      // appendMixedSourceBatchSkipDuplicates (#8939), not by the builder —
      // this case fails if that rebase is ever bypassed.
      expectDominates(secondReplacement, firstReplacement);
    });
  });

  describe('ordering-only Today-list ops in a conflict', () => {
    it('resolves a Today drag (moveTaskInTodayTagList) by rejecting the row without a replacement', async () => {
      const [moveOp] = await dispatchAndFlush(
        TaskSharedActions.moveTaskInTodayTagList({
          toTaskId: CONFLICT_TASK_ID,
          fromTaskId: SIBLING_1,
        }) as PersistentAction,
      );
      expect(moveOp.actionType).toBe(ActionType.TASK_SHARED_MOVE_IN_TODAY);

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, moveOp.timestamp + 1);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      // Ordering-only: rejecting the row loses at most Today-list ordering.
      expect(await unsyncedOps()).toEqual([]);
      expect(appliedOps().map(({ id }) => id)).toContain(remoteOp.id);
    });

    it('resolves a bulk unplan (removeTasksFromTodayTag) by rejecting the row without a replacement', async () => {
      const [removeOp] = await dispatchAndFlush(
        TaskSharedActions.removeTasksFromTodayTag({
          taskIds: [CONFLICT_TASK_ID, SIBLING_1],
        }) as PersistentAction,
      );
      expect(removeOp.actionType).toBe(ActionType.TASK_SHARED_REMOVE_FROM_TODAY);

      const remoteOp = buildRemoteTaskUpdate(CONFLICT_TASK_ID, removeOp.timestamp + 1);
      const conflicts = await detectConflictsFor(remoteOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      expect(await unsyncedOps()).toEqual([]);
    });
  });

  describe('remote planTasksForToday bulk op in a conflict', () => {
    const buildRemotePlanOp = (
      taskIds: string[],
      timestamp: number,
      remoteClient = new TestClient(REMOTE_CLIENT_ID),
    ): Operation => {
      const remoteAction = TaskSharedActions.planTasksForToday({
        taskIds,
        today: TODAY,
        startOfNextDayDiffMs: 0,
      }) as PersistentAction;
      const { type, meta, ...actionPayload } = remoteAction;
      return {
        ...remoteClient.createOperation({
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

    it('applies the original bulk op once and compensates a local winner after it', async () => {
      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: CONFLICT_TASK_ID, changes: { title: 'Local newer edit' } },
        }) as PersistentAction,
      );

      const remotePlanOp = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp - 1000,
      );
      const conflicts = await detectConflictsFor(remotePlanOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const applied = appliedOps();
      // The original atomic remote op is applied exactly once, unmangled...
      const appliedPlanOps = applied.filter(({ id }) => id === remotePlanOp.id);
      expect(appliedPlanOps.length).toBe(1);
      expect(appliedPlanOps[0].actionType).toBe(ActionType.TASK_SHARED_PLAN_FOR_TODAY);
      // ...and the local winner's compensation snapshot is applied AFTER it.
      const planIndex = applied.findIndex(({ id }) => id === remotePlanOp.id);
      const compensationIndex = applied.findIndex(
        (op) => op.entityId === CONFLICT_TASK_ID && op.id !== remotePlanOp.id,
      );
      expect(compensationIndex).toBeGreaterThan(planIndex);
    });

    it('keeps a local winner in its future planner position after replay', async () => {
      const localWinner = {
        ...liveTask(CONFLICT_TASK_ID),
        title: 'Local newer edit',
        dueDay: FUTURE_DAY,
      };
      taskStateById[CONFLICT_TASK_ID] = localWinner;
      taskStateById[SIBLING_1] = {
        ...liveTask(SIBLING_1),
        dueDay: FUTURE_DAY,
      };
      taskStateById[SIBLING_2] = {
        ...liveTask(SIBLING_2),
        dueDay: FUTURE_DAY,
      };
      taskStateById[CONCURRENT_TASK_ID] = {
        ...liveTask(CONCURRENT_TASK_ID),
        dueDay: FUTURE_DAY,
      };
      plannerDaysByDay = {
        [FUTURE_DAY]: [SIBLING_2, SIBLING_1, CONFLICT_TASK_ID, CONCURRENT_TASK_ID],
      };

      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: CONFLICT_TASK_ID, changes: { title: localWinner.title } },
        }) as PersistentAction,
      );
      const remotePlanOp = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp - 1000,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remotePlanOp));

      const baseState = createStateWithExistingTasks([
        CONFLICT_TASK_ID,
        SIBLING_1,
        SIBLING_2,
        CONCURRENT_TASK_ID,
      ]);
      const stateBeforeRemote: RootState = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            ...baseState[TASK_FEATURE_NAME].entities,
            [CONFLICT_TASK_ID]: localWinner,
            [SIBLING_1]: taskStateById[SIBLING_1],
            [SIBLING_2]: taskStateById[SIBLING_2],
            [CONCURRENT_TASK_ID]: taskStateById[CONCURRENT_TASK_ID],
          },
        },
        [plannerFeatureKey]: {
          ...baseState[plannerFeatureKey],
          days: plannerDaysByDay,
        },
      };
      const baseReducer: ActionReducer<RootState, Action> = (state, action) => {
        if (action.type !== PlannerActions.upsertPlannerDay.type) {
          return state as RootState;
        }
        return {
          ...(state as RootState),
          [plannerFeatureKey]: plannerReducer(
            (state as RootState)[plannerFeatureKey],
            action,
          ),
        };
      };
      const replayReducer = bulkOperationsMetaReducer(
        createCombinedTaskSharedMetaReducer(lwwUpdateMetaReducer(baseReducer)),
      ) as ActionReducer<RootState, Action>;

      const replayedState = replayReducer(
        stateBeforeRemote,
        bulkApplyOperations({
          operations: appliedOps(),
          localClientId: LOCAL_CLIENT_ID,
        }),
      );
      const replayedWinner = replayedState[TASK_FEATURE_NAME].entities[
        CONFLICT_TASK_ID
      ] as Task;
      expect(replayedWinner.title).toBe(localWinner.title);
      expect(replayedWinner.dueDay).toBe(FUTURE_DAY);
      expect(replayedState[plannerFeatureKey].days[FUTURE_DAY]).toEqual([
        SIBLING_2,
        CONFLICT_TASK_ID,
        CONCURRENT_TASK_ID,
      ]);
    });

    it('skips the placement compensation when a stale planner entry disagrees with the winner schedule', async () => {
      // An earlier LWW TASK snapshot can move scheduling (here: dueWithTime)
      // without touching planner state, leaving a stale planner.days entry.
      // The transfer replay force-writes dueDay and clears dueWithTime, so
      // re-imposing that entry would revert the winner's schedule on every
      // client. The winner must keep its schedule; only the stale placement
      // is lost (the pre-existing bounded gap).
      const localWinner: Task = {
        ...liveTask(CONFLICT_TASK_ID),
        title: 'Local newer edit',
        dueDay: undefined,
        dueWithTime: Date.parse('2026-08-06T09:00:00Z'),
      };
      taskStateById[CONFLICT_TASK_ID] = localWinner;
      plannerDaysByDay = { [FUTURE_DAY]: [CONFLICT_TASK_ID] };

      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: CONFLICT_TASK_ID, changes: { title: localWinner.title } },
        }) as PersistentAction,
      );
      const remotePlanOp = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp - 1000,
      );

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remotePlanOp));

      expect((await unsyncedOps()).filter((op) => op.entityType === 'PLANNER')).toEqual(
        [],
      );

      const baseState = createStateWithExistingTasks([
        CONFLICT_TASK_ID,
        SIBLING_1,
        SIBLING_2,
      ]);
      const stateBeforeRemote: RootState = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            ...baseState[TASK_FEATURE_NAME].entities,
            [CONFLICT_TASK_ID]: localWinner,
          },
        },
        [plannerFeatureKey]: {
          ...baseState[plannerFeatureKey],
          days: plannerDaysByDay,
        },
      };
      const baseReducer: ActionReducer<RootState, Action> = (state, action) => ({
        ...(state as RootState),
        [plannerFeatureKey]: plannerReducer(
          (state as RootState)[plannerFeatureKey],
          action,
        ),
      });
      const replayReducer = bulkOperationsMetaReducer(
        createCombinedTaskSharedMetaReducer(lwwUpdateMetaReducer(baseReducer)),
      ) as ActionReducer<RootState, Action>;

      const replayedState = replayReducer(
        stateBeforeRemote,
        bulkApplyOperations({
          operations: appliedOps(),
          localClientId: LOCAL_CLIENT_ID,
        }),
      );
      const replayedWinner = replayedState[TASK_FEATURE_NAME].entities[
        CONFLICT_TASK_ID
      ] as Task;
      expect(replayedWinner.title).toBe(localWinner.title);
      expect(replayedWinner.dueWithTime).toBe(localWinner.dueWithTime);
      expect(replayedWinner.dueDay).toBeUndefined();
      expect(replayedState[plannerFeatureKey].days[FUTURE_DAY] ?? []).toEqual([]);
    });

    it('preserves an unrelated placement that reaches the server before compensation', async () => {
      const localWinner = {
        ...liveTask(CONFLICT_TASK_ID),
        title: 'Local newer edit',
        dueDay: FUTURE_DAY,
      };
      const concurrentTask = {
        ...liveTask(CONCURRENT_TASK_ID),
        dueDay: FUTURE_DAY,
      };
      taskStateById[CONFLICT_TASK_ID] = localWinner;
      taskStateById[SIBLING_1] = {
        ...liveTask(SIBLING_1),
        dueDay: FUTURE_DAY,
      };
      taskStateById[SIBLING_2] = {
        ...liveTask(SIBLING_2),
        dueDay: FUTURE_DAY,
      };
      taskStateById[CONCURRENT_TASK_ID] = concurrentTask;
      plannerDaysByDay = {
        [FUTURE_DAY]: [SIBLING_2, CONFLICT_TASK_ID, SIBLING_1],
      };

      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: CONFLICT_TASK_ID, changes: { title: localWinner.title } },
        }) as PersistentAction,
      );
      const remotePlanOp = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp - 1000,
      );
      const placementAction = PlannerActions.planTaskForDay({
        task: concurrentTask,
        day: FUTURE_DAY,
      }) as PersistentAction;
      const { type, meta, ...actionPayload } = placementAction;
      const concurrentPlacementOp = new TestClient(
        'concurrent-planner-client',
      ).createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: CONCURRENT_TASK_ID,
        payload: { actionPayload, entityChanges: [] },
      });

      await resolver.autoResolveConflictsLWW(await detectConflictsFor(remotePlanOp), [
        concurrentPlacementOp,
      ]);

      const plannerCompensations = (await unsyncedOps()).filter(
        (op) => op.entityType === 'PLANNER',
      );
      expect(plannerCompensations.length).toBe(1);
      expect(plannerCompensations[0].actionType).toBe(ActionType.PLANNER_TRANSFER_TASK);
      expect(plannerCompensations[0].entityId).toBe(CONFLICT_TASK_ID);

      const baseState = createStateWithExistingTasks([
        CONFLICT_TASK_ID,
        SIBLING_1,
        SIBLING_2,
        CONCURRENT_TASK_ID,
      ]);
      const stateBeforeRemote: RootState = {
        ...baseState,
        [TASK_FEATURE_NAME]: {
          ...baseState[TASK_FEATURE_NAME],
          entities: {
            ...baseState[TASK_FEATURE_NAME].entities,
            [CONFLICT_TASK_ID]: localWinner,
            [SIBLING_1]: taskStateById[SIBLING_1],
            [SIBLING_2]: taskStateById[SIBLING_2],
            [CONCURRENT_TASK_ID]: concurrentTask,
          },
        },
        [plannerFeatureKey]: {
          ...baseState[plannerFeatureKey],
          days: plannerDaysByDay,
        },
      };
      const baseReducer: ActionReducer<RootState, Action> = (state, action) => ({
        ...(state as RootState),
        [plannerFeatureKey]: plannerReducer(
          (state as RootState)[plannerFeatureKey],
          action,
        ),
      });
      const replayReducer = bulkOperationsMetaReducer(
        createCombinedTaskSharedMetaReducer(lwwUpdateMetaReducer(baseReducer)),
      ) as ActionReducer<RootState, Action>;
      const serverOrderedOps = [
        remotePlanOp,
        concurrentPlacementOp,
        ...(await unsyncedOps()),
      ];

      const replayedState = replayReducer(
        stateBeforeRemote,
        bulkApplyOperations({
          operations: serverOrderedOps,
          localClientId: 'fresh-client',
        }),
      );

      expect(replayedState[plannerFeatureKey].days[FUTURE_DAY]).toEqual([
        SIBLING_2,
        CONFLICT_TASK_ID,
        CONCURRENT_TASK_ID,
      ]);
    });

    it('does not compensate a task whose later remote Today operation wins', async () => {
      taskStateById[CONFLICT_TASK_ID] = {
        ...liveTask(CONFLICT_TASK_ID),
        title: 'Local middle edit',
        dueDay: FUTURE_DAY,
      };
      plannerDaysByDay = { [FUTURE_DAY]: [CONFLICT_TASK_ID] };
      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: CONFLICT_TASK_ID, changes: { title: 'Local middle edit' } },
        }) as PersistentAction,
      );
      const remoteClient = new TestClient(REMOTE_CLIENT_ID);
      const earlierRemotePlan = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp - 1,
        remoteClient,
      );
      const laterRemotePlan = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp + 1,
        remoteClient,
      );
      const earlierConflicts = await detectConflictsFor(earlierRemotePlan);
      const laterConflicts = await detectConflictsFor(laterRemotePlan);

      await resolver.autoResolveConflictsLWW([...earlierConflicts, ...laterConflicts]);

      expect((await unsyncedOps()).filter((op) => op.entityType === 'PLANNER')).toEqual(
        [],
      );
    });

    it('degrades to a plain remote win when a local winner has no compensation snapshot', async () => {
      // Local pending edit on a task that is ABSENT from the live store (e.g.
      // archived after the edit): the local win cannot build a snapshot, so
      // the pre-#9426 mixed-winner throw would wedge the batch. The Today-list
      // replay skips unknown ids, so applying the bulk op as a remote win is
      // safe — resolution must complete.
      const [localEditOp] = await dispatchAndFlush(
        TaskSharedActions.updateTask({
          task: { id: CONFLICT_TASK_ID, changes: { title: 'Local newer edit' } },
        }) as PersistentAction,
      );
      taskStateById[CONFLICT_TASK_ID] = undefined;

      const remotePlanOp = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        localEditOp.timestamp - 1000,
      );
      const conflicts = await detectConflictsFor(remotePlanOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const appliedPlanOps = appliedOps().filter(({ id }) => id === remotePlanOp.id);
      expect(appliedPlanOps.length).toBe(1);
      // The losing local edit is rejected; nothing is left pending.
      expect(await unsyncedOps()).toEqual([]);
    });

    it('does not mangle the bulk op when a local delete loses to it', async () => {
      const conflictTask = taskStateById[CONFLICT_TASK_ID]!;
      const [deleteOp] = await dispatchAndFlush(
        TaskSharedActions.deleteTask({
          task: { ...conflictTask, subTaskIds: [], subTasks: [] },
        }) as PersistentAction,
      );
      expect(deleteOp.opType).toBe(OpType.Delete);
      // The task is gone locally after the optimistic delete.
      taskStateById[CONFLICT_TASK_ID] = undefined;

      const remotePlanOp = buildRemotePlanOp(
        [CONFLICT_TASK_ID, SIBLING_1],
        deleteOp.timestamp + 1,
      );
      const conflicts = await detectConflictsFor(remotePlanOp);

      await resolver.autoResolveConflictsLWW(conflicts);

      const appliedPlanOp = appliedOps().find(({ id }) => id === remotePlanOp.id);
      expect(appliedPlanOp).toBeDefined();
      // NOT rewritten into a single-entity LWW replace: the op must keep its
      // action type and full taskIds so SIBLING_1 still gets planned.
      expect(appliedPlanOp!.actionType).toBe(ActionType.TASK_SHARED_PLAN_FOR_TODAY);
      expect(
        (appliedPlanOp!.payload as { actionPayload: { taskIds: string[] } }).actionPayload
          .taskIds,
      ).toEqual([CONFLICT_TASK_ID, SIBLING_1]);
    });
  });
});
