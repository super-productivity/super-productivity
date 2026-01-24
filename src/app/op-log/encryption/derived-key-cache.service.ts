import { Injectable } from '@angular/core';
import { clearSessionKeyCache, getSessionKeyCacheStats } from './encryption';

/**
 * Angular service wrapper for session-level encryption key caching.
 *
 * PERFORMANCE OPTIMIZATION:
 * Argon2id key derivation is expensive (64MB memory, 3 iterations, 500ms-2000ms on mobile).
 * The underlying cache (in encryption.ts) stores derived keys for the session duration,
 * so subsequent sync operations can reuse the same key without re-deriving.
 *
 * This service provides Angular DI integration for cache management.
 */
@Injectable({
  providedIn: 'root',
})
export class DerivedKeyCacheService {
  /**
   * Clears the session key cache. Call this when:
   * - User changes their encryption password
   * - User logs out or disables encryption
   */
  clearCache(): void {
    clearSessionKeyCache();
  }

  /**
   * Gets statistics about the session key cache (for debugging/monitoring).
   */
  getCacheStats(): { hasEncryptKey: boolean; decryptKeyCount: number } {
    return getSessionKeyCacheStats();
  }
}
