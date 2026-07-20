import { Prisma } from '@prisma/client';
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
  // PERF — this must stay TWO separately-indexed lookups. It was one Prisma filter
  // (`OR: [{ entityId }, { entityIds: { has: entityId } }]` +
  // `orderBy: { serverSeq: 'desc' }`), and that took production down. The OR spans
  // two different indexes — the (user_id, entity_type, entity_id, server_seq) btree
  // and the entity_ids GIN — and GIN cannot supply server_seq ordering, so the
  // planner abandons BOTH index paths and walks (user_id, server_seq) backwards
  // applying the OR as a filter, betting `LIMIT 1` is satisfied early. For an entity
  // with no matching rows — the first-ever op for a new task, the single most common
  // upload there is — that bet loses and it scans the user's entire operation
  // history, worst for the deepest histories.
  //
  // Live evidence (sync.super-productivity.com): 47 backends stuck on exactly this
  // query, the longest running 75 MINUTES, wait_event=DataFileRead, 61 of 66
  // connections active → Prisma pool exhaustion → every user's upload AND download
  // failing with "Unable to start a transaction in the given time". Not a missing
  // index: every index on `operations` was valid. The previous comment here asserted
  // the planner would pick a BitmapOr + sort instead; production disproved that.
  //
  // Why it looked fine and then wasn't: the planner only takes the walk when it has
  // NO array-element statistics for entity_ids. Without them it falls back to a
  // default `@>` selectivity (0.5%) and estimates ~150 of 30k rows match, so LIMIT 1
  // looks like it exits after ~200 rows. Populate entity_ids on even 6 rows in 30k
  // and ANALYZE, and the estimate drops to ~1 row and BitmapOr wins. Empty is the
  // DEPLOYED state: entity_ids was added by 20260613000000 with no backfill, and
  // getStoredEntityIds stores [] for every single-entity op. Statistics are also
  // table-wide, so if ANALYZE's sample holds no non-empty array, every user's
  // uploads degenerate at once — a cliff, not a gradual slope. Re-EXPLAIN on a
  // table with populated entity_ids and you will wrongly conclude this is fine;
  // conflict-entity-lookup-plan.pglite.spec.ts pins the real conditions.
  //
  // Carried over from the comment this replaces: the batch unnest paths
  // (detectConflictForEntities / prefetchLatestEntityOpsForBatch) rest on the same
  // missing entity_ids statistics. They are NOT exposed to this trap — no LIMIT, and
  // DISTINCT ON forces full evaluation of the matching set, so the "LIMIT 1 exits
  // early" bet cannot be made — but EXPLAIN them first if heavy-user latency returns.
  //
  // Scalar branch: the (user_id, entity_type, entity_id, server_seq) btree covers all
  // three equality columns PLUS the sort column, so this is a direct index seek and a
  // one-step backward walk. No trap — the ORDER BY is served by the index itself.
  const scalarOp = await tx.operation.findFirst({
    where: { userId, entityType: op.entityType, entityId },
    select: { actionType: true, clientId: true, vectorClock: true, serverSeq: true },
    orderBy: { serverSeq: 'desc' },
  });

  // Array branch — deliberately an aggregate, NOT
  // `findFirst({ entityIds: { has: entityId }, orderBy: { serverSeq: 'desc' } })`.
  // That naive form REINTRODUCES the incident above: GIN still cannot order, so the
  // planner can still choose the LIMIT-driven backward walk (verified — it produces
  // a byte-identical bad plan; pinned by conflict-entity-lookup-plan.pglite.spec.ts).
  //
  // Prisma compiles `aggregate` to `SELECT MAX(x) FROM (SELECT ... OFFSET 0) sub`,
  // and that `OFFSET 0` is a Postgres planner optimization fence. Here the fence is
  // exactly what we want: it FORBIDS the ordered LIMIT-1 walk and forces the GIN
  // bitmap path, whose cost is bounded by actually-matching rows (zero, for a new
  // entity). This is the SAME construct that caused a DIFFERENT incident in
  // 410dac6785 (op-download minSeq), where a first-row index seek WAS wanted and the
  // fence prevented it. Right here, wrong there — do not "optimize" this back into a
  // findFirst. Sequential, never Promise.all: `tx` is a single-connection interactive
  // transaction client and concurrent queries on it are unsafe.
  //
  // Verified against production Postgres (user with 88k ops, probing an entity id with
  // zero matches — the pathological case): this branch plans as
  // Aggregate → Bitmap Heap Scan → Bitmap Index Scan on operations_entity_ids_gin.
  // Measured AFTER an ANALYZE and a GIN pending-list flush: old OR shape 12 buffers,
  // this split 9 (scalar 4 + array 5). In that regime the two are COMPARABLE — the
  // point of the split is not throughput, it is that neither branch offers the planner
  // a LIMIT-driven early-exit bet, so it cannot degenerate into the backward walk no
  // matter what the statistics say. (Wall-clock on a live server is too noisy to quote:
  // the same old-shape query measured 255ms and 915ms on consecutive runs while its
  // buffer count fell. Compare buffers, not milliseconds.)
  //
  // The old shape stays one autovacuum re-sample away from the incident plan: even
  // post-ANALYZE the planner still estimates rows=96 for a zero-match `entity_ids @>`
  // key, so the selectivity estimate is NOT fixed — the good plan is luck holding.
  //
  // LOAD-BEARING AND UNTESTED: the fence is a Prisma implementation detail. The PGlite
  // spec hand-writes the SQL rather than invoking Prisma, so if a Prisma upgrade stops
  // emitting `OFFSET 0`, the suite stays green while production silently regresses to
  // the incident plan. On any Prisma major bump, re-run the EXPLAIN above before
  // shipping.
  const arrayBranchMax = await tx.operation.aggregate({
    where: { userId, entityType: op.entityType, entityIds: { has: entityId } },
    _max: { serverSeq: true },
  });
  const arrayBranchMaxSeq = arrayBranchMax._max.serverSeq ?? null;

  // Fetch the array-branch row only when it actually beats the scalar branch.
  // (user_id, server_seq) is UNIQUE, so this is a single indexed point lookup, and
  // ties need no tie-break: an equal server_seq IS the same row.
  //
  // NEGATIVE_INFINITY, not -1: server_seq is >= 1 today, so -1 would work — but if a
  // sentinel ever collided the array branch would lose to a non-existent scalar row
  // and the op would be accepted as conflict-free, silently overwriting a remote edit.
  // Sentinel-free comparison costs nothing and removes that failure mode entirely.
  const arrayOp =
    arrayBranchMaxSeq !== null &&
    arrayBranchMaxSeq > (scalarOp?.serverSeq ?? Number.NEGATIVE_INFINITY)
      ? await tx.operation.findUnique({
          where: { userId_serverSeq: { userId, serverSeq: arrayBranchMaxSeq } },
          select: {
            actionType: true,
            clientId: true,
            vectorClock: true,
            serverSeq: true,
          },
        })
      : null;

  const existingOp = arrayOp ?? scalarOp;

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
            // Only pre-split (< v2) misc rows carry migrated task settings; a
            // post-split v2/v3 misc write is disjoint from `tasks`. Gate on the
            // fixed split boundary, NOT the moving CURRENT_SCHEMA_VERSION, or
            // every schema bump aliases already-split misc writes to tasks and
            // fabricates conflicts between disjoint settings (matches the
            // isLegacyMiscConfigOperation gate).
            schemaVersion: { lt: MISC_TASKS_SPLIT_SCHEMA_VERSION },
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
  // Reproduce the normalization of the already-stored row. Storage may protect
  // a low-counter causal full-state author in addition to the uploader, so use
  // the stored clock's IDs as the authoritative protected set. Otherwise a
  // genuine retry of an oversized post-import op compares as an ID collision.
  //
  // Tradeoff, deliberate: for an oversized incoming clock this projects onto the
  // stored key set, so an id collision that ALSO differs only by an extra clock
  // entry now reads as a duplicate instead of being caught. Accepted because
  // every other structural field below (clientId, payload, entity, timestamp)
  // must still match — and when they all do, acking beats rejecting a retry
  // whose only sin is having learned about one more client.
  const storedClockClientIds =
    existingOp.vectorClock !== null &&
    typeof existingOp.vectorClock === 'object' &&
    !Array.isArray(existingOp.vectorClock)
      ? Object.keys(existingOp.vectorClock)
      : [];
  const storedVectorClock = limitVectorClockSize(op.vectorClock, [
    op.clientId,
    ...storedClockClientIds,
  ]);
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
        // Gate on the fixed split boundary, not CURRENT_SCHEMA_VERSION; see the
        // detectConflictForEntity legacy-misc lookup for the full rationale.
        schemaVersion: { lt: MISC_TASKS_SPLIT_SCHEMA_VERSION },
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

export const pruneVectorClockForStorage = (
  op: Operation,
  preserveClientIds: readonly string[] = [],
): void => {
  const beforeSize = Object.keys(op.vectorClock).length;
  op.vectorClock = limitVectorClockSize(op.vectorClock, [
    op.clientId,
    ...preserveClientIds,
  ]);
  const afterSize = Object.keys(op.vectorClock).length;
  if (afterSize < beforeSize) {
    Logger.debug(
      `[client:${op.clientId}] Vector clock pruned from ${beforeSize} to ${afterSize} before storage`,
    );
  }
};
