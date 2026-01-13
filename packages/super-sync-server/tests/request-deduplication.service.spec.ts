import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RequestDeduplicationService } from '../src/sync/services/request-deduplication.service';
import { UploadResult } from '../src/sync/sync.types';

describe('RequestDeduplicationService', () => {
  let service: RequestDeduplicationService;

  const createMockResults = (count: number): UploadResult[] => {
    return Array.from({ length: count }, (_, i) => ({
      opId: `op-${i}`,
      accepted: true,
      serverSeq: i + 1,
    }));
  };

  beforeEach(() => {
    vi.useFakeTimers();
    service = new RequestDeduplicationService();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('checkDeduplication', () => {
    it('should return null for unknown request', () => {
      const result = service.checkDeduplication(1, 'request-123');
      expect(result).toBeNull();
    });

    it('should return cached results for known request', () => {
      const mockResults = createMockResults(2);
      service.cacheResults(1, 'request-123', mockResults);

      const result = service.checkDeduplication(1, 'request-123');
      expect(result).toEqual(mockResults);
    });

    it('should return null for expired request', () => {
      const mockResults = createMockResults(1);
      service.cacheResults(1, 'request-123', mockResults);

      // Advance past TTL (5 minutes)
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const result = service.checkDeduplication(1, 'request-123');
      expect(result).toBeNull();
    });

    it('should handle different users with same requestId', () => {
      const results1 = createMockResults(1);
      const results2 = createMockResults(2);

      service.cacheResults(1, 'request-123', results1);
      service.cacheResults(2, 'request-123', results2);

      expect(service.checkDeduplication(1, 'request-123')).toEqual(results1);
      expect(service.checkDeduplication(2, 'request-123')).toEqual(results2);
    });

    it('should clean up entry when checking expired request', () => {
      service.cacheResults(1, 'request-123', createMockResults(1));
      expect(service.getCacheCount()).toBe(1);

      // Advance past TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      service.checkDeduplication(1, 'request-123');
      expect(service.getCacheCount()).toBe(0);
    });
  });

  describe('cacheResults', () => {
    it('should cache results', () => {
      const mockResults = createMockResults(3);
      service.cacheResults(1, 'request-456', mockResults);

      expect(service.getCacheCount()).toBe(1);
      expect(service.checkDeduplication(1, 'request-456')).toEqual(mockResults);
    });

    it('should overwrite existing entry for same key', () => {
      const results1 = createMockResults(1);
      const results2 = createMockResults(2);

      service.cacheResults(1, 'request-123', results1);
      service.cacheResults(1, 'request-123', results2);

      expect(service.getCacheCount()).toBe(1);
      expect(service.checkDeduplication(1, 'request-123')).toEqual(results2);
    });

    it('should handle multiple requests from same user', () => {
      service.cacheResults(1, 'request-1', createMockResults(1));
      service.cacheResults(1, 'request-2', createMockResults(2));
      service.cacheResults(1, 'request-3', createMockResults(3));

      expect(service.getCacheCount()).toBe(3);
    });
  });

  describe('cleanupExpiredEntries', () => {
    it('should remove all expired entries', () => {
      service.cacheResults(1, 'request-1', createMockResults(1));
      service.cacheResults(2, 'request-2', createMockResults(1));
      expect(service.getCacheCount()).toBe(2);

      // Advance past TTL
      vi.advanceTimersByTime(5 * 60 * 1000 + 1);

      const cleaned = service.cleanupExpiredEntries();
      expect(cleaned).toBe(2);
      expect(service.getCacheCount()).toBe(0);
    });

    it('should not remove active entries', () => {
      service.cacheResults(1, 'request-1', createMockResults(1));
      service.cacheResults(2, 'request-2', createMockResults(1));

      const cleaned = service.cleanupExpiredEntries();
      expect(cleaned).toBe(0);
      expect(service.getCacheCount()).toBe(2);
    });

    it('should only remove expired entries', () => {
      service.cacheResults(1, 'request-1', createMockResults(1));

      // Advance halfway through TTL
      vi.advanceTimersByTime(2.5 * 60 * 1000);

      service.cacheResults(2, 'request-2', createMockResults(1));

      // Advance past first entry's TTL but not second's
      vi.advanceTimersByTime(2.5 * 60 * 1000 + 1);

      const cleaned = service.cleanupExpiredEntries();
      expect(cleaned).toBe(1);
      expect(service.getCacheCount()).toBe(1);
      expect(service.checkDeduplication(2, 'request-2')).not.toBeNull();
    });
  });

  describe('cache eviction', () => {
    it('should evict oldest entry when cache is full', () => {
      // Add 100 entries
      for (let i = 0; i < 100; i++) {
        service.cacheResults(i, `request-${i}`, createMockResults(1));
      }
      expect(service.getCacheCount()).toBe(100);

      // All entries should be retrievable
      for (let i = 0; i < 100; i++) {
        expect(service.checkDeduplication(i, `request-${i}`)).not.toBeNull();
      }
    });
  });
});
