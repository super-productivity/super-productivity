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
