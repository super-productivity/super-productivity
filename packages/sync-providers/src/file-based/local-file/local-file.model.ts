/**
 * Stable runtime identifier for the LocalFile provider. The string
 * literal keeps the package free of app-level enums while remaining
 * structurally compatible with `SyncProviderId.LocalFile` app-side.
 */
export const PROVIDER_ID_LOCAL_FILE = 'LocalFile' as const;

export interface LocalFileSyncPrivateCfg {
  encryptKey?: string;
  /** Electron-selected sync folder path. */
  syncFolderPath?: string;
  /** Android Storage Access Framework folder URI. */
  safFolderUri?: string;
}
