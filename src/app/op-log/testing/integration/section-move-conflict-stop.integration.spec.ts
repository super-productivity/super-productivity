import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { Subject, Subscription } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import {
  addTaskToSection,
  deleteSection,
  removeTaskFromSection,
  updateSection,
  updateSectionOrder,
} from '../../../features/section/store/section.actions';
import { WorkContextType } from '../../../features/work-context/work-context.model';
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
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { ImmediateUploadService } from '../../sync/immediate-upload.service';
import { OperationWriteFlushService } from '../../sync/operation-write-flush.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { ValidateStateService } from '../../validation/validate-state.service';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';

/**
 * #10969: a cross-section drag (`addTaskToSection` with `sourceSectionId !==
 * sectionId`) declares two SECTION ids. A concurrent edit of either section
 * that writes no task list (collapse, rename) commutes with it and stays out of
 * the conflict (`areCommutingReorderAndContentOperations`), as do a section
 * reorder, the removal of the same task from the move's source, and another
 * task's placement or removal in the same section lists
 * (`areCommutingSectionOperations`). Convergence of the admitted crossings is
 * covered end to end by `e2e/tests/sync/supersync-section-move-vs-section-edit.spec.ts`.
 *
 * The `stops` cases pin what is still NOT resolved, not desired behaviour: a
 * delete of either section still throws `UnsupportedMultiEntityConflictError`
 * (the whole-dataset "Keep local / Keep remote" dialog). A rejected section
 * delete has no causal replay, so its entity LWW fallback would need its own
 * delete-wins rule and E2E.
 */
describe('cross-section task move vs concurrent section edit (#10969)', () => {
  const LOCAL_CLIENT_ID = 'device-a';
  const REMOTE_CLIENT_ID = 'device-b';
  const PROJECT_ID = 'project-1';
  const S1 = 'section-1';
  const S2 = 'section-2';
  const S3 = 'section-3';
  const TASK = 'task-moved';
  const OTHER_TASK = 'task-other';

  let opLogStore: OperationLogStoreService;
  let capture: OperationCaptureService;
  let writeFlush: OperationWriteFlushService;
  let resolver: ConflictResolutionService;
  let operationApplier: jasmine.SpyObj<OperationApplierService>;
  let store: jasmine.SpyObj<Store>;
  let actions$: Subject<Action>;
  let effectSubscription: Subscription;

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
    capture.clear();
    store.dispatch.and.callFake(((action: Action): void => {
      if (!isPersistentAction(action)) {
        throw new Error('Expected a persistent section action');
      }
      capture.incrementPending(action);
      actions$.next(action);
    }) as Store['dispatch']);

    await opLogStore.init();
    await opLogStore._clearAllDataForTesting();
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
    TestBed.resetTestingModule();
  });

  // ── The user intents, as production dispatches them ──────────────────────

  /** Drag TASK from S1 to S2 (task-list.component.ts → addTaskToSection). */
  const moveTaskS1toS2 = (): PersistentAction =>
    addTaskToSection({
      sectionId: S2,
      taskId: TASK,
      afterTaskId: null,
      sourceSectionId: S1,
    }) as PersistentAction;

  const PAIRINGS: {
    name: string;
    userFlow: string;
    action: () => PersistentAction;
  }[] = [
    {
      name: 'delete of the destination section S2',
      userFlow: 'section menu → delete',
      action: () => deleteSection({ id: S2 }) as PersistentAction,
    },
  ];

  const toRemoteOperation = (action: PersistentAction, timestamp: number): Operation => {
    const { type, meta, ...actionPayload } = action;
    const ids = meta.entityIds;
    return {
      ...new TestClient(REMOTE_CLIENT_ID).createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: ids?.[0] ?? (meta.entityId as string),
        entityIds: ids,
        payload: {
          actionPayload,
          entityChanges: capture.extractEntityChanges(action),
        },
      }),
      timestamp,
    };
  };

  const dispatchPendingLocal = async (action: PersistentAction): Promise<Operation> => {
    store.dispatch(action);
    await writeFlush.flushPendingWrites();
    const unsynced = await opLogStore.getUnsynced();
    expect(unsynced.length).toBe(1);
    return unsynced[0]!.op;
  };

  const detect = async (remoteOperation: Operation): Promise<EntityConflict[]> =>
    (
      await resolver.checkOpForConflicts(remoteOperation, {
        localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      })
    ).conflicts;

  const resolve = async (conflicts: EntityConflict[]): Promise<unknown> => {
    try {
      await resolver.autoResolveConflictsLWW(conflicts);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  const expectStop = (
    thrown: unknown,
    side: 'local' | 'remote',
    actionType: ActionType,
    entityCount: number,
  ): void => {
    expect(thrown).toBeInstanceOf(UnsupportedMultiEntityConflictError);
    expect((thrown as Error).message).toBe(
      `SYNC_MULTI_ENTITY_UNSUPPORTED side=${side} ` +
        `actionType=${actionType} entityCount=${entityCount}`,
    );
    expect(operationApplier.applyOperations).not.toHaveBeenCalled();
  };

  describe('stops (whole-dataset Keep local / Keep remote dialog)', () => {
    PAIRINGS.forEach(({ name, userFlow, action }) => {
      // Device A dragged TASK S1 → S2 and has not uploaded yet; device B's
      // concurrent edit arrives first. Pins a remaining stop (#10969).
      it(`A's pending move vs B's remote ${name} [${userFlow}]`, async () => {
        const local = await dispatchPendingLocal(moveTaskS1toS2());
        expect(local.entityIds).toEqual([S1, S2]);
        const remoteAction = action();
        const remote = toRemoteOperation(remoteAction, local.timestamp + 1);

        const conflicts = await detect(remote);
        expect(conflicts.length).toBeGreaterThan(0);

        expectStop(await resolve(conflicts), 'local', ActionType.SECTION_ADD_TASK, 2);
        expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).toEqual([
          local.id,
        ]);
      });

      // Device B's edit is pending; device A's move arrives first. Pins a
      // remaining stop (#10969).
      it(`B's pending ${name} vs A's remote move [${userFlow}]`, async () => {
        const local = await dispatchPendingLocal(action());
        const remote = toRemoteOperation(moveTaskS1toS2(), local.timestamp + 1);

        const conflicts = await detect(remote);
        expect(conflicts.length).toBeGreaterThan(0);

        const thrown = await resolve(conflicts);
        expectStop(thrown, 'remote', ActionType.SECTION_ADD_TASK, 2);
        expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).toEqual([
          local.id,
        ]);
      });
    });
  });

  describe('stops beside a pending edit of the same section', () => {
    // Device A expanded S1 (by hand, or work-view.component.ts's auto-expand
    // when a task inside it is focused), then dragged TASK S1 → S2; neither is
    // uploaded. Device B's concurrent collapse of S1 conflicts with A's expand
    // (two patches of one field), and `nonCommutingPendingOps` keeps every
    // pending op of S1 in that conflict, the commuting move included. Pins a
    // remaining stop (#10969): section ops beside a conflict keep the stop.
    it("A's pending expand + move vs B's remote collapse of S1", async () => {
      store.dispatch(
        updateSection({
          section: { id: S1, changes: { isExpanded: true } },
        }) as PersistentAction,
      );
      store.dispatch(moveTaskS1toS2());
      await writeFlush.flushPendingWrites();
      const pending = (await opLogStore.getUnsynced()).map(({ op }) => op);
      expect(pending.map((op) => op.actionType)).toEqual([
        ActionType.SECTION_UPDATE,
        ActionType.SECTION_ADD_TASK,
      ]);
      const remote = toRemoteOperation(
        updateSection({
          section: { id: S1, changes: { isExpanded: false } },
        }) as PersistentAction,
        pending[1].timestamp + 1,
      );

      const conflicts = await detect(remote);
      expect(conflicts.map((c) => c.localOps.map((op) => op.actionType))).toEqual([
        [ActionType.SECTION_UPDATE, ActionType.SECTION_ADD_TASK],
      ]);

      expectStop(await resolve(conflicts), 'local', ActionType.SECTION_ADD_TASK, 2);
      expect((await opLogStore.getUnsynced()).map(({ op }) => op.id)).toEqual(
        pending.map((op) => op.id),
      );
    });

    // The same pending pair against an edit of the other section commutes.
    it("A's pending expand of S1 + move vs B's remote collapse of S2", async () => {
      store.dispatch(
        updateSection({
          section: { id: S1, changes: { isExpanded: true } },
        }) as PersistentAction,
      );
      store.dispatch(moveTaskS1toS2());
      await writeFlush.flushPendingWrites();
      const pending = (await opLogStore.getUnsynced()).map(({ op }) => op);
      expect(
        await detect(
          toRemoteOperation(
            updateSection({
              section: { id: S2, changes: { isExpanded: false } },
            }) as PersistentAction,
            pending[1].timestamp + 1,
          ),
        ),
      ).toEqual([]);
    });
  });

  describe('admitted crossings (no conflict raised)', () => {
    const ADMITTED: { name: string; action: () => PersistentAction }[] = [
      {
        name: "another task's cross-section move S3 → S1",
        action: () =>
          addTaskToSection({
            sectionId: S1,
            taskId: OTHER_TASK,
            afterTaskId: null,
            sourceSectionId: S3,
          }) as PersistentAction,
      },
      {
        name: "another task's reorder within S2",
        action: () =>
          addTaskToSection({
            sectionId: S2,
            taskId: OTHER_TASK,
            afterTaskId: null,
            sourceSectionId: S2,
          }) as PersistentAction,
      },
      {
        name: 'removal of another task from S1',
        action: () =>
          removeTaskFromSection({
            sectionId: S1,
            taskId: OTHER_TASK,
            workContextId: PROJECT_ID,
            workContextType: WorkContextType.PROJECT,
            workContextAfterTaskId: null,
          }) as PersistentAction,
      },
      {
        name: 'collapse of the source section S1',
        action: () =>
          updateSection({
            section: { id: S1, changes: { isExpanded: false } },
          }) as PersistentAction,
      },
      {
        name: 'collapse of the destination section S2',
        action: () =>
          updateSection({
            section: { id: S2, changes: { isExpanded: false } },
          }) as PersistentAction,
      },
      {
        name: 'rename of the source section S1',
        action: () =>
          updateSection({
            section: { id: S1, changes: { title: 'Renamed' } },
          }) as PersistentAction,
      },
      {
        name: 'section reorder listing S1 and S2',
        action: () =>
          updateSectionOrder({
            contextId: PROJECT_ID,
            ids: [S2, S1],
          }) as PersistentAction,
      },
      {
        name: 'removal of the same task from S1',
        action: () =>
          removeTaskFromSection({
            sectionId: S1,
            taskId: TASK,
            workContextId: PROJECT_ID,
            workContextType: WorkContextType.PROJECT,
            workContextAfterTaskId: null,
          }) as PersistentAction,
      },
    ];

    ADMITTED.forEach(({ name, action }) => {
      it(`A's pending move vs B's remote ${name}`, async () => {
        const local = await dispatchPendingLocal(moveTaskS1toS2());
        expect(await detect(toRemoteOperation(action(), local.timestamp + 1))).toEqual(
          [],
        );
      });

      it(`B's pending ${name} vs A's remote move`, async () => {
        const local = await dispatchPendingLocal(action());
        expect(
          await detect(toRemoteOperation(moveTaskS1toS2(), local.timestamp + 1)),
        ).toEqual([]);
      });
    });
  });
});
