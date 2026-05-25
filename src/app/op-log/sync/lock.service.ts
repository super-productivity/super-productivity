import { Injectable } from '@angular/core';
import { OpLog } from '../../core/log';
import { IS_ELECTRON } from '../../app.constants';
import { IS_ANDROID_WEB_VIEW } from '../../util/is-android-web-view';
import { LockAcquisitionTimeoutError } from '../core/errors/sync-errors';
import { LOCK_ACQUISITION_TIMEOUT_MS } from '../core/operation-log.const';

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
 *
 * All lock acquisitions have a timeout (LOCK_ACQUISITION_TIMEOUT_MS) to prevent
 * infinite hangs if a lock holder crashes or stalls.
 */
@Injectable({ providedIn: 'root' })
export class LockService {
  private _hasWarnedAboutMissingLocks = false;

  // Fallback for browsers without Web Locks API - single-tab mutex
  private _fallbackLocks = new Map<string, Promise<void>>();

  async request(
    lockName: string,
    callback: () => Promise<void>,
    timeoutMs: number = LOCK_ACQUISITION_TIMEOUT_MS,
  ): Promise<void> {
    // Electron and Android WebView are single-instance (no multi-tab), but still need
    // in-process locking to prevent concurrent code paths (e.g., ImmediateUploadService
    // and main sync running simultaneously). Use fallback mutex for these.
    if (IS_ELECTRON || IS_ANDROID_WEB_VIEW) {
      return this._fallbackRequest(lockName, callback, timeoutMs);
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
      return this._fallbackRequest(lockName, callback, timeoutMs);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      await navigator.locks.request(lockName, { signal: controller.signal }, callback);
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new LockAcquisitionTimeoutError(lockName, timeoutMs);
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Single-tab fallback mutex using Promise chaining.
   * Each request waits for the previous one to complete before executing.
   * Includes timeout to prevent infinite waits on stuck locks.
   *
   * On timeout, the lock chain is preserved (releaseLock is NOT called) so that
   * subsequent waiters cannot bypass a stuck lock holder. Each subsequent request
   * will also timeout, which is correct — the lock holder is stuck and nothing
   * should proceed until the app restarts.
   */
  private async _fallbackRequest(
    lockName: string,
    callback: () => Promise<void>,
    timeoutMs: number,
  ): Promise<void> {
    // Wait for any existing lock to be released
    const existingLock = this._fallbackLocks.get(lockName);

    // Create a new lock that resolves after we're done
    let releaseLock: () => void;
    const newLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    this._fallbackLocks.set(lockName, newLock);

    let acquired = false;
    try {
      // Wait for previous lock holder with timeout
      if (existingLock) {
        let timeoutId: ReturnType<typeof setTimeout>;
        await Promise.race([
          existingLock.then(() => clearTimeout(timeoutId)),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new LockAcquisitionTimeoutError(lockName, timeoutMs)),
              timeoutMs,
            );
          }),
        ]);
      }
      acquired = true;
      // Execute the callback
      await callback();
    } finally {
      // Only release the lock if we successfully acquired it.
      // On timeout, leave the chain intact so subsequent waiters cannot
      // bypass the stuck lock holder.
      if (acquired) {
        releaseLock!();
        // Clean up if we're the last one
        if (this._fallbackLocks.get(lockName) === newLock) {
          this._fallbackLocks.delete(lockName);
        }
      }
    }
  }
}
