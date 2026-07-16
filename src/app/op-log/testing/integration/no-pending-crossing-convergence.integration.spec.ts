import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, createSelector, Store } from '@ngrx/store';
import { of } from 'rxjs';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { ValidateStateService } from '../../validation/validate-state.service';
import { SnackService } from '../../../core/snack/snack.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { PersistentAction } from '../../core/persistent-action.interface';
import {
  EntityConflict,
  extractActionPayload,
  isLwwUpdatePayload,
  Operation,
} from '../../core/operation.types';
import { convertOpToAction } from '../../apply/operation-converter.util';
import {
  taskReducer,
  TASK_FEATURE_NAME,
} from '../../../features/tasks/store/task.reducer';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { Task } from '../../../features/tasks/task.model';
import { RootState } from '../../../root-store/root-state';
import { createStateWithExistingTasks } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import {
  createCombinedTaskSharedMetaReducer,
  updateTaskEntity,
} from '../../../root-store/meta/task-shared-meta-reducers/test-helpers';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

/**
 * #9073 — no-pending CONCURRENT crossing convergence, through the production
 * wiring: real IndexedDB op-log rows, the real `getEntityFrontierWithOps` scan,
 * real conflict detection, and `autoResolveConflictsLWW` with the SAME freeze
 * flags the production caller passes (remote-ops-processing STEP 5).
 *
 * Scenario: clients A and B concurrently edit the same field of one task; both
 * ops are already synced on their author before either sees the other's
 * (reachable via composed third-device crossings and upload-guard escape
 * hatches). Pre-#9073 both sides silently applied by arrival order and diverged
 * permanently.
 */
describe('no-pending CONCURRENT crossing convergence integration (#9073)', () => {
  const TASK_ID = 'task-x';
  const CLIENT_A = 'crossing-client-a';
  const CLIENT_B = 'crossing-client-b';
  const FREEZE_FLAGS = {
    disableDisjointMerge: true,
    disableConflictJournal: true,
  } as const;

  let opLogStore: OperationLogStoreService;
  let vectorClock: VectorClockService;
  let resolver: ConflictResolutionService;
  let capture: OperationCaptureService;
  let initialState: RootState;
  let localState: RootState;
  let reducer: ActionReducer<RootState, Action>;
  let currentClientId: string;

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

  const titleUpdateOp = (
    client: TestClient,
    title: string,
    timestamp: number,
  ): Operation =>
    captureOperation(
      TaskSharedActions.updateTask({
        task: { id: TASK_ID, changes: { title } },
      }) as PersistentAction,
      client,
      timestamp,
    );

  const getTitle = (): string =>
    (localState[TASK_FEATURE_NAME].entities[TASK_ID] as Task).title;

  /** Production-shaped detection ctx (mirrors detectConflicts' internals). */
  const detect = async (
    incoming: Operation,
  ): Promise<{ isSupersededOrDuplicate: boolean; conflicts: EntityConflict[] }> => {
    const { frontier, retainedOpsByEntity } =
      await vectorClock.getEntityFrontierWithOps();
    return resolver.checkOpForConflicts(incoming, {
      localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
      appliedFrontierByEntity: frontier,
      retainedOpsByEntity,
      snapshotVectorClock: await vectorClock.getSnapshotVectorClock(),
      snapshotEntityKeys: await vectorClock.getSnapshotEntityKeys(),
      hasNoSnapshotClock: true,
    });
  };

  /** Installs one client's world: the given op applied to state + synced row. */
  const installSyncedLocalOp = async (op: Operation, title: string): Promise<void> => {
    await opLogStore._clearAllDataForTesting();
    localState = updateTaskEntity(initialState, TASK_ID, { title });
    const seq = await opLogStore.append(op, 'local');
    await opLogStore.markSynced([seq]);
  };

  beforeEach(async () => {
    resetTestUuidCounter();

    initialState = createStateWithExistingTasks([TASK_ID]);
    initialState = updateTaskEntity(initialState, TASK_ID, { title: 'original' });

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
    localState = initialState;
    currentClientId = CLIENT_A;

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
        VectorClockService,
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
            loadClientId: () => Promise.resolve(currentClientId),
            getOrGenerateClientId: () => Promise.resolve(currentClientId),
            clearCache: () => {},
          },
        },
        { provide: ENTITY_REGISTRY, useValue: entityRegistry },
      ],
    });

    opLogStore = TestBed.inject(OperationLogStoreService);
    vectorClock = TestBed.inject(VectorClockService);
    resolver = TestBed.inject(ConflictResolutionService);
    capture = TestBed.inject(OperationCaptureService);
    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
  });

  afterEach(async () => {
    await opLogStore._clearAllDataForTesting();
    TestBed.resetTestingModule();
  });

  it('both delivery orders converge on the same title; the synced loser is never rejected; the loser row is recorded-as-seen', async () => {
    const clientA = new TestClient(CLIENT_A);
    const clientB = new TestClient(CLIENT_B);
    const opX = titleUpdateOp(clientA, 'from A', 1_000);
    const opY = titleUpdateOp(clientB, 'from B', 2_000);

    // ── Side A: applied+synced X, receives Y (remote wins by timestamp) ──
    currentClientId = CLIENT_A;
    await installSyncedLocalOp(opX, 'from A');

    const detectionA = await detect(opY);
    expect(detectionA.isSupersededOrDuplicate).toBe(false);
    expect(detectionA.conflicts.length).toBe(1);

    const resolutionA = await resolver.autoResolveConflictsLWW(
      detectionA.conflicts,
      [],
      FREEZE_FLAGS,
    );
    expect(resolutionA.localWinOpsCreated).toBe(0);
    const finalTitleA = getTitle();

    // The already-synced local side must NOT be rejected (frontier scans skip
    // rejected rows — rejecting a synced op would corrupt later detection).
    expect((await opLogStore.getOpById(opX.id))?.rejectedAt).toBeUndefined();
    // The winning remote op is durably recorded (ID-dedup shield).
    expect(await opLogStore.getOpById(opY.id)).toBeDefined();

    // ── Side B: applied+synced Y, receives X (local wins → heal op) ──
    currentClientId = CLIENT_B;
    await installSyncedLocalOp(opY, 'from B');

    const detectionB = await detect(opX);
    expect(detectionB.isSupersededOrDuplicate).toBe(false);
    expect(detectionB.conflicts.length).toBe(1);

    const resolutionB = await resolver.autoResolveConflictsLWW(
      detectionB.conflicts,
      [],
      FREEZE_FLAGS,
    );
    expect(resolutionB.localWinOpsCreated).toBe(1);
    const finalTitleB = getTitle();

    // CONVERGENCE: both delivery orders end on the deterministic winner.
    expect(finalTitleA).toBe('from B');
    expect(finalTitleB).toBe('from B');

    // The synced local winner is never rejected...
    expect((await opLogStore.getOpById(opY.id))?.rejectedAt).toBeUndefined();
    // ...while the remote loser is persisted AND rejected: recorded-as-seen
    // (dedup on re-delivery) but excluded from frontier scans and upload.
    const loserRow = await opLogStore.getOpById(opX.id);
    expect(loserRow).toBeDefined();
    expect(loserRow?.rejectedAt).toBeDefined();

    // The heal op is a pending upload that dominates BOTH sides of the
    // crossing, preserves the winner's timestamp, and carries B's state.
    const pendingUploads = await opLogStore.getUnsynced();
    expect(pendingUploads.length).toBe(1);
    const healOp = pendingUploads[0].op;
    expect(isLwwUpdatePayload(healOp.payload)).toBe(true);
    expect(
      compareVectorClocks(healOp.vectorClock, {
        [CLIENT_A]: opX.vectorClock[CLIENT_A],
        [CLIENT_B]: opY.vectorClock[CLIENT_B],
      }),
    ).toBe(VectorClockComparison.GREATER_THAN);
    expect(healOp.timestamp).toBe(2_000);
    expect(extractActionPayload(healOp.payload)['title']).toBe('from B');

    // The heal converges side A too: applying it on top of A's post-resolution
    // state is idempotent (same winner state).
    localState = updateTaskEntity(initialState, TASK_ID, { title: finalTitleA });
    localState = reducer(localState, convertOpToAction(healOp));
    expect(getTitle()).toBe('from B');
  });

  it('re-delivery of the resolved loser is skipped as superseded — no second conflict, no second heal', async () => {
    const clientA = new TestClient(CLIENT_A);
    const clientB = new TestClient(CLIENT_B);
    const opX = titleUpdateOp(clientA, 'from A', 1_000);
    const opY = titleUpdateOp(clientB, 'from B', 2_000);

    currentClientId = CLIENT_B;
    await installSyncedLocalOp(opY, 'from B');

    const detection = await detect(opX);
    await resolver.autoResolveConflictsLWW(detection.conflicts, [], FREEZE_FLAGS);
    expect((await opLogStore.getUnsynced()).length).toBe(1);

    // Gap re-download / cursor reset re-delivers the loser: the heal's clock
    // now dominates it deterministically.
    const redelivery = await detect(opX);

    expect(redelivery.isSupersededOrDuplicate).toBe(true);
    expect(redelivery.conflicts).toEqual([]);
    expect((await opLogStore.getUnsynced()).length).toBe(1);
    expect(getTitle()).toBe('from B');
  });
});
