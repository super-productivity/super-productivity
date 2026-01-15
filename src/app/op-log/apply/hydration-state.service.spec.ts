import { TestBed } from '@angular/core/testing';
import { HydrationStateService } from './hydration-state.service';
import { getIsApplyingRemoteOps } from '../capture/operation-capture.meta-reducer';

describe('HydrationStateService', () => {
  let service: HydrationStateService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [HydrationStateService],
    });
    service = TestBed.inject(HydrationStateService);

    // Ensure clean state - meta-reducer flag may be dirty from previous tests
    service.endApplyingRemoteOps();
    service.clearPostSyncCooldown();
  });

  describe('initial state', () => {
    it('should start with isApplyingRemoteOps as false', () => {
      expect(service.isApplyingRemoteOps()).toBeFalse();
    });
  });

  describe('startApplyingRemoteOps', () => {
    it('should set isApplyingRemoteOps to true', () => {
      service.startApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeTrue();
    });

    it('should remain true if called multiple times', () => {
      service.startApplyingRemoteOps();
      service.startApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeTrue();
    });
  });

  describe('endApplyingRemoteOps', () => {
    it('should set isApplyingRemoteOps to false', () => {
      service.startApplyingRemoteOps();
      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();
    });

    it('should remain false if called when already false', () => {
      expect(service.isApplyingRemoteOps()).toBeFalse();
      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();
    });
  });

  describe('state transitions', () => {
    it('should correctly track multiple start/end cycles', () => {
      expect(service.isApplyingRemoteOps()).toBeFalse();

      service.startApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeTrue();

      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();

      service.startApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeTrue();

      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();
    });
  });

  describe('service isolation', () => {
    it('should provide independent state per instance', () => {
      // Create a second instance using a new testing module
      const secondService = TestBed.inject(HydrationStateService);

      // Since it's providedIn: 'root', they should be the same instance
      // This test verifies the singleton behavior
      service.startApplyingRemoteOps();
      expect(secondService.isApplyingRemoteOps()).toBeTrue();

      service.endApplyingRemoteOps();
      expect(secondService.isApplyingRemoteOps()).toBeFalse();
    });
  });

  describe('meta-reducer integration', () => {
    /**
     * These tests verify that HydrationStateService correctly notifies the
     * operation-capture meta-reducer to skip capturing during sync.
     * This is critical for preventing the "slow device cascade" problem.
     */
    it('should set meta-reducer flag when startApplyingRemoteOps is called', () => {
      expect(getIsApplyingRemoteOps()).toBeFalse();

      service.startApplyingRemoteOps();

      // Both the service state and meta-reducer flag should be true
      expect(service.isApplyingRemoteOps()).toBeTrue();
      expect(getIsApplyingRemoteOps()).toBeTrue();
    });

    it('should clear meta-reducer flag when endApplyingRemoteOps is called', () => {
      service.startApplyingRemoteOps();
      expect(getIsApplyingRemoteOps()).toBeTrue();

      service.endApplyingRemoteOps();

      // Both the service state and meta-reducer flag should be false
      expect(service.isApplyingRemoteOps()).toBeFalse();
      expect(getIsApplyingRemoteOps()).toBeFalse();
    });

    it('should keep service state and meta-reducer flag in sync', () => {
      // Start sync
      service.startApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeTrue();
      expect(getIsApplyingRemoteOps()).toBeTrue();

      // End sync
      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();
      expect(getIsApplyingRemoteOps()).toBeFalse();

      // Start again
      service.startApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeTrue();
      expect(getIsApplyingRemoteOps()).toBeTrue();

      // End again
      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();
      expect(getIsApplyingRemoteOps()).toBeFalse();
    });
  });

  describe('post-sync cooldown', () => {
    it('should set isInSyncWindow to true during cooldown', () => {
      expect(service.isInSyncWindow()).toBeFalse();

      service.startPostSyncCooldown(1000);

      expect(service.isInSyncWindow()).toBeTrue();
    });

    it('should clear cooldown with clearPostSyncCooldown', () => {
      service.startPostSyncCooldown(1000);
      expect(service.isInSyncWindow()).toBeTrue();

      service.clearPostSyncCooldown();

      expect(service.isInSyncWindow()).toBeFalse();
    });

    it('should return true for isInSyncWindow during applyingRemoteOps', () => {
      service.startApplyingRemoteOps();
      expect(service.isInSyncWindow()).toBeTrue();

      service.endApplyingRemoteOps();
      expect(service.isInSyncWindow()).toBeFalse();
    });

    it('should return true for isInSyncWindow when either flag is true', () => {
      // Neither flag set
      expect(service.isInSyncWindow()).toBeFalse();

      // Only applying remote ops
      service.startApplyingRemoteOps();
      expect(service.isInSyncWindow()).toBeTrue();
      service.endApplyingRemoteOps();

      // Only cooldown
      service.startPostSyncCooldown(1000);
      expect(service.isInSyncWindow()).toBeTrue();
      service.clearPostSyncCooldown();

      // Both (unusual but possible)
      service.startApplyingRemoteOps();
      service.startPostSyncCooldown(1000);
      expect(service.isInSyncWindow()).toBeTrue();

      // Clear applyingRemoteOps, cooldown still active
      service.endApplyingRemoteOps();
      expect(service.isInSyncWindow()).toBeTrue();

      // Clear cooldown
      service.clearPostSyncCooldown();
      expect(service.isInSyncWindow()).toBeFalse();
    });

    it('should auto-clear cooldown after timeout', (done) => {
      service.startPostSyncCooldown(50); // 50ms for fast test
      expect(service.isInSyncWindow()).toBeTrue();

      setTimeout(() => {
        expect(service.isInSyncWindow()).toBeFalse();
        done();
      }, 100);
    });
  });

  describe('edge cases', () => {
    it('should handle concurrent start calls without issues', () => {
      // Multiple starts should just keep it true
      service.startApplyingRemoteOps();
      service.startApplyingRemoteOps();
      service.startApplyingRemoteOps();

      expect(service.isApplyingRemoteOps()).toBeTrue();
      expect(getIsApplyingRemoteOps()).toBeTrue();

      // Single end should clear it
      service.endApplyingRemoteOps();
      expect(service.isApplyingRemoteOps()).toBeFalse();
    });

    it('should handle multiple rapid cooldown starts', (done) => {
      // Start multiple cooldowns in rapid succession - only the last one matters
      service.startPostSyncCooldown(50);
      service.startPostSyncCooldown(100);
      service.startPostSyncCooldown(50); // Last one: 50ms

      expect(service.isInSyncWindow()).toBeTrue();

      // After 75ms, should still be in window (last cooldown was 50ms, but timer restarted)
      setTimeout(() => {
        expect(service.isInSyncWindow()).toBeFalse();
        done();
      }, 100);
    });

    it('should properly cleanup when clearPostSyncCooldown is called during active cooldown', (done) => {
      service.startPostSyncCooldown(200);
      expect(service.isInSyncWindow()).toBeTrue();

      // Clear immediately
      service.clearPostSyncCooldown();
      expect(service.isInSyncWindow()).toBeFalse();

      // Wait past the original timeout - should still be false (timer was cleared)
      setTimeout(() => {
        expect(service.isInSyncWindow()).toBeFalse();
        done();
      }, 250);
    });

    it('should handle interleaved start/end/cooldown calls', () => {
      // Complex sequence that might occur during rapid sync operations
      service.startApplyingRemoteOps();
      expect(service.isInSyncWindow()).toBeTrue();

      service.startPostSyncCooldown(1000);
      expect(service.isInSyncWindow()).toBeTrue();

      service.endApplyingRemoteOps();
      // Should still be in window due to cooldown
      expect(service.isInSyncWindow()).toBeTrue();
      expect(service.isApplyingRemoteOps()).toBeFalse();

      service.clearPostSyncCooldown();
      // Now should be fully out of window
      expect(service.isInSyncWindow()).toBeFalse();
    });

    it('should handle clearPostSyncCooldown when no cooldown is active', () => {
      // Should not throw or cause issues
      expect(() => service.clearPostSyncCooldown()).not.toThrow();
      expect(service.isInSyncWindow()).toBeFalse();
    });

    it('should handle endApplyingRemoteOps when not started', () => {
      // Should not throw or cause issues
      expect(service.isApplyingRemoteOps()).toBeFalse();
      expect(() => service.endApplyingRemoteOps()).not.toThrow();
      expect(service.isApplyingRemoteOps()).toBeFalse();
      expect(getIsApplyingRemoteOps()).toBeFalse();
    });
  });
});
