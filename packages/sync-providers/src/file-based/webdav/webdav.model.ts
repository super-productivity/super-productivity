export interface WebdavPrivateCfg {
  encryptKey?: string;
  /**
   * Durable per-provider record that the user enabled encryption, kept
   * separately from the key so a silently dropped `encryptKey` stays
   * detectable (GHSA-9544-hjjr-fg8h). Absent on pre-fix configs — read as
   * `isEncryptionEnabled ?? !!encryptKey`.
   */
  isEncryptionEnabled?: boolean;
  baseUrl: string;
  userName: string;
  password: string;
  // Optional access token for Bearer auth (e.g. SuperSync)
  accessToken?: string;
  syncFolderPath?: string;
}
