/**
 * Structural entity-registry contracts for host apps.
 *
 * The sync core keeps entity names opaque. Host apps provide the actual entity
 * registry and may narrow registry keys with their own domain union.
 */

export type EntityStoragePattern = 'adapter' | 'singleton' | 'map' | 'array' | 'virtual';

export interface BaseEntity {
  id: string;
}

export type EntityDictionary<TEntity = unknown> = Record<string, TEntity | undefined>;

export type StateSelector<TResult = unknown> = (state: object) => TResult;

export type PropsStateSelector<TProps = unknown, TResult = unknown> = (
  state: object,
  props: TProps,
) => TResult;

export type SelectByIdFactory<TKey = never, TResult = unknown> = (
  id: string,
  key: TKey,
) => StateSelector<TResult>;

export interface EntityUpdateLike<TEntity = unknown> {
  id: string;
  changes: Partial<TEntity> | Record<string, unknown>;
}

export interface EntityAdapterLike<TEntity = unknown, TState = unknown> {
  selectId: unknown;
  getSelectors: unknown;
  addOne(entity: TEntity, state: TState): TState;
  updateOne(update: EntityUpdateLike<TEntity>, state: TState): TState;
}

export type SelectById =
  | StateSelector
  | PropsStateSelector<{ id: string }>
  | SelectByIdFactory;

export interface EntityConfig {
  storagePattern: EntityStoragePattern;
  featureName?: string;
  payloadKey: string;
  adapter?: EntityAdapterLike;
  selectEntities?: StateSelector<EntityDictionary>;
  selectById?: SelectById;
  selectState?: StateSelector;
  mapKey?: string;
  arrayKey?: string | null;
}

export type EntityRegistry<TEntityType extends string = string> = Partial<
  Record<TEntityType, EntityConfig>
>;

export const getEntityConfig = <TEntityType extends string>(
  registry: EntityRegistry<TEntityType>,
  entityType: TEntityType,
): EntityConfig | undefined => registry[entityType];

export const getPayloadKey = <TEntityType extends string>(
  registry: EntityRegistry<TEntityType>,
  entityType: TEntityType,
): string | undefined => registry[entityType]?.payloadKey;

export const isAdapterEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'adapter';

export const isSingletonEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'singleton';

export const isMapEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'map';

export const isArrayEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'array';

export const isVirtualEntity = (config: EntityConfig): boolean =>
  config.storagePattern === 'virtual';

export const getAllPayloadKeys = <TEntityType extends string>(
  registry: EntityRegistry<TEntityType>,
): string[] =>
  (Object.values(registry) as Array<EntityConfig | undefined>)
    .map((config) => config?.payloadKey)
    .filter((key): key is string => typeof key === 'string');
