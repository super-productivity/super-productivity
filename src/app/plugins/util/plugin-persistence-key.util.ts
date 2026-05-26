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

/**
 * Inverse of {@link composeId} — strip an optional `:key` suffix off a
 * persistence entityId to recover the bare owner pluginId. Plugin hook
 * handlers are registered under the bare pluginId, so any host-side
 * dispatch keyed by entityId must normalize through here first.
 */
export const extractOwnerPluginId = (entityId: string): string => {
  const idx = entityId.indexOf(':');
  return idx === -1 ? entityId : entityId.slice(0, idx);
};

/**
 * Bound on a single plugin's persistence key length. Generous for any
 * realistic per-plugin keyspace (e.g. document-mode uses `doc:<uuid>`,
 * well under 100 chars). Prevents a compromised iframe from passing a
 * multi-megabyte `key` that would be stored verbatim in NgRx state,
 * IndexedDB, the op-log, and on the sync wire — bypassing the
 * MAX_PLUGIN_DATA_SIZE cap which only constrains the `data` arg.
 */
export const MAX_PLUGIN_PERSISTENCE_KEY_LENGTH = 256;

/**
 * Type + length guard for the plugin-supplied `key` arg at the bridge
 * boundary. Throws on non-string or oversized input. `undefined` is the
 * legacy form (no key) and is allowed.
 */
export const assertPluginPersistenceKey = (key: unknown): void => {
  if (key === undefined) return;
  if (typeof key !== 'string') {
    throw new Error('Plugin persistence key must be a string or undefined');
  }
  if (key.length > MAX_PLUGIN_PERSISTENCE_KEY_LENGTH) {
    throw new Error(
      `Plugin persistence key exceeds maximum length of ${MAX_PLUGIN_PERSISTENCE_KEY_LENGTH} characters`,
    );
  }
};
