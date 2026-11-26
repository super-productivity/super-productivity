import { Action, ActionReducer } from '@ngrx/store';
import { Project, ProjectState } from '../../features/project/project.model';
import { SectionState } from '../../features/section/section.model';
import {
  addSection,
  addTaskToSection,
  removeTaskFromSection,
} from '../../features/section/store/section.actions';
import {
  initialSectionState,
  sectionReducer,
} from '../../features/section/store/section.reducer';
import { TagState } from '../../features/tag/tag.model';
import { TaskState } from '../../features/tasks/task.model';
import { RootState } from '../../root-store/root-state';
import { sectionSharedMetaReducer } from '../../root-store/meta/task-shared-meta-reducers/section-shared.reducer';
import { WorkContextType } from '../../features/work-context/work-context.model';
import { extractActionPayload, Operation } from '../core/operation.types';
import { PersistentAction } from '../core/persistent-action.interface';
import {
  areCommutingSectionOperations,
  projectSectionReplayAgainstState,
  SectionReplayStateCompensation,
} from './section-conflict-commutativity.util';

const P = 'project-1';

const toOp = (action: PersistentAction): Operation => {
  const { type, meta, ...actionPayload } = action;
  return {
    id: `op-${type}`,
    actionType: type,
    opType: meta.opType,
    entityType: meta.entityType,
    entityId: meta.entityId ?? meta.entityIds![0],
    entityIds: meta.entityIds,
    payload: { actionPayload, entityChanges: [] },
    clientId: 'test',
    vectorClock: { test: 1 },
    timestamp: 1,
    schemaVersion: 1,
  } as Operation;
};

const toAction = (op: Operation): Action =>
  ({
    type: op.actionType,
    ...(extractActionPayload(op.payload) as Record<string, unknown>),
  }) as Action;

const COMPENSATE = '[test] project snapshot';

// Keyed by the real feature names: the meta-reducer skips unhydrated slices.
interface Snapshot {
  tasks: TaskState;
  tag: TagState;
  projects: ProjectState;
  section: SectionState;
}

// The real section meta-reducer, so a removal also moves the task in the work
// context's `taskIds`.
const reduce = sectionSharedMetaReducer(((state: Snapshot, action: Action) => ({
  ...state,
  section: sectionReducer(state.section, action),
})) as unknown as ActionReducer<RootState, Action>);

const apply = (state: Snapshot, actions: Action[]): Snapshot =>
  actions.reduce(
    (next, action) =>
      action.type === COMPENSATE
        ? {
            ...next,
            projects: {
              ...next.projects,
              entities: { [P]: (action as unknown as { project: Project }).project },
            },
          }
        : (reduce(next as unknown as RootState, action) as unknown as Snapshot),
    state,
  );

const sections = apply(
  { section: initialSectionState } as Snapshot,
  [
    ['s1', ['mover', 'stay']],
    ['s2', ['other', 'last']],
    ['s3', ['extra']],
  ].map(([id, taskIds]) =>
    addSection({
      section: {
        id: id as string,
        title: id as string,
        contextId: P,
        contextType: WorkContextType.PROJECT,
        taskIds: taskIds as string[],
      },
    }),
  ),
).section;

const base: Snapshot = {
  tasks: { ids: [], entities: {} } as unknown as TaskState,
  tag: { ids: [], entities: {} } as unknown as TagState,
  projects: {
    ids: [P],
    entities: {
      [P]: {
        id: P,
        taskIds: ['mover', 'stay', 'other', 'last', 'extra', 'loose'],
      } as Project,
    },
  } as unknown as ProjectState,
  section: sections,
};

const lists = (state: Snapshot): Record<string, string[]> => ({
  ...Object.fromEntries(
    (state.section.ids as string[]).map((id) => [
      id,
      state.section.entities[id]!.taskIds,
    ]),
  ),
  project: state.projects.entities[P]!.taskIds,
});

/** Writes the full Project snapshot a reissued removal carries for old clients. */
const compensate = (
  compensation: SectionReplayStateCompensation | undefined,
): Action[] =>
  compensation
    ? [{ type: COMPENSATE, project: compensation.entityState as Project } as Action]
    : [];

/**
 * The rejected op, reissued from the state it was rejected in. Without the
 * snapshot (it can lose LWW on the receiver), the replayed op must converge
 * on its own.
 */
const reissue = (op: Operation, state: Snapshot, withSnapshot: boolean): Action[] => {
  const snapshot = (
    compensation: SectionReplayStateCompensation | undefined,
  ): Action[] => (withSnapshot ? compensate(compensation) : []);
  const projection = projectSectionReplayAgainstState(op, {
    section: state.section,
    project: state.projects,
    tag: state.tag,
  });
  if (projection.kind === 'superseded') return [];
  if (projection.kind === 'work-context-state') return snapshot(projection);
  if (projection.kind !== 'replay') throw new Error(projection.kind);
  return [toAction(projection.operation), ...snapshot(projection.stateCompensation)];
};

const MOVE = addTaskToSection({
  sectionId: 's2',
  taskId: 'mover',
  afterTaskId: null,
  sourceSectionId: 's1',
}) as PersistentAction;

const removal = (
  taskId: string,
  sectionId: string,
  workContextAfterTaskId: string | null = null,
): PersistentAction =>
  removeTaskFromSection({
    sectionId,
    taskId,
    workContextId: P,
    workContextType: WorkContextType.PROJECT,
    workContextAfterTaskId,
  }) as PersistentAction;

const placement = (
  taskId: string,
  sectionId: string,
  sourceSectionId: string | null,
  afterTaskId: string | null,
): PersistentAction =>
  addTaskToSection({
    sectionId,
    taskId,
    afterTaskId,
    sourceSectionId,
  }) as PersistentAction;

describe('section list writes of different tasks (#10969)', () => {
  const DIFFERENT_TASKS: {
    name: string;
    first?: PersistentAction;
    action: PersistentAction;
  }[] = [
    { name: 'another task moved S3 → S1', action: placement('extra', 's1', 's3', null) },
    {
      name: 'another task moved to the top of S2',
      action: placement('extra', 's2', 's3', null),
    },
    {
      name: 'another task reordered within S2',
      action: placement('other', 's2', 's2', 'last'),
    },
    {
      name: 'another task reordered within S1',
      action: placement('stay', 's1', 's1', null),
    },
    {
      name: 'another task placed from no section',
      action: placement('new', 's2', null, null),
    },
    { name: 'another task removed from S1', action: removal('stay', 's1') },
    { name: 'another task removed from S2', action: removal('other', 's2') },
    // Both removals put their task at the top of the project's order.
    {
      name: 'a removal from S1, as the other op another removal from S1',
      first: removal('mover', 's1'),
      action: removal('stay', 's1'),
    },
    // A removal anchors in the project's order, which a placement leaves alone.
    {
      name: 'another task removed to after the moved task',
      action: removal('stay', 's1', 'mover'),
    },
    {
      name: 'a removal to after a task placed from no section',
      first: placement('loose', 's1', null, null),
      action: removal('stay', 's1', 'loose'),
    },
  ];

  DIFFERENT_TASKS.forEach(({ name, first = MOVE, action }) => {
    const [move, edit] = [toOp(first), toOp(action)];

    it(`commutes with ${name}`, () => {
      expect(areCommutingSectionOperations(move, edit)).toBe(true);
      expect(areCommutingSectionOperations(edit, move)).toBe(true);
    });

    [true, false].forEach((withSnapshot) => {
      const variant = withSnapshot ? '' : ', without the snapshot';

      it(`converges with ${name} when the editor syncs first${variant}`, () => {
        // The mover applies the accepted edit, then reissues its rejected move.
        const mover = apply(base, [first, action]);
        const editor = apply(base, [action, ...reissue(move, mover, withSnapshot)]);
        expect(lists(editor)).toEqual(lists(mover));
      });

      it(`converges with ${name} when the mover syncs first${variant}`, () => {
        const editor = apply(base, [action, first]);
        const mover = apply(base, [first, ...reissue(edit, editor, withSnapshot)]);
        expect(lists(mover)).toEqual(lists(editor));
      });
    });
  });

  const STOPS: { name: string; move: PersistentAction; action: PersistentAction }[] = [
    {
      name: 'the same task moved S1 → S3',
      move: MOVE,
      action: placement('mover', 's3', 's1', null),
    },
    {
      name: 'the same task reordered within S1',
      move: MOVE,
      action: placement('mover', 's1', 's1', 'stay'),
    },
    { name: 'the same task removed from S2', move: MOVE, action: removal('mover', 's2') },
    // The reissue repositions only the rejected op's task; the anchored task
    // would land elsewhere on each device.
    {
      name: 'another task placed after the moved task',
      move: MOVE,
      action: placement('extra', 's1', 's3', 'mover'),
    },
    {
      name: 'another task placed after a task removed concurrently',
      move: removal('stay', 's1'),
      action: placement('extra', 's1', 's3', 'stay'),
    },
    {
      name: 'a removal to after a task removed concurrently',
      move: removal('mover', 's1'),
      action: removal('stay', 's1', 'mover'),
    },
    {
      name: 'a reorder of the task the move is placed after',
      move: placement('mover', 's2', 's1', 'other'),
      action: placement('other', 's2', 's2', 'last'),
    },
  ];

  STOPS.forEach(({ name, move, action }) => {
    it(`keeps the stop against ${name}`, () => {
      expect(areCommutingSectionOperations(toOp(move), toOp(action))).toBe(false);
      expect(areCommutingSectionOperations(toOp(action), toOp(move))).toBe(false);
    });
  });
});
