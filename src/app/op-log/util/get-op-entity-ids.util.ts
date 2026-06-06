/**
 * Normalizes an operation's entity references to a flat id list.
 *
 * Operations carry either `entityIds` (multi-entity) or a single `entityId`.
 * Returns the multi list when present, otherwise the single id wrapped in an
 * array, otherwise an empty array.
 */
export const getOpEntityIds = (op: {
  entityId?: string;
  entityIds?: string[];
}): string[] => (op.entityIds?.length ? op.entityIds : op.entityId ? [op.entityId] : []);
