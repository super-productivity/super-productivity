import {
  applyLocalOnlySyncSettingsToAppData,
  LOCAL_ONLY_SYNC_DEVICE_KEYS,
  LOCAL_ONLY_SYNC_KEYS,
  LOCAL_ONLY_SYNC_SCHEDULE_KEYS,
  stripLocalOnlySyncScheduleSettings,
  stripLocalOnlySyncSettingsFromAppData,
} from './local-only-sync-settings.util';
import { SyncProviderId } from '../../op-log/sync-providers/provider.const';

describe('local-only sync settings utils', () => {
  it('schedule and device key sets are disjoint and exhaust LOCAL_ONLY_SYNC_KEYS', () => {
    const union = new Set<string>([
      ...LOCAL_ONLY_SYNC_SCHEDULE_KEYS,
      ...LOCAL_ONLY_SYNC_DEVICE_KEYS,
    ]);
    expect(union.size).toBe(
      LOCAL_ONLY_SYNC_SCHEDULE_KEYS.length + LOCAL_ONLY_SYNC_DEVICE_KEYS.length,
    );
    expect(union.size).toBe(LOCAL_ONLY_SYNC_KEYS.length);
  });

  it('should strip sync schedule settings from a sync config object', () => {
    const result = stripLocalOnlySyncScheduleSettings({
      syncInterval: 300000,
      isManualSyncOnly: true,
      isCompressionEnabled: true,
    }) as Record<string, unknown>;

    expect(result).toEqual({
      isCompressionEnabled: true,
    });
  });

  it('should strip local-only sync settings from app data', () => {
    const result = stripLocalOnlySyncSettingsFromAppData({
      globalConfig: {
        sync: {
          syncProvider: SyncProviderId.WebDAV,
          syncInterval: 300000,
          isManualSyncOnly: true,
          isCompressionEnabled: true,
        },
        misc: { isDisableAnimations: true },
      },
      task: { ids: [] },
    }) as Record<string, unknown>;

    const globalConfig = result['globalConfig'] as Record<string, unknown>;
    const sync = globalConfig['sync'] as Record<string, unknown>;

    expect(sync['syncProvider']).toBeNull();
    expect(sync['syncInterval']).toBeUndefined();
    expect(sync['isManualSyncOnly']).toBeUndefined();
    expect(sync['isCompressionEnabled']).toBe(true);
    expect(globalConfig['misc']).toEqual({ isDisableAnimations: true });
    expect(result['task']).toEqual({ ids: [] });
  });

  it('should leave data without globalConfig.sync unchanged by reference', () => {
    const data = { task: { ids: [] } };

    expect(stripLocalOnlySyncSettingsFromAppData(data)).toBe(data);
  });

  it('should apply local-only sync settings to app data', () => {
    const result = applyLocalOnlySyncSettingsToAppData(
      {
        globalConfig: {
          sync: {
            syncProvider: SyncProviderId.Dropbox,
            syncInterval: 600000,
            isManualSyncOnly: false,
            isCompressionEnabled: true,
          },
        },
      },
      {
        isEnabled: true,
        isEncryptionEnabled: false,
        syncProvider: SyncProviderId.WebDAV,
        syncInterval: 300000,
        isManualSyncOnly: true,
      },
    ) as Record<string, unknown>;

    const globalConfig = result['globalConfig'] as Record<string, unknown>;
    const sync = globalConfig['sync'] as Record<string, unknown>;

    expect(sync['isEnabled']).toBe(true);
    expect(sync['syncProvider']).toBe(SyncProviderId.WebDAV);
    expect(sync['syncInterval']).toBe(300000);
    expect(sync['isManualSyncOnly']).toBe(true);
    expect(sync['isCompressionEnabled']).toBe(true);
  });
});
