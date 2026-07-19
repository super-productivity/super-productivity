import { describe, expect, it } from 'vitest';
import { CURRENT_SCHEMA_VERSION } from '../../src/schema-version';
import { migrateOperation, migrateState } from '../../src/migrate';
import { LwwReplacementBarrierMigration_v2v3 } from '../../src/migrations/lww-replacement-barrier-v2-to-v3';
import type { OperationLike } from '../../src/migration.types';

describe('LWW replacement compatibility barrier v2 -> v3', () => {
  it('makes replacement-mode operations visible as a new schema generation', () => {
    expect(CURRENT_SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
    expect(LwwReplacementBarrierMigration_v2v3.fromVersion).toBe(2);
    expect(LwwReplacementBarrierMigration_v2v3.toVersion).toBe(3);
  });

  it('leaves state without a globalConfig unchanged', () => {
    const state = { task: { ids: ['task-1'] } };

    const result = migrateState(state, 2, 3);

    expect(result.success).toBe(true);
    expect(result.data).toBe(state);
  });

  it('backfills the missing isSuppressIdleDuringFocusMode default (#8965)', () => {
    const state = {
      task: { ids: [] },
      globalConfig: {
        idle: {
          isEnableIdleTimeTracking: true,
          isOnlyOpenIdleWhenCurrentTask: false,
          minIdleTime: 5 * 60 * 1000,
          // isSuppressIdleDuringFocusMode absent (v18.14 snapshot shape)
        },
      },
    };

    const result = migrateState(state, 2, 3);

    expect(result.success).toBe(true);
    const idle = (result.data as { globalConfig: { idle: Record<string, unknown> } })
      .globalConfig.idle;
    expect(idle.isSuppressIdleDuringFocusMode).toBe(false);
    // Existing fields preserved
    expect(idle.isEnableIdleTimeTracking).toBe(true);
    expect(idle.minIdleTime).toBe(5 * 60 * 1000);
  });

  it('never clobbers an existing boolean isSuppressIdleDuringFocusMode value', () => {
    const state = {
      globalConfig: {
        idle: {
          isEnableIdleTimeTracking: true,
          isOnlyOpenIdleWhenCurrentTask: false,
          minIdleTime: 5 * 60 * 1000,
          isSuppressIdleDuringFocusMode: true,
        },
      },
    };

    const result = migrateState(state, 2, 3);

    expect(result.success).toBe(true);
    // Identity when the field is already a boolean — same reference, user choice kept
    expect(result.data).toBe(state);
  });

  it('backfills when the field is present but not a boolean (null/undefined)', () => {
    // A `null`/`undefined` value would otherwise survive the reducer's
    // `{ ...DEFAULT, ...idle }` merge and keep failing validation, so the guard
    // must treat non-boolean the same as absent.
    const state = {
      globalConfig: {
        idle: {
          isEnableIdleTimeTracking: true,
          isOnlyOpenIdleWhenCurrentTask: false,
          minIdleTime: 5 * 60 * 1000,
          isSuppressIdleDuringFocusMode: null,
        },
      },
    };

    const result = migrateState(state, 2, 3);

    expect(result.success).toBe(true);
    const idle = (result.data as { globalConfig: { idle: Record<string, unknown> } })
      .globalConfig.idle;
    expect(idle.isSuppressIdleDuringFocusMode).toBe(false);
  });

  it('leaves state whose globalConfig has no idle section unchanged', () => {
    const state = { globalConfig: { misc: {} } };

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
