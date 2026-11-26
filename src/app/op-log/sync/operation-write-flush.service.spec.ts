import { TestBed } from '@angular/core/testing';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { LockService } from './lock.service';
import { OperationCaptureService } from '../capture/operation-capture.service';
import { OperationWriteCutoffError } from '../core/errors/sync-errors';

describe('OperationWriteFlushService', () => {
  let service: OperationWriteFlushService;
  let lockServiceSpy: jasmine.SpyObj<LockService>;
  let captureServiceSpy: jasmine.SpyObj<OperationCaptureService>;

  beforeEach(() => {
    lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    lockServiceSpy.request.and.callFake(
      async <T>(_name: string, callback: () => Promise<T>) => callback(),
    );
    captureServiceSpy = jasmine.createSpyObj('OperationCaptureService', [
      'getPendingCount',
    ]);
    captureServiceSpy.getPendingCount.and.returnValue(0);

    TestBed.configureTestingModule({
      providers: [
        OperationWriteFlushService,
        { provide: LockService, useValue: lockServiceSpy },
        { provide: OperationCaptureService, useValue: captureServiceSpy },
      ],
    });
    service = TestBed.inject(OperationWriteFlushService);
  });

  describe('flushPendingWrites', () => {
    it('should expose whether reducer captures are pending', () => {
      captureServiceSpy.getPendingCount.and.returnValues(1, 0);

      expect(service.hasPendingWrites()).toBeTrue();
      expect(service.hasPendingWrites()).toBeFalse();
    });

    it('should acquire the sp_op_log lock', async () => {
      await service.flushPendingWrites();

      expect(lockServiceSpy.request).toHaveBeenCalledTimes(1);
      expect(lockServiceSpy.request).toHaveBeenCalledWith(
        'sp_op_log',
        jasmine.any(Function),
      );
    });

    it('should resolve after lock is acquired', async () => {
      let lockAcquired = false;
      lockServiceSpy.request.and.callFake(
        async <T>(_name: string, callback: () => Promise<T>) => {
          lockAcquired = true;
          return callback();
        },
      );

      await service.flushPendingWrites();

      expect(lockAcquired).toBe(true);
    });

    it('should wait for lock to be released by other holders', async () => {
      const executionOrder: string[] = [];
      let resolveLockHolder: () => void;
      const lockHolderPromise = new Promise<void>((resolve) => {
        resolveLockHolder = resolve;
      });

      // Simulate a lock being held by another operation
      lockServiceSpy.request.and.callFake(
        async <T>(_name: string, callback: () => Promise<T>) => {
          executionOrder.push('lock-acquired');
          await lockHolderPromise;
          executionOrder.push('lock-callback-done');
          return callback();
        },
      );

      const flushPromise = service.flushPendingWrites();
      executionOrder.push('flush-started');

      // Release the lock holder
      resolveLockHolder!();

      await flushPromise;
      executionOrder.push('flush-complete');

      // Verify flush waited for lock
      expect(executionOrder).toContain('lock-acquired');
      expect(executionOrder).toContain('flush-complete');
    });

    it('should propagate errors from lock service', async () => {
      const testError = new Error('Lock acquisition failed');
      lockServiceSpy.request.and.rejectWith(testError);

      await expectAsync(service.flushPendingWrites()).toBeRejectedWith(testError);
    });

    it('should allow multiple sequential flushes', async () => {
      await service.flushPendingWrites();
      await service.flushPendingWrites();
      await service.flushPendingWrites();

      expect(lockServiceSpy.request).toHaveBeenCalledTimes(3);
    });

    it('should use the same lock name as OperationLogEffects.writeOperation', async () => {
      // This test documents the critical invariant:
      // flushPendingWrites MUST use 'sp_op_log' to synchronize with writeOperation
      await service.flushPendingWrites();

      const lockName = lockServiceSpy.request.calls.mostRecent().args[0];
      expect(lockName).toBe('sp_op_log');
    });
  });

  describe('flushThenRunExclusive', () => {
    it('should flush BEFORE acquiring the lock (calling flush inside the held lock deadlocks)', async () => {
      const events: string[] = [];
      spyOn(service, 'flushPendingWrites').and.callFake(async () => {
        events.push('flush');
      });
      lockServiceSpy.request.and.callFake(
        async <T>(_name: string, callback: () => Promise<T>) => {
          events.push('lock-acquired');
          const result = await callback();
          events.push('lock-released');
          return result;
        },
      );

      await service.flushThenRunExclusive(async () => {
        events.push('fn');
      });

      expect(events).toEqual(['flush', 'lock-acquired', 'fn', 'lock-released']);
    });

    it('should return the value produced by fn', async () => {
      spyOn(service, 'flushPendingWrites').and.resolveTo();

      const result = await service.flushThenRunExclusive(async () => 42);

      expect(result).toBe(42);
    });

    it('should release, re-flush, and retry when a capture lands between flush and lock acquisition', async () => {
      spyOn(service, 'flushPendingWrites').and.resolveTo();
      captureServiceSpy.getPendingCount.and.returnValues(1, 0);
      const fn = jasmine.createSpy('fn').and.resolveTo('done');

      const result = await service.flushThenRunExclusive(fn);

      expect(result).toBe('done');
      expect(service.flushPendingWrites).toHaveBeenCalledTimes(2);
      expect(lockServiceSpy.request).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should abort after bounded attempts under continuous dispatch activity', async () => {
      spyOn(service, 'flushPendingWrites').and.resolveTo();
      captureServiceSpy.getPendingCount.and.returnValue(1);
      const fn = jasmine.createSpy('fn');

      await expectAsync(service.flushThenRunExclusive(fn)).toBeRejectedWithError(
        OperationWriteCutoffError,
        /cutoff not reached/,
      );
      expect(fn).not.toHaveBeenCalled();
      expect(service.flushPendingWrites).toHaveBeenCalledTimes(5);
    });

    it('should propagate fn rejections without retrying', async () => {
      spyOn(service, 'flushPendingWrites').and.resolveTo();
      const testError = new Error('fn failed');
      const fn = jasmine.createSpy('fn').and.rejectWith(testError);

      await expectAsync(service.flushThenRunExclusive(fn)).toBeRejectedWith(testError);
      expect(fn).toHaveBeenCalledTimes(1);
    });
  });

  describe('FIFO ordering guarantee', () => {
    it('should ensure prior lock holders complete before flush resolves', async () => {
      // This test verifies the core guarantee: when flushPendingWrites resolves,
      // all operations that were queued before the flush call have completed.
      const completedOps: number[] = [];
      let opCounter = 0;

      // Simulate lock service that tracks operation order
      lockServiceSpy.request.and.callFake(
        async <T>(_name: string, callback: () => Promise<T>) => {
          const opNum = ++opCounter;
          const r = await callback();
          completedOps.push(opNum);
          return r;
        },
      );

      // Simulate prior write operations
      const write1 = service.flushPendingWrites();
      const write2 = service.flushPendingWrites();

      // Our flush call
      const flush = service.flushPendingWrites();

      await Promise.all([write1, write2, flush]);

      // All prior operations should have completed
      expect(completedOps.length).toBe(3);
      expect(completedOps).toEqual([1, 2, 3]);
    });
  });
});
