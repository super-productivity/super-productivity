import {
  EntityType,
  isMultiEntityPayload,
  Operation,
  OpType,
} from '../core/operation.types';
import { getOpEntityIds } from '../util/get-op-entity-ids.util';

/**
 * Collects the TASK ids removed by DELETE ops in the same resolution batch.
 * A bulk `deleteTasks` op carries every id in `entityIds` and mirrors only
 * the first to `entityId`, with an empty `entityChanges`, so union both via
 * `getOpEntityIds` — reading `entityId` alone would miss every trailing id
 * and let recovery resurrect it. A mixed-entity payload can additionally
 * carry task deletes in `entityChanges`. Used to keep project/parent recovery
 * from recreating a task another device is concurrently deleting. Archive ops
 * are `OpType.Update` and are intentionally excluded.
 */
export const collectDeletedTaskIds = (ops: readonly Operation[]): Set<string> => {
  const deletedTaskIds = new Set<string>();
  for (const op of ops) {
    if (op.entityType === 'TASK' && op.opType === OpType.Delete) {
      for (const id of getOpEntityIds(op)) deletedTaskIds.add(id);
    }
    if (isMultiEntityPayload(op.payload)) {
      for (const change of op.payload.entityChanges) {
        if (
          change.entityType === 'TASK' &&
          change.opType === OpType.Delete &&
          change.entityId
        ) {
          deletedTaskIds.add(change.entityId);
        }
      }
    }
  }
  return deletedTaskIds;
};

/**
 * Collects the ids removed by single/bulk DELETE ops of one entity type in the
 * same resolution batch. Unlike `collectDeletedTaskIds` this does not scan
 * multi-entity `entityChanges`: `deleteNote`/`deleteSection`/`deleteTaskRepeatCfg(s)`
 * are all single- or bulk-entity deletes, so `getOpEntityIds` covers them. Used
 * to keep the project cascade recovery from resurrecting a note/section/repeat-cfg
 * another device is concurrently deleting (same divergence guard as tasks, #8997).
 */
export const collectDeletedEntityIds = (
  ops: readonly Operation[],
  entityType: EntityType,
): Set<string> => {
  const deletedIds = new Set<string>();
  for (const op of ops) {
    if (op.entityType === entityType && op.opType === OpType.Delete) {
      for (const id of getOpEntityIds(op)) deletedIds.add(id);
    }
  }
  return deletedIds;
};
