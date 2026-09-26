import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, provideStore, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import { BoardsActions } from '../../../features/boards/store/boards.actions';
import {
  boardsReducer,
  initialBoardsState,
} from '../../../features/boards/store/boards.reducer';
import {
  addNote,
  updateNote,
  updateNoteOrder,
} from '../../../features/note/store/note.actions';
import { noteReducer, initialNoteState } from '../../../features/note/store/note.reducer';
import { projectReducer } from '../../../features/project/store/project.reducer';
import {
  addSection,
  updateSection,
  updateSectionOrder,
} from '../../../features/section/store/section.actions';
import {
  sectionReducer,
  initialSectionState,
} from '../../../features/section/store/section.reducer';
import { SectionState } from '../../../features/section/section.model';
import {
  addSimpleCounter,
  setSimpleCounterCounterToday,
  updateSimpleCounter,
  updateSimpleCounterOrder,
} from '../../../features/simple-counter/store/simple-counter.actions';
import {
  simpleCounterReducer,
  initialSimpleCounterState,
} from '../../../features/simple-counter/store/simple-counter.reducer';
import { SimpleCounterState } from '../../../features/simple-counter/simple-counter.model';
import { EMPTY_SIMPLE_COUNTER } from '../../../features/simple-counter/simple-counter.const';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { createBaseState } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { RootState } from '../../../root-store/root-state';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../model/model-config';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ArchiveOperationHandler } from '../../apply/archive-operation-handler.service';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import { Operation } from '../../core/operation.types';
import { UnsupportedMultiEntityConflictError } from '../../core/errors/sync-errors';
import { PersistentAction } from '../../core/persistent-action.interface';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ConflictJournalService } from '../../sync/conflict-journal.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { SupersededOperationResolverService } from '../../sync/superseded-operation-resolver.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { ValidateStateService } from '../../validation/validate-state.service';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';

type TestState = RootState & { section: SectionState; simpleCounter: SimpleCounterState };
const IDS = ['a', 'b', 'untouched'];
const PROJECT = 'project1';
const families = [
  'project notes',
  'Today notes',
  'habits',
  'boards',
  'sections',
] as const;
type Family = (typeof families)[number];

const actionsFor = (
  family: Family,
): { order: PersistentAction; edit: PersistentAction } => {
  if (family.endsWith('notes'))
    return {
      order: updateNoteOrder({
        ids: IDS,
        activeContextType:
          family === 'project notes' ? WorkContextType.PROJECT : WorkContextType.TAG,
        activeContextId: family === 'project notes' ? PROJECT : 'TODAY',
      }),
      edit: updateNote({
        note: { id: IDS[0], changes: { content: 'preserved content' } },
      }),
    };
  if (family === 'habits')
    return {
      order: updateSimpleCounterOrder({ ids: IDS }),
      edit: setSimpleCounterCounterToday({ id: IDS[0], newVal: 3, today: '2026-09-25' }),
    };
  if (family === 'boards')
    return {
      order: BoardsActions.sortBoards({ ids: IDS }),
      edit: BoardsActions.updateBoard({
        id: IDS[0],
        updates: { id: IDS[0], title: 'preserved content', cols: 3, panels: [] },
      }),
    };
  return {
    order: updateSectionOrder({ contextId: PROJECT, ids: IDS }),
    edit: updateSection({
      section: { id: IDS[0], changes: { title: 'preserved content' } },
    }),
  };
};

describe('reorder conflicts: real store, applier, reducers and durable replay (#10264)', () => {
  let store: Store<TestState>;
  let db: OperationLogStoreService;
  let journal: ConflictJournalService;
  let initial: TestState;
  let reducer: ActionReducer<TestState>;
  const state = (): Promise<TestState> => firstValueFrom(store);
  const resetProjection = (value: TestState): void => {
    store.dispatch(
      loadAllData({
        appDataComplete: {
          ...value,
          project: value.projects,
        } as unknown as AppDataComplete,
      }),
    );
  };
  const capture = (value: PersistentAction, id: string, timestamp: number): Operation => {
    const { type, meta, ...actionPayload } = value;
    return {
      ...new TestClient(id).createOperation({
        actionType: type,
        entityType: meta.entityType,
        opType: meta.opType,
        entityId: meta.entityId ?? meta.entityIds![0],
        entityIds: meta.entityIds,
        payload: {
          actionPayload,
          entityChanges: TestBed.inject(OperationCaptureService).extractEntityChanges(
            value,
          ),
        },
      }),
      timestamp,
    };
  };

  beforeEach(async () => {
    resetTestUuidCounter();
    initial = {
      ...createBaseState(),
      note: initialNoteState,
      boards: initialBoardsState,
      section: initialSectionState,
      simpleCounter: initialSimpleCounterState,
    };
    const featureReducer: ActionReducer<TestState> = (s = initial, a: Action) => ({
      ...s,
      projects: projectReducer(s.projects, a),
      note: noteReducer(s.note, a),
      boards: boardsReducer(s.boards, a),
      section: sectionReducer(s.section, a),
      simpleCounter: simpleCounterReducer(s.simpleCounter, a),
    });
    reducer = bulkOperationsMetaReducer(lwwUpdateMetaReducer(featureReducer));
    for (const id of [...IDS].reverse()) {
      for (const a of [
        addNote({
          note: {
            id,
            content: id,
            projectId: PROJECT,
            created: 100,
            modified: 100,
            isPinnedToToday: true,
          },
        }),
        addSimpleCounter({
          simpleCounter: { ...EMPTY_SIMPLE_COUNTER, id, title: id, isEnabled: true },
        }),
        BoardsActions.addBoard({ board: { id, title: id, cols: 2, panels: [] } }),
        addSection({
          section: {
            id,
            title: id,
            contextId: PROJECT,
            contextType: WorkContextType.PROJECT,
            taskIds: [],
          },
        }),
      ])
        initial = reducer(initial, a);
    }
    // Make every initial order differ from IDS, regardless of each add reducer.
    initial = {
      ...initial,
      note: { ...initial.note, todayOrder: [...IDS].reverse() },
      projects: {
        ...initial.projects,
        entities: {
          ...initial.projects.entities,
          [PROJECT]: {
            ...initial.projects.entities[PROJECT]!,
            noteIds: [...IDS].reverse(),
          },
        },
      },
      simpleCounter: {
        ...initial.simpleCounter,
        ids: [...initialSimpleCounterState.ids, ...[...IDS].reverse()],
      },
      section: { ...initial.section, ids: [...IDS].reverse() },
      boards: {
        boardCfgs: [...initial.boards.boardCfgs].sort(
          (a, b) => IDS.indexOf(b.id) - IDS.indexOf(a.id),
        ),
      },
    };
    initial = reducer(
      initial,
      loadAllData({
        appDataComplete: {
          ...initial,
          project: initial.projects,
        } as unknown as AppDataComplete,
      }),
    );
    const effects = jasmine.createSpyObj<OperationLogEffects>('effects', [
      'processDeferredActions',
    ]);
    effects.processDeferredActions.and.resolveTo();
    const validation = jasmine.createSpyObj<ValidateStateService>('validation', [
      'validateAndRepairCurrentState',
    ]);
    validation.validateAndRepairCurrentState.and.resolveTo(true);
    TestBed.configureTestingModule({
      providers: [
        provideStore(
          {
            projects: projectReducer,
            note: noteReducer,
            boards: boardsReducer,
            section: sectionReducer,
            simpleCounter: simpleCounterReducer,
          },
          {
            initialState: initial,
            metaReducers: [bulkOperationsMetaReducer, lwwUpdateMetaReducer],
          },
        ),
        { provide: OperationLogEffects, useValue: effects },
        { provide: ValidateStateService, useValue: validation },
        {
          provide: ArchiveOperationHandler,
          useValue: { handleOperation: async () => {} },
        },
        {
          provide: SnackService,
          useValue: jasmine.createSpyObj('snack', [
            'open',
            'hasPendingPersistentAction',
            'cancelPendingPersistentAction',
          ]),
        },
        {
          provide: CLIENT_ID_PROVIDER,
          useValue: {
            loadClientId: () => Promise.resolve('local'),
            getOrGenerateClientId: () => Promise.resolve('local'),
            clearCache: () => {},
          },
        },
        { provide: ENTITY_REGISTRY, useValue: buildEntityRegistry() },
        {
          provide: StateSnapshotService,
          useValue: {
            getStateSnapshotForOperationLog: () => {
              let current!: TestState;
              store
                .subscribe((s) => {
                  current = s;
                })
                .unsubscribe();
              return { ...current, project: current.projects };
            },
          },
        },
      ],
    });
    store = TestBed.inject(Store);
    db = TestBed.inject(OperationLogStoreService);
    journal = TestBed.inject(ConflictJournalService);
    await db.init();
    await db._clearAllDataForTesting();
    await journal.clearAll();
  });
  afterEach(async () => {
    await db._clearAllDataForTesting();
    await journal.clearAll();
    TestBed.resetTestingModule();
  });

  for (const unsupported of [
    {
      name: 'note pinning',
      family: 'project notes' as const,
      edit: updateNote({
        note: {
          id: IDS[0],
          changes: { content: 'content plus membership', isPinnedToToday: false },
        },
      }),
    },
    {
      name: 'competing note order',
      family: 'project notes' as const,
      edit: updateNoteOrder({
        ids: [...IDS].reverse(),
        activeContextId: PROJECT,
        activeContextType: WorkContextType.PROJECT,
      }),
    },
    {
      name: 'section context change',
      family: 'sections' as const,
      edit: updateSection({
        section: { id: IDS[0], changes: { contextId: 'other-project' } },
      }),
    },
  ]) {
    it('keeps the safety stop for ' + unsupported.name, async () => {
      const localAction = actionsFor(unsupported.family).order;
      const local = capture(localAction, 'local', 1000);
      const remote = capture(unsupported.edit as PersistentAction, 'remote', 2000);
      store.dispatch(localAction);
      await db.append(local, 'local');
      const before = await state();
      const resolver = TestBed.inject(ConflictResolutionService);
      const detected = await resolver.checkOpForConflicts(remote, {
        localPendingOpsByEntity: await db.getUnsyncedByEntity(),
        appliedFrontierByEntity: new Map(),
        retainedOpsByEntity: new Map(),
        snapshotVectorClock: undefined,
        snapshotEntityKeys: undefined,
        hasNoSnapshotClock: true,
      });
      expect(detected.conflicts.length).toBeGreaterThan(0);
      await expectAsync(
        resolver.autoResolveConflictsLWW(detected.conflicts),
      ).toBeRejectedWithError(UnsupportedMultiEntityConflictError);
      expect(await state()).toEqual(before);
      expect((await db.getUnsynced()).map((row) => row.op.id)).toEqual([local.id]);
    });
  }

  it('keeps a disabled habit edit independent of the reissued enabled-only order', async () => {
    const pair = actionsFor('habits');
    const local = capture(pair.order, 'local', 1000);
    const remote = capture(pair.edit, 'remote', 2000);
    store.dispatch(pair.order);
    await db.append(local, 'local');
    const resolver = TestBed.inject(ConflictResolutionService);
    await resolver.autoResolveConflictsLWW([], [remote]);
    await TestBed.inject(SupersededOperationResolverService).resolveSupersededLocalOps([
      { opId: local.id, op: local, existingClock: remote.vectorClock },
    ]);
    const [replacement] = (await db.getUnsynced()).map((row) => row.op);
    const disabledId = initial.simpleCounter.ids[0];
    expect(initial.simpleCounter.entities[disabledId]?.isEnabled).toBe(false);
    const enable = updateSimpleCounter({
      simpleCounter: { id: disabledId, changes: { isEnabled: true } },
    });
    const third = capture(enable, 'third', 3000);
    await db._clearAllDataForTesting();
    resetProjection(initial);
    store.dispatch(enable);
    await db.append(third, 'local');
    const detected = await resolver.checkOpForConflicts(replacement, {
      localPendingOpsByEntity: await db.getUnsyncedByEntity(),
      appliedFrontierByEntity: new Map(),
      retainedOpsByEntity: new Map(),
      snapshotVectorClock: undefined,
      snapshotEntityKeys: undefined,
      hasNoSnapshotClock: true,
    });
    expect(detected.conflicts).toEqual([]);
    await resolver.autoResolveConflictsLWW(detected.conflicts, [remote, replacement]);
    expect((await state()).simpleCounter).toEqual(
      reducer(reducer(reducer(initial, pair.order), pair.edit), enable).simpleCounter,
    );
  });

  for (const family of families) {
    for (const pendingContent of family === 'habits' ? [false, true] : [false]) {
      it(
        family +
          ': retains the pending ' +
          (pendingContent ? 'content' : 'reorder') +
          ' after conflict evidence is compacted',
        async () => {
          const pair = actionsFor(family);
          const localAction = pendingContent ? pair.edit : pair.order;
          const local = capture(localAction, 'local', 1000);
          const remote = capture(pendingContent ? pair.order : pair.edit, 'remote', 2000);
          store.dispatch(localAction);
          await db.append(local, 'local');
          await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW(
            [],
            [remote],
          );
          const before = await state();
          const snapshotClock = { ...local.vectorClock, ...remote.vectorClock };
          // Seed the durable result of compaction; the E2E runs the compactor itself.
          await db.saveStateCache({
            state: { ...before, project: before.projects } as unknown as AppDataComplete,
            lastAppliedOpSeq: await db.getLastSeq(),
            vectorClock: snapshotClock,
            compactedAt: Date.now(),
            schemaVersion: local.schemaVersion,
          });
          await db.deleteOpsWhere((row) => row.op.id === remote.id);
          const retained = await db.getOpsAfterSeq(0);
          expect(retained.map((row) => row.op.id)).toEqual([local.id]);
          await expectAsync(
            TestBed.inject(SupersededOperationResolverService).resolveSupersededLocalOps(
              [{ opId: local.id, op: local, existingClock: remote.vectorClock }],
              [remote.vectorClock],
              snapshotClock,
            ),
          ).toBeRejectedWithError(UnsupportedMultiEntityConflictError);
          expect(await db.getOpsAfterSeq(0)).toEqual(retained);
          expect((await db.getUnsynced()).map((row) => row.op.id)).toEqual([local.id]);
          expect(await state()).toEqual(before);
        },
      );
    }

    for (const remoteReorder of [false, true]) {
      for (const remoteNewer of [false, true]) {
        it(
          family +
            ': ' +
            (remoteReorder ? 'remote' : 'local') +
            ' reorder, ' +
            (remoteNewer ? 'remote' : 'local') +
            ' timestamp wins',
          async () => {
            const pair = actionsFor(family);
            const localAction = (
              remoteReorder ? pair.edit : pair.order
            ) as PersistentAction;
            const remoteAction = (
              remoteReorder ? pair.order : pair.edit
            ) as PersistentAction;
            const local = capture(localAction, 'local', remoteNewer ? 1000 : 2000);
            const remote = capture(remoteAction, 'remote', remoteNewer ? 2000 : 1000);
            store.dispatch(localAction);
            await db.append(local, 'local');
            const resolver = TestBed.inject(ConflictResolutionService);
            const detected = await resolver.checkOpForConflicts(remote, {
              localPendingOpsByEntity: await db.getUnsyncedByEntity(),
              appliedFrontierByEntity: new Map(),
              retainedOpsByEntity: new Map(),
              snapshotVectorClock: undefined,
              snapshotEntityKeys: undefined,
              hasNoSnapshotClock: true,
            });
            // On the baseline this enters LWW and fails closed. Fixed crossings
            // apply the commuting remote action while retaining the pending intent.
            await resolver.autoResolveConflictsLWW(
              detected.conflicts,
              detected.conflicts.length ? [] : [remote],
            );
            expect((await db.getUnsynced()).map((entry) => entry.op.id)).toContain(
              local.id,
            );

            // The server rejects that original concurrent clock. Exercise the
            // actual recovery service (the E2E supplies the real server rejection).
            await TestBed.inject(
              SupersededOperationResolverService,
            ).resolveSupersededLocalOps([
              { opId: local.id, op: local, existingClock: remote.vectorClock },
            ]);
            const replacements = (await db.getUnsynced()).map((entry) => entry.op);
            expect(replacements.length).toBe(1);
            expect((await db.getOpById(local.id))?.rejectedAt).toBeDefined();
            for (const op of replacements) {
              expect(compareVectorClocks(op.vectorClock, remote.vectorClock)).toBe(
                VectorClockComparison.GREATER_THAN,
              );
            }
            const converged = await state();
            const expected = reducer(reducer(initial, pair.order), pair.edit);
            const projection = (s: TestState): object => ({
              note: s.note,
              projects: s.projects,
              boards: s.boards,
              section: s.section,
              simpleCounter: s.simpleCounter,
            });
            expect(projection(converged)).toEqual(projection(expected));

            // Other device applies its own original op then the emitted history.
            // Use the REAL bulk applier, never a spy claiming an op was applied.
            const applier = TestBed.inject(OperationApplierService);
            resetProjection(initial);
            await applier.applyOperations([remote, ...replacements]);
            expect(projection(await state())).toEqual(projection(converged));

            // Restart consumes even rejected rows; fresh-client history omits them.
            const durable = (await db.getOpsAfterSeq(0)).map((row) => row.op);
            resetProjection(initial);
            await applier.applyOperations(durable, { isLocalHydration: true });
            expect(projection(await state())).toEqual(projection(converged));
            resetProjection(initial);
            await applier.applyOperations([remote, ...replacements], {
              isLocalHydration: true,
            });
            expect(projection(await state())).toEqual(projection(converged));
          },
        );
      }
    }
  }
});
