import { SyncProviderPrivateCfgBase } from '../../../core/types/sync.types';

export interface OneDrivePrivateCfg extends SyncProviderPrivateCfgBase {
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
}

export interface OneDriveTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}
