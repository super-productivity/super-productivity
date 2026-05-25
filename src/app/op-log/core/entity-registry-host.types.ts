/**
 * Host-side (Super Productivity / NgRx) entity-registry extensions.
 *
 * `@sp/sync-core` keeps `EntityConfig` framework-agnostic; the selector and
 * adapter fields below are NgRx-shaped and live with the host that consumes
 * them.
 */

import type { EntityConfig as CoreEntityConfig, EntityDictionary } from '@sp/sync-core';

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

/**
 * NgRx-flavoured fields the host attaches to `EntityConfig`. None of these
 * are inspected by sync-core; they are read only by app-side code
 * (ConflictResolutionService, lwwUpdateMetaReducer, etc.).
 */
export interface HostEntityExtensions {
  adapter?: EntityAdapterLike;
  selectEntities?: StateSelector<EntityDictionary>;
  selectById?: SelectById;
  selectState?: StateSelector;
}

export type HostEntityConfig = CoreEntityConfig<HostEntityExtensions>;
