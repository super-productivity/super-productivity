import { AffectedEntity, EntityType } from '../core/operation.types';

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

export const getOpAffectedEntities = (op: {
  entityType: EntityType;
  entityId?: string;
  entityIds?: string[];
  affectedEntities?: AffectedEntity[];
}): AffectedEntity[] => {
  const rawEntities: AffectedEntity[] = [
    ...(op.affectedEntities ?? []),
    ...getOpEntityIds(op).map((entityId) => ({
      entityType: op.entityType,
      entityId,
    })),
  ];

  const seen = new Set<string>();
  const result: AffectedEntity[] = [];
  for (const entity of rawEntities) {
    if (!entity.entityType || !entity.entityId) {
      continue;
    }
    const key = `${entity.entityType}\u0000${entity.entityId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(entity);
  }
  return result;
};
