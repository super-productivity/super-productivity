import { DEFAULT_GLOBAL_CONFIG } from './default-global-config.const';
import { getChangedConfigFields } from './get-changed-config-fields.util';
import {
  NEW_INSTALL_APP_FEATURES,
  NEW_INSTALL_IDLE_CONFIG,
} from './new-install-config.const';

describe('getChangedConfigFields', () => {
  it('returns only the switch the user actually changed', () => {
    // A device on the new-install defaults switches Boards on in the settings form.
    const formValue = { ...NEW_INSTALL_APP_FEATURES, isBoardsEnabled: true };
    expect(getChangedConfigFields(NEW_INSTALL_APP_FEATURES, formValue)).toEqual({
      isBoardsEnabled: true,
    });
  });

  it('leaves untouched new-install idle fields out of the write', () => {
    const formValue = { ...NEW_INSTALL_IDLE_CONFIG, minIdleTime: 10 * 60 * 1000 };
    expect(getChangedConfigFields(NEW_INSTALL_IDLE_CONFIG, formValue)).toEqual({
      minIdleTime: 10 * 60 * 1000,
    });
  });

  it('returns nothing when nothing changed', () => {
    expect(
      getChangedConfigFields(DEFAULT_GLOBAL_CONFIG.appFeatures, {
        ...DEFAULT_GLOBAL_CONFIG.appFeatures,
      }),
    ).toEqual({});
  });

  it('ignores keys the form did not send', () => {
    expect(
      getChangedConfigFields(DEFAULT_GLOBAL_CONFIG.appFeatures, {
        isHabitsEnabled: false,
        isBoardsEnabled: undefined,
      }),
    ).toEqual({ isHabitsEnabled: false });
  });
});
