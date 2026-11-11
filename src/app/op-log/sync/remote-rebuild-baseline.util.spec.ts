import { DEFAULT_GLOBAL_CONFIG } from '../../features/config/default-global-config.const';
import {
  NEW_INSTALL_APP_FEATURES,
  NEW_INSTALL_CONFIG_SECTIONS,
} from '../../features/config/new-install-config.const';
import { SyncProviderId } from '../sync-providers/provider.const';
import { buildRemoteRebuildBaselineState } from './remote-rebuild-baseline.util';

describe('buildRemoteRebuildBaselineState', () => {
  const localOnlySyncSettings = {
    isEnabled: true,
    isEncryptionEnabled: true,
    syncProvider: SyncProviderId.SuperSync,
    syncInterval: 17,
    isManualSyncOnly: true,
  };

  it("starts a history without a snapshot from the device's own new-install sections (#10399)", () => {
    const baseline = buildRemoteRebuildBaselineState(
      { task: { ids: [], entities: {} } },
      localOnlySyncSettings,
      NEW_INSTALL_CONFIG_SECTIONS,
    );

    expect(baseline.globalConfig.appFeatures).toEqual(NEW_INSTALL_APP_FEATURES);
    expect(baseline.globalConfig.idle).toEqual(NEW_INSTALL_CONFIG_SECTIONS.idle);
    expect(baseline.globalConfig.takeABreak).toEqual(
      NEW_INSTALL_CONFIG_SECTIONS.takeABreak,
    );
    expect(baseline.globalConfig.focusMode).toEqual(
      NEW_INSTALL_CONFIG_SECTIONS.focusMode,
    );
    expect(baseline.globalConfig.misc).toEqual(DEFAULT_GLOBAL_CONFIG.misc);
    expect(baseline['task']).toEqual({ ids: [], entities: {} });
  });

  it("keeps a snapshot's own appFeatures over the device's", () => {
    const snapshotAppFeatures = {
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      isBoardsEnabled: true,
      isHabitsEnabled: false,
    };

    const baseline = buildRemoteRebuildBaselineState(
      { globalConfig: { appFeatures: snapshotAppFeatures } },
      localOnlySyncSettings,
      NEW_INSTALL_CONFIG_SECTIONS,
    );

    expect(baseline.globalConfig.appFeatures).toEqual(snapshotAppFeatures);
  });

  it('applies the device-local sync settings over the default sync config', () => {
    const baseline = buildRemoteRebuildBaselineState(
      { globalConfig: { sync: { isCompressionEnabled: true } } },
      localOnlySyncSettings,
      NEW_INSTALL_CONFIG_SECTIONS,
    );

    expect(baseline.globalConfig.sync).toEqual({
      ...DEFAULT_GLOBAL_CONFIG.sync,
      isCompressionEnabled: true,
      ...localOnlySyncSettings,
    });
  });
});
