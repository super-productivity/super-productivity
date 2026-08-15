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
 * ARRAY-branch candidates for BOTH batch conflict lookups: every stored op whose
 * `entity_ids` contains a probed id, tagged with the id that matched. Shared rather than
 * hand-copied — the #8334 "keep these two in sync" hazard is exactly what let #9503 ship
 * the same mis-plan into both queries.
 *
 * Three properties are load-bearing. Each is a COST property, not a correctness one, so
 * nothing here fails loudly; changing one needs the full measurements in
 * docs/sync-and-op-log/vector-clocks.md, not a single benchmark.
 *
 * - `p.eid` is CARRIED, never re-derived downstream by unnesting `entity_ids`: `cand`
 *   already holds one copy of the op per matching probe id, so re-deriving fans out
 *   quadratically on wide arrays, and callers normally probe ids that OVERLAP the stored
 *   arrays heavily. Guarded by the "does not fan out" tests in
 *   batch-conflict-plan.pglite.spec.ts, which carry the numbers.
 * - `MATERIALIZED` stops the callers' outer user_id / entity_type predicates being pushed
 *   down, which would hand the composite btree back and restore the slice scan this whole
 *   change exists to remove.
 * - ONE `@>` PROBE PER ID, not one `&&` for the batch. Both forms are correct and both fix
 *   #9503. `@>` ships because its terms are bounded (probe size is chunked, descent grows
 *   only with index size) while `&&`'s `matches x stored width` is bounded by nothing a
 *   tenant controls — but `&&` IS ~20x faster on an all-new probe, so this is a real
 *   trade and not a free win. Equivalence of the forms is pinned by
 *   array-branch-equivalence.pglite.spec.ts, which DERIVES the shipped form from this
 *   fragment, so changing it here re-points that spec automatically.
 *
 * NOT user-scoped: like the single-entity path this matches by entity id across ALL users,
 * and the callers' outer WHERE enforces the boundary. Correct — pinned by the ARRAY-branch
 * isolation tests in entity-ids-conflict.pglite.spec.ts — but the cost is not bounded per
 * tenant, which IS a regression against master and is tracked as #9510. The `MATERIALIZED`
 * fence is precisely what forbids putting `user_id` back inside.
 *
 * Exported ONLY so the equivalence spec can splice the real text instead of a copy; it
 * binds no values, and that is asserted there because a `$n` would renumber the callers'
 * parameters.
 */
export const arrayBranchCandidatesCte = (
  probeSource: Prisma.Sql,
): Prisma.Sql => Prisma.sql`
  cand AS MATERIALIZED (
    SELECT p.eid AS eid, o.user_id, o.entity_type, o.client_id, o.action_type,
           o.vector_clock, o.server_seq
    FROM (${probeSource}) p
    JOIN operations o ON o.entity_ids @> ARRAY[p.eid]
  )
`;

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
    // DISTINCT ON then picks the latest op per entity across both branches, which
    // also dedupes the harmless overlap when entity_id is already in the array (the
    // common entity_id = entityIds[0] case). The same shape is duplicated in
    // prefetchLatestEntityOpsForBatch — keep them in sync. (#8334)
    //
    // PERF — this must stay TWO separately-indexed branches, for the reason
    // detectConflictForEntity documents at length below. It was ONE query with a combined
    // `(entity_ids && $arr OR entity_id = ANY($arr))`, and that OR spans the entity_ids
    // GIN and the (user_id, entity_type, entity_id, server_seq) btree, so the planner
    // abandoned both and slice-scanned the btree: a 100-id probe matching NOTHING read and
    // discarded the probed user's ENTIRE (user_id, entity_type) slice, twice per upload
    // inside the transaction, and production cancelled it by statement_timeout every 5-12
    // minutes (#9503). Guarded by batch-conflict-plan.pglite.spec.ts, whose CANARY test
    // still reproduces the mis-plan on the old form.
    //
    // Scalar branch: a lateral top-1 per requested id. All three equality columns
    // PLUS the sort column are covered by the composite btree, so each probe is an
    // index seek that terminates on an empty range when the entity is new.
    //
    // Array branch: per-id `@>` probes. See arrayBranchCandidatesCte for the full cost
    // model and why the one-`&&`-per-batch alternative was measured and rejected.
    //
    // Trade accepted knowingly: this moves the array branch's cost from "the probing
    // user's slice" to a FIXED whole-table GIN probe, so SMALL accounts pay ~13 ms / 700
    // blocks per call they did not pay before (and this path runs twice per upload) while
    // large ones pay far less. Accepted because the term it replaces is unbounded in
    // account history while this one cannot exceed |probe| index descents. Measurements:
    // PR #9516; the unbounded co-tenant term stacked on top of it is #9510.
    //
    // `probe` binds the ids ONCE and is then referenced twice, so Postgres materialises
    // the list once. Its DISTINCT is redundant here (detectConflict already dedupes) and
    // kept only so this shape stays identical to the prefetch sibling, where the same id
    // can legitimately appear under two entity types.
    const idArray = Prisma.sql`ARRAY[${Prisma.join(batchEntityIds)}]::text[]`;
    const latestOps = await tx.$queryRaw<LatestEntityOperationRow[]>`
      WITH probe(eid) AS (
        SELECT DISTINCT eid FROM unnest(${idArray}) AS eid
      ),
      scalar_hits AS (
        SELECT p.eid AS eid, x.client_id, x.action_type, x.vector_clock, x.server_seq
        FROM probe p
        CROSS JOIN LATERAL (
          SELECT o.client_id, o.action_type, o.vector_clock, o.server_seq
          FROM operations o
          WHERE o.user_id = ${userId}
            AND o.entity_type = ${op.entityType}
            AND o.entity_id = p.eid
          ORDER BY o.server_seq DESC
          LIMIT 1
        ) x
      ),
      ${arrayBranchCandidatesCte(Prisma.sql`SELECT eid FROM probe`)},
      array_hits AS (
        SELECT c.eid AS eid, c.client_id, c.action_type, c.vector_clock, c.server_seq
        FROM cand c
        WHERE c.user_id = ${userId}
          AND c.entity_type = ${op.entityType}
      )
      SELECT DISTINCT ON (eid)
        eid AS "entityId",
        client_id AS "clientId",
        action_type AS "actionType",
        vector_clock AS "vectorClock"
      FROM (
        SELECT eid, client_id, action_type, vector_clock, server_seq FROM scalar_hits
        UNION ALL
        SELECT eid, client_id, action_type, vector_clock, server_seq FROM array_hits
      ) u
      ORDER BY eid, server_seq DESC
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
 * Checks conflicts for the common single-entity upload path. TWO separately-indexed
 * lookups: a typed `findFirst` on the scalar entity_id, plus a raw-SQL MATERIALIZED CTE
 * over entity_ids — see the PERF note below, the combined filter caused an outage.
 * Multi-entity operations use the batched raw-SQL path above instead, to avoid one round
 * trip per entity.
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
  // planner abandons BOTH index paths, filters the (user_id, entity_type) slice and
  // sorts it (or walks (user_id, server_seq) backwards, betting `LIMIT 1` resolves
  // early). For an entity with no matching rows — the first-ever op for a new task,
  // the single most common upload there is — nothing bounds that work and it reads
  // the user's whole slice. The batch unnest paths carried the same two-index OR and
  // WERE hit by it: this paragraph used to argue they were safe because they have no
  // LIMIT for the planner to bet on and DISTINCT ON forces full evaluation. Both
  // statements are true and the conclusion was still wrong — "no early-exit bet to
  // lose" and "cheap" are different properties, and the SLICE SCAN does not need a
  // LIMIT. Production cancelled detectConflictForEntities by statement_timeout every
  // 5-12 minutes until it was split the same way (#9503). Both batch queries are now
  // EXPLAINed by batch-conflict-plan.pglite.spec.ts (#9205).
  //
  // Scalar branch: the (user_id, entity_type, entity_id, server_seq) btree covers all
  // three equality columns PLUS the sort column, so this is a direct index seek and a
  // one-step backward walk. No trap — the ORDER BY is served by the index itself.
  const scalarOp = await tx.operation.findFirst({
    where: { userId, entityType: op.entityType, entityId },
    select: { actionType: true, clientId: true, vectorClock: true, serverSeq: true },
    orderBy: { serverSeq: 'desc' },
  });

  // Array branch — raw SQL, and the MATERIALIZED CTE is load-bearing.
  //
  // What the CTE removes structurally is the COMPETING BTREE: inside it the only
  // predicate is `entity_ids @> ...`, so the composite btree has no usable leading
  // column and GIN is the only INDEX available at any cost estimate. MATERIALIZED is
  // what stops the outer user_id / entity_type predicates being pushed down, which
  // would hand the btree back.
  //
  // That is NOT a guarantee that GIN is chosen. A sequential scan is always still
  // available, and wins when the probed id is unselective — both plans have been
  // reproduced on PG16 depending on row shape. GIN winning on production-shaped data is a MEASURED
  // outcome, not a structural one. Re-measure after any change rather than trusting
  // this paragraph; a confidently-worded comment asserting what the planner "will" do
  // is what preceded the outage.
  // Every simpler form reads the whole (user_id, entity_type) slice instead: the
  // array-only `findFirst` + `orderBy`, Prisma's `aggregate({ _max })`, and the flat
  // `SELECT MAX(server_seq) ... AND @>`. (The outage itself was the combined OR
  // described above, not any of these.)
  //
  // Do NOT "simplify" this without measuring under `plan_cache_mode =
  // force_generic_plan`. Prisma sends parameterized prepared statements; under the
  // default `auto` Postgres plans the first ~5 executions as CUSTOM, then compares the
  // generic cost against the average custom cost and MAY switch to a generic plan. That
  // is a cost comparison, not an automatic switch — a statement can stay on custom plans
  // indefinitely. THIS statement was observed going generic on production
  // (pg_prepared_statements: custom_plans=5, generic_plans=15), and a generic plan cannot
  // see the parameter values. `EXPLAIN` with literal constants is different again, and
  // every broken form above looks perfect that way.
  // conflict-entity-lookup-plan.pglite.spec.ts measures the generic mode correctly and
  // fails on a block budget; it does NOT cover custom plans.
  //
  // Adding `server_seq > <scalar seq>` to narrow the CTE was evaluated and REJECTED:
  // under generic planning the bound is invisible, so it lands as a post-GIN Filter
  // and buys nothing, and inside the CTE it lets a custom plan bitmap-scan
  // (user_id, server_seq) on `server_seq > $4` with NO leading-column bound — a
  // full-index scan across every user's history.
  //
  // Isolation: the CTE matches by entity id across ALL users and the outer WHERE
  // enforces the user boundary, so this is CORRECT but NOT cost-bounded per user. Some
  // entity ids are byte-identical across every tenant: the bulk `sortBoards` action
  // (boards.actions.ts) stores the hard-coded 'EISENHOWER_MATRIX' / 'KANBAN_DEFAULT'
  // ids (boards.const.ts) in entity_ids, so probing one walks every tenant's matching
  // rows and the cost scales with total server population, bounded by nothing.
  // Single-entity writes against a shared id — updateTag({ id: 'TODAY' }),
  // updateBoard({ id: 'KANBAN_DEFAULT' }) — do not POPULATE the GIN under that id:
  // getStoredEntityIds persists '{}' for them. They are still a PROBE vector, though.
  // Each one routes through detectConflictForEntity and probes that shared literal, so
  // it walks every tenant's matching rows without contributing any of its own.
  //
  // The fix is a GIN index on the expression (ARRAY['u:' || user_id] || entity_ids),
  // which makes the probe flat. It needs no btree_gin extension (the operand is text[],
  // served by the built-in array_ops) and is measurable in PGlite. Not done here
  // because it is a real tradeoff, not a free win: this predicate must be rewritten to
  // match the expression or the index is simply ignored. Make it PARTIAL
  // (WHERE entity_ids <> '{}') and it covers only the multi-entity minority instead of
  // every row. That is lossless: a single-entity op stores '{}', so its indexed
  // expression is just ARRAY['u:<id>'] and can never contain the real entity id a probe
  // carries. That losslessness is a claim about the DATA and holds by inspection:
  // getStoredEntityIds collapses single-entity sets to [], entity_ids is NOT NULL
  // DEFAULT '{}', and '{}' @> ARRAY[<id>] is false.
  //
  // UNMEASURED, and do not build on it until you have: whether the PARTIAL form is
  // usable at all is a claim about the PLANNER, and nobody has run it. The query would
  // have to carry a matching `AND entity_ids <> '{}'` and Postgres would have to prove
  // that implies the index predicate — for an array `<>`, which is not something this
  // comment has any evidence about. EXPLAIN it under force_generic_plan first (see the
  // plan-cache note above). A comment asserting unmeasured planner behaviour is what
  // preceded the outage; this paragraph is a lead to chase, not a design to trust.
  //
  // The outer user_id predicate stays load-bearing either way — the 'u:' prefix is a
  // namespace, not a security boundary.
  //
  // Sequential, never Promise.all: `tx` is a single-connection interactive transaction
  // client and concurrent queries on it are unsafe.
  const arrayBranchRows = await tx.$queryRaw<Array<{ maxSeq: number | null }>>`
    WITH cand AS MATERIALIZED (
      SELECT user_id, entity_type, server_seq
      FROM operations
      WHERE entity_ids @> ARRAY[${entityId}]::text[]
    )
    SELECT MAX(server_seq)::int AS "maxSeq"
    FROM cand
    WHERE user_id = ${userId} AND entity_type = ${op.entityType}
  `;
  // INVARIANT: an aggregate with no GROUP BY returns exactly one row, so the `?.`
  // fold below is unreachable and `maxSeq` is null only when nothing matched.
  // `GROUP BY user_id` would NOT break that: zero groups arise only when zero rows
  // matched, which folds to null and correctly reads as "no prior op" — the same
  // outcome as `MAX` over no rows. What DOES break it is any grouping that can return
  // more than one row (`GROUP BY server_seq`, say), because `[0]` then takes an
  // arbitrary group instead of the maximum and can under-report the latest op — silent
  // acceptance of a conflicting write, not an error. No runtime guard here on purpose
  // (it could never fire today); if you change the shape of this query, change this
  // fold with it.
  const arrayBranchMaxSeq = arrayBranchRows[0]?.maxSeq ?? null;

  // Fetch the array-branch row only when it actually beats the scalar branch.
  // (user_id, server_seq) is UNIQUE, so this is a single indexed point lookup, and
  // ties need no tie-break: an equal server_seq IS the same row.
  const arrayWins =
    arrayBranchMaxSeq !== null && (!scalarOp || arrayBranchMaxSeq > scalarOp.serverSeq);
  const arrayOp = arrayWins
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

  // This `??` carries TWO meanings: "the array branch did not win" and "the array
  // branch won but its row was not there". Only the first is reachable — the MAX came
  // from a row in this transaction's snapshot and (user_id, server_seq) is unique, so
  // at RepeatableRead the row cannot vanish under us. If the isolation level is ever
  // lowered, the second case silently falls back to the STALE scalar row and accepts a
  // write that should have conflicted. Retiring the separate findUnique (see the
  // row-returning CTE, #9197) removes this ambiguity rather than guarding it.
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
 * already covered by the scalar entity_id store an empty array; any other set is
 * stored in full.
 *
 * This makes the entity_ids GIN index CHEAP, not absent. Postgres indexes an empty
 * array as one degenerate GIN_CAT_EMPTY_ITEM key, so single-entity ops DO have index
 * entries, the index grows with row count (measured on an all-empty column: 10k rows
 * → 5 pages, 30k → 7, 60k → 11) and every insert still touches it. The win is one
 * key per single-entity op instead of one key per member, which keeps
 * `entity_ids @> ARRAY[id]` probes bounded by genuine multi-entity matches.
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
    // The ::text casts pin the VALUES list's column types.
    const touchedRows = batchPairs.map(
      ({ entityType, entityId }) => Prisma.sql`(${entityType}::text, ${entityId}::text)`,
    );

    // Two separately-indexed branches, mirroring detectConflictForEntities — see the PERF
    // note there. The array branch is the shared arrayBranchCandidatesCte, so only the
    // scalar branch and the keying differ. (#8334) This was the WORSE of the two under the
    // old OR form: it carries no `entity_type` predicate of its own, so the btree's usable
    // prefix was just `user_id` and the degeneracy read the user's ENTIRE history across
    // every entity type. Only `batchUpload` defaulting to false spared it production
    // traffic (#9503).
    //
    // `array_hits` re-checks the entity TYPE with a row-wise `IN`, not a `JOIN`: `cand` is
    // keyed by id alone (the probe source drops the type), so a stored op matched by id
    // must still be confirmed against the requested (type, id) PAIR. Semi-join vs JOIN is
    // a cost choice here, not a correctness one — the outer DISTINCT ON absorbs either.
    // Either way the residual is |cand| x |touched|, bounded by the batch size and
    // independent of how wide the stored arrays are, which is what distinguishes it from
    // a fan-out.
    const latestOps = await tx.$queryRaw<LatestBatchEntityOperationRow[]>`
      WITH touched(entity_type, entity_id) AS (
        VALUES ${Prisma.join(touchedRows)}
      ),
      scalar_hits AS (
        SELECT t.entity_type, t.entity_id AS eid, x.client_id, x.action_type,
               x.vector_clock, x.server_seq
        FROM touched t
        CROSS JOIN LATERAL (
          SELECT o.client_id, o.action_type, o.vector_clock, o.server_seq
          FROM operations o
          WHERE o.user_id = ${userId}
            AND o.entity_type = t.entity_type
            AND o.entity_id = t.entity_id
          ORDER BY o.server_seq DESC
          LIMIT 1
        ) x
      ),
      ${arrayBranchCandidatesCte(
        Prisma.sql`SELECT DISTINCT entity_id AS eid FROM touched`,
      )},
      array_hits AS (
        SELECT c.entity_type, c.eid AS eid, c.client_id, c.action_type,
               c.vector_clock, c.server_seq
        FROM cand c
        WHERE c.user_id = ${userId}
          AND (c.entity_type, c.eid) IN (SELECT entity_type, entity_id FROM touched)
      )
      SELECT DISTINCT ON (entity_type, eid)
        entity_type AS "entityType",
        eid AS "entityId",
        client_id AS "clientId",
        action_type AS "actionType",
        vector_clock AS "vectorClock",
        server_seq AS "serverSeq"
      FROM (
        SELECT entity_type, eid, client_id, action_type, vector_clock, server_seq
        FROM scalar_hits
        UNION ALL
        SELECT entity_type, eid, client_id, action_type, vector_clock, server_seq
        FROM array_hits
      ) u
      ORDER BY entity_type, eid, server_seq DESC
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
