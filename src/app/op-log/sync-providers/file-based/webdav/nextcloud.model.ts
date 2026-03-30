import { SyncProviderPrivateCfgBase } from '../../../core/types/sync.types';

export interface NextcloudPrivateCfg extends SyncProviderPrivateCfgBase {
  serverUrl: string;
  userName: string;
  password: string;
  syncFolderPath?: string;
}
