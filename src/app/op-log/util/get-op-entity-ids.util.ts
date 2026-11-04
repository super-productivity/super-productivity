/**
 * Normalizes an operation's entity references to a flat id list.
 *
 * Operations normally carry either `entityIds` (multi-entity) or a single
 * `entityId`, but legacy/malformed operations can contain both. The server's
 * conflict detector treats both declarations as authoritative, so the client
 * must use the same deduplicated union or it can miss a conflict.
 */
export const getOpEntityIds = (op: {
  entityId?: string;
  entityIds?: string[];
}): string[] =>
  Array.from(
    new Set([
      ...(op.entityId ? [op.entityId] : []),
      ...(op.entityIds?.length ? op.entityIds : []),
    ]),
  );

export const isMultiEntityOperation = (op: {
  entityId?: string;
  entityIds?: string[];
}): boolean => getOpEntityIds(op).length > 1;

/**
 * The TOP-LEVEL task ids a `moveToArchive` op names in its payload.
 *
 * Since the cascade fix, `op.entityIds` also lists the subtasks the archive
 * removes (see `collectArchivedTaskEntityIds`). That footprint is what conflict
 * detection needs, but the partial-rejection scoping in
 * `ConflictResolutionService` re-scopes an archive by its payload `tasks`
 * array, where subtask ids have no entry: a retained subtask id would declare
 * an entity the scoped payload does not carry, and if every parent lost the
 * conflict it would mint a replacement with an empty `tasks` array.
 *
 * Old ops (top-level ids only) resolve identically — their envelope and their
 * payload ids agree by construction. A payload without a `tasks` array falls
 * back to the envelope so malformed rows keep their pre-existing handling.
 */
export const getBulkArchiveTopLevelIds = (op: {
  entityId?: string;
  entityIds?: string[];
  payload?: unknown;
}): string[] => {
  const payload = op.payload as { actionPayload?: unknown } | undefined;
  const actionPayload = (payload?.actionPayload ?? payload) as
    | { tasks?: unknown }
    | undefined;
  const tasks = actionPayload?.tasks;
  if (!Array.isArray(tasks)) {
    return getOpEntityIds(op);
  }
  return tasks.flatMap((task) => {
    const id = (task as { id?: unknown } | null)?.id;
    return typeof id === 'string' && id !== '' ? [id] : [];
  });
};
