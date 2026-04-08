import { FILE_WATCH_POLL_INTERVAL_MS } from '../config.const';
import { lazySetInterval } from '../helper/lazy-set-interval';

interface NodeScriptResult {
  success: boolean;
  mtime?: string | null;
  error?: string;
}

let clearIntervalFn: (() => void) | null = null;
let lastMtime: Date | null = null;

export const startFileWatcher = (filePath: string, onChange: () => void): void => {
  stopFileWatcher();

  if (!PluginAPI.executeNodeScript) {
    console.warn('File watching is only available in the desktop version');
    return;
  }

  // Track whether initial mtime has been resolved to avoid
  // race conditions between the initial fetch and the first poll
  let initialMtimeResolved = false;

  // Get initial mtime
  getFileMtime(filePath)
    .then((mtime) => {
      lastMtime = mtime;
      initialMtimeResolved = true;
    })
    .catch(() => {
      lastMtime = null;
      initialMtimeResolved = true;
    });

  // Poll for changes
  clearIntervalFn = lazySetInterval(async () => {
    // Skip polling until the initial mtime has been resolved
    if (!initialMtimeResolved) {
      return;
    }

    try {
      const currentMtime = await getFileMtime(filePath);
      if (lastMtime && currentMtime && currentMtime.getTime() !== lastMtime.getTime()) {
        lastMtime = currentMtime;
        onChange();
      } else if (!lastMtime && currentMtime) {
        lastMtime = currentMtime;
      }
    } catch (error) {
      // File might have been deleted
      lastMtime = null;
    }
  }, FILE_WATCH_POLL_INTERVAL_MS);
};

export const stopFileWatcher = (): void => {
  if (clearIntervalFn) {
    clearIntervalFn();
    clearIntervalFn = null;
  }
  lastMtime = null;
};

const getFileMtime = async (filePath: string): Promise<Date | null> => {
  const result = await PluginAPI.executeNodeScript!({
    script: `
      const fs = require('fs');
      const path = require('path');

      try {
        const absolutePath = path.resolve(args[0]);
        const stats = fs.statSync(absolutePath);
        return { success: true, mtime: stats.mtime.toISOString() };
      } catch (error) {
        if (error.code === 'ENOENT') {
          return { success: true, mtime: null };
        }
        return { success: false, error: error.message };
      }
    `,
    args: [filePath],
    timeout: 5000,
  });

  const nodeResult = result.result as NodeScriptResult;
  if (!result.success || !nodeResult?.success) {
    // TODO fix typing
    throw new Error(nodeResult?.error || result.error || 'Failed to get file stats');
  }

  return nodeResult.mtime ? new Date(nodeResult.mtime) : null;
};
