import { WorkContextType } from '../../features/work-context/work-context.model';
import { NoteState } from '../../features/note/note.model';
import { SimpleCounterState } from '../../features/simple-counter/simple-counter.model';
import { BoardsState } from '../../features/boards/store/boards.reducer';
import {
  ActionType,
  extractActionPayload,
  isMultiEntityPayload,
  Operation,
  OpType,
} from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';
import {
  SectionReplayProjection,
  SectionReplaySnapshot,
  projectSectionReplayAgainstState,
} from './section-conflict-commutativity.util';

export interface ReorderReplaySnapshot extends SectionReplaySnapshot {
  note: NoteState;
  simpleCounter: SimpleCounterState;
  boards: BoardsState;
}

const reorderTypes = new Map<ActionType, Operation['entityType']>([
  [ActionType.NOTE_UPDATE_ORDER, 'NOTE'],
  [ActionType.COUNTER_UPDATE_ORDER, 'SIMPLE_COUNTER'],
  [ActionType.BOARDS_SORT, 'BOARD'],
  [ActionType.SECTION_UPDATE_ORDER, 'SECTION'],
]);

const payloadOf = (op: Operation): Record<string, unknown> =>
  extractActionPayload(op.payload) as Record<string, unknown>;

/** Match the UI's actual list write, including its declared conflict footprint. */
export const isContentReorderOperation = (op: Operation): boolean => {
  if (reorderTypes.get(op.actionType) !== op.entityType || op.opType !== OpType.Move)
    return false;
  const payload = payloadOf(op);
  const ids = payload?.['ids'];
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
      (payload['activeContextType'] === WorkContextType.PROJECT &&
        typeof payload['activeContextId'] === 'string') ||
      (payload['activeContextType'] === WorkContextType.TAG &&
        payload['activeContextId'] === 'TODAY')
    );
  }
  return (
    op.actionType !== ActionType.SECTION_UPDATE_ORDER ||
    typeof payload['contextId'] === 'string'
  );
};

const hasOnlyFields = (value: unknown, fields: string[]): boolean =>
  !!value &&
  typeof value === 'object' &&
  Object.keys(value).length > 0 &&
  Object.keys(value).every((key) => fields.includes(key));

const isOrderAndContent = (order: Operation, edit: Operation): boolean => {
  if (
    !isContentReorderOperation(order) ||
    order.entityType !== edit.entityType ||
    edit.opType !== OpType.Update ||
    getOpEntityIds(edit).length !== 1 ||
    !getOpEntityIds(order).includes(edit.entityId!)
  )
    return false;
  const p = payloadOf(edit);
  switch (edit.actionType) {
    case ActionType.NOTE_UPDATE: {
      const note = p?.['note'] as { id?: string; changes?: unknown } | undefined;
      // Pinning and moving notes also write membership/order, so keep them out.
      return (
        order.entityType === 'NOTE' &&
        note?.id === edit.entityId &&
        hasOnlyFields(note?.changes, ['content', 'modified'])
      );
    }
    case ActionType.COUNTER_SET_TODAY:
      return (
        order.entityType === 'SIMPLE_COUNTER' &&
        p?.['id'] === edit.entityId &&
        typeof p['today'] === 'string' &&
        typeof p['newVal'] === 'number'
      );
    case ActionType.BOARDS_UPDATE: {
      const updates = p?.['updates'] as Record<string, unknown>;
      return (
        order.entityType === 'BOARD' &&
        p?.['id'] === edit.entityId &&
        // The editor sends the full config. It changes one board in place;
        // changing its identity would also change the ordered membership.
        hasOnlyFields(updates, ['id', 'title', 'cols', 'panels']) &&
        (!('id' in updates) || updates['id'] === edit.entityId)
      );
    }
    case ActionType.SECTION_UPDATE: {
      const section = p?.['section'] as { id?: string; changes?: unknown } | undefined;
      return (
        order.entityType === 'SECTION' &&
        section?.id === edit.entityId &&
        hasOnlyFields(section?.changes, ['title'])
      );
    }
    default:
      return false;
  }
};

// Admission still requires an exact commuting retained remote row; this list
// only selects candidates for that existing fail-closed causal proof.
export const isReorderConflictOperation = (op: Operation): boolean =>
  isContentReorderOperation(op) ||
  [
    ActionType.NOTE_UPDATE,
    ActionType.COUNTER_SET_TODAY,
    ActionType.BOARDS_UPDATE,
    ActionType.SECTION_UPDATE,
  ].includes(op.actionType);

/** Only these reproduced content writes commute with the corresponding reorder. */
export const areCommutingReorderAndContentOperations = (
  a: Operation,
  b: Operation,
): boolean => isOrderAndContent(a, b) || isOrderAndContent(b, a);

/**
 * Reissue a current list or the current values of a commuting content patch.
 * Each replacement is a local no-op; status-blind replay remains idempotent.
 * The existing causal recovery transaction supplies the dominating clock.
 */
export const projectReorderConflictAgainstState = (
  operation: Operation,
  snapshot: ReorderReplaySnapshot,
): SectionReplayProjection => {
  const p = payloadOf(operation);
  const withPayload = (actionPayload: Record<string, unknown>): Operation => ({
    ...operation,
    payload: isMultiEntityPayload(operation.payload)
      ? { ...operation.payload, actionPayload, entityChanges: [] }
      : actionPayload,
  });
  // Retain only the fields carried by the rejected edit, with their current
  // values. Whole-entity LWW strips SimpleCounter.type and stamps modified;
  // these idempotent updates preserve both content and unrelated state.
  if (!isContentReorderOperation(operation)) {
    const id = operation.entityId!;
    let actionPayload: Record<string, unknown>;
    if (operation.actionType === ActionType.COUNTER_SET_TODAY) {
      const entity = snapshot.simpleCounter.entities[id];
      if (!entity) return { kind: 'superseded' };
      actionPayload = { ...p, newVal: entity.countOnDay[p['today'] as string] ?? 0 };
    } else {
      const key =
        operation.entityType === 'NOTE'
          ? 'note'
          : operation.entityType === 'SECTION'
            ? 'section'
            : 'updates';
      const entity =
        operation.entityType === 'NOTE'
          ? snapshot.note.entities[id]
          : operation.entityType === 'SECTION'
            ? snapshot.section.entities[id]
            : snapshot.boards.boardCfgs.find((board) => board.id === id);
      if (!entity) return { kind: 'superseded' };
      const original =
        key === 'updates' ? p[key] : (p[key] as { changes: unknown }).changes;
      const changes = Object.fromEntries(
        Object.keys(original as object).map((field) => [
          field,
          (entity as unknown as Record<string, unknown>)[field],
        ]),
      );
      actionPayload = { ...p, [key]: key === 'updates' ? changes : { id, changes } };
    }
    return {
      kind: 'replay',
      operation: withPayload(actionPayload),
      order: {
        scope: JSON.stringify([operation.actionType, id, p['today']]),
        position: 0,
      },
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
