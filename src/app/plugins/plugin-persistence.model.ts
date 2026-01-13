/**
 * Maximum size of plugin data in bytes (1 MB).
 * This prevents malicious or broken plugins from flooding storage with large data.
 */
export const MAX_PLUGIN_DATA_SIZE = 1024 * 1024; // 1 MB

/**
 * Minimum interval between plugin data persist calls in milliseconds.
 * This rate-limits how often a plugin can call persistDataSynced to prevent
 * flooding the operation log and sync server.
 */
export const MIN_PLUGIN_PERSIST_INTERVAL_MS = 1000; // 1 second

/**
 * Plugin user data - data that plugins store and retrieve via persistDataSynced/loadSyncedData
 */
export interface PluginUserData {
  id: string;
  data: string;
}

/**
 * Plugin metadata - enabled state and other plugin management info
 */
export interface PluginMetadata {
  id: string;
  isEnabled: boolean;
  nodeExecutionConsent?: boolean;
  // Future metadata can be added here:
  // installDate?: number;
  // lastUsed?: number;
  // version?: string;
}

/**
 * Plugin user data state - array of plugin data entries
 */
export type PluginUserDataState = PluginUserData[];

/**
 * Plugin metadata state - array of plugin metadata entries
 */
export type PluginMetaDataState = PluginMetadata[];

/**
 * Initial states
 */
export const initialPluginUserDataState: PluginUserDataState = [];
export const initialPluginMetaDataState: PluginMetaDataState = [];
