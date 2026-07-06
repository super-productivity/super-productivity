export interface NextcloudPrivateCfg {
  encryptKey?: string;
  /**
   * Durable per-provider record that the user enabled encryption, kept
   * separately from the key so a silently dropped `encryptKey` stays
   * detectable (GHSA-9544-hjjr-fg8h). Absent on pre-fix configs — read as
   * `isEncryptionEnabled ?? !!encryptKey`.
   */
  isEncryptionEnabled?: boolean;
  serverUrl: string;
  /**
   * Optional login identifier used for authentication. Some Nextcloud
   * instances allow email login while the WebDAV files path still uses the
   * account username.
   */
  loginName?: string;
  /** Account username used in /remote.php/dav/files/<userName>/. */
  userName: string;
  password: string;
  syncFolderPath?: string;
}
