/**
 * Tests for unified retention configuration.
 *
 * The retention system uses a single `retentionMs` value (45 days) for:
 * - Operation age validation (rejecting old incoming ops)
 * - Old operation cleanup (deleteOldSyncedOpsForAllUsers)
 * - Stale device cleanup (deleteStaleDevices)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  DEFAULT_SYNC_CONFIG,
  RETENTION_DAYS,
  RETENTION_MS,
  MS_PER_DAY,
} from '../src/sync/sync.types';
import { ValidationService } from '../src/sync/services/validation.service';

describe('Retention Configuration', () => {
  describe('Constants', () => {
    it('should have RETENTION_DAYS set to 45', () => {
      expect(RETENTION_DAYS).toBe(45);
    });

    it('should have RETENTION_MS calculated correctly from RETENTION_DAYS', () => {
      expect(RETENTION_MS).toBe(45 * MS_PER_DAY);
      expect(RETENTION_MS).toBe(45 * 24 * 60 * 60 * 1000);
    });

    it('should use RETENTION_MS in DEFAULT_SYNC_CONFIG.retentionMs', () => {
      expect(DEFAULT_SYNC_CONFIG.retentionMs).toBe(RETENTION_MS);
    });
  });

  describe('SyncConfig interface', () => {
    it('should have retentionMs property', () => {
      expect(DEFAULT_SYNC_CONFIG).toHaveProperty('retentionMs');
      expect(typeof DEFAULT_SYNC_CONFIG.retentionMs).toBe('number');
    });

    it('should not have deprecated properties', () => {
      // These properties were removed in the unification
      expect(DEFAULT_SYNC_CONFIG).not.toHaveProperty('tombstoneRetentionMs');
      expect(DEFAULT_SYNC_CONFIG).not.toHaveProperty('opRetentionMs');
      expect(DEFAULT_SYNC_CONFIG).not.toHaveProperty('maxOpAgeMs');
    });
  });

  describe('ValidationService - operation age validation', () => {
    let validationService: ValidationService;
    const clientId = 'test-client';

    beforeEach(() => {
      validationService = new ValidationService(DEFAULT_SYNC_CONFIG);
    });

    const createOp = (timestamp: number) => ({
      id: 'test-op-1',
      clientId,
      actionType: 'ADD_TASK',
      opType: 'CRT' as const,
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { title: 'Test' },
      vectorClock: { [clientId]: 1 },
      timestamp,
      schemaVersion: 1,
    });

    it('should accept operation within retention window (44 days old)', () => {
      const fortyFourDaysAgo = Date.now() - 44 * MS_PER_DAY;
      const result = validationService.validateOp(createOp(fortyFourDaysAgo), clientId);
      expect(result.valid).toBe(true);
    });

    it('should accept operation at retention boundary (45 days old exactly)', () => {
      // At exactly 45 days, should still be valid (not yet expired)
      // Add 100ms buffer to avoid flakiness from timing between Date.now() calls
      const exactlyRetentionMs = Date.now() - DEFAULT_SYNC_CONFIG.retentionMs + 100;
      const result = validationService.validateOp(createOp(exactlyRetentionMs), clientId);
      expect(result.valid).toBe(true);
    });

    it('should reject operation beyond retention window (46 days old)', () => {
      const fortysSixDaysAgo = Date.now() - 46 * MS_PER_DAY;
      const result = validationService.validateOp(createOp(fortysSixDaysAgo), clientId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too old');
    });

    it('should reject operation just past retention window (45 days + 1 second)', () => {
      const justPastRetention = Date.now() - DEFAULT_SYNC_CONFIG.retentionMs - 1000;
      const result = validationService.validateOp(createOp(justPastRetention), clientId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('too old');
    });

    it('should accept recent operations', () => {
      const now = Date.now();
      const result = validationService.validateOp(createOp(now), clientId);
      expect(result.valid).toBe(true);
    });

    it('should accept operations from 1 day ago', () => {
      const oneDayAgo = Date.now() - MS_PER_DAY;
      const result = validationService.validateOp(createOp(oneDayAgo), clientId);
      expect(result.valid).toBe(true);
    });

    it('should accept operations from 30 days ago (old maxOpAgeMs value)', () => {
      // Previously maxOpAgeMs was 30 days, now retentionMs is 45 days
      // 30-day-old operations should still be valid
      const thirtyDaysAgo = Date.now() - 30 * MS_PER_DAY;
      const result = validationService.validateOp(createOp(thirtyDaysAgo), clientId);
      expect(result.valid).toBe(true);
    });
  });

  describe('Cleanup cutoff calculation', () => {
    it('should calculate correct cutoff time for cleanup', () => {
      const now = Date.now();
      const cutoffTime = now - DEFAULT_SYNC_CONFIG.retentionMs;

      // Cutoff should be 45 days in the past
      const expectedCutoff = now - 45 * MS_PER_DAY;
      expect(cutoffTime).toBe(expectedCutoff);
    });

    it('should use same retention period for ops and devices', () => {
      // Both old ops and stale devices use the same retentionMs
      const now = Date.now();
      const opsCutoff = now - DEFAULT_SYNC_CONFIG.retentionMs;
      const devicesCutoff = now - DEFAULT_SYNC_CONFIG.retentionMs;

      expect(opsCutoff).toBe(devicesCutoff);
    });
  });

  describe('Custom retention configuration', () => {
    it('should allow overriding retentionMs via constructor', () => {
      const customRetention = 7 * MS_PER_DAY; // 7 days
      const customConfig = { ...DEFAULT_SYNC_CONFIG, retentionMs: customRetention };

      const validationService = new ValidationService(customConfig);

      // 6-day-old op should be valid with 7-day retention
      const sixDaysAgo = Date.now() - 6 * MS_PER_DAY;
      const validOp = {
        id: 'test-op',
        clientId: 'test',
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test' },
        vectorClock: { test: 1 },
        timestamp: sixDaysAgo,
        schemaVersion: 1,
      };

      expect(validationService.validateOp(validOp, 'test').valid).toBe(true);

      // 8-day-old op should be invalid with 7-day retention
      const eightDaysAgo = Date.now() - 8 * MS_PER_DAY;
      const invalidOp = { ...validOp, id: 'test-op-2', timestamp: eightDaysAgo };

      expect(validationService.validateOp(invalidOp, 'test').valid).toBe(false);
    });
  });
});
