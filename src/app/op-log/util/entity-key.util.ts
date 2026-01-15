import { EntityType } from '../core/operation.types';

/**
 * Creates a unique key for an entity by combining its type and ID.
 * Used for indexing and looking up entities across the operation log system.
 *
 * @param entityType The type of the entity (e.g., 'TASK', 'PROJECT')
 * @param entityId The unique ID of the entity
 * @returns A composite key in the format "ENTITY_TYPE:entityId"
 */
export const toEntityKey = (entityType: EntityType, entityId: string): string =>
  `${entityType}:${entityId}`;

/**
 * Parses an entity key back into its components.
 *
 * @param key The composite entity key
 * @returns An object containing entityType and entityId
 */
export const parseEntityKey = (
  key: string,
): { entityType: EntityType; entityId: string } => {
  const colonIndex = key.indexOf(':');
  if (colonIndex === -1) {
    throw new Error(`Invalid entity key format: ${key}`);
  }
  return {
    entityType: key.substring(0, colonIndex) as EntityType,
    entityId: key.substring(colonIndex + 1),
  };
};
