import { LS } from '../../core/persistence/storage-keys.const';
import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import {
  getInitialAppFeatures,
  NEW_INSTALL_APP_FEATURES,
} from './new-install-app-features.const';
import { initialGlobalConfigState } from './store/global-config.reducer';

describe('NEW_INSTALL_APP_FEATURES', () => {
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

  it('keeps filling missing keys of existing data with the full default set', () => {
    // Existing users must not lose features they never touched.
    expect(Object.values(DEFAULT_GLOBAL_CONFIG.appFeatures).every(Boolean)).toBeTrue();
  });

  it('is the initial store state outside of E2E runs', () => {
    expect(initialGlobalConfigState.appFeatures).toEqual(NEW_INSTALL_APP_FEATURES);
  });

  describe('getInitialAppFeatures', () => {
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
      expect(getInitialAppFeatures()).toEqual(NEW_INSTALL_APP_FEATURES);
    });
  });
});
