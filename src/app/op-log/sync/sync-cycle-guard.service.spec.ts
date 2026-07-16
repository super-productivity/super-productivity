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

  describe('released$', () => {
    let emissions: number;
    let sub: { unsubscribe: () => void };

    beforeEach(() => {
      emissions = 0;
      sub = guard.released$.subscribe(() => emissions++);
    });

    afterEach(() => sub.unsubscribe());

    it('emits when an active cycle is released', () => {
      guard.tryBegin();
      expect(emissions).toBe(0);
      guard.end();
      expect(emissions).toBe(1);
    });

    it('does not emit for an end() that released nothing', () => {
      // `end()` runs from `finally` blocks that may not hold the cycle (e.g. a
      // caller whose tryBegin() returned false). A busy definition must not see
      // an idle edge that never happened.
      guard.end();
      expect(emissions).toBe(0);
    });

    it('emits once per release, not once per end() call', () => {
      guard.tryBegin();
      guard.end();
      guard.end();
      expect(emissions).toBe(1);
    });

    it('emits on the _resetForTest release path', () => {
      // Third mutation site: a consumer recomputing busy state on this edge
      // would otherwise never see the reset.
      guard.tryBegin();
      guard._resetForTest();
      expect(emissions).toBe(1);
    });

    it('emits again for each subsequent cycle', () => {
      guard.tryBegin();
      guard.end();
      guard.tryBegin();
      guard.end();
      expect(emissions).toBe(2);
    });

    it('carries no claim — a subscriber must still win tryBegin()', () => {
      // released$ is a re-check hint, not a lock hand-off. Two subscribers
      // racing on the same edge: only one can claim.
      guard.tryBegin();
      const claims: boolean[] = [];
      const raceSub = guard.released$.subscribe(() => {
        claims.push(guard.tryBegin());
      });
      guard.released$.subscribe(() => {
        claims.push(guard.tryBegin());
      });

      guard.end();

      expect(claims).toEqual([true, false]);
      raceSub.unsubscribe();
    });
  });
});
