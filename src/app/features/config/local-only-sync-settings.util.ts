import { SyncConfig } from './global-config.model';

/**
 * Local-only sync settings — two tiers, both per-device:
 *
 * - SCHEDULE keys (`syncInterval`, `isManualSyncOnly`): must NEVER leave the
 *   device. Stripped (`Omit`-style) at every upload boundary.
 * - DEVICE-IDENTITY keys (`syncProvider`, `isEnabled`, `isEncryptionEnabled`):
 *   exist on every device but the local value must win on hydration. On upload
 *   `syncProvider` is nulled (so a remote import never picks a provider for
 *   you); on hydration the local values are re-applied via
 *   {@link applyLocalOnlySyncSettingsToAppData}.
 *
 * The key arrays below are the single source of truth — both the
 * `LocalOnlySyncSettings` type and the reducer-side preservation helper
 * (`withLocalOnlySyncSettings` in `global-config.reducer.ts`) derive from them.
 * Add a new local-only key here and the type + reducer + strip helpers pick it
 * up automatically.
 */
export const LOCAL_ONLY_SYNC_SCHEDULE_KEYS = [
  'syncInterval',
  'isManualSyncOnly',
] as const satisfies readonly (keyof SyncConfig)[];

export const LOCAL_ONLY_SYNC_DEVICE_KEYS = [
  'syncProvider',
  'isEnabled',
  'isEncryptionEnabled',
] as const satisfies readonly (keyof SyncConfig)[];

export const LOCAL_ONLY_SYNC_KEYS = [
  ...LOCAL_ONLY_SYNC_SCHEDULE_KEYS,
  ...LOCAL_ONLY_SYNC_DEVICE_KEYS,
] as const;

export type LocalOnlySyncSettings = Pick<
  SyncConfig,
  (typeof LOCAL_ONLY_SYNC_KEYS)[number]
>;

export const stripLocalOnlySyncScheduleSettings = <T extends Record<string, unknown>>(
  syncConfig: T,
): Omit<T, (typeof LOCAL_ONLY_SYNC_SCHEDULE_KEYS)[number]> => {
  const stripped = { ...syncConfig };
  for (const key of LOCAL_ONLY_SYNC_SCHEDULE_KEYS) {
    delete stripped[key];
  }
  return stripped;
};

const _updateSyncConfigInAppData = <T>(
  data: T,
  updateSyncConfig: (syncConfig: Record<string, unknown>) => Record<string, unknown>,
): T => {
  if (!data || typeof data !== 'object') {
    return data;
  }

  const typedData = data as Record<string, unknown>;
  if (!typedData['globalConfig'] || typeof typedData['globalConfig'] !== 'object') {
    return data;
  }

  const globalConfig = typedData['globalConfig'] as Record<string, unknown>;
  if (!globalConfig['sync'] || typeof globalConfig['sync'] !== 'object') {
    return data;
  }

  return {
    ...typedData,
    globalConfig: {
      ...globalConfig,
      sync: updateSyncConfig(globalConfig['sync'] as Record<string, unknown>),
    },
  } as T;
};

export const applyLocalOnlySyncSettingsToAppData = <T>(
  data: T,
  localOnlySettings: LocalOnlySyncSettings,
): T => {
  return _updateSyncConfigInAppData(data, (syncConfig) => ({
    ...syncConfig,
    ...localOnlySettings,
  }));
};

export const stripLocalOnlySyncSettingsFromAppData = (data: unknown): unknown => {
  return _updateSyncConfigInAppData(data, (syncConfig) => ({
    ...stripLocalOnlySyncScheduleSettings(syncConfig),
    syncProvider: null,
  }));
};
