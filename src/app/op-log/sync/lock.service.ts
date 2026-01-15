import { Injectable } from '@angular/core';
import { OpLog } from '../../core/log';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';

/**
 * Provides a cross-tab locking mechanism for critical operations using the Web Locks API.
 * Web Locks API has 97%+ browser support (https://caniuse.com/web-locks).
 *
 * This ensures that only one tab/process modifies shared data at a time,
 * preventing race conditions during sync operations.
 *
 * If Web Locks API is not available, the service provides a single-tab fallback
 * using Promise-based mutual exclusion. This prevents concurrent operations within
 * the same tab but cannot protect against multi-tab scenarios.
 *
 * Electron and Android WebView use the fallback mutex since they are single-instance
 * but still need in-process locking for concurrent code paths.
 */
@Injectable({ providedIn: 'root' })
export class LockService {
  private _hasWarnedAboutMissingLocks = false;

  // Fallback for browsers without Web Locks API - single-tab mutex
  private _fallbackLocks = new Map<string, Promise<void>>();

  async request(lockName: string, callback: () => Promise<void>): Promise<void> {
    // Electron and Android WebView are single-instance (no multi-tab), but still need
    // in-process locking to prevent concurrent code paths (e.g., ImmediateUploadService
    // and main sync running simultaneously). Use fallback mutex for these.
    if (IS_ELECTRON || IS_ANDROID_WEB_VIEW) {
      return this._fallbackRequest(lockName, callback);
    }

    if (!navigator.locks) {
      // Fallback: Use Promise-based mutex for single-tab protection.
      // WARNING: This does NOT protect against multi-tab data corruption!
      if (!this._hasWarnedAboutMissingLocks) {
        OpLog.err(
          '[LockService] Web Locks API not available. Using multiple tabs may cause DATA LOSS. ' +
            'Please upgrade your browser or use only ONE tab at a time.',
        );
        this._hasWarnedAboutMissingLocks = true;
      }
      OpLog.warn(
        '[LockService] Delaying action cause of lock and executing fallback request.',
      );
      return this._fallbackRequest(lockName, callback);
    }
    return navigator.locks.request(lockName, callback);
  }

  /**
   * Single-tab fallback mutex using Promise chaining.
   * Each request waits for the previous one to complete before executing.
   */
  private async _fallbackRequest(
    lockName: string,
    callback: () => Promise<void>,
  ): Promise<void> {
    // Wait for any existing lock to be released
    const existingLock = this._fallbackLocks.get(lockName);

    // Create a new lock that resolves after we're done
    let releaseLock: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this._fallbackLocks.set(lockName, newLock);

    try {
      // Wait for previous lock holder
      if (existingLock) {
        await existingLock;
      }
      // Execute the callback
      await callback();
    } finally {
      // Release the lock
      releaseLock!();
      // Clean up if we're the last one
      if (this._fallbackLocks.get(lockName) === newLock) {
        this._fallbackLocks.delete(lockName);
      }
    }
  }
}
