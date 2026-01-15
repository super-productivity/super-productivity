import { createFeatureSelector, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import {
  initialPluginUserDataState,
  PluginUserDataState,
} from '../plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './plugin.actions';

export const PLUGIN_USER_DATA_FEATURE_NAME = 'pluginUserData';

export const pluginUserDataReducer = createReducer(
  initialPluginUserDataState,
  on(
    loadAllData,
    (_state, { appDataComplete }) =>
      (appDataComplete as { pluginUserData?: PluginUserDataState }).pluginUserData ??
      initialPluginUserDataState,
  ),
  on(upsertPluginUserData, (state, { pluginUserData }) => {
    const existingIndex = state.findIndex((item) => item.id === pluginUserData.id);
    if (existingIndex >= 0) {
      return state.map((item, i) => (i === existingIndex ? pluginUserData : item));
    }
    return [...state, pluginUserData];
  }),
  on(deletePluginUserData, (state, { pluginId }) =>
    state.filter((item) => item.id !== pluginId),
  ),
);

export const selectPluginUserDataFeatureState =
  createFeatureSelector<PluginUserDataState>(PLUGIN_USER_DATA_FEATURE_NAME);
