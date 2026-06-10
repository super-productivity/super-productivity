import { Action } from '@ngrx/store';
import { EntityType, OpType } from './operation.types';

export interface PersistentActionMeta {
  isPersistent?: boolean; // When false, the action is blacklisted and not persisted
  entityType: EntityType;
  entityId?: string; // Optional if entityIds is provided
  entityIds?: string[]; // For batch operations
  opType: OpType;
  isRemote?: boolean; // TRUE if from Sync (prevents re-logging)
  // TRUE only when the op being applied was authored by a DIFFERENT client
  // (set during bulk apply when op.clientId !== this device's clientId).
  // Distinct from isRemote, which is also TRUE for replay of the device's OWN
  // ops during hydration. Reducers that preserve per-device "local-only"
  // settings (e.g. sync config) must key off THIS flag, not isRemote, so they
  // don't clobber the device's own settings while replaying its own ops.
  isApplyingFromOtherClient?: boolean;
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
