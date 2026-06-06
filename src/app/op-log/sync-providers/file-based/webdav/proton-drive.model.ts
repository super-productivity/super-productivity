import { SyncProviderPrivateCfgBase } from '../../../core/types/sync.types';

/**
 * Private config for the Proton Drive provider.
 *
 * Proton Drive has no usable third-party API; we bridge to it via a local
 * `rclone serve webdav` process (Electron main). The user configures the
 * Proton remote once with `rclone config`, so the app only needs the remote
 * name (and optionally an explicit rclone binary path). The WebDAV baseUrl /
 * userName / password are generated at runtime by the rclone bridge and are
 * NOT persisted here.
 */
export interface ProtonDrivePrivateCfg extends SyncProviderPrivateCfgBase {
  /** Name of the rclone remote configured for Proton Drive (e.g. "protondrive"). */
  rcloneRemoteName: string;
  /** Optional explicit path to the rclone executable (falls back to PATH). */
  rcloneBinaryPath?: string;
  /** Folder (relative to the remote root) where sync files are stored. */
  syncFolderPath?: string;
}
