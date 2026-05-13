export interface WebdavPrivateCfg {
  encryptKey?: string;
  baseUrl: string;
  userName: string;
  password: string;
  // Optional access token for Bearer auth (e.g. SuperSync)
  accessToken?: string;
  syncFolderPath?: string;
}
