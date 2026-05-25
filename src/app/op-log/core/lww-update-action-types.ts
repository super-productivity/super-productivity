// LWW helper instance for Super Productivity. The lib at @sp/sync-core exposes
// a factory; the app supplies its own entity-type list (ENTITY_TYPES) so the lib
// stays domain-agnostic.

import { createLwwUpdateActionTypeHelpers } from '@sp/sync-core';
import { ENTITY_TYPES } from '@sp/shared-schema';
import type { EntityType } from './operation.types';
import type { ActionType } from './action-types.enum';

const helpers = createLwwUpdateActionTypeHelpers<EntityType>(ENTITY_TYPES);

export const LWW_UPDATE_ACTION_TYPES = helpers.LWW_UPDATE_ACTION_TYPES;
export const isLwwUpdateActionType = helpers.isLwwUpdateActionType;
export const getLwwEntityType = helpers.getLwwEntityType;
export const toLwwUpdateActionType = (entityType: EntityType): ActionType =>
  helpers.toLwwUpdateActionType(entityType) as ActionType;
