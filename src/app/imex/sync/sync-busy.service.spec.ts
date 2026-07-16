import { TestBed } from '@angular/core/testing';
import { BehaviorSubject } from 'rxjs';
import { SyncBusyService } from './sync-busy.service';
import { SyncWrapperService } from './sync-wrapper.service';
import { SyncCycleGuardService } from '../../op-log/sync/sync-cycle-guard.service';

/**
 * A stand-in for the parts of SyncWrapperService the busy definition reads.
 * The real wrapper drags in the whole sync stack; the contract under test is
 * only these three members.
 */
class FakeSyncWrapper {
  private _isSyncInProgress$ = new BehaviorSubject(false);
  private _isEncryption$ = new BehaviorSubject(false);

  isSyncInProgress$ = this._isSyncInProgress$.asObservable();
  isEncryptionOperationInProgress$ = this._isEncryption$.asObservable();

  get isEncryptionOperationInProgress(): boolean {
    return this._isEncryption$.getValue();
  }

  isSyncInProgressSync(): boolean {
    return this._isSyncInProgress$.getValue();
  }

  setSyncInProgress(v: boolean): void {
    this._isSyncInProgress$.next(v);
  }

  setEncryption(v: boolean): void {
    this._isEncryption$.next(v);
  }
}

describe('SyncBusyService', () => {
  let service: SyncBusyService;
  let wrapper: FakeSyncWrapper;
  let guard: SyncCycleGuardService;

  beforeEach(() => {
    wrapper = new FakeSyncWrapper();
    TestBed.configureTestingModule({
      providers: [
        SyncBusyService,
        SyncCycleGuardService,
        { provide: SyncWrapperService, useValue: wrapper },
      ],
    });
    service = TestBed.inject(SyncBusyService);
    guard = TestBed.inject(SyncCycleGuardService);
  });

  describe('isBusy (synchronous)', () => {
    it('is false when nothing is running', () => {
      expect(service.isBusy).toBe(false);
    });

    it('is true while the cycle guard is held', () => {
      guard.tryBegin();
      expect(service.isBusy).toBe(true);
    });

    it('is true during an encryption operation with no cycle claimed', () => {
      // runWithSyncBlocked() holds this flag across the pre-guard drain window,
      // so the guard alone would report idle here.
      wrapper.setEncryption(true);
      expect(service.isBusy).toBe(true);
    });

    it('is true while a sync is in progress', () => {
      wrapper.setSyncInProgress(true);
      expect(service.isBusy).toBe(true);
    });

    it('stays busy until the last signal clears', () => {
      guard.tryBegin();
      wrapper.setEncryption(true);
      wrapper.setEncryption(false);
      expect(service.isBusy).toBe(true);
      guard.end();
      expect(service.isBusy).toBe(false);
    });
  });

  describe('isBusy$', () => {
    let seen: boolean[];
    let sub: { unsubscribe: () => void };

    beforeEach(() => {
      seen = [];
      sub = service.isBusy$.subscribe((v) => seen.push(v));
    });

    afterEach(() => sub.unsubscribe());

    it('emits the current state on subscribe', () => {
      expect(seen).toEqual([false]);
    });

    it('emits when a cycle is claimed and released', () => {
      guard.tryBegin();
      wrapper.setSyncInProgress(true);
      guard.end();
      wrapper.setSyncInProgress(false);
      expect(seen).toEqual([false, true, false]);
    });

    it('resolves to idle only on the guard release, not on the earlier signal clear', () => {
      // Mirrors sync()'s finally: isSyncInProgress$ clears while the guard is
      // still held, so only the guard's release may flip the union to idle.
      // Without SyncCycleGuard.released$ there would be no edge to recompute on
      // and this would emit `true` forever.
      guard.tryBegin();
      wrapper.setSyncInProgress(true);
      expect(seen).toEqual([false, true]);

      wrapper.setSyncInProgress(false);
      expect(seen).toEqual([false, true]);

      guard.end();
      expect(seen).toEqual([false, true, false]);
    });

    it('does not emit a duplicate when a second signal goes busy', () => {
      guard.tryBegin();
      wrapper.setSyncInProgress(true);
      wrapper.setEncryption(true);
      expect(seen).toEqual([false, true]);
    });

    it('does not emit an idle edge for an end() that released nothing', () => {
      guard.end();
      expect(seen).toEqual([false]);
    });

    it('emits for a guard-only cycle that touches no other signal', () => {
      // The side channels (immediate upload, WS download) claim the cycle
      // without ever setting isSyncInProgress$. If the union listened only to
      // the guard's RELEASE edge, those cycles would read as idle for their
      // whole duration — which is the coverage the guard is in the union for.
      guard.tryBegin();
      expect(seen).toEqual([false, true]);
      guard.end();
      expect(seen).toEqual([false, true, false]);
    });

    it('emits across repeated busy/idle cycles', () => {
      guard.tryBegin();
      guard.end();
      guard.tryBegin();
      guard.end();
      expect(seen).toEqual([false, true, false, true, false]);
    });

    it('tracks a standalone encryption operation (forceUpload has no cycle of its own here)', () => {
      wrapper.setEncryption(true);
      wrapper.setEncryption(false);
      expect(seen).toEqual([false, true, false]);
    });
  });
});
