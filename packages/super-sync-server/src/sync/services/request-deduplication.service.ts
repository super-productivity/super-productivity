/**
 * RequestDeduplicationService - Handles request deduplication for uploads
 *
 * Extracted from SyncService for better separation of concerns.
 * This service is stateful (maintains in-memory cache) but has no database dependencies.
 *
 * Purpose: Prevent duplicate processing when clients retry failed uploads.
 * Entries expire after 5 minutes.
 */
import type { UploadResult } from '../sync.types';

/**
 * Maximum entries in deduplication cache to prevent unbounded memory growth.
 * With ~200 bytes per entry, 10000 entries = ~2MB max memory.
 */
const MAX_CACHE_SIZE = 10000;

/**
 * Time-to-live for cached results (5 minutes).
 */
const REQUEST_DEDUP_TTL_MS = 5 * 60 * 1000;

export type RequestDedupNamespace = 'ops' | 'snapshot';

/**
 * Cached response shape for snapshot uploads. Mirrors the JSON body
 * returned to the client by `POST /api/sync/snapshot`.
 */
export interface SnapshotDedupResponse {
  accepted: boolean;
  serverSeq?: number;
  error?: string;
}

/**
 * Discriminated entry type — keeps cache values type-safe per namespace
 * so a snapshot caller can never receive an ops payload (or vice-versa)
 * even if the same `requestId` string is reused across namespaces.
 */
type RequestDeduplicationEntry =
  | { namespace: 'ops'; processedAt: number; results: UploadResult[] }
  | { namespace: 'snapshot'; processedAt: number; results: SnapshotDedupResponse };

type DedupPayload<N extends RequestDedupNamespace> = N extends 'ops'
  ? UploadResult[]
  : SnapshotDedupResponse;

export class RequestDeduplicationService {
  private cache: Map<string, RequestDeduplicationEntry> = new Map();

  /**
   * Check if a request has already been processed for this user + namespace.
   * @returns Cached results if found and not expired, null otherwise.
   */
  checkDeduplication<N extends RequestDedupNamespace>(
    userId: number,
    namespace: N,
    requestId: string,
  ): DedupPayload<N> | null {
    const key = this._key(userId, namespace, requestId);
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() - entry.processedAt > REQUEST_DEDUP_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    // Defensive: keying already isolates namespaces, but verify before casting.
    if (entry.namespace !== namespace) return null;
    return entry.results as DedupPayload<N>;
  }

  /**
   * Cache results for a processed request.
   */
  cacheResults<N extends RequestDedupNamespace>(
    userId: number,
    namespace: N,
    requestId: string,
    results: DedupPayload<N>,
  ): void {
    const key = this._key(userId, namespace, requestId);
    if (this.cache.size >= MAX_CACHE_SIZE) {
      // Evict oldest entry to prevent unbounded growth
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, {
      namespace,
      processedAt: Date.now(),
      results,
    } as RequestDeduplicationEntry);
  }

  /**
   * Remove every cached entry for the given user. Call when the user's data is
   * wiped (account reset / encryption-password change) so cached results from
   * the pre-wipe state cannot be returned for a post-wipe retry.
   */
  clearForUser(userId: number): void {
    const prefix = `${userId}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
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

  private _key(
    userId: number,
    namespace: RequestDedupNamespace,
    requestId: string,
  ): string {
    return `${userId}:${namespace}:${requestId}`;
  }
}
