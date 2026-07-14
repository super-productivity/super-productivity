import { Prisma } from '@prisma/client';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
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

const TASK_TIME_DELTA_ACTION_TYPE = '[TimeTracking] Sync time spent';

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

  // Build list of entity IDs to check for conflicts.
  // Operations may have either entityId (singular) or entityIds (batch operations).
  const rawEntityIdsToCheck = getConflictEntityIds(op);

  // Skip if no entity IDs (can't have entity-level conflicts)
  if (rawEntityIdsToCheck.length === 0) {
    return { hasConflict: false };
  }

  if (rawEntityIdsToCheck.length === 1) {
    return detectConflictForEntity(userId, op, rawEntityIdsToCheck[0], tx);
  }

  // v1 GLOBAL_CONFIG:misc contains fields that became GLOBAL_CONFIG:tasks in
  // v2. This compatibility path is intentionally per-key: it is rare, keeps
  // the normal multi-entity SQL unchanged, and works for encrypted legacy
  // payloads whose contents the server cannot inspect.
  if (isLegacyMiscConfigOperation(op)) {
    for (const entityId of rawEntityIdsToCheck) {
      const result = await detectConflictForEntity(userId, op, entityId, tx);
      if (result.hasConflict) return result;
    }
    return { hasConflict: false };
  }

  const entityIdsToCheck = Array.from(new Set(rawEntityIdsToCheck));
  return detectConflictForEntities(userId, op, entityIdsToCheck, tx);
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
    // Match each requested id against the op's full entity set: the entity_ids
    // array UNION the scalar entity_id. The scalar is always folded in (not just
    // when entity_ids is empty) so an op whose entity_id is NOT a member of its
    // own entity_ids — possible when a multi-entity op dedups to a different
    // primary, see getStoredEntityIds — still exposes that scalar entity here.
    // DISTINCT ON dedupes the harmless overlap when entity_id is already in the
    // array (the common entity_id = entityIds[0] case). The `&&`/`= ANY`
    // prefilter keeps the GIN(entity_ids) + entity_id indexes usable; `eid = ANY`
    // keeps only the requested entities, then DISTINCT ON picks the latest op per
    // entity. Kept inline (not a shared fragment) so the positional params stay
    // stable for the conflict-detection.spec mock; the same shape is duplicated in
    // prefetchLatestEntityOpsForBatch — keep them in sync. (#8334)
    const idArray = Prisma.sql`ARRAY[${Prisma.join(batchEntityIds)}]::text[]`;
    const latestOps = await tx.$queryRaw<LatestEntityOperationRow[]>`
      SELECT DISTINCT ON (eid)
        eid AS "entityId",
        o.client_id AS "clientId",
        o.action_type AS "actionType",
        o.vector_clock AS "vectorClock"
      FROM operations o
      CROSS JOIN LATERAL unnest(
        o.entity_ids || CASE WHEN o.entity_id IS NULL THEN '{}'::text[] ELSE ARRAY[o.entity_id] END
      ) AS eid
      WHERE o.user_id = ${userId}
        AND o.entity_type = ${op.entityType}
        AND (o.entity_ids && ${idArray} OR o.entity_id = ANY(${idArray}))
        AND eid = ANY(${idArray})
      ORDER BY eid, o.server_seq DESC
    `;

    const latestOpByEntityId = new Map<string, LatestEntityOperationRow>();
    for (const latestOp of latestOps) {
      latestOpByEntityId.set(latestOp.entityId, latestOp);
    }

    for (const entityId of batchEntityIds) {
      const existingOp = latestOpByEntityId.get(entityId);
      if (!existingOp) continue;

      const conflictResult = resolveConflictForExistingOp(op, entityId, existingOp);
      if (conflictResult.hasConflict) {
        return conflictResult;
      }
    }
  }

  return { hasConflict: false };
};

export const resolveConflictForExistingOp = (
  op: Operation,
  entityId: string,
  existingOp: { actionType?: string; clientId: string; vectorClock: unknown },
): ConflictResult => {
  // Stored JSON/vector_clock values arrive as unknown from both Prisma model
  // reads and raw SQL rows; cast only at the vector-clock comparison boundary.
  const existingClock = existingOp.vectorClock as unknown as VectorClock;

  // Compare vector clocks
  const comparison = compareVectorClocks(op.vectorClock, existingClock);

  // Timer batches are additive and uniquely identified operations. Concurrent
  // deltas commute, so entity-level LWW must not discard either contribution.
  // Keep the causal checks below for EQUAL/LESS_THAN clocks: those operations
  // may already be represented by the stored state and replaying them could
  // double-count time.
  if (
    comparison === 'CONCURRENT' &&
    op.actionType === TASK_TIME_DELTA_ACTION_TYPE &&
    existingOp.actionType === TASK_TIME_DELTA_ACTION_TYPE
  ) {
    return { hasConflict: false };
  }

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
      reason: `Equal vector clocks from different clients for ${op.entityType}:${entityId} (client ${op.clientId} vs ${existingOp.clientId})`,
      existingClock,
    };
  }

  // CONCURRENT means both clocks have entries the other doesn't
  if (comparison === 'CONCURRENT') {
    return {
      hasConflict: true,
      conflictType: 'concurrent',
      reason: `Concurrent modification detected for ${op.entityType}:${entityId}`,
      existingClock,
    };
  }

  // LESS_THAN means the incoming op is older than what we have
  if (comparison === 'LESS_THAN') {
    return {
      hasConflict: true,
      conflictType: 'superseded',
      reason: `Superseded operation: server has newer version of ${op.entityType}:${entityId}`,
      existingClock,
    };
  }

  // Should never reach here - all comparison cases handled above
  // But if we do, default to conflict for safety
  return {
    hasConflict: true,
    conflictType: 'unknown',
    reason: `Unknown vector clock comparison result for ${op.entityType}:${entityId}`,
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
  entityId: string,
  tx: Prisma.TransactionClient,
): Promise<ConflictResult> => {
  // Get the latest op that touched this entity. A multi-entity (batch) op stores
  // its full set in entity_ids, so match the entity as the scalar entity_id OR a
  // member of entity_ids. Single-entity ops store an empty array and are matched
  // via the scalar; pre-migration rows likewise fall back to the scalar (#8334).
  //
  // PERF: the OR spans the entity_id btree + the entity_ids GIN, so the planner
  // uses a BitmapOr + sort rather than an ordered LIMIT-1 walk. Bounded by one
  // entity's stored version depth (op-log pruning keeps that small, so the sort is
  // sub-ms in practice). If a real-Postgres EXPLAIN on a deep-history entity ever
  // shows this hot path (run per single-entity upload) is a problem, split into two
  // ordered LIMIT-1 lookups (scalar btree + entity_ids GIN) and take the higher
  // server_seq — the array branch stays small because entity_ids is multi-entity-only.
  // The batch unnest paths (detectConflictForEntities / prefetchLatestEntityOpsForBatch)
  // carry the larger sort, so EXPLAIN those first under heavy-user latency.
  const existingOp = await tx.operation.findFirst({
    where: {
      userId,
      entityType: op.entityType,
      OR: [{ entityId }, { entityIds: { has: entityId } }],
    },
    select: { actionType: true, clientId: true, vectorClock: true, serverSeq: true },
    orderBy: { serverSeq: 'desc' },
  });

  // Histories written before schema v2 persist migrated task settings under
  // the raw `GLOBAL_CONFIG:misc` key. Consult that key as an alias when the
  // incoming write targets `tasks`; no backfill (and no payload decryption) is
  // required. Pick the newer of the canonical and legacy rows.
  //
  // NOTE: the alias exists only on this per-entity path. A v2 MULTI-entity op
  // whose entityIds include 'tasks' goes through detectConflictForEntities and
  // skips the legacy lookup — acceptable today because GLOBAL_CONFIG writes are
  // single-entity; revisit if a batch path ever carries config entities.
  const legacyMiscOp =
    op.entityType === 'GLOBAL_CONFIG' && entityId === 'tasks'
      ? await tx.operation.findFirst({
          where: {
            userId,
            entityType: 'GLOBAL_CONFIG',
            entityId: 'misc',
            schemaVersion: { lt: CURRENT_SCHEMA_VERSION },
          },
          select: { clientId: true, vectorClock: true, serverSeq: true },
          orderBy: { serverSeq: 'desc' },
        })
      : null;

  const latestExistingOp =
    legacyMiscOp &&
    (!existingOp || (legacyMiscOp.serverSeq ?? -1) > (existingOp.serverSeq ?? -1))
      ? legacyMiscOp
      : existingOp;

  // No existing operation = no conflict
  if (!latestExistingOp) {
    return { hasConflict: false };
  }

  return resolveConflictForExistingOp(op, entityId, latestExistingOp);
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
    // Compare against the same normalization the row was persisted with
    // (getStoredEntityIds: single-entity sets collapse to []), so a genuine
    // retry matches while a batch op differing only in entityIds does not.
    areJsonValuesEqual(existingOp.entityIds, getStoredEntityIds(op)) &&
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
    existingOp.syncImportReason === (op.syncImportReason ?? null) &&
    existingOp.repairBaseServerSeq === (op.repairBaseServerSeq ?? null)
  );
};

/** Complete identity comparison for two validated operations in one request. */
export const isSameIncomingOperation = (
  first: Operation,
  second: Operation,
  firstOriginalTimestamp: number = first.timestamp,
  secondOriginalTimestamp: number = second.timestamp,
): boolean => {
  const bothEncrypted =
    (first.isPayloadEncrypted ?? false) && (second.isPayloadEncrypted ?? false);
  return (
    first.clientId === second.clientId &&
    first.actionType === second.actionType &&
    first.opType === second.opType &&
    first.entityType === second.entityType &&
    first.entityId === second.entityId &&
    areJsonValuesEqual(getStoredEntityIds(first), getStoredEntityIds(second)) &&
    (bothEncrypted || areJsonValuesEqual(first.payload, second.payload)) &&
    areJsonValuesEqual(
      limitVectorClockSize(first.vectorClock, [first.clientId]),
      limitVectorClockSize(second.vectorClock, [second.clientId]),
    ) &&
    first.schemaVersion === second.schemaVersion &&
    firstOriginalTimestamp === secondOriginalTimestamp &&
    (first.isPayloadEncrypted ?? false) === (second.isPayloadEncrypted ?? false) &&
    (first.syncImportReason ?? null) === (second.syncImportReason ?? null) &&
    (first.repairBaseServerSeq ?? null) === (second.repairBaseServerSeq ?? null)
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

/**
 * All entities an op touches (full set, including single-entity ops). Use for the
 * incoming-op conflict check and the in-memory in-batch map — NOT for the persisted
 * `entity_ids` column, which uses {@link getStoredEntityIds} (multi-entity only).
 */
export const getConflictEntityIds = (op: Operation): string[] => {
  const rawEntityIds = [
    ...(op.entityId ? [op.entityId] : []),
    ...(op.entityIds?.length ? op.entityIds : []),
  ];
  if (isLegacyMiscConfigOperation(op)) {
    rawEntityIds.push('tasks');
  }
  return Array.from(new Set(rawEntityIds));
};

/**
 * The misc→tasks settings split happened in the v1→v2 migration
 * (`MiscToTasksSettingsMigration_v1v2`), so ONLY pre-v2 `GLOBAL_CONFIG:misc`
 * writes also touched what is now `GLOBAL_CONFIG:tasks`. Gate on that fixed
 * boundary, not the moving `CURRENT_SCHEMA_VERSION`: otherwise every schema bump
 * (e.g. v3→v4) newly aliases already-split misc writes to tasks and fabricates
 * conflicts between disjoint settings during rollout.
 */
const MISC_TASKS_SPLIT_SCHEMA_VERSION = 2;

const isLegacyMiscConfigOperation = (op: Operation): boolean =>
  op.schemaVersion < MISC_TASKS_SPLIT_SCHEMA_VERSION &&
  op.entityType === 'GLOBAL_CONFIG' &&
  op.entityId === 'misc';

/**
 * The entity_ids array to persist with an op. Ops whose touched-entity set is
 * already covered by the scalar entity_id store an empty array, so single-entity
 * ops (the vast majority) stay out of the entity_ids GIN index — keeping it small
 * and off their insert write path (Postgres GIN indexes no keys for an empty
 * array). Any other set is stored in full.
 *
 * The gate is "is the set exactly [entity_id]?", NOT "length > 1": a batch op
 * whose ids dedup to a single value that differs from entity_id (the server does
 * not enforce entity_id === entityIds[0]) must still be stored, or that entity
 * would be invisible to conflict lookups (#8334).
 */
export const getStoredEntityIds = (op: Operation): string[] => {
  // Preserve the historical storage normalization: the scalar is persisted in
  // entity_id and only the declared multi-entity set belongs in entity_ids.
  // Conflict detection unions both fields via getConflictEntityIds above.
  const ids = Array.from(
    new Set(op.entityIds?.length ? op.entityIds : op.entityId ? [op.entityId] : []),
  );
  if (ids.length <= 1 && ids[0] === op.entityId) {
    return [];
  }
  return ids;
};

export const getEntityConflictKey = (entityType: string, entityId: string): string => {
  return `${entityType}\u0000${entityId}`;
};

export const getBatchConflictEntityPairs = (
  candidates: BatchUploadCandidate[],
): { entityType: string; entityId: string }[] => {
  const entityPairs = new Map<string, { entityType: string; entityId: string }>();

  for (const candidate of candidates) {
    if (isFullStateOpType(candidate.op.opType)) continue;

    for (const entityId of getConflictEntityIds(candidate.op)) {
      entityPairs.set(getEntityConflictKey(candidate.op.entityType, entityId), {
        entityType: candidate.op.entityType,
        entityId,
      });
    }
  }

  return Array.from(entityPairs.values());
};

export const prefetchLatestEntityOpsForBatch = async (
  userId: number,
  entityPairs: { entityType: string; entityId: string }[],
  tx: Prisma.TransactionClient,
): Promise<Map<string, LatestBatchEntityOperationRow>> => {
  const latestByEntity = new Map<string, LatestBatchEntityOperationRow>();
  if (entityPairs.length === 0) return latestByEntity;

  for (
    let start = 0;
    start < entityPairs.length;
    start += CONFLICT_DETECTION_ENTITY_BATCH_SIZE
  ) {
    const batchPairs = entityPairs.slice(
      start,
      start + CONFLICT_DETECTION_ENTITY_BATCH_SIZE,
    );
    const touchedRows = batchPairs.map(
      ({ entityType, entityId }) => Prisma.sql`(${entityType}, ${entityId})`,
    );
    // Prefilter array (all requested ids) so the JOIN below can match a requested
    // id inside a stored op's entity_ids set, not just its scalar entity_id, while
    // keeping the GIN(entity_ids) + entity_id indexes usable. The unnest folds the
    // scalar entity_id into the entity_ids set (UNION, deduped by DISTINCT ON) so a
    // divergent scalar is never missed — see the matching note in
    // detectConflictForEntities; keep the two shapes in sync. (#8334)
    const idArray = Prisma.sql`ARRAY[${Prisma.join(
      batchPairs.map((pair) => pair.entityId),
    )}]::text[]`;

    const latestOps = await tx.$queryRaw<LatestBatchEntityOperationRow[]>`
      SELECT DISTINCT ON (o.entity_type, eid)
        o.entity_type AS "entityType",
        eid AS "entityId",
        o.client_id AS "clientId",
        o.action_type AS "actionType",
        o.vector_clock AS "vectorClock",
        o.server_seq AS "serverSeq"
      FROM operations o
      CROSS JOIN LATERAL unnest(
        o.entity_ids || CASE WHEN o.entity_id IS NULL THEN '{}'::text[] ELSE ARRAY[o.entity_id] END
      ) AS eid
      JOIN (VALUES ${Prisma.join(touchedRows)}) AS touched(entity_type, entity_id)
        ON touched.entity_type = o.entity_type
       AND touched.entity_id = eid
      WHERE o.user_id = ${userId}
        AND (o.entity_ids && ${idArray} OR o.entity_id = ANY(${idArray}))
      ORDER BY o.entity_type, eid, o.server_seq DESC
    `;

    for (const latestOp of latestOps) {
      latestByEntity.set(
        getEntityConflictKey(latestOp.entityType, latestOp.entityId),
        latestOp,
      );
    }
  }

  if (
    entityPairs.some(
      ({ entityType, entityId }) =>
        entityType === 'GLOBAL_CONFIG' && entityId === 'tasks',
    )
  ) {
    const legacyMiscOp = await tx.operation.findFirst({
      where: {
        userId,
        entityType: 'GLOBAL_CONFIG',
        entityId: 'misc',
        schemaVersion: { lt: CURRENT_SCHEMA_VERSION },
      },
      select: { actionType: true, clientId: true, vectorClock: true, serverSeq: true },
      orderBy: { serverSeq: 'desc' },
    });
    const tasksKey = getEntityConflictKey('GLOBAL_CONFIG', 'tasks');
    const currentTasksOp = latestByEntity.get(tasksKey);
    if (
      legacyMiscOp &&
      (!currentTasksOp ||
        (legacyMiscOp.serverSeq ?? -1) > (currentTasksOp.serverSeq ?? -1))
    ) {
      latestByEntity.set(tasksKey, {
        entityType: 'GLOBAL_CONFIG',
        entityId: 'tasks',
        ...legacyMiscOp,
      });
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
