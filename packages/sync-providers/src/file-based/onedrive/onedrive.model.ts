export interface OneDrivePrivateCfg {
  encryptKey?: string;
  useCustomApp?: boolean;
  clientId: string;
  tenantId: string;
  syncFolderPath?: string;
  accessToken?: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
}

export interface OneDriveItem {
  id: string;
  name: string;
  eTag?: string;
  folder?: Record<string, unknown>;
  file?: Record<string, unknown>;
}

export interface OneDriveListResponse {
  value?: OneDriveItem[];
  // eslint-disable-next-line @typescript-eslint/naming-convention
  '@odata.nextLink'?: string;
}

export interface OneDriveTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}
