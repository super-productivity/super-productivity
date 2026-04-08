import { SyncProviderPrivateCfgBase } from '../../../core/types/sync.types';

export interface WebdavPrivateCfg extends SyncProviderPrivateCfgBase {
  baseUrl: string;
  userName: string;
  password: string;
  // Optional access token for Bearer auth (e.g. SuperSync)
  accessToken?: string;
  syncFolderPath?: string;
}
