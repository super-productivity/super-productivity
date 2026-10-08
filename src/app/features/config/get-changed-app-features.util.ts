import { AppFeaturesConfig } from './global-config.model';

/**
 * Only the App Features switches whose value differs from the current config.
 *
 * The settings form hands over the whole section. Writing all of it would sync
 * every switch, including ones this device only has from its local new-install
 * defaults, and switch those features off on the user's other devices.
 */
export const getChangedAppFeatures = (
  current: AppFeaturesConfig,
  next: Partial<AppFeaturesConfig>,
): Partial<AppFeaturesConfig> =>
  Object.fromEntries(
    (Object.keys(next) as (keyof AppFeaturesConfig)[])
      .filter((key) => next[key] !== undefined && next[key] !== current[key])
      .map((key) => [key, next[key]]),
  ) as Partial<AppFeaturesConfig>;
