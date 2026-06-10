import {
  parseEntityKey as parseLibEntityKey,
  toEntityKey as toLibEntityKey,
} from '@sp/sync-core';
import type { EntityType } from '../core/operation.types';

export const toEntityKey = (entityType: EntityType, entityId: string): string =>
  toLibEntityKey(entityType, entityId);

export const parseEntityKey = (
  key: string,
): { entityType: EntityType; entityId: string } => {
  const parsed = parseLibEntityKey(key);
  return {
    entityType: parsed.entityType as EntityType,
    entityId: parsed.entityId,
  };
};
