/**
 * Operation Log Performance Benchmarks
 *
 * These are NOT regular unit tests - they are manual performance benchmarks
 * for measuring IndexedDB operation throughput.
 *
 * To run these benchmarks:
 * 1. Change `xdescribe` to `describe` below
 * 2. Run: npm run test:file src/app/op-log/testing/benchmarks/operation-log-stress.benchmark.ts
 * 3. Watch the console output for timing information
 *
 * Note: Results vary significantly based on:
 * - Browser/test runner
 * - System I/O performance
 * - Concurrent processes
 *
 * These tests are excluded from regular test runs to avoid flaky CI failures
 * due to timing dependencies on system load.
 */
import { TestBed } from '@angular/core/testing';
import { OperationLogStoreService } from '../../persistence/operation-log-store.service';
import { ActionType, Operation, OpType, EntityType } from '../../core/operation.types';
import { uuidv7 } from '../../../util/uuid-v7';

// Increase timeout for stress tests
jasmine.DEFAULT_TIMEOUT_INTERVAL = 60000;

// Change to `describe` to run benchmarks
xdescribe('OperationLog Performance Benchmarks', () => {
  let service: OperationLogStoreService;

  beforeEach(async () => {
    TestBed.configureTestingModule({
      providers: [OperationLogStoreService],
    });
    service = TestBed.inject(OperationLogStoreService);
    await service.init();
    // Clear all data from previous tests to ensure test isolation
    await service._clearAllDataForTesting();
  });

  it('benchmark: 1000 sequential writes', async () => {
    const COUNT = 1000;
    const ops: Operation[] = [];
    const now = Date.now();

    console.log(`Generating ${COUNT} operations...`);
    for (let i = 0; i < COUNT; i++) {
      ops.push({
        id: uuidv7(),
        actionType: '[Task] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: `task-${i}`,
        payload: { title: `Task ${i} title`, description: 'Some description' },
        clientId: 'stressTestClient',
        vectorClock: { stressTestClient: i },
        timestamp: now + i,
        schemaVersion: 1,
      });
    }

    const startWrite = performance.now();
    for (const op of ops) {
      await service.append(op);
    }
    const endWrite = performance.now();
    const writeTime = endWrite - startWrite;
    console.log(`Write time for ${COUNT} ops: ${writeTime.toFixed(2)}ms`);
    console.log(`Average per op: ${(writeTime / COUNT).toFixed(2)}ms`);

    // Expect reasonably fast writes (under 2ms per op on average)
    expect(writeTime).toBeLessThan(COUNT * 2);
    expect((await service.getOpsAfterSeq(0)).length).toBeGreaterThanOrEqual(COUNT);
  });

  it('benchmark: 1000 large payload writes (10KB each)', async () => {
    const COUNT = 1000;
    const ops: Operation[] = [];
    const now = Date.now();
    const largeString = 'x'.repeat(1024 * 10); // 10KB

    console.log(`Generating ${COUNT} large operations...`);
    for (let i = 0; i < COUNT; i++) {
      ops.push({
        id: uuidv7(),
        actionType: '[Note] Update' as ActionType,
        opType: OpType.Update,
        entityType: 'NOTE' as EntityType,
        entityId: `note-${i}`,
        payload: { content: largeString },
        clientId: 'stressTestClient',
        vectorClock: { stressTestClient: i },
        timestamp: now + i,
        schemaVersion: 1,
      });
    }

    const startWrite = performance.now();
    for (const op of ops) {
      await service.append(op);
    }
    const endWrite = performance.now();
    const writeTime = endWrite - startWrite;
    console.log(`Write time for ${COUNT} LARGE ops: ${writeTime.toFixed(2)}ms`);
    console.log(`Average per op: ${(writeTime / COUNT).toFixed(2)}ms`);

    // Expect under 5ms per large op
    expect(writeTime).toBeLessThan(COUNT * 5);

    const startRead = performance.now();
    const opsInDb = await service.getOpsAfterSeq(0);
    const endRead = performance.now();
    console.log(
      `Read time for ${opsInDb.length} LARGE ops: ${(endRead - startRead).toFixed(2)}ms`,
    );
  });

  it('benchmark: scan and delete 100 ops from 10k total', async () => {
    const NOISE_COUNT = 10000;
    const ops: Operation[] = [];
    const now = Date.now();

    console.log(`Setting up ${NOISE_COUNT} noise operations...`);
    for (let i = 0; i < NOISE_COUNT; i++) {
      ops.push({
        id: uuidv7(),
        actionType: '[Task] Noise' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: `noise-${i}`,
        payload: {},
        clientId: 'stressTestClient',
        vectorClock: { stressTestClient: i },
        timestamp: now + i,
        schemaVersion: 1,
      });
    }
    // Bulk append noise (simulated via promise.all for setup speed)
    await Promise.all(ops.map((op) => service.append(op)));

    // Add 100 ops to delete
    const delOps: Operation[] = [];
    for (let i = 0; i < 100; i++) {
      delOps.push({
        id: uuidv7(),
        actionType: '[Task] DeleteMe' as ActionType,
        opType: OpType.Update,
        entityType: 'TASK' as EntityType,
        entityId: `del-${i}`,
        payload: {},
        clientId: 'stressTestClient',
        vectorClock: { stressTestClient: i },
        timestamp: now + NOISE_COUNT + i,
        schemaVersion: 1,
      });
    }
    await Promise.all(delOps.map((op) => service.append(op)));

    const initialCount = (await service.getOpsAfterSeq(0)).length;
    console.log(`Starting delete from ${initialCount} total ops...`);

    const startDelete = performance.now();
    // Delete ops with actionType '[Task] DeleteMe' - requires scanning everything
    await service.deleteOpsWhere(
      (entry) => entry.op.actionType === ('[Task] DeleteMe' as ActionType),
    );
    const endDelete = performance.now();

    const deleteTime = endDelete - startDelete;
    console.log(
      `Deleted 100 ops from ~${initialCount} total in ${deleteTime.toFixed(2)}ms`,
    );

    const finalCount = (await service.getOpsAfterSeq(0)).length;
    expect(finalCount).toBe(initialCount - 100);

    // Expect scan speed to be reasonable (e.g. < 1000ms for 10k items)
    expect(deleteTime).toBeLessThan(1000);
  });
});
