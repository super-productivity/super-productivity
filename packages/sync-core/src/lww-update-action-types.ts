/**
 * Last-Writer-Wins update action type helpers.
 *
 * The lib doesn't know which entity types exist in the host app, so the helpers
 * are constructed via a factory that takes the host's entity-type list.
 */

const LWW_UPDATE_SUFFIX = '] LWW Update';

export interface LwwUpdateActionTypeHelpers<TEntityType extends string = string> {
  /** Set of all "<EntityType] LWW Update" action-type strings the host knows about. */
  readonly LWW_UPDATE_ACTION_TYPES: ReadonlySet<string>;
  /** True if `actionType` is a LWW update for one of the registered entity types. */
  isLwwUpdateActionType(actionType: string): boolean;
  /** Reverse lookup: which entity type is targeted by this LWW action-type string? */
  getLwwEntityType(actionType: string): TEntityType | undefined;
  /** Build the LWW update action-type string for a given entity type. */
  toLwwUpdateActionType(entityType: TEntityType): string;
}

/**
 * Build LWW helpers for the given list of entity types.
 *
 * @example
 *   const lww = createLwwUpdateActionTypeHelpers(['ITEM', 'COLLECTION'] as const);
 *   lww.toLwwUpdateActionType('ITEM'); // '[ITEM] LWW Update'
 */
export const createLwwUpdateActionTypeHelpers = <TEntityType extends string>(
  entityTypes: readonly TEntityType[],
): LwwUpdateActionTypeHelpers<TEntityType> => {
  const LWW_UPDATE_ACTION_TYPES: ReadonlySet<string> = new Set(
    entityTypes.map((et) => `[${et}${LWW_UPDATE_SUFFIX}`),
  );

  const LWW_ENTITY_MAP: ReadonlyMap<string, TEntityType> = new Map(
    entityTypes.map((et) => [`[${et}${LWW_UPDATE_SUFFIX}`, et]),
  );

  return {
    LWW_UPDATE_ACTION_TYPES,
    isLwwUpdateActionType: (actionType) => LWW_UPDATE_ACTION_TYPES.has(actionType),
    getLwwEntityType: (actionType) => LWW_ENTITY_MAP.get(actionType),
    toLwwUpdateActionType: (entityType) => `[${entityType}${LWW_UPDATE_SUFFIX}`,
  };
};
