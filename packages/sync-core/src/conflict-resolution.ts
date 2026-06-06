import {
  extractActionPayload,
  extractEntityFromPayload,
  extractUpdateChanges,
  OpType,
} from './operation.types';
import type { EntityConflict, Operation } from './operation.types';
import { NOOP_SYNC_LOGGER } from './sync-logger';
import type { SyncLogger } from './sync-logger';

export type ConflictResolutionSuggestion = 'local' | 'remote' | 'manual';
export type LwwConflictResolutionWinner = 'local' | 'remote';
export type LwwLocalWinOperationKind = 'archive-win' | 'update';
export type LwwConflictResolutionReason =
  | 'remote-archive'
  | 'local-archive'
  | 'local-archive-sibling'
  | 'local-timestamp'
  | 'remote-timestamp-or-tie';

const DEFAULT_MAX_DEEP_EQUAL_DEPTH = 50;
const ONE_HOUR_MS = 60 * 60 * 1000;

export interface DeepEqualOptions {
  logger?: SyncLogger;
  maxDepth?: number;
}

export interface LwwConflictResolutionPlan<
  TConflict extends EntityConflictLike<Operation<string>> = EntityConflict,
> {
  conflict: TConflict;
  winner: LwwConflictResolutionWinner;
  reason: LwwConflictResolutionReason;
  localWinOperationKind?: LwwLocalWinOperationKind;
  localMaxTimestamp?: number;
  remoteMaxTimestamp?: number;
}

export interface LwwConflictResolutionPlanningOptions<
  TOperation extends Operation<string> = Operation,
> {
  isArchiveAction: (op: TOperation) => boolean;
  toEntityKey?: (entityType: string, entityId: string) => string;
}

export interface LocalDeleteRemoteUpdateConversionOptions<
  TOperation extends Operation<string> = Operation,
> {
  payloadKey: string | ((entityType: string) => string);
  toLwwUpdateActionType: (entityType: string) => string;
  isSingletonEntityId?: (entityId: string) => boolean;
  onMissingBaseEntity?: (ctx: {
    conflict: EntityConflictLike<TOperation>;
    localDeleteOp: TOperation | undefined;
    remoteOp: TOperation;
    localDeletePayloadKeys: string[] | undefined;
  }) => void;
}

export type EntityConflictLike<TOperation extends Operation<string>> = Omit<
  EntityConflict<Operation<string>>,
  'localOps' | 'remoteOps'
> & {
  localOps: TOperation[];
  remoteOps: TOperation[];
};

export interface LwwResolvedConflict<
  TOperation extends Operation<string> = Operation,
  TConflict extends EntityConflictLike<TOperation> = EntityConflictLike<TOperation>,
> {
  conflict: TConflict;
  winner: LwwConflictResolutionWinner;
  localWinOp?: TOperation;
}

export interface LwwResolutionPartitionOptions<
  TOperation extends Operation<string>,
  TConflict extends EntityConflictLike<TOperation> = EntityConflictLike<TOperation>,
> {
  processRemoteWinnerOps?: (conflict: TConflict) => TOperation[];
  toEntityKey?: (entityType: string, entityId: string) => string;
}

export interface LwwResolutionPartitions<
  TOperation extends Operation<string> = Operation,
> {
  localWinsCount: number;
  remoteWinsCount: number;
  remoteWinsOps: TOperation[];
  localWinsRemoteOps: TOperation[];
  localOpsToReject: string[];
  remoteOpsToReject: string[];
  newLocalWinOps: TOperation[];
  remoteWinnerAffectedEntityKeys: Set<string>;
}

const resolvePayloadKey = (
  entityType: string,
  payloadKey: LocalDeleteRemoteUpdateConversionOptions<Operation<string>>['payloadKey'],
): string => (typeof payloadKey === 'function' ? payloadKey(entityType) : payloadKey);

const getPayloadKeys = (payload: unknown): string[] | undefined => {
  const actionPayload = extractActionPayload(payload);
  if (actionPayload && typeof actionPayload === 'object') {
    return Object.keys(actionPayload);
  }
  return undefined;
};

/**
 * Rewrites winning remote UPDATE ops as host LWW update ops when a local DELETE
 * loses. The host supplies payload-key resolution, LWW action-type conversion,
 * and singleton-id semantics so the core remains domain-agnostic.
 */
export const convertLocalDeleteRemoteUpdatesToLww = <
  TOperation extends Operation<string> = Operation,
>(
  conflict: EntityConflictLike<TOperation>,
  options: LocalDeleteRemoteUpdateConversionOptions<TOperation>,
): TOperation[] => {
  const localDeleteOp = conflict.localOps.find((op) => op.opType === OpType.Delete);

  if (!localDeleteOp) {
    return conflict.remoteOps;
  }

  const payloadKey = resolvePayloadKey(conflict.entityType, options.payloadKey);
  const baseEntity = extractEntityFromPayload(localDeleteOp.payload, payloadKey);

  return conflict.remoteOps.map((remoteOp) => {
    if (remoteOp.opType !== OpType.Update) {
      return remoteOp;
    }

    if (baseEntity) {
      const remotePayloadKey = resolvePayloadKey(remoteOp.entityType, options.payloadKey);
      const updateChanges = extractUpdateChanges(remoteOp.payload, remotePayloadKey);
      const mergedEntity = options.isSingletonEntityId?.(conflict.entityId)
        ? { ...baseEntity, ...updateChanges }
        : { ...baseEntity, ...updateChanges, id: conflict.entityId };

      return {
        ...remoteOp,
        actionType: options.toLwwUpdateActionType(remoteOp.entityType),
        payload: mergedEntity,
      } as TOperation;
    }

    options.onMissingBaseEntity?.({
      conflict,
      localDeleteOp,
      remoteOp,
      localDeletePayloadKeys: getPayloadKeys(localDeleteOp.payload),
    });
    return remoteOp;
  });
};

const deepEqualInner = (
  a: unknown,
  b: unknown,
  logger: SyncLogger,
  maxDepth: number,
  seen: WeakSet<object>,
  depth: number,
): boolean => {
  if (depth > maxDepth) {
    logger.warn('sync-core.deepEqual exceeded max depth, returning false', {
      maxDepth,
    });
    return false;
  }

  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (typeof a !== typeof b) return false;

  if (typeof a === 'object') {
    if (seen.has(a as object) || seen.has(b as object)) {
      logger.warn('sync-core.deepEqual detected circular reference, returning false');
      return false;
    }
    seen.add(a as object);
    seen.add(b as object);

    if (Array.isArray(a) && Array.isArray(b)) {
      if (a.length !== b.length) return false;
      return a.every((val, i) =>
        deepEqualInner(val, b[i], logger, maxDepth, seen, depth + 1),
      );
    }

    if (Array.isArray(a) !== Array.isArray(b)) return false;

    const aRecord = a as Record<string, unknown>;
    const bRecord = b as Record<string, unknown>;
    const aKeys = Object.keys(aRecord);
    const bKeys = Object.keys(bRecord);
    if (aKeys.length !== bKeys.length) return false;
    if (!aKeys.every((key) => Object.prototype.hasOwnProperty.call(bRecord, key))) {
      return false;
    }

    return aKeys.every((key) =>
      deepEqualInner(aRecord[key], bRecord[key], logger, maxDepth, seen, depth + 1),
    );
  }

  return false;
};

export const deepEqual = (
  a: unknown,
  b: unknown,
  options: DeepEqualOptions = {},
): boolean =>
  deepEqualInner(
    a,
    b,
    options.logger ?? NOOP_SYNC_LOGGER,
    options.maxDepth ?? DEFAULT_MAX_DEEP_EQUAL_DEPTH,
    new WeakSet(),
    0,
  );

/**
 * Identical conflicts are safe to auto-resolve because local and remote produce
 * the same resulting state.
 */
export const isIdenticalConflict = (
  conflict: EntityConflict<Operation<string>>,
  logger: SyncLogger = NOOP_SYNC_LOGGER,
): boolean => {
  const { localOps, remoteOps } = conflict;

  if (localOps.length === 0 || remoteOps.length === 0) {
    return false;
  }

  const allLocalDelete = localOps.every((op) => op.opType === OpType.Delete);
  const allRemoteDelete = remoteOps.every((op) => op.opType === OpType.Delete);
  if (allLocalDelete && allRemoteDelete) {
    logger.verbose('sync-core: identical conflict, both sides delete', {
      entityType: conflict.entityType,
      entityId: conflict.entityId,
    });
    return true;
  }

  if (localOps.length === 1 && remoteOps.length === 1) {
    const localOp = localOps[0];
    const remoteOp = remoteOps[0];

    if (localOp.opType !== remoteOp.opType) {
      return false;
    }

    if (deepEqual(localOp.payload, remoteOp.payload, { logger })) {
      logger.verbose('sync-core: identical conflict, same op payload', {
        entityType: conflict.entityType,
        entityId: conflict.entityId,
        opType: localOp.opType,
      });
      return true;
    }
  }

  return false;
};

/**
 * Suggests a conservative default conflict resolution for the UI/orchestrator.
 */
export const suggestConflictResolution = <TOperation extends Operation<string>>(
  localOps: TOperation[],
  remoteOps: TOperation[],
): ConflictResolutionSuggestion => {
  if (localOps.length === 0) return 'remote';
  if (remoteOps.length === 0) return 'local';

  const latestLocal = Math.max(...localOps.map((op) => op.timestamp));
  const latestRemote = Math.max(...remoteOps.map((op) => op.timestamp));
  const timeDiffMs = Math.abs(latestLocal - latestRemote);

  if (timeDiffMs > ONE_HOUR_MS) {
    return latestLocal > latestRemote ? 'local' : 'remote';
  }

  const hasLocalDelete = localOps.some((op) => op.opType === OpType.Delete);
  const hasRemoteDelete = remoteOps.some((op) => op.opType === OpType.Delete);

  if (hasLocalDelete && hasRemoteDelete) return 'local';
  if (hasLocalDelete && !hasRemoteDelete) return 'remote';
  if (hasRemoteDelete && !hasLocalDelete) return 'local';

  const hasLocalCreate = localOps.some((op) => op.opType === OpType.Create);
  const hasRemoteCreate = remoteOps.some((op) => op.opType === OpType.Create);
  if (hasLocalCreate && !hasRemoteCreate) return 'local';
  if (hasRemoteCreate && !hasLocalCreate) return 'remote';

  return 'manual';
};

/**
 * Plans last-write-wins conflict resolution without looking up host state or
 * creating operations.
 *
 * The host supplies archive-action detection because archive semantics are
 * domain-specific. The returned plan tells the host whether a local-win op must
 * be created and which app-side factory should create it.
 */
export const planLwwConflictResolutions = <
  TOperation extends Operation<string> = Operation,
  TConflict extends EntityConflictLike<TOperation> = EntityConflictLike<TOperation>,
>(
  conflicts: TConflict[],
  options: LwwConflictResolutionPlanningOptions<TOperation>,
): Array<LwwConflictResolutionPlan<TConflict>> => {
  const toEntityKey =
    options.toEntityKey ??
    ((entityType: string, entityId: string) => `${entityType}:${entityId}`);

  const entitiesWithLocalArchive = new Set<string>();
  const entitiesWithRemoteArchive = new Set<string>();

  for (const conflict of conflicts) {
    const entityKey = toEntityKey(conflict.entityType, conflict.entityId);
    if (conflict.localOps.some(options.isArchiveAction)) {
      entitiesWithLocalArchive.add(entityKey);
    }
    if (conflict.remoteOps.some(options.isArchiveAction)) {
      entitiesWithRemoteArchive.add(entityKey);
    }
  }

  return conflicts.map((conflict) => {
    const entityKey = toEntityKey(conflict.entityType, conflict.entityId);
    const localHasArchive = entitiesWithLocalArchive.has(entityKey);
    const remoteHasArchive = entitiesWithRemoteArchive.has(entityKey);

    if (remoteHasArchive) {
      return {
        conflict,
        winner: 'remote',
        reason: 'remote-archive',
      };
    }

    if (localHasArchive) {
      const thisConflictHasLocalArchive = conflict.localOps.some(options.isArchiveAction);

      return {
        conflict,
        winner: 'local',
        reason: thisConflictHasLocalArchive ? 'local-archive' : 'local-archive-sibling',
        localWinOperationKind: thisConflictHasLocalArchive ? 'archive-win' : undefined,
      };
    }

    const localMaxTimestamp = Math.max(...conflict.localOps.map((op) => op.timestamp));
    const remoteMaxTimestamp = Math.max(...conflict.remoteOps.map((op) => op.timestamp));

    if (localMaxTimestamp > remoteMaxTimestamp) {
      return {
        conflict,
        winner: 'local',
        reason: 'local-timestamp',
        localWinOperationKind: 'update',
        localMaxTimestamp,
        remoteMaxTimestamp,
      };
    }

    return {
      conflict,
      winner: 'remote',
      reason: 'remote-timestamp-or-tie',
      localMaxTimestamp,
      remoteMaxTimestamp,
    };
  });
};

/**
 * Partitions already-planned LWW conflict resolutions into operation buckets
 * needed by a host orchestrator.
 *
 * The host can transform winning remote ops before they are applied and can
 * define its own entity-key encoding. Affected keys are computed from the
 * original winning remote ops so host-specific processing cannot change which
 * pending local ops are superseded.
 */
export const partitionLwwResolutions = <
  TOperation extends Operation<string> = Operation,
  TConflict extends EntityConflictLike<TOperation> = EntityConflictLike<TOperation>,
  TResolution extends LwwResolvedConflict<TOperation, TConflict> = LwwResolvedConflict<
    TOperation,
    TConflict
  >,
>(
  resolutions: TResolution[],
  options: LwwResolutionPartitionOptions<TOperation, TConflict> = {},
): LwwResolutionPartitions<TOperation> => {
  const processRemoteWinnerOps =
    options.processRemoteWinnerOps ??
    ((conflict: TConflict): TOperation[] => conflict.remoteOps);
  const toEntityKey =
    options.toEntityKey ??
    ((entityType: string, entityId: string) => `${entityType}:${entityId}`);

  const partitions: LwwResolutionPartitions<TOperation> = {
    localWinsCount: 0,
    remoteWinsCount: 0,
    remoteWinsOps: [],
    localWinsRemoteOps: [],
    localOpsToReject: [],
    remoteOpsToReject: [],
    newLocalWinOps: [],
    remoteWinnerAffectedEntityKeys: new Set<string>(),
  };

  for (const resolution of resolutions) {
    const { conflict } = resolution;
    partitions.localOpsToReject.push(...conflict.localOps.map((op) => op.id));

    if (resolution.winner === 'remote') {
      partitions.remoteWinsCount++;
      partitions.remoteWinsOps.push(...processRemoteWinnerOps(conflict));

      for (const op of conflict.remoteOps) {
        const ids = op.entityIds?.length
          ? op.entityIds
          : op.entityId
            ? [op.entityId]
            : [];
        for (const id of ids) {
          partitions.remoteWinnerAffectedEntityKeys.add(toEntityKey(op.entityType, id));
        }
      }
      continue;
    }

    partitions.localWinsCount++;
    partitions.localWinsRemoteOps.push(...conflict.remoteOps);
    partitions.remoteOpsToReject.push(...conflict.remoteOps.map((op) => op.id));

    if (resolution.localWinOp) {
      partitions.newLocalWinOps.push(resolution.localWinOp);
    }
  }

  return partitions;
};
