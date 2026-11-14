import { createAction, createFeatureSelector, createReducer, on } from '@ngrx/store';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { toLwwUpdateActionType } from '../../op-log/core/lww-update-action-types';
import {
  initialPluginUserDataState,
  PluginUserDataState,
} from '../plugin-persistence.model';
import { upsertPluginUserData, deletePluginUserData } from './plugin.actions';

export const PLUGIN_USER_DATA_FEATURE_NAME = 'pluginUserData';

// This is a keyed collection, not a user-ordered list. Concurrent deliveries
// arrive in different orders; keep snapshots/replay identical without changing
// any IDs or payloads. Compare code units, not the device's locale.
const ordered = (state: PluginUserDataState): PluginUserDataState =>
  [...state].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

export const pluginUserDataReducer = createReducer(
  initialPluginUserDataState,
  on(loadAllData, (_state, { appDataComplete }) =>
    ordered(
      (appDataComplete as { pluginUserData?: PluginUserDataState }).pluginUserData ??
        initialPluginUserDataState,
    ),
  ),
  on(upsertPluginUserData, (state, { pluginUserData }) => {
    const existingIndex = state.findIndex((item) => item.id === pluginUserData.id);
    if (existingIndex >= 0) {
      return state.map((item, i) => (i === existingIndex ? pluginUserData : item));
    }
    return ordered([...state, pluginUserData]);
  }),
  // The LWW meta-reducer has already inserted/replaced the row before calling
  // this feature reducer, including recreations of a previously absent key.
  on(createAction(toLwwUpdateActionType('PLUGIN_USER_DATA')), (state) => ordered(state)),
  on(deletePluginUserData, (state, { pluginId }) =>
    state.filter((item) => item.id !== pluginId),
  ),
);

export const selectPluginUserDataFeatureState =
  createFeatureSelector<PluginUserDataState>(PLUGIN_USER_DATA_FEATURE_NAME);
