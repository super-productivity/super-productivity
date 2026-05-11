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
      expect(result.tasks.isNotifyOnTaskDone).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isNotifyOnTaskDone,
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

    it('should normalize startOfNextDayTime with minutes into startOfNextDay hour', () => {
      const snapshotConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        misc: {
          ...initialGlobalConfigState.misc,
          startOfNextDayTime: '02:30',
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.startOfNextDay).toBe(2);
    });

    it('should synthesize startOfNextDayTime for legacy numeric hour values', () => {
      const snapshotConfig: any = {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: {
          ...DEFAULT_GLOBAL_CONFIG.misc,
          startOfNextDay: 4,
          startOfNextDayTime: undefined,
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.startOfNextDayTime).toBe('04:00');
    });

    it('should update other sync config properties while preserving syncProvider', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.SuperSync,
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
      expect(result.sync.syncProvider).toBe(SyncProviderId.SuperSync);
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
            syncProvider: SyncProviderId.SuperSync, // Not null = not sync hydration
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
            syncProvider: SyncProviderId.SuperSync,
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
        expect(result.sync.syncProvider).toBe(SyncProviderId.SuperSync);
      });

      it('should preserve isEnabled=false from oldState during sync hydration', () => {
        // User has sync disabled locally, remote has it enabled
        const oldState: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.SuperSync,
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

    describe('focusMode migration: isSyncSessionWithTracking → autoStartFocusOnPlay', () => {
      // Real persisted JSON never carries `autoStartFocusOnPlay` (it didn't
      // exist pre-rework). Constructing the fixture as an Object.assign so the
      // key is genuinely absent — using `{ autoStartFocusOnPlay: undefined }`
      // would mask the regression this test exists to prevent.
      const legacyFocusMode = (overrides: object): object => {
        const base = { ...initialGlobalConfigState.focusMode } as Record<string, unknown>;
        delete base.autoStartFocusOnPlay;
        return Object.assign(base, overrides);
      };

      it('should backfill autoStartFocusOnPlay=true from legacy isSyncSessionWithTracking=true (real persisted shape)', () => {
        const legacyConfig = {
          ...initialGlobalConfigState,
          focusMode: legacyFocusMode({ isSyncSessionWithTracking: true }),
        };
        // Sanity check: the fixture must NOT carry autoStartFocusOnPlay,
        // otherwise the test wouldn't exercise the regression.
        expect(
          Object.prototype.hasOwnProperty.call(
            legacyConfig.focusMode,
            'autoStartFocusOnPlay',
          ),
        ).toBe(false);

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as unknown as AppDataComplete,
          }),
        );

        expect(result.focusMode.autoStartFocusOnPlay).toBe(true);
        expect('isSyncSessionWithTracking' in (result.focusMode as object)).toBe(false);
      });

      it('should leave autoStartFocusOnPlay=false when legacy isSyncSessionWithTracking=false', () => {
        const legacyConfig = {
          ...initialGlobalConfigState,
          focusMode: legacyFocusMode({ isSyncSessionWithTracking: false }),
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as unknown as AppDataComplete,
          }),
        );

        expect(result.focusMode.autoStartFocusOnPlay).toBe(false);
        expect('isSyncSessionWithTracking' in (result.focusMode as object)).toBe(false);
      });

      it('should not overwrite an explicit autoStartFocusOnPlay value', () => {
        const legacyConfig = {
          ...initialGlobalConfigState,
          focusMode: legacyFocusMode({
            isSyncSessionWithTracking: true,
            autoStartFocusOnPlay: false,
          }),
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as unknown as AppDataComplete,
          }),
        );

        expect(result.focusMode.autoStartFocusOnPlay).toBe(false);
      });

      it('should leave fresh configs (no legacy key) untouched', () => {
        const freshConfig = {
          ...initialGlobalConfigState,
          focusMode: {
            ...initialGlobalConfigState.focusMode,
            autoStartFocusOnPlay: true,
          },
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: freshConfig } as unknown as AppDataComplete,
          }),
        );

        expect(result.focusMode.autoStartFocusOnPlay).toBe(true);
      });

      it('should not be tricked by a polluted prototype carrying isSyncSessionWithTracking', () => {
        // Defensive: `in` on a plain object can match prototype keys. We use
        // hasOwnProperty.call to avoid that — verify here.
        const focusMode: Record<string, unknown> = Object.create({
          isSyncSessionWithTracking: true,
        });
        focusMode.isSkipPreparation = false;

        const legacyConfig = {
          ...initialGlobalConfigState,
          focusMode,
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as unknown as AppDataComplete,
          }),
        );

        // Migration must NOT have backfilled — the prototype key is not "owned".
        expect(result.focusMode.autoStartFocusOnPlay).toBe(false);
      });

      it('should fill missing notification settings with defaults', () => {
        const incomingConfig = {
          ...initialGlobalConfigState,
          focusMode: {
            isSkipPreparation: true,
          },
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: {
              globalConfig: incomingConfig,
            } as unknown as AppDataComplete,
          }),
        );

        expect(result.focusMode.isSkipPreparation).toBe(true);
        expect(result.focusMode.isNotifyOnFocusSessionDone).toBe(
          DEFAULT_GLOBAL_CONFIG.focusMode.isNotifyOnFocusSessionDone,
        );
        expect(result.focusMode.isNotifyOnBreakDone).toBe(
          DEFAULT_GLOBAL_CONFIG.focusMode.isNotifyOnBreakDone,
        );
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
      // Bug #7181: break time was being counted as task work time because the default
      // was false, so currentTask was never unset when a Pomodoro break started.
      it('should default isPauseTrackingDuringBreak to true so break time is not counted', () => {
        expect(DEFAULT_GLOBAL_CONFIG.focusMode.isPauseTrackingDuringBreak).toBe(true);
      });

      it('should default browser notifications to off', () => {
        expect(DEFAULT_GLOBAL_CONFIG.focusMode.isNotifyOnFocusSessionDone).toBe(false);
        expect(DEFAULT_GLOBAL_CONFIG.focusMode.isNotifyOnBreakDone).toBe(false);
        expect(DEFAULT_GLOBAL_CONFIG.tasks.isNotifyOnTaskDone).toBe(false);
      });

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
