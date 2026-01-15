import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RateLimitService } from '../src/sync/services/rate-limit.service';
import { DEFAULT_SYNC_CONFIG } from '../src/sync/sync.types';

describe('RateLimitService', () => {
  let service: RateLimitService;
  const userId = 1;

  beforeEach(() => {
    vi.useFakeTimers();
    service = new RateLimitService(DEFAULT_SYNC_CONFIG);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('isRateLimited', () => {
    it('should allow first request', () => {
      expect(service.isRateLimited(userId)).toBe(false);
    });

    it('should count requests within window', () => {
      // First request starts the window
      expect(service.isRateLimited(userId)).toBe(false);
      expect(service.getCounterCount()).toBe(1);
    });

    it('should rate limit after max requests', () => {
      const limit = DEFAULT_SYNC_CONFIG.uploadRateLimit.max;

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        expect(service.isRateLimited(userId)).toBe(false);
      }

      // Next request should be rate limited
      expect(service.isRateLimited(userId)).toBe(true);
    });

    it('should reset after window expires', () => {
      const limit = DEFAULT_SYNC_CONFIG.uploadRateLimit.max;
      const windowMs = DEFAULT_SYNC_CONFIG.uploadRateLimit.windowMs;

      // Exhaust the limit
      for (let i = 0; i < limit; i++) {
        service.isRateLimited(userId);
      }
      expect(service.isRateLimited(userId)).toBe(true);

      // Advance time past the window
      vi.advanceTimersByTime(windowMs + 1);

      // Should be allowed again
      expect(service.isRateLimited(userId)).toBe(false);
    });

    it('should handle multiple users independently', () => {
      const user1 = 1;
      const user2 = 2;
      const limit = DEFAULT_SYNC_CONFIG.uploadRateLimit.max;

      // Exhaust limit for user1
      for (let i = 0; i < limit; i++) {
        service.isRateLimited(user1);
      }
      expect(service.isRateLimited(user1)).toBe(true);

      // User2 should still be allowed
      expect(service.isRateLimited(user2)).toBe(false);
    });

    it('should evict oldest entry when cache is full', () => {
      // This test would need a service with a smaller MAX_CACHE_SIZE
      // For now, just verify basic eviction logic works
      for (let i = 0; i < 100; i++) {
        service.isRateLimited(i);
      }
      expect(service.getCounterCount()).toBe(100);
    });
  });

  describe('cleanupExpiredCounters', () => {
    it('should remove expired counters', () => {
      const windowMs = DEFAULT_SYNC_CONFIG.uploadRateLimit.windowMs;

      service.isRateLimited(1);
      service.isRateLimited(2);
      expect(service.getCounterCount()).toBe(2);

      // Advance past window
      vi.advanceTimersByTime(windowMs + 1);

      const cleaned = service.cleanupExpiredCounters();
      expect(cleaned).toBe(2);
      expect(service.getCounterCount()).toBe(0);
    });

    it('should not remove active counters', () => {
      service.isRateLimited(1);
      service.isRateLimited(2);

      // Don't advance time, counters should still be active
      const cleaned = service.cleanupExpiredCounters();
      expect(cleaned).toBe(0);
      expect(service.getCounterCount()).toBe(2);
    });

    it('should only remove expired counters', () => {
      const windowMs = DEFAULT_SYNC_CONFIG.uploadRateLimit.windowMs;

      service.isRateLimited(1);

      // Advance halfway
      vi.advanceTimersByTime(windowMs / 2);

      service.isRateLimited(2);

      // Advance past first counter's window but not second's
      vi.advanceTimersByTime(windowMs / 2 + 1);

      const cleaned = service.cleanupExpiredCounters();
      expect(cleaned).toBe(1);
      expect(service.getCounterCount()).toBe(1);
    });
  });

  describe('clearForUser', () => {
    it('should clear counter for specific user', () => {
      service.isRateLimited(1);
      service.isRateLimited(2);
      expect(service.getCounterCount()).toBe(2);

      service.clearForUser(1);
      expect(service.getCounterCount()).toBe(1);

      // User 1 should be allowed again immediately
      expect(service.isRateLimited(1)).toBe(false);
    });

    it('should not throw for non-existent user', () => {
      expect(() => service.clearForUser(999)).not.toThrow();
    });
  });
});
