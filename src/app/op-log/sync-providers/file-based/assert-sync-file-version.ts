import { SyncDataCorruptedError } from '../../core/errors/sync-errors';

/**
 * Throws unless a decoded sync file has the envelope version this build reads.
 * A higher version is flagged `isRemoteNewer`: that file comes from a newer app
 * and is not corrupt, so callers must not replace it from an older `.bak`
 * (#8764).
 */
export const assertSyncFileVersion = (
  file: { version?: unknown },
  expectedVersion: number,
  filePath: string,
): void => {
  if (file.version === expectedVersion) {
    return;
  }
  const isRemoteNewer =
    typeof file.version === 'number' && file.version > expectedVersion;
  throw new SyncDataCorruptedError(
    `Unsupported version: ${String(file.version)} (expected ${expectedVersion})`,
    filePath,
    isRemoteNewer,
  );
};
