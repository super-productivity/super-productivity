/* eslint-disable @typescript-eslint/naming-convention */
import {
  encodeOperation,
  decodeOperation,
  encodeOperationLogEntry,
  decodeOperationLogEntry,
  isCompactOperation,
  isCompactOperationLogEntry,
} from './operation-codec.service';
import {
  Operation,
  OperationLogEntry,
  OpType,
  ActionType,
} from '../../../../op-log/core/operation.types';

describe('operation-codec.service', () => {
  const mockOperation: Operation = {
    id: 'op-123',
    actionType: ActionType.TASK_SHARED_ADD,
    opType: OpType.Create,
    entityType: 'TASK',
    entityId: 'task-456',
    payload: { task: { id: 'task-456', title: 'Test task' } },
    clientId: 'B_a7Kx',
    vectorClock: { B_a7Kx: 1 },
    timestamp: 1703700000000,
    schemaVersion: 1,
  };

  const mockOperationWithOptionals: Operation = {
    ...mockOperation,
    entityIds: ['task-1', 'task-2'],
  };

  describe('encodeOperation', () => {
    it('should encode operation to compact format', () => {
      const compact = encodeOperation(mockOperation);

      expect(compact.id).toBe('op-123'); // id kept for IndexedDB index compatibility
      expect(compact.a).toBe('HA'); // Short code for [Task Shared] addTask
      expect(compact.o).toBe('CRT');
      expect(compact.e).toBe('TASK');
      expect(compact.d).toBe('task-456');
      expect(compact.p).toEqual({ task: { id: 'task-456', title: 'Test task' } });
      expect(compact.c).toBe('B_a7Kx');
      expect(compact.v).toEqual({ B_a7Kx: 1 });
      expect(compact.t).toBe(1703700000000);
      expect(compact.s).toBe(1);
      expect(compact.ds).toBeUndefined();
    });

    it('should encode optional fields when present', () => {
      const compact = encodeOperation(mockOperationWithOptionals);

      expect(compact.ds).toEqual(['task-1', 'task-2']);
    });
  });

  describe('decodeOperation', () => {
    it('should decode compact format back to operation', () => {
      const compact = encodeOperation(mockOperation);
      const decoded = decodeOperation(compact);

      expect(decoded).toEqual(mockOperation);
    });

    it('should round-trip operations with optional fields', () => {
      const compact = encodeOperation(mockOperationWithOptionals);
      const decoded = decodeOperation(compact);

      expect(decoded).toEqual(mockOperationWithOptionals);
    });
  });

  describe('encodeOperationLogEntry', () => {
    it('should encode log entry to compact format', () => {
      const entry: OperationLogEntry = {
        seq: 42,
        op: mockOperation,
        appliedAt: 1703700001000,
        source: 'local',
        syncedAt: 1703700002000,
      };

      const compact = encodeOperationLogEntry(entry);

      expect(compact.seq).toBe(42);
      expect(compact.appliedAt).toBe(1703700001000);
      expect(compact.source).toBe('local');
      expect(compact.syncedAt).toBe(1703700002000);
      expect(compact.op.id).toBe('op-123');
      expect(compact.op.a).toBe('HA');
    });

    it('should encode optional log entry fields', () => {
      const entry: OperationLogEntry = {
        seq: 42,
        op: mockOperation,
        appliedAt: 1703700001000,
        source: 'remote',
        applicationStatus: 'applied',
        retryCount: 2,
        rejectedAt: 1703700003000,
      };

      const compact = encodeOperationLogEntry(entry);

      expect(compact.applicationStatus).toBe('applied');
      expect(compact.retryCount).toBe(2);
      expect(compact.rejectedAt).toBe(1703700003000);
    });
  });

  describe('decodeOperationLogEntry', () => {
    it('should decode compact log entry back to original format', () => {
      const entry: OperationLogEntry = {
        seq: 42,
        op: mockOperation,
        appliedAt: 1703700001000,
        source: 'local',
        syncedAt: 1703700002000,
      };

      const compact = encodeOperationLogEntry(entry);
      const decoded = decodeOperationLogEntry(compact);

      expect(decoded).toEqual(entry);
    });
  });

  describe('isCompactOperation', () => {
    it('should return true for compact operations', () => {
      const compact = encodeOperation(mockOperation);
      expect(isCompactOperation(compact)).toBe(true);
    });

    it('should return false for regular operations', () => {
      expect(isCompactOperation(mockOperation)).toBe(false);
    });

    it('should return false for invalid input', () => {
      expect(isCompactOperation(null)).toBe(false);
      expect(isCompactOperation(undefined)).toBe(false);
      expect(isCompactOperation({})).toBe(false);
      expect(isCompactOperation('string')).toBe(false);
    });
  });

  describe('isCompactOperationLogEntry', () => {
    it('should return true for compact log entries', () => {
      const entry: OperationLogEntry = {
        seq: 42,
        op: mockOperation,
        appliedAt: 1703700001000,
        source: 'local',
      };
      const compact = encodeOperationLogEntry(entry);
      expect(isCompactOperationLogEntry(compact)).toBe(true);
    });

    it('should return false for regular log entries', () => {
      const entry: OperationLogEntry = {
        seq: 42,
        op: mockOperation,
        appliedAt: 1703700001000,
        source: 'local',
      };
      expect(isCompactOperationLogEntry(entry)).toBe(false);
    });
  });

  describe('size comparison', () => {
    it('should produce smaller JSON for compact format', () => {
      const regularJson = JSON.stringify(mockOperation);
      const compactJson = JSON.stringify(encodeOperation(mockOperation));

      // Compact should be noticeably smaller
      expect(compactJson.length).toBeLessThan(regularJson.length);

      // Log the actual sizes for reference
      const savings = regularJson.length - compactJson.length;
      const ratio = compactJson.length / regularJson.length;
      const percent = Math.round((1 - ratio) * 100);
      console.log('Regular size:', regularJson.length, 'bytes');
      console.log('Compact size:', compactJson.length, 'bytes');
      console.log('Savings:', savings, 'bytes', `(${percent}%)`);
    });
  });
});
