import { describe, it, expect, beforeEach } from 'vitest';
import {
  ValidationService,
  ALLOWED_ENTITY_TYPES,
} from '../src/sync/services/validation.service';
import { DEFAULT_SYNC_CONFIG, SYNC_ERROR_CODES } from '../src/sync/sync.types';

describe('ValidationService', () => {
  let validationService: ValidationService;
  const clientId = 'test-client-123';

  beforeEach(() => {
    validationService = new ValidationService(DEFAULT_SYNC_CONFIG);
  });

  const createValidOp = (overrides: Record<string, unknown> = {}) => ({
    id: 'op-1',
    clientId,
    opType: 'CRT' as const,
    entityType: 'TASK',
    entityId: 'entity-1',
    payload: { name: 'Test' },
    timestamp: Date.now(),
    vectorClock: { [clientId]: 1 },
    ...overrides,
  });

  describe('validateOp', () => {
    it('should accept a valid operation', () => {
      const op = createValidOp();
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should reject when clientId does not match', () => {
      const op = createValidOp();
      const result = validationService.validateOp(op, 'different-client');
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_CLIENT_ID);
      expect(result.error).toContain('does not match');
    });

    it('should reject missing operation ID', () => {
      const op = createValidOp({ id: '' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_OP_ID);
    });

    it('should reject non-string operation ID', () => {
      const op = createValidOp({ id: 123 });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_OP_ID);
    });

    it('should reject operation ID longer than 255 characters', () => {
      const op = createValidOp({ id: 'x'.repeat(256) });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_OP_ID);
      expect(result.error).toContain('too long');
    });

    it('should reject invalid opType', () => {
      const op = createValidOp({ opType: 'INVALID' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_OP_TYPE);
    });

    it('should reject missing opType', () => {
      const op = createValidOp({ opType: '' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_OP_TYPE);
    });

    it('should reject missing entityType', () => {
      const op = createValidOp({ entityType: '' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_TYPE);
    });

    it('should reject invalid entityType', () => {
      const op = createValidOp({ entityType: 'UNKNOWN_TYPE' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_TYPE);
      expect(result.error).toContain('Invalid entityType');
    });

    it('should accept all allowed entity types', () => {
      for (const entityType of ALLOWED_ENTITY_TYPES) {
        const op = createValidOp({ entityType });
        const result = validationService.validateOp(op, clientId);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject entityId longer than 255 characters', () => {
      const op = createValidOp({ entityId: 'x'.repeat(256) });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_ID);
    });

    it('should reject non-string entityId', () => {
      const op = createValidOp({ entityId: 123 });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_ID);
    });

    // === entityId validation for regular entity types ===

    it('should reject null entityId for regular entity type (TASK)', () => {
      const op = createValidOp({ entityId: null, opType: 'CRT', entityType: 'TASK' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.MISSING_ENTITY_ID);
      expect(result.error).toContain('requires entityId');
    });

    it('should reject undefined entityId for regular entity type (TAG)', () => {
      const op = createValidOp({ entityId: undefined, opType: 'UPD', entityType: 'TAG' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.MISSING_ENTITY_ID);
    });

    it('should reject missing entityId for DEL operation', () => {
      const op = createValidOp({ opType: 'DEL', entityId: null });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.MISSING_ENTITY_ID);
    });

    it('should accept DEL operation with valid entityId', () => {
      const op = createValidOp({ opType: 'DEL', entityId: 'entity-1' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    // === entityId validation for bulk entity types (ALL, RECOVERY) ===

    it('should accept null entityId for entityType ALL', () => {
      const op = createValidOp({ entityId: null, opType: 'UPD', entityType: 'ALL' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should accept null entityId for entityType RECOVERY', () => {
      const op = createValidOp({
        entityId: null,
        opType: 'BATCH',
        entityType: 'RECOVERY',
      });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    // === entityId validation for full-state operations ===

    it('should accept null entityId for SYNC_IMPORT operation', () => {
      const op = createValidOp({
        entityId: null,
        opType: 'SYNC_IMPORT',
        entityType: 'TASK',
        payload: { appDataComplete: {} },
      });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should accept null entityId for BACKUP_IMPORT operation', () => {
      const op = createValidOp({
        entityId: null,
        opType: 'BACKUP_IMPORT',
        entityType: 'PROJECT',
        payload: { appDataComplete: {} },
      });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should accept null entityId for REPAIR operation', () => {
      const op = createValidOp({
        entityId: null,
        opType: 'REPAIR',
        entityType: 'TAG',
        payload: { appDataComplete: {} },
      });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    // === entityId validation edge cases ===

    it('should reject empty string entityId', () => {
      const op = createValidOp({ entityId: '', opType: 'CRT', entityType: 'TASK' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_ID);
      expect(result.error).toContain('empty');
    });

    it('should reject whitespace-only entityId', () => {
      const op = createValidOp({ entityId: '   ', opType: 'UPD', entityType: 'TASK' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_ID);
      expect(result.error).toContain('empty');
    });

    it('should reject tab and newline-only entityId', () => {
      const op = createValidOp({
        entityId: '\t\n  \r',
        opType: 'CRT',
        entityType: 'PROJECT',
      });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_ID);
    });

    it('should include opType and entityType in error message for missing entityId', () => {
      const op = createValidOp({ entityId: null, opType: 'UPD', entityType: 'PROJECT' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.error).toContain('UPD');
      expect(result.error).toContain('PROJECT');
    });

    it('should reject missing entityId for all regular entity types', () => {
      const regularEntityTypes = [
        'TASK',
        'PROJECT',
        'TAG',
        'NOTE',
        'GLOBAL_CONFIG',
        'TIME_TRACKING',
        'SIMPLE_COUNTER',
        'WORK_CONTEXT',
        'TASK_REPEAT_CFG',
        'ISSUE_PROVIDER',
        'PLANNER',
        'MENU_TREE',
        'METRIC',
        'BOARD',
        'REMINDER',
        'PLUGIN_USER_DATA',
        'PLUGIN_METADATA',
      ];

      for (const entityType of regularEntityTypes) {
        const op = createValidOp({ entityId: null, opType: 'UPD', entityType });
        const result = validationService.validateOp(op, clientId);
        expect(result.valid).toBe(false);
        expect(result.errorCode).toBe(SYNC_ERROR_CODES.MISSING_ENTITY_ID);
      }
    });

    it('should reject undefined payload', () => {
      const op = createValidOp({ payload: undefined });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_PAYLOAD);
    });

    it('should reject schema version less than 1', () => {
      const op = createValidOp({ schemaVersion: 0 });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_SCHEMA_VERSION);
    });

    it('should reject schema version greater than 100', () => {
      const op = createValidOp({ schemaVersion: 101 });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_SCHEMA_VERSION);
    });

    it('should accept valid schema versions 1-100', () => {
      for (const schemaVersion of [1, 50, 100]) {
        const op = createValidOp({ schemaVersion });
        const result = validationService.validateOp(op, clientId);
        expect(result.valid).toBe(true);
      }
    });

    it('should reject invalid vector clock format', () => {
      const op = createValidOp({ vectorClock: 'invalid' });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_VECTOR_CLOCK);
    });

    it('should strip invalid vector clock entries (non-numeric values)', () => {
      const op = createValidOp({ vectorClock: { client1: '5', client2: 10 } });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
      // String values are stripped, only valid numeric entries remain
      expect(op.vectorClock).toEqual({ client2: 10 });
    });

    it('should reject deeply nested payloads', () => {
      let payload: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 25; i++) {
        payload = { nested: payload };
      }
      const op = createValidOp({ payload });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_PAYLOAD);
      expect(result.error).toContain('too complex');
    });

    it('should skip payload complexity check for SYNC_IMPORT', () => {
      let payload: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 25; i++) {
        payload = { nested: payload };
      }
      const op = createValidOp({ opType: 'SYNC_IMPORT', payload, entityId: null });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should skip payload complexity check for BACKUP_IMPORT', () => {
      let payload: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 25; i++) {
        payload = { nested: payload };
      }
      const op = createValidOp({ opType: 'BACKUP_IMPORT', payload, entityId: null });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should skip payload complexity check for REPAIR', () => {
      let payload: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 25; i++) {
        payload = { nested: payload };
      }
      const op = createValidOp({ opType: 'REPAIR', payload, entityId: null });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should reject payloads larger than max size', () => {
      const service = new ValidationService({
        ...DEFAULT_SYNC_CONFIG,
        maxPayloadSizeBytes: 100,
      });
      const op = createValidOp({ payload: { data: 'x'.repeat(200) } });
      const result = service.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.PAYLOAD_TOO_LARGE);
    });

    it('should accept timestamps in the future (clamping handled by SyncService)', () => {
      // Future timestamp validation removed - clamping is handled in SyncService.processOperation()
      const futureTime = Date.now() + 10 * 60 * 1000; // 10 minutes in future
      const op = createValidOp({ timestamp: futureTime });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(true);
    });

    it('should reject timestamps too old', () => {
      const oldTime = Date.now() - 50 * 24 * 60 * 60 * 1000; // 50 days ago (beyond 45-day retention)
      const op = createValidOp({ timestamp: oldTime });
      const result = validationService.validateOp(op, clientId);
      expect(result.valid).toBe(false);
      expect(result.errorCode).toBe(SYNC_ERROR_CODES.INVALID_TIMESTAMP);
      expect(result.error).toContain('too old');
    });
  });

  describe('validatePayloadComplexity', () => {
    it('should accept simple objects', () => {
      const result = validationService.validatePayloadComplexity({ a: 1, b: 2 });
      expect(result).toBe(true);
    });

    it('should accept null', () => {
      const result = validationService.validatePayloadComplexity(null);
      expect(result).toBe(true);
    });

    it('should accept primitives', () => {
      expect(validationService.validatePayloadComplexity('string')).toBe(true);
      expect(validationService.validatePayloadComplexity(123)).toBe(true);
      expect(validationService.validatePayloadComplexity(true)).toBe(true);
    });

    it('should accept arrays within limits', () => {
      const result = validationService.validatePayloadComplexity([1, 2, 3, 4, 5]);
      expect(result).toBe(true);
    });

    it('should reject objects exceeding max depth', () => {
      let obj: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 25; i++) {
        obj = { nested: obj };
      }
      const result = validationService.validatePayloadComplexity(obj);
      expect(result).toBe(false);
    });

    it('should respect custom max depth', () => {
      let obj: Record<string, unknown> = { value: 'leaf' };
      for (let i = 0; i < 5; i++) {
        obj = { nested: obj };
      }
      // 6 levels deep
      expect(validationService.validatePayloadComplexity(obj, 5)).toBe(false);
      expect(validationService.validatePayloadComplexity(obj, 10)).toBe(true);
    });

    it('should reject objects with too many keys', () => {
      const obj: Record<string, number> = {};
      for (let i = 0; i < 25000; i++) {
        obj[`key${i}`] = i;
      }
      const result = validationService.validatePayloadComplexity(obj);
      expect(result).toBe(false);
    });

    it('should respect custom max keys', () => {
      const obj: Record<string, number> = {};
      for (let i = 0; i < 100; i++) {
        obj[`key${i}`] = i;
      }
      expect(validationService.validatePayloadComplexity(obj, 20, 50)).toBe(false);
      expect(validationService.validatePayloadComplexity(obj, 20, 200)).toBe(true);
    });

    it('should count array elements towards key limit', () => {
      const arr = new Array(25000).fill(1);
      const result = validationService.validatePayloadComplexity(arr);
      expect(result).toBe(false);
    });

    it('should handle nested arrays', () => {
      const result = validationService.validatePayloadComplexity([[[[[[1]]]]]]);
      expect(result).toBe(true);
    });
  });

  describe('ALLOWED_ENTITY_TYPES', () => {
    it('should include all expected entity types', () => {
      const expectedTypes = [
        'TASK',
        'PROJECT',
        'TAG',
        'NOTE',
        'GLOBAL_CONFIG',
        'TIME_TRACKING',
        'SIMPLE_COUNTER',
        'WORK_CONTEXT',
        'TASK_REPEAT_CFG',
        'ISSUE_PROVIDER',
        'PLANNER',
        'MENU_TREE',
        'METRIC',
        'BOARD',
        'REMINDER',
        'MIGRATION',
        'RECOVERY',
        'ALL',
        'PLUGIN_USER_DATA',
        'PLUGIN_METADATA',
      ];

      for (const type of expectedTypes) {
        expect(ALLOWED_ENTITY_TYPES.has(type)).toBe(true);
      }
    });

    it('should have exactly the expected number of entity types', () => {
      expect(ALLOWED_ENTITY_TYPES.size).toBe(20);
    });
  });
});
