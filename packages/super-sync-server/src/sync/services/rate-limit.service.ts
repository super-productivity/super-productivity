/**
 * RateLimitService - Handles rate limiting for upload requests
 *
 * Extracted from SyncService for better separation of concerns.
 * This service is stateful (maintains in-memory counters) but has no database dependencies.
 */
import { SyncConfig } from '../sync.types';

/**
 * Maximum entries in rate limit cache to prevent unbounded memory growth.
 * With ~200 bytes per entry, 10000 entries = ~2MB max memory.
 */
const MAX_CACHE_SIZE = 10000;

interface RateLimitCounter {
  count: number;
  resetAt: number;
}

export class RateLimitService {
  private rateLimitCounters: Map<number, RateLimitCounter> = new Map();

  constructor(private readonly config: SyncConfig) {}

  /**
   * Check if a user is rate limited.
   * If not rate limited, increments the counter.
   * @returns true if rate limited, false otherwise
   */
  isRateLimited(userId: number): boolean {
    const now = Date.now();
    const counter = this.rateLimitCounters.get(userId);
    const limit = this.config.uploadRateLimit;

    if (!counter || now > counter.resetAt) {
      // Counter expired or doesn't exist, start new window
      if (this.rateLimitCounters.size >= MAX_CACHE_SIZE) {
        // Evict oldest entry to prevent unbounded growth
        const firstKey = this.rateLimitCounters.keys().next().value;
        if (firstKey !== undefined) this.rateLimitCounters.delete(firstKey);
      }
      this.rateLimitCounters.set(userId, { count: 1, resetAt: now + limit.windowMs });
      return false;
    }

    if (counter.count >= limit.max) return true;
    counter.count++;
    return false;
  }

  /**
   * Remove expired rate limit counters from memory.
   * Should be called periodically to prevent stale entries.
   * @returns Number of entries cleaned up
   */
  cleanupExpiredCounters(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [userId, counter] of this.rateLimitCounters) {
      if (now > counter.resetAt) {
        this.rateLimitCounters.delete(userId);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Clear rate limit counter for a specific user.
   * Used when user data is deleted.
   */
  clearForUser(userId: number): void {
    this.rateLimitCounters.delete(userId);
  }

  /**
   * Get current counter count for testing/debugging.
   * @internal
   */
  getCounterCount(): number {
    return this.rateLimitCounters.size;
  }
}
