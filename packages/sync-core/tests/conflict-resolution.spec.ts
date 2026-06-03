import { describe, expect, it, vi } from 'vitest';
import {
  convertLocalDeleteRemoteUpdatesToLww,
  deepEqual,
  isIdenticalConflict,
  partitionLwwResolutions,
  planLwwConflictResolutions,
  suggestConflictResolution,
} from '../src/conflict-resolution';
import { adjustForClockCorruption, buildEntityFrontier } from '../src/entity-frontier';
import {
  extractEntityFromPayload,
  extractUpdateChanges,
  OpType,
} from '../src/operation.types';
import type { EntityConflict, Operation } from '../src/operation.types';
import type { SyncLogger } from '../src/sync-logger';

const createLogger = (): SyncLogger => ({
  log: vi.fn(),
  error: vi.fn(),
  err: vi.fn(),
  normal: vi.fn(),
  verbose: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  critical: vi.fn(),
  debug: vi.fn(),
});

const createOp = (overrides: Partial<Operation> = {}): Operation => ({
  id: 'op-1',
  actionType: '[Test] Action',
  opType: OpType.Update,
  entityType: 'TASK',
  entityId: 'task-1',
  payload: {},
  clientId: 'client-1',
  vectorClock: { client1: 1 },
  timestamp: 1_000,
  schemaVersion: 1,
  ...overrides,
});

const createConflict = (
  localOps: Operation[],
  remoteOps: Operation[],
  overrides: Partial<EntityConflict> = {},
): EntityConflict => ({
  entityType: 'TASK',
  entityId: 'task-1',
  localOps,
  remoteOps,
  suggestedResolution: 'manual',
  ...overrides,
});

const ARCHIVE_ACTION = '[Task] Move to Archive';
const isArchiveAction = (op: Operation): boolean => op.actionType === ARCHIVE_ACTION;

describe('deepEqual', () => {
  it('compares primitives, objects, and arrays', () => {
    expect(deepEqual(1, 1)).toBe(true);
    expect(deepEqual('a', 'b')).toBe(false);
    expect(deepEqual({ a: 1, b: { c: [1, 2] } }, { a: 1, b: { c: [1, 2] } })).toBe(true);
    expect(deepEqual({ a: 1 }, { a: 2 })).toBe(false);
    expect(deepEqual([1, 2, 3], [1, 3, 2])).toBe(false);
  });

  it('requires matching object keys even when values are undefined', () => {
    expect(deepEqual({ a: undefined }, { b: undefined })).toBe(false);
    expect(deepEqual({ nested: { a: undefined } }, { nested: { b: undefined } })).toBe(
      false,
    );
  });

  it('returns false and logs for circular references', () => {
    const logger = createLogger();
    const a: Record<string, unknown> = { value: 1 };
    const b: Record<string, unknown> = { value: 1 };
    a['self'] = a;
    b['self'] = b;

    expect(deepEqual(a, b, { logger })).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      'sync-core.deepEqual detected circular reference, returning false',
    );
  });

  it('returns false and logs when max depth is exceeded', () => {
    const logger = createLogger();
    expect(deepEqual({ a: { b: 1 } }, { a: { b: 1 } }, { logger, maxDepth: 1 })).toBe(
      false,
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'sync-core.deepEqual exceeded max depth, returning false',
      { maxDepth: 1 },
    );
  });
});

describe('isIdenticalConflict', () => {
  it('detects all-delete conflicts as identical', () => {
    const conflict = createConflict(
      [createOp({ id: 'local', opType: OpType.Delete })],
      [createOp({ id: 'remote', opType: OpType.Delete })],
    );

    expect(isIdenticalConflict(conflict)).toBe(true);
  });

  it('detects single operations with equal payloads as identical', () => {
    const payload = { title: 'same', tagIds: ['a', 'b'] };
    const conflict = createConflict(
      [createOp({ id: 'local', payload })],
      [createOp({ id: 'remote', payload: { title: 'same', tagIds: ['a', 'b'] } })],
    );

    expect(isIdenticalConflict(conflict)).toBe(true);
  });

  it('rejects different op types or payloads', () => {
    expect(
      isIdenticalConflict(
        createConflict(
          [createOp({ opType: OpType.Update })],
          [createOp({ opType: OpType.Delete })],
        ),
      ),
    ).toBe(false);

    expect(
      isIdenticalConflict(
        createConflict(
          [createOp({ payload: { title: 'local' } })],
          [createOp({ payload: { title: 'remote' } })],
        ),
      ),
    ).toBe(false);

    expect(
      isIdenticalConflict(
        createConflict(
          [createOp({ payload: { localOnly: undefined } })],
          [createOp({ payload: { remoteOnly: undefined } })],
        ),
      ),
    ).toBe(false);
  });
});

describe('suggestConflictResolution', () => {
  it('chooses the non-empty side when one side is empty', () => {
    expect(suggestConflictResolution([], [createOp()])).toBe('remote');
    expect(suggestConflictResolution([createOp()], [])).toBe('local');
  });

  it('chooses the newer side when timestamps differ by more than one hour', () => {
    expect(
      suggestConflictResolution(
        [createOp({ timestamp: 1_000 })],
        [createOp({ timestamp: 3_601_001 })],
      ),
    ).toBe('remote');
  });

  it('prefers update over delete and create over update', () => {
    expect(
      suggestConflictResolution(
        [createOp({ opType: OpType.Delete })],
        [createOp({ opType: OpType.Update })],
      ),
    ).toBe('remote');
    expect(
      suggestConflictResolution(
        [createOp({ opType: OpType.Update })],
        [createOp({ opType: OpType.Create })],
      ),
    ).toBe('remote');
  });

  it('falls back to manual for close update conflicts', () => {
    expect(
      suggestConflictResolution(
        [createOp({ timestamp: 1_000, opType: OpType.Update })],
        [createOp({ timestamp: 1_500, opType: OpType.Update })],
      ),
    ).toBe('manual');
  });
});

describe('planLwwConflictResolutions', () => {
  it('lets a remote archive win over local non-archive operations', () => {
    const conflict = createConflict(
      [createOp({ id: 'local', timestamp: 2_000 })],
      [
        createOp({
          id: 'remote-archive',
          actionType: ARCHIVE_ACTION,
          timestamp: 1_000,
        }),
      ],
    );

    expect(planLwwConflictResolutions([conflict], { isArchiveAction })).toEqual([
      {
        conflict,
        winner: 'remote',
        reason: 'remote-archive',
      },
    ]);
  });

  it('plans an archive-win op when the local archive is in the current conflict', () => {
    const conflict = createConflict(
      [
        createOp({
          id: 'local-archive',
          actionType: ARCHIVE_ACTION,
          timestamp: 1_000,
        }),
      ],
      [createOp({ id: 'remote', timestamp: 2_000 })],
    );

    expect(planLwwConflictResolutions([conflict], { isArchiveAction })).toEqual([
      {
        conflict,
        winner: 'local',
        reason: 'local-archive',
        localWinOperationKind: 'archive-win',
      },
    ]);
  });

  it('lets a sibling local archive win without creating another local op', () => {
    const archiveConflict = createConflict(
      [createOp({ id: 'local-archive', actionType: ARCHIVE_ACTION })],
      [createOp({ id: 'remote-1' })],
    );
    const siblingConflict = createConflict(
      [createOp({ id: 'local-update', timestamp: 1_000 })],
      [createOp({ id: 'remote-update', timestamp: 2_000 })],
    );

    expect(
      planLwwConflictResolutions([archiveConflict, siblingConflict], {
        isArchiveAction,
      }),
    ).toEqual([
      {
        conflict: archiveConflict,
        winner: 'local',
        reason: 'local-archive',
        localWinOperationKind: 'archive-win',
      },
      {
        conflict: siblingConflict,
        winner: 'local',
        reason: 'local-archive-sibling',
        localWinOperationKind: undefined,
      },
    ]);
  });

  it('lets a sibling remote archive win without creating a local op', () => {
    const archiveConflict = createConflict(
      [createOp({ id: 'local-1' })],
      [createOp({ id: 'remote-archive', actionType: ARCHIVE_ACTION })],
    );
    const siblingConflict = createConflict(
      [createOp({ id: 'local-update', timestamp: 2_000 })],
      [createOp({ id: 'remote-update', timestamp: 1_000 })],
    );

    const plan = planLwwConflictResolutions([archiveConflict, siblingConflict], {
      isArchiveAction,
    });

    expect(plan).toEqual([
      {
        conflict: archiveConflict,
        winner: 'remote',
        reason: 'remote-archive',
      },
      {
        conflict: siblingConflict,
        winner: 'remote',
        reason: 'remote-archive',
      },
    ]);
    expect(plan[1].localWinOperationKind).toBeUndefined();
  });

  it('lets remote archive precedence win when both sides have archive involvement', () => {
    const localArchiveConflict = createConflict(
      [createOp({ id: 'local-archive', actionType: ARCHIVE_ACTION })],
      [createOp({ id: 'remote-update' })],
    );
    const remoteArchiveConflict = createConflict(
      [createOp({ id: 'local-update' })],
      [createOp({ id: 'remote-archive', actionType: ARCHIVE_ACTION })],
    );

    const plan = planLwwConflictResolutions(
      [localArchiveConflict, remoteArchiveConflict],
      { isArchiveAction },
    );

    expect(plan).toEqual([
      {
        conflict: localArchiveConflict,
        winner: 'remote',
        reason: 'remote-archive',
      },
      {
        conflict: remoteArchiveConflict,
        winner: 'remote',
        reason: 'remote-archive',
      },
    ]);
    expect(plan[0].localWinOperationKind).toBeUndefined();
  });

  it('keeps archive pre-scan state isolated by entity key', () => {
    const archiveConflict = createConflict(
      [createOp({ id: 'local-archive', actionType: ARCHIVE_ACTION })],
      [createOp({ id: 'remote-1' })],
      { entityType: 'TASK', entityId: 'task-1' },
    );
    const differentIdConflict = createConflict(
      [createOp({ id: 'local-different-id', timestamp: 2_000 })],
      [createOp({ id: 'remote-different-id', timestamp: 1_000 })],
      { entityType: 'TASK', entityId: 'task-2' },
    );
    const differentTypeConflict = createConflict(
      [createOp({ id: 'local-different-type', timestamp: 2_000 })],
      [createOp({ id: 'remote-different-type', timestamp: 1_000 })],
      { entityType: 'PROJECT', entityId: 'task-1' },
    );

    expect(
      planLwwConflictResolutions(
        [archiveConflict, differentIdConflict, differentTypeConflict],
        { isArchiveAction },
      ),
    ).toEqual([
      {
        conflict: archiveConflict,
        winner: 'local',
        reason: 'local-archive',
        localWinOperationKind: 'archive-win',
      },
      {
        conflict: differentIdConflict,
        winner: 'local',
        reason: 'local-timestamp',
        localWinOperationKind: 'update',
        localMaxTimestamp: 2_000,
        remoteMaxTimestamp: 1_000,
      },
      {
        conflict: differentTypeConflict,
        winner: 'local',
        reason: 'local-timestamp',
        localWinOperationKind: 'update',
        localMaxTimestamp: 2_000,
        remoteMaxTimestamp: 1_000,
      },
    ]);
  });

  it('uses custom entity keys for archive pre-scan grouping', () => {
    const taskArchiveConflict = createConflict(
      [createOp({ id: 'local-task-archive', actionType: ARCHIVE_ACTION })],
      [createOp({ id: 'remote-task' })],
      { entityType: 'TASK', entityId: 'shared-id' },
    );
    const projectSiblingConflict = createConflict(
      [createOp({ id: 'local-project-update', timestamp: 2_000 })],
      [createOp({ id: 'remote-project-update', timestamp: 1_000 })],
      { entityType: 'PROJECT', entityId: 'shared-id' },
    );

    expect(
      planLwwConflictResolutions([taskArchiveConflict, projectSiblingConflict], {
        isArchiveAction,
        toEntityKey: (_entityType, entityId) => entityId,
      }),
    ).toEqual([
      {
        conflict: taskArchiveConflict,
        winner: 'local',
        reason: 'local-archive',
        localWinOperationKind: 'archive-win',
      },
      {
        conflict: projectSiblingConflict,
        winner: 'local',
        reason: 'local-archive-sibling',
        localWinOperationKind: undefined,
      },
    ]);
  });

  it('plans a local update op when local has the newer max timestamp', () => {
    const conflict = createConflict(
      [
        createOp({ id: 'local-old', timestamp: 1_000 }),
        createOp({ id: 'local-new', timestamp: 3_000 }),
      ],
      [createOp({ id: 'remote', timestamp: 2_000 })],
    );

    expect(planLwwConflictResolutions([conflict], { isArchiveAction })).toEqual([
      {
        conflict,
        winner: 'local',
        reason: 'local-timestamp',
        localWinOperationKind: 'update',
        localMaxTimestamp: 3_000,
        remoteMaxTimestamp: 2_000,
      },
    ]);
  });

  it('lets remote win when remote has the newer max timestamp', () => {
    const conflict = createConflict(
      [createOp({ id: 'local', timestamp: 1_000 })],
      [createOp({ id: 'remote', timestamp: 2_000 })],
    );

    expect(planLwwConflictResolutions([conflict], { isArchiveAction })).toEqual([
      {
        conflict,
        winner: 'remote',
        reason: 'remote-timestamp-or-tie',
        localMaxTimestamp: 1_000,
        remoteMaxTimestamp: 2_000,
      },
    ]);
  });

  it('lets remote win timestamp ties', () => {
    const conflict = createConflict(
      [createOp({ id: 'local', timestamp: 1_000 })],
      [createOp({ id: 'remote', timestamp: 1_000 })],
    );

    expect(planLwwConflictResolutions([conflict], { isArchiveAction })).toEqual([
      {
        conflict,
        winner: 'remote',
        reason: 'remote-timestamp-or-tie',
        localMaxTimestamp: 1_000,
        remoteMaxTimestamp: 1_000,
      },
    ]);
  });
});

describe('partitionLwwResolutions', () => {
  it('partitions a remote winner', () => {
    const conflict = createConflict(
      [createOp({ id: 'local' })],
      [createOp({ id: 'remote' })],
    );

    const result = partitionLwwResolutions([{ conflict, winner: 'remote' }]);

    expect(result).toEqual({
      localWinsCount: 0,
      remoteWinsCount: 1,
      remoteWinsOps: conflict.remoteOps,
      localWinsRemoteOps: [],
      localOpsToReject: ['local'],
      remoteOpsToReject: [],
      newLocalWinOps: [],
      remoteWinnerAffectedEntityKeys: new Set(['TASK:task-1']),
    });
  });

  it('partitions a local winner with a localWinOp', () => {
    const localWinOp = createOp({ id: 'local-win-op' });
    const conflict = createConflict(
      [createOp({ id: 'local' })],
      [createOp({ id: 'remote' })],
    );

    const result = partitionLwwResolutions([{ conflict, winner: 'local', localWinOp }]);

    expect(result.localWinsCount).toBe(1);
    expect(result.remoteWinsCount).toBe(0);
    expect(result.localWinsRemoteOps).toEqual(conflict.remoteOps);
    expect(result.localOpsToReject).toEqual(['local']);
    expect(result.remoteOpsToReject).toEqual(['remote']);
    expect(result.newLocalWinOps).toEqual([localWinOp]);
    expect(result.remoteWinsOps).toEqual([]);
    expect(result.remoteWinnerAffectedEntityKeys).toEqual(new Set());
  });

  it('counts a local winner without a localWinOp and still rejects remote ops', () => {
    const conflict = createConflict(
      [createOp({ id: 'local' })],
      [createOp({ id: 'remote' })],
    );

    const result = partitionLwwResolutions([{ conflict, winner: 'local' }]);

    expect(result.localWinsCount).toBe(1);
    expect(result.localOpsToReject).toEqual(['local']);
    expect(result.localWinsRemoteOps).toEqual(conflict.remoteOps);
    expect(result.remoteOpsToReject).toEqual(['remote']);
    expect(result.newLocalWinOps).toEqual([]);
  });

  it('builds remote-winner affected keys for multi-entity ops', () => {
    const conflict = createConflict(
      [createOp({ id: 'local' })],
      [
        createOp({
          id: 'remote-multi',
          entityIds: ['task-1', 'task-2'],
          entityId: 'fallback-task',
        }),
        createOp({
          id: 'remote-empty-ids',
          entityIds: [],
          entityId: 'task-3',
        }),
      ],
    );

    const result = partitionLwwResolutions([{ conflict, winner: 'remote' }], {
      toEntityKey: (entityType, entityId) => `${entityType.toLowerCase()}#${entityId}`,
    });

    expect(result.remoteWinnerAffectedEntityKeys).toEqual(
      new Set(['task#task-1', 'task#task-2', 'task#task-3']),
    );
  });

  it('uses the remote-winner op processor callback', () => {
    const conflict = createConflict(
      [createOp({ id: 'local' })],
      [createOp({ id: 'remote', actionType: '[Test] Remote' })],
    );
    const processedRemoteOp: Operation = {
      ...conflict.remoteOps[0],
      id: 'processed-remote',
      entityId: 'processed-task',
      actionType: '[Test] Processed Remote',
    };
    const processRemoteWinnerOps = vi.fn((_conflict: EntityConflict): Operation[] => [
      processedRemoteOp,
    ]);

    const result = partitionLwwResolutions<Operation, EntityConflict>(
      [{ conflict, winner: 'remote' }],
      { processRemoteWinnerOps },
    );

    expect(processRemoteWinnerOps).toHaveBeenCalledWith(conflict);
    expect(result.remoteWinsOps).toEqual([processedRemoteOp]);
    expect(result.remoteWinnerAffectedEntityKeys).toEqual(new Set(['TASK:task-1']));
  });
});

describe('delete-loses-to-update payload helpers', () => {
  it('extracts a base entity from direct and multi-entity payloads', () => {
    const entity = { id: 'task-1', title: 'Deleted' };

    expect(extractEntityFromPayload({ task: entity }, 'task')).toEqual(entity);
    expect(
      extractEntityFromPayload(
        { actionPayload: { task: entity }, entityChanges: [] },
        'task',
      ),
    ).toEqual(entity);
  });

  it('falls back to a direct entity payload with an id field', () => {
    const entity = { id: 'task-1', title: 'Direct entity' };

    expect(extractEntityFromPayload(entity, 'task')).toEqual(entity);
  });

  it('returns undefined when no base entity can be extracted', () => {
    expect(extractEntityFromPayload({ taskIds: ['task-1'] }, 'task')).toBeUndefined();
    expect(extractEntityFromPayload({ task: null }, 'task')).toBeUndefined();
  });

  it('extracts update changes from adapter and flat payload formats', () => {
    expect(
      extractUpdateChanges(
        { task: { id: 'task-1', changes: { title: 'New', notes: 'Updated' } } },
        'task',
      ),
    ).toEqual({ title: 'New', notes: 'Updated' });

    expect(
      extractUpdateChanges({ task: { id: 'task-1', title: 'Flat' } }, 'task'),
    ).toEqual({ title: 'Flat' });
  });

  it('extracts update changes from multi-entity payloads', () => {
    expect(
      extractUpdateChanges(
        {
          actionPayload: {
            task: { id: 'task-1', changes: { title: 'New' } },
          },
          entityChanges: [],
        },
        'task',
      ),
    ).toEqual({ title: 'New' });
  });

  it('returns empty changes when the update payload key is absent', () => {
    expect(extractUpdateChanges({ project: { id: 'project-1' } }, 'task')).toEqual({});
  });
});

describe('convertLocalDeleteRemoteUpdatesToLww', () => {
  const toLwwUpdateActionType = (entityType: string): string =>
    `[${entityType}] LWW Update`;

  it('passes remote ops through unchanged when no local delete exists', () => {
    const remoteOp = createOp({
      id: 'remote-update',
      payload: { task: { id: 'task-1', changes: { title: 'Remote' } } },
    });
    const conflict = createConflict(
      [createOp({ id: 'local-update', payload: { task: { id: 'task-1' } } })],
      [remoteOp],
    );

    const result = convertLocalDeleteRemoteUpdatesToLww(conflict, {
      payloadKey: 'task',
      toLwwUpdateActionType,
    });

    expect(result).toBe(conflict.remoteOps);
    expect(result).toEqual([remoteOp]);
  });

  it('converts remote updates to LWW updates with merged base entity data', () => {
    const conflict = createConflict(
      [
        createOp({
          id: 'local-delete',
          opType: OpType.Delete,
          payload: {
            task: {
              id: 'task-1',
              title: 'Original',
              notes: 'Keep me',
              projectId: 'project-1',
            },
          },
        }),
      ],
      [
        createOp({
          id: 'remote-update',
          payload: { task: { id: 'task-1', changes: { title: 'Remote' } } },
        }),
      ],
    );

    const result = convertLocalDeleteRemoteUpdatesToLww(conflict, {
      payloadKey: (entityType) => entityType.toLowerCase(),
      toLwwUpdateActionType,
    });

    expect(result[0]).toEqual({
      ...conflict.remoteOps[0],
      actionType: '[TASK] LWW Update',
      payload: {
        id: 'task-1',
        title: 'Remote',
        notes: 'Keep me',
        projectId: 'project-1',
      },
    });
  });

  it('forces the top-level id to the canonical conflict entity id', () => {
    const conflict = createConflict(
      [
        createOp({
          id: 'local-delete',
          opType: OpType.Delete,
          payload: { task: { id: 'stale-id', title: 'Original' } },
        }),
      ],
      [
        createOp({
          id: 'remote-update',
          payload: { task: { id: 'stale-id', changes: { title: 'Remote' } } },
        }),
      ],
    );

    const result = convertLocalDeleteRemoteUpdatesToLww(conflict, {
      payloadKey: 'task',
      toLwwUpdateActionType,
    });

    expect(result[0].payload).toEqual({ id: 'task-1', title: 'Remote' });
  });

  it('does not inject an id for singleton entity ids', () => {
    const conflict = createConflict(
      [
        createOp({
          id: 'local-delete',
          opType: OpType.Delete,
          entityType: 'GLOBAL_CONFIG',
          entityId: '*',
          payload: { globalConfig: { sync: { provider: null }, misc: true } },
        }),
      ],
      [
        createOp({
          id: 'remote-update',
          entityType: 'GLOBAL_CONFIG',
          entityId: '*',
          payload: { globalConfig: { changes: { misc: false } } },
        }),
      ],
      { entityType: 'GLOBAL_CONFIG', entityId: '*' },
    );

    const result = convertLocalDeleteRemoteUpdatesToLww(conflict, {
      payloadKey: 'globalConfig',
      toLwwUpdateActionType,
      isSingletonEntityId: (entityId) => entityId === '*',
    });

    expect(result[0].payload).toEqual({
      sync: { provider: null },
      misc: false,
    });
  });

  it('leaves remote updates unchanged and reports missing base entity fallback', () => {
    const onMissingBaseEntity = vi.fn();
    const remoteOp = createOp({
      id: 'remote-update',
      payload: { task: { id: 'task-1', changes: { title: 'Remote' } } },
    });
    const conflict = createConflict(
      [
        createOp({
          id: 'local-delete',
          opType: OpType.Delete,
          payload: { taskIds: ['task-1'] },
        }),
      ],
      [remoteOp],
    );

    const result = convertLocalDeleteRemoteUpdatesToLww(conflict, {
      payloadKey: 'task',
      toLwwUpdateActionType,
      onMissingBaseEntity,
    });

    expect(result).toEqual([remoteOp]);
    expect(onMissingBaseEntity).toHaveBeenCalledWith({
      conflict,
      localDeleteOp: conflict.localOps[0],
      remoteOp,
      localDeletePayloadKeys: ['taskIds'],
    });
  });

  it('leaves non-update remote ops unchanged when local delete exists', () => {
    const remoteCreate = createOp({
      id: 'remote-create',
      opType: OpType.Create,
      payload: { task: { id: 'task-1', title: 'Created' } },
    });
    const conflict = createConflict(
      [
        createOp({
          id: 'local-delete',
          opType: OpType.Delete,
          payload: { task: { id: 'task-1', title: 'Deleted' } },
        }),
      ],
      [remoteCreate],
    );

    expect(
      convertLocalDeleteRemoteUpdatesToLww(conflict, {
        payloadKey: 'task',
        toLwwUpdateActionType,
      }),
    ).toEqual([remoteCreate]);
  });
});

describe('buildEntityFrontier', () => {
  it('merges applied frontier with pending op clocks', () => {
    const result = buildEntityFrontier('TASK:task-1', {
      appliedFrontier: { clientA: 1 },
      localOpsForEntity: [
        createOp({ vectorClock: { clientA: 2, clientB: 1 } }),
        createOp({ vectorClock: { clientC: 3 } }),
      ],
      snapshotVectorClock: { snapshotClient: 1 },
      snapshotEntityKeys: new Set(['TASK:task-1']),
    });

    expect(result).toEqual({ clientA: 2, clientB: 1, clientC: 3 });
  });

  it('uses snapshot clock only for entities that existed in new-format snapshots', () => {
    expect(
      buildEntityFrontier('TASK:task-1', {
        appliedFrontier: undefined,
        localOpsForEntity: [],
        snapshotVectorClock: { snapshotClient: 4 },
        snapshotEntityKeys: new Set(['TASK:task-1']),
      }),
    ).toEqual({ snapshotClient: 4 });

    expect(
      buildEntityFrontier('TASK:new-task', {
        appliedFrontier: undefined,
        localOpsForEntity: [],
        snapshotVectorClock: { snapshotClient: 4 },
        snapshotEntityKeys: new Set(['TASK:task-1']),
      }),
    ).toEqual({});
  });

  it('uses old-format snapshot clock only when an applied frontier exists', () => {
    expect(
      buildEntityFrontier('TASK:task-1', {
        appliedFrontier: { clientA: 1 },
        localOpsForEntity: [],
        snapshotVectorClock: { snapshotClient: 4 },
        snapshotEntityKeys: undefined,
      }),
    ).toEqual({ clientA: 1 });

    expect(
      buildEntityFrontier('TASK:new-task', {
        appliedFrontier: undefined,
        localOpsForEntity: [],
        snapshotVectorClock: { snapshotClient: 4 },
        snapshotEntityKeys: undefined,
      }),
    ).toEqual({});
  });
});

describe('adjustForClockCorruption', () => {
  it('leaves comparisons unchanged when corruption is not suspected', () => {
    expect(
      adjustForClockCorruption({
        comparison: 'LESS_THAN',
        entityKey: 'TASK:task-1',
        pendingOpsCount: 0,
        hasNoSnapshotClock: true,
        localFrontierIsEmpty: true,
      }),
    ).toBe('LESS_THAN');

    expect(
      adjustForClockCorruption({
        comparison: 'GREATER_THAN',
        entityKey: 'TASK:task-1',
        pendingOpsCount: 1,
        hasNoSnapshotClock: false,
        localFrontierIsEmpty: true,
      }),
    ).toBe('GREATER_THAN');
  });

  it('converts unsafe comparisons to concurrent when corruption is suspected', () => {
    const logger = createLogger();
    const onPotentialCorruption = vi.fn();

    expect(
      adjustForClockCorruption({
        comparison: 'LESS_THAN',
        entityKey: 'TASK:task-1',
        pendingOpsCount: 2,
        hasNoSnapshotClock: true,
        localFrontierIsEmpty: true,
        logger,
        onPotentialCorruption,
      }),
    ).toBe('CONCURRENT');
    expect(onPotentialCorruption).toHaveBeenCalledWith(
      'Clock corruption detected for entity TASK:task-1: has 2 pending ops but no snapshot clock and empty local frontier',
    );
    expect(logger.warn).toHaveBeenCalledWith(
      'sync-core: converting LESS_THAN to CONCURRENT for clock corruption',
      { entityKey: 'TASK:task-1', pendingOpsCount: 2 },
    );

    expect(
      adjustForClockCorruption({
        comparison: 'GREATER_THAN',
        entityKey: 'TASK:task-1',
        pendingOpsCount: 1,
        hasNoSnapshotClock: true,
        localFrontierIsEmpty: true,
      }),
    ).toBe('CONCURRENT');
  });

  it('leaves already safe comparisons unchanged even when corruption is suspected', () => {
    expect(
      adjustForClockCorruption({
        comparison: 'CONCURRENT',
        entityKey: 'TASK:task-1',
        pendingOpsCount: 1,
        hasNoSnapshotClock: true,
        localFrontierIsEmpty: true,
      }),
    ).toBe('CONCURRENT');
    expect(
      adjustForClockCorruption({
        comparison: 'EQUAL',
        entityKey: 'TASK:task-1',
        pendingOpsCount: 1,
        hasNoSnapshotClock: true,
        localFrontierIsEmpty: true,
      }),
    ).toBe('EQUAL');
  });
});
