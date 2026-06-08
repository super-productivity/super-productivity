export interface NextcloudPrivateCfg {
  encryptKey?: string;
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
