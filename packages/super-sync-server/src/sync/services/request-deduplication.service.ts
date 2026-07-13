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
import type { Operation } from '../sync.types';
import { createHash } from 'node:crypto';
import { stableJsonStringify } from '../conflict';

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
  errorCode?: string;
}

/**
 * Discriminated entry type — keeps cache values type-safe per namespace
 * so a snapshot caller can never receive an ops payload (or vice-versa)
 * even if the same `requestId` string is reused across namespaces.
 */
type RequestDeduplicationEntry =
  | {
      namespace: 'ops';
      processedAt: number;
      results: UploadResult[];
      fingerprint?: string;
    }
  | {
      namespace: 'snapshot';
      processedAt: number;
      results: SnapshotDedupResponse;
      fingerprint?: string;
    };

type DedupPayload<N extends RequestDedupNamespace> = N extends 'ops'
  ? UploadResult[]
  : SnapshotDedupResponse;

export class RequestDeduplicationService {
  private cache: Map<string, RequestDeduplicationEntry> = new Map();

  /**
   * Check if a request has already been processed for this user + namespace.
   *
   * @param getFingerprint lazy fingerprint supplier — hashing the full request
   *   body is expensive (stable stringify + SHA-256 over up to multi-MB
   *   payloads), so it must only run when an entry for this requestId actually
   *   exists (genuine retries are rare) and never for first-time requests.
   * @returns Cached results if found, not expired, and fingerprint-matching;
   *   null otherwise.
   */
  checkDeduplication<N extends RequestDedupNamespace>(
    userId: number,
    namespace: N,
    requestId: string,
    getFingerprint?: () => string,
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
    if (getFingerprint !== undefined) {
      // A pre-fingerprint (legacy) entry cannot prove body equality — treat as
      // a miss so the request is re-processed (safe: the server dedups ops by
      // id anyway).
      if (entry.fingerprint === undefined || entry.fingerprint !== getFingerprint()) {
        return null;
      }
    }
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
    fingerprint?: string,
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
      fingerprint,
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

export const createOpsRequestFingerprint = (
  clientId: string,
  ops: Operation[],
): string => {
  const logicalOps = ops.map((op) => ({
    ...op,
    payload: op.isPayloadEncrypted ? '[encrypted-payload]' : op.payload,
  }));
  return createHash('sha256')
    .update(stableJsonStringify({ clientId, ops: logicalOps }))
    .digest('base64url');
};

export interface SnapshotRequestFingerprintInput {
  state: unknown;
  clientId: string;
  reason: string;
  vectorClock: Record<string, number>;
  schemaVersion?: number;
  isPayloadEncrypted?: boolean;
  syncImportReason?: string;
  opId?: string;
  isCleanSlate?: boolean;
  snapshotOpType?: string;
  repairBaseServerSeq?: number;
}

export const createSnapshotRequestFingerprint = (
  request: SnapshotRequestFingerprintInput,
): string => {
  const logicalRequest = {
    ...request,
    state: request.isPayloadEncrypted ? '[encrypted-state]' : request.state,
  };
  return createHash('sha256')
    .update(stableJsonStringify(logicalRequest))
    .digest('base64url');
};
