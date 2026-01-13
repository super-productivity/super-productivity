import { createFeatureSelector, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import {
  initialPluginMetaDataState,
  PluginMetaDataState,
} from '../plugin-persistence.model';
import { upsertPluginMetadata, deletePluginMetadata } from './plugin.actions';

export const PLUGIN_METADATA_FEATURE_NAME = 'pluginMetadata';

export const pluginMetadataReducer = createReducer(
  initialPluginMetaDataState,
  on(
    loadAllData,
    (_state, { appDataComplete }) =>
      (appDataComplete as { pluginMetadata?: PluginMetaDataState }).pluginMetadata ??
      initialPluginMetaDataState,
  ),
  on(upsertPluginMetadata, (state, { pluginMetadata }) => {
    const existingIndex = state.findIndex((item) => item.id === pluginMetadata.id);
    if (existingIndex >= 0) {
      return state.map((item, i) => (i === existingIndex ? pluginMetadata : item));
    }
    return [...state, pluginMetadata];
  }),
  on(deletePluginMetadata, (state, { pluginId }) =>
    state.filter((item) => item.id !== pluginId),
  ),
);

export const selectPluginMetadataFeatureState =
  createFeatureSelector<PluginMetaDataState>(PLUGIN_METADATA_FEATURE_NAME);
