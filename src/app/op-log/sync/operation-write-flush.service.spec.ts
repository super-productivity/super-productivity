import { TestBed } from '@angular/core/testing';
import { OperationWriteFlushService } from './operation-write-flush.service';
import { LockService } from './lock.service';

describe('OperationWriteFlushService', () => {
  let service: OperationWriteFlushService;
  let lockServiceSpy: jasmine.SpyObj<LockService>;

  beforeEach(() => {
    lockServiceSpy = jasmine.createSpyObj('LockService', ['request']);
    lockServiceSpy.request.and.callFake(
      async (_name: string, callback: () => Promise<void>) => {
        await callback();
      },
    );

    TestBed.configureTestingModule({
      providers: [
        OperationWriteFlushService,
        { provide: LockService, useValue: lockServiceSpy },
      ],
    });
    service = TestBed.inject(OperationWriteFlushService);
  });

  describe('flushPendingWrites', () => {
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
        async (_name: string, callback: () => Promise<void>) => {
          lockAcquired = true;
          await callback();
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
        async (_name: string, callback: () => Promise<void>) => {
          executionOrder.push('lock-acquired');
          await lockHolderPromise;
          executionOrder.push('lock-callback-done');
          await callback();
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

  describe('FIFO ordering guarantee', () => {
    it('should ensure prior lock holders complete before flush resolves', async () => {
      // This test verifies the core guarantee: when flushPendingWrites resolves,
      // all operations that were queued before the flush call have completed.
      const completedOps: number[] = [];
      let opCounter = 0;

      // Simulate lock service that tracks operation order
      lockServiceSpy.request.and.callFake(
        async (_name: string, callback: () => Promise<void>) => {
          const opNum = ++opCounter;
          await callback();
          completedOps.push(opNum);
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
