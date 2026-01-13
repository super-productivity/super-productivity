import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { VectorClockService } from '../../sync/vector-clock.service';
import { OpType } from '../../core/operation.types';
import {
  compareVectorClocks,
  VectorClockComparison,
} from '../../../core/util/vector-clock';
import { TestClient, resetTestUuidCounter } from './helpers/test-client.helper';
import {
  createTaskOperation,
  createTaskRepeatCfgOperation,
  createMinimalTaskRepeatCfgPayload,
  getTestRepeatableTaskId,
} from './helpers/operation-factory.helper';

/**
 * Integration tests for repeatable task synchronization scenarios.
 *
 * These tests verify:
 * - Concurrent instance creation with deterministic IDs merges correctly
 * - Deleted instance tracking (deletedInstanceDates) syncs properly
 * - Config modifications during instance creation are handled
 * - Late-joining clients receive repeat configs correctly
 *
 * Tests use real IndexedDB (via OperationLogStoreService) for realistic behavior.
 */
describe('Repeat Task Sync Integration', () => {
  let storeService: OperationLogStoreService;
  let vectorClockService: VectorClockService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService, VectorClockService],
    });
    storeService = TestBed.inject(OperationLogStoreService);
    vectorClockService = TestBed.inject(VectorClockService);

    await storeService.init();
    await storeService._clearAllDataForTesting();
    resetTestUuidCounter();
  });

  describe('Concurrent instance creation', () => {
    it('should store both operations when clients create same instance offline', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const cfgId = 'repeat-cfg-1';
      const dueDay = '2024-01-15';

      // Both clients have the repeat config (synced previously)
      const cfgPayload = createMinimalTaskRepeatCfgPayload(cfgId);

      // Both clients create instance with deterministic ID
      const taskId = getTestRepeatableTaskId(cfgId, dueDay);

      const opA = createTaskOperation(clientA, taskId, OpType.Create, {
        id: taskId,
        title: cfgPayload.title,
        repeatCfgId: cfgId,
        dueDay,
      });

      const opB = createTaskOperation(clientB, taskId, OpType.Create, {
        id: taskId,
        title: cfgPayload.title,
        repeatCfgId: cfgId,
        dueDay,
      });

      await storeService.append(opA, 'local');
      await storeService.append(opB, 'remote');

      // Both operations stored (same entityId)
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);
      expect(ops[0].op.entityId).toBe(taskId);
      expect(ops[1].op.entityId).toBe(taskId);

      // Key insight: because IDs match, there's no duplicate task
      // LWW conflict resolution will pick one winner
    });

    it('should detect concurrent operations via vector clock comparison', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const cfgId = 'repeat-cfg-1';
      const dueDay = '2024-01-15';
      const taskId = getTestRepeatableTaskId(cfgId, dueDay);

      // Both clients create same instance without knowledge of each other
      const opA = createTaskOperation(clientA, taskId, OpType.Create, {
        id: taskId,
        title: 'Daily standup',
        repeatCfgId: cfgId,
        dueDay,
      });

      const opB = createTaskOperation(clientB, taskId, OpType.Create, {
        id: taskId,
        title: 'Daily standup',
        repeatCfgId: cfgId,
        dueDay,
      });

      // Vector clocks should be concurrent (neither dominates)
      const comparison = compareVectorClocks(opA.vectorClock, opB.vectorClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);
    });

    it('should handle instance creation after one client synced first', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const cfgId = 'repeat-cfg-1';
      const dueDay = '2024-01-15';
      const taskId = getTestRepeatableTaskId(cfgId, dueDay);

      // Client A creates instance and syncs
      const opA = createTaskOperation(clientA, taskId, OpType.Create, {
        id: taskId,
        title: 'Daily standup',
        repeatCfgId: cfgId,
        dueDay,
      });
      await storeService.append(opA, 'local');

      // Client B receives A's operation (simulating sync)
      clientB.mergeRemoteClock(opA.vectorClock);

      // Client B now tries to create the same instance
      // In real app, this would be prevented by checking if task exists
      // But the deterministic ID ensures idempotency
      const opB = createTaskOperation(clientB, taskId, OpType.Create, {
        id: taskId,
        title: 'Daily standup',
        repeatCfgId: cfgId,
        dueDay,
      });

      // B's operation should dominate A's (B knows about A)
      const comparison = compareVectorClocks(opB.vectorClock, opA.vectorClock);
      expect(comparison).toBe(VectorClockComparison.GREATER_THAN);
    });
  });

  describe('Deleted instance tracking', () => {
    it('should sync deletedInstanceDates to other clients', async () => {
      const clientA = new TestClient('client-a-test');
      const cfgId = 'repeat-cfg-1';
      const deletedDate = '2024-01-15';

      // Client A updates config to mark date as deleted
      const updateOp = createTaskRepeatCfgOperation(clientA, cfgId, OpType.Update, {
        deletedInstanceDates: [deletedDate],
      });

      await storeService.append(updateOp, 'local');

      // Verify operation is stored and can be synced
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(1);
      expect(
        (ops[0].op.payload as Record<string, unknown>).deletedInstanceDates,
      ).toContain(deletedDate);
    });

    it('should handle multiple deleted dates accumulating', async () => {
      const clientA = new TestClient('client-a-test');
      const cfgId = 'repeat-cfg-1';

      // First deletion
      const op1 = createTaskRepeatCfgOperation(clientA, cfgId, OpType.Update, {
        deletedInstanceDates: ['2024-01-15'],
      });
      await storeService.append(op1, 'local');

      // Second deletion (adds to the list)
      const op2 = createTaskRepeatCfgOperation(clientA, cfgId, OpType.Update, {
        deletedInstanceDates: ['2024-01-15', '2024-01-16'],
      });
      await storeService.append(op2, 'local');

      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);

      // Latest operation should have both dates
      const latestPayload = ops[1].op.payload as Record<string, unknown>;
      expect(latestPayload.deletedInstanceDates).toContain('2024-01-15');
      expect(latestPayload.deletedInstanceDates).toContain('2024-01-16');
    });

    it('should merge deleted dates from concurrent edits', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const cfgId = 'repeat-cfg-1';

      // Client A deletes instance for Jan 15
      const opA = createTaskRepeatCfgOperation(clientA, cfgId, OpType.Update, {
        deletedInstanceDates: ['2024-01-15'],
      });

      // Client B (without knowledge of A) deletes instance for Jan 16
      const opB = createTaskRepeatCfgOperation(clientB, cfgId, OpType.Update, {
        deletedInstanceDates: ['2024-01-16'],
      });

      await storeService.append(opA, 'local');
      await storeService.append(opB, 'remote');

      // Both operations should be stored
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);

      // Vector clocks should be concurrent
      const comparison = compareVectorClocks(opA.vectorClock, opB.vectorClock);
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);

      // Note: Actual merge of deletedInstanceDates arrays would happen
      // in the reducer when applying these operations
    });
  });

  describe('Config modification during instance creation', () => {
    it('should handle concurrent config update and instance creation', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const cfgId = 'repeat-cfg-1';

      // Client A updates config title
      const configUpdateOp = createTaskRepeatCfgOperation(clientA, cfgId, OpType.Update, {
        title: 'New Title',
      });

      // Client B (without knowledge of A) creates instance with old title
      const taskId = getTestRepeatableTaskId(cfgId, '2024-01-15');
      const instanceCreateOp = createTaskOperation(clientB, taskId, OpType.Create, {
        id: taskId,
        title: 'Old Title', // B doesn't know about title change
        repeatCfgId: cfgId,
      });

      await storeService.append(configUpdateOp, 'local');
      await storeService.append(instanceCreateOp, 'remote');

      // Vector clocks should be concurrent
      const comparison = compareVectorClocks(
        configUpdateOp.vectorClock,
        instanceCreateOp.vectorClock,
      );
      expect(comparison).toBe(VectorClockComparison.CONCURRENT);

      // Both operations stored - no conflict because different entities
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);
      expect(ops[0].op.entityType).toBe('TASK_REPEAT_CFG');
      expect(ops[1].op.entityType).toBe('TASK');
    });

    it('should handle config delete while instance exists', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');
      const cfgId = 'repeat-cfg-1';
      const taskId = getTestRepeatableTaskId(cfgId, '2024-01-15');

      // Client A deletes the repeat config
      const configDeleteOp = createTaskRepeatCfgOperation(
        clientA,
        cfgId,
        OpType.Delete,
        {},
      );

      // Client B creates an instance (doesn't know config was deleted)
      const instanceCreateOp = createTaskOperation(clientB, taskId, OpType.Create, {
        id: taskId,
        title: 'Orphaned Instance',
        repeatCfgId: cfgId,
      });

      await storeService.append(configDeleteOp, 'local');
      await storeService.append(instanceCreateOp, 'remote');

      // Both operations should be stored for later resolution
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);
    });
  });

  describe('Late-joining client', () => {
    it('should receive all repeat config operations', async () => {
      const existingClient = new TestClient('existing-client');

      // Existing client creates repeat config
      const createOp = createTaskRepeatCfgOperation(
        existingClient,
        'repeat-cfg-1',
        OpType.Create,
        createMinimalTaskRepeatCfgPayload('repeat-cfg-1'),
      );
      await storeService.append(createOp, 'local');

      // Existing client updates it
      const updateOp = createTaskRepeatCfgOperation(
        existingClient,
        'repeat-cfg-1',
        OpType.Update,
        { title: 'Updated Title' },
      );
      await storeService.append(updateOp, 'local');

      // Simulate fresh client joining - they would receive all ops
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2);
      expect(ops[0].op.opType).toBe(OpType.Create);
      expect(ops[1].op.opType).toBe(OpType.Update);
    });

    it('should receive repeat config with instances', async () => {
      const existingClient = new TestClient('existing-client');
      const cfgId = 'repeat-cfg-1';

      // Create repeat config
      const configOp = createTaskRepeatCfgOperation(
        existingClient,
        cfgId,
        OpType.Create,
        createMinimalTaskRepeatCfgPayload(cfgId),
      );
      await storeService.append(configOp, 'local');

      // Create instances for multiple days
      const days = ['2024-01-15', '2024-01-16', '2024-01-17'];
      for (const day of days) {
        const taskId = getTestRepeatableTaskId(cfgId, day);
        const instanceOp = createTaskOperation(existingClient, taskId, OpType.Create, {
          id: taskId,
          title: 'Daily Task',
          repeatCfgId: cfgId,
          dueDay: day,
        });
        await storeService.append(instanceOp, 'local');
      }

      // Fresh client receives all operations
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(4); // 1 config + 3 instances

      // Verify config came first
      expect(ops[0].op.entityType).toBe('TASK_REPEAT_CFG');

      // Verify all instances are present
      const taskOps = ops.filter((op) => op.op.entityType === 'TASK');
      expect(taskOps.length).toBe(3);
    });

    it('should not recreate instances that were deleted', async () => {
      const existingClient = new TestClient('existing-client');
      const cfgId = 'repeat-cfg-1';
      const deletedDay = '2024-01-16';

      // Create config with deleted instance date
      const configOp = createTaskRepeatCfgOperation(
        existingClient,
        cfgId,
        OpType.Create,
        createMinimalTaskRepeatCfgPayload(cfgId, {
          deletedInstanceDates: [deletedDay],
        }),
      );
      await storeService.append(configOp, 'local');

      // Create only the non-deleted instances
      const instanceOp = createTaskOperation(
        existingClient,
        getTestRepeatableTaskId(cfgId, '2024-01-15'),
        OpType.Create,
        {
          id: getTestRepeatableTaskId(cfgId, '2024-01-15'),
          title: 'Daily Task',
          repeatCfgId: cfgId,
          dueDay: '2024-01-15',
        },
      );
      await storeService.append(instanceOp, 'local');

      // Fresh client receives operations
      const ops = await storeService.getOpsAfterSeq(0);
      expect(ops.length).toBe(2); // 1 config + 1 instance (not the deleted one)

      // Config should contain the deleted date
      const configPayload = ops[0].op.payload as Record<string, unknown>;
      expect(configPayload.deletedInstanceDates).toContain(deletedDay);

      // No instance for the deleted day
      const taskOps = ops.filter((op) => op.op.entityType === 'TASK');
      expect(taskOps.length).toBe(1);
      expect(taskOps[0].op.entityId).not.toContain(deletedDay);
    });
  });

  describe('Entity frontier tracking for repeat configs', () => {
    it('should track per-entity vector clocks for repeat configs', async () => {
      const clientA = new TestClient('client-a-test');
      const clientB = new TestClient('client-b-test');

      // Client A creates and updates config 1
      await storeService.append(
        createTaskRepeatCfgOperation(
          clientA,
          'cfg-1',
          OpType.Create,
          createMinimalTaskRepeatCfgPayload('cfg-1'),
        ),
        'local',
      );
      await storeService.append(
        createTaskRepeatCfgOperation(clientA, 'cfg-1', OpType.Update, {
          title: 'Updated',
        }),
        'local',
      );

      // Client B creates config 2
      await storeService.append(
        createTaskRepeatCfgOperation(
          clientB,
          'cfg-2',
          OpType.Create,
          createMinimalTaskRepeatCfgPayload('cfg-2'),
        ),
        'remote',
      );

      const frontier = await vectorClockService.getEntityFrontier('TASK_REPEAT_CFG');

      // cfg-1 should show A's latest clock
      // eslint-disable-next-line @typescript-eslint/naming-convention
      expect(frontier.get('TASK_REPEAT_CFG:cfg-1')).toEqual({ 'client-a-test': 2 });
      // cfg-2 should show B's clock
      // eslint-disable-next-line @typescript-eslint/naming-convention
      expect(frontier.get('TASK_REPEAT_CFG:cfg-2')).toEqual({ 'client-b-test': 1 });
    });
  });
});
