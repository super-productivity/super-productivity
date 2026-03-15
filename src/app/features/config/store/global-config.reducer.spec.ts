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
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { updateGlobalConfigSection } from './global-config.actions';
import { OpType } from '../../../op-log/core/operation.types';

describe('GlobalConfigReducer', () => {
  describe('updateGlobalConfigSection action', () => {
    it('should apply local sync config updates', () => {
      const result = globalConfigReducer(
        initialGlobalConfigState,
        updateGlobalConfigSection({
          sectionKey: 'sync',
          sectionCfg: { syncInterval: 999 },
        }),
      );

      expect(result.sync.syncInterval).toBe(999);
    });

    it('should ignore remote sync config updates', () => {
      const state: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.WebDAV,
          syncInterval: 300,
        },
      };

      const action = {
        ...updateGlobalConfigSection({
          sectionKey: 'sync',
          sectionCfg: { syncInterval: 999 },
        }),
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG' as const,
          entityId: 'sync',
          opType: OpType.Update,
          isRemote: true,
        },
      };

      const result = globalConfigReducer(state, action);

      // Remote sync config should be ignored — local value preserved
      expect(result.sync.syncInterval).toBe(300);
      expect(result).toBe(state);
    });

    it('should apply remote non-sync config updates normally', () => {
      const action = {
        ...updateGlobalConfigSection({
          sectionKey: 'misc',
          sectionCfg: { isDisableAnimations: true },
        }),
        meta: {
          isPersistent: true,
          entityType: 'GLOBAL_CONFIG' as const,
          entityId: 'misc',
          opType: OpType.Update,
          isRemote: true,
        },
      };

      const result = globalConfigReducer(initialGlobalConfigState, action);

      expect(result.misc.isDisableAnimations).toBe(true);
    });
  });

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

    it('should fill missing tasks config fields with defaults', () => {
      // Simulate loading config with missing tasks fields (e.g., from older app version)
      const partialTasksConfig = {
        isConfirmBeforeDelete: true,
        // Missing: isAutoMarkParentAsDone, isAutoAddWorkedOnToToday, etc.
      };

      const incomingConfig = {
        ...initialGlobalConfigState,
        tasks: partialTasksConfig as any,
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: incomingConfig } as AppDataComplete,
        }),
      );

      // Existing value preserved
      expect(result.tasks.isConfirmBeforeDelete).toBe(true);
      // Missing values filled from defaults
      expect(result.tasks.isAutoMarkParentAsDone).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isAutoMarkParentAsDone,
      );
      expect(result.tasks.isAutoAddWorkedOnToToday).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isAutoAddWorkedOnToToday,
      );
      expect(result.tasks.isTrayShowCurrent).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isTrayShowCurrent,
      );
      expect(result.tasks.isMarkdownFormattingInNotesEnabled).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isMarkdownFormattingInNotesEnabled,
      );
      expect(result.tasks.notesTemplate).toBe(DEFAULT_GLOBAL_CONFIG.tasks.notesTemplate);
    });

    it('should use syncProvider from snapshot when oldState has null (initial load)', () => {
      // This simulates app startup: oldState is initialGlobalConfigState with null syncProvider
      const oldState = initialGlobalConfigState; // syncProvider is null

      const snapshotConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.SuperSync, // Snapshot has user's provider
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      // Should use snapshot's syncProvider since oldState has null
      expect(result.sync.syncProvider).toBe(SyncProviderId.SuperSync);
    });

    it('should preserve syncProvider from oldState when loading synced data', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.SuperSync,
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
      expect(result.sync.syncProvider).toBe(SyncProviderId.SuperSync);
      // Other config should be updated from synced data
      expect(result.misc.isDisableAnimations).toBe(true);
    });

    it('should preserve syncProvider even when synced data has a different provider', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.WebDAV,
        },
      };

      const syncedConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.LocalFile,
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
        }),
      );

      // syncProvider should be preserved from oldState, not overwritten
      expect(result.sync.syncProvider).toBe(SyncProviderId.WebDAV);
    });

    it('should preserve entire sync config from oldState when it has local settings', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.SuperSync,
          syncInterval: 300000,
          isCompressionEnabled: false,
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

      // Entire sync config preserved from oldState
      expect(result.sync).toEqual(oldState.sync);
    });

    describe('sync config preservation', () => {
      it('should use sync from snapshot on initial load (no local settings)', () => {
        // App startup: oldState is initialGlobalConfigState with null syncProvider
        const oldState = initialGlobalConfigState; // syncProvider is null

        const snapshotConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.SuperSync,
            isEnabled: true,
            syncInterval: 600000,
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
          }),
        );

        // Should use snapshot's sync since oldState has no local settings
        expect(result.sync).toEqual(snapshotConfig.sync);
      });

      it('should preserve entire sync from oldState during sync hydration', () => {
        // Sync hydration: oldState has local settings, synced data arrives
        const oldState: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.SuperSync,
            isEnabled: true,
            syncInterval: 300000,
            isCompressionEnabled: false,
          },
        };

        const syncedConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null,
            isEnabled: false,
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

        // Entire sync config should be preserved from oldState
        expect(result.sync).toEqual(oldState.sync);
      });

      it('should preserve sync with isEnabled=false from oldState during sync hydration', () => {
        // User has sync disabled locally, remote has it enabled
        const oldState: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.SuperSync,
            isEnabled: false,
          },
        };

        const syncedConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null,
            isEnabled: true,
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
          }),
        );

        // Entire sync config preserved from oldState (isEnabled stays false)
        expect(result.sync).toEqual(oldState.sync);
      });

      it('should use incoming sync on initial load when both have null syncProvider', () => {
        // First load: oldState is initial (syncProvider: null)
        // Since oldState has no local settings (syncProvider: null), use incoming values
        const oldState = initialGlobalConfigState; // syncProvider: null

        const snapshotConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null,
            isEnabled: true,
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
          }),
        );

        // On initial load (no local settings), use incoming values
        expect(result.sync).toEqual(snapshotConfig.sync);
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
