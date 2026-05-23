/**
 * Compose the storage entity id for a plugin's persisted data.
 *
 * Without a key this returns the bare `pluginId` (the legacy single-blob
 * form). With a key it returns `pluginId + ':' + key`, allowing one plugin
 * to maintain multiple independently-synced entries that LWW-resolve
 * per-entity rather than overwriting each other.
 *
 * - Empty `key` (`''`) is treated as `undefined`; this is intentional
 *   so plugins don't accidentally split their storage by passing falsy
 *   strings.
 * - Throws synchronously if `pluginId` itself contains `:`. Registration-
 *   time validation alone misses user-installed plugins, so the only
 *   reliable guard is at the call site.
 */
export const composeId = (pluginId: string, key?: string): string => {
  if (pluginId.includes(':')) {
    throw new Error(
      `Plugin id "${pluginId}" must not contain ':' — the colon is reserved as the key delimiter for plugin-persistence entries.`,
    );
  }
  if (key === undefined || key === '') {
    return pluginId;
  }
  return `${pluginId}:${key}`;
};

/**
 * Match an entity id against a plugin's full keyspace (legacy entry +
 * any keyed entries). Used by host-side cleanup when uninstalling.
 */
export const isPluginIdMatch = (entityId: string, pluginId: string): boolean =>
  entityId === pluginId || entityId.startsWith(pluginId + ':');
