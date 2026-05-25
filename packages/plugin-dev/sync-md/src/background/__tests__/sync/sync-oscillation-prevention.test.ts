import { initSyncManager } from '../../sync/sync-manager';
import { LocalUserCfg } from '../../local-config';
import * as fileWatcher from '../../sync/file-watcher';
import { SP_HOOK_COOLDOWN_MS, SYNC_DEBOUNCE_MS } from '../../config.const';
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
import { getFileStats, readTasksFile } from '../../helper/file-utils';
import { verifySyncState, logSyncVerification } from '../../sync/verify-sync';

// Suppress console noise
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  jest.restoreAllMocks();
});

/**
 * Tests for issue #6021: Sync oscillation prevention.
 *
 * The core problem: MD→SP sync creates tasks → SP hooks fire → SP→MD sync
 * writes file → file watcher detects → MD→SP again → crash from rapid loop.
 */
describe('Sync Oscillation Prevention (#6021)', () => {
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

    // Default mocks: file exists with content
    (getFileStats as jest.Mock).mockResolvedValue({ mtime: new Date() });
    (readTasksFile as jest.Mock).mockResolvedValue(
      '- [ ] <!--parent-1--> Parent Task\n  - [ ] <!--sub-1--> Existing Subtask',
    );
    (spToMd as jest.Mock).mockResolvedValue(undefined);
    (mdToSp as jest.Mock).mockResolvedValue(undefined);
    (verifySyncState as jest.Mock).mockResolvedValue({
      isInSync: true,
      differences: [],
    });
    (logSyncVerification as jest.Mock).mockReturnValue(undefined);

    // Capture file watcher callback
    (fileWatcher.startFileWatcher as jest.Mock).mockImplementation(
      (_path: string, callback: () => void) => {
        mockFileChangeCallback = callback;
      },
    );

    // Mock PluginAPI
    (global as any).PluginAPI = {
      registerHook: jest.fn((hook: string, callback: () => void) => {
        mockSpHooks.set(hook, callback);
      }),
      onWindowFocusChange: jest.fn((cb: (focused: boolean) => void) => {
        mockWindowFocusCallback = cb;
      }),
      getTasks: jest.fn().mockResolvedValue([]),
      getAllProjects: jest
        .fn()
        .mockResolvedValue([{ id: 'test-project', title: 'Test Project' }]),
      batchUpdateForProject: jest.fn().mockResolvedValue(undefined),
      showSnack: jest.fn(),
    };
  });

  // Helper to set up sync manager with focused window (for immediate file change handling)
  const initWithFocus = async (): Promise<void> => {
    initSyncManager(mockConfig);
    // Set window as focused so file changes trigger immediate sync
    if (mockWindowFocusCallback) {
      mockWindowFocusCallback(true);
    }
    await jest.runAllTimersAsync();
  };

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('file watcher lifecycle during MD→SP sync', () => {
    it('should stop file watcher before MD→SP sync and restart after', async () => {
      await initWithFocus();
      jest.clearAllMocks();

      // Trigger file change → MD→SP sync
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // File watcher should have been stopped at the start of MD→SP sync
      expect(fileWatcher.stopFileWatcher).toHaveBeenCalled();

      // File watcher should be restarted after sync completes
      expect(fileWatcher.startFileWatcher).toHaveBeenCalledWith(
        mockConfig.filePath,
        expect.any(Function),
      );

      // stopFileWatcher should be called BEFORE startFileWatcher
      const stopOrder = (fileWatcher.stopFileWatcher as jest.Mock).mock
        .invocationCallOrder[0];
      const startOrder = (fileWatcher.startFileWatcher as jest.Mock).mock
        .invocationCallOrder[0];
      expect(stopOrder).toBeLessThan(startOrder);
    });

    it('should keep file watcher stopped during SP→MD verification sync', async () => {
      await initWithFocus();
      jest.clearAllMocks();

      // Set up verification to find differences AFTER clearing mocks
      (verifySyncState as jest.Mock)
        .mockResolvedValueOnce({
          isInSync: false,
          differences: [{ type: 'missing-in-md' }],
        })
        .mockResolvedValueOnce({ isInSync: true, differences: [] });

      // Trigger file change
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // Both mdToSp and spToMd should be called (SP→MD for verification)
      expect(mdToSp).toHaveBeenCalledTimes(1);
      expect(spToMd).toHaveBeenCalledTimes(1);

      // File watcher should be stopped once (at start) and restarted once (in finally)
      expect(fileWatcher.stopFileWatcher).toHaveBeenCalledTimes(1);
      expect(fileWatcher.startFileWatcher).toHaveBeenCalledTimes(1);
    });

    it('should restart file watcher even if MD→SP sync fails', async () => {
      (mdToSp as jest.Mock).mockRejectedValueOnce(new Error('sync error'));

      await initWithFocus();
      jest.clearAllMocks();

      // Trigger file change
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // File watcher should still be restarted despite error
      expect(fileWatcher.startFileWatcher).toHaveBeenCalledWith(
        mockConfig.filePath,
        expect.any(Function),
      );
    });
  });

  describe('SP hook cooldown after MD→SP sync', () => {
    it('should suppress SP hooks fired immediately after MD→SP sync', async () => {
      await initWithFocus();
      jest.clearAllMocks();

      // Trigger file change → MD→SP sync
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // Clear to track only the SP hook's spToMd call
      (spToMd as jest.Mock).mockClear();

      // Immediately trigger SP hook (simulates ANY_TASK_UPDATE from batch update)
      const spHook = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      expect(spHook).toBeDefined();
      spHook!();

      // Advance past the debounce time
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS + 100);
      await jest.runAllTimersAsync();

      // SP→MD sync should NOT have been called (suppressed by cooldown)
      expect(spToMd).not.toHaveBeenCalled();
    });

    it('should allow SP hooks after cooldown expires', async () => {
      await initWithFocus();
      jest.clearAllMocks();

      // Trigger file change → MD→SP sync
      mockFileChangeCallback();
      await jest.runAllTimersAsync();
      (spToMd as jest.Mock).mockClear();

      // Advance past the cooldown period (2000ms)
      jest.advanceTimersByTime(SP_HOOK_COOLDOWN_MS + 100);

      // Now trigger SP hook - should NOT be suppressed
      const spHook = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      spHook!();

      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS + 100);
      await jest.runAllTimersAsync();

      // SP→MD sync SHOULD be called now (cooldown expired)
      expect(spToMd).toHaveBeenCalledTimes(1);
    });
  });

  describe('debounce timer cancellation', () => {
    it('should prevent SP→MD sync when MD→SP sync runs concurrently', async () => {
      await initWithFocus();

      // Advance past cooldown so SP hooks work
      jest.advanceTimersByTime(SP_HOOK_COOLDOWN_MS + 100);

      // Track calls from this point forward
      const spToMdCallsBefore = (spToMd as jest.Mock).mock.calls.length;
      const mdToSpCallsBefore = (mdToSp as jest.Mock).mock.calls.length;

      // Trigger SP hook (sets up 500ms debounce)
      const spHook = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      spHook!();

      // Immediately trigger file change (before SP debounce fires)
      // MD→SP sync sets the cooldown timestamp, so even if the SP debounce
      // timer fires, the callback's cooldown re-check prevents spToMd
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      const mdToSpNewCalls = (mdToSp as jest.Mock).mock.calls.length - mdToSpCallsBefore;
      const spToMdNewCalls = (spToMd as jest.Mock).mock.calls.length - spToMdCallsBefore;

      // mdToSp should have been called once (from file change)
      expect(mdToSpNewCalls).toBe(1);

      // spToMd should NOT have been called (cooldown prevents execution)
      expect(spToMdNewCalls).toBe(0);
    });
  });

  describe('full scenario: adding subtask from file', () => {
    it('should handle the complete flow without oscillation', async () => {
      // Step 1: Initialize with existing tasks
      (readTasksFile as jest.Mock).mockResolvedValue(
        '- [ ] <!--p1--> Parent\n  - [ ] <!--s1--> Sub1',
      );

      await initWithFocus();
      jest.clearAllMocks();

      // Step 2: User edits file - adds new subtask
      (readTasksFile as jest.Mock).mockResolvedValue(
        '- [ ] <!--p1--> Parent\n  - [ ] <!--s1--> Sub1\n  - [ ] New Sub',
      );

      // Step 3: File watcher detects change → MD→SP sync
      // Verification finds diff (new subtask has no ID in MD) → SP→MD write-back
      (verifySyncState as jest.Mock)
        .mockResolvedValueOnce({
          isInSync: false,
          differences: [{ type: 'missing-in-md', message: 'new sub has no ID' }],
        })
        .mockResolvedValueOnce({ isInSync: true, differences: [] });

      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // mdToSp should be called once (the main sync)
      expect(mdToSp).toHaveBeenCalledTimes(1);

      // spToMd should be called once (verification write-back to assign IDs)
      expect(spToMd).toHaveBeenCalledTimes(1);

      // Step 4: SP hook fires from batch update — should be suppressed
      const spHook = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      (spToMd as jest.Mock).mockClear();
      (mdToSp as jest.Mock).mockClear();

      spHook!();
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS + 100);
      await jest.runAllTimersAsync();

      // No additional sync should happen
      expect(spToMd).not.toHaveBeenCalled();
      expect(mdToSp).not.toHaveBeenCalled();
    });

    it('should recover and allow future syncs after the cooldown', async () => {
      await initWithFocus();
      jest.clearAllMocks();

      // Trigger MD→SP sync
      mockFileChangeCallback();
      await jest.runAllTimersAsync();
      jest.clearAllMocks();

      // Wait for cooldown to expire
      jest.advanceTimersByTime(SP_HOOK_COOLDOWN_MS + 100);

      // Future SP hook should work normally
      const spHook = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      spHook!();
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS + 100);
      await jest.runAllTimersAsync();

      expect(spToMd).toHaveBeenCalledTimes(1);
    });
  });

  describe('initSyncManager state reset', () => {
    it('should reset all internal state when re-initialized', async () => {
      await initWithFocus();

      // Trigger some state changes
      mockFileChangeCallback();
      await jest.runAllTimersAsync();

      // Re-initialize - should have clean state
      jest.clearAllMocks();
      await initWithFocus();

      // SP hooks should work immediately (no stale cooldown)
      jest.advanceTimersByTime(100); // Small advance, within cooldown of old timestamp
      const spHook = mockSpHooks.get(PluginHooks.ANY_TASK_UPDATE);
      spHook!();
      jest.advanceTimersByTime(SYNC_DEBOUNCE_MS + 100);
      await jest.runAllTimersAsync();

      // Should work because initSyncManager reset the cooldown
      expect(spToMd).toHaveBeenCalled();
    });
  });
});
