/**
 * Stable runtime identifier for the LocalFile provider. The string
 * literal keeps the package free of app-level enums while remaining
 * structurally compatible with `SyncProviderId.LocalFile` app-side.
 */
export const PROVIDER_ID_LOCAL_FILE = 'LocalFile' as const;

export interface LocalFileSyncPrivateCfg {
  encryptKey?: string;
  /**
   * Durable per-provider record that the user enabled encryption, kept
   * separately from the key so a silently dropped `encryptKey` stays
   * detectable (GHSA-9544-hjjr-fg8h). Absent on pre-fix configs — read as
   * `isEncryptionEnabled ?? !!encryptKey`.
   */
  isEncryptionEnabled?: boolean;
  /**
   * @deprecated Electron-selected sync folder path, kept only so older
   * persisted configs can still be parsed. Post-#8228 the authoritative
   * sync folder lives main-side (inlined cache backed by `simple-store`
   * inside `electron/local-file-sync.ts`); this field is read once on
   * upgrade so the migration breadcrumb can log "needs re-pick", and is
   * never written from new code paths.
   */
  syncFolderPath?: string;
  /** Android Storage Access Framework folder URI. */
  safFolderUri?: string;
}
