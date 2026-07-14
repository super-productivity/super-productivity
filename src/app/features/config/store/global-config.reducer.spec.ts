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
import { updateGlobalConfigSection } from './global-config.actions';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { GlobalConfigState } from '../global-config.model';
import { MemoizedSelector } from '@ngrx/store';
import { SyncProviderId } from '../../../op-log/sync-providers/provider.const';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { LOCAL_ONLY_SYNC_KEYS } from '../local-only-sync-settings.util';
import { INBOX_PROJECT } from '../../project/project.const';

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
      expect(result.tasks.isTrayShowCurrent).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isTrayShowCurrent,
      );
      expect(result.tasks.isMarkdownFormattingInNotesEnabled).toBe(
        DEFAULT_GLOBAL_CONFIG.tasks.isMarkdownFormattingInNotesEnabled,
      );
      expect(result.tasks.notesTemplate).toBe(DEFAULT_GLOBAL_CONFIG.tasks.notesTemplate);
    });

    it('should fill missing idle config fields with defaults', () => {
      // Simulate loading config with a partial idle section that lacks the
      // newly added isSuppressIdleDuringFocusMode field (e.g., existing user
      // whose persisted idle config predates this setting).
      const partialIdleConfig = {
        isEnableIdleTimeTracking: true,
        isOnlyOpenIdleWhenCurrentTask: false,
        minIdleTime: 5 * 60 * 1000,
        // isSuppressIdleDuringFocusMode is intentionally absent
      };

      const incomingConfig = {
        ...initialGlobalConfigState,
        idle: partialIdleConfig as any,
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: incomingConfig } as AppDataComplete,
        }),
      );

      // Existing values preserved
      expect(result.idle.isEnableIdleTimeTracking).toBe(true);
      expect(result.idle.minIdleTime).toBe(5 * 60 * 1000);
      // Missing value filled from default (must be false = opt-in)
      expect(result.idle.isSuppressIdleDuringFocusMode).toBe(
        DEFAULT_GLOBAL_CONFIG.idle.isSuppressIdleDuringFocusMode,
      );
    });

    it('should coerce a legacy null defaultProjectId to the Inbox default (#7891)', () => {
      // Older configs stored `null` (the removed "None" default). With the "None"
      // option gone, that value no longer matches a dropdown option, so it must be
      // normalized to the Inbox project on load.
      const incomingConfig = {
        ...initialGlobalConfigState,
        tasks: { ...initialGlobalConfigState.tasks, defaultProjectId: null } as any,
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: incomingConfig } as AppDataComplete,
        }),
      );

      expect(result.tasks.defaultProjectId).toBe(INBOX_PROJECT.id);
    });

    it('should coerce a legacy empty-string defaultProjectId to the Inbox default (#7891)', () => {
      // The removed "None" mat-option used value `''`, so users who explicitly
      // selected it persisted an empty string (not null). It must coerce to Inbox too.
      const incomingConfig = {
        ...initialGlobalConfigState,
        tasks: { ...initialGlobalConfigState.tasks, defaultProjectId: '' } as any,
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: incomingConfig } as AppDataComplete,
        }),
      );

      expect(result.tasks.defaultProjectId).toBe(INBOX_PROJECT.id);
    });

    it('should preserve an explicitly configured defaultProjectId on load', () => {
      const incomingConfig = {
        ...initialGlobalConfigState,
        tasks: {
          ...initialGlobalConfigState.tasks,
          defaultProjectId: 'my-project',
        } as any,
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: incomingConfig } as AppDataComplete,
        }),
      );

      expect(result.tasks.defaultProjectId).toBe('my-project');
    });

    describe('keyboard migration', () => {
      const legacyKeyboardWithoutTaskNotesShortcut = (
        overrides: Record<string, unknown>,
      ): Record<string, unknown> => {
        const keyboard = {
          ...initialGlobalConfigState.keyboard,
          ...overrides,
        } as Record<string, unknown>;
        delete keyboard.taskOpenNotesPanel;
        return keyboard;
      };

      it('should migrate old default addNewNote=N to Alt+N and add taskOpenNotesPanel=N', () => {
        const legacyConfig = {
          ...initialGlobalConfigState,
          keyboard: legacyKeyboardWithoutTaskNotesShortcut({ addNewNote: 'N' }),
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as unknown as AppDataComplete,
          }),
        );

        expect(result.keyboard.addNewNote).toBe('Alt+N');
        expect(result.keyboard.taskOpenNotesPanel).toBe('N');
      });

      it('should migrate old default addNewNote=N when taskOpenNotesPanel is null', () => {
        const legacyConfig = {
          ...initialGlobalConfigState,
          keyboard: {
            ...initialGlobalConfigState.keyboard,
            addNewNote: 'N',
            taskOpenNotesPanel: null,
          },
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as AppDataComplete,
          }),
        );

        expect(result.keyboard.addNewNote).toBe('Alt+N');
        expect(result.keyboard.taskOpenNotesPanel).toBe('N');
      });

      it('should preserve a custom addNewNote shortcut while adding missing keyboard defaults', () => {
        const legacyConfig = {
          ...initialGlobalConfigState,
          keyboard: legacyKeyboardWithoutTaskNotesShortcut({ addNewNote: 'Ctrl+N' }),
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: legacyConfig } as unknown as AppDataComplete,
          }),
        );

        expect(result.keyboard.addNewNote).toBe('Ctrl+N');
        expect(result.keyboard.taskOpenNotesPanel).toBe('N');
      });

      it('should preserve custom note shortcuts when taskOpenNotesPanel already exists', () => {
        const customConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          keyboard: {
            ...initialGlobalConfigState.keyboard,
            addNewNote: 'N',
            taskOpenNotesPanel: 'Alt+Shift+N',
          },
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: customConfig } as AppDataComplete,
          }),
        );

        expect(result.keyboard.addNewNote).toBe('N');
        expect(result.keyboard.taskOpenNotesPanel).toBe('Alt+Shift+N');
      });

      describe('moveToTodaysTasks migration', () => {
        it('should migrate moveToTodaysTasks to taskScheduleToday', () => {
          const legacyConfig = {
            ...initialGlobalConfigState,
            keyboard: {
              ...initialGlobalConfigState.keyboard,
              moveToTodaysTasks: 'Shift+T',
              taskScheduleToday: null,
            },
          };

          const result = globalConfigReducer(
            initialGlobalConfigState,
            loadAllData({
              appDataComplete: {
                globalConfig: legacyConfig,
              } as unknown as AppDataComplete,
            }),
          );

          expect(result.keyboard.taskScheduleToday).toBe('Shift+T');
          expect((result.keyboard as any).moveToTodaysTasks).toBeUndefined();
        });

        it('should NOT re-migrate if taskScheduleToday is already null (manually disabled)', () => {
          const legacyConfigWithBoth = {
            ...initialGlobalConfigState,
            keyboard: {
              ...initialGlobalConfigState.keyboard,
              moveToTodaysTasks: 'Shift+T',
              taskScheduleToday: null,
            },
          };

          // First migration
          const result1 = globalConfigReducer(
            initialGlobalConfigState,
            loadAllData({
              appDataComplete: {
                globalConfig: legacyConfigWithBoth,
              } as unknown as AppDataComplete,
            }),
          );
          expect(result1.keyboard.taskScheduleToday).toBe('Shift+T');
          expect((result1.keyboard as any).moveToTodaysTasks).toBeUndefined();

          // User disables it
          const configWithDisabled = {
            ...result1,
            keyboard: {
              ...result1.keyboard,
              taskScheduleToday: null,
            },
          };

          // Second load (e.g. restart)
          const result2 = globalConfigReducer(
            initialGlobalConfigState,
            loadAllData({
              appDataComplete: {
                globalConfig: configWithDisabled,
              } as unknown as AppDataComplete,
            }),
          );

          expect(result2.keyboard.taskScheduleToday).toBeNull();
        });

        it('should strip moveToTodaysTasks even if no migration is needed', () => {
          const legacyConfig = {
            ...initialGlobalConfigState,
            keyboard: {
              ...initialGlobalConfigState.keyboard,
              moveToTodaysTasks: 'Shift+T',
              taskScheduleToday: 'Ctrl+T',
            },
          };

          const result = globalConfigReducer(
            initialGlobalConfigState,
            loadAllData({
              appDataComplete: {
                globalConfig: legacyConfig,
              } as unknown as AppDataComplete,
            }),
          );

          expect(result.keyboard.taskScheduleToday).toBe('Ctrl+T');
          expect((result.keyboard as any).moveToTodaysTasks).toBeUndefined();
        });
      });
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

    it('should repair invalid startOfNextDayTime to the default day boundary', () => {
      const snapshotConfig: any = {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: {
          ...DEFAULT_GLOBAL_CONFIG.misc,
          startOfNextDay: 0,
          startOfNextDayTime: '24:00',
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.startOfNextDay).toBe(0);
      expect(result.misc.startOfNextDayTime).toBe('00:00');
    });

    it('should repair invalid startOfNextDayTime with a valid legacy fallback', () => {
      const snapshotConfig: any = {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: {
          ...DEFAULT_GLOBAL_CONFIG.misc,
          startOfNextDay: 4,
          startOfNextDayTime: '24:00',
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.startOfNextDay).toBe(4);
      expect(result.misc.startOfNextDayTime).toBe('04:00');
    });

    it('should repair fully invalid startOfNextDay config to the default day boundary', () => {
      const snapshotConfig: any = {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: {
          ...DEFAULT_GLOBAL_CONFIG.misc,
          startOfNextDay: 111,
          startOfNextDayTime: '111',
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.startOfNextDay).toBe(0);
      expect(result.misc.startOfNextDayTime).toBe('00:00');
    });

    it('should repair invalid legacy numeric startOfNextDay to the default day boundary', () => {
      const snapshotConfig: any = {
        ...DEFAULT_GLOBAL_CONFIG,
        misc: {
          ...DEFAULT_GLOBAL_CONFIG.misc,
          startOfNextDay: 111,
          startOfNextDayTime: undefined,
        },
      };

      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({
          appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
        }),
      );

      expect(result.misc.startOfNextDay).toBe(0);
      expect(result.misc.startOfNextDayTime).toBe('00:00');
    });

    it('should update shared sync config properties while preserving local-only ones', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: SyncProviderId.SuperSync,
          syncInterval: 300000,
          isManualSyncOnly: true,
        },
      };

      const syncedConfig: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          syncProvider: null,
          syncInterval: 600000,
          isManualSyncOnly: false,
          isCompressionEnabled: true,
        },
      };

      const result = globalConfigReducer(
        oldState,
        loadAllData({
          appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
        }),
      );

      // Local-only settings preserved
      expect(result.sync.syncProvider).toBe(SyncProviderId.SuperSync);
      expect(result.sync.syncInterval).toBe(300000);
      expect(result.sync.isManualSyncOnly).toBe(true);
      // Shared sync settings updated
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

    describe('local-only sync schedule settings preservation', () => {
      it('should use sync schedule settings from snapshot on initial load', () => {
        const snapshotConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.WebDAV,
            syncInterval: 600000,
            isManualSyncOnly: true,
          },
        };

        const result = globalConfigReducer(
          initialGlobalConfigState,
          loadAllData({
            appDataComplete: { globalConfig: snapshotConfig } as AppDataComplete,
          }),
        );

        expect(result.sync.syncInterval).toBe(600000);
        expect(result.sync.isManualSyncOnly).toBe(true);
      });

      it('should preserve local sync schedule settings during sync hydration', () => {
        const oldState: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.WebDAV,
            syncInterval: 300000,
            isManualSyncOnly: true,
          },
        };

        const syncedConfig: GlobalConfigState = {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: null,
            syncInterval: 600000,
            isManualSyncOnly: false,
          },
        };

        const result = globalConfigReducer(
          oldState,
          loadAllData({
            appDataComplete: { globalConfig: syncedConfig } as AppDataComplete,
          }),
        );

        expect(result.sync.syncInterval).toBe(300000);
        expect(result.sync.isManualSyncOnly).toBe(true);
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
    });
  });

  describe('updateGlobalConfigSection action', () => {
    it('should update sync schedule settings for local actions', () => {
      const result = globalConfigReducer(
        initialGlobalConfigState,
        updateGlobalConfigSection({
          sectionKey: 'sync',
          sectionCfg: {
            syncInterval: 600000,
            isManualSyncOnly: true,
          },
        }),
      );

      expect(result.sync.syncInterval).toBe(600000);
      expect(result.sync.isManualSyncOnly).toBe(true);
    });

    it('should preserve local-only sync settings for remote sync section updates', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          isEnabled: true,
          syncProvider: SyncProviderId.WebDAV,
          isEncryptionEnabled: true,
          syncInterval: 300000,
          isManualSyncOnly: true,
          isCompressionEnabled: false,
        },
      };
      const remoteAction = updateGlobalConfigSection({
        sectionKey: 'sync',
        sectionCfg: {
          isEnabled: false,
          syncProvider: SyncProviderId.LocalFile,
          isEncryptionEnabled: false,
          syncInterval: 600000,
          isManualSyncOnly: false,
          isCompressionEnabled: true,
        },
      });
      const remoteReplayAction = {
        ...remoteAction,
        meta: {
          ...remoteAction.meta,
          isRemote: true,
          isApplyingFromOtherClient: true,
        },
      };

      const result = globalConfigReducer(oldState, remoteReplayAction);

      expect(result.sync.isEnabled).toBe(true);
      expect(result.sync.syncProvider).toBe(SyncProviderId.WebDAV);
      expect(result.sync.isEncryptionEnabled).toBe(true);
      expect(result.sync.syncInterval).toBe(300000);
      expect(result.sync.isManualSyncOnly).toBe(true);
      expect(result.sync.isCompressionEnabled).toBe(true);
    });

    // Round-trip pin (issue #8233): iterates LOCAL_ONLY_SYNC_KEYS so adding a
    // new local-only key grows coverage here automatically.
    it('preserves every LOCAL_ONLY_SYNC_KEYS value on remote section updates (round-trip)', () => {
      const localSync = {
        ...initialGlobalConfigState.sync,
        isEnabled: true,
        isEncryptionEnabled: true,
        syncProvider: SyncProviderId.WebDAV,
        syncInterval: 300000,
        isManualSyncOnly: true,
      };
      const remoteSync = {
        isEnabled: false,
        isEncryptionEnabled: false,
        syncProvider: SyncProviderId.Dropbox,
        syncInterval: 60000,
        isManualSyncOnly: false,
      };
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: localSync,
      };
      const remoteAction = updateGlobalConfigSection({
        sectionKey: 'sync',
        sectionCfg: remoteSync,
      });
      const remoteReplayAction = {
        ...remoteAction,
        meta: {
          ...remoteAction.meta,
          isRemote: true,
          isApplyingFromOtherClient: true,
        },
      };

      const result = globalConfigReducer(oldState, remoteReplayAction);

      for (const key of LOCAL_ONLY_SYNC_KEYS) {
        expect(result.sync[key])
          .withContext(`sync.${key} must survive remote section update`)
          .toBe(localSync[key]);
      }
    });

    // Regression (scheduled e2e #8077): replaying the device's OWN sync-setup op
    // during hydration is stamped isRemote (to prevent re-logging) but is NOT a
    // foreign update. If the crash snapshot predates the setup op, local
    // state.sync.syncProvider is still null at replay time. Keying the local-only
    // preservation off isRemote (the #8077 bug) overwrote the op's real provider
    // with null and silently disabled sync. The bulk meta-reducer sets
    // isApplyingFromOtherClient ONLY for ops authored by a DIFFERENT client, so
    // own-op replay (isRemote without that flag) must apply the op faithfully.
    it('applies own-op replay faithfully when isRemote is set without isApplyingFromOtherClient', () => {
      const oldState: GlobalConfigState = {
        ...initialGlobalConfigState,
        sync: {
          ...initialGlobalConfigState.sync,
          // Mid-hydration: snapshot predates the setup op → provider not set yet.
          syncProvider: null,
          isEnabled: false,
          isEncryptionEnabled: false,
        },
      };
      const ownSetupAction = updateGlobalConfigSection({
        sectionKey: 'sync',
        sectionCfg: {
          isEnabled: true,
          syncProvider: SyncProviderId.WebDAV,
          isEncryptionEnabled: true,
          syncInterval: 300000,
          isManualSyncOnly: true,
        },
      });
      const ownReplayAction = {
        ...ownSetupAction,
        meta: { ...ownSetupAction.meta, isRemote: true },
      };

      const result = globalConfigReducer(oldState, ownReplayAction);

      // The op's own values win — sync is NOT silently disabled.
      expect(result.sync.syncProvider).toBe(SyncProviderId.WebDAV);
      expect(result.sync.isEnabled).toBe(true);
      expect(result.sync.isEncryptionEnabled).toBe(true);
      expect(result.sync.syncInterval).toBe(300000);
      expect(result.sync.isManualSyncOnly).toBe(true);
    });

    it('should update shared sync settings for remote sync section updates', () => {
      const remoteAction = updateGlobalConfigSection({
        sectionKey: 'sync',
        sectionCfg: {
          isCompressionEnabled: true,
        },
      });
      const remoteReplayAction = {
        ...remoteAction,
        meta: {
          ...remoteAction.meta,
          isRemote: true,
          isApplyingFromOtherClient: true,
        },
      };

      const result = globalConfigReducer(
        {
          ...initialGlobalConfigState,
          sync: {
            ...initialGlobalConfigState.sync,
            syncProvider: SyncProviderId.WebDAV,
          },
        },
        remoteReplayAction,
      );

      expect(result.sync.isCompressionEnabled).toBe(true);
    });
  });

  describe('default misc config (#7891)', () => {
    it('should NOT persist a default isUseCustomWindowTitleBar', () => {
      // Guard: a concrete default here would be pushed to Electron on every launch
      // and override a legacy `isUseObsidianStyleHeader` choice. The checkbox
      // default is seeded display-only in misc-settings-form.const.ts. Do not
      // "fix" the checkbox by adding a value here (see #7891).
      expect(DEFAULT_GLOBAL_CONFIG.misc.isUseCustomWindowTitleBar).toBeUndefined();
    });
  });

  describe('Selectors', () => {
    // Shared contract of every `createConfigSectionSelector` output: falls back to
    // the baked-in default when state is undefined, otherwise passes the slice
    // through unchanged. Keeps the per-selector blocks below to only what's
    // beyond that shared contract (e.g. selectFocusModeConfig's extra regression).
    const itBehavesLikeConfigSectionSelector = <K extends keyof GlobalConfigState>(
      selector: MemoizedSelector<object, GlobalConfigState[K]>,
      key: K,
    ): void => {
      it('should return default config when state is undefined', () => {
        const result = selector.projector(undefined as any);
        expect(result).toEqual(DEFAULT_GLOBAL_CONFIG[key]);
      });

      it(`should return ${key} config when state is defined`, () => {
        const result = selector.projector(initialGlobalConfigState);
        expect(result).toEqual(initialGlobalConfigState[key]);
      });
    };

    describe('selectLocalizationConfig', () => {
      itBehavesLikeConfigSectionSelector(selectLocalizationConfig, 'localization');
    });

    describe('selectMiscConfig', () => {
      itBehavesLikeConfigSectionSelector(selectMiscConfig, 'misc');
    });

    describe('selectShortSyntaxConfig', () => {
      itBehavesLikeConfigSectionSelector(selectShortSyntaxConfig, 'shortSyntax');
    });

    describe('selectSoundConfig', () => {
      itBehavesLikeConfigSectionSelector(selectSoundConfig, 'sound');
    });

    describe('selectEvaluationConfig', () => {
      itBehavesLikeConfigSectionSelector(selectEvaluationConfig, 'evaluation');
    });

    describe('selectIdleConfig', () => {
      itBehavesLikeConfigSectionSelector(selectIdleConfig, 'idle');
    });

    describe('selectSyncConfig', () => {
      itBehavesLikeConfigSectionSelector(selectSyncConfig, 'sync');
    });

    describe('selectTakeABreakConfig', () => {
      itBehavesLikeConfigSectionSelector(selectTakeABreakConfig, 'takeABreak');
    });

    describe('selectTimelineConfig', () => {
      itBehavesLikeConfigSectionSelector(selectTimelineConfig, 'schedule');
    });

    describe('selectIsDominaModeConfig', () => {
      itBehavesLikeConfigSectionSelector(selectIsDominaModeConfig, 'dominaMode');
    });

    describe('selectFocusModeConfig', () => {
      // Bug #7181: break time was being counted as task work time because the default
      // was false, so currentTask was never unset when a Pomodoro break started.
      it('should default isPauseTrackingDuringBreak to true so break time is not counted', () => {
        expect(DEFAULT_GLOBAL_CONFIG.focusMode.isPauseTrackingDuringBreak).toBe(true);
      });

      itBehavesLikeConfigSectionSelector(selectFocusModeConfig, 'focusMode');
    });

    describe('selectPomodoroConfig', () => {
      itBehavesLikeConfigSectionSelector(selectPomodoroConfig, 'pomodoro');
    });

    describe('selectReminderConfig', () => {
      itBehavesLikeConfigSectionSelector(selectReminderConfig, 'reminder');
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
