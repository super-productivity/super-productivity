import { WorkContextType } from '../../features/work-context/work-context.model';
import { NoteState } from '../../features/note/note.model';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';
import { BoardsState } from '../../features/boards/store/boards.reducer';
import { IssueProviderState } from '../../features/issue/issue.model';
import {
  ActionType,
  EntityConflict,
  EntityType,
  extractActionPayload,
  isMultiEntityPayload,
  Operation,
  OpType,
  VectorClock,
} from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import {
  compareVectorClocks,
  mergeVectorClocks,
  VectorClockComparison,
} from '../../core/util/vector-clock';
import { getLwwEntityType, isLwwUpdateActionType } from '../core/lww-update-action-types';
import { areCommutingSectionOperations } from './section-conflict-commutativity.util';
import {
  SectionReplayProjection,
  SectionReplaySnapshot,
  projectSectionReplayAgainstState,
} from './section-conflict-commutativity.util';

export interface ReorderReplaySnapshot extends SectionReplaySnapshot {
  note: NoteState;
  simpleCounter: SimpleCounterState;
  boards: BoardsState;
  issueProvider: IssueProviderState;
}

type Payload = Record<string, unknown>;

/**
 * Each reorder writes exactly one ordered list per context: `project.noteIds`
 * (project notes) or `note.todayOrder` (every tag view), `simpleCounter.ids`,
 * `boardCfgs`, the context's slots of `section.ids`, `issueProvider.ids`.
 */
const REORDERS = new Map<ActionType, EntityType>([
  [ActionType.NOTE_UPDATE_ORDER, 'NOTE'],
  [ActionType.COUNTER_UPDATE_ORDER, 'SIMPLE_COUNTER'],
  [ActionType.BOARDS_SORT, 'BOARD'],
  [ActionType.SECTION_UPDATE_ORDER, 'SECTION'],
  [ActionType.ISSUE_PROVIDER_SORT_FIRST, 'ISSUE_PROVIDER'],
]);

/**
 * Entity fields a reducer routes into an ordered list or its membership. Every
 * other field of a recognized patch is written on that entity only, so it
 * commutes with every reorder. `id` is identity: only an unchanged id commutes.
 * reorder-conflict.util.spec.ts runs every model field through the real
 * reducers and fails until a new list-writing field is classified here.
 * - `container`: moves the entity to another list (`updateNote` leaves
 *   `project.noteIds` stale; `updateSectionOrder` selects slots by `contextId`).
 * - `placement`: `section.taskIds`, owned by the section placement actions.
 * - `todayOrder`: `updateNote` adds or removes the note in `note.todayOrder`.
 *   Only a project reorder writes another list: a tag reorder of released
 *   clients overwrites `todayOrder` with its stale membership.
 */
const LIST_ROUTED_FIELDS: Partial<
  Record<EntityType, Record<string, 'container' | 'placement' | 'todayOrder'>>
> = {
  NOTE: { projectId: 'container', isPinnedToToday: 'todayOrder' },
  SECTION: { contextId: 'container', contextType: 'container', taskIds: 'placement' },
};

interface PatchShape {
  entityType: EntityType;
  /** The target id and the fields its reducer writes; undefined when malformed. */
  read: (p: Payload) => { id: unknown; changes: Payload } | undefined;
  /** The same action carrying the current values of those fields. */
  write: (p: Payload, entity: Payload) => Payload;
}
const isRecord = (value: unknown): value is Payload =>
  !!value && typeof value === 'object' && !Array.isArray(value);
const pick = (entity: Payload, fields: Payload): Payload =>
  Object.fromEntries(Object.keys(fields).map((field) => [field, entity[field]]));
const entityUpdate = (entityType: EntityType, key: string): PatchShape => ({
  entityType,
  read: (p) => {
    const update = p[key];
    return isRecord(update) && isRecord(update['changes'])
      ? { id: update['id'], changes: update['changes'] }
      : undefined;
  },
  write: (p, entity) => ({
    ...p,
    [key]: {
      id: entity['id'],
      changes: pick(entity, (p[key] as Payload)['changes'] as Payload),
    },
  }),
});
const dayCount = (day: 'today' | 'date'): PatchShape => ({
  entityType: 'SIMPLE_COUNTER',
  read: (p) =>
    typeof p[day] === 'string' && typeof p['newVal'] === 'number'
      ? { id: p['id'], changes: { countOnDay: p['newVal'] } }
      : undefined,
  write: (p, entity) => ({
    ...p,
    newVal:
      (entity['countOnDay'] as Record<string, number> | undefined)?.[p[day] as string] ??
      0,
  }),
});

/**
 * Absolute single-entity patches: a replacement with current values is a local
 * no-op. Deltas, moves, deletes and every unlisted action never commute here.
 * Without causal proof a rejected patch keeps the entity LWW fallback; for a pin
 * that snapshot omits receivers' `todayOrder` write (section-conflict-replay.md).
 */
const PATCHES: Partial<Record<ActionType, PatchShape>> = {
  [ActionType.NOTE_UPDATE]: entityUpdate('NOTE', 'note'),
  [ActionType.SECTION_UPDATE]: entityUpdate('SECTION', 'section'),
  [ActionType.COUNTER_UPDATE]: entityUpdate('SIMPLE_COUNTER', 'simpleCounter'),
  [ActionType.ISSUE_PROVIDER_UPDATE]: entityUpdate('ISSUE_PROVIDER', 'issueProvider'),
  [ActionType.BOARDS_UPDATE]: {
    entityType: 'BOARD',
    read: (p) =>
      isRecord(p['updates']) ? { id: p['id'], changes: p['updates'] } : undefined,
    write: (p, entity) => ({ ...p, updates: pick(entity, p['updates'] as Payload) }),
  },
  [ActionType.COUNTER_SET_TODAY]: dayCount('today'),
  [ActionType.COUNTER_SET_FOR_DATE]: dayCount('date'),
};

const payloadOf = (op: Operation): Payload =>
  (extractActionPayload(op.payload) ?? {}) as Payload;

/** Match the UI's actual list write, including its declared conflict footprint. */
export const isContentReorderOperation = (op: Operation): boolean => {
  if (REORDERS.get(op.actionType) !== op.entityType || op.opType !== OpType.Move)
    return false;
  const payload = payloadOf(op);
  const ids = payload['ids'];
  if (!Array.isArray(ids) || !ids.length || !ids.every((id) => typeof id === 'string'))
    return false;
  const declared = getOpEntityIds(op);
  if (
    new Set(ids).size !== ids.length ||
    op.entityId !== ids[0] ||
    declared.length !== ids.length ||
    !declared.every((id) => ids.includes(id))
  )
    return false;
  if (op.actionType === ActionType.NOTE_UPDATE_ORDER) {
    return (
      (payload['activeContextType'] === WorkContextType.PROJECT ||
        payload['activeContextType'] === WorkContextType.TAG) &&
      typeof payload['activeContextId'] === 'string'
    );
  }
  return (
    op.actionType !== ActionType.SECTION_UPDATE_ORDER ||
    typeof payload['contextId'] === 'string'
  );
};

const readPatch = (op: Operation): { id: string; changes: Payload } | undefined => {
  const shape = PATCHES[op.actionType];
  const patch = shape?.read(payloadOf(op));
  const id = op.entityId;
  if (
    !shape ||
    !patch ||
    !id ||
    shape.entityType !== op.entityType ||
    op.opType !== OpType.Update ||
    patch.id !== id ||
    getOpEntityIds(op).length !== 1 ||
    !Object.keys(patch.changes).length
  )
    return undefined;
  return { id, changes: patch.changes };
};

/** A recognized patch that also writes `note.todayOrder`. */
const writesTodayOrder = (op: Operation): boolean =>
  Object.keys(readPatch(op)?.changes ?? {}).some(
    (field) => LIST_ROUTED_FIELDS[op.entityType]?.[field] === 'todayOrder',
  );

/**
 * An LWW resolution row writes its own entity only (lww-update.meta-reducer).
 * Of a type that routes no field into a list, it commutes with a note or habit
 * order listing that entity whatever it carries, so neither its mode nor its
 * keys are read (#10420; decision 5).
 */
const isUnroutedLwwRow = (order: Operation, edit: Operation): boolean =>
  isLwwUpdateActionType(edit.actionType) &&
  getLwwEntityType(edit.actionType) === edit.entityType &&
  edit.opType === OpType.Update &&
  !LIST_ROUTED_FIELDS[edit.entityType] &&
  !!reissuedListOf(order) &&
  getOpEntityIds(edit).length === 1;

/**
 * The one rule: a reorder commutes with a single-entity patch of one of the
 * entities it lists when the patch keeps the entity's identity and writes
 * neither the reordered list nor its membership.
 */
const isReorderAndEdit = (order: Operation, edit: Operation): boolean => {
  if (
    order.entityType !== edit.entityType ||
    !isContentReorderOperation(order) ||
    !getOpEntityIds(order).includes(edit.entityId!)
  )
    return false;
  if (isUnroutedLwwRow(order, edit)) return true;
  const patch = readPatch(edit);
  if (!patch) return false;
  const isTagOrder = payloadOf(order)['activeContextType'] === WorkContextType.TAG;
  return Object.keys(patch.changes).every((field) => {
    if (field === 'id') return patch.changes['id'] === patch.id;
    const route = LIST_ROUTED_FIELDS[edit.entityType]?.[field];
    return !route || (route === 'todayOrder' && !isTagOrder);
  });
};

// Admission still requires an exact commuting retained remote row (except
// absolute habit counts, reissued without proof); this only selects
// candidates for that existing fail-closed causal proof.
export const isReorderConflictOperation = (op: Operation): boolean =>
  isContentReorderOperation(op) || !!PATCHES[op.actionType];

/**
 * Whether a reorder and a single-entity patch commute. `pending` holds the
 * pending local ops of `b`'s entity when `b` is one of them. Each rejected op
 * is reissued with the final value, so a note whose Today membership is written
 * twice would be pinned twice on released receivers, which prepend without
 * dedup: that crossing keeps the safety stop.
 */
export const areCommutingReorderAndContentOperations = (
  a: Operation,
  b: Operation,
  pending: Operation[] = [],
): boolean =>
  (isReorderAndEdit(a, b) || isReorderAndEdit(b, a)) &&
  !(writesTodayOrder(b) && pending.some((op) => op !== b && writesTodayOrder(op)));

/**
 * #10377: crossings of a reorder that converge once the remote op applies and
 * the pending reorder is reissued from current state
 * (`projectReorderConflictAgainstState`) with a clock that dominates both:
 * - a competing reorder of the same list: the list as it stands after the
 *   remote order (either device's order may win, #10264). Two habit orders
 *   must list the same habits;
 * - a note order of the other list (a project's `noteIds` against
 *   `note.todayOrder`): each writes only its own list, so they commute; and
 * - the delete of a note the reorder lists: the delete wins and the reissued
 *   list keeps the reorder's positions of the other notes. Both note lists
 *   keep only ids already in the list, so a delete commutes with a note order.
 * Every Today and tag view writes `note.todayOrder`, so their orders compete.
 * A habit order fills the slots of the habits it lists, so a habit delete
 * shifts them around an unlisted (disabled) habit: it keeps the stop.
 */
const REISSUED_REORDER_DELETES = new Map<ActionType, ActionType | undefined>([
  [ActionType.NOTE_UPDATE_ORDER, ActionType.NOTE_DELETE],
  [ActionType.COUNTER_UPDATE_ORDER, undefined],
]);

const reissuedListOf = (op: Operation): string | undefined => {
  if (!REISSUED_REORDER_DELETES.has(op.actionType) || !isContentReorderOperation(op))
    return undefined;
  const p = payloadOf(op);
  return op.actionType !== ActionType.NOTE_UPDATE_ORDER
    ? op.actionType
    : p['activeContextType'] === WorkContextType.PROJECT
      ? JSON.stringify([op.actionType, p['activeContextId']])
      : JSON.stringify([op.actionType, 'todayOrder']);
};

/** A note or habit order that a crossing can reissue. */
export const isReissuableReorder = (op: Operation): boolean => !!reissuedListOf(op);

const isListedDelete = (order: Operation, op: Operation): boolean =>
  REISSUED_REORDER_DELETES.get(order.actionType) === op.actionType &&
  op.opType === OpType.Delete &&
  op.entityType === order.entityType &&
  !!op.entityId &&
  getOpEntityIds(op).length === 1 &&
  getOpEntityIds(order).includes(op.entityId);

/** Whether `a` and `b` cross as two note or habit orders, or an order and a delete. */
export const isReissuedReorderCrossing = (a: Operation, b: Operation): boolean => {
  const listA = reissuedListOf(a);
  const listB = reissuedListOf(b);
  if (listA && listB) {
    const idsA = getOpEntityIds(a);
    const idsB = getOpEntityIds(b);
    // A habit order fills the slots of its own habits: two orders over
    // different habit sets place them differently on each side.
    return a.actionType === ActionType.COUNTER_UPDATE_ORDER
      ? b.actionType === a.actionType &&
          idsA.length === idsB.length &&
          idsA.every((id) => idsB.includes(id))
      : a.actionType === b.actionType && idsA.some((id) => idsB.includes(id));
  }
  return (!!listA && isListedDelete(a, b)) || (!!listB && isListedDelete(b, a));
};

/**
 * The pending reorders that crossed one of the applied remote ops, each with
 * the clock of the last such op as the proof the resolver requires. File-based
 * providers never reject an upload, so the reorder is reissued at download time
 * on every provider instead of waiting for a server rejection.
 */
export const selectCrossedPendingReorders = (
  pending: Operation[],
  applied: Operation[],
): { opId: string; op: Operation; existingClock: VectorClock }[] =>
  pending.flatMap((op) => {
    if (!isReissuableReorder(op)) return [];
    const crossing = [...applied]
      .reverse()
      .find(
        (remote) =>
          isReissuedReorderCrossing(op, remote) &&
          compareVectorClocks(op.vectorClock, remote.vectorClock) ===
            VectorClockComparison.CONCURRENT,
      );
    return crossing ? [{ opId: op.id, op, existingClock: crossing.vectorClock }] : [];
  });

const entityOf = (
  snapshot: ReorderReplaySnapshot,
  entityType: EntityType,
  id: string,
): Payload | undefined => {
  if (entityType === 'BOARD')
    return snapshot.boards.boardCfgs.find((board) => board.id === id) as
      | Payload
      | undefined;
  const slices: Partial<Record<EntityType, { entities: Record<string, unknown> }>> = {
    NOTE: snapshot.note,
    SECTION: snapshot.section,
    SIMPLE_COUNTER: snapshot.simpleCounter,
    ISSUE_PROVIDER: snapshot.issueProvider,
  };
  return slices[entityType]?.entities[id] as Payload | undefined;
};

/**
 * Reissue a current list or the current values of a commuting patch's own
 * fields. Each replacement is a local no-op; status-blind replay remains
 * idempotent. The existing causal recovery transaction supplies the clock.
 */
export const projectReorderConflictAgainstState = (
  operation: Operation,
  snapshot: ReorderReplaySnapshot,
): SectionReplayProjection => {
  const p = payloadOf(operation);
  const withPayload = (actionPayload: Payload): Operation => ({
    ...operation,
    payload: isMultiEntityPayload(operation.payload)
      ? { ...operation.payload, actionPayload, entityChanges: [] }
      : actionPayload,
  });
  const patch = PATCHES[operation.actionType];
  if (patch) {
    // Whole-entity LWW would overwrite unrelated fields and stamp modified (and
    // released clients strip SimpleCounter.type); a patch of its own fields does not.
    const id = operation.entityId!;
    const entity = entityOf(snapshot, patch.entityType, id);
    if (!entity) return { kind: 'superseded' };
    const day =
      p[operation.actionType === ActionType.COUNTER_SET_FOR_DATE ? 'date' : 'today'];
    return {
      kind: 'replay',
      operation: withPayload(patch.write(p, entity)),
      order: { scope: JSON.stringify([operation.actionType, id, day]), position: 0 },
    };
  }
  let ids: string[];
  switch (operation.actionType) {
    case ActionType.NOTE_UPDATE_ORDER:
      ids =
        p['activeContextType'] === WorkContextType.PROJECT
          ? (snapshot.project.entities[p['activeContextId'] as string]?.noteIds ?? [])
          : snapshot.note.todayOrder;
      break;
    case ActionType.COUNTER_UPDATE_ORDER:
      // The UI sorts enabled habits only. The reducer preserves every unlisted
      // slot, so retain this footprint instead of involving disabled habits.
      ids = snapshot.simpleCounter.ids.filter((id) =>
        (p['ids'] as string[]).includes(id),
      );
      break;
    case ActionType.BOARDS_SORT:
      ids = snapshot.boards.boardCfgs.map((board) => board.id);
      break;
    case ActionType.ISSUE_PROVIDER_SORT_FIRST:
      // Sort-first appends unlisted providers. Carry the entire current list so
      // a replacement preserves later additions, deletions and their positions.
      ids = snapshot.issueProvider.ids;
      break;
    case ActionType.SECTION_UPDATE_ORDER:
      return projectSectionReplayAgainstState(operation, snapshot);
    default:
      return { kind: 'blocked', reason: 'not a supported content reorder' };
  }
  if (!ids.length) return { kind: 'superseded' };
  const actionPayload = { ...p, ids: [...ids] };
  return {
    kind: 'replay',
    operation: {
      ...withPayload(actionPayload),
      entityId: ids[0],
      entityIds: [...ids],
    },
    order: {
      scope: JSON.stringify([
        operation.actionType,
        p['activeContextType'],
        p['activeContextId'],
        p['contextId'],
      ]),
      position: 0,
    },
  };
};

/**
 * The pending ops of one entity that conflict with a concurrent remote op of
 * it: none when each commutes with it. A pending note or habit order that
 * commutes stays out of a conflict over the entity's other ops (#10420): it is
 * not superseded by either winner, and entity LWW could not carry its list.
 */
export const nonCommutingPendingOps = (
  remoteOp: Operation,
  pending: Operation[],
): Operation[] => {
  const commutes = (op: Operation): boolean =>
    areCommutingSectionOperations(remoteOp, op) ||
    areCommutingReorderAndContentOperations(remoteOp, op, pending) ||
    isReissuedReorderCrossing(remoteOp, op);
  // Only note and habit orders: no board, section or issue-provider crossing
  // beside a conflict has an E2E, so those keep the stop.
  const rest = pending.filter((op) => !isReissuableReorder(op) || !commutes(op));
  if (rest.every(commutes)) return [];
  // A pending delete of the entity keeps its orders in the conflict (the
  // stop): a remote win recreates the entity at the end of the list here,
  // while the kept order places it elsewhere on every other device.
  return rest.some((op) => op.opType === OpType.Delete) ? pending : rest;
};

/**
 * #10420: the pending reorders that conflict detection kept out of the
 * conflicts of entities they list, because each commutes with the remote op.
 * The remote winner rejects none of them. Like kept time deltas, they stay
 * pending and move past those conflicts' remote clocks in place
 * (`rebaseKeptReorders`), so the server accepts them after either winner.
 * `reissuedCrossings` holds each kept order's remote ops that it crosses as a
 * competing order or a listed note delete (`isReissuedReorderCrossing`): those
 * of its conflicts, and the concurrent ones applied in the same batch
 * (`appliedAlongside`), whose clock a conflict's remote clock may dominate.
 */
export interface KeptReorders {
  opIds: Set<string>;
  clockToDominate: VectorClock;
  reissuedCrossings: Map<string, Operation[]>;
}

export const keptCommutingReorders = (
  conflicts: EntityConflict[],
  pendingByEntity: Map<string, Operation[]>,
  appliedAlongside: Operation[] = [],
): KeptReorders => {
  const inConflict = new Set(conflicts.flatMap((c) => c.localOps.map((op) => op.id)));
  const opIds = new Set<string>();
  const reissuedCrossings = new Map<string, Operation[]>();
  let clockToDominate: VectorClock = {};
  for (const op of new Set([...pendingByEntity.values()].flat())) {
    if (!isReissuableReorder(op) || inConflict.has(op.id)) continue;
    const ids = getOpEntityIds(op);
    for (const c of conflicts) {
      if (c.entityType !== op.entityType || !ids.includes(c.entityId)) continue;
      opIds.add(op.id);
      for (const remote of c.remoteOps) {
        clockToDominate = mergeVectorClocks(clockToDominate, remote.vectorClock);
        if (isReissuedReorderCrossing(op, remote)) {
          reissuedCrossings.set(op.id, [...(reissuedCrossings.get(op.id) ?? []), remote]);
        }
      }
    }
  }
  for (const op of new Set([...pendingByEntity.values()].flat())) {
    if (!opIds.has(op.id)) continue;
    const crossings = appliedAlongside.filter(
      (remote) =>
        isReissuedReorderCrossing(op, remote) &&
        compareVectorClocks(op.vectorClock, remote.vectorClock) ===
          VectorClockComparison.CONCURRENT,
    );
    if (crossings.length > 0) {
      reissuedCrossings.set(op.id, [
        ...(reissuedCrossings.get(op.id) ?? []),
        ...crossings,
      ]);
    }
  }
  return { opIds, clockToDominate, reissuedCrossings };
};

/**
 * Moves the kept reorders past their crossings' clocks in place, with every
 * later pending op of this client on an entity they list (the resolution's own
 * ops among them), so seq order stays causal order per entity: a later op the
 * server checks after a rebased reorder must not look older than it. Ids,
 * seqs and payloads stay. Runs after the resolution is durable;
 * a crash before it leaves the reorder with its old clock, which the server
 * rejects into the existing paths (at worst the stop, never a loss).
 *
 * An order that crosses an applied remote order or note delete stays where it
 * is: `reissueCrossedPendingReorders` reissues it from current state only while
 * it is still concurrent with that op. Moved, it would upload its stale list,
 * such as the id of a note the remote delete removed, which released reducers
 * write as given. A crossing the local side won is rejected (`rejectedRemoteOpIds`)
 * and never applied, so that order moves.
 */
export const rebaseKeptReorders = async (
  store: {
    getUnsynced: () => Promise<{ seq: number; source: string; op: Operation }[]>;
    rebasePendingLocalOps: (
      opIds: readonly string[],
      clockToDominate: VectorClock,
    ) => Promise<unknown>;
  },
  kept: KeptReorders,
  rejectedRemoteOpIds: ReadonlySet<string>,
): Promise<void> => {
  if (kept.opIds.size === 0) return;
  const isLeftToReissue = (opId: string): boolean =>
    (kept.reissuedCrossings.get(opId) ?? []).some(
      (remote) => !rejectedRemoteOpIds.has(remote.id),
    );
  const pending = (await store.getUnsynced()).filter((e) => e.source === 'local');
  const orders = pending.filter(
    (e) => kept.opIds.has(e.op.id) && !isLeftToReissue(e.op.id),
  );
  if (orders.length === 0) return;
  const first = Math.min(...orders.map((e) => e.seq));
  const listed = new Set(
    orders.flatMap(({ op }) => getOpEntityIds(op).map((id) => `${op.entityType}:${id}`)),
  );
  const later = pending.filter(
    (e) =>
      e.seq >= first &&
      !isLeftToReissue(e.op.id) &&
      getOpEntityIds(e.op).some((id) => listed.has(`${e.op.entityType}:${id}`)),
  );
  await store.rebasePendingLocalOps(
    later.map((e) => e.op.id),
    kept.clockToDominate,
  );
};
