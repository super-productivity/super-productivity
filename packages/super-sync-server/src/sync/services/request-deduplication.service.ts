/**
 * RequestDeduplicationService - Handles request deduplication for uploads
 *
 * Extracted from SyncService for better separation of concerns.
 * This service is stateful (maintains in-memory cache) but has no database dependencies.
 *
 * Purpose: Prevent duplicate processing when clients retry failed uploads.
 * Entries expire after 5 minutes.
 */
import { UploadResult } from '../sync.types';

/**
 * Maximum entries in deduplication cache to prevent unbounded memory growth.
 * With ~200 bytes per entry, 10000 entries = ~2MB max memory.
 */
const MAX_CACHE_SIZE = 10000;

/**
 * Time-to-live for cached results (5 minutes).
 */
const REQUEST_DEDUP_TTL_MS = 5 * 60 * 1000;

interface RequestDeduplicationEntry {
  processedAt: number;
  results: UploadResult[];
}

export class RequestDeduplicationService {
  private cache: Map<string, RequestDeduplicationEntry> = new Map();

  /**
   * Check if a request has already been processed.
   * @returns Cached results if found and not expired, null otherwise
   */
  checkDeduplication(userId: number, requestId: string): UploadResult[] | null {
    const key = `${userId}:${requestId}`;
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.processedAt > REQUEST_DEDUP_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return entry.results;
  }

  /**
   * Cache results for a processed request.
   */
  cacheResults(userId: number, requestId: string, results: UploadResult[]): void {
    const key = `${userId}:${requestId}`;
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry to prevent unbounded growth
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { processedAt: Date.now(), results });
  }

  /**
   * Remove expired entries from memory.
   * Should be called periodically to prevent stale entries.
   * @returns Number of entries cleaned up
   */
  cleanupExpiredEntries(): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now - entry.processedAt > REQUEST_DEDUP_TTL_MS) {
        this.cache.delete(key);
        cleaned++;
      }
    }
    return cleaned;
  }

  /**
   * Get current cache count for testing/debugging.
   * @internal
   */
  getCacheCount(): number {
    return this.cache.size;
  }
}
