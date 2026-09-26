import { TestBed } from '@angular/core/testing';
import { provideMockActions } from '@ngrx/effects/testing';
import { Action, Store } from '@ngrx/store';
import { Subject, Subscription } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { ClientIdService } from '../../../core/util/client-id.service';
import { BoardsActions } from '../../../features/boards/store/boards.actions';
import { updateNote, updateNoteOrder } from '../../../features/note/store/note.actions';
import {
  updateSection,
  updateSectionOrder,
} from '../../../features/section/store/section.actions';
import {
  setSimpleCounterCounterToday,
  updateSimpleCounterOrder,
} from '../../../features/simple-counter/store/simple-counter.actions';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { clearDeferredActions } from '../../capture/operation-capture.meta-reducer';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { Operation } from '../../core/operation.types';
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

/**
 * KNOWN GAP (#10264; see docs/plans/2026-09-26-sync-architecture-review.md, "Bugs found").
 *
 * The UI reorder actions for notes, habits (simple counters), boards and
 * sections are multi-entity operations: `entityIds` lists every reordered id.
 * None of them has a resolution path in
 * `ConflictResolutionService._assertMultiEntityPlansAreSafe`, so one pending
 * reorder crossing one concurrent single-entity edit of ANY listed entity
 * throws `UnsupportedMultiEntityConflictError` and stops sync until the user
 * replaces the whole dataset on one side. The same class already reached
 * users through the Today-list actions (#9405, #9426).
 *
 * These specs only pin that resolution no longer throws. They mock the
 * operation applier, so they cannot prove order convergence or that the
 * other side's content edit survives; the end-to-end reproduction
 * (e2e/tests/sync/supersync-reorder-conflict-wedge.spec.ts) and the plan's
 * Phase 2 cover that. Pending (`xit`) until the class is fixed. Verified
 * failing on 6169df9e9 and 41324d290 with
 * `SYNC_MULTI_ENTITY_UNSUPPORTED side=<local|remote> actionType=<reorder>`.
 */
describe('reorder crossing a concurrent edit (known gap: sync stops)', () => {
  const LOCAL_CLIENT_ID = 'reorder-local-client';
  const REMOTE_CLIENT_ID = 'reorder-remote-client';

  let opLogStore: OperationLogStoreService;
  let capture: OperationCaptureService;
  let writeFlush: OperationWriteFlushService;
  let resolver: ConflictResolutionService;
  let journal: ConflictJournalService;
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
    operationApplier.applyOperations.and.callFake(async (ops) => ({ appliedOps: ops }));
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

  /** Builds the operation a second device would upload for `action`. */
  const remoteOperationFor = (action: PersistentAction, timestamp: number): Operation => {
    const { type, meta, ...actionPayload } = action;
    const entityIds = meta.entityIds ?? (meta.entityId ? [meta.entityId] : undefined);
    return {
      ...new TestClient(REMOTE_CLIENT_ID).createOperation({
        actionType: type,
        opType: meta.opType,
        entityType: meta.entityType,
        entityId: (meta.entityId ?? entityIds?.[0]) as string,
        entityIds: meta.entityIds,
        payload: {
          actionPayload,
          entityChanges: capture.extractEntityChanges(action),
        },
      }),
      timestamp,
    };
  };

  /**
   * Dispatches `localAction` as this device's only pending operation, then
   * delivers `remoteAction` from a concurrent device and runs detection plus
   * LWW resolution. Returns whatever resolution threw.
   */
  const raceCrossing = async (
    localAction: PersistentAction,
    remoteAction: PersistentAction,
  ): Promise<unknown> => {
    store.dispatch(localAction);
    await writeFlush.flushPendingWrites();
    const unsynced = await opLogStore.getUnsynced();
    expect(unsynced.length).toBe(1);
    const localOperation = unsynced[0]!.op;

    const detection = await resolver.checkOpForConflicts(
      remoteOperationFor(remoteAction, localOperation.timestamp + 1),
      {
        localPendingOpsByEntity: await opLogStore.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      },
    );
    // A fix may stop reporting a conflict for a pure reorder at all; that is a
    // resolved crossing, not a failed precondition.
    if (detection.conflicts.length === 0) {
      return undefined;
    }

    try {
      await resolver.autoResolveConflictsLWW(detection.conflicts);
      return undefined;
    } catch (error) {
      return error;
    }
  };

  const CROSSINGS: {
    name: string;
    local: () => PersistentAction;
    remote: () => PersistentAction;
  }[] = [
    {
      name: 'local note reorder vs remote note edit',
      local: () =>
        updateNoteOrder({
          ids: ['note-b', 'note-a'],
          activeContextType: WorkContextType.PROJECT,
          activeContextId: 'project-1',
        }) as PersistentAction,
      remote: () =>
        updateNote({
          note: { id: 'note-a', changes: { content: 'edited elsewhere' } },
        }) as PersistentAction,
    },
    {
      name: 'local note edit vs remote note reorder',
      local: () =>
        updateNote({
          note: { id: 'note-a', changes: { content: 'edited here' } },
        }) as PersistentAction,
      remote: () =>
        updateNoteOrder({
          ids: ['note-b', 'note-a'],
          activeContextType: WorkContextType.PROJECT,
          activeContextId: 'project-1',
        }) as PersistentAction,
    },
    {
      name: 'local habit reorder vs remote habit count',
      local: () =>
        updateSimpleCounterOrder({ ids: ['counter-b', 'counter-a'] }) as PersistentAction,
      remote: () =>
        setSimpleCounterCounterToday({
          id: 'counter-a',
          newVal: 3,
          today: '2026-09-25',
        }) as PersistentAction,
    },
    {
      name: 'local board sort vs remote board edit',
      local: () =>
        BoardsActions.sortBoards({ ids: ['board-b', 'board-a'] }) as PersistentAction,
      remote: () =>
        BoardsActions.updateBoard({
          id: 'board-a',
          updates: { title: 'Renamed' },
        }) as PersistentAction,
    },
    {
      name: 'local section reorder vs remote section rename',
      local: () =>
        updateSectionOrder({
          contextId: 'project-1',
          ids: ['section-b', 'section-a'],
        }) as PersistentAction,
      remote: () =>
        updateSection({
          section: { id: 'section-a', changes: { title: 'Renamed' } },
        }) as PersistentAction,
    },
  ];

  CROSSINGS.forEach(({ name, local, remote }) => {
    // Pending until the multi-entity reorder class is fixed. Today this throws
    // UnsupportedMultiEntityConflictError and sync stops.
    xit(`known gap: resolves ${name} without stopping sync`, async () => {
      const thrown = await raceCrossing(local(), remote());
      expect(thrown).toBeUndefined();
    });
  });
});
