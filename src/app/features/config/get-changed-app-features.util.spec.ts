import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { getChangedAppFeatures } from './get-changed-app-features.util';
import { NEW_INSTALL_APP_FEATURES } from './new-install-app-features.const';

describe('getChangedAppFeatures', () => {
  it('returns only the switch the user actually changed', () => {
    // A device on the new-install defaults switches Boards on in the settings form.
    const formValue = { ...NEW_INSTALL_APP_FEATURES, isBoardsEnabled: true };
    expect(getChangedAppFeatures(NEW_INSTALL_APP_FEATURES, formValue)).toEqual({
      isBoardsEnabled: true,
    });
  });

  it('returns nothing when nothing changed', () => {
    expect(
      getChangedAppFeatures(DEFAULT_GLOBAL_CONFIG.appFeatures, {
        ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      }),
    ).toEqual({});
  });

  it('ignores keys the form did not send', () => {
    expect(
      getChangedAppFeatures(DEFAULT_GLOBAL_CONFIG.appFeatures, {
        isHabitsEnabled: false,
        isBoardsEnabled: undefined,
      }),
    ).toEqual({ isHabitsEnabled: false });
  });
});
