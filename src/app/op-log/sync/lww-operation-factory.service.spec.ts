import { TestBed } from '@angular/core/testing';
import { LWWOperationFactory } from './lww-operation-factory.service';
import { EntityType, OpType, VectorClock } from '../core/operation.types';
import { CURRENT_SCHEMA_VERSION } from '../persistence/schema-migration.service';

describe('LWWOperationFactory', () => {
  let service: LWWOperationFactory;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [LWWOperationFactory],
    });
    service = TestBed.inject(LWWOperationFactory);
  });

  describe('createLWWUpdateOp', () => {
    const entityType: EntityType = 'TASK';
    const entityId = 'task-123';
    const entityState = { id: entityId, title: 'Test Task', done: false };
    const clientId = 'client_abc';
    const vectorClock: VectorClock = { client_abc: 5, client_xyz: 3 };
    const timestamp = 1700000000000;

    it('should create operation with correct action type format [ENTITY] LWW Update', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.actionType).toBe('[TASK] LWW Update');
    });

    it('should create action type for different entity types', () => {
      const projectOp = service.createLWWUpdateOp(
        'PROJECT',
        'proj-1',
        {},
        clientId,
        vectorClock,
        timestamp,
      );
      expect(projectOp.actionType).toBe('[PROJECT] LWW Update');

      const tagOp = service.createLWWUpdateOp(
        'TAG',
        'tag-1',
        {},
        clientId,
        vectorClock,
        timestamp,
      );
      expect(tagOp.actionType).toBe('[TAG] LWW Update');
    });

    it('should assign correct opType (Update)', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.opType).toBe(OpType.Update);
    });

    it('should use provided entityType and entityId', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.entityType).toBe(entityType);
      expect(op.entityId).toBe(entityId);
    });

    it('should include entityState as payload', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.payload).toEqual(entityState);
    });

    it('should generate UUIDv7 ID', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      // UUIDv7 format: 8-4-4-4-12 hex characters
      expect(op.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
      );
    });

    it('should generate unique IDs for each call', () => {
      const op1 = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );
      const op2 = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op1.id).not.toBe(op2.id);
    });

    it('should include CURRENT_SCHEMA_VERSION', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    });

    it('should preserve provided vectorClock', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.vectorClock).toEqual(vectorClock);
    });

    it('should preserve provided timestamp', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.timestamp).toBe(timestamp);
    });

    it('should preserve provided clientId', () => {
      const op = service.createLWWUpdateOp(
        entityType,
        entityId,
        entityState,
        clientId,
        vectorClock,
        timestamp,
      );

      expect(op.clientId).toBe(clientId);
    });
  });

  describe('mergeAndIncrementClocks', () => {
    it('should return incremented clock for single input clock', () => {
      const clock: VectorClock = { clientA: 5 };
      const result = service.mergeAndIncrementClocks([clock], 'clientA');

      expect(result).toEqual({ clientA: 6 });
    });

    it('should merge two clocks taking max of each component', () => {
      const clock1: VectorClock = { clientA: 5, clientB: 3 };
      const clock2: VectorClock = { clientA: 3, clientB: 7 };
      const result = service.mergeAndIncrementClocks([clock1, clock2], 'clientA');

      expect(result['clientA']).toBe(6); // max(5,3) + 1
      expect(result['clientB']).toBe(7); // max(3,7)
    });

    it('should merge three+ clocks correctly', () => {
      const clock1: VectorClock = { clientA: 1 };
      const clock2: VectorClock = { clientA: 5, clientB: 2 };
      const clock3: VectorClock = { clientB: 8, clientC: 3 };
      const result = service.mergeAndIncrementClocks([clock1, clock2, clock3], 'clientA');

      expect(result['clientA']).toBe(6); // max(1,5,0) + 1
      expect(result['clientB']).toBe(8); // max(0,2,8)
      expect(result['clientC']).toBe(3); // max(0,0,3)
    });

    it('should handle empty clocks array', () => {
      const result = service.mergeAndIncrementClocks([], 'clientA');

      expect(result).toEqual({ clientA: 1 });
    });

    it('should increment merged clock for given clientId', () => {
      const clock: VectorClock = { clientA: 10, clientB: 5 };
      const result = service.mergeAndIncrementClocks([clock], 'clientB');

      expect(result['clientA']).toBe(10); // unchanged
      expect(result['clientB']).toBe(6); // incremented
    });

    it('should add new clientId if not in any input clocks', () => {
      const clock: VectorClock = { clientA: 5 };
      const result = service.mergeAndIncrementClocks([clock], 'clientNew');

      expect(result['clientA']).toBe(5); // preserved
      expect(result['clientNew']).toBe(1); // new entry, starts at 1
    });

    it('should handle clocks with non-overlapping clients', () => {
      const clock1: VectorClock = { clientA: 3 };
      const clock2: VectorClock = { clientB: 7 };
      const result = service.mergeAndIncrementClocks([clock1, clock2], 'clientC');

      expect(result['clientA']).toBe(3);
      expect(result['clientB']).toBe(7);
      expect(result['clientC']).toBe(1);
    });
  });
});
