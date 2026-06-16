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
});
