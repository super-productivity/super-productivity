import { globalConfigReducer, initialGlobalConfigState } from './global-config.reducer';
import { loadAllData } from '../../../root-store/meta/load-all-data.action';
import { AppDataComplete } from '../../../op-log/model/model-config';
import { DEFAULT_GLOBAL_CONFIG } from '../default-global-config.const';
import { appDataValidators } from '../../../op-log/validation/validation-fn';

/**
 * Bug-class guard for the "Failed to load data" root cause (#8965).
 *
 * A required GlobalConfig field (`idle.isSuppressIdleDuringFocusMode`) was added
 * without a heal path, so old persisted configs missing it failed the hydration
 * validation gate and bricked the app to an empty store on every launch. The
 * `loadAllData` reducer heals old/partial configs by merging DEFAULT_GLOBAL_CONFIG;
 * these assertions tie that heal to the REAL GlobalConfigState validator so a
 * future required-field-without-default (or a partial old section) is caught here
 * at CI instead of at users' next launch.
 *
 * NOTE: this spec exercises the real typia validators, which require the
 * compile-time typia transform — run it via the full `npm test`, not the
 * single-file `test:file` runner (which does not apply the transform).
 */
describe('GlobalConfig heal validity (bug-class guard)', () => {
  it('DEFAULT_GLOBAL_CONFIG satisfies the GlobalConfigState validator', () => {
    // DEFAULT_GLOBAL_CONFIG is the heal source the reducer merges into every
    // loaded config. If a newly-required model field has no default here, every
    // reducer-healed config is invalid and hydration fails validation — the
    // #8965 class. This guard fails the moment a required field lacks a default.
    expect(appDataValidators.globalConfig(DEFAULT_GLOBAL_CONFIG).success).toBe(true);
  });

  it('heals a partial old idle config (missing a required field) to a VALIDATING config', () => {
    // Reproduces the exact #8965 shape: an idle section persisted before
    // isSuppressIdleDuringFocusMode existed. After loadAllData the full config
    // must satisfy the validator (not merely have the one field back).
    const partialIdleConfig = {
      isEnableIdleTimeTracking: true,
      isOnlyOpenIdleWhenCurrentTask: false,
      minIdleTime: 5 * 60 * 1000,
      // isSuppressIdleDuringFocusMode intentionally absent
    };

    const result = globalConfigReducer(
      initialGlobalConfigState,
      loadAllData({
        appDataComplete: {
          globalConfig: {
            ...initialGlobalConfigState,
            idle: partialIdleConfig as unknown as (typeof initialGlobalConfigState)['idle'],
          },
        } as AppDataComplete,
      }),
    );

    expect(appDataValidators.globalConfig(result).success).toBe(true);
  });

  it('heals a config with an entirely missing section to a VALIDATING config', () => {
    // A snapshot from before a whole config section existed. The top-level
    // DEFAULT_GLOBAL_CONFIG spread must supply the absent section so the result
    // validates.
    const withoutIdle: Record<string, unknown> = { ...initialGlobalConfigState };
    delete withoutIdle['idle'];

    const result = globalConfigReducer(
      initialGlobalConfigState,
      loadAllData({
        appDataComplete: {
          globalConfig: withoutIdle as unknown as typeof initialGlobalConfigState,
        } as AppDataComplete,
      }),
    );

    expect(appDataValidators.globalConfig(result).success).toBe(true);
  });
});
