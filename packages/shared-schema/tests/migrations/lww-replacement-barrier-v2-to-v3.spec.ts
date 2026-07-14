import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../src/schema-version';
import { migrateOperation, migrateState } from '../../src/migrate';
import { LwwReplacementBarrierMigration_v2v3 } from '../../src/migrations/lww-replacement-barrier-v2-to-v3';
import type { OperationLike } from '../../src/migration.types';

describe('LWW replacement compatibility barrier v2 -> v3', () => {
  it('makes replacement-mode operations visible as a new schema generation', () => {
    expect(CURRENT_SCHEMA_VERSION).toBe(3);
    expect(LwwReplacementBarrierMigration_v2v3.fromVersion).toBe(2);
    expect(LwwReplacementBarrierMigration_v2v3.toVersion).toBe(3);
  });

  it('leaves v2 state data unchanged', () => {
    const state = { task: { ids: ['task-1'] } };

    const result = migrateState(state, 2, 3);

    expect(result.success).toBe(true);
    expect(result.data).toBe(state);
  });

  it('preserves historical v2 operation semantics while stamping schema v3', () => {
    const operation: OperationLike = {
      id: 'legacy-lww',
      opType: 'UPD',
      entityType: 'TASK',
      entityId: 'task-1',
      payload: { id: 'task-1', title: 'Legacy patch payload' },
      schemaVersion: 2,
    };

    const result = migrateOperation(operation, 3);

    expect(result.success).toBe(true);
    expect(result.data).toEqual({ ...operation, schemaVersion: 3 });
  });
});
