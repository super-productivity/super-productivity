import {
  extractActionPayload,
  isMultiEntityPayload,
  Operation,
} from '../core/operation.types';
import { collectArchivedTaskEntityIds } from '../../root-store/meta/task-shared.actions';

/**
 * Narrows a bulk `moveToArchive` op to the top-level tasks that are still
 * archived after a partial conflict rejection (#9537).
 *
 * The footprint is re-derived from the SCOPED tasks instead of narrowing the
 * original envelope: since the cascade fix the envelope also lists subtask ids,
 * which have no top-level `tasks` entry and would otherwise be declared by an
 * op that no longer archives their parent. Pre-cascade ops declare no subtasks,
 * so their scoped footprint still equals their retained ids.
 *
 * Throws on a payload without a `tasks` array so a malformed row hits a clean
 * error, not a raw TypeError (`extractActionPayload` passes null through).
 */
export const scopeBulkArchivePayload = (
  archiveOp: Operation,
  retainedTopLevelIds: readonly string[],
): { payload: unknown; entityIds: string[] } => {
  const retained = new Set(retainedTopLevelIds);
  const originalPayload = archiveOp.payload;
  const originalActionPayload = (extractActionPayload(originalPayload) ?? {}) as Record<
    string,
    unknown
  >;
  const originalTasks = originalActionPayload['tasks'];
  if (!Array.isArray(originalTasks)) {
    throw new Error(
      `ConflictResolutionService: Cannot scope bulk archive ${archiveOp.actionType} - unsupported payload`,
    );
  }
  const tasks = originalTasks.filter((task) => {
    const id = (task as { id?: unknown } | null)?.id;
    return typeof id === 'string' && retained.has(id);
  });
  const scopedActionPayload = { ...originalActionPayload, tasks };
  const entityIds = collectArchivedTaskEntityIds(tasks);
  const entityIdSet = new Set(entityIds);
  const payload = isMultiEntityPayload(originalPayload)
    ? {
        ...originalPayload,
        actionPayload: scopedActionPayload,
        entityChanges: originalPayload.entityChanges.filter((change) =>
          entityIdSet.has(change.entityId),
        ),
      }
    : scopedActionPayload;
  return { payload, entityIds };
};
