import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import {
  AppFeaturesConfig,
  GlobalConfigState,
} from '../../features/config/global-config.model';
import {
  applyLocalOnlySyncSettingsToAppData,
  LocalOnlySyncSettings,
} from '../../features/config/local-only-sync-settings.util';

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' ? (value as Record<string, unknown>) : {};

type RemoteRebuildBaselineState = Record<string, unknown> & {
  globalConfig: GlobalConfigState;
};

/**
 * The state a USE_REMOTE rebuild persists before it replays the server history:
 * the remote snapshot, or the model defaults when the history has none.
 *
 * getDefaultMainModelData intentionally excludes globalConfig. Add a default
 * config shell before applying the canonical device-local fields so an
 * interrupted rebuild can hydrate enough configuration to sync again.
 *
 * The rebuild's live reset keeps the device's config, so without a snapshot the
 * shell takes the device's own app features: a restart then loads what the
 * device shows. The defaults have every feature on, while a new install starts
 * with fewer (#10361), so they would switch features on at the restart
 * (#10399). A snapshot's own appFeatures win.
 */
export const buildRemoteRebuildBaselineState = (
  baselineSource: Record<string, unknown>,
  localOnlySyncSettings: LocalOnlySyncSettings,
  liveAppFeatures: AppFeaturesConfig,
): RemoteRebuildBaselineState => {
  const baselineGlobalConfig = asRecord(baselineSource['globalConfig']);
  return applyLocalOnlySyncSettingsToAppData(
    {
      ...baselineSource,
      globalConfig: {
        ...DEFAULT_GLOBAL_CONFIG,
        appFeatures: liveAppFeatures,
        ...baselineGlobalConfig,
        sync: {
          ...DEFAULT_GLOBAL_CONFIG.sync,
          ...asRecord(baselineGlobalConfig['sync']),
        },
      } as GlobalConfigState,
    },
    localOnlySyncSettings,
  );
};
