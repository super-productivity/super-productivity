import { join } from 'path';
import { readdir, unlink } from 'fs/promises';
import { log, warn } from 'electron-log/main';

/**
 * Deletes stale LevelDB LOCK files left in the IndexedDB directory.
 *
 * When Electron (Chromium) exits uncleanly (e.g., session logout with autostart),
 * the LevelDB LOCK files inside the IndexedDB backing stores are sometimes not
 * cleaned up. On the next launch these orphaned files block IndexedDB from opening,
 * producing the "Internal error opening backing store for indexedDB.open" error.
 *
 * This is safe to call because by the time it runs, `requestSingleInstanceLock()`
 * has already ensured we are the only running instance, so no legitimate process
 * can hold those locks.
 *
 * Only runs on Linux, where this startup race condition has been observed.
 *
 * @see https://github.com/electron/electron/issues/18263
 * @see https://github.com/super-productivity/super-productivity/issues/7191
 */
export const clearStaleLevelDbLocks = async (userDataPath: string): Promise<void> => {
  if (process.platform !== 'linux') {
    return;
  }

  const idbDir = join(userDataPath, 'IndexedDB');

  let entries: string[];
  try {
    entries = await readdir(idbDir);
  } catch (e: unknown) {
    // Directory doesn't exist yet (fresh install) — nothing to clean up.
    // Any other error (e.g., EACCES, EPERM) is unexpected and worth logging.
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
      warn(`[clearStaleLevelDbLocks] Could not read IndexedDB directory:`, e);
    }
    return;
  }

  const leveldbDirs = entries.filter((e) => e.endsWith('.leveldb'));

  await Promise.all(
    leveldbDirs.map(async (dir) => {
      const lockPath = join(idbDir, dir, 'LOCK');
      try {
        await unlink(lockPath);
        log(`[clearStaleLevelDbLocks] Removed stale lock: ${lockPath}`);
      } catch (e: unknown) {
        // LOCK file doesn't exist or is already released — this is the normal case
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          warn(`[clearStaleLevelDbLocks] Could not remove ${lockPath}:`, e);
        }
      }
    }),
  );
};
