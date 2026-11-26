import { getOpEntityIds } from './get-op-entity-ids.util';

/** Bulk ops can name hundreds of entities; a few identify the op in a report. */
const MAX_LOGGED_ENTITY_IDS = 3;

export interface OpLogIdentity {
  opId: string;
  actionType: string;
  entityType: string;
  entityIds: string[];
  entityCount: number;
}

/**
 * Identity of an op for the exportable log: ids and types only, never the
 * payload (sync rule 9). Small enough to fit one log arg (`MAX_DATA_LENGTH`).
 */
export const describeOpForLog = (op: {
  id: string;
  actionType: string;
  entityType: string;
  entityId?: string;
  entityIds?: string[];
}): OpLogIdentity => {
  const entityIds = getOpEntityIds(op);
  return {
    opId: op.id,
    actionType: op.actionType,
    entityType: op.entityType,
    entityIds: entityIds.slice(0, MAX_LOGGED_ENTITY_IDS),
    entityCount: entityIds.length,
  };
};
