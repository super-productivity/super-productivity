import { Store } from '@ngrx/store';
import { firstValueFrom } from 'rxjs';
import { PluginLog } from '../core/log';
import { PluginUserPersistenceService } from './plugin-user-persistence.service';
import { selectPluginUserDataFeatureState } from './store/plugin-user-data.reducer';
import {
  assertPluginPersistenceKey,
  composeId,
  listPluginPersistenceKeys,
} from './util/plugin-persistence-key.util';

/** Reads only applied keys without consulting pending writes or changing the op-log. */
export const listPluginDataKeys = async (
  store: Store,
  pluginId: string,
  prefix?: string,
): Promise<string[]> => {
  const state = await firstValueFrom(store.select(selectPluginUserDataFeatureState));
  return listPluginPersistenceKeys(
    state.map((entry) => entry.id),
    pluginId,
    prefix,
  );
};

/** Preserves legacy reads: load failures return null, invalid keys reject. */
export const loadPluginPersistedData = async (
  persistence: PluginUserPersistenceService,
  pluginId: string,
  key?: string,
): Promise<string | null> => {
  assertPluginPersistenceKey(key);
  const entityId = composeId(pluginId, key);
  try {
    return await persistence.loadPluginUserData(entityId);
  } catch (error) {
    PluginLog.err('PluginBridge: Failed to get persisted plugin data:', error);
    return null;
  }
};
