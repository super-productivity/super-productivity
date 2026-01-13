import { TestBed } from '@angular/core/testing';
import { SuperSyncStatusService } from './super-sync-status.service';

describe('SuperSyncStatusService', () => {
  let service: SuperSyncStatusService;

  const createService = (): SuperSyncStatusService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [SuperSyncStatusService],
    });
    return TestBed.inject(SuperSyncStatusService);
  };

  describe('isConfirmedInSync', () => {
    it('should return false initially (pending ops true, no remote check)', () => {
      service = createService();
      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should return false when only markRemoteChecked is called (pending ops still true)', () => {
      service = createService();
      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should return false when only pending ops is false (no remote check)', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should return true when no pending ops AND remote check completed', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(true);
    });

    it('should return true regardless of order of calls', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);
    });

    it('should return false when pending ops becomes true again', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(true);

      service.updatePendingOpsStatus(true);
      expect(service.isConfirmedInSync()).toBe(false);
    });
  });

  describe('markRemoteChecked', () => {
    it('should set the remote check flag to true', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(false);

      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(true);
    });

    it('should be idempotent', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      service.markRemoteChecked();
      service.markRemoteChecked();
      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(true);
    });
  });

  describe('clearScope', () => {
    it('should reset to default state', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);

      service.clearScope();
      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should require both conditions to be met again after clear', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);

      service.clearScope();

      // Only one condition met
      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(false);

      // Both conditions met
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);
    });
  });

  describe('updatePendingOpsStatus', () => {
    it('should update pending ops status to true', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);

      service.updatePendingOpsStatus(true);
      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should update pending ops status to false', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(true);
      expect(service.isConfirmedInSync()).toBe(false);

      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);
    });
  });

  describe('hasNoPendingOps', () => {
    it('should return false initially (pending ops is true by default)', () => {
      service = createService();
      expect(service.hasNoPendingOps()).toBe(false);
    });

    it('should return true when pending ops status is false', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      expect(service.hasNoPendingOps()).toBe(true);
    });

    it('should return false when pending ops status is true', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      expect(service.hasNoPendingOps()).toBe(true);

      service.updatePendingOpsStatus(true);
      expect(service.hasNoPendingOps()).toBe(false);
    });

    it('should reset to false after clearScope', () => {
      service = createService();
      service.updatePendingOpsStatus(false);
      expect(service.hasNoPendingOps()).toBe(true);

      service.clearScope();
      expect(service.hasNoPendingOps()).toBe(false);
    });
  });

  describe('timestamp freshness', () => {
    const ONE_MINUTE_MS = 60000;

    // Helper to force computed signal re-evaluation by toggling a dependency
    const forceRecompute = (): void => {
      service.updatePendingOpsStatus(true);
      service.updatePendingOpsStatus(false);
    };

    beforeEach(() => {
      jasmine.clock().install();
      jasmine.clock().mockDate(new Date(2026, 0, 8, 12, 0, 0));
    });

    afterEach(() => {
      jasmine.clock().uninstall();
    });

    it('should return true when timestamp is within 1 minute', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);

      // Advance 30 seconds (within 1 minute)
      jasmine.clock().tick(30000);
      forceRecompute();

      expect(service.isConfirmedInSync()).toBe(true);
    });

    it('should return false when timestamp is older than 1 minute', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);

      // First check it's true
      expect(service.isConfirmedInSync()).toBe(true);

      // Advance just over 1 minute
      jasmine.clock().tick(ONE_MINUTE_MS + 1);
      forceRecompute();

      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should return true at exactly 59.999 seconds', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);

      // Advance to just under 1 minute
      jasmine.clock().tick(ONE_MINUTE_MS - 1);
      forceRecompute();

      expect(service.isConfirmedInSync()).toBe(true);
    });

    it('should return false at exactly 1 minute', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);

      // Advance exactly 1 minute
      jasmine.clock().tick(ONE_MINUTE_MS);
      forceRecompute();

      expect(service.isConfirmedInSync()).toBe(false);
    });

    it('should refresh timestamp when markRemoteChecked is called again', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);

      // Advance 50 seconds
      jasmine.clock().tick(50000);
      forceRecompute();
      expect(service.isConfirmedInSync()).toBe(true);

      // Mark remote checked again (refreshes timestamp)
      service.markRemoteChecked();

      // Advance another 50 seconds (would be 100s total if not refreshed)
      jasmine.clock().tick(50000);
      forceRecompute();

      // Should still be true because timestamp was refreshed
      expect(service.isConfirmedInSync()).toBe(true);
    });

    it('should reset timestamp on clearScope', () => {
      service = createService();
      service.markRemoteChecked();
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(true);

      service.clearScope();

      // Even without time passing, should be false (no timestamp)
      service.updatePendingOpsStatus(false);
      expect(service.isConfirmedInSync()).toBe(false);

      // After marking remote checked, should be true again
      service.markRemoteChecked();
      expect(service.isConfirmedInSync()).toBe(true);
    });
  });
});
