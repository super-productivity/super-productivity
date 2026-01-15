import {
  OpType,
  FULL_STATE_OP_TYPES,
  isFullStateOpType,
  isWrappedFullStatePayload,
  extractFullStateFromPayload,
  assertValidFullStatePayload,
} from './operation.types';

describe('operation.types full-state payload utilities', () => {
  // Sample valid application state
  const validState = {
    task: { ids: ['t1'], entities: { t1: { id: 't1', title: 'Test' } } },
    project: { ids: ['p1'], entities: { p1: { id: 'p1', title: 'Project' } } },
    tag: { ids: [], entities: {} },
    globalConfig: { sync: { isEnabled: false } },
  };

  describe('FULL_STATE_OP_TYPES', () => {
    it('should contain SyncImport, BackupImport, and Repair', () => {
      expect(FULL_STATE_OP_TYPES.has(OpType.SyncImport)).toBe(true);
      expect(FULL_STATE_OP_TYPES.has(OpType.BackupImport)).toBe(true);
      expect(FULL_STATE_OP_TYPES.has(OpType.Repair)).toBe(true);
    });

    it('should NOT contain regular operation types', () => {
      expect(FULL_STATE_OP_TYPES.has(OpType.Create)).toBe(false);
      expect(FULL_STATE_OP_TYPES.has(OpType.Update)).toBe(false);
      expect(FULL_STATE_OP_TYPES.has(OpType.Delete)).toBe(false);
      expect(FULL_STATE_OP_TYPES.has(OpType.Move)).toBe(false);
      expect(FULL_STATE_OP_TYPES.has(OpType.Batch)).toBe(false);
    });
  });

  describe('isFullStateOpType', () => {
    it('should return true for full-state op types', () => {
      expect(isFullStateOpType(OpType.SyncImport)).toBe(true);
      expect(isFullStateOpType(OpType.BackupImport)).toBe(true);
      expect(isFullStateOpType(OpType.Repair)).toBe(true);
    });

    it('should return false for regular op types', () => {
      expect(isFullStateOpType(OpType.Create)).toBe(false);
      expect(isFullStateOpType(OpType.Update)).toBe(false);
      expect(isFullStateOpType(OpType.Delete)).toBe(false);
    });

    it('should handle string values', () => {
      expect(isFullStateOpType('SYNC_IMPORT')).toBe(true);
      expect(isFullStateOpType('CRT')).toBe(false);
    });
  });

  describe('isWrappedFullStatePayload', () => {
    it('should return true for wrapped payload format', () => {
      const wrapped = { appDataComplete: validState };
      expect(isWrappedFullStatePayload(wrapped)).toBe(true);
    });

    it('should return false for unwrapped payload format', () => {
      expect(isWrappedFullStatePayload(validState)).toBe(false);
    });

    it('should return false for null/undefined', () => {
      expect(isWrappedFullStatePayload(null)).toBe(false);
      expect(isWrappedFullStatePayload(undefined)).toBe(false);
    });

    it('should return false for non-object payloads', () => {
      expect(isWrappedFullStatePayload('string')).toBe(false);
      expect(isWrappedFullStatePayload(123)).toBe(false);
      expect(isWrappedFullStatePayload([])).toBe(false);
    });

    it('should return false for object with non-object appDataComplete', () => {
      expect(isWrappedFullStatePayload({ appDataComplete: 'string' })).toBe(false);
      expect(isWrappedFullStatePayload({ appDataComplete: null })).toBe(false);
    });
  });

  describe('extractFullStateFromPayload', () => {
    it('should unwrap wrapped payload format', () => {
      const wrapped = { appDataComplete: validState };
      const result = extractFullStateFromPayload(wrapped);
      expect(result).toEqual(validState);
    });

    it('should return unwrapped payload as-is', () => {
      const result = extractFullStateFromPayload(validState);
      expect(result).toEqual(validState);
    });

    it('should handle deeply nested appDataComplete correctly', () => {
      // This is the bug case: wrapped payload with state that also has some key
      const wrapped = { appDataComplete: validState };
      const result = extractFullStateFromPayload(wrapped);

      // Should have task, project, tag, globalConfig at top level
      expect('task' in result).toBe(true);
      expect('project' in result).toBe(true);
      // Should NOT have appDataComplete at top level
      expect('appDataComplete' in result).toBe(false);
    });
  });

  describe('assertValidFullStatePayload', () => {
    it('should not throw for valid unwrapped state', () => {
      expect(() => {
        assertValidFullStatePayload(validState, 'test');
      }).not.toThrow();
    });

    it('should not throw for valid wrapped state', () => {
      const wrapped = { appDataComplete: validState };
      expect(() => {
        assertValidFullStatePayload(wrapped, 'test');
      }).not.toThrow();
    });

    it('should throw for null payload', () => {
      expect(() => {
        assertValidFullStatePayload(null, 'test');
      }).toThrowError(/Invalid full-state payload: expected object, got object/);
    });

    it('should throw for string payload', () => {
      expect(() => {
        assertValidFullStatePayload('not an object', 'test');
      }).toThrowError(/Invalid full-state payload: expected object, got string/);
    });

    it('should throw for payload missing expected keys', () => {
      const invalidState = { someOtherKey: 'value', anotherKey: 123 };
      expect(() => {
        assertValidFullStatePayload(invalidState, 'test');
      }).toThrowError(/Invalid full-state payload: missing expected keys/);
    });

    it('should include context in error message', () => {
      expect(() => {
        assertValidFullStatePayload(null, 'MyService.myMethod');
      }).toThrowError(/MyService\.myMethod/);
    });

    it('should pass for state with only some expected keys', () => {
      // Payload only needs SOME of the expected keys, not all
      const partialState = { task: { ids: [], entities: {} } };
      expect(() => {
        assertValidFullStatePayload(partialState, 'test');
      }).not.toThrow();
    });
  });

  describe('payload consistency between services', () => {
    /**
     * This test documents the expected payload format for full-state operations.
     * Both BackupService and SyncHydrationService should use the UNWRAPPED format.
     *
     * The bug we're preventing:
     * - BackupService was using: { appDataComplete: state }
     * - SyncHydrationService was using: state (unwrapped)
     * - This caused upload service to upload the wrapper, not the state
     */
    it('should handle the unwrapped format (current standard)', () => {
      // This is what SyncHydrationService and fixed BackupService produce
      const unwrappedPayload = validState;

      // extractFullStateFromPayload should return it as-is
      const extracted = extractFullStateFromPayload(unwrappedPayload);
      expect(extracted).toEqual(validState);

      // Validation should pass
      expect(() => assertValidFullStatePayload(extracted, 'test')).not.toThrow();
    });

    it('should still handle legacy wrapped format for backwards compatibility', () => {
      // Old BackupService format - should still work via extractFullStateFromPayload
      const wrappedPayload = { appDataComplete: validState };

      // extractFullStateFromPayload should unwrap it
      const extracted = extractFullStateFromPayload(wrappedPayload);
      expect(extracted).toEqual(validState);

      // Validation should pass
      expect(() => assertValidFullStatePayload(extracted, 'test')).not.toThrow();
    });
  });
});
