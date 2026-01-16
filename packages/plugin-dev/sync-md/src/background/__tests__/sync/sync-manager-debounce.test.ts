import { initSyncManager } from '../../sync/sync-manager';
import { LocalUserCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import { SYNC_DEBOUNCE_MS_MD_TO_SP, SYNC_DEBOUNCE_MS } from '../../config.const';
import { PluginHooks } from '@super-productivity/plugin-api';

// Mock dependencies
jest.mock('../../sync/file-watcher');
jest.mock('../../sync/sp-to-md');
jest.mock('../../sync/md-to-sp');
jest.mock('../../helper/file-utils');
jest.mock('../../sync/verify-sync');
jest.mock('../../../shared/logger', () => ({
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
}));

// Import after mocking
import { spToMd } from '../../sync/sp-to-md';
import { mdToSp } from '../../sync/md-to-sp';
import {
  getFileStats,
  readTasksFile,
  ensureDirectoryExists,
} from '../../helper/file-utils';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';

// Mock PluginAPI with log methods
(global as any).PluginAPI = {
  log: {
    critical: jest.fn(),
    err: jest.fn(),
    error: jest.fn(),
    log: jest.fn(),
    normal: jest.fn(),
    info: jest.fn(),
    verbose: jest.fn(),
    debug: jest.fn(),
    warn: jest.fn(),
  },
  persistDataSynced: jest.fn(),
  loadSyncedData: jest.fn(),
  showSnack: jest.fn(),
};

// Mock console to reduce noise
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('Sync Manager Debounce Behavior', () => {
  const mockConfig: LocalUserCfg = {
    filePath: '/test/tasks.md',
    projectId: 'test-project',
  };

  let mockFileChangeCallback: () => void;
  let mockWindowFocusCallback: (isFocused: boolean) => void;
  const mockSpHooks: Map<string, () => void> = new Map();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockSpHooks.clear();

    // Setup default mock behaviors - return null to skip initial sync
    (getFileStats as jest.Mock).mockResolvedValue(null);
    (readTasksFile as jest.Mock).mockResolvedValue('- [ ] Test task');
    (ensureDirectoryExists as jest.Mock).mockResolvedValue(undefined);
    (spToMd as jest.Mock).mockImplementation(() => {
      // Return a resolved promise
      return Promise.resolve();
    });
    (mdToSp as jest.Mock).mockImplementation(() => {
      // Return a resolved promise with the expected structure
      return Promise.resolve({ header: undefined });
    });
    (verifySyncState as jest.Mock).mockResolvedValue({ isInSync: true, differences: [] });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);

    // Capture the file watcher callback
    (fileWatcher.startFileWatcher as jest.Mock).mockImplementation((_path, callback) => {
      mockFileChangeCallback = callback;
    });

    // Mock PluginAPI
    (global as any).PluginAPI = {
      registerHook: jest.fn((hook, callback) => {
        mockSpHooks.set(hook, callback);
      }),
      onWindowFocusChange: jest.fn((callback) => {
        mockWindowFocusCallback = callback;
      }),
      getTasks: jest.fn().mockResolvedValue([]),
      getAllProjects: jest
        .fn()
        .mockResolvedValue([{ id: 'test-project', title: 'Test Project' }]),
      batchUpdateForProject: jest.fn().mockResolvedValue(undefined),
      showSnack: jest.fn(),
    };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('MD to SP sync debouncing', () => {
    it('should sync immediately when window is focused', async () => {
      // Initialize sync manager - it will create file since getFileStats returns null
      initSyncManager(mockConfig);

      // Let initial sync complete
      await jest.runAllTimersAsync();

      // Clear mocks after initial sync
      jest.clearAllMocks();

      // Window is focused by default
      // Trigger file change
      mockFileChangeCallback();

      // Should sync immediately without waiting
      await jest.runAllTimersAsync();

      expect(mdToSp).toHaveBeenCalledTimes(1);
      expect(mdToSp).toHaveBeenCalledWith('- [ ] Test task', mockConfig.projectId);
    });

    it('should debounce MD to SP sync for 10 seconds when window is not focused', async () => {
      // Initialize sync manager
      initSyncManager(mockConfig);

      // Let initial sync complete
      await jest.runAllTimersAsync();

      // Clear mocks after initial sync
      jest.clearAllMocks();

      // Set window as unfocused
      mockWindowFocusCallback(false);

      // Trigger file change
      mockFileChangeCallback();

      // Verify sync hasn't been called yet
      expect(mdToSp).not.toHaveBeenCalled();

      // Fast forward 5 seconds
      jest.advanceTimersByTime(5000);
      expect(mdToSp).not.toHaveBeenCalled();

      // Fast forward to 10 seconds total
      jest.advanceTimersByTime(5000);

      // Let the timer callback execute
      await jest.runAllTimersAsync();

      // Now sync should be called
      expect(mdToSp).toHaveBeenCalledTimes(1);
      expect(mdToSp).toHaveBeenCalledWith('- [ ] Test task', mockConfig.projectId);
    });

    it('should handle multiple file changes when window is focused', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Window is focused - each file change triggers immediate sync

      // First file change
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      expect(mdToSp).toHaveBeenCalledTimes(1);

      // Second file change
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // Should be called again (not debounced when focused)
      expect(mdToSp).toHaveBeenCalledTimes(2);
    });

    it('should reset debounce timer on multiple file changes when unfocused', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Set window as unfocused
      mockWindowFocusCallback(false);

      // First file change
      mockFileChangeCallback();

      // Fast forward 5 seconds
      jest.advanceTimersByTime(5000);

      // Second file change - should reset timer
      mockFileChangeCallback();

      // Fast forward 5 more seconds (total 10 from first change)
      jest.advanceTimersByTime(5000);

      // Sync should not have been called yet
      expect(mdToSp).not.toHaveBeenCalled();

      // Fast forward 5 more seconds (10 seconds from second change)
      jest.advanceTimersByTime(5000);

      // Run all timers and wait for async operations
      await jest.runAllTimersAsync();

      // Now sync should be called only once
      expect(mdToSp).toHaveBeenCalledTimes(1);
    });

    it('should trigger sync immediately when window gains focus with pending sync', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Window starts focused
      mockWindowFocusCallback(true);

      // Trigger file change
      mockFileChangeCallback();

      // Window loses focus
      mockWindowFocusCallback(false);

      // Fast forward 5 seconds (half of debounce time)
      jest.advanceTimersByTime(5000);
      expect(mdToSp).not.toHaveBeenCalled();

      // Window gains focus - should trigger immediate sync
      mockWindowFocusCallback(true);

      // Let promises resolve
      await jest.runAllTimersAsync();

      // Sync should be called immediately
      expect(mdToSp).toHaveBeenCalledTimes(1);
    });

    it('should not trigger immediate sync when window gains focus without pending sync', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Window starts focused
      mockWindowFocusCallback(true);

      // Window loses focus (no file change)
      mockWindowFocusCallback(false);

      // Window gains focus again
      mockWindowFocusCallback(true);

      // Allow async operations to complete
      await jest.runAllTimersAsync();

      // No sync should be triggered
      expect(mdToSp).not.toHaveBeenCalled();
    });

    it('should not trigger immediate sync if sync already completed', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Set window as unfocused first
      mockWindowFocusCallback(false);

      // Trigger file change while unfocused
      mockFileChangeCallback();

      // Fast forward to complete the sync
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS_MD_TO_SP);

      // Run all timers and wait for async operations
      await jest.runAllTimersAsync();

      expect(mdToSp).toHaveBeenCalledTimes(1);

      // Window gains focus after sync completed
      mockWindowFocusCallback(true);

      await jest.runAllTimersAsync();

      // Should still only have one sync call
      expect(mdToSp).toHaveBeenCalledTimes(1);
    });

    it('should pass correct config to handleMdToSpSync when window gains focus', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Start with window unfocused
      mockWindowFocusCallback(false);

      // Trigger file change while unfocused
      mockFileChangeCallback();

      // Fast forward 5 seconds (half of debounce time)
      jest.advanceTimersByTime(5000);
      expect(mdToSp).not.toHaveBeenCalled();

      // Window gains focus - should trigger immediate sync with correct config
      mockWindowFocusCallback(true);

      // Wait for any pending promises
      await jest.runAllTimersAsync();

      // Sync should be called immediately with the correct config
      expect(mdToSp).toHaveBeenCalledTimes(1);
      expect(mdToSp).toHaveBeenCalledWith('- [ ] Test task', mockConfig.projectId);
    });
  });

  describe('SP to MD sync behavior', () => {
    it('should use short debounce for SP to MD sync', async () => {
      initSyncManager(mockConfig);
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Trigger SP change through hook
      const spChangeHandler = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      expect(spChangeHandler).toBeDefined();

      if (spChangeHandler) {
        spChangeHandler();
      }

      // Fast forward 500ms (SYNC_DEBOUNCE_MS)
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS);

      // Run all timers and wait for async operations
      await jest.runAllTimersAsync();

      // SP to MD sync should be called
      expect(spToMd).toHaveBeenCalledTimes(1);
      expect(spToMd).toHaveBeenCalledWith(mockConfig);
    });
  });
});
