import { TestBed } from '@angular/core/testing';
import { SyncSessionValidationService } from './sync-session-validation.service';
import { SyncLog } from '../../core/log';

describe('SyncSessionValidationService', () => {
  let service: SyncSessionValidationService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(SyncSessionValidationService);
    service._resetForTest();
  });

  it('starts in the not-failed state', () => {
    expect(service.hasFailed()).toBe(false);
  });

  describe('withSession()', () => {
    it('runs work and returns its result', async () => {
      const result = await service.withSession(async () => 42);
      expect(result).toBe(42);
    });

    it('clears prior failed state at entry', async () => {
      await service.withSession(async () => {
        service.setFailed();
      });
      expect(service.hasFailed()).toBe(true);

      // New session resets
      await service.withSession(async () => {
        expect(service.hasFailed()).toBe(false);
      });
      expect(service.hasFailed()).toBe(false);
    });

    it('preserves a flag set during the session for post-session reads', async () => {
      await service.withSession(async () => {
        service.setFailed();
      });
      expect(service.hasFailed()).toBe(true);
    });

    it('clears the active flag when work resolves', async () => {
      await service.withSession(async () => {});
      // setFailed outside session must warn (covered below) — the active
      // flag is observable via that warning path.
      const errSpy = spyOn(SyncLog, 'err');
      service.setFailed();
      expect(errSpy).toHaveBeenCalled();
    });

    it('clears the active flag when work throws', async () => {
      await service
        .withSession(async () => {
          throw new Error('boom');
        })
        .catch(() => {});
      const errSpy = spyOn(SyncLog, 'err');
      service.setFailed();
      expect(errSpy).toHaveBeenCalled();
    });

    it('logs an error and runs in outer context when nested', async () => {
      const errSpy = spyOn(SyncLog, 'err');
      let innerSawFailed: boolean | undefined;
      await service.withSession(async () => {
        service.setFailed();
        await service.withSession(async () => {
          // Inner did NOT reset because nested — outer's flag is still visible
          innerSawFailed = service.hasFailed();
        });
      });
      expect(errSpy).toHaveBeenCalled();
      expect(innerSawFailed).toBe(true);
    });
  });

  describe('setFailed() / hasFailed()', () => {
    it('hasFailed() reports true after setFailed() inside a session', async () => {
      await service.withSession(async () => {
        service.setFailed();
        expect(service.hasFailed()).toBe(true);
      });
    });

    it('setFailed() outside an active session logs an error but still flips the flag', () => {
      const errSpy = spyOn(SyncLog, 'err');
      service.setFailed();
      expect(errSpy).toHaveBeenCalled();
      expect(service.hasFailed()).toBe(true);
    });

    it('setFailed() is idempotent', async () => {
      await service.withSession(async () => {
        service.setFailed();
        service.setFailed();
        expect(service.hasFailed()).toBe(true);
      });
    });
  });

  describe('reset()', () => {
    it('clears the latch within an active session', async () => {
      await service.withSession(async () => {
        service.setFailed();
        expect(service.hasFailed()).toBe(true);
        service.reset();
        expect(service.hasFailed()).toBe(false);
      });
    });

    it('logs an error when called outside an active session', () => {
      const errSpy = spyOn(SyncLog, 'err');
      service.reset();
      expect(errSpy).toHaveBeenCalled();
    });
  });
});
