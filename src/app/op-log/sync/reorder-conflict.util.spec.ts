import { Action, ActionReducer, MetaReducer } from '@ngrx/store';
import { Note } from '../../features/note/note.model';
import {
  addNote,
  deleteNote,
  updateNote,
  updateNoteOrder,
} from '../../features/note/store/note.actions';
import { initialNoteState, noteReducer } from '../../features/note/store/note.reducer';
import { projectReducer } from '../../features/project/store/project.reducer';
import { tagReducer } from '../../features/tag/store/tag.reducer';
import { taskReducer } from '../../features/tasks/store/task.reducer';
import { plannerReducer } from '../../features/planner/store/planner.reducer';
import { Section, SectionState } from '../../features/section/section.model';
import {
  addSection,
  updateSection,
  updateSectionOrder,
} from '../../features/section/store/section.actions';
import {
  initialSectionState,
  sectionReducer,
} from '../../features/section/store/section.reducer';
import {
  SimpleCounterCopy,
  SimpleCounterState,
  SimpleCounterType,
} from '../../features/simple-counter/simple-counter.model';
import {
  addSimpleCounter,
  deleteSimpleCounter,
  setSimpleCounterCounterForDate,
  setSimpleCounterCounterToday,
  updateSimpleCounter,
  updateSimpleCounterOrder,
} from '../../features/simple-counter/store/simple-counter.actions';
import {
  initialSimpleCounterState,
  simpleCounterReducer,
} from '../../features/simple-counter/store/simple-counter.reducer';
import { EMPTY_SIMPLE_COUNTER } from '../../features/simple-counter/simple-counter.const';
import { BoardCfg } from '../../features/boards/boards.model';
import { BoardsActions } from '../../features/boards/store/boards.actions';
import {
  boardsReducer,
  initialBoardsState,
} from '../../features/boards/store/boards.reducer';
import { DEFAULT_PANEL_CFG } from '../../features/boards/boards.const';
import {
  IssueProvider,
  IssueProviderPluginType,
  IssueProviderState,
} from '../../features/issue/issue.model';
import { IssueProviderActions } from '../../features/issue/store/issue-provider.actions';
import {
  issueProviderInitialState,
  issueProviderReducer,
} from '../../features/issue/store/issue-provider.reducer';
import {
  DEFAULT_ISSUE_PROVIDER_CFGS,
  ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
} from '../../features/issue/issue.const';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { META_REDUCERS } from '../../root-store/meta/meta-reducer-registry';
import { reducerFailureGuardMetaReducer } from '../../root-store/meta/reducer-failure-guard.meta-reducer';
import { actionLoggerReducer } from '../../root-store/meta/action-logger.reducer';
import { createBaseState } from '../../root-store/meta/task-shared-meta-reducers/test-utils';
import { RootState } from '../../root-store/root-state';
import { operationCaptureMetaReducer } from '../capture/operation-capture.meta-reducer';
import { EntityConflict, Operation, OpType } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import {
  areCommutingReorderAndContentOperations,
  isReissuedReorderCrossing,
  keptCommutingReorders,
  KeptReorders,
  nonCommutingPendingOps,
  rebaseKeptReorders,
  selectCrossedPendingReorders,
} from './reorder-conflict.util';

/**
 * Pins the one reorder rule to what the reducers write. Every field of every
 * single-entity patch runs through the real feature reducers and the registered
 * meta-reducers against every reorder shape; the `Required<…>` fixtures make a
 * new model field a compile error here until it is exercised. Whatever the rule
 * admits must leave the reordered list and its membership alone, commute with
 * the reorder in both application orders and stay idempotent, because restart
 * replays a rejected original, the concurrent order and then the reissue.
 */
type State = RootState & {
  section: SectionState;
  simpleCounter: SimpleCounterState;
  issueProvider: IssueProviderState;
};

const P = 'project1';
const OTHER_PROJECT = 'project2';
const DAY = '2026-09-20';
const OTHER_DAY = '2026-09-19';

// The guard would hide a throw; capture and the logger never write state.
const skipped: MetaReducer[] = [
  reducerFailureGuardMetaReducer,
  operationCaptureMetaReducer,
  actionLoggerReducer,
];
const reduce: ActionReducer<State> = META_REDUCERS.filter(
  (meta) => !skipped.includes(meta),
).reduceRight(
  (inner, meta) => meta(inner) as ActionReducer<State>,
  (s: State | undefined, a: Action): State => {
    const st = s as State;
    return {
      ...st,
      tasks: taskReducer(st.tasks, a),
      tag: tagReducer(st.tag, a),
      projects: projectReducer(st.projects, a),
      planner: plannerReducer(st.planner, a),
      note: noteReducer(st.note, a),
      section: sectionReducer(st.section, a),
      simpleCounter: simpleCounterReducer(st.simpleCounter, a),
      boards: boardsReducer(st.boards, a),
      issueProvider: issueProviderReducer(st.issueProvider, a),
    };
  },
);
const apply = (s: State, actions: Action[]): State => actions.reduce(reduce, s);

const provider = (id: string): IssueProvider =>
  ({
    ...DEFAULT_ISSUE_PROVIDER_CFGS.GITLAB,
    ...ISSUE_PROVIDER_DEFAULT_COMMON_CFG,
    id,
    issueProviderKey: 'GITLAB',
    isEnabled: true,
  }) as IssueProvider;

const buildBase = (): State => {
  const base = createBaseState();
  const project = base.projects.entities[P]!;
  return apply(
    {
      ...base,
      projects: {
        ids: [P, OTHER_PROJECT],
        entities: { [P]: project, [OTHER_PROJECT]: { ...project, id: OTHER_PROJECT } },
      },
      note: initialNoteState,
      section: initialSectionState,
      simpleCounter: initialSimpleCounterState,
      boards: initialBoardsState,
      issueProvider: issueProviderInitialState,
    },
    [
      // Today lists t, b, a; project P lists a, b, w (w is not pinned).
      ...['t', 'w', 'b', 'a'].map((id) =>
        addNote({
          note: {
            id,
            projectId: id === 't' ? null : P,
            isPinnedToToday: id !== 'w',
            content: id,
            created: 1,
            modified: 1,
          },
        }),
      ),
      ...['alpha', 'foreign', 'beta', 'untouched'].map((id) =>
        addSection({
          section: {
            id,
            title: id,
            contextId: id === 'foreign' ? 'TODAY' : P,
            contextType: id === 'foreign' ? WorkContextType.TAG : WorkContextType.PROJECT,
            taskIds: [],
          },
        }),
      ),
      ...['a', 'disabled', 'b', 'u'].map((id) =>
        addSimpleCounter({
          simpleCounter: {
            ...EMPTY_SIMPLE_COUNTER,
            id,
            title: id,
            isEnabled: id !== 'disabled',
            type: SimpleCounterType.StopWatch,
            countOnDay: Object.fromEntries([[DAY, 1]]),
          },
        }),
      ),
      ...['a', 'b', 'u'].map((id) =>
        BoardsActions.addBoard({
          board: {
            id,
            title: id,
            cols: 2,
            panels: [{ ...DEFAULT_PANEL_CFG, id: `panel-${id}` }],
          },
        }),
      ),
      ...['a', 'b', 'u'].map((id) =>
        IssueProviderActions.addIssueProvider({ issueProvider: provider(id) }),
      ),
    ],
  );
};

// Every model field, each with a value that differs from the fixture.
const NOTE_FIELDS: Required<Note> = {
  id: 'a',
  projectId: OTHER_PROJECT,
  isPinnedToToday: false,
  content: 'changed',
  imgUrl: 'https://img.example.invalid/x.png',
  isLock: true,
  backgroundColor: '#123456',
  created: 5,
  modified: 6,
};
const COUNTER_FIELDS: Required<SimpleCounterCopy> = {
  id: 'a',
  title: 'changed',
  isEnabled: false,
  isHideButton: true,
  icon: 'star',
  type: SimpleCounterType.ClickCounter,
  isTrackStreaks: true,
  streakMinValue: 3,
  streakMode: 'weekly-frequency',
  streakWeekDays: Object.fromEntries([[1, true]]),
  streakWeeklyFrequency: 2,
  countdownDuration: 60000,
  countOnDay: Object.fromEntries([[DAY, 4]]),
  isOn: true,
};
const SECTION_FIELDS: Required<Section> = {
  id: 'alpha',
  contextId: 'TODAY',
  contextType: WorkContextType.TAG,
  title: 'changed',
  isExpanded: false,
  taskIds: ['task-x'],
};
const BOARD_FIELDS: Required<BoardCfg> = {
  id: 'a',
  title: 'changed',
  cols: 4,
  panels: [{ ...DEFAULT_PANEL_CFG, id: 'panel-new', title: 'new' }],
};
// The shared and plugin fields, plus every key of each built-in provider.
const PROVIDER_BASE_FIELDS: Required<IssueProviderPluginType> = {
  id: 'a',
  isEnabled: false,
  issueProviderKey: 'plugin:changed',
  defaultProjectId: OTHER_PROJECT,
  pinnedSearch: 'changed',
  migratedFromProjectId: OTHER_PROJECT,
  isAutoPoll: false,
  isAutoAddToBacklog: true,
  isIntegratedAddTaskBar: true,
  pollingMode: 'always',
  defaultTagIds: ['tag1'],
  defaultNote: 'changed',
  pluginId: 'changed-plugin',
  pluginConfig: { changed: true },
};
const PROVIDER_FIELDS: Record<string, unknown> = {
  ...Object.fromEntries(
    Object.values(DEFAULT_ISSUE_PROVIDER_CFGS).flatMap((cfg) =>
      Object.keys(cfg).map((key) => [key, `changed-${key}`]),
    ),
  ),
  ...PROVIDER_BASE_FIELDS,
};

interface Reorder {
  name: string;
  action: PersistentAction;
  isTagOrder?: boolean;
  /** The ordered list the reorder writes. */
  list: (s: State) => string[];
  /** The entities that belong to that list. */
  members: (s: State) => string[];
}
const sorted = (ids: (string | undefined)[]): string[] =>
  ids.filter((id): id is string => !!id).sort();
const reorders: Reorder[] = [
  {
    name: 'project notes',
    action: updateNoteOrder({
      ids: ['b', 'a', 'w'],
      activeContextType: WorkContextType.PROJECT,
      activeContextId: P,
    }),
    list: (s) => s.projects.entities[P]!.noteIds,
    members: (s) =>
      sorted(Object.values(s.note.entities).map((n) => (n?.projectId === P ? n.id : ''))),
  },
  ...['TODAY', 'tag1'].map(
    (tagId): Reorder => ({
      name: `${tagId} tag notes`,
      action: updateNoteOrder({
        ids: ['b', 'a', 't'],
        activeContextType: WorkContextType.TAG,
        activeContextId: tagId,
      }),
      isTagOrder: true,
      list: (s) => s.note.todayOrder,
      members: (s) => [
        ...sorted(s.note.todayOrder),
        ...sorted(
          Object.values(s.note.entities).map((n) => (n?.isPinnedToToday ? n.id : '')),
        ),
      ],
    }),
  ),
  {
    name: 'habits',
    action: updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] }),
    list: (s) => s.simpleCounter.ids,
    members: (s) => sorted(s.simpleCounter.ids),
  },
  {
    name: 'boards',
    action: BoardsActions.sortBoards({ ids: ['b', 'a', 'u'] }),
    list: (s) => s.boards.boardCfgs.map((board) => board.id),
    members: (s) => sorted(s.boards.boardCfgs.map((board) => board.id)),
  },
  {
    name: 'sections',
    action: updateSectionOrder({ contextId: P, ids: ['beta', 'alpha', 'untouched'] }),
    list: (s) => s.section.ids,
    // The context is the pair: the reorder selects its slots by contextId.
    members: (s) =>
      sorted(
        Object.values(s.section.entities).map((section) =>
          section?.contextId === P && section.contextType === WorkContextType.PROJECT
            ? section.id
            : '',
        ),
      ),
  },
  {
    name: 'issue providers',
    action: IssueProviderActions.sortIssueProvidersFirst({ ids: ['b', 'a', 'u'] }),
    list: (s) => s.issueProvider.ids,
    members: (s) => sorted(s.issueProvider.ids),
  },
];

interface Patch {
  action: PersistentAction;
  target: string;
  changes: Record<string, unknown>;
}
const patchesFor = (reorder: Reorder): Patch[] => {
  const each = (
    target: string,
    fields: object,
    build: (changes: Record<string, unknown>) => PersistentAction,
  ): Patch[] =>
    [
      ...Object.entries(fields).map(([field, value]) => ({ [field]: value })),
      { id: 'renamed' },
    ].map((changes) => ({ action: build(changes), target, changes }));
  const note = (target: string, changes: Partial<Note>): Patch => ({
    action: updateNote({ note: { id: target, changes } }),
    target,
    changes,
  });
  switch (reorder.action.meta.entityType) {
    case 'NOTE':
      return [
        ...each('a', NOTE_FIELDS, (changes) =>
          updateNote({ note: { id: 'a', changes: changes as Partial<Note> } }),
        ),
        // A redundant pin, a real pin, and an edit of a note the order does not list.
        note('a', { isPinnedToToday: true }),
        note('w', { isPinnedToToday: true }),
        note('w', { content: 'changed' }),
      ];
    case 'SIMPLE_COUNTER':
      return [
        ...each('a', COUNTER_FIELDS, (changes) =>
          updateSimpleCounter({
            simpleCounter: { id: 'a', changes: changes as Partial<SimpleCounterCopy> },
          }),
        ),
        {
          action: setSimpleCounterCounterToday({ id: 'a', newVal: 7, today: DAY }),
          target: 'a',
          changes: { countOnDay: DAY },
        },
        {
          action: setSimpleCounterCounterForDate({ id: 'a', newVal: 8, date: OTHER_DAY }),
          target: 'a',
          changes: { countOnDay: OTHER_DAY },
        },
      ];
    case 'SECTION':
      return each('alpha', SECTION_FIELDS, (changes) =>
        updateSection({ section: { id: 'alpha', changes: changes as Partial<Section> } }),
      );
    case 'BOARD':
      return each('a', BOARD_FIELDS, (updates) =>
        BoardsActions.updateBoard({ id: 'a', updates: updates as Partial<BoardCfg> }),
      );
    default:
      return each('a', PROVIDER_FIELDS, (changes) =>
        IssueProviderActions.updateIssueProvider({
          issueProvider: { id: 'a', changes: changes as Partial<IssueProvider> },
        }),
      );
  }
};

/**
 * The stops the rule must keep, spelled out here rather than read from the util:
 * identity changes; moves to another container of the list (`updateNote` leaves
 * `project.noteIds` stale, `updateSectionOrder` selects slots by context);
 * `section.taskIds`, the placement list its own actions own; and Today
 * membership against a tag order, which released clients overwrite with it.
 */
const expectedStop = (reorder: Reorder, patch: Patch): string | undefined => {
  const fields = Object.keys(patch.changes);
  const listed = (reorder.action as unknown as { ids: string[] }).ids;
  if (!listed.includes(patch.target)) return 'the order does not list it';
  if (fields.includes('id') && patch.changes['id'] !== patch.target) return 'identity';
  if (reorder.action.meta.entityType === 'NOTE') {
    if (fields.includes('projectId')) return 'container move';
    if (reorder.isTagOrder && fields.includes('isPinnedToToday'))
      return 'Today membership';
  }
  if (reorder.action.meta.entityType === 'SECTION') {
    if (fields.includes('contextId') || fields.includes('contextType'))
      return 'container move';
    if (fields.includes('taskIds')) return 'task placement';
  }
  return undefined;
};

let opSeq = 0;
const toOp = (action: PersistentAction): Operation => {
  const { type, meta, ...actionPayload } = action;
  return {
    id: `op-${++opSeq}`,
    actionType: type,
    opType: meta.opType,
    entityType: meta.entityType,
    entityId: meta.entityId ?? meta.entityIds![0],
    entityIds: meta.entityIds ?? (meta.entityId ? [meta.entityId] : undefined),
    payload: { actionPayload, entityChanges: [] },
    clientId: 'test',
    vectorClock: { test: 1 },
    timestamp: 1,
    schemaVersion: 1,
  } as Operation;
};

describe('reorder rule against the real reducers', () => {
  let base: State;
  beforeAll(() => {
    base = buildBase();
  });

  for (const reorder of reorders) {
    for (const patch of patchesFor(reorder)) {
      const stop = expectedStop(reorder, patch);
      const changes = Object.entries(patch.changes).map(
        ([field, value]) => `${field}=${typeof value === 'object' ? '{…}' : value}`,
      );
      it(
        `${reorder.name} × ${patch.action.type} ${patch.target} {${changes}}: ` +
          (stop ? `keeps the safety stop (${stop})` : 'commutes'),
        () => {
          const [order, edit] = [toOp(reorder.action), toOp(patch.action)];
          const admitted = areCommutingReorderAndContentOperations(order, edit);
          expect(areCommutingReorderAndContentOperations(edit, order)).toBe(admitted);
          expect(admitted).toBe(!stop);
          if (!admitted) return;
          const edited = reduce(base, patch.action);
          expect(reorder.list(edited)).toEqual(reorder.list(base));
          expect(reorder.members(edited)).toEqual(reorder.members(base));
          const both = reduce(edited, reorder.action);
          expect(reduce(reduce(base, reorder.action), patch.action)).toEqual(both);
          expect(reduce(edited, patch.action)).toEqual(edited);
          expect(reduce(both, patch.action)).toEqual(both);
        },
      );
    }
  }

  it('keeps the stop when one pending note writes Today membership twice', () => {
    const order = updateNoteOrder({
      ids: ['b', 'a', 'w'],
      activeContextType: WorkContextType.PROJECT,
      activeContextId: P,
    });
    const unpin = updateNote({ note: { id: 'a', changes: { isPinnedToToday: false } } });
    const pin = updateNote({ note: { id: 'a', changes: { isPinnedToToday: true } } });
    const lock = updateNote({ note: { id: 'a', changes: { isLock: true } } });
    // The reducers commute in every interleaving that keeps the note's own order.
    const expected = apply(base, [unpin, pin, order]);
    expect(apply(base, [order, unpin, pin])).toEqual(expected);
    expect(apply(base, [unpin, order, pin])).toEqual(expected);
    expect(expected.note.todayOrder).toEqual(['a', 'b', 't']);
    // Both would be reissued as pins, which released receivers prepend twice.
    const [orderOp, unpinOp, pinOp, lockOp] = [order, unpin, pin, lock].map(toOp);
    const pending = [unpinOp, pinOp, lockOp];
    expect(areCommutingReorderAndContentOperations(orderOp, unpinOp, [unpinOp])).toBe(
      true,
    );
    expect(areCommutingReorderAndContentOperations(orderOp, unpinOp, pending)).toBe(
      false,
    );
    expect(areCommutingReorderAndContentOperations(orderOp, pinOp, pending)).toBe(false);
    expect(areCommutingReorderAndContentOperations(orderOp, lockOp, pending)).toBe(true);
    expect(
      areCommutingReorderAndContentOperations(orderOp, lockOp, [unpinOp, lockOp]),
    ).toBe(true);
    // A pending order is unaffected by the remote note's membership writes.
    expect(areCommutingReorderAndContentOperations(unpinOp, orderOp, [orderOp])).toBe(
      true,
    );
  });

  it('refuses a patch whose declared entity type is not its action', () => {
    const order = toOp(updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] }));
    const content = toOp(updateNote({ note: { id: 'a', changes: { content: 'x' } } }));
    expect(
      areCommutingReorderAndContentOperations(order, {
        ...content,
        entityType: 'SIMPLE_COUNTER',
      }),
    ).toBe(false);
  });
});

describe('reissued reorder crossings (#10377)', () => {
  let base: State;
  beforeAll(() => {
    base = buildBase();
  });
  const noteOrder = (ids: string[], contextId: string): PersistentAction =>
    updateNoteOrder({
      ids,
      activeContextType: contextId === P ? WorkContextType.PROJECT : WorkContextType.TAG,
      activeContextId: contextId,
    });
  const deleteA = deleteNote({ id: 'a', projectId: P, isPinnedToToday: true });
  const lists = [
    {
      name: 'project notes',
      order: noteOrder(['b', 'a', 'w'], P),
      // The last one orders the other note list.
      competing: [noteOrder(['w', 'a', 'b'], P), noteOrder(['a', 'b', 't'], 'TODAY')],
      unrelated: [
        noteOrder(['x', 'y'], OTHER_PROJECT),
        updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] }),
        BoardsActions.sortBoards({ ids: ['a', 'b'] }),
      ],
      list: (s: State): string[] => s.projects.entities[P]!.noteIds,
    },
    {
      name: 'Today notes',
      order: noteOrder(['a', 'b', 't'], 'TODAY'),
      // Every tag view reorders note.todayOrder too.
      competing: [
        noteOrder(['b', 't', 'a'], 'TODAY'),
        noteOrder(['t', 'a', 'b'], 'tag1'),
        noteOrder(['b', 'a', 'w'], P),
      ],
      unrelated: [updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] })],
      list: (s: State): string[] => s.note.todayOrder,
    },
  ];
  for (const { name, order, competing, unrelated, list } of lists) {
    it(`${name}: admits other note orders and a listed delete, in both roles`, () => {
      const orderOp = toOp(order);
      for (const other of [...competing.map(toOp), toOp(deleteA)]) {
        expect(isReissuedReorderCrossing(orderOp, other)).toBeTrue();
        expect(isReissuedReorderCrossing(other, orderOp)).toBeTrue();
      }
      for (const other of unrelated.map(toOp)) {
        expect(isReissuedReorderCrossing(orderOp, other)).toBeFalse();
      }
      const unlisted = deleteNote({ id: 'x', projectId: P, isPinnedToToday: true });
      expect(isReissuedReorderCrossing(orderOp, toOp(unlisted))).toBeFalse();
    });

    it(`${name}: an order of the other note list commutes with it`, () => {
      const other = competing[competing.length - 1];
      const both = apply(base, [order, other]);
      expect(apply(base, [other, order])).toEqual(both);
      expect(list(both)).toEqual(list(apply(base, [order])));
    });

    it(`${name}: a delete and the order commute, dropping the deleted id`, () => {
      const deletedFirst = apply(base, [deleteA, order]);
      expect(list(deletedFirst)).not.toContain('a');
      expect(deletedFirst).toEqual(apply(base, [order, deleteA]));
    });
  }

  it('admits competing habit orders but not a habit delete', () => {
    const order = toOp(updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] }));
    const other = toOp(updateSimpleCounterOrder({ ids: ['u', 'b', 'a'] }));
    const del = toOp(deleteSimpleCounter({ id: 'a' }));
    expect(isReissuedReorderCrossing(order, other)).toBeTrue();
    // Different habit sets (a habit added, enabled or disabled on one device)
    // fill different slots on each side: they keep the stop.
    const withAdded = toOp(updateSimpleCounterOrder({ ids: ['new', 'b', 'a', 'u'] }));
    expect(isReissuedReorderCrossing(order, withAdded)).toBeFalse();
    expect(isReissuedReorderCrossing(withAdded, order)).toBeFalse();
    expect(isReissuedReorderCrossing(order, del)).toBeFalse();
    expect(isReissuedReorderCrossing(del, order)).toBeFalse();
    // The habit order fills the slots of the habits it lists; a delete of a
    // listed habit shifts them around an unlisted (disabled) one.
    const deleteHabit = deleteSimpleCounter({ id: 'a' });
    const reorder = updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] });
    expect(apply(base, [deleteHabit, reorder]).simpleCounter.ids).not.toEqual(
      apply(base, [reorder, deleteHabit]).simpleCounter.ids,
    );
  });

  it('refuses boards, sections, providers and bulk deletes', () => {
    const pairs: [PersistentAction, PersistentAction][] = [
      [
        BoardsActions.sortBoards({ ids: ['a', 'b'] }),
        BoardsActions.sortBoards({ ids: ['b', 'a'] }),
      ],
      [
        updateSectionOrder({ contextId: P, ids: ['alpha', 'beta'] }),
        updateSectionOrder({ contextId: P, ids: ['beta', 'alpha'] }),
      ],
      [
        IssueProviderActions.sortIssueProvidersFirst({ ids: ['a', 'b'] }),
        IssueProviderActions.sortIssueProvidersFirst({ ids: ['b', 'a'] }),
      ],
    ];
    for (const [first, second] of pairs) {
      expect(isReissuedReorderCrossing(toOp(first), toOp(second))).toBeFalse();
    }
    const order = toOp(noteOrder(['b', 'a', 'w'], P));
    const bulk = { ...toOp(deleteA), entityIds: ['a', 'b'] };
    expect(isReissuedReorderCrossing(order, bulk)).toBeFalse();
  });

  it('selects each pending order with the last concurrent crossing as proof', () => {
    const pending = { ...toOp(noteOrder(['b', 'a', 'w'], P)), vectorClock: { local: 1 } };
    const edit = {
      ...toOp(updateNote({ note: { id: 'a', changes: { content: 'x' } } })),
    };
    const first = { ...toOp(noteOrder(['w', 'a', 'b'], P)), vectorClock: { remote: 1 } };
    const second = { ...toOp(deleteA), vectorClock: { remote: 2 } };
    const seen = {
      ...toOp(noteOrder(['a', 'b', 'w'], P)),
      vectorClock: { local: 1, remote: 3 },
    };
    expect(selectCrossedPendingReorders([pending, edit], [first, second, edit])).toEqual([
      { opId: pending.id, op: pending, existingClock: second.vectorClock },
    ]);
    // A remote op that already saw the pending order does not cross it.
    expect(selectCrossedPendingReorders([pending], [seen])).toEqual([]);
  });
});

describe('a pending order beside a conflict on a listed entity (#10420)', () => {
  let base: State;
  beforeAll(() => {
    base = buildBase();
  });
  const habitOrder = updateSimpleCounterOrder({ ids: ['b', 'a', 'u'] });
  const lwwRow = (
    entityType: 'SIMPLE_COUNTER' | 'NOTE',
    id: string,
    mode: 'replace' | 'patch',
    fields: Record<string, unknown>,
  ): PersistentAction =>
    ({
      type: `[${entityType}] LWW Update`,
      id,
      ...fields,
      meta: {
        isPersistent: true,
        entityType,
        entityId: id,
        opType: OpType.Update,
        isRemote: true,
        lwwUpdateMode: mode,
      },
    }) as unknown as PersistentAction;
  // The action's own `type` shadows a habit's: no row carries one
  // (lww-snapshot-patch-mode.util.ts).
  const replaced: Partial<SimpleCounterCopy> = {
    ...EMPTY_SIMPLE_COUNTER,
    ...COUNTER_FIELDS,
  };
  delete replaced.type;
  const habitRows = [
    lwwRow('SIMPLE_COUNTER', 'a', 'replace', replaced),
    lwwRow('SIMPLE_COUNTER', 'a', 'patch', { title: 'changed', isEnabled: false }),
  ];

  describe('with a fixed clock', () => {
    // A row stamps `modified` with the apply time.
    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 8, 20));
    });
    afterEach(() => jasmine.clock().uninstall());
    for (const row of habitRows) {
      it(`a habit LWW row (${(row.meta as { lwwUpdateMode: string }).lwwUpdateMode}) commutes with a habit order listing it`, () => {
        const [order, edit] = [toOp(habitOrder), toOp(row)];
        expect(areCommutingReorderAndContentOperations(order, edit)).toBeTrue();
        expect(areCommutingReorderAndContentOperations(edit, order)).toBeTrue();
        // The row writes the habit only: the order and its slots stay.
        const edited = reduce(base, row);
        expect(edited.simpleCounter.ids).toEqual(base.simpleCounter.ids);
        const both = reduce(edited, habitOrder);
        expect(reduce(reduce(base, habitOrder), row)).toEqual(both);
        expect(reduce(both, row)).toEqual(both);
      });
    }
  });

  it('keeps the stop for a row of an unlisted habit, a note row and other lists', () => {
    const order = toOp(habitOrder);
    const unlisted = toOp(lwwRow('SIMPLE_COUNTER', 'disabled', 'patch', { title: 'x' }));
    expect(areCommutingReorderAndContentOperations(order, unlisted)).toBeFalse();
    // A note row carries the routed `projectId` and `isPinnedToToday`.
    const noteOrder = toOp(
      updateNoteOrder({
        ids: ['b', 'a', 'w'],
        activeContextType: WorkContextType.PROJECT,
        activeContextId: P,
      }),
    );
    const noteRow = toOp(lwwRow('NOTE', 'a', 'patch', { content: 'x' }));
    expect(areCommutingReorderAndContentOperations(noteOrder, noteRow)).toBeFalse();
    // Only note and habit orders are reissued after a crossing.
    const boardOrder = toOp(BoardsActions.sortBoards({ ids: ['b', 'a', 'u'] }));
    const boardRow = {
      ...toOp(lwwRow('SIMPLE_COUNTER', 'a', 'patch', { title: 'x' })),
      actionType: '[BOARD] LWW Update',
      entityType: 'BOARD',
    } as unknown as Operation;
    expect(areCommutingReorderAndContentOperations(boardOrder, boardRow)).toBeFalse();
    // A row whose action names another entity type than it declares.
    const mismatched = { ...toOp(habitRows[1]), actionType: '[NOTE] LWW Update' };
    expect(
      areCommutingReorderAndContentOperations(order, mismatched as Operation),
    ).toBeFalse();
  });

  it('leaves a commuting pending order out of the conflict, never a stopping one', () => {
    const order = toOp(habitOrder);
    const count = toOp(setSimpleCounterCounterToday({ id: 'a', newVal: 3, today: DAY }));
    const remoteRename = toOp(
      updateSimpleCounter({ simpleCounter: { id: 'a', changes: { title: 'r' } } }),
    );
    const remoteDelete = toOp(deleteSimpleCounter({ id: 'a' }));
    // The count and the rename both write the habit; the order commutes.
    expect(nonCommutingPendingOps(remoteRename, [order, count])).toEqual([count]);
    expect(nonCommutingPendingOps(remoteRename, [order])).toEqual([]);
    expect(nonCommutingPendingOps(toOp(habitRows[0]), [order, count])).toEqual([count]);
    // A habit delete does not commute with the order: it stays in, and stops.
    expect(nonCommutingPendingOps(remoteDelete, [order, count])).toEqual([order, count]);
    // A pending local delete keeps the order in too: a remote win recreates
    // the habit at the end of the list on this device only.
    const localDelete = toOp(deleteSimpleCounter({ id: 'a' }));
    expect(nonCommutingPendingOps(remoteRename, [order, localDelete])).toEqual([
      order,
      localDelete,
    ]);
    expect(nonCommutingPendingOps(toOp(habitRows[1]), [order, localDelete])).toEqual([
      order,
      localDelete,
    ]);
  });

  it('keeps a section order in a conflict on a section it lists', () => {
    const order = toOp(updateSectionOrder({ contextId: P, ids: ['beta', 'alpha'] }));
    const rename = (title: string): Operation =>
      toOp(updateSection({ section: { id: 'alpha', changes: { title } } }));
    const local = rename('local');
    // It commutes with the rename, but only note and habit orders stay out.
    expect(areCommutingReorderAndContentOperations(rename('remote'), order)).toBeTrue();
    expect(nonCommutingPendingOps(rename('remote'), [order, local])).toEqual([
      order,
      local,
    ]);
    const kept = keptCommutingReorders(
      [
        {
          entityType: 'SECTION',
          entityId: 'alpha',
          localOps: [local],
          remoteOps: [rename('remote')],
          suggestedResolution: 'remote',
        },
      ],
      new Map([['SECTION:alpha', [order, local]]]),
    );
    expect(kept.opIds.size).toBe(0);
  });

  it('keeps the left-out orders and the clock of the conflicts they cross', () => {
    const order = { ...toOp(habitOrder), vectorClock: { local: 2 } };
    const otherOrder = toOp(updateSimpleCounterOrder({ ids: ['u', 'b'] }));
    const count = toOp(setSimpleCounterCounterToday({ id: 'a', newVal: 3, today: DAY }));
    const conflict = (
      entityId: string,
      localOps: Operation[],
      remote: Record<string, number>,
    ): EntityConflict => ({
      entityType: 'SIMPLE_COUNTER',
      entityId,
      localOps,
      remoteOps: [{ ...count, id: `remote-${entityId}`, vectorClock: remote }],
      suggestedResolution: 'remote',
    });
    const pendingByEntity = new Map([
      ['SIMPLE_COUNTER:a', [order, count]],
      ['SIMPLE_COUNTER:b', [order, otherOrder]],
      ['SIMPLE_COUNTER:u', [order, otherOrder]],
    ]);
    const kept = keptCommutingReorders(
      [conflict('a', [count], { r1: 1 }), conflict('b', [otherOrder], { r2: 1 })],
      pendingByEntity,
    );
    // `otherOrder` is in a conflict (and would stop there); `order` crossed both.
    expect([...kept.opIds]).toEqual([order.id]);
    expect(kept.clockToDominate).toEqual({ r1: 1, r2: 1 });
    expect(kept.reissuedCrossings.size).toBe(0);
    expect(keptCommutingReorders([], pendingByEntity).opIds.size).toBe(0);
  });

  it('leaves an order beside an applied note delete to the reissue, never moves it', async () => {
    const order = toOp(
      updateNoteOrder({
        ids: ['b', 'a', 'w'],
        activeContextType: WorkContextType.PROJECT,
        activeContextId: P,
      }),
    );
    const edit = toOp(updateNote({ note: { id: 'a', changes: { content: 'x' } } }));
    const remoteDelete = {
      ...toOp(deleteNote({ id: 'a', projectId: P, isPinnedToToday: true })),
      id: 'remote-delete',
    };
    // The order commutes with the delete, the content edit does not.
    expect(nonCommutingPendingOps(remoteDelete, [order, edit])).toEqual([edit]);
    const kept = keptCommutingReorders(
      [
        {
          entityType: 'NOTE',
          entityId: 'a',
          localOps: [edit],
          remoteOps: [remoteDelete],
          suggestedResolution: 'remote',
        },
      ],
      new Map([
        ['NOTE:a', [order, edit]],
        ['NOTE:b', [order]],
      ]),
    );
    expect([...kept.opIds]).toEqual([order.id]);
    expect(kept.reissuedCrossings.get(order.id)).toEqual([remoteDelete]);
    const store = {
      getUnsynced: jasmine.createSpy().and.resolveTo([
        { seq: 1, source: 'local', op: order },
        { seq: 2, source: 'local', op: edit },
      ]),
      rebasePendingLocalOps: jasmine.createSpy().and.resolveTo([]),
    };
    // The delete won and applies: moved past it, the order would upload the
    // deleted id instead of being reissued from current state.
    await rebaseKeptReorders(store, kept, new Set());
    expect(store.rebasePendingLocalOps).not.toHaveBeenCalled();
    // The edit won and the delete is rejected: nothing reissues the order.
    await rebaseKeptReorders(store, kept, new Set([remoteDelete.id]));
    expect(store.rebasePendingLocalOps).toHaveBeenCalledOnceWith(
      [order.id, edit.id],
      kept.clockToDominate,
    );
  });

  it('leaves an order to the reissue when its conflict dominates a delete applied beside it', async () => {
    const order = {
      ...toOp(
        updateNoteOrder({
          ids: ['b', 'a', 'w'],
          activeContextType: WorkContextType.PROJECT,
          activeContextId: P,
        }),
      ),
      vectorClock: { local: 2 },
    };
    const edit = {
      ...toOp(updateNote({ note: { id: 'a', changes: { content: 'x' } } })),
      vectorClock: { local: 3 },
    };
    // The other device deleted `w`, then edited `a`: the edit's clock dominates
    // the delete, which applies outside the conflict.
    const remoteDelete = {
      ...toOp(deleteNote({ id: 'w', projectId: P, isPinnedToToday: false })),
      id: 'remote-delete',
      vectorClock: { other: 1 },
    };
    const remoteEdit = {
      ...toOp(updateNote({ note: { id: 'a', changes: { content: 'y' } } })),
      id: 'remote-edit',
      vectorClock: { other: 2 },
    };
    const kept = keptCommutingReorders(
      [
        {
          entityType: 'NOTE',
          entityId: 'a',
          localOps: [edit],
          remoteOps: [remoteEdit],
          suggestedResolution: 'remote',
        },
      ],
      new Map([
        ['NOTE:a', [order, edit]],
        ['NOTE:b', [order]],
        ['NOTE:w', [order]],
      ]),
      [remoteDelete],
    );
    expect([...kept.opIds]).toEqual([order.id]);
    expect(kept.reissuedCrossings.get(order.id)).toEqual([remoteDelete]);
    const store = {
      getUnsynced: jasmine.createSpy().and.resolveTo([
        { seq: 1, source: 'local', op: order },
        { seq: 2, source: 'local', op: edit },
      ]),
      rebasePendingLocalOps: jasmine.createSpy().and.resolveTo([]),
    };
    // Moved past the edit, the order would dominate the delete, skip the
    // reissue and upload the deleted id.
    await rebaseKeptReorders(store, kept, new Set([remoteEdit.id]));
    expect(store.rebasePendingLocalOps).not.toHaveBeenCalled();
  });

  it('moves the kept orders with every later pending op of this client on a listed entity', async () => {
    const op = (id: string): Operation => ({ ...toOp(habitOrder), id });
    const entries = [
      { seq: 1, source: 'local', op: op('earlier') },
      { seq: 2, source: 'local', op: op('kept') },
      { seq: 3, source: 'remote', op: op('remote') },
      { seq: 4, source: 'local', op: op('later') },
      {
        seq: 5,
        source: 'local',
        op: { ...op('unlisted'), entityType: 'TASK', entityId: 'a', entityIds: ['a'] },
      },
    ];
    const store = {
      getUnsynced: jasmine.createSpy().and.resolveTo(entries),
      rebasePendingLocalOps: jasmine.createSpy().and.resolveTo([]),
    };
    const clockToDominate = { r: 1 };
    const kept = (...ids: string[]): KeptReorders => ({
      opIds: new Set(ids),
      clockToDominate,
      reissuedCrossings: new Map(),
    });
    await rebaseKeptReorders(store, kept('kept'), new Set());
    expect(store.rebasePendingLocalOps).toHaveBeenCalledOnceWith(
      ['kept', 'later'],
      clockToDominate,
    );
    store.getUnsynced.calls.reset();
    await rebaseKeptReorders(store, kept(), new Set());
    expect(store.getUnsynced).not.toHaveBeenCalled();
    // A kept order that is no longer pending moves nothing.
    store.rebasePendingLocalOps.calls.reset();
    await rebaseKeptReorders(store, kept('gone'), new Set());
    expect(store.rebasePendingLocalOps).not.toHaveBeenCalled();
  });
});
