/**
 * Maximum size of a single plugin-persistence write, in bytes (256 KB).
 *
 * Sized for the realistic upper bound of plugin payloads — a heavy
 * doc-mode TipTap doc is ~30–100 KB, plugin configs are KB-scale,
 * automation rules / AI prompts are KB-scale. 256 KB gives several×
 * headroom while keeping the per-plugin storage growth bounded:
 * a misbehaving plugin with N keyed entries can still hold N × 256 KB,
 * but the per-write surprise is much smaller than the original 1 MB.
 *
 * The pre-Stage-A cap was 1 MB because one blob held every context's
 * data; with the keyed split each context gets its own entry, so the
 * per-write budget can shrink. Legacy migrations skip individual docs
 * that exceed this (see `doc-mode/src/persistence.ts`).
 */
export const MAX_PLUGIN_DATA_SIZE = 256 * 1024; // 256 KB

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
