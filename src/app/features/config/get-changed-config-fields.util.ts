/**
 * Only the fields of a config section whose value differs from the current config.
 *
 * The settings form hands over the whole section. Writing all of it would sync
 * every field, including ones this device only has from its local new-install
 * defaults (NEW_INSTALL_CONFIG_SECTIONS), and change them on the user's other
 * devices.
 */
export const getChangedConfigFields = <T extends object>(
  current: Partial<T>,
  next: Partial<T>,
): Partial<T> =>
  Object.fromEntries(
    (Object.keys(next) as (keyof T)[])
      .filter((key) => next[key] !== undefined && next[key] !== current[key])
      .map((key) => [key, next[key]]),
  ) as Partial<T>;
