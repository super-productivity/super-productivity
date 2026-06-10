import {
  getMsSinceLastCriticalError,
  recordCriticalErrorTime,
} from './critical-error-signal';
import { LS } from '../core/persistence/storage-keys.const';

describe('critical-error-signal', () => {
  const NOW = 1_700_000_000_000;
  let store: { [key: string]: string };

  beforeEach(() => {
    store = {};
    spyOn(localStorage, 'getItem').and.callFake((k: string) => store[k] ?? null);
    spyOn(localStorage, 'setItem').and.callFake((k: string, v: string) => {
      store[k] = v;
    });
    spyOn(Date, 'now').and.returnValue(NOW);
  });

  describe('recordCriticalErrorTime', () => {
    it('stores the current time (only a timestamp, no content)', () => {
      recordCriticalErrorTime();
      expect(localStorage.setItem).toHaveBeenCalledWith(
        LS.LAST_CRITICAL_ERROR_TIME,
        String(NOW),
      );
    });

    it('never throws when localStorage is unavailable', () => {
      (localStorage.setItem as jasmine.Spy).and.throwError('QuotaExceededError');
      expect(() => recordCriticalErrorTime()).not.toThrow();
    });
  });

  describe('getMsSinceLastCriticalError', () => {
    it('returns Infinity when nothing is stored', () => {
      expect(getMsSinceLastCriticalError()).toBe(Number.POSITIVE_INFINITY);
    });

    it('returns the elapsed time since a recorded error', () => {
      store[LS.LAST_CRITICAL_ERROR_TIME] = String(NOW - 5000);
      expect(getMsSinceLastCriticalError()).toBe(5000);
    });

    it('treats a garbage timestamp as no recent error', () => {
      store[LS.LAST_CRITICAL_ERROR_TIME] = 'not-a-number';
      expect(getMsSinceLastCriticalError()).toBe(Number.POSITIVE_INFINITY);
    });

    it('treats a future timestamp (clock skew) as no recent error', () => {
      store[LS.LAST_CRITICAL_ERROR_TIME] = String(NOW + 5000);
      expect(getMsSinceLastCriticalError()).toBe(Number.POSITIVE_INFINITY);
    });

    it('round-trips with recordCriticalErrorTime', () => {
      recordCriticalErrorTime();
      expect(getMsSinceLastCriticalError()).toBe(0);
    });
  });
});
