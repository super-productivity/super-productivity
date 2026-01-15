import { SyncProviderPrivateCfgBase } from '../../../core/types/sync.types';

export interface WebdavServerCapabilities {
  /** Whether the server supports ETag headers for versioning */
  supportsETags: boolean;
  /** Whether the server supports WebDAV If headers (RFC 4918) */
  supportsIfHeader: boolean;
  /** Whether the server supports Last-Modified headers for versioning */
  supportsLastModified: boolean;
}

export interface WebdavPrivateCfg extends SyncProviderPrivateCfgBase {
  baseUrl: string;
  userName: string;
  password: string;
  // Optional access token for Bearer auth (e.g. SuperSync)
  accessToken?: string;
  syncFolderPath?: string;

  /**
   * Server capabilities configuration. If not provided, capabilities will be
   * detected automatically on first use. Providing this configuration can
   * improve performance by skipping detection and ensure consistent behavior.
   *
   * Recommended settings for common servers:
   * - Nextcloud/ownCloud: { supportsETags: true, supportsIfHeader: true, supportsLastModified: true }
   * - Apache mod_dav: { supportsETags: true, supportsIfHeader: false, supportsLastModified: true }
   * - Basic WebDAV: { supportsETags: false, supportsIfHeader: false, supportsLastModified: true }
   */
  serverCapabilities?: WebdavServerCapabilities;

  /**
   * Force the use of Last-Modified headers instead of ETags, even if ETags are available.
   * This can be useful for testing fallback behavior or working with servers that have
   * unreliable ETag implementations.
   */
  preferLastModified?: boolean;

  /**
   * Compatibility mode for servers with limited WebDAV support.
   * When enabled, disables conditional operations and safe creation mechanisms.
   * Use only for very basic WebDAV servers that don't support any conditional headers.
   */
  basicCompatibilityMode?: boolean;

  /**
   * Maximum number of retry attempts for capability detection and fallback operations.
   * Default: 2
   */
  maxRetries?: number;
}

/**
 * Server type enum for common WebDAV implementations
 */
export enum WebdavServerType {
  NEXTCLOUD = 'nextcloud',
  OWNCLOUD = 'owncloud',
  APACHE_MOD_DAV = 'apache_mod_dav',
  NGINX_DAV = 'nginx_dav',
  BASIC_WEBDAV = 'basic_webdav',
  CUSTOM = 'custom',
}
