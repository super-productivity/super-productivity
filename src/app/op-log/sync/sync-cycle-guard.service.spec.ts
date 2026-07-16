import { SyncCycleGuardService } from './sync-cycle-guard.service';

describe('SyncCycleGuardService', () => {
  let guard: SyncCycleGuardService;

  beforeEach(() => {
    guard = new SyncCycleGuardService();
  });

  it('claims the cycle when free and reports active', () => {
    expect(guard.isActive).toBe(false);
    expect(guard.tryBegin()).toBe(true);
    expect(guard.isActive).toBe(true);
  });

  it('returns false without claiming when a cycle is already active', () => {
    expect(guard.tryBegin()).toBe(true);
    // A second claimant (another entry point) must be told to skip.
    expect(guard.tryBegin()).toBe(false);
    expect(guard.isActive).toBe(true);
  });

  it('frees the cycle on end()', () => {
    expect(guard.tryBegin()).toBe(true);
    guard.end();
    expect(guard.isActive).toBe(false);
  });

  it('can be re-acquired after end()', () => {
    expect(guard.tryBegin()).toBe(true);
    guard.end();
    expect(guard.tryBegin()).toBe(true);
    expect(guard.isActive).toBe(true);
  });

  it('_resetForTest clears active state', () => {
    expect(guard.tryBegin()).toBe(true);
    guard._resetForTest();
    expect(guard.isActive).toBe(false);
    expect(guard.tryBegin()).toBe(true);
  });

  describe('isActive$', () => {
    let seen: boolean[];
    let sub: { unsubscribe: () => void };

    beforeEach(() => {
      seen = [];
      sub = guard.isActive$.subscribe((v) => seen.push(v));
    });

    afterEach(() => sub.unsubscribe());

    it('emits the current state on subscribe', () => {
      expect(seen).toEqual([false]);
    });

    it('emits on claim and on release', () => {
      // The claim edge is load-bearing: the side channels claim a cycle without
      // touching any other sync signal, so a busy definition watching only the
      // release would report those cycles as idle for their whole duration.
      guard.tryBegin();
      expect(seen).toEqual([false, true]);
      guard.end();
      expect(seen).toEqual([false, true, false]);
    });

    it('does not emit for an end() that released nothing', () => {
      // `end()` runs from `finally` blocks that may not hold the cycle (e.g. a
      // caller whose tryBegin() returned false). A busy definition must not see
      // an idle edge that never happened.
      guard.end();
      expect(seen).toEqual([false]);
    });

    it('does not emit for a tryBegin() that claimed nothing', () => {
      guard.tryBegin();
      guard.tryBegin();
      expect(seen).toEqual([false, true]);
    });

    it('emits on the _resetForTest release path', () => {
      // Third mutation site: a consumer recomputing busy state on this edge
      // would otherwise never see the reset.
      guard.tryBegin();
      guard._resetForTest();
      expect(seen).toEqual([false, true, false]);
    });

    it('emits across repeated cycles', () => {
      guard.tryBegin();
      guard.end();
      guard.tryBegin();
      guard.end();
      expect(seen).toEqual([false, true, false, true, false]);
    });

    it('carries no claim — a subscriber must still win tryBegin()', () => {
      // Observing activity is not holding it. Two subscribers racing the same
      // release edge: only one can claim.
      guard.tryBegin();
      const claims: boolean[] = [];
      const a = guard.isActive$
        .pipe()
        .subscribe((isActive) => !isActive && claims.push(guard.tryBegin()));
      const b = guard.isActive$
        .pipe()
        .subscribe((isActive) => !isActive && claims.push(guard.tryBegin()));

      guard.end();

      // Each subscriber replays the current value on subscribe, so filter to the
      // claims made on the release edge itself.
      expect(claims.slice(-2)).toEqual([true, false]);
      a.unsubscribe();
      b.unsubscribe();
    });
  });
});
