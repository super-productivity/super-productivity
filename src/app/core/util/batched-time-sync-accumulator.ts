import { Log } from '../log';

/**
 * Handles batched accumulation and flushing of time tracking data.
 * Used by TaskService and SimpleCounterService to reduce sync frequency.
 */
export class BatchedTimeSyncAccumulator {
  private _unsyncedDuration = new Map<string, { duration: number; date: string }>();
  private _lastSyncTime = Date.now();

  constructor(
    private readonly _syncIntervalMs: number,
    private readonly _dispatchSync: (id: string, date: string, duration: number) => void,
  ) {}

  /**
   * Accumulates duration for an entity. Flushes old data if date changes.
   */
  accumulate(id: string, duration: number, date: string): void {
    const existing = this._unsyncedDuration.get(id);
    if (existing && existing.date === date) {
      existing.duration += duration;
    } else {
      if (existing && existing.duration > 0) {
        this._dispatchSync(id, existing.date, existing.duration);
      }
      this._unsyncedDuration.set(id, { duration, date });
    }
  }

  /**
   * Returns true if enough time has passed since last sync.
   */
  shouldFlush(): boolean {
    return Date.now() - this._lastSyncTime >= this._syncIntervalMs;
  }

  /**
   * Flushes all accumulated time and resets.
   * Uses defensive approach: clears internal state first to prevent data loss
   * if an exception occurs during dispatch.
   */
  flush(): void {
    // Copy entries and clear state first to ensure we don't lose data on error
    const entries = Array.from(this._unsyncedDuration.entries());
    this._unsyncedDuration.clear();
    this._lastSyncTime = Date.now();

    // Dispatch each entry, catching errors individually
    for (const [id, { duration, date }] of entries) {
      if (duration > 0) {
        try {
          this._dispatchSync(id, date, duration);
        } catch (e) {
          Log.error('[BatchedTimeSyncAccumulator] Error dispatching sync for', id, e);
        }
      }
    }
  }

  /**
   * Flushes a specific entity (e.g., when stopwatch stops).
   */
  flushOne(id: string): void {
    const accumulated = this._unsyncedDuration.get(id);
    // Delete first to ensure cleanup even if dispatch fails
    this._unsyncedDuration.delete(id);

    if (accumulated && accumulated.duration > 0) {
      try {
        this._dispatchSync(id, accumulated.date, accumulated.duration);
      } catch (e) {
        Log.error('[BatchedTimeSyncAccumulator] Error dispatching sync for', id, e);
      }
    }
  }

  /**
   * Clears accumulated data for an entity without dispatching (e.g., when deleted).
   */
  clearOne(id: string): void {
    this._unsyncedDuration.delete(id);
  }

  /**
   * Resets last sync time (call after flushing secondary data).
   */
  resetSyncTime(): void {
    this._lastSyncTime = Date.now();
  }
}
