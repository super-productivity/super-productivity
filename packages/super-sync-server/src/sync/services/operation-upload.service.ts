import { Prisma } from '@prisma/client';
import { Logger } from '../../logger';
import {
  CLIENT_ID_REGEX,
  computeOpStorageBytes,
  MAX_CLIENT_ID_LENGTH,
} from '../sync.const';
import {
  DEFAULT_SYNC_CONFIG,
  DUPLICATE_OP_SELECT,
  isCausalFullStateOperation,
  LatestCausalFullStateRow,
  latestCausalFullStateSql,
  limitVectorClockSize,
  MAX_VECTOR_CLOCK_SIZE,
  Operation,
  OP_TYPES,
  ProcessOperationResult,
  SyncConfig,
  SYNC_ERROR_CODES,
  UploadResult,
  VectorClock,
} from '../sync.types';
import {
  detectConflict,
  getStoredEntityIds,
  isSameDuplicateOperation,
  isSameIncomingOperation,
} from '../conflict';
import {
  ALLOWED_ENTITY_TYPES,
  ValidationService,
  type ValidationResult,
} from './validation.service';

// Observability threshold: log a warning when the full-state op aggregate scan
// exceeds this duration. Mirrors the threshold used by the legacy snapshot
// vector-clock aggregate in OperationDownloadService so production logs use a
// consistent slow-aggregate signal.
const SLOW_FULL_STATE_AGGREGATE_MS = 5_000;
const INVALID_AUDIT_FIELD = '[invalid]';
const SAFE_AUDIT_ID_REGEX = /^[A-Za-z0-9_-]+$/;
// TIME_TRACKING addresses its ops by a composite `CONTEXT_TYPE:contextId:date` key, so
// under the plain charset every time-tracking rejection audited as '[invalid]' and the
// OP_REJECTED logs could not name the entity. The colon stays scoped to that one entity
// type: PLUGIN_USER_DATA ids are `pluginId:key`, and `key` is plugin-authored text that
// `assertPluginPersistenceKey` checks for type and length only -- never a charset. Those
// must keep redacting.
const SAFE_AUDIT_COMPOSITE_ID_REGEX = /^[A-Za-z0-9_-]+(?::[A-Za-z0-9_-]+){1,2}$/;

const isSafeAuditIdentifier = (
  value: unknown,
  maxLength: number,
  pattern: RegExp = SAFE_AUDIT_ID_REGEX,
): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= maxLength &&
  pattern.test(value);

const getSafeAuditOperationMetadata = (
  op: Operation,
): { opId: string; entityType: string; entityId?: string; opType: string } => {
  const rawOp = op as unknown as Record<string, unknown>;
  const rawOpId = rawOp['id'];
  const rawEntityType = rawOp['entityType'];
  const rawEntityId = rawOp['entityId'];
  const rawOpType = rawOp['opType'];

  return {
    opId: isSafeAuditIdentifier(rawOpId, 255) ? rawOpId : INVALID_AUDIT_FIELD,
    entityType:
      typeof rawEntityType === 'string' && ALLOWED_ENTITY_TYPES.has(rawEntityType)
        ? rawEntityType
        : INVALID_AUDIT_FIELD,
    entityId:
      rawEntityId === undefined || rawEntityId === null
        ? undefined
        : isSafeAuditIdentifier(
              rawEntityId,
              255,
              rawEntityType === 'TIME_TRACKING'
                ? SAFE_AUDIT_COMPOSITE_ID_REGEX
                : SAFE_AUDIT_ID_REGEX,
            )
          ? rawEntityId
          : INVALID_AUDIT_FIELD,
    opType:
      typeof rawOpType === 'string' && OP_TYPES.includes(rawOpType as Operation['opType'])
        ? rawOpType
        : INVALID_AUDIT_FIELD,
  };
};

const getSafeAuditClientId = (clientId: string): string =>
  clientId.length <= MAX_CLIENT_ID_LENGTH && CLIENT_ID_REGEX.test(clientId)
    ? clientId
    : INVALID_AUDIT_FIELD;

export class OperationUploadService {
  constructor(
    private readonly validationService: ValidationService,
    private readonly config: SyncConfig = DEFAULT_SYNC_CONFIG,
  ) {}

  private clampFutureTimestamp(
    userId: number,
    clientId: string,
    op: Operation,
    now: number,
  ): number {
    const originalTimestamp = op.timestamp;
    const maxAllowedTimestamp = now + this.config.maxClockDriftMs;
    if (op.timestamp > maxAllowedTimestamp) {
      op.timestamp = maxAllowedTimestamp;
      Logger.audit({
        event: 'TIMESTAMP_CLAMPED',
        userId,
        clientId: getSafeAuditClientId(clientId),
        ...getSafeAuditOperationMetadata(op),
        originalTimestamp,
        clampedTo: maxAllowedTimestamp,
        driftMs: originalTimestamp - now,
      });
    }
    return originalTimestamp;
  }

  private rejectedUploadResult(
    userId: number,
    clientId: string,
    op: Operation,
    error: string | undefined,
    errorCode: UploadResult['errorCode'],
    existingClock?: VectorClock,
  ): UploadResult {
    Logger.audit({
      event: 'OP_REJECTED',
      userId,
      clientId: getSafeAuditClientId(clientId),
      ...getSafeAuditOperationMetadata(op),
      errorCode,
      reason: errorCode ?? 'OP_REJECTED',
    });

    return {
      opId: op.id,
      accepted: false,
      error,
      errorCode,
      existingClock,
    };
  }

  /**
   * Aggregate the per-client max vector_clock counter over all operations for
   * `userId` with `server_seq < beforeServerSeq`. Used at full-state op upload
   * time so the persisted `latest_full_state_vector_clock` reflects every
   * client whose ops may still live in conflict detection — not just the
   * clients named on the snapshot op itself.
   *
   * Logs a warning when the scan exceeds `SLOW_FULL_STATE_AGGREGATE_MS` so
   * pathological histories (millions of ops, cleanup retention too long) are
   * observable in production before they approach the 60s upload-tx timeout.
   */
  private async _aggregatePriorVectorClock(
    tx: Prisma.TransactionClient,
    userId: number,
    beforeServerSeq: number,
  ): Promise<VectorClock> {
    const startedAt = Date.now();
    const rows = await tx.$queryRaw<Array<{ client_id: string; max_counter: bigint }>>`
      SELECT kv.key AS client_id, MAX(kv.value::bigint) AS max_counter
      FROM operations, LATERAL jsonb_each_text(vector_clock) AS kv(key, value)
      WHERE user_id = ${userId}
        AND server_seq < ${beforeServerSeq}
        AND jsonb_typeof(vector_clock) = 'object'
        AND kv.value ~ '^[0-9]+$'
      GROUP BY kv.key
    `;
    const out: VectorClock = {};
    for (const row of rows) {
      out[row.client_id] = Number(row.max_counter);
    }
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > SLOW_FULL_STATE_AGGREGATE_MS) {
      Logger.warn(
        `[user:${userId}] Full-state op aggregate scan took ${elapsedMs}ms ` +
          `(${rows.length} clients, beforeSeq=${beforeServerSeq}); approaching ` +
          `upload-tx timeout. Investigate history size and cleanup retention.`,
      );
    }
    return out;
  }

  /**
   * Aggregate the prior vector clock, merge the full-state op's clock into it
   * (max per client) and persist it as the user's latest-full-state marker.
   * Costs 2 DB round trips (the aggregate scan + the userSyncState update).
   */
  private async persistMergedFullStateClock(
    tx: Prisma.TransactionClient,
    userId: number,
    serverSeq: number,
    opClock: VectorClock,
  ): Promise<void> {
    const priorAggregate = await this._aggregatePriorVectorClock(tx, userId, serverSeq);
    const mergedClock: VectorClock = { ...priorAggregate };
    for (const [clientId, counter] of Object.entries(opClock)) {
      mergedClock[clientId] = Math.max(mergedClock[clientId] ?? 0, counter);
    }
    await tx.userSyncState.update({
      where: { userId },
      data: {
        latestFullStateSeq: serverSeq,
        latestFullStateVectorClock: mergedClock as Prisma.InputJsonValue,
      },
    });
  }

  /**
   * Memoizes the causal full-state author per upload transaction. The answer can
   * only change when THIS transaction accepts a causal full-state op, which
   * {@link noteFullStateAuthor} folds back in — so one query per transaction is
   * enough. Keyed by the `tx` client (a fresh short-lived object per
   * `$transaction`), so entries cannot outlive the request that created them.
   */
  private readonly fullStateAuthorByTx = new WeakMap<
    Prisma.TransactionClient,
    { author: string | undefined }
  >();

  /**
   * The latest causal full-state author remains a required clock edge for
   * post-import operations. If pruning drops that low-counter entry, clients
   * at the boundary classify the operation as concurrent and filter it out.
   *
   * Resolved lazily: only an op whose clock actually overflows pays for it.
   */
  private async resolveFullStateAuthor(
    tx: Prisma.TransactionClient,
    userId: number,
  ): Promise<string | undefined> {
    const memoized = this.fullStateAuthorByTx.get(tx);
    if (memoized) {
      return memoized.author;
    }
    // Raw SQL for the same reason as the download path's probe: parameterized, the
    // op_type values are Params, `operator_predicate_proof` cannot prove the partial
    // index's predicate, and this statement flips to a generic plan at execution 6 on
    // every pooled connection. With no seq bound at all it then walks the user's ENTIRE
    // history backwards — inside a write transaction — for any user with no causal
    // full-state op. Rare (only clocks over MAX_VECTOR_CLOCK_SIZE reach here) but
    // unbounded. See latestCausalFullStateSql; do not turn the literals back into params.
    const latestFullStateRows = await tx.$queryRaw<LatestCausalFullStateRow[]>(
      latestCausalFullStateSql(userId),
    );
    const author = latestFullStateRows[0]?.client_id;
    this.fullStateAuthorByTx.set(tx, { author });
    return author;
  }

  /**
   * Records a causal full-state op accepted earlier in this same transaction, so
   * later ops protect the new author without re-reading (and without depending on
   * read-your-writes visibility).
   */
  private noteFullStateAuthor(tx: Prisma.TransactionClient, clientId: string): void {
    this.fullStateAuthorByTx.set(tx, { author: clientId });
  }

  /**
   * Protected clock IDs for storage: the uploader, plus the active causal
   * full-state author when the clock is actually oversized. Under-limit clocks are
   * never pruned, so they need no lookup at all.
   */
  private async getPruneProtectedIds(
    tx: Prisma.TransactionClient,
    userId: number,
    op: Operation,
  ): Promise<string[]> {
    if (Object.keys(op.vectorClock).length <= MAX_VECTOR_CLOCK_SIZE) {
      return [];
    }
    const author = await this.resolveFullStateAuthor(tx, userId);
    return author ? [author] : [];
  }

  /**
   * Process a single operation within a transaction.
   * Handles validation, conflict detection, and persistence.
   */
  async processOperation(
    userId: number,
    clientId: string,
    op: Operation,
    now: number,
    tx: Prisma.TransactionClient,
    prevalidatedResult?: ValidationResult,
    wasOccupiedAtRequestStart?: boolean,
    firstRequestOperation?: { op: Operation; originalTimestamp: number },
  ): Promise<ProcessOperationResult> {
    // Rejected ops have no storage cost; the caller only reads storageBytes when
    // result.accepted is true.
    const reject = (result: UploadResult): ProcessOperationResult => ({
      result,
      storageBytes: 0,
      fallback: false,
    });

    // Clamp future timestamps instead of rejecting them (prevents silent data
    // loss).
    const originalTimestamp = this.clampFutureTimestamp(userId, clientId, op, now);

    // Validate operation (including clientId match)
    const validation =
      prevalidatedResult ?? this.validationService.validateOp(op, clientId);
    if (firstRequestOperation) {
      const isExactRetry = isSameIncomingOperation(
        firstRequestOperation.op,
        op,
        firstRequestOperation.originalTimestamp,
        originalTimestamp,
      );
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          isExactRetry
            ? 'Duplicate operation ID'
            : 'Operation ID already belongs to a different operation',
          isExactRetry
            ? SYNC_ERROR_CODES.DUPLICATE_OPERATION
            : SYNC_ERROR_CODES.INVALID_OP_ID,
        ),
      );
    }

    if (!validation.valid) {
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          validation.error,
          validation.errorCode,
        ),
      );
    }

    // Capture the *unpruned* vector clock for full-state ops. The op row stores
    // the pruned clock (see `limitVectorClockSize` call below); persisting the
    // unpruned copy on `user_sync_state` lets the download path re-prune at
    // read time with knowledge of `preserveClientIds` (excludeClient, snapshot
    // author), keeping more relevant entries than a pre-pruned snapshot would.
    const fullStateVectorClock = isCausalFullStateOperation(op)
      ? { ...op.vectorClock }
      : undefined;

    // Check for duplicate operation before conflict checks and sequence allocation.
    // This avoids expensive conflict work on retries and prevents rejected duplicates
    // from advancing lastSeq.
    const existingOp = await tx.operation.findUnique({
      where: { id: op.id },
      select: DUPLICATE_OP_SELECT,
    });

    if (existingOp) {
      if (
        !isSameDuplicateOperation(
          existingOp,
          userId,
          op,
          this.config.maxClockDriftMs,
          originalTimestamp,
        )
      ) {
        return reject(
          this.rejectedUploadResult(
            userId,
            clientId,
            op,
            'Operation ID already belongs to a different operation',
            SYNC_ERROR_CODES.INVALID_OP_ID,
          ),
        );
      }

      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          'Duplicate operation ID',
          SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        ),
      );
    }

    if (wasOccupiedAtRequestStart) {
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          'Operation ID was already occupied before quota enforcement',
          SYNC_ERROR_CODES.INVALID_OP_ID,
        ),
      );
    }

    // Check for conflicts with existing operations
    const conflict = await detectConflict(userId, op, tx);
    if (conflict.hasConflict) {
      const errorCode =
        conflict.conflictType === 'concurrent' ||
        conflict.conflictType === 'equal_different_client'
          ? SYNC_ERROR_CODES.CONFLICT_CONCURRENT
          : SYNC_ERROR_CODES.CONFLICT_SUPERSEDED;
      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          conflict.reason,
          errorCode,
          conflict.existingClock,
        ),
      );
    }

    // Get next sequence number
    const updatedState = await tx.userSyncState.update({
      where: { userId },
      data: { lastSeq: { increment: 1 } },
    });
    const serverSeq = updatedState.lastSeq;

    // No post-allocation conflict re-check is needed here. Under RepeatableRead
    // every statement in this transaction reads one snapshot fixed at its first
    // statement, and nothing between the conflict check above and this point
    // writes to `operations`, so a second detectConflict would read the identical
    // row set. Concurrent uploads are excluded by the lastSeq increment above:
    // any committed concurrent upload for the same user wrote the same
    // user_sync_state row, so the increment raises a serialization failure
    // (40001) before this point is reached. See ARCHITECTURE-DECISIONS.md #4 —
    // lowering the isolation level below REPEATABLE READ would require
    // reinstating a post-allocation re-check.

    // Prune vector clock AFTER conflict detection but BEFORE storage.
    // Moved from ValidationService to here so that the full (unpruned) clock is used
    // for conflict comparison. This prevents false CONCURRENT results when the client
    // builds a merged clock with MAX+1 entries during conflict resolution (all entity
    // clock IDs + its own client ID). Pruning before comparison would drop an entity
    // clock ID, causing the comparison to return CONCURRENT instead of GREATER_THAN,
    // leading to an infinite rejection loop.
    const beforeSize = Object.keys(op.vectorClock).length;
    // Note this op's own authorship first: a causal full-state op is its own
    // active author, so the memo answers without a query (and later ops in the
    // same transaction see it).
    if (isCausalFullStateOperation(op)) {
      this.noteFullStateAuthor(tx, op.clientId);
    }
    const protectedIds = await this.getPruneProtectedIds(tx, userId, op);
    op.vectorClock = limitVectorClockSize(op.vectorClock, [op.clientId, ...protectedIds]);
    const afterSize = Object.keys(op.vectorClock).length;
    if (afterSize < beforeSize) {
      Logger.debug(
        `[client:${op.clientId}] Vector clock pruned from ${beforeSize} to ${afterSize} before storage`,
      );
    }

    // Size the op once, here, after the clock prune above (so the stored clock is
    // measured) and reusing the payload byte size from validation (so the
    // payload isn't re-stringified). Reused for the payloadBytes column and the
    // caller's acceptedDeltaBytes accumulation.
    const sized = computeOpStorageBytes(op, validation.payloadBytes);

    const createResult = await tx.operation.createMany({
      data: [
        {
          id: op.id,
          userId,
          clientId,
          serverSeq,
          actionType: op.actionType,
          opType: op.opType,
          entityType: op.entityType,
          entityId: op.entityId ?? null,
          // Persist the full entity set for multi-entity ops so conflict detection
          // can match a write to any touched entity across uploads, not just
          // entityIds[0]; single-entity ops store [] and use the scalar (#8334).
          entityIds: getStoredEntityIds(op),
          payload: op.payload as Prisma.InputJsonValue,
          payloadBytes: BigInt(sized.bytes),
          vectorClock: op.vectorClock as Prisma.InputJsonValue,
          schemaVersion: op.schemaVersion,
          clientTimestamp: BigInt(op.timestamp),
          receivedAt: BigInt(now),
          isPayloadEncrypted: op.isPayloadEncrypted ?? false,
          syncImportReason: op.syncImportReason ?? null,
          repairBaseServerSeq: op.repairBaseServerSeq ?? null,
        },
      ],
      skipDuplicates: true,
    });

    // A concurrent retry can pass the duplicate pre-check and then lose the
    // insert race. `createMany(..., skipDuplicates)` maps that to count=0
    // instead of aborting the PostgreSQL transaction with P2002/25P02.
    if (createResult.count === 0) {
      const duplicateOp = await tx.operation.findUnique({
        where: { id: op.id },
        select: DUPLICATE_OP_SELECT,
      });

      if (!duplicateOp) {
        throw new Error(
          `Operation insert skipped by non-id unique constraint (userId=${userId}, opId=${op.id}, serverSeq=${serverSeq})`,
        );
      }

      await tx.userSyncState.update({
        where: { userId },
        data: { lastSeq: { decrement: 1 } },
      });

      if (
        !isSameDuplicateOperation(
          duplicateOp,
          userId,
          op,
          this.config.maxClockDriftMs,
          originalTimestamp,
        )
      ) {
        return reject(
          this.rejectedUploadResult(
            userId,
            clientId,
            op,
            'Operation ID already belongs to a different operation',
            SYNC_ERROR_CODES.INVALID_OP_ID,
          ),
        );
      }

      return reject(
        this.rejectedUploadResult(
          userId,
          clientId,
          op,
          'Duplicate operation ID',
          SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        ),
      );
    }

    if (fullStateVectorClock) {
      // Persist the aggregate of (prior history ∪ this op's clock), not just the
      // op's own clock. BACKUP_IMPORT uses a fresh `{ clientId: 1 }` by design
      // (backup.service.ts) and a compaction-built SYNC_IMPORT clock can be
      // pruned. Either case leaves out client_ids that still have pre-snapshot
      // ops alive in the conflict-detection set, so a downloader that reset to
      // the bare op clock would have its first edit go CONCURRENT against those
      // surviving rows. Doing the aggregate here moves the cost from per-download
      // to per-snapshot — full-state ops are rare so the upload-time scan is
      // strictly cheaper overall. Stored unpruned; the download path applies
      // `limitVectorClockSize` with `preserveClientIds` known to that read.
      await this.persistMergedFullStateClock(tx, userId, serverSeq, fullStateVectorClock);
    }

    return {
      result: { opId: op.id, accepted: true, serverSeq },
      storageBytes: sized.bytes,
      fallback: sized.fallback,
    };
  }
}
