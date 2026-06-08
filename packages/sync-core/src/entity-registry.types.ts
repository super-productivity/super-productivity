/**
 * Structural entity-registry contracts for host apps.
 *
 * The sync core keeps entity names opaque. Host apps provide the actual entity
 * registry and may narrow registry keys with their own domain union.
 *
 * Framework-agnostic: this module describes only what the sync engine needs
 * to classify/route operations (`storagePattern`, `payloadKey`, optional
 * `featureName`/`mapKey`/`arrayKey`). Host applications that wire their own
 * state framework (NgRx, Redux, etc.) extend `EntityConfig` via the
 * `THostExtensions` generic and own the selector/adapter shape themselves.
 */

export type EntityStoragePattern = 'adapter' | 'singleton' | 'map' | 'array' | 'virtual';

export interface BaseEntity {
  id: string;
}

export type EntityDictionary<TEntity = unknown> = Record<string, TEntity | undefined>;

/**
 * Engine-essential entity metadata.
 *
 * Hosts may extend this with framework-specific fields (NgRx adapters,
 * selectors, Redux reducers, etc.) by supplying a `THostExtensions` type:
 *
 * ```ts
 * type HostEntityConfig = EntityConfig<{
 *   adapter?: EntityAdapter<MyEntity>;
 *   selectState?: (s: RootState) => unknown;
 * }>;
 * ```
 */
export type EntityConfig<THostExtensions = unknown> = {
  storagePattern: EntityStoragePattern;
  featureName?: string;
  payloadKey: string;
  mapKey?: string;
  arrayKey?: string | null;
} & THostExtensions;

export type EntityRegistry<
  TEntityType extends string = string,
  THostExtensions = unknown,
> = Partial<Record<TEntityType, EntityConfig<THostExtensions>>>;

export const getEntityConfig = <TEntityType extends string, THostExtensions = unknown>(
  registry: EntityRegistry<TEntityType, THostExtensions>,
  entityType: TEntityType,
): EntityConfig<THostExtensions> | undefined => registry[entityType];

export const getPayloadKey = <TEntityType extends string, THostExtensions = unknown>(
  registry: EntityRegistry<TEntityType, THostExtensions>,
  entityType: TEntityType,
): string | undefined => registry[entityType]?.payloadKey;

export const isAdapterEntity = <THostExtensions = unknown>(
  config: EntityConfig<THostExtensions>,
): boolean => config.storagePattern === 'adapter';

export const isSingletonEntity = <THostExtensions = unknown>(
  config: EntityConfig<THostExtensions>,
): boolean => config.storagePattern === 'singleton';

export const isMapEntity = <THostExtensions = unknown>(
  config: EntityConfig<THostExtensions>,
): boolean => config.storagePattern === 'map';

export const isArrayEntity = <THostExtensions = unknown>(
  config: EntityConfig<THostExtensions>,
): boolean => config.storagePattern === 'array';

export const isVirtualEntity = <THostExtensions = unknown>(
  config: EntityConfig<THostExtensions>,
): boolean => config.storagePattern === 'virtual';

export const getAllPayloadKeys = <TEntityType extends string, THostExtensions = unknown>(
  registry: EntityRegistry<TEntityType, THostExtensions>,
): string[] =>
  (Object.values(registry) as Array<EntityConfig<THostExtensions> | undefined>)
    .map((config) => config?.payloadKey)
    .filter((key): key is string => typeof key === 'string');
