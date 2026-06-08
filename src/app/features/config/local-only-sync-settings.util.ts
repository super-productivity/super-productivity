import { SyncConfig } from './global-config.model';

export type LocalOnlySyncSettings = Pick<
  SyncConfig,
  | 'isEnabled'
  | 'isEncryptionEnabled'
  | 'syncProvider'
  | 'syncInterval'
  | 'isManualSyncOnly'
>;

export const LOCAL_ONLY_SYNC_SCHEDULE_KEYS = [
  'syncInterval',
  'isManualSyncOnly',
] as const satisfies readonly (keyof SyncConfig)[];

export const stripLocalOnlySyncScheduleSettings = <T extends Record<string, unknown>>(
  syncConfig: T,
): Omit<T, (typeof LOCAL_ONLY_SYNC_SCHEDULE_KEYS)[number]> => {
  const stripped = { ...syncConfig };
  for (const key of LOCAL_ONLY_SYNC_SCHEDULE_KEYS) {
    delete stripped[key];
  }
  return stripped;
};

export const applyLocalOnlySyncSettingsToAppData = <T>(
  data: T,
  localOnlySettings: LocalOnlySyncSettings,
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
      sync: {
        ...(globalConfig['sync'] as Record<string, unknown>),
        ...localOnlySettings,
      },
    },
  } as T;
};

export const stripLocalOnlySyncSettingsFromAppData = (data: unknown): unknown => {
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

  const sync = globalConfig['sync'] as Record<string, unknown>;

  return {
    ...typedData,
    globalConfig: {
      ...globalConfig,
      sync: {
        ...stripLocalOnlySyncScheduleSettings(sync),
        syncProvider: null,
      },
    },
  };
};
