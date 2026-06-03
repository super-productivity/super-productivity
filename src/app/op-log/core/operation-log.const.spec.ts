import {
  IDB_OPEN_RETRIES,
  IDB_OPEN_RETRIES_NON_LOCK,
  IDB_OPEN_RETRY_BASE_DELAY_MS,
} from './operation-log.const';
import { isLockRelatedIdbOpenError } from '../persistence/op-log-errors.const';

describe('IndexedDB open retry configuration', () => {
  // Minimum 20s window exists as a defense-in-depth retry budget for
  // session-restart LOCK contention on Linux desktop environments
  // (especially Flatpak), where logout/login with autostart can leave
  // the old session's LevelDB lock held for 5-15+ seconds.
  // See: https://github.com/super-productivity/super-productivity/issues/7191
  const MINIMUM_LOCK_RETRY_WINDOW_MS = 20_000;

  it('lock-related retry window is at least 20 seconds', () => {
    // Assert against concrete constant values rather than recomputing the
    // exponential-backoff formula — otherwise the test just checks that the
    // formula matches itself. We want to fail if someone changes
    // IDB_OPEN_RETRIES or IDB_OPEN_RETRY_BASE_DELAY_MS below the floor.
    expect(IDB_OPEN_RETRIES).toBeGreaterThanOrEqual(5);
    expect(IDB_OPEN_RETRY_BASE_DELAY_MS).toBeGreaterThanOrEqual(1000);

    // Sanity check: the total window implied by those values clears 20s.
    // With IDB_OPEN_RETRIES=5 and base 1000ms: 1+2+4+8+16 = 31s.
    const totalDelayMs =
      (Math.pow(2, IDB_OPEN_RETRIES) - 1) * IDB_OPEN_RETRY_BASE_DELAY_MS;
    expect(totalDelayMs).toBeGreaterThanOrEqual(MINIMUM_LOCK_RETRY_WINDOW_MS);
  });

  it('non-lock retry budget is shorter than the lock budget', () => {
    // Non-lock errors must fail fast: every op-log read/write awaits
    // _ensureInit(), so a 31s retry blocks the subsystem for 31s before the
    // hydrator's alert dialog reaches the user. See #7191.
    expect(IDB_OPEN_RETRIES_NON_LOCK).toBeLessThan(IDB_OPEN_RETRIES);
    // Geometric series `(2^n - 1) * base` matches the actual wall-clock
    // window: with n retries the delays are base, 2*base, ..., 2^(n-1)*base
    // before attempts 2..n+1, with no post-delay on the final attempt.
    // Cap well under 10s so non-lock failures surface quickly.
    const nonLockWindowMs =
      (Math.pow(2, IDB_OPEN_RETRIES_NON_LOCK) - 1) * IDB_OPEN_RETRY_BASE_DELAY_MS;
    expect(nonLockWindowMs).toBeLessThan(10000);
  });
});

describe('isLockRelatedIdbOpenError', () => {
  it('returns true for InvalidStateError (Chrome LevelDB lock signal)', () => {
    const err = new Error('Internal error.');
    err.name = 'InvalidStateError';
    expect(isLockRelatedIdbOpenError(err)).toBe(true);
  });

  it('returns true when the message mentions "backing store" (any case)', () => {
    expect(
      isLockRelatedIdbOpenError(new Error('Internal error opening backing store')),
    ).toBe(true);
    expect(isLockRelatedIdbOpenError(new Error('BACKING STORE is locked'))).toBe(true);
    expect(isLockRelatedIdbOpenError('backing store failure')).toBe(true);
  });

  it('returns true for DOMException with name InvalidStateError', () => {
    // Some Electron / older runtimes don't make DOMException satisfy
    // `instanceof Error`, so the predicate must check DOMException too. This
    // test constructs a real DOMException when the runtime supports the
    // two-arg constructor, and falls back to a duck-typed stand-in otherwise.
    let err: unknown;
    try {
      err = new DOMException('Internal error.', 'InvalidStateError');
    } catch {
      // Fallback for runtimes without the DOMException constructor:
      // mimic the shape and prototype chain that isConnectionClosingError
      // already relies on in the same file.
      err = Object.assign(Object.create(DOMException.prototype), {
        name: 'InvalidStateError',
        message: 'Internal error.',
      });
    }
    expect(isLockRelatedIdbOpenError(err)).toBe(true);
  });

  it('returns true for DOMException whose message mentions "backing store"', () => {
    let err: unknown;
    try {
      err = new DOMException('Internal error opening backing store', 'UnknownError');
    } catch {
      err = Object.assign(Object.create(DOMException.prototype), {
        name: 'UnknownError',
        message: 'Internal error opening backing store',
      });
    }
    expect(isLockRelatedIdbOpenError(err)).toBe(true);
  });

  it('returns false for generic errors that do not look lock-related', () => {
    expect(isLockRelatedIdbOpenError(new Error('AbortError'))).toBe(false);
    expect(
      isLockRelatedIdbOpenError(
        Object.assign(new Error('Quota exceeded'), { name: 'QuotaExceededError' }),
      ),
    ).toBe(false);
    expect(isLockRelatedIdbOpenError(undefined)).toBe(false);
    expect(isLockRelatedIdbOpenError(null)).toBe(false);
    expect(isLockRelatedIdbOpenError({ random: 'object' })).toBe(false);
  });
});
