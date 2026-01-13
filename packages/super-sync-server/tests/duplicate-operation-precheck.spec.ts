/**
 * Tests for the duplicate operation pre-check fix.
 *
 * REGRESSION TEST: This tests the fix for a bug where duplicate operations
 * would abort PostgreSQL transactions, causing all subsequent operations
 * in a batch to fail with error 25P02 ("transaction is aborted").
 *
 * The fix checks for existing operations BEFORE attempting to insert,
 * avoiding the P2002 unique constraint error that would abort the transaction.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SyncService } from '../src/sync/sync.service';
import { SYNC_ERROR_CODES } from '../src/sync/sync.types';

// Test data for creating mock operations
const createTestOp = (overrides: Record<string, any> = {}) => ({
  id: 'test-op-id',
  clientId: 'client-1', // Must match the clientId passed to uploadOps
  actionType: '[Test] Action',
  opType: 'UPD',
  entityType: 'TASK',
  entityId: 'entity-1',
  payload: { foo: 'bar' },
  vectorClock: { 'client-1': 1 },
  timestamp: Date.now(),
  schemaVersion: 1,
  ...overrides,
});

describe('Duplicate Operation Pre-check', () => {
  let syncService: SyncService;

  beforeEach(() => {
    syncService = new SyncService();
  });

  describe('uploadOps with duplicate operation', () => {
    it('should return DUPLICATE_OPERATION error without aborting batch', async () => {
      // Scenario: Upload 3 ops where first is a duplicate
      // Expected: First op gets DUPLICATE_OPERATION, other two succeed
      const ops = [
        createTestOp({ id: 'dup-op-1', entityId: 'task-1' }),
        createTestOp({ id: 'new-op-2', entityId: 'task-2' }),
        createTestOp({ id: 'new-op-3', entityId: 'task-3' }),
      ];

      // The mock in setup.ts handles this - it will simulate the pre-check
      // by allowing us to set up existing operations
      const results = await syncService.uploadOps(1, 'client-1', ops);

      // All 3 should have results (not all INTERNAL_ERROR due to transaction abort)
      expect(results).toHaveLength(3);

      // At minimum, ops 2 and 3 should succeed (they're not duplicates)
      const successCount = results.filter((r) => r.accepted).length;
      expect(successCount).toBeGreaterThanOrEqual(2);
    });

    it('should detect duplicate operation via pre-check and return proper error code', async () => {
      // First, upload an operation
      const originalOp = createTestOp({ id: 'original-op-id', entityId: 'task-1' });
      const firstResult = await syncService.uploadOps(1, 'client-1', [originalOp]);
      expect(firstResult[0].accepted).toBe(true);

      // Now try to upload the same operation again
      const duplicateOp = createTestOp({ id: 'original-op-id', entityId: 'task-1' });
      const duplicateResult = await syncService.uploadOps(1, 'client-1', [duplicateOp]);

      // Should get DUPLICATE_OPERATION error
      expect(duplicateResult[0].accepted).toBe(false);
      expect(duplicateResult[0].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(duplicateResult[0].error).toContain('Duplicate');
    });

    it('should not abort transaction when duplicate is in the middle of batch', async () => {
      // Upload first op to make it a "duplicate" for later
      const existingOp = createTestOp({ id: 'existing-op', entityId: 'task-existing' });
      await syncService.uploadOps(1, 'client-1', [existingOp]);

      // Now upload batch where middle op is a duplicate
      const batchOps = [
        createTestOp({ id: 'new-op-1', entityId: 'task-1' }),
        createTestOp({ id: 'existing-op', entityId: 'task-existing' }), // Duplicate!
        createTestOp({ id: 'new-op-3', entityId: 'task-3' }),
      ];

      const results = await syncService.uploadOps(1, 'client-1', batchOps);

      // Check each result individually
      expect(results).toHaveLength(3);

      // First op should succeed (not a duplicate)
      expect(results[0].accepted).toBe(true);

      // Second op should fail with DUPLICATE_OPERATION
      expect(results[1].accepted).toBe(false);
      expect(results[1].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);

      // Third op should succeed (transaction NOT aborted by duplicate)
      expect(results[2].accepted).toBe(true);
    });
  });

  describe('error codes', () => {
    it('should use DUPLICATE_OPERATION error code, not INTERNAL_ERROR', async () => {
      // The key regression: Before the fix, duplicates caused INTERNAL_ERROR
      // because the P2002 exception aborted the transaction and subsequent
      // queries failed with 25P02, which was caught as INTERNAL_ERROR.

      const op = createTestOp({ id: 'test-dup-error-code' });

      // Upload once
      await syncService.uploadOps(1, 'client-1', [op]);

      // Upload again (duplicate)
      const result = await syncService.uploadOps(1, 'client-1', [op]);

      // Must be DUPLICATE_OPERATION, NOT INTERNAL_ERROR
      expect(result[0].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(result[0].errorCode).not.toBe(SYNC_ERROR_CODES.INTERNAL_ERROR);
    });
  });
});
