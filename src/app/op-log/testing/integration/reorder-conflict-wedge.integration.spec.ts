import { TestBed } from '@angular/core/testing';
import { Action, ActionReducer, provideStore, Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { SnackService } from '../../../core/snack/snack.service';
import {
  IssueProvider,
  IssueProviderGithub,
  IssueProviderGitlab,
  IssueProviderState,
} from '../../../features/issue/issue.model';
import { IssueProviderActions } from '../../../features/issue/store/issue-provider.actions';
import {
  issueProviderReducer,
  issueProviderInitialState,
} from '../../../features/issue/store/issue-provider.reducer';
import { BoardsActions } from '../../../features/boards/store/boards.actions';
import {
  boardsReducer,
  initialBoardsState,
} from '../../../features/boards/store/boards.reducer';
import {
  addNote,
  deleteNote,
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
  deleteSimpleCounter,
  setSimpleCounterCounterForDate,
  setSimpleCounterCounterToday,
  syncSimpleCounterTime,
  updateSimpleCounter,
  updateSimpleCounterOrder,
} from '../../../features/simple-counter/store/simple-counter.actions';
import {
  simpleCounterReducer,
  initialSimpleCounterState,
} from '../../../features/simple-counter/store/simple-counter.reducer';
import {
  SimpleCounterState,
  SimpleCounterType,
} from '../../../features/simple-counter/simple-counter.model';
import { EMPTY_SIMPLE_COUNTER } from '../../../features/simple-counter/simple-counter.const';
import { WorkContextType } from '../../../features/work-context/work-context.model';
import { createBaseState } from '../../../root-store/meta/task-shared-meta-reducers/test-utils';
import { lwwUpdateMetaReducer } from '../../../root-store/meta/task-shared-meta-reducers/lww-update.meta-reducer';
import { RootState } from '../../../root-store/root-state';
import { TaskSharedActions } from '../../../root-store/meta/task-shared.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../model/model-config';
import { OperationApplierService } from '../../apply/operation-applier.service';
import { ArchiveOperationHandler } from '../../apply/archive-operation-handler.service';
import { bulkOperationsMetaReducer } from '../../apply/bulk-hydration.meta-reducer';
import { StateSnapshotService } from '../../backup/state-snapshot.service';
import { OperationCaptureService } from '../../capture/operation-capture.service';
import { OperationLogEffects } from '../../capture/operation-log.effects';
import { buildEntityRegistry, ENTITY_REGISTRY } from '../../core/entity-registry';
import {
  ActionType,
  extractActionPayload,
  Operation,
  OpType,
} from '../../core/operation.types';
import { UnsupportedMultiEntityConflictError } from '../../core/errors/sync-errors';
import { toLwwUpdateActionType } from '../../core/lww-update-action-types';
import { PersistentAction } from '../../core/persistent-action.interface';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ConflictResolutionService } from '../../sync/conflict-resolution.service';
import { SupersededOperationResolverService } from '../../sync/superseded-operation-resolver.service';
import { CLIENT_ID_PROVIDER } from '../../util/client-id.provider';
import { ValidateStateService } from '../../validation/validate-state.service';
import { resetTestUuidCounter, TestClient } from './helpers/test-client.helper';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';

const actionPayloadOf = (op: Operation): unknown => extractActionPayload(op.payload);
type TestState = RootState & {
  section: SectionState;
  simpleCounter: SimpleCounterState;
  issueProvider: IssueProviderState;
};
const IDS = ['a', 'b', 'untouched'];
const PROJECT = 'project1';
const EDIT_DATE = '2026-09-23';
const OTHER_DATE = '2026-09-24';
const families = [
  'project notes',
  'Today notes',
  'tag notes',
  'habits',
  'habit date counts',
  'boards',
  'sections',
  'issue providers',
] as const;
type Family = (typeof families)[number];
// The Enabled switch submits this full 18-field GitLab model, not a flag delta.
const provider = (id: string): IssueProviderGitlab => ({
  id,
  issueProviderKey: 'GITLAB',
  isEnabled: id !== 'untouched',
  isAutoPoll: false,
  isAutoAddToBacklog: false,
  isIntegratedAddTaskBar: false,
  defaultProjectId: PROJECT,
  pinnedSearch: null,
  pollingMode: 'whenProjectOpen',
  defaultTagIds: [],
  defaultNote: 'Synthetic note',
  project: 'synthetic/provider',
  gitlabBaseUrl: 'https://issues.example.invalid/',
  token: 'synthetic-only-not-a-credential',
  filterUsername: 'synthetic-user',
  scope: 'all',
  filter: 'state=opened',
  isEnableTimeTracking: false,
});
const pluginProvider: IssueProviderGithub = {
  id: IDS[0],
  issueProviderKey: 'GITHUB',
  isEnabled: true,
  pluginId: 'github-issue-provider',
  pluginConfig: {
    repo: 'synthetic/provider',
    token: 'synthetic-only-not-a-credential',
    twoWaySync: { title: 'off', isDone: 'off' },
  },
};

const actionsFor = (
  family: Family,
): { order: PersistentAction; edit: PersistentAction } => {
  if (family.endsWith('notes'))
    return {
      order: updateNoteOrder({
        ids: IDS,
        activeContextType:
          family === 'project notes' ? WorkContextType.PROJECT : WorkContextType.TAG,
        activeContextId:
          family === 'project notes'
            ? PROJECT
            : family === 'tag notes'
              ? 'tag1'
              : 'TODAY',
      }),
      edit: updateNote({
        note: { id: IDS[0], changes: { content: 'preserved content' } },
      }),
    };
  if (family === 'habits' || family === 'habit date counts')
    return {
      order: updateSimpleCounterOrder({ ids: IDS }),
      edit:
        family === 'habits'
          ? setSimpleCounterCounterToday({ id: IDS[0], newVal: 3, today: '2026-09-25' })
          : setSimpleCounterCounterForDate({ id: IDS[0], newVal: 3, date: EDIT_DATE }),
    };
  if (family === 'boards')
    return {
      order: BoardsActions.sortBoards({ ids: IDS }),
      edit: BoardsActions.updateBoard({
        id: IDS[0],
        updates: { id: IDS[0], title: 'preserved content', cols: 3, panels: [] },
      }),
    };
  if (family === 'issue providers')
    return {
      order: IssueProviderActions.sortIssueProvidersFirst({
        ids: [IDS[1], IDS[0], IDS[2]],
      }),
      edit: IssueProviderActions.updateIssueProvider({
        issueProvider: {
          id: IDS[0],
          changes: { ...provider(IDS[0]), isEnabled: false },
        },
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
        entityIds: meta.entityIds ?? (meta.entityId ? [meta.entityId] : undefined),
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
      issueProvider: issueProviderInitialState,
    };
    const featureReducer: ActionReducer<TestState> = (s = initial, a: Action) => ({
      ...s,
      projects: projectReducer(s.projects, a),
      note: noteReducer(s.note, a),
      boards: boardsReducer(s.boards, a),
      section: sectionReducer(s.section, a),
      simpleCounter: simpleCounterReducer(s.simpleCounter, a),
      issueProvider: issueProviderReducer(s.issueProvider, a),
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
          simpleCounter: {
            ...EMPTY_SIMPLE_COUNTER,
            id,
            title: id,
            isEnabled: true,
            type: SimpleCounterType.StopWatch,
            icon: 'timer',
            isHideButton: true,
            streakMinValue: 60000,
            countOnDay: { [EDIT_DATE]: 1, [OTHER_DATE]: 7 },
          },
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
        IssueProviderActions.addIssueProvider({ issueProvider: provider(id) }),
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
            issueProvider: issueProviderReducer,
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
    await db.init();
    await db._clearAllDataForTesting();
  });
  afterEach(async () => {
    await db._clearAllDataForTesting();
    TestBed.resetTestingModule();
  });

  const unsupportedCrossings: {
    name: string;
    family: Family;
    edit: PersistentAction;
    mutate?: (op: Operation) => Operation;
  }[] = [
    ...(['Today notes', 'tag notes'] as const).map((family) => ({
      name: family + ' order vs unpin',
      family,
      edit: updateNote({
        note: {
          id: IDS[0],
          changes: { content: 'content plus membership', isPinnedToToday: false },
        },
      }),
    })),
    ...[
      { name: 'note project move', changes: { projectId: 'other-project' } },
      { name: 'note identity change', changes: { id: 'renamed' } },
    ].map(({ name, changes }) => ({
      name,
      family: 'project notes' as const,
      edit: updateNote({ note: { id: IDS[0], changes } }),
    })),
    {
      name: 'section context change',
      family: 'sections' as const,
      edit: updateSection({
        section: { id: IDS[0], changes: { contextId: 'other-project' } },
      }),
    },
    {
      name: 'section task placement',
      family: 'sections' as const,
      edit: updateSection({
        section: { id: IDS[0], changes: { taskIds: ['placed-task'] } },
      }),
    },
    {
      // Each order fills the slots of its own habits: they differ per side.
      name: 'competing habit order over a different habit set',
      family: 'habits' as const,
      edit: updateSimpleCounterOrder({ ids: ['other-habit', ...IDS].reverse() }),
    },
    {
      name: 'habit deletion',
      family: 'habits' as const,
      edit: deleteSimpleCounter({ id: IDS[0] }),
    },
    {
      name: 'habit time delta',
      family: 'habits' as const,
      edit: syncSimpleCounterTime({ id: IDS[0], date: EDIT_DATE, duration: 1000 }),
    },
    ...[
      { name: 'provider identity change', changes: { id: 'renamed' } },
      { name: 'provider undefined identity', changes: { id: undefined } },
    ].map(({ name, changes }) => ({
      name,
      family: 'issue providers' as const,
      edit: IssueProviderActions.updateIssueProvider({
        issueProvider: { id: IDS[0], changes: { ...provider(IDS[0]), ...changes } },
      }),
    })),
    {
      name: 'competing provider order',
      family: 'issue providers',
      edit: IssueProviderActions.sortIssueProvidersFirst({ ids: [...IDS].reverse() }),
    },
    {
      name: 'provider deletion',
      family: 'issue providers',
      edit: TaskSharedActions.deleteIssueProvider({
        issueProviderId: IDS[0],
        taskIdsToUnlink: [],
      }),
    },
    ...[
      ...[undefined, null, ['invalid'], 'invalid', {}].map((changes) => ({
        name: 'provider malformed changes ' + JSON.stringify(changes),
        mutate: (op: Operation): Operation => ({
          ...op,
          payload: {
            actionPayload: {
              issueProvider: {
                id: IDS[0],
                changes,
              },
            },
            entityChanges: [],
          },
        }),
      })),
      {
        name: 'provider plural update footprint',
        mutate: (op: Operation): Operation => ({ ...op, entityIds: [...IDS] }),
      },
      {
        name: 'provider update with move metadata',
        mutate: (op: Operation): Operation => ({ ...op, opType: OpType.Move }),
      },
      {
        name: 'provider wrapper identity mismatch',
        mutate: (op: Operation): Operation => ({
          ...op,
          entityId: IDS[1],
          entityIds: [IDS[1]],
        }),
      },
    ].map(({ name, mutate }) => ({
      name,
      family: 'issue providers' as const,
      edit: actionsFor('issue providers').edit,
      mutate,
    })),
  ];
  for (const unsupported of unsupportedCrossings) {
    it('keeps the safety stop for ' + unsupported.name, async () => {
      const localAction = actionsFor(unsupported.family).order;
      const local = capture(localAction, 'local', 1000);
      const captured = capture(unsupported.edit, 'remote', 2000);
      const remote = unsupported.mutate ? unsupported.mutate(captured) : captured;
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

  // #10377: a competing order of the same list, or the delete of a listed
  // entity, applies; the pending reorder is then reissued from current state.
  const listOf = (value: TestState, family: 'notes' | 'Today' | 'habits'): string[] =>
    family === 'notes'
      ? value.projects.entities[PROJECT]!.noteIds
      : family === 'Today'
        ? value.note.todayOrder
        : value.simpleCounter.ids;
  const noteOrder = (
    ids: string[],
    context: 'project' | 'TODAY' | 'tag1',
  ): PersistentAction =>
    updateNoteOrder({
      ids,
      activeContextType:
        context === 'project' ? WorkContextType.PROJECT : WorkContextType.TAG,
      activeContextId: context === 'project' ? PROJECT : context,
    });
  const reissuedCrossings: {
    name: string;
    family: 'notes' | 'Today' | 'habits';
    order: PersistentAction;
    other: PersistentAction;
    deleted?: string;
  }[] = [
    {
      name: 'competing project note orders',
      family: 'notes',
      order: noteOrder(IDS, 'project'),
      other: noteOrder([IDS[1], IDS[2], IDS[0]], 'project'),
    },
    {
      name: 'a Today note order and a tag note order',
      family: 'Today',
      order: noteOrder(IDS, 'TODAY'),
      other: noteOrder([IDS[2], IDS[0], IDS[1]], 'tag1'),
    },
    {
      name: 'a project note order and a Today note order',
      family: 'notes',
      order: noteOrder(IDS, 'project'),
      other: noteOrder([IDS[2], IDS[0], IDS[1]], 'TODAY'),
    },
    {
      name: 'competing habit orders',
      family: 'habits',
      order: updateSimpleCounterOrder({ ids: IDS }),
      other: updateSimpleCounterOrder({ ids: [IDS[1], IDS[2], IDS[0]] }),
    },
    {
      name: 'a project note order and a note deletion',
      family: 'notes',
      order: noteOrder(IDS, 'project'),
      other: deleteNote({ id: IDS[1], projectId: PROJECT, isPinnedToToday: true }),
      deleted: IDS[1],
    },
    {
      name: 'a Today note order and a note deletion',
      family: 'Today',
      order: noteOrder(IDS, 'TODAY'),
      other: deleteNote({ id: IDS[1], projectId: PROJECT, isPinnedToToday: true }),
      deleted: IDS[1],
    },
  ];
  for (const crossing of reissuedCrossings) {
    for (const [pendingOrder, via] of [
      [true, 'download'],
      [true, 'server rejection'],
      ...(crossing.deleted ? [[false, 'download']] : []),
    ] as const) {
      const pendingSide = pendingOrder ? 'order' : 'other';
      it(`converges ${crossing.name} (pending ${pendingSide}, via ${via})`, async () => {
        const localAction = pendingOrder ? crossing.order : crossing.other;
        const remoteAction = pendingOrder ? crossing.other : crossing.order;
        const local = capture(localAction, 'local', 2000);
        const remote = capture(remoteAction, 'remote', 1000);
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
        expect(detected).toEqual({ isSupersededOrDuplicate: false, conflicts: [] });
        await resolver.autoResolveConflictsLWW([], [remote]);
        const superseded = TestBed.inject(SupersededOperationResolverService);
        const created =
          via === 'download'
            ? (await superseded.reissueCrossedPendingReorders()).created
            : await superseded.resolveSupersededLocalOps([
                { opId: local.id, op: local, existingClock: remote.vectorClock },
              ]);
        const after = await state();
        const list = listOf(after, crossing.family);
        if (crossing.deleted) {
          // The delete wins; the order keeps its positions of the others.
          expect(list).not.toContain(crossing.deleted);
          const ordered = IDS.filter((id) => id !== crossing.deleted);
          expect(list.filter((id) => IDS.includes(id))).toEqual(ordered);
        }

        const pendingOps = (await db.getUnsynced()).map((row) => row.op);
        const received: Operation[] = [remote];
        if (pendingOrder) {
          expect(created).toBe(1);
          expect((await db.getOpById(local.id))?.rejectedAt).toBeDefined();
          expect(pendingOps.length).toBe(1);
          const [replacement] = pendingOps;
          expect(replacement.actionType).toBe(local.actionType);
          expect(replacement.entityIds).toEqual(
            (actionPayloadOf(replacement) as { ids: string[] }).ids,
          );
          for (const clock of [local.vectorClock, remote.vectorClock]) {
            expect(compareVectorClocks(replacement.vectorClock, clock)).toBe(
              VectorClockComparison.GREATER_THAN,
            );
          }
          received.push(replacement);
        } else {
          // The pending delete uploads as it is; nothing to reissue.
          expect(created).toBe(0);
          expect(pendingOps.map((op) => op.id)).toEqual([local.id]);
          received.push(local);
        }

        // Restart replay, and the device that sent `remote` receiving the
        // upload, reach the same list.
        const applier = TestBed.inject(OperationApplierService);
        const durable = (await db.getOpsAfterSeq(0)).map((row) => row.op);
        for (const history of [durable, received]) {
          resetProjection(initial);
          await applier.applyOperations(history, { isLocalHydration: true });
          expect(listOf(await state(), crossing.family)).toEqual(list);
        }
      });
    }
  }

  for (const ordersAdded of [true, false]) {
    it(`keeps a note added ${ordersAdded ? 'and ordered' : 'after the order'} beside a crossed project order in every list`, async () => {
      const add = addNote({
        note: {
          id: 'added',
          content: 'added',
          projectId: PROJECT,
          created: 100,
          modified: 100,
          isPinnedToToday: false,
        },
      });
      const addOp = capture(add, 'local', 1500);
      const orderAction = noteOrder(
        ordersAdded ? ['added', ...IDS] : [...IDS],
        'project',
      );
      const local = {
        ...capture(orderAction, 'local', 2000),
        vectorClock: { ...addOp.vectorClock, local: 2 },
      };
      const remote = capture(
        noteOrder([IDS[1], IDS[2], IDS[0]], 'project'),
        'remote',
        1000,
      );
      for (const [action, op] of [
        [add, addOp],
        [orderAction, local],
      ] as const) {
        store.dispatch(action);
        await db.append(op, 'local');
      }
      await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW(
        [],
        [remote],
      );
      expect(
        await TestBed.inject(
          SupersededOperationResolverService,
        ).reissueCrossedPendingReorders(),
      ).toEqual({ created: 1, deferredOpIds: [] });
      const list = (await state()).projects.entities[PROJECT]!.noteIds;
      expect(list).toContain('added');

      // The device that sent `remote` receives the add and the reissue.
      const reissue = (await db.getUnsynced())
        .map((row) => row.op)
        .find((op) => op.actionType === local.actionType)!;
      resetProjection(initial);
      await TestBed.inject(OperationApplierService).applyOperations(
        [remote, addOp, reissue],
        { isLocalHydration: true },
      );
      expect((await state()).projects.entities[PROJECT]!.noteIds).toEqual(list);
    });
  }

  it('leaves a crossed order pending when compaction removed the proof', async () => {
    const localAction = noteOrder(IDS, 'project');
    const local = capture(localAction, 'local', 2000);
    const remote = capture(
      noteOrder([IDS[1], IDS[2], IDS[0]], 'project'),
      'remote',
      1000,
    );
    store.dispatch(localAction);
    await db.append(local, 'local');
    await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW([], [remote]);
    await db.deleteOpsWhere((row) => row.op.id === remote.id);

    // Nothing shows the crossing any more; the server-rejection path keeps
    // its safety stop for it.
    expect(
      await TestBed.inject(
        SupersededOperationResolverService,
      ).reissueCrossedPendingReorders(),
    ).toEqual({ created: 0, deferredOpIds: [] });
    expect((await db.getUnsynced()).map((row) => row.op.id)).toEqual([local.id]);
  });

  it('defers a crossed order while a local change awaits persistence', async () => {
    const localAction = noteOrder(IDS, 'project');
    const local = capture(localAction, 'local', 2000);
    const remote = capture(
      noteOrder([IDS[1], IDS[2], IDS[0]], 'project'),
      'remote',
      1000,
    );
    store.dispatch(localAction);
    await db.append(local, 'local');
    await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW([], [remote]);
    const pendingWrites = spyOn(
      TestBed.inject(OperationCaptureService),
      'getPendingCount',
    ).and.returnValue(1);
    const resolver = TestBed.inject(SupersededOperationResolverService);

    // The upload must hold it back until the reissue can run.
    expect(await resolver.reissueCrossedPendingReorders()).toEqual({
      created: 0,
      deferredOpIds: [local.id],
    });
    expect((await db.getUnsynced()).map((row) => row.op.id)).toEqual([local.id]);

    // The next download or upload reissues it from the retained remote row.
    pendingWrites.and.returnValue(0);
    expect(await resolver.reissueCrossedPendingReorders()).toEqual({
      created: 1,
      deferredOpIds: [],
    });
    expect((await db.getOpById(local.id))?.rejectedAt).toBeDefined();
  });

  it('keeps the safety stop when one note has two pending membership writes', async () => {
    // Both would be reissued as pins, which released receivers prepend twice.
    const edits = [false, true].map((isPinnedToToday) =>
      updateNote({ note: { id: IDS[0], changes: { isPinnedToToday } } }),
    );
    const locals = edits.map((edit, index) => ({
      ...capture(edit, 'local', 1000 + index),
      vectorClock: { local: index + 1 },
    }));
    for (const [index, edit] of edits.entries()) {
      store.dispatch(edit);
      await db.append(locals[index], 'local');
    }
    const before = await state();
    const remote = capture(actionsFor('project notes').order, 'remote', 2000);
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
    expect((await db.getUnsynced()).map((row) => row.op.id)).toEqual(
      locals.map((op) => op.id),
    );
  });

  // Without causal proof a pin keeps the whole-note snapshot fallback: stopping
  // sync would leave the whole-dataset replacement as the only way out. The
  // snapshot carries isPinnedToToday but not receivers' Today list write (a
  // documented gap). Proof is missing after compaction, and on clock-gap
  // rejections against a retained row that is no commuting reorder.
  for (const evidence of ['compacted order row', 'unrelated retained edit'] as const) {
    it(`falls back to the note snapshot for an unpin without causal proof (${evidence})`, async () => {
      const unpin = updateNote({
        note: { id: IDS[0], changes: { isPinnedToToday: false } },
      });
      const local = capture(unpin, 'local', 1000);
      const remote = capture(
        evidence === 'compacted order row'
          ? actionsFor('project notes').order
          : updateNote({ note: { id: IDS[0], changes: { content: 'remote content' } } }),
        'remote',
        2000,
      );
      store.dispatch(unpin);
      await db.append(local, 'local');
      await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW(
        [],
        [remote],
      );
      const before = await state();
      expect(before.note.todayOrder).not.toContain(IDS[0]);
      const snapshotClock = { ...local.vectorClock, ...remote.vectorClock };
      if (evidence === 'compacted order row') {
        await db.saveStateCache({
          state: { ...before, project: before.projects } as unknown as AppDataComplete,
          lastAppliedOpSeq: await db.getLastSeq(),
          vectorClock: snapshotClock,
          compactedAt: Date.now(),
          schemaVersion: local.schemaVersion,
        });
        await db.deleteOpsWhere((row) => row.op.id === remote.id);
      }
      const created = await TestBed.inject(
        SupersededOperationResolverService,
      ).resolveSupersededLocalOps(
        [{ opId: local.id, op: local, existingClock: remote.vectorClock }],
        [remote.vectorClock],
        snapshotClock,
      );
      expect(created).toBe(1);
      expect((await db.getOpById(local.id))?.rejectedAt).toBeDefined();
      const unsynced = (await db.getUnsynced()).map((row) => row.op);
      expect(unsynced.length).toBe(1);
      const [replacement] = unsynced;
      expect(replacement.actionType).toBe(toLwwUpdateActionType('NOTE'));
      expect(replacement.entityId).toBe(IDS[0]);
      expect(actionPayloadOf(replacement)).toEqual(
        jasmine.objectContaining({ id: IDS[0], isPinnedToToday: false }),
      );
      expect(compareVectorClocks(replacement.vectorClock, remote.vectorClock)).toBe(
        VectorClockComparison.GREATER_THAN,
      );
      expect(await state()).toEqual(before);
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

  it('projects date-count replacements from durable successors and keeps both dates', async () => {
    const pair = actionsFor('habit date counts');
    const first = capture(pair.edit, 'local', 1000);
    const otherAction = setSimpleCounterCounterForDate({
      id: IDS[0],
      date: OTHER_DATE,
      newVal: 4,
    });
    const other = {
      ...capture(otherAction, 'local', 1100),
      vectorClock: { local: 2 },
    };
    const successorAction = setSimpleCounterCounterForDate({
      id: IDS[0],
      date: EDIT_DATE,
      newVal: 9,
    });
    const successor = {
      ...capture(successorAction, 'local', 1200),
      vectorClock: { local: 3 },
    };
    for (const [action, operation] of [
      [pair.edit, first],
      [otherAction, other],
      [successorAction, successor],
    ] as const) {
      store.dispatch(action);
      await db.append(operation, 'local');
    }
    const remote = capture(pair.order, 'remote', 2000);
    await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW([], [remote]);
    const converged = await state();
    await TestBed.inject(SupersededOperationResolverService).resolveSupersededLocalOps(
      [first, other].map((op) => ({
        opId: op.id,
        op,
        existingClock: remote.vectorClock,
      })),
    );
    const replacements = (await db.getUnsynced())
      .map((row) => row.op)
      .filter((op) => op.id !== successor.id);
    expect(replacements.length).toBe(2);
    expect(replacements.map((op) => op.actionType)).toEqual([
      ActionType.COUNTER_SET_FOR_DATE,
      ActionType.COUNTER_SET_FOR_DATE,
    ]);
    expect(replacements.map((op) => extractActionPayload(op.payload))).toEqual([
      { id: IDS[0], date: EDIT_DATE, newVal: 9 },
      { id: IDS[0], date: OTHER_DATE, newVal: 4 },
    ]);
    expect((await state()).simpleCounter).toEqual(converged.simpleCounter);
    for (const op of [first, other])
      expect((await db.getOpById(op.id))?.rejectedAt).toBeDefined();
    const durable = (await db.getOpsAfterSeq(0)).map((row) => row.op);
    const applier = TestBed.inject(OperationApplierService);
    for (const history of [durable, [remote, successor, ...replacements]]) {
      resetProjection(initial);
      await applier.applyOperations(history, { isLocalHydration: true });
      expect((await state()).simpleCounter).toEqual(converged.simpleCounter);
    }
  });

  for (const pending of ['order', 'settings', 'deleted settings'] as const) {
    it(
      'issue providers: projects ' + pending + ' against later durable changes',
      async () => {
        const pair = actionsFor('issue providers');
        const pendingContent = pending !== 'order';
        const localAction = pendingContent ? pair.edit : pair.order;
        const local = capture(localAction, 'local', 1000);
        const remote = capture(pendingContent ? pair.order : pair.edit, 'remote', 2000);
        store.dispatch(localAction);
        await db.append(local, 'local');
        await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW(
          [],
          [remote],
        );

        const deletedId = pending === 'settings' ? IDS[2] : IDS[0];
        const currentIds = ['new-provider', ...IDS.filter((id) => id !== deletedId)];
        const laterActions = [
          TaskSharedActions.deleteIssueProvider({
            issueProviderId: deletedId,
            taskIdsToUnlink: [],
          }),
          IssueProviderActions.addIssueProvider({
            issueProvider: provider('new-provider'),
          }),
          IssueProviderActions.sortIssueProvidersFirst({ ids: currentIds }),
          ...(pending === 'settings'
            ? [
                IssueProviderActions.updateIssueProvider({
                  issueProvider: {
                    id: IDS[0],
                    changes: {
                      isEnabled: true,
                      filter: 'state=closed',
                      migratedFromProjectId: 'later-project',
                    },
                  },
                }),
              ]
            : []),
        ];
        const successors: Operation[] = [];
        for (const [index, action] of laterActions.entries()) {
          const op = {
            ...capture(action, 'local', 3000 + index),
            vectorClock: { ...remote.vectorClock, local: index + 2 },
          };
          store.dispatch(action);
          await db.append(op, 'local');
          successors.push(op);
        }
        const before = await state();
        const created = await TestBed.inject(
          SupersededOperationResolverService,
        ).resolveSupersededLocalOps([
          { opId: local.id, op: local, existingClock: remote.vectorClock },
        ]);
        const replacements = (await db.getUnsynced())
          .map((row) => row.op)
          .filter((op) => !successors.some((successor) => successor.id === op.id));
        expect(created).toBe(pending === 'deleted settings' ? 0 : 1);
        expect(replacements.length).toBe(created);
        expect((await db.getOpById(local.id))?.rejectedAt).toBeDefined();
        expect(await state()).toEqual(before);
        if (pending === 'order') {
          expect(actionPayloadOf(replacements[0])).toEqual({ ids: currentIds });
          expect(replacements[0].entityIds).toEqual(currentIds);
        } else if (pending === 'settings') {
          expect(actionPayloadOf(replacements[0])).toEqual({
            issueProvider: {
              id: IDS[0],
              changes: { ...provider(IDS[0]), isEnabled: true, filter: 'state=closed' },
            },
          });
        }
        const applier = TestBed.inject(OperationApplierService);
        const durable = (await db.getOpsAfterSeq(0)).map((row) => row.op);
        for (const history of [durable, [remote, ...successors, ...replacements]]) {
          resetProjection(initial);
          await applier.applyOperations(history, { isLocalHydration: true });
          expect((await state()).issueProvider).toEqual(before.issueProvider);
          expect((await state()).issueProvider.entities[deletedId]).toBeUndefined();
        }
      },
    );
  }

  for (const family of families) {
    for (const pendingContent of family.startsWith('habit') ? [false, true] : [false]) {
      for (const compacted of family === 'habit date counts' ? [false, true] : [true]) {
        it(
          family +
            (pendingContent
              ? ': reissues the pending count'
              : ': retains the pending reorder') +
            (compacted
              ? ' after conflict evidence is compacted'
              : ' without retained conflict evidence'),
          async () => {
            const pair = actionsFor(family);
            const localAction = pendingContent ? pair.edit : pair.order;
            const local = capture(localAction, 'local', 1000);
            const remote = capture(
              pendingContent ? pair.order : pair.edit,
              'remote',
              2000,
            );
            store.dispatch(localAction);
            await db.append(local, 'local');
            if (compacted)
              await TestBed.inject(ConflictResolutionService).autoResolveConflictsLWW(
                [],
                [remote],
              );
            const before = await state();
            const snapshotClock = { ...local.vectorClock, ...remote.vectorClock };
            // Seed the durable result of compaction; the E2E runs the compactor itself.
            if (compacted) {
              await db.saveStateCache({
                state: {
                  ...before,
                  project: before.projects,
                } as unknown as AppDataComplete,
                lastAppliedOpSeq: await db.getLastSeq(),
                vectorClock: snapshotClock,
                compactedAt: Date.now(),
                schemaVersion: local.schemaVersion,
              });
              await db.deleteOpsWhere((row) => row.op.id === remote.id);
            }
            const retained = await db.getOpsAfterSeq(0);
            expect(retained.map((row) => row.op.id)).toEqual([local.id]);
            const resolve = TestBed.inject(
              SupersededOperationResolverService,
            ).resolveSupersededLocalOps(
              [{ opId: local.id, op: local, existingClock: remote.vectorClock }],
              [remote.vectorClock],
              compacted ? snapshotClock : undefined,
            );
            if (!pendingContent) {
              await expectAsync(resolve).toBeRejectedWithError(
                UnsupportedMultiEntityConflictError,
              );
              expect(await db.getOpsAfterSeq(0)).toEqual(retained);
              expect((await db.getUnsynced()).map((row) => row.op.id)).toEqual([
                local.id,
              ]);
              expect(await state()).toEqual(before);
              return;
            }
            await resolve;
            const [replacement, ...others] = (await db.getUnsynced()).map(
              (row) => row.op,
            );
            expect(others).toEqual([]);
            expect(replacement.id).not.toBe(local.id);
            expect(replacement.actionType).toBe(local.actionType);
            expect((await db.getOpById(local.id))?.rejectedAt).toBeDefined();
            const originalPayload = extractActionPayload(local.payload);
            const replacementPayload = extractActionPayload(replacement.payload);
            if (family === 'habit date counts') {
              expect(originalPayload).toEqual({
                id: IDS[0],
                date: EDIT_DATE,
                newVal: 3,
              });
              expect(replacementPayload).toEqual({
                id: IDS[0],
                date: EDIT_DATE,
                newVal: before.simpleCounter.entities[IDS[0]]!.countOnDay[EDIT_DATE],
              });
            } else {
              expect(replacementPayload).toEqual(originalPayload);
            }
            for (const clock of [local.vectorClock, remote.vectorClock]) {
              expect(compareVectorClocks(replacement.vectorClock, clock)).toBe(
                VectorClockComparison.GREATER_THAN,
              );
            }
            expect(await state()).toEqual(before);
            resetProjection(before);
            await TestBed.inject(OperationApplierService).applyOperations(
              [replacement, replacement],
              { isLocalHydration: true },
            );
            expect((await state()).simpleCounter).toEqual(before.simpleCounter);
          },
        );
      }
    }

    if (family.startsWith('habit')) {
      it(family + ': reissues a pending count without an entity clock', async () => {
        const pair = actionsFor(family);
        const local = capture(pair.edit, 'local', 1000);
        store.dispatch(pair.edit);
        await db.append(local, 'local');
        const before = await state();
        await TestBed.inject(
          SupersededOperationResolverService,
        ).resolveSupersededLocalOps([{ opId: local.id, op: local }]);
        const [replacement, ...others] = (await db.getUnsynced()).map((row) => row.op);
        expect(others).toEqual([]);
        expect(replacement.actionType).toBe(local.actionType);
        expect(extractActionPayload(replacement.payload)).toEqual(
          extractActionPayload(local.payload),
        );
        expect(compareVectorClocks(replacement.vectorClock, local.vectorClock)).toBe(
          VectorClockComparison.GREATER_THAN,
        );
        expect(await state()).toEqual(before);
      });
    }
  }

  const convergenceCases: {
    family: Family;
    name: string;
    seed?: IssueProvider;
    changes?: Partial<IssueProvider>;
    /** Applied to the shared baseline first. */
    prepare?: PersistentAction;
    edit?: PersistentAction;
  }[] = [
    ...families.map((family) => ({ family, name: family })),
    {
      family: 'project notes',
      name: 'project notes: unpin with content',
      edit: updateNote({
        note: {
          id: IDS[0],
          changes: { content: 'content plus membership', isPinnedToToday: false },
        },
      }),
    },
    {
      family: 'project notes',
      name: 'project notes: pin',
      prepare: updateNote({ note: { id: IDS[0], changes: { isPinnedToToday: false } } }),
      edit: updateNote({ note: { id: IDS[0], changes: { isPinnedToToday: true } } }),
    },
    ...(['project notes', 'Today notes', 'tag notes'] as const).map((family) => ({
      family,
      name: family + ': lock',
      edit: updateNote({ note: { id: IDS[0], changes: { isLock: true } } }),
    })),
    {
      family: 'sections',
      name: 'sections: collapse',
      edit: updateSection({ section: { id: IDS[0], changes: { isExpanded: false } } }),
    },
    {
      family: 'habits',
      name: 'habits: settings dialog disables',
      // The dialog submits its whole normalized model, never a flag delta.
      edit: updateSimpleCounter({
        simpleCounter: {
          id: IDS[0],
          changes: {
            title: 'renamed',
            isEnabled: false,
            isHideButton: true,
            icon: 'timer',
            type: SimpleCounterType.StopWatch,
            isTrackStreaks: false,
            streakMinValue: undefined,
            streakMode: undefined,
            streakWeekDays: undefined,
            streakWeeklyFrequency: undefined,
            countdownDuration: undefined,
          },
        },
      }),
    },
    {
      family: 'issue providers',
      name: 'issue providers: partial pinned search',
      changes: { pinnedSearch: 'assigned to me' },
    },
    {
      family: 'issue providers',
      name: 'issue providers: optional settings field',
      changes: { ...provider(IDS[0]), migratedFromProjectId: PROJECT },
    },
    {
      family: 'issue providers',
      name: 'issue providers: nested plugin settings',
      seed: pluginProvider,
      changes: {
        ...pluginProvider,
        pluginConfig: {
          ...pluginProvider.pluginConfig,
          twoWaySync: { title: 'pullOnly', isDone: 'off' },
        },
      },
    },
  ];
  for (const scenario of convergenceCases) {
    for (const remoteReorder of [false, true]) {
      for (const remoteNewer of [false, true]) {
        it(
          scenario.name +
            ': ' +
            (remoteReorder ? 'remote' : 'local') +
            ' reorder, ' +
            (remoteNewer ? 'remote' : 'local') +
            ' timestamp wins',
          async () => {
            if (scenario.seed) {
              initial = {
                ...initial,
                issueProvider: {
                  ...initial.issueProvider,
                  entities: {
                    ...initial.issueProvider.entities,
                    [scenario.seed.id]: scenario.seed,
                  },
                },
              };
              resetProjection(initial);
            }
            if (scenario.prepare) {
              initial = reducer(initial, scenario.prepare);
              resetProjection(initial);
            }
            const pair = actionsFor(scenario.family);
            if (scenario.edit) pair.edit = scenario.edit;
            if (scenario.changes) {
              pair.edit = IssueProviderActions.updateIssueProvider({
                issueProvider: { id: IDS[0], changes: scenario.changes },
              });
            }
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
            if (scenario.family === 'habit date counts') {
              expect((remoteReorder ? local : remote).actionType).toBe(
                ActionType.COUNTER_SET_FOR_DATE,
              );
              expect(local.actionType).toBe(localAction.type);
              expect(remote.actionType).toBe(remoteAction.type);
              expect(replacements[0].actionType).toBe(localAction.type);
              expect(extractActionPayload(replacements[0].payload)).toEqual(
                remoteReorder ? { id: IDS[0], date: EDIT_DATE, newVal: 3 } : { ids: IDS },
              );
            }
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
              issueProvider: s.issueProvider,
            });
            expect(projection(converged)).toEqual(projection(expected));
            for (const list of [
              converged.note.todayOrder,
              converged.projects.entities[PROJECT]!.noteIds,
              converged.simpleCounter.ids,
              converged.section.ids,
              converged.boards.boardCfgs.map((board) => board.id),
              converged.issueProvider.ids,
            ])
              expect(new Set(list).size).toBe(list.length);
            if (scenario.family === 'habits') {
              expect(converged.simpleCounter.entities[IDS[0]]!.type).toBe(
                SimpleCounterType.StopWatch,
              );
            }
            if (scenario.family === 'habit date counts') {
              const habit = converged.simpleCounter.entities[IDS[0]]!;
              expect(habit.countOnDay).toEqual({ [EDIT_DATE]: 3, [OTHER_DATE]: 7 });
              expect(habit.type).toBe(SimpleCounterType.StopWatch);
              expect(habit.icon).toBe('timer');
              expect(habit.isHideButton).toBe(true);
              expect(habit.streakMinValue).toBe(60000);
              expect(new Set(converged.simpleCounter.ids).size).toBe(
                converged.simpleCounter.ids.length,
              );
              for (const id of initial.simpleCounter.ids.filter(
                (otherId) => otherId !== IDS[0],
              )) {
                expect(converged.simpleCounter.entities[id]).toEqual(
                  initial.simpleCounter.entities[id],
                );
                if (!initial.simpleCounter.entities[id]?.isEnabled)
                  expect(converged.simpleCounter.ids.indexOf(id)).toBe(
                    initial.simpleCounter.ids.indexOf(id),
                  );
              }
            }

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
