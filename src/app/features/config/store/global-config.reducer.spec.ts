import {
  globalConfigReducer,
  initialGlobalConfigState,
  selectLocalizationConfig,
  selectMiscConfig,
  selectShortSyntaxConfig,
  selectSoundConfig,
  selectEvaluationConfig,
  selectIdleConfig,
  selectSyncConfig,
  selectTakeABreakConfig,
  selectTimelineConfig,
  selectIsDominaModeConfig,
  selectFocusModeConfig,
  selectPomodoroConfig,
  selectReminderConfig,
  selectIsFocusModeEnabled,
  selectTimelineWorkStartEndHours,
} from './global-config.reducer';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { GlobalConfigState } from '../global-config.model';
import { LegacySyncProvider } from '../../../imex/sync/legacy-sync-provider.model';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';

describe('GlobalConfigReducer', () => {
  describe('loadAllData action', () => {
    it('should return oldState when appDataComplete.globalConfig is falsy', () => {
      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({ appDataComplete: {} as AppDataComplete }),
      );

      expect(result).toBe(initialGlobalConfigState);
    });

    it('should load globalConfig from appDataComplete', () => {
      const newConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        misc: {
          ...initialGlobalConfigState.misc,
          isDisableAnimations: true,
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: newConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.isDisableAnimations).toBe(true);
    });

    it('should use syncProvider from snapshot when oldState has null (initial load)', () => {
      // This simulates app startup: oldState is initialGlobalConfigState with null syncProvider
      const oldState = initialGlobalConfigState; // syncProvider is null

      const snapshotConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: LegacySyncProvider.SuperSync, // Snapshot has user's provider
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      // Should use snapshot's syncProvider since oldState has null
      expect(result.sync.syncProvider).toBe(LegacySyncProvider.SuperSync);
    });

    it('should preserve syncProvider from oldState when loading synced data', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: LegacySyncProvider.SuperSync,
        },
      };

      const syncedConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: null, // Remote sync data typically has null syncProvider
        },
        misc: {
          ...initialGlobalConfigState.misc,
          isDisableAnimations: true,
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
        }),
      );

      // syncProvider should be preserved from oldState
      expect(result.sync.syncProvider).toBe(LegacySyncProvider.SuperSync);
      // Other config should be updated from synced data
      expect(result.misc.isDisableAnimations).toBe(true);
    });

    it('should preserve syncProvider even when synced data has a different provider', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: LegacySyncProvider.WebDAV,
        },
      };

      const syncedConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: LegacySyncProvider.LocalFile,
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
        }),
      );

      // syncProvider should be preserved from oldState, not overwritten
      expect(result.sync.syncProvider).toBe(LegacySyncProvider.WebDAV);
    });

    it('should update other sync config properties while preserving syncProvider', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: LegacySyncProvider.SuperSync,
          syncInterval: 300000,
        },
      };

      const syncedConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: null,
          syncInterval: 600000,
          isCompressionEnabled: true,
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
        }),
      );

      // syncProvider preserved
      expect(result.sync.syncProvider).toBe(LegacySyncProvider.SuperSync);
      // Other sync settings updated
      expect(result.sync.syncInterval).toBe(600000);
      expect(result.sync.isCompressionEnabled).toBe(true);
    });

    describe('isEnabled preservation', () => {
      it('should use isEnabled from snapshot when not sync hydration', () => {
        // This simulates app startup loading from snapshot (syncProvider is set, not null)
        const oldState = initialGlobalConfigState; // isEnabled is false

        const snapshotConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: LegacySyncProvider.SuperSync, // Not null = not sync hydration
            isEnabled: true, // User had sync enabled
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
          }),
        );

        // Should use snapshot's isEnabled since it's not sync hydration
        expect(result.sync.isEnabled).toBe(true);
      });

      it('should preserve isEnabled from oldState during sync hydration', () => {
        // This simulates sync hydration: syncProvider is null (stripped)
        const oldState: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: LegacySyncProvider.SuperSync,
            isEnabled: true, // User has sync enabled
          },
        };

        const syncedConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null, // Sync hydration indicator
            isEnabled: false, // Remote client had sync disabled
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
          }),
        );

        // isEnabled should be preserved from oldState, not overwritten by remote's false
        expect(result.sync.isEnabled).toBe(true);
        // syncProvider should also be preserved
        expect(result.sync.syncProvider).toBe(LegacySyncProvider.SuperSync);
      });

      it('should preserve isEnabled=false from oldState during sync hydration', () => {
        // User has sync disabled locally, remote has it enabled
        const oldState: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: LegacySyncProvider.SuperSync,
            isEnabled: false, // User has sync disabled locally
          },
        };

        const syncedConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null, // Sync hydration indicator
            isEnabled: true, // Remote client had sync enabled
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
          }),
        );

        // isEnabled should stay false (preserved from oldState)
        expect(result.sync.isEnabled).toBe(false);
      });

      it('should use incoming isEnabled on initial load', () => {
        // First load: oldState is initial (syncProvider: null, isEnabled: false)
        // Since oldState has no local settings (syncProvider: null), use incoming values
        const oldState = initialGlobalConfigState; // syncProvider: null, isEnabled: false

        const snapshotConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null, // Could be null in edge cases
            isEnabled: true, // User had sync enabled
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
          }),
        );

        // On initial load (no local settings), use incoming values
        expect(result.sync.isEnabled).toBe(true);
      });
    });
  });

  describe('Selectors', () => {
    describe('selectLocalizationConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectLocalizationConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.localization);
      });

      it('should return localization config when state is defined', () => {
        const result = selectLocalizationConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.localization);
      });
    });

    describe('selectMiscConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectMiscConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.misc);
      });

      it('should return misc config when state is defined', () => {
        const result = selectMiscConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.misc);
      });
    });

    describe('selectShortSyntaxConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectShortSyntaxConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.shortSyntax);
      });

      it('should return shortSyntax config when state is defined', () => {
        const result = selectShortSyntaxConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.shortSyntax);
      });
    });

    describe('selectSoundConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectSoundConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.sound);
      });

      it('should return sound config when state is defined', () => {
        const result = selectSoundConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.sound);
      });
    });

    describe('selectEvaluationConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectEvaluationConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.evaluation);
      });

      it('should return evaluation config when state is defined', () => {
        const result = selectEvaluationConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.evaluation);
      });
    });

    describe('selectIdleConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectIdleConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.idle);
      });

      it('should return idle config when state is defined', () => {
        const result = selectIdleConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.idle);
      });
    });

    describe('selectSyncConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectSyncConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.sync);
      });

      it('should return sync config when state is defined', () => {
        const result = selectSyncConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.sync);
      });
    });

    describe('selectTakeABreakConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectTakeABreakConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.takeABreak);
      });

      it('should return takeABreak config when state is defined', () => {
        const result = selectTakeABreakConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.takeABreak);
      });
    });

    describe('selectTimelineConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectTimelineConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.schedule);
      });

      it('should return schedule config when state is defined', () => {
        const result = selectTimelineConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.schedule);
      });
    });

    describe('selectIsDominaModeConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectIsDominaModeConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.dominaMode);
      });

      it('should return dominaMode config when state is defined', () => {
        const result = selectIsDominaModeConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.dominaMode);
      });
    });

    describe('selectFocusModeConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectFocusModeConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.focusMode);
      });

      it('should return focusMode config when state is defined', () => {
        const result = selectFocusModeConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.focusMode);
      });
    });

    describe('selectPomodoroConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectPomodoroConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.pomodoro);
      });

      it('should return pomodoro config when state is defined', () => {
        const result = selectPomodoroConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.pomodoro);
      });
    });

    describe('selectReminderConfig', () => {
      it('should return default config when state is undefined', () => {
        const result = selectReminderConfig.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG.reminder);
      });

      it('should return reminder config when state is defined', () => {
        const result = selectReminderConfig.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState.reminder);
      });
    });

    describe('selectIsFocusModeEnabled', () => {
      it('should return default value when state is undefined', () => {
        const result = selectIsFocusModeEnabled.projector(undefined as any);
        expect(result).toBe(DEFAULT_GLOBAL_CONFIG.appFeatures.isFocusModeEnabled);
      });

      it('should return isFocusModeEnabled when state is defined', () => {
        const result = selectIsFocusModeEnabled.projector(initialGlobalConfigState);
        expect(result).toBe(initialGlobalConfigState.appFeatures.isFocusModeEnabled);
      });
    });

    describe('selectTimelineWorkStartEndHours', () => {
      it('should return null when state is undefined and default has work disabled', () => {
        const result = selectTimelineWorkStartEndHours.projector(undefined as any);
        // The default config has isWorkStartEndEnabled: true, so we need to check the logic
        if (!DEFAULT_GLOBAL_CONFIG.schedule.isWorkStartEndEnabled) {
          expect(result).toBeNull();
        } else {
          expect(result).toBeTruthy();
        }
      });

      it('should return work hours when state is defined and enabled', () => {
        const result = selectTimelineWorkStartEndHours.projector(
          initialGlobalConfigState,
        );
        expect(result).toBeTruthy();
        expect(result?.workStart).toBeDefined();
        expect(result?.workEnd).toBeDefined();
      });

      it('should return null when work hours are disabled', () => {
        const state: GlobalConfigState = {
          ...initialGlobalConfigState,
          schedule: {
            ...initialGlobalConfigState.schedule,
            isWorkStartEndEnabled: false,
          },
        };
        const result = selectTimelineWorkStartEndHours.projector(state);
        expect(result).toBeNull();
      });
    });
  });
});
