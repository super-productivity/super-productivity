export interface OneDrivePrivateCfg {
  encryptKey?: string;
  /**
   * Durable per-provider record that the user enabled encryption, kept
   * separately from the key so a silently dropped `encryptKey` stays
   * detectable (GHSA-9544-hjjr-fg8h). Absent on pre-fix configs — read as
   * `isEncryptionEnabled ?? !!encryptKey`.
   */
  isEncryptionEnabled?: boolean;
  useCustomApp?: boolean;
  clientId: string;
  tenantId: string;
  syncFolderPath?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

export interface OneDriveTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}
