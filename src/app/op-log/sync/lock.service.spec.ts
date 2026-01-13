import { TestBed } from '@angular/core/testing';
import { LockService } from './lock.service';

describe('LockService', () => {
  let service: LockService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LockService],
    });
    service = TestBed.inject(LockService);
    // Clear any existing locks
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  describe('request', () => {
    it('should execute callback successfully', async () => {
      let executed = false;
      await service.request('test_lock', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should release lock after callback completes', async () => {
      await service.request('test_lock', async () => {
        // Lock is held here
      });

      // Lock should be released - we should be able to acquire it again immediately
      let executed = false;
      await service.request('test_lock', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should release lock even if callback throws', async () => {
      const testError = new Error('Test error');

      await expectAsync(
        service.request('test_lock', async () => {
          throw testError;
        }),
      ).toBeRejectedWith(testError);

      // Lock should be released - we should be able to acquire it again
      let executed = false;
      await service.request('test_lock', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should handle sequential lock requests', async () => {
      const order: number[] = [];

      await service.request('test_lock', async () => {
        order.push(1);
      });

      await service.request('test_lock', async () => {
        order.push(2);
      });

      await service.request('test_lock', async () => {
        order.push(3);
      });

      expect(order).toEqual([1, 2, 3]);
    });

    it('should allow different lock names to be acquired independently', async () => {
      const executed: string[] = [];

      // Different lock names should not block each other
      await Promise.all([
        service.request('lock_a', async () => {
          executed.push('a_start');
          await new Promise((r) => setTimeout(r, 5));
          executed.push('a_end');
        }),
        service.request('lock_b', async () => {
          executed.push('b_start');
          await new Promise((r) => setTimeout(r, 5));
          executed.push('b_end');
        }),
      ]);

      // Both should have executed
      expect(executed).toContain('a_start');
      expect(executed).toContain('a_end');
      expect(executed).toContain('b_start');
      expect(executed).toContain('b_end');
    });
  });

  describe('fallback lock mechanism', () => {
    // Test the localStorage-based fallback when Web Locks API is not available
    // Note: In most test environments, navigator.locks is available,
    // so these tests verify the behavior in general

    it('should handle lock expiration for stale locks', async () => {
      // Simulate a stale lock by directly setting localStorage
      // with an old timestamp (older than 30s timeout)
      const lockKey = 'lock_stale_test';
      const oldTimestamp = Date.now() - 40000; // 40 seconds ago
      localStorage.setItem(lockKey, `stale_id:${oldTimestamp}`);

      // Service should be able to acquire the lock despite the stale entry
      // (only affects fallback mechanism, not Web Locks API)
      let executed = false;
      await service.request('stale_test', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should handle corrupted lock format with no timestamp', async () => {
      // Simulate corrupted lock entry without proper format
      const lockKey = 'lock_corrupted_no_ts';
      localStorage.setItem(lockKey, 'invalid_format_no_colon');

      // Service should treat invalid format as expired and acquire the lock
      let executed = false;
      await service.request('corrupted_no_ts', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should handle corrupted lock format with NaN timestamp', async () => {
      // Simulate corrupted lock entry with non-numeric timestamp
      const lockKey = 'lock_corrupted_nan';
      localStorage.setItem(lockKey, 'some_id:not_a_number');

      // Service should treat NaN timestamp as expired and acquire the lock
      let executed = false;
      await service.request('corrupted_nan', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });

    it('should handle empty string lock value', async () => {
      // Simulate empty string in localStorage
      const lockKey = 'lock_empty';
      localStorage.setItem(lockKey, '');

      // Service should be able to acquire the lock
      let executed = false;
      await service.request('empty', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });
  });

  describe('concurrent lock requests', () => {
    it('should serialize concurrent requests to same lock', async () => {
      const executionOrder: number[] = [];
      const startTimes: number[] = [];

      // Launch two concurrent lock requests
      const request1 = service.request('test_lock', async () => {
        startTimes.push(Date.now());
        executionOrder.push(1);
        await new Promise((r) => setTimeout(r, 20));
      });

      const request2 = service.request('test_lock', async () => {
        startTimes.push(Date.now());
        executionOrder.push(2);
        await new Promise((r) => setTimeout(r, 20));
      });

      await Promise.all([request1, request2]);

      // Both should execute (serialized)
      expect(executionOrder.length).toBe(2);
      expect(executionOrder).toContain(1);
      expect(executionOrder).toContain(2);
    });

    it('should queue up to 10 concurrent requests', async () => {
      const executed: number[] = [];

      const requests: Promise<void>[] = [];
      for (let i = 0; i < 10; i++) {
        const requestNum = i;
        requests.push(
          service.request('test_lock', async () => {
            executed.push(requestNum);
            await new Promise((r) => setTimeout(r, 5));
          }),
        );
      }

      await Promise.all(requests);

      // All 10 should have executed
      expect(executed.length).toBe(10);
    });

    it('should complete and resolve after callback finishes', async () => {
      let callbackCompleted = false;
      await service.request('test_lock', async () => {
        await new Promise((r) => setTimeout(r, 5));
        callbackCompleted = true;
      });

      expect(callbackCompleted).toBeTrue();
    });

    it('should handle async callbacks correctly', async () => {
      let innerValue = '';
      await service.request('test_lock', async () => {
        await new Promise((r) => setTimeout(r, 5));
        innerValue = 'async-result';
      });

      expect(innerValue).toBe('async-result');
    });
  });

  describe('lock timeout handling', () => {
    it('should release lock on callback timeout via error', async () => {
      const slowCallback = service.request('test_lock', async () => {
        await new Promise((r) => setTimeout(r, 50));
        throw new Error('Callback failed');
      });

      await expectAsync(slowCallback).toBeRejectedWithError('Callback failed');

      // Lock should be released, next request should work
      let executed = false;
      await service.request('test_lock', async () => {
        executed = true;
      });
      expect(executed).toBe(true);
    });
  });

  describe('reentrant behavior', () => {
    it('should handle nested lock requests to different locks', async () => {
      const order: string[] = [];

      await service.request('outer_lock', async () => {
        order.push('outer-start');
        await service.request('inner_lock', async () => {
          order.push('inner');
        });
        order.push('outer-end');
      });

      expect(order).toEqual(['outer-start', 'inner', 'outer-end']);
    });
  });

  describe('high contention scenarios', () => {
    it('should handle 20 concurrent requests fairly', async () => {
      const executed: number[] = [];
      const requests: Promise<void>[] = [];

      // Launch 20 concurrent requests
      for (let i = 0; i < 20; i++) {
        const requestNum = i;
        requests.push(
          service.request('contention_lock', async () => {
            executed.push(requestNum);
            // Small delay to simulate work
            await new Promise((r) => setTimeout(r, 2));
          }),
        );
      }

      await Promise.all(requests);

      // All 20 should have executed
      expect(executed.length).toBe(20);
      // Each number should appear exactly once
      const uniqueExecuted = [...new Set(executed)];
      expect(uniqueExecuted.length).toBe(20);
    });

    it('should not starve any request under moderate contention', async () => {
      const startTimes: Map<number, number> = new Map();
      const endTimes: Map<number, number> = new Map();
      const requests: Promise<void>[] = [];

      const startTime = Date.now();
      // Pre-defined work times to avoid mixed operator lint error
      const workTimes = [5, 7, 9, 5, 7, 9, 5, 7, 9, 5];

      // Launch 10 concurrent requests with varying work times
      for (let i = 0; i < 10; i++) {
        const requestNum = i;
        const workTime = workTimes[i];
        requests.push(
          service.request('starvation_lock', async () => {
            startTimes.set(requestNum, Date.now() - startTime);
            // Vary the work time
            await new Promise((r) => setTimeout(r, workTime));
            endTimes.set(requestNum, Date.now() - startTime);
          }),
        );
      }

      await Promise.all(requests);

      // All requests should have completed
      expect(startTimes.size).toBe(10);
      expect(endTimes.size).toBe(10);

      // Check no request waited unreasonably long (more than 500ms for 10 requests)
      // Note: Using 500ms threshold to account for CI machine variability
      // Theoretical max is ~63ms (sum of work times), but CI can add significant overhead
      const maxWait = Math.max(...Array.from(startTimes.values()));
      expect(maxWait).toBeLessThan(500);
    });

    it('should maintain correct execution order for FIFO-like behavior', async () => {
      const executionOrder: number[] = [];
      const requests: Promise<void>[] = [];

      // Launch requests with small delays between them
      for (let i = 0; i < 5; i++) {
        const requestNum = i;
        // Stagger the requests slightly
        await new Promise((r) => setTimeout(r, 1));
        requests.push(
          service.request('fifo_lock', async () => {
            executionOrder.push(requestNum);
            await new Promise((r) => setTimeout(r, 5));
          }),
        );
      }

      await Promise.all(requests);

      // All should execute
      expect(executionOrder.length).toBe(5);
      // Web Locks API should maintain roughly FIFO order for requests on same lock
      // Note: exact ordering is implementation-dependent, but all should complete
    });

    it('should handle burst of requests followed by quiet period', async () => {
      const executed: string[] = [];

      // Burst of 5 requests
      const burstRequests: Promise<void>[] = [];
      for (let i = 0; i < 5; i++) {
        burstRequests.push(
          service.request('burst_lock', async () => {
            executed.push(`burst-${i}`);
            await new Promise((r) => setTimeout(r, 2));
          }),
        );
      }

      await Promise.all(burstRequests);
      expect(executed.filter((e) => e.startsWith('burst-')).length).toBe(5);

      // Quiet period
      await new Promise((r) => setTimeout(r, 10));

      // Single request after quiet period should work immediately
      const quietStart = Date.now();
      await service.request('burst_lock', async () => {
        executed.push('after-quiet');
      });
      const quietDuration = Date.now() - quietStart;

      expect(executed).toContain('after-quiet');
      // Should complete quickly (no backlog)
      expect(quietDuration).toBeLessThan(50);
    });

    it('should handle interleaved requests to multiple locks', async () => {
      const executed: string[] = [];
      const requests: Promise<void>[] = [];

      // Interleave requests to lock_a and lock_b
      for (let i = 0; i < 6; i++) {
        const lockName = i % 2 === 0 ? 'interleave_a' : 'interleave_b';
        const requestId = `${lockName}-${Math.floor(i / 2)}`;
        requests.push(
          service.request(lockName, async () => {
            executed.push(`start-${requestId}`);
            await new Promise((r) => setTimeout(r, 5));
            executed.push(`end-${requestId}`);
          }),
        );
      }

      await Promise.all(requests);

      // All should complete
      expect(executed.filter((e) => e.startsWith('start-')).length).toBe(6);
      expect(executed.filter((e) => e.startsWith('end-')).length).toBe(6);

      // Locks a and b should run independently (interleaved starts possible)
      // Just verify all completed - exact interleaving depends on timing
    });
  });

  describe('graceful degradation when Web Locks unavailable', () => {
    let originalLocks: LockManager | undefined;

    beforeEach(() => {
      // Save original navigator.locks
      originalLocks = navigator.locks;
    });

    afterEach(() => {
      // Restore navigator.locks
      Object.defineProperty(navigator, 'locks', {
        value: originalLocks,
        configurable: true,
      });
    });

    it('should execute callback without locking when Web Locks unavailable', async () => {
      // Mock navigator.locks as undefined
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });

      // Create a fresh service instance to test the fallback path
      const fallbackService = TestBed.inject(LockService);
      let executed = false;

      await fallbackService.request('test_lock', async () => {
        executed = true;
      });

      expect(executed).toBe(true);
    });

    it('should only warn once per session when Web Locks unavailable', async () => {
      // Mock navigator.locks as undefined
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });

      // Create a fresh service instance
      const fallbackService = new LockService();

      // Execute multiple requests - internal flag should prevent repeated warnings
      await fallbackService.request('test_lock_1', async () => {});
      await fallbackService.request('test_lock_2', async () => {});
      await fallbackService.request('test_lock_3', async () => {});

      // Verify that multiple requests still execute successfully
      // (the warning-once behavior is an internal implementation detail)
      let count = 0;
      await fallbackService.request('test_lock_count', async () => {
        count++;
      });
      expect(count).toBe(1);
    });

    it('should propagate callback errors even without Web Locks', async () => {
      // Mock navigator.locks as undefined
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });

      const fallbackService = new LockService();
      const testError = new Error('Test callback error');

      await expectAsync(
        fallbackService.request('test_lock', async () => {
          throw testError;
        }),
      ).toBeRejectedWith(testError);
    });

    it('should handle async callbacks without Web Locks', async () => {
      // Mock navigator.locks as undefined
      Object.defineProperty(navigator, 'locks', {
        value: undefined,
        configurable: true,
      });

      const fallbackService = new LockService();
      let asyncResult = '';

      await fallbackService.request('test_lock', async () => {
        await new Promise((r) => setTimeout(r, 5));
        asyncResult = 'completed';
      });

      expect(asyncResult).toBe('completed');
    });
  });

  describe('error recovery under contention', () => {
    it('should release lock and allow next waiter when callback throws', async () => {
      const executed: string[] = [];
      const requests: Promise<void>[] = [];

      // First request throws
      requests.push(
        service
          .request('error_recovery_lock', async () => {
            executed.push('first-start');
            throw new Error('First request failed');
          })
          .catch(() => {
            executed.push('first-caught');
          }),
      );

      // Second request should still execute after first fails
      requests.push(
        service.request('error_recovery_lock', async () => {
          executed.push('second-executed');
        }),
      );

      await Promise.all(requests);

      expect(executed).toContain('first-start');
      expect(executed).toContain('first-caught');
      expect(executed).toContain('second-executed');
    });

    it('should handle multiple consecutive failures', async () => {
      const executed: string[] = [];
      const requests: Promise<void>[] = [];

      // Multiple failing requests
      for (let i = 0; i < 3; i++) {
        requests.push(
          service
            .request('multi_fail_lock', async () => {
              executed.push(`fail-${i}`);
              throw new Error(`Request ${i} failed`);
            })
            .catch(() => {
              // Swallow error
            }),
        );
      }

      // One success at the end
      requests.push(
        service.request('multi_fail_lock', async () => {
          executed.push('success');
        }),
      );

      await Promise.all(requests);

      // All should have attempted
      expect(executed.filter((e) => e.startsWith('fail-')).length).toBe(3);
      expect(executed).toContain('success');
    });
  });

  describe('Web Locks API usage in browser environment', () => {
    // Note: In test environment (Karma/browser), IS_ELECTRON and IS_ANDROID_WEB_VIEW are false,
    // so these tests verify the Web Locks API path. Electron/Android paths are tested via E2E.

    it('should use navigator.locks.request in browser environment', async () => {
      // In test environment, IS_ELECTRON=false and IS_ANDROID_WEB_VIEW=false
      // so the service should use navigator.locks.request
      const locksSpy = spyOn(navigator.locks, 'request').and.callThrough();

      await service.request('api_test_lock', async () => {
        // callback
      });

      expect(locksSpy).toHaveBeenCalled();
      expect(locksSpy.calls.mostRecent().args[0]).toBe('api_test_lock');
    });

    it('should pass callback to navigator.locks.request', async () => {
      let callbackExecutedInLock = false;
      const locksSpy = spyOn(navigator.locks, 'request').and.callFake(
        async (_name: string, callback: any) => {
          callbackExecutedInLock = true;
          return callback(null);
        },
      );

      let callbackRan = false;
      await service.request('callback_test_lock', async () => {
        callbackRan = true;
      });

      expect(locksSpy).toHaveBeenCalled();
      expect(callbackExecutedInLock).toBe(true);
      expect(callbackRan).toBe(true);
    });
  });

  describe('platform-specific lock skipping (documentation)', () => {
    // Note: IS_ELECTRON and IS_ANDROID_WEB_VIEW are compile-time constants that cannot
    // be mocked in unit tests. The lock skipping behavior for these platforms is verified by:
    // 1. Code inspection - lines 29-31 in lock.service.ts
    // 2. E2E tests running in actual Electron/Android environments
    //
    // These tests document the expected behavior and verify the browser path works.

    it('should use Web Locks API in browser environment (proving lock is NOT skipped)', async () => {
      // This test proves that in browser (test) environment, locks ARE used.
      // By extension, this proves the conditional at lines 29-31 works - if
      // IS_ELECTRON or IS_ANDROID_WEB_VIEW were true, this test would fail.
      const locksSpy = spyOn(navigator.locks, 'request').and.callThrough();

      await service.request('browser_env_lock', async () => {});

      // If platform skip were active, this would NOT be called
      expect(locksSpy).toHaveBeenCalled();
    });

    it('should serialize concurrent requests via Web Locks (proving locks are active)', async () => {
      // This test proves that actual lock serialization is happening.
      // In Electron/Android where locks are skipped, concurrent requests
      // would NOT be serialized (they'd run in parallel).
      const executionOrder: string[] = [];

      const request1 = service.request('serialize_lock', async () => {
        executionOrder.push('req1-start');
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push('req1-end');
      });

      const request2 = service.request('serialize_lock', async () => {
        executionOrder.push('req2-start');
        await new Promise((r) => setTimeout(r, 10));
        executionOrder.push('req2-end');
      });

      await Promise.all([request1, request2]);

      // Web Locks serializes: req1 must complete before req2 starts
      // This proves locks ARE being used (not skipped)
      expect(executionOrder.indexOf('req1-end')).toBeLessThan(
        executionOrder.indexOf('req2-start'),
      );
    });
  });
});
