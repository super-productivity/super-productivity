import { ENTITY_TYPES, EntityType, ActionType } from './operation.types';

const LWW_UPDATE_SUFFIX = '] LWW Update';

export const LWW_UPDATE_ACTION_TYPES: ReadonlySet<string> = new Set(
  ENTITY_TYPES.map((et) => `[${et}${LWW_UPDATE_SUFFIX}`),
);

const LWW_ENTITY_MAP: ReadonlyMap<string, EntityType> = new Map(
  ENTITY_TYPES.map((et) => [`[${et}${LWW_UPDATE_SUFFIX}`, et]),
);

export const isLwwUpdateActionType = (actionType: string): boolean =>
  LWW_UPDATE_ACTION_TYPES.has(actionType);

export const getLwwEntityType = (actionType: string): EntityType | undefined =>
  LWW_ENTITY_MAP.get(actionType);

export const toLwwUpdateActionType = (entityType: EntityType): ActionType =>
  `[${entityType}${LWW_UPDATE_SUFFIX}` as ActionType;
