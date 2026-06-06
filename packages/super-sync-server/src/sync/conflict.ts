import type { Prisma } from '@prisma/client';
import { Logger } from '../logger';
import {
  BatchUploadCandidate,
  CONFLICT_DETECTION_ENTITY_BATCH_SIZE,
  ConflictResult,
  DuplicateOperationCandidate,
  LatestBatchEntityOperationRow,
  LatestEntityOperationRow,
  Operation,
  VectorClock,
  compareVectorClocks,
  isFullStateOpType,
  limitVectorClockSize,
} from './sync.types';

export interface EntityConflictPair {
  entityType: string;
  entityId: string;
}

type RawQueryTx = Prisma.TransactionClient & {
  $queryRawUnsafe?: <T = unknown>(query: string, ...values: unknown[]) => Promise<T>;
};

const toTemplateStringsArray = (query: string): TemplateStringsArray =>
  Object.assign([query], { raw: [query] }) as unknown as TemplateStringsArray;

const queryRawWithBoundParams = <T>(
  tx: RawQueryTx,
  query: string,
  ...values: unknown[]
): Promise<T> =>
  tx.$queryRawUnsafe
    ? tx.$queryRawUnsafe<T>(query, ...values)
    : tx.$queryRaw<T>(toTemplateStringsArray(query), ...values);

/**
 * Check if an incoming operation conflicts with existing operations.
 * Returns conflict info if a concurrent modification is detected.
 */
export const detectConflict = async (
  userId: number,
  op: Operation,
  tx: Prisma.TransactionClient,
): Promise<ConflictResult> => {
  // Skip conflict detection for full-state operations
  if (
    op.opType === 'SYNC_IMPORT' ||
    op.opType === 'BACKUP_IMPORT' ||
    op.opType === 'REPAIR'
  ) {
    return { hasConflict: false };
  }

  const entityPairsToCheck = getConflictEntityPairs(op);

  // Skip if no entity IDs (can't have entity-level conflicts)
  if (entityPairsToCheck.length === 0) {
    return { hasConflict: false };
  }

  if (entityPairsToCheck.length === 1) {
    const [entity] = entityPairsToCheck;
    return detectConflictForEntity(userId, op, entity.entityType, entity.entityId, tx);
  }

  return detectConflictForEntityPairs(userId, op, entityPairsToCheck, tx);
};

export const detectConflictForEntityPairs = async (
  userId: number,
  op: Operation,
  entityPairsToCheck: EntityConflictPair[],
  tx: Prisma.TransactionClient,
): Promise<ConflictResult> => {
  const latestOpByEntity = await prefetchLatestEntityOpsForBatch(
    userId,
    entityPairsToCheck,
    tx,
  );

  for (const entity of entityPairsToCheck) {
    const existingOp = latestOpByEntity.get(
      getEntityConflictKey(entity.entityType, entity.entityId),
    );
    if (!existingOp) continue;

    const conflictResult = resolveConflictForExistingOp(
      op,
      entity.entityType,
      entity.entityId,
      existingOp,
    );
    if (conflictResult.hasConflict) {
      return conflictResult;
    }
  }

  return { hasConflict: false };
};

export const detectConflictForEntities = async (
  userId: number,
  op: Operation,
  entityIdsToCheck: string[],
  tx: Prisma.TransactionClient,
): Promise<ConflictResult> => {
  for (
    let start = 0;
    start < entityIdsToCheck.length;
    start += CONFLICT_DETECTION_ENTITY_BATCH_SIZE
  ) {
    const batchEntityIds = entityIdsToCheck.slice(
      start,
      start + CONFLICT_DETECTION_ENTITY_BATCH_SIZE,
    );
    const entityIdPlaceholders = batchEntityIds
      .map((_, index) => `$${index + 3}`)
      .join(', ');

    const latestOps = await queryRawWithBoundParams<LatestEntityOperationRow[]>(
      tx,
      `
      SELECT DISTINCT ON (entity_id)
        entity_id AS "entityId",
        client_id AS "clientId",
        vector_clock AS "vectorClock"
      FROM operations
      WHERE user_id = $1
        AND entity_type = $2
        AND entity_id IN (${entityIdPlaceholders})
      ORDER BY entity_id, server_seq DESC
    `,
      userId,
      op.entityType,
      ...batchEntityIds,
    );

    const latestOpByEntityId = new Map<string, LatestEntityOperationRow>();
    for (const latestOp of latestOps) {
      latestOpByEntityId.set(latestOp.entityId, latestOp);
    }

    for (const entityId of batchEntityIds) {
      const existingOp = latestOpByEntityId.get(entityId);
      if (!existingOp) continue;

      const conflictResult = resolveConflictForExistingOp(
        op,
        op.entityType,
        entityId,
        existingOp,
      );
      if (conflictResult.hasConflict) {
        return conflictResult;
      }
    }
  }

  return { hasConflict: false };
};

export const resolveConflictForExistingOp = (
  op: Operation,
  entityType: string,
  entityId: string,
  existingOp: { clientId: string; vectorClock: unknown },
): ConflictResult => {
  // Stored JSON/vector_clock values arrive as unknown from both Prisma model
  // reads and raw SQL rows; cast only at the vector-clock comparison boundary.
  const existingClock = existingOp.vectorClock as unknown as VectorClock;

  // Compare vector clocks
  const comparison = compareVectorClocks(op.vectorClock, existingClock);

  // If the incoming op's clock is GREATER_THAN existing, it's a valid successor
  if (comparison === 'GREATER_THAN') {
    return { hasConflict: false };
  }

  // If clocks are EQUAL, this might be a retry of the same operation - check if from same client
  if (comparison === 'EQUAL' && op.clientId === existingOp.clientId) {
    return { hasConflict: false };
  }

  // EQUAL clocks from different clients is suspicious - treat as conflict
  // This could happen if client IDs rotate or clocks are somehow reused
  if (comparison === 'EQUAL') {
    return {
      hasConflict: true,
      conflictType: 'equal_different_client',
      reason: `Equal vector clocks from different clients for ${entityType}:${entityId} (client ${op.clientId} vs ${existingOp.clientId})`,
      existingClock,
    };
  }

  // CONCURRENT means both clocks have entries the other doesn't
  if (comparison === 'CONCURRENT') {
    return {
      hasConflict: true,
      conflictType: 'concurrent',
      reason: `Concurrent modification detected for ${entityType}:${entityId}`,
      existingClock,
    };
  }

  // LESS_THAN means the incoming op is older than what we have
  if (comparison === 'LESS_THAN') {
    return {
      hasConflict: true,
      conflictType: 'superseded',
      reason: `Superseded operation: server has newer version of ${entityType}:${entityId}`,
      existingClock,
    };
  }

  // Should never reach here - all comparison cases handled above
  // But if we do, default to conflict for safety
  return {
    hasConflict: true,
    conflictType: 'unknown',
    reason: `Unknown vector clock comparison result for ${entityType}:${entityId}`,
    existingClock,
  };
};

/**
 * Checks conflicts for the common single-entity upload path using Prisma's
 * typed model API. Multi-entity operations use the batched raw-SQL path above
 * to avoid one round trip per entity.
 */
export const detectConflictForEntity = async (
  userId: number,
  op: Operation,
  entityType: string,
  entityId: string,
  tx: Prisma.TransactionClient,
): Promise<ConflictResult> => {
  const latestOpByEntity = await prefetchLatestEntityOpsForBatch(
    userId,
    [{ entityType, entityId }],
    tx,
  );
  const existingOp = latestOpByEntity.get(getEntityConflictKey(entityType, entityId));

  // No existing operation = no conflict
  if (!existingOp) {
    return { hasConflict: false };
  }

  return resolveConflictForExistingOp(op, entityType, entityId, existingOp);
};

export const isSameDuplicateOperation = (
  existingOp: DuplicateOperationCandidate,
  userId: number,
  op: Operation,
  maxClockDriftMs: number,
  originalTimestamp: number = op.timestamp,
): boolean => {
  const storedVectorClock = limitVectorClockSize(op.vectorClock, [op.clientId]);
  const incomingEncrypted = op.isPayloadEncrypted ?? false;

  // encrypt() uses a fresh random IV per call, so retried ciphertext differs
  // from the stored bytes. Skip byte-equality when both sides are encrypted;
  // the structural fields below still guard against id collisions.
  const payloadsMatch =
    (existingOp.isPayloadEncrypted && incomingEncrypted) ||
    areJsonValuesEqual(existingOp.payload, op.payload);

  return (
    existingOp.userId === userId &&
    existingOp.clientId === op.clientId &&
    existingOp.actionType === op.actionType &&
    existingOp.opType === op.opType &&
    existingOp.entityType === op.entityType &&
    existingOp.entityId === (op.entityId ?? null) &&
    payloadsMatch &&
    areJsonValuesEqual(existingOp.vectorClock, storedVectorClock) &&
    existingOp.schemaVersion === op.schemaVersion &&
    isSameDuplicateTimestamp(
      existingOp.clientTimestamp,
      existingOp.receivedAt,
      op.timestamp,
      originalTimestamp,
      maxClockDriftMs,
    ) &&
    existingOp.isPayloadEncrypted === incomingEncrypted &&
    existingOp.syncImportReason === (op.syncImportReason ?? null)
  );
};

export const isSameDuplicateTimestamp = (
  existingTimestamp: bigint | number | string,
  existingReceivedAt: bigint | number | string,
  incomingStoredTimestamp: number,
  incomingOriginalTimestamp: number,
  maxClockDriftMs: number,
): boolean => {
  if (existingTimestamp.toString() === incomingStoredTimestamp.toString()) {
    return true;
  }

  // A retry can arrive after server time advances enough that the original
  // timestamp no longer needs clamping, so original===stored does not rule
  // out a duplicate.
  // Future timestamps are clamped at receive time. A retry of the same op may
  // be clamped to a later value, or stop clamping once server time reaches the
  // original timestamp's allowed drift window. Allow exact-content duplicates
  // whose stored timestamp came from an earlier clamp of that same original
  // client timestamp.
  const existingTimestampValue = BigInt(existingTimestamp);
  const existingReceivedAtValue = BigInt(existingReceivedAt);
  return (
    existingTimestampValue === existingReceivedAtValue + BigInt(maxClockDriftMs) &&
    existingTimestampValue <= BigInt(incomingOriginalTimestamp)
  );
};

export const areJsonValuesEqual = (a: unknown, b: unknown): boolean => {
  return stableJsonStringify(a) === stableJsonStringify(b);
};

export const stableJsonStringify = (value: unknown): string => {
  return JSON.stringify(toStableJsonValue(value)) ?? 'undefined';
};

export const toStableJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => toStableJsonValue(item));
  }

  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.keys(value as Record<string, unknown>)
        .sort()
        .map((key) => [key, toStableJsonValue((value as Record<string, unknown>)[key])]),
    );
  }

  return value;
};

export const getConflictEntityIds = (op: Operation): string[] => {
  const rawEntityIds = op.entityIds?.length
    ? op.entityIds
    : op.entityId
      ? [op.entityId]
      : [];
  return Array.from(new Set(rawEntityIds));
};

export const getConflictEntityPairs = (op: Operation): EntityConflictPair[] => {
  const rawEntityPairs: EntityConflictPair[] = [
    ...(op.affectedEntities ?? []),
    ...getConflictEntityIds(op).map((entityId) => ({
      entityType: op.entityType,
      entityId,
    })),
  ];
  const entityPairs = new Map<string, EntityConflictPair>();

  for (const entity of rawEntityPairs) {
    if (!entity.entityType || !entity.entityId) continue;
    entityPairs.set(getEntityConflictKey(entity.entityType, entity.entityId), {
      entityType: entity.entityType,
      entityId: entity.entityId,
    });
  }

  return Array.from(entityPairs.values());
};

export const getEntityConflictKey = (entityType: string, entityId: string): string => {
  return `${entityType}\u0000${entityId}`;
};

export const getBatchConflictEntityPairs = (
  candidates: BatchUploadCandidate[],
): EntityConflictPair[] => {
  const entityPairs = new Map<string, EntityConflictPair>();

  for (const candidate of candidates) {
    if (isFullStateOpType(candidate.op.opType)) continue;

    for (const entity of getConflictEntityPairs(candidate.op)) {
      entityPairs.set(getEntityConflictKey(entity.entityType, entity.entityId), entity);
    }
  }

  return Array.from(entityPairs.values());
};

export const prefetchLatestEntityOpsForBatch = async (
  userId: number,
  entityPairs: EntityConflictPair[],
  tx: Prisma.TransactionClient,
): Promise<Map<string, LatestBatchEntityOperationRow>> => {
  const latestByEntity = new Map<string, LatestBatchEntityOperationRow>();
  if (entityPairs.length === 0) return latestByEntity;

  for (
    let start = 0;
    start < entityPairs.length;
    start += CONFLICT_DETECTION_ENTITY_BATCH_SIZE
  ) {
    const touchedRows = entityPairs.slice(
      start,
      start + CONFLICT_DETECTION_ENTITY_BATCH_SIZE,
    );
    const touchedPlaceholders = touchedRows
      .map((_, index) => `($${index * 2 + 2}, $${index * 2 + 3})`)
      .join(', ');
    const touchedParams = touchedRows.flatMap(({ entityType, entityId }) => [
      entityType,
      entityId,
    ]);

    const latestOps = await queryRawWithBoundParams<LatestBatchEntityOperationRow[]>(
      tx,
      `
      SELECT DISTINCT ON (ae.entity_type, ae.entity_id)
        ae.entity_type AS "entityType",
        ae.entity_id AS "entityId",
        o.client_id AS "clientId",
        o.vector_clock AS "vectorClock"
      FROM operation_affected_entities ae
      JOIN operations o ON o.id = ae.operation_id
      JOIN (VALUES ${touchedPlaceholders}) AS touched(entity_type, entity_id)
        ON touched.entity_type = ae.entity_type
       AND touched.entity_id = ae.entity_id
      WHERE ae.user_id = $1
      ORDER BY ae.entity_type, ae.entity_id, ae.server_seq DESC
    `,
      userId,
      ...touchedParams,
    );

    for (const latestOp of latestOps) {
      latestByEntity.set(
        getEntityConflictKey(latestOp.entityType, latestOp.entityId),
        latestOp,
      );
    }
  }

  return latestByEntity;
};

export const pruneVectorClockForStorage = (op: Operation): void => {
  const beforeSize = Object.keys(op.vectorClock).length;
  op.vectorClock = limitVectorClockSize(op.vectorClock, [op.clientId]);
  const afterSize = Object.keys(op.vectorClock).length;
  if (afterSize < beforeSize) {
    Logger.debug(
      `[client:${op.clientId}] Vector clock pruned from ${beforeSize} to ${afterSize} before storage`,
    );
  }
};
