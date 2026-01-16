import { startFileWatcher, stopFileWatcher } from './file-watcher';
import { spToMd } from './sp-to-md';
import { mdToSp } from './md-to-sp';
import { getFileStats, readTasksFile } from '../helper/file-utils';
import { SYNC_DEBOUNCE_MS, SYNC_DEBOUNCE_MS_MD_TO_SP } from '../config.const';
import { PluginHooks } from '@super-productivity/plugin-api';
import { LocalUserCfg } from '../local-config';
import { logSyncVerification, verifySyncState } from './verify-sync';
import { log } from '../../shared/logger';

let syncInProgress = false;
let mdToSpDebounceTimer: number | null = null;
let spToMdDebounceTimer: number | null = null;
let isWindowFocused = document.hasFocus();
let pendingMdToSpSync: LocalUserCfg | null = null;

export const initSyncManager = (config: LocalUserCfg): void => {
  // Stop any existing file watcher
  stopFileWatcher();

  // Set up window focus tracking
  setupWindowFocusTracking();

  // Perform initial sync
  performInitialSync(config)
    .then(() => log.debug('SyncMD initial sync completed'))
    .catch((error) => log.error('SyncMD initial sync failed', error));

  // Set up file watcher for ongoing sync
  startFileWatcher(config.filePath, () => {
    handleFileChange(config);
  });

  // Set up hooks for SP changes
  setupSpHooks(config);
};

const performInitialSync = async (config: LocalUserCfg): Promise<void> => {
  if (syncInProgress) return;
  syncInProgress = true;

  try {
    const fileStats = await getFileStats(config.filePath);

    // Determine sync direction
    if (!fileStats) {
      await spToMd(config);
    } else {
      const content = await readTasksFile(config.filePath);
      if (content) {
        const projectId = config.projectId;

        try {
          await mdToSp(content, projectId);
        } catch (syncError) {
          console.error('[sync-md] Initial sync failed:', syncError);

          PluginAPI.showSnack({
            msg: 'Sync.md: Initial sync failed. Plugin is still active.',
            type: 'WARNING',
          });

          // Don't throw - allow plugin to continue running
        }
      }
    }

    // Verify sync state after initial sync
    const verificationResult = await verifySyncState(config);
    logSyncVerification(verificationResult, 'initial sync');
  } catch (outerError) {
    console.error('[sync-md] Fatal error in initial sync:', outerError);

    PluginAPI.showSnack({
      msg: 'Sync.md: Plugin started but sync failed. Check console.',
      type: 'ERROR',
    });
  } finally {
    syncInProgress = false;
  }
};

const handleFileChange = (config: LocalUserCfg): void => {
  if (mdToSpDebounceTimer) {
    console.log('[sync-md] Clearing existing MD to SP debounce timer');
    window.clearTimeout(mdToSpDebounceTimer);
  }

  // If window is focused, sync immediately without debounce
  if (isWindowFocused) {
    console.log('[sync-md] file change & window:focused => syncing immediately');
    handleMdToSpSync(config);
    return;
  }

  // Mark that we have a pending MD to SP sync
  pendingMdToSpSync = config;

  // Use 10 second debounce for MD to SP sync when window is not focused
  console.log(
    `[sync-md] file change & window:unfocused => debouncing for ${SYNC_DEBOUNCE_MS_MD_TO_SP}ms (10 seconds)`,
  );

  mdToSpDebounceTimer = window.setTimeout(() => {
    console.log('[sync-md] MD to SP debounce timer fired, executing sync');
    handleMdToSpSync(config);
  }, SYNC_DEBOUNCE_MS_MD_TO_SP);
};

const handleMdToSpSync = async (config: LocalUserCfg): Promise<void> => {
  if (syncInProgress) {
    console.log('[sync-md] MD to SP sync skipped - sync already in progress');
    return;
  }

  console.log('[sync-md] Starting MD to SP sync');
  syncInProgress = true;
  pendingMdToSpSync = null;
  mdToSpDebounceTimer = null;

  try {
    const content = await readTasksFile(config.filePath);
    if (content) {
      const projectId = config.projectId;
      console.log(`[sync-md] Executing mdToSp for project: ${projectId}`);

      try {
        await mdToSp(content, projectId);

        // Show success notification (optional, can be removed if too noisy)
        PluginAPI.showSnack({
          msg: 'Sync.md: Synced successfully',
          type: 'SUCCESS',
        });

        // Verify sync state after file change sync
        const verificationResult = await verifySyncState(config);
        logSyncVerification(verificationResult, 'MD to SP sync (file change)');

        // If there are still differences, trigger SP→MD sync
        if (!verificationResult.isInSync) {
          console.log(
            '[sync-md] MD to SP sync incomplete, triggering SP to MD sync to resolve remaining differences',
          );

          stopFileWatcher();

          try {
            await spToMd(config);

            const finalVerification = await verifySyncState(config);
            logSyncVerification(
              finalVerification,
              'SP to MD sync (resolving differences)',
            );
          } finally {
            startFileWatcher(config.filePath, () => {
              handleFileChange(config);
            });
          }
        }
      } catch (syncError) {
        console.error('[sync-md] Sync failed:', syncError);

        // Error already shown by mdToSp, but add guidance
        PluginAPI.showSnack({
          msg: 'Sync.md: Check markdown file for orphaned subtasks or formatting issues',
          type: 'WARNING',
        });

        // Don't re-throw - keep plugin running
      }
    }
  } catch (fileError) {
    console.error('[sync-md] Failed to read markdown file:', fileError);

    PluginAPI.showSnack({
      msg: `Sync.md: Cannot read file ${config.filePath}. Check permissions.`,
      type: 'ERROR',
    });
  } finally {
    syncInProgress = false;
  }
};

const setupSpHooks = (config: LocalUserCfg): void => {
  // Listen for task changes
  PluginAPI.registerHook(PluginHooks.ANY_TASK_UPDATE, () => {
    handleSpChange(config);
  });
  PluginAPI.registerHook(PluginHooks.PROJECT_LIST_UPDATE, () => {
    handleSpChange(config);
  });
};

const handleSpChange = (config: LocalUserCfg): void => {
  if (spToMdDebounceTimer) {
    window.clearTimeout(spToMdDebounceTimer);
  }

  console.log(
    `[sync-md] SP change detected, debouncing for ${SYNC_DEBOUNCE_MS}ms (0.5 seconds)`,
  );

  // For SP changes, we always use the short debounce since the user is actively using SP
  spToMdDebounceTimer = window.setTimeout(async () => {
    if (syncInProgress) return;
    syncInProgress = true;

    console.log('[sync-md] Starting SP to MD sync (disabling file watcher)');

    // Temporarily disable file watcher to prevent triggering another MD→SP sync
    stopFileWatcher();

    try {
      await spToMd(config);

      // Verify sync state after SP change sync
      const verificationResult = await verifySyncState(config);
      logSyncVerification(verificationResult, 'SP to MD sync (SP change)');
    } finally {
      // Re-enable file watcher
      console.log('[sync-md] SP to MD sync complete, re-enabling file watcher');
      startFileWatcher(config.filePath, () => {
        handleFileChange(config);
      });

      syncInProgress = false;
    }
  }, SYNC_DEBOUNCE_MS);
};

const setupWindowFocusTracking = (): void => {
  // Check if the API is available
  if (!PluginAPI.onWindowFocusChange) {
    console.log('[sync-md] Window focus tracking not available');
    return;
  }

  PluginAPI.onWindowFocusChange((isFocused: boolean) => {
    const wasFocused = isWindowFocused;
    isWindowFocused = isFocused;
    console.log(`[sync-md] Window focus changed: ${isFocused ? 'focused' : 'unfocused'}`);

    // If window gains focus and we have a pending MD to SP sync, trigger it immediately
    if (isFocused && !wasFocused && pendingMdToSpSync && mdToSpDebounceTimer) {
      console.log(
        '[sync-md] Window gained focus, triggering pending MD to SP sync immediately',
      );
      window.clearTimeout(mdToSpDebounceTimer);
      mdToSpDebounceTimer = null;

      // Trigger the sync immediately with the stored config
      const configToSync = pendingMdToSpSync;
      pendingMdToSpSync = null;
      handleMdToSpSync(configToSync);
    } else {
      console.log(
        // eslint-disable-next-line max-len
        `[sync-md] Window focus conditions: focused=${isFocused}, wasFocused=${wasFocused}, pendingSync=${!!pendingMdToSpSync}, timer=${!!mdToSpDebounceTimer}`,
      );
    }
  });
};
