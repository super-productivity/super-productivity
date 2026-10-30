import { LS } from '../../core/persistence/storage-keys.const';
import { loadAllData } from '../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../op-log/model/model-config';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { GlobalConfigState } from './global-config.model';
import {
  getInitialNewInstallSections,
  NEW_INSTALL_APP_FEATURES,
  NEW_INSTALL_CONFIG_SECTIONS,
  NEW_INSTALL_IDLE_CONFIG,
  NEW_INSTALL_TAKE_A_BREAK_CONFIG,
} from './new-install-config.const';
import {
  globalConfigReducer,
  initialGlobalConfigState,
} from './store/global-config.reducer';

const loadStoredConfig = (globalConfig: Partial<GlobalConfigState>): GlobalConfigState =>
  globalConfigReducer(
    initialGlobalConfigState,
    loadAllData({ appDataComplete: { globalConfig } as AppDataComplete }),
  );

describe('NEW_INSTALL_CONFIG_SECTIONS', () => {
  it('starts calm: tasks, planner and time tracking, without the extras', () => {
    expect(NEW_INSTALL_APP_FEATURES).toEqual({
      ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      isTimeTrackingEnabled: true,
      isPlannerEnabled: true,
      isProjectNotesEnabled: true,
      isSearchEnabled: true,
      isSyncIconEnabled: true,
      isDonatePageEnabled: true,
      isSchedulerEnabled: false,
      isScheduleDayPanelEnabled: false,
      isBoardsEnabled: false,
      isHabitsEnabled: false,
      isIssuesPanelEnabled: false,
      isFinishDayEnabled: false,
      isFocusModeEnabled: false,
    });
  });

  it('only opens the idle dialog while a task is tracked', () => {
    expect(NEW_INSTALL_IDLE_CONFIG).toEqual({
      ...DEFAULT_GLOBAL_CONFIG.idle,
      isOnlyOpenIdleWhenCurrentTask: true,
    });
  });

  it('starts with break reminders off', () => {
    expect(NEW_INSTALL_TAKE_A_BREAK_CONFIG).toEqual({
      ...DEFAULT_GLOBAL_CONFIG.takeABreak,
      isTakeABreakEnabled: false,
    });
  });

  it('keeps the full defaults for filling missing keys of existing data', () => {
    // Existing users must not lose features or reminders they never touched.
    expect(Object.values(DEFAULT_GLOBAL_CONFIG.appFeatures).every(Boolean)).toBeTrue();
    expect(DEFAULT_GLOBAL_CONFIG.idle.isOnlyOpenIdleWhenCurrentTask).toBeFalse();
    expect(DEFAULT_GLOBAL_CONFIG.takeABreak.isTakeABreakEnabled).toBeTrue();
  });

  it('is the initial store state outside of E2E runs', () => {
    expect(initialGlobalConfigState.appFeatures).toEqual(NEW_INSTALL_APP_FEATURES);
    expect(initialGlobalConfigState.idle).toEqual(NEW_INSTALL_IDLE_CONFIG);
    expect(initialGlobalConfigState.takeABreak).toEqual(NEW_INSTALL_TAKE_A_BREAK_CONFIG);
  });

  describe('loading stored config', () => {
    it('keeps the new-install sections on a fresh install without stored config', () => {
      const result = globalConfigReducer(
        initialGlobalConfigState,
        loadAllData({ appDataComplete: {} as AppDataComplete }),
      );
      expect(result.idle).toEqual(NEW_INSTALL_IDLE_CONFIG);
      expect(result.takeABreak).toEqual(NEW_INSTALL_TAKE_A_BREAK_CONFIG);
    });

    it('keeps the stored values of an existing install', () => {
      const result = loadStoredConfig({
        ...DEFAULT_GLOBAL_CONFIG,
        idle: { ...DEFAULT_GLOBAL_CONFIG.idle, isOnlyOpenIdleWhenCurrentTask: false },
        takeABreak: { ...DEFAULT_GLOBAL_CONFIG.takeABreak, isTakeABreakEnabled: true },
      });
      expect(result.idle.isOnlyOpenIdleWhenCurrentTask).toBeFalse();
      expect(result.takeABreak.isTakeABreakEnabled).toBeTrue();
    });

    it('fills keys or sections an existing install lacks from the old defaults', () => {
      const { isOnlyOpenIdleWhenCurrentTask, ...idleWithoutKey } =
        DEFAULT_GLOBAL_CONFIG.idle;
      const { takeABreak, ...configWithoutTakeABreak } = DEFAULT_GLOBAL_CONFIG;
      const result = loadStoredConfig({
        ...configWithoutTakeABreak,
        idle: idleWithoutKey as GlobalConfigState['idle'],
      });
      expect(result.idle.isOnlyOpenIdleWhenCurrentTask).toBe(
        isOnlyOpenIdleWhenCurrentTask,
      );
      expect(result.takeABreak).toEqual(takeABreak);
    });
  });

  describe('getInitialNewInstallSections', () => {
    let savedSkipTour: string | null;

    beforeEach(() => {
      savedSkipTour = localStorage.getItem(LS.IS_SKIP_TOUR);
    });

    afterEach(() => {
      if (savedSkipTour === null) {
        localStorage.removeItem(LS.IS_SKIP_TOUR);
      } else {
        localStorage.setItem(LS.IS_SKIP_TOUR, savedSkipTour);
      }
    });

    it('ignores the skip-tour flag outside of Playwright', () => {
      localStorage.setItem(LS.IS_SKIP_TOUR, 'true');
      expect(getInitialNewInstallSections()).toEqual(NEW_INSTALL_CONFIG_SECTIONS);
    });
  });
});
