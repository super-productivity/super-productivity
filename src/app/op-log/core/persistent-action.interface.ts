import { Action } from '@ngrx/store';
import { EntityType, OpType } from './operation.types';

export interface PersistentActionMeta {
  isPersistent?: boolean; // When false, the action is blacklisted and not persisted
  entityType: EntityType;
  entityId?: string; // Optional if entityIds is provided
  entityIds?: string[]; // For batch operations
  opType: OpType;
  isRemote?: boolean; // TRUE if from Sync (prevents re-logging)
  isBulk?: boolean; // TRUE for batch operations
}

export interface PersistentAction extends Action {
  type: string; // Standard NgRx action type
  meta: PersistentActionMeta;
  // NOTE: `any` is intentional here - NgRx action payloads are dynamic and the code
  // immediately casts to specific action types. Using `unknown` would require double
  // casts (as unknown as SpecificType) throughout the codebase without type safety benefit.
  [key: string]: any; // Dynamic payload properties (NgRx action payloads)
}

// Helper type guard - only actions with explicit isPersistent: true are persisted
export const isPersistentAction = (action: Action): action is PersistentAction => {
  const a = action as PersistentAction;
  return !!a && !!a.meta && a.meta.isPersistent === true;
};
