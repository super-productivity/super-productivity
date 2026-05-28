import { describe, expect, it } from 'vitest';
import {
  FULL_STATE_OP_TYPES,
  createFullStateOpTypeHelpers,
  isFullStateOpType,
} from '../src/full-state-op-types';
import {
  partitionLwwResolutions,
  planLwwConflictResolutions,
} from '../src/conflict-resolution';
import { OpType } from '../src/operation.types';
import type {
  ConflictResult,
  EntityConflict,
  MultiEntityPayload,
  Operation,
  OperationLogEntry,
} from '../src/operation.types';

describe('createFullStateOpTypeHelpers', () => {
  it('classifies only the host-supplied op types as full-state operations', () => {
    const helpers = createFullStateOpTypeHelpers([
      'SYNC_IMPORT',
      'BACKUP_IMPORT',
      'REPAIR',
    ] as const);

    expect(helpers.FULL_STATE_OP_TYPES.has('SYNC_IMPORT')).toBe(true);
    expect(helpers.FULL_STATE_OP_TYPES.has('BACKUP_IMPORT')).toBe(true);
    expect(helpers.FULL_STATE_OP_TYPES.has('REPAIR')).toBe(true);
    expect(helpers.isFullStateOpType('SYNC_IMPORT')).toBe(true);
    expect(helpers.isFullStateOpType('CRT')).toBe(false);
  });

  it('does not hard-code Super Productivity full-state op names', () => {
    const helpers = createFullStateOpTypeHelpers(['HOST_FULL_REPLACE'] as const);

    expect(helpers.FULL_STATE_OP_TYPES.has('HOST_FULL_REPLACE')).toBe(true);
    expect(helpers.isFullStateOpType('HOST_FULL_REPLACE')).toBe(true);
    expect(helpers.isFullStateOpType('SYNC_IMPORT')).toBe(false);
  });

  it('keeps deprecated Super Productivity compatibility exports', () => {
    expect(FULL_STATE_OP_TYPES.has(OpType.SyncImport)).toBe(true);
    expect(FULL_STATE_OP_TYPES.has(OpType.BackupImport)).toBe(true);
    expect(FULL_STATE_OP_TYPES.has(OpType.Repair)).toBe(true);
    expect(isFullStateOpType(OpType.SyncImport)).toBe(true);
    expect(isFullStateOpType(OpType.Create)).toBe(false);
  });

  it('allows host-specific operation opType strings across exported wrappers', () => {
    type HostOpType = OpType | 'HOST_FULL_REPLACE';
    type HostOperation = Operation<HostOpType>;

    const hostOp: HostOperation = {
      id: 'op-1',
      actionType: '[Host] Replace State',
      opType: 'HOST_FULL_REPLACE',
      entityType: 'HOST_ENTITY',
      payload: {},
      clientId: 'client-1',
      vectorClock: { client1: 1 },
      timestamp: 1,
      schemaVersion: 1,
    };
    const entry: OperationLogEntry<HostOperation> = {
      seq: 1,
      op: hostOp,
      appliedAt: 1,
      source: 'local',
    };
    const conflict: EntityConflict<HostOperation> = {
      entityType: 'HOST_ENTITY',
      entityId: 'entity-1',
      localOps: [hostOp],
      remoteOps: [hostOp],
      suggestedResolution: 'manual',
    };
    const result: ConflictResult<HostOperation> = {
      nonConflicting: [hostOp],
      conflicts: [conflict],
    };
    const multiEntityPayload: MultiEntityPayload<HostOpType> = {
      actionPayload: {},
      entityChanges: [
        {
          entityType: 'HOST_ENTITY',
          entityId: 'entity-1',
          opType: 'HOST_FULL_REPLACE',
          changes: {},
        },
      ],
    };
    const plans = planLwwConflictResolutions<HostOperation>([conflict], {
      isArchiveAction: (op: HostOperation): boolean => op.actionType === '[Host] Archive',
    });
    const partitions = partitionLwwResolutions<HostOperation>(plans);

    expect(entry.op.opType).toBe('HOST_FULL_REPLACE');
    expect(result.conflicts[0].localOps[0].opType).toBe('HOST_FULL_REPLACE');
    expect(multiEntityPayload.entityChanges[0].opType).toBe('HOST_FULL_REPLACE');
    expect(partitions.remoteWinsOps[0].opType).toBe('HOST_FULL_REPLACE');
  });
});
