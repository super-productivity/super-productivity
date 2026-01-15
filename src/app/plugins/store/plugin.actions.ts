import { createAction } from '@ngrx/store';
import { PersistentActionMeta } from '../../op-log/core/persistent-action.interface';
import { OpType } from '../../op-log/core/operation.types';
import { PluginUserData, PluginMetadata } from '../plugin-persistence.model';

// Plugin User Data actions
export const upsertPluginUserData = createAction(
  '[Plugin] Upsert User Data',
  (props: { pluginUserData: PluginUserData }) => ({
    ...props,
    meta: {
      isPersistent: true,
      entityType: 'PLUGIN_USER_DATA',
      entityId: props.pluginUserData.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const deletePluginUserData = createAction(
  '[Plugin] Delete User Data',
  (props: { pluginId: string }) => ({
    ...props,
    meta: {
      isPersistent: true,
      entityType: 'PLUGIN_USER_DATA',
      entityId: props.pluginId,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);

// Plugin Metadata actions
export const upsertPluginMetadata = createAction(
  '[Plugin] Upsert Metadata',
  (props: { pluginMetadata: PluginMetadata }) => ({
    ...props,
    meta: {
      isPersistent: true,
      entityType: 'PLUGIN_METADATA',
      entityId: props.pluginMetadata.id,
      opType: OpType.Update,
    } satisfies PersistentActionMeta,
  }),
);

export const deletePluginMetadata = createAction(
  '[Plugin] Delete Metadata',
  (props: { pluginId: string }) => ({
    ...props,
    meta: {
      isPersistent: true,
      entityType: 'PLUGIN_METADATA',
      entityId: props.pluginId,
      opType: OpType.Delete,
    } satisfies PersistentActionMeta,
  }),
);
