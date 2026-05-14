import { prisma } from '../db';
import {
  Operation,
  ServerOperation,
  UploadResult,
  SyncConfig,
  DEFAULT_SYNC_CONFIG,
  compareVectorClocks,
  limitVectorClockSize,
  VectorClock,
  SYNC_ERROR_CODES,
  ConflictResult,
  isFullStateOpType,
} from './sync.types';
import { APPROX_BYTES_PER_OP, computeOpStorageBytes } from './sync.const';
import { Logger } from '../logger';
import { parsePositiveIntegerEnv } from '../util/env';
import { Prisma } from '@prisma/client';
import {
  ValidationService,
  RateLimitService,
  RequestDeduplicationService,
  DeviceService,
  OperationDownloadService,
  StorageQuotaService,
  SnapshotService,
  type PreparedSnapshotCache,
  type CacheSnapshotResult,
  type SnapshotDedupResponse,
} from './services';

interface DuplicateOperationCandidate {
  id: string;
  userId: number;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  vectorClock: unknown;
  schemaVersion: number;
  clientTimestamp: bigint | number | string;
  receivedAt: bigint | number | string;
  isPayloadEncrypted: boolean;
  syncImportReason: string | null;
}

interface LatestEntityOperationRow {
  entityId: string;
  clientId: string;
  vectorClock: unknown;
}

interface LatestBatchEntityOperationRow extends LatestEntityOperationRow {
  entityType: string;
}

interface BatchUploadCandidate {
  op: Operation;
  resultIndex: number;
  originalTimestamp: number;
  fullStateVectorClock?: VectorClock;
}

interface AcceptedBatchOperation extends BatchUploadCandidate {
  serverSeq: number;
  storageBytes: number;
}

// Conservative enough to avoid planner-heavy BitmapOr + Sort plans on large
// histories while still replacing up to 100 per-entity round trips with one query.
const CONFLICT_DETECTION_ENTITY_BATCH_SIZE = 100;
// Observability threshold: log a warning when the full-state op aggregate scan
// exceeds this duration. Mirrors the threshold used by the legacy snapshot
// vector-clock aggregate in OperationDownloadService so production logs use a
// consistent slow-aggregate signal.
const SLOW_FULL_STATE_AGGREGATE_MS = 5_000;
const OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = 5_000;
const OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = 25_000;
// Operator-DoS guardrail: a 1M `take:` materializes 1M ids in Node memory and
// then sends a 1M-element array param to Postgres — exactly the pressure the
// throttle is meant to avoid. Cap so misconfiguration can't unwind the bound.
const OLD_OPS_CLEANUP_DELETE_BATCH_SIZE_MAX = 50_000;
const OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN_MAX = 1_000_000;

const toSafeServerSeq = (value: number | bigint | undefined, userId: number): number => {
  if (typeof value === 'bigint') {
    if (value < BigInt(0) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`Unsafe last_seq value returned for user ${userId}`);
    }
    const asNumber = Number(value);
    if (BigInt(asNumber) !== value) {
      throw new Error(`Precision-losing last_seq value returned for user ${userId}`);
    }
    return asNumber;
  }

  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }

  throw new Error(`Invalid last_seq value returned for user ${userId}`);
};

const getPrismaP2002TargetTokens = (
  err: Prisma.PrismaClientKnownRequestError,
): string[] => {
  const target = err.meta?.target;
  if (Array.isArray(target)) return target.map(String);
  if (typeof target === 'string') return [target];
  return [];
};

const isRetryableOperationUniqueViolation = (err: unknown): boolean => {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
    return false;
  }

  const targetTokens = getPrismaP2002TargetTokens(err);
  if (targetTokens.length === 0) return true;

  const normalizedTargets = targetTokens.map((target) =>
    target.toLowerCase().replace(/"/g, ''),
  );
  const targetSet = new Set(normalizedTargets);

  return (
    normalizedTargets.some(
      (target) =>
        target.includes('operations_pkey') ||
        target.includes('operation_pkey') ||
        target.includes('operations_id') ||
        target.includes('operation_id'),
    ) ||
    targetSet.has('id') ||
    (targetSet.has('user_id') && targetSet.has('server_seq')) ||
    (targetSet.has('userid') && targetSet.has('serverseq'))
  );
};

const getOldOpsCleanupDeleteBatchSize = (): number =>
  parsePositiveIntegerEnv(
    'OLD_OPS_CLEANUP_DELETE_BATCH_SIZE',
    OLD_OPS_CLEANUP_DELETE_BATCH_SIZE,
    OLD_OPS_CLEANUP_DELETE_BATCH_SIZE_MAX,
  );

const getOldOpsCleanupMaxDeletedPerRun = (): number =>
  parsePositiveIntegerEnv(
    'OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN',
    OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN,
    OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN_MAX,
  );

/**
 * Main sync orchestration service.
 *
 * IMPORTANT: Single-instance deployment assumption
 * This service uses process-local in-memory caches for:
 * - Rate limiting (RateLimitService)
 * - Request deduplication (RequestDeduplicationService)
 * - Snapshot caching (SnapshotService)
 *
 * For multi-instance deployment behind a load balancer, these caches
 * would need to be moved to a shared store (e.g., Redis) to ensure
 * consistent behavior across instances.
 */
export class SyncService {
  private config: SyncConfig;
  private validationService: ValidationService;
  private rateLimitService: RateLimitService;
  private requestDeduplicationService: RequestDeduplicationService;
  private deviceService: DeviceService;
  private operationDownloadService: OperationDownloadService;
  private storageQuotaService: StorageQuotaService;
  private snapshotService: SnapshotService;

  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.validationService = new ValidationService(this.config);
    this.rateLimitService = new RateLimitService(this.config);
    this.requestDeduplicationService = new RequestDeduplicationService();
    this.deviceService = new DeviceService();
    this.operationDownloadService = new OperationDownloadService();
    this.storageQuotaService = new StorageQuotaService();
    this.snapshotService = new SnapshotService();
  }

  // === Conflict Detection ===

  /**
   * Check if an incoming operation conflicts with existing operations.
   * Returns conflict info if a concurrent modification is detected.
   */
  private async detectConflict(
    userId: number,
    op: Operation,
    tx: Prisma.TransactionClient,
  ): Promise<ConflictResult> {
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
    const rawEntityIdsToCheck = op.entityIds?.length
      ? op.entityIds
      : op.entityId
        ? [op.entityId]
        : [];

    // Skip if no entity IDs (can't have entity-level conflicts)
    if (rawEntityIdsToCheck.length === 0) {
      return { hasConflict: false };
    }

    if (rawEntityIdsToCheck.length === 1) {
      return this.detectConflictForEntity(userId, op, rawEntityIdsToCheck[0], tx);
    }

    const entityIdsToCheck = Array.from(new Set(rawEntityIdsToCheck));
    return this.detectConflictForEntities(userId, op, entityIdsToCheck, tx);
  }

  private async detectConflictForEntities(
    userId: number,
    op: Operation,
    entityIdsToCheck: string[],
    tx: Prisma.TransactionClient,
  ): Promise<ConflictResult> {
    for (
      let start = 0;
      start < entityIdsToCheck.length;
      start += CONFLICT_DETECTION_ENTITY_BATCH_SIZE
    ) {
      const batchEntityIds = entityIdsToCheck.slice(
        start,
        start + CONFLICT_DETECTION_ENTITY_BATCH_SIZE,
      );
      const latestOps = await tx.$queryRaw<LatestEntityOperationRow[]>`
        SELECT DISTINCT ON (entity_id)
          entity_id AS "entityId",
          client_id AS "clientId",
          vector_clock AS "vectorClock"
        FROM operations
        WHERE user_id = ${userId}
          AND entity_type = ${op.entityType}
          AND entity_id IN (${Prisma.join(batchEntityIds)})
        ORDER BY entity_id, server_seq DESC
      `;

      const latestOpByEntityId = new Map<string, LatestEntityOperationRow>();
      for (const latestOp of latestOps) {
        latestOpByEntityId.set(latestOp.entityId, latestOp);
      }

      for (const entityId of batchEntityIds) {
        const existingOp = latestOpByEntityId.get(entityId);
        if (!existingOp) continue;

        const conflictResult = this.resolveConflictForExistingOp(
          op,
          entityId,
          existingOp,
        );
        if (conflictResult.hasConflict) {
          return conflictResult;
        }
      }
    }

    return { hasConflict: false };
  }

  private resolveConflictForExistingOp(
    op: Operation,
    entityId: string,
    existingOp: { clientId: string; vectorClock: unknown },
  ): ConflictResult {
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
  }

  /**
   * Checks conflicts for the common single-entity upload path using Prisma's
   * typed model API. Multi-entity operations use the batched raw-SQL path above
   * to avoid one round trip per entity.
   */
  private async detectConflictForEntity(
    userId: number,
    op: Operation,
    entityId: string,
    tx: Prisma.TransactionClient,
  ): Promise<ConflictResult> {
    // Get the latest operation for this entity
    const existingOp = await tx.operation.findFirst({
      where: {
        userId,
        entityType: op.entityType,
        entityId,
      },
      select: {
        clientId: true,
        vectorClock: true,
      },
      orderBy: {
        serverSeq: 'desc',
      },
    });

    // No existing operation = no conflict
    if (!existingOp) {
      return { hasConflict: false };
    }

    return this.resolveConflictForExistingOp(op, entityId, existingOp);
  }

  private isSameDuplicateOperation(
    existingOp: DuplicateOperationCandidate,
    userId: number,
    op: Operation,
    originalTimestamp: number = op.timestamp,
  ): boolean {
    const storedVectorClock = limitVectorClockSize(op.vectorClock, [op.clientId]);

    return (
      existingOp.userId === userId &&
      existingOp.clientId === op.clientId &&
      existingOp.actionType === op.actionType &&
      existingOp.opType === op.opType &&
      existingOp.entityType === op.entityType &&
      existingOp.entityId === (op.entityId ?? null) &&
      this.areJsonValuesEqual(existingOp.payload, op.payload) &&
      this.areJsonValuesEqual(existingOp.vectorClock, storedVectorClock) &&
      existingOp.schemaVersion === op.schemaVersion &&
      this.isSameDuplicateTimestamp(
        existingOp.clientTimestamp,
        existingOp.receivedAt,
        op.timestamp,
        originalTimestamp,
      ) &&
      existingOp.isPayloadEncrypted === (op.isPayloadEncrypted ?? false) &&
      existingOp.syncImportReason === (op.syncImportReason ?? null)
    );
  }

  private isSameDuplicateTimestamp(
    existingTimestamp: bigint | number | string,
    existingReceivedAt: bigint | number | string,
    incomingStoredTimestamp: number,
    incomingOriginalTimestamp: number,
  ): boolean {
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
      existingTimestampValue ===
        existingReceivedAtValue + BigInt(this.config.maxClockDriftMs) &&
      existingTimestampValue <= BigInt(incomingOriginalTimestamp)
    );
  }

  private areJsonValuesEqual(a: unknown, b: unknown): boolean {
    return this.stableJsonStringify(a) === this.stableJsonStringify(b);
  }

  private stableJsonStringify(value: unknown): string {
    return JSON.stringify(this.toStableJsonValue(value)) ?? 'undefined';
  }

  private toStableJsonValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.toStableJsonValue(item));
    }

    if (value !== null && typeof value === 'object') {
      return Object.fromEntries(
        Object.keys(value as Record<string, unknown>)
          .sort()
          .map((key) => [
            key,
            this.toStableJsonValue((value as Record<string, unknown>)[key]),
          ]),
      );
    }

    return value;
  }

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
        clientId,
        opId: op.id,
        entityType: op.entityType,
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
      clientId,
      opId: op.id,
      entityType: op.entityType,
      entityId: op.entityId,
      errorCode,
      reason: error,
      opType: op.opType,
    });

    return {
      opId: op.id,
      accepted: false,
      error,
      errorCode,
      existingClock,
    };
  }

  private getConflictEntityIds(op: Operation): string[] {
    const rawEntityIds = op.entityIds?.length
      ? op.entityIds
      : op.entityId
        ? [op.entityId]
        : [];
    return Array.from(new Set(rawEntityIds));
  }

  private getEntityConflictKey(entityType: string, entityId: string): string {
    return `${entityType}\u0000${entityId}`;
  }

  private getBatchConflictEntityPairs(
    candidates: BatchUploadCandidate[],
  ): { entityType: string; entityId: string }[] {
    const entityPairs = new Map<string, { entityType: string; entityId: string }>();

    for (const candidate of candidates) {
      if (isFullStateOpType(candidate.op.opType)) continue;

      for (const entityId of this.getConflictEntityIds(candidate.op)) {
        entityPairs.set(this.getEntityConflictKey(candidate.op.entityType, entityId), {
          entityType: candidate.op.entityType,
          entityId,
        });
      }
    }

    return Array.from(entityPairs.values());
  }

  private async prefetchLatestEntityOpsForBatch(
    userId: number,
    entityPairs: { entityType: string; entityId: string }[],
    tx: Prisma.TransactionClient,
  ): Promise<Map<string, LatestBatchEntityOperationRow>> {
    const latestByEntity = new Map<string, LatestBatchEntityOperationRow>();
    if (entityPairs.length === 0) return latestByEntity;

    for (
      let start = 0;
      start < entityPairs.length;
      start += CONFLICT_DETECTION_ENTITY_BATCH_SIZE
    ) {
      const touchedRows = entityPairs
        .slice(start, start + CONFLICT_DETECTION_ENTITY_BATCH_SIZE)
        .map(({ entityType, entityId }) => Prisma.sql`(${entityType}, ${entityId})`);

      const latestOps = await tx.$queryRaw<LatestBatchEntityOperationRow[]>`
        SELECT DISTINCT ON (o.entity_type, o.entity_id)
          o.entity_type AS "entityType",
          o.entity_id AS "entityId",
          o.client_id AS "clientId",
          o.vector_clock AS "vectorClock"
        FROM operations o
        JOIN (VALUES ${Prisma.join(touchedRows)}) AS touched(entity_type, entity_id)
          ON touched.entity_type = o.entity_type
         AND touched.entity_id = o.entity_id
        WHERE o.user_id = ${userId}
        ORDER BY o.entity_type, o.entity_id, o.server_seq DESC
      `;

      for (const latestOp of latestOps) {
        latestByEntity.set(
          this.getEntityConflictKey(latestOp.entityType, latestOp.entityId),
          latestOp,
        );
      }
    }

    return latestByEntity;
  }

  private pruneVectorClockForStorage(op: Operation): void {
    const beforeSize = Object.keys(op.vectorClock).length;
    op.vectorClock = limitVectorClockSize(op.vectorClock, [op.clientId]);
    const afterSize = Object.keys(op.vectorClock).length;
    if (afterSize < beforeSize) {
      Logger.debug(
        `[client:${op.clientId}] Vector clock pruned from ${beforeSize} to ${afterSize} before storage`,
      );
    }
  }

  // === Upload Operations ===

  async uploadOps(
    userId: number,
    clientId: string,
    ops: Operation[],
    isCleanSlate?: boolean,
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    const now = Date.now();
    const txStartedAt = Date.now();
    let uploadDbRoundtrips = 0;

    try {
      // Use transaction to acquire write lock and ensure atomicity
      await prisma.$transaction(
        async (tx) => {
          // If clean slate requested, delete all existing data first
          if (isCleanSlate) {
            Logger.info(
              `[user:${userId}] Clean slate requested - deleting all user data`,
            );

            // Delete all operations
            await tx.operation.deleteMany({ where: { userId } });

            // Delete all devices
            await tx.syncDevice.deleteMany({ where: { userId } });

            // Reset snapshot data but PRESERVE lastSeq so sequence numbers continue.
            // If we deleted the sync state row, lastSeq would reset to 0 and new ops
            // would reuse sequence numbers that other clients already saw — causing
            // those clients to miss the SYNC_IMPORT and any ops that land on reused seqs.
            await tx.userSyncState.updateMany({
              where: { userId },
              data: {
                lastSnapshotSeq: null,
                snapshotData: null,
                snapshotAt: null,
                latestFullStateSeq: null,
                latestFullStateVectorClock: Prisma.DbNull,
              },
            });

            // Reset storage usage
            await tx.user.update({
              where: { id: userId },
              data: { storageUsedBytes: BigInt(0) },
            });

            Logger.info(`[user:${userId}] Clean slate completed - all data deleted`);
          }

          // Track the delta-bytes for accepted ops so we can write
          // `users.storage_used_bytes` atomically in the same transaction as the
          // op inserts. Doing the counter write outside this transaction (as
          // the route layer used to) opens a window where the data commits but
          // the counter does not — if the process dies between, the in-memory
          // `markStorageNeedsReconcile` marker is lost too.
          let acceptedDeltaBytes = 0;
          let unserializableAccepted = 0;

          if (this.config.batchUpload) {
            const batchResult = await this.processOperationBatch(
              userId,
              clientId,
              ops,
              now,
              tx,
            );
            results.push(...batchResult.results);
            acceptedDeltaBytes = batchResult.acceptedDeltaBytes;
            unserializableAccepted = batchResult.unserializableAccepted;
            uploadDbRoundtrips += batchResult.dbRoundtrips;
          } else {
            // Ensure user has sync state row (init if needed)
            // We assume user exists in `users` table because of foreign key,
            // but if `uploadOps` is called, authentication should have verified user existence.
            // However, `user_sync_state` might not exist yet.
            await tx.userSyncState.upsert({
              where: { userId },
              create: { userId, lastSeq: 0 },
              update: {}, // No-op update to ensure it exists
            });
            uploadDbRoundtrips++;

            for (const op of ops) {
              const result = await this.processOperation(userId, clientId, op, now, tx);
              results.push(result);
              if (result.accepted) {
                const sized = computeOpStorageBytes(op);
                acceptedDeltaBytes += sized.bytes;
                if (sized.fallback) unserializableAccepted += 1;
              }
            }
          }
          if (unserializableAccepted > 0) {
            Logger.warn(
              `computeOpsStorageBytes: ${unserializableAccepted} unserializable op(s) ` +
                `charged at APPROX_BYTES_PER_OP for user=${userId} (uploadOps)`,
            );
          }

          // Update device last seen
          await tx.syncDevice.upsert({
            where: {
              // Prisma composite key naming uses underscores; allow it here
              // eslint-disable-next-line @typescript-eslint/naming-convention
              userId_clientId: {
                userId,
                clientId,
              },
            },
            create: {
              userId,
              clientId,
              lastSeenAt: BigInt(now),
              createdAt: BigInt(now),
              lastAckedSeq: 0,
            },
            update: {
              lastSeenAt: BigInt(now),
            },
          });
          uploadDbRoundtrips++;

          if (this.config.batchUpload && acceptedDeltaBytes === 0) return;

          // W1: write the storage counter as the LAST statement before COMMIT
          // so the row-level write lock on `users` is held for only the
          // commit round-trip, not for the entire 60s transaction window.
          // GREATEST(..., 0) guards against negative drift (the counter is
          // advisory; reconcile self-heals if it ever drifts). Clean slate
          // already reset the counter to zero above, so SET (rather than
          // increment) avoids double-counting anything left in the row.
          if (acceptedDeltaBytes > 0 && !isCleanSlate) {
            const delta = BigInt(Math.floor(acceptedDeltaBytes));
            await tx.$executeRaw`
              UPDATE users
              SET storage_used_bytes = GREATEST(storage_used_bytes + ${delta}::bigint, 0::bigint)
              WHERE id = ${userId}
            `;
            uploadDbRoundtrips++;
          } else if (acceptedDeltaBytes > 0 && isCleanSlate) {
            const delta = BigInt(Math.floor(acceptedDeltaBytes));
            await tx.$executeRaw`
              UPDATE users
              SET storage_used_bytes = ${delta}::bigint
              WHERE id = ${userId}
            `;
            uploadDbRoundtrips++;
          }
        },
        {
          // Large operations like SYNC_IMPORT/BACKUP_IMPORT can have payloads up to 20MB.
          // Default Prisma timeout (5s) is too short for these. Use 60s to match generateSnapshot.
          timeout: 60000,
          // FIX 1.6: Set explicit isolation level for strict consistency.
          // The serial path also performs the legacy post-sequence conflict re-check.
          // The batch path serializes accepted writers through the shared
          // user_sync_state.last_seq row update; see ARCHITECTURE-DECISIONS.md.
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        },
      );

      // Clear caches after clean slate transaction completes successfully.
      // Include request dedup so a retry from before the wipe cannot return
      // cached results that reference now-deleted state.
      if (isCleanSlate) {
        this.rateLimitService.clearForUser(userId);
        this.snapshotService.clearForUser(userId);
        this.storageQuotaService.clearForUser(userId);
        this.requestDeduplicationService.clearForUser(userId);
      }

      const accepted = results.filter((result) => result.accepted).length;
      Logger.info('UPLOAD_BATCH_SUMMARY', {
        userId,
        opsInBatch: ops.length,
        accepted,
        rejected: results.length - accepted,
        txDurationMs: Date.now() - txStartedAt,
        dbRoundtrips: uploadDbRoundtrips,
        batchUpload: this.config.batchUpload,
      });
    } catch (err) {
      // Transaction failed - all operations were rolled back
      const errorMessage = (err as Error).message || 'Unknown error';

      // Check if this is a serialization failure (concurrent transaction conflict)
      // Prisma uses P2034 for "Transaction failed due to a write conflict or a deadlock"
      // PostgreSQL uses 40001 (serialization_failure) and 40P01 (deadlock_detected)
      const isSerializationFailure =
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') ||
        (this.config.batchUpload && isRetryableOperationUniqueViolation(err)) ||
        errorMessage.includes('40001') ||
        errorMessage.includes('40P01') ||
        errorMessage.toLowerCase().includes('serialization') ||
        errorMessage.toLowerCase().includes('could not serialize') ||
        errorMessage.toLowerCase().includes('serialize access') ||
        errorMessage.toLowerCase().includes('deadlock');

      // Check if this is a timeout error (common for large payloads)
      const isTimeout =
        errorMessage.toLowerCase().includes('timeout') || errorMessage.includes('P2028');

      if (isSerializationFailure) {
        Logger.warn(
          `Transaction serialization failure for user ${userId} - client should retry: ${errorMessage}`,
        );
      } else {
        Logger.error(`Transaction failed for user ${userId}: ${errorMessage}`);
      }

      // Mark all "successful" results as failed due to transaction rollback.
      // Use INTERNAL_ERROR for all transient failures - client will retry.
      // The raw `errorMessage` is logged above but never returned to the client:
      // Prisma exceptions can include SQL fragments, column names, and FK names,
      // so the per-op error string is a generic, non-leaky message instead.
      return ops.map((op) => ({
        opId: op.id,
        accepted: false,
        error: isSerializationFailure
          ? 'Concurrent transaction conflict - please retry'
          : isTimeout
            ? 'Transaction timeout - server busy, please retry'
            : 'Transaction failed - please retry',
        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
      }));
    }

    return results;
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

  private async processOperationBatch(
    userId: number,
    clientId: string,
    ops: Operation[],
    now: number,
    tx: Prisma.TransactionClient,
  ): Promise<{
    results: UploadResult[];
    acceptedDeltaBytes: number;
    unserializableAccepted: number;
    dbRoundtrips: number;
  }> {
    const results = new Array<UploadResult>(ops.length);
    const validatedCandidates: BatchUploadCandidate[] = [];
    let dbRoundtrips = 0;

    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      const originalTimestamp = this.clampFutureTimestamp(userId, clientId, op, now);
      const validation = this.validationService.validateOp(op, clientId);

      if (!validation.valid) {
        results[i] = this.rejectedUploadResult(
          userId,
          clientId,
          op,
          validation.error,
          validation.errorCode,
        );
        continue;
      }

      validatedCandidates.push({
        op,
        resultIndex: i,
        originalTimestamp,
        fullStateVectorClock: isFullStateOpType(op.opType)
          ? { ...op.vectorClock }
          : undefined,
      });
    }

    const seenOpIds = new Set<string>();
    const uniqueCandidates: BatchUploadCandidate[] = [];
    for (const candidate of validatedCandidates) {
      if (seenOpIds.has(candidate.op.id)) {
        results[candidate.resultIndex] = this.rejectedUploadResult(
          userId,
          clientId,
          candidate.op,
          'Duplicate operation ID',
          SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        );
        continue;
      }
      seenOpIds.add(candidate.op.id);
      uniqueCandidates.push(candidate);
    }

    if (uniqueCandidates.length === 0) {
      return {
        results: results as UploadResult[],
        acceptedDeltaBytes: 0,
        unserializableAccepted: 0,
        dbRoundtrips,
      };
    }

    dbRoundtrips++;
    const existingOps = await tx.operation.findMany({
      where: { id: { in: uniqueCandidates.map((candidate) => candidate.op.id) } },
      select: {
        id: true,
        userId: true,
        clientId: true,
        actionType: true,
        opType: true,
        entityType: true,
        entityId: true,
        payload: true,
        vectorClock: true,
        schemaVersion: true,
        clientTimestamp: true,
        receivedAt: true,
        isPayloadEncrypted: true,
        syncImportReason: true,
      },
    });
    const existingOpById = new Map(
      existingOps.map((existingOp) => [existingOp.id, existingOp]),
    );

    const duplicateFreeCandidates: BatchUploadCandidate[] = [];
    for (const candidate of uniqueCandidates) {
      const existingOp = existingOpById.get(candidate.op.id);
      if (!existingOp) {
        duplicateFreeCandidates.push(candidate);
        continue;
      }

      if (
        !this.isSameDuplicateOperation(
          existingOp,
          userId,
          candidate.op,
          candidate.originalTimestamp,
        )
      ) {
        results[candidate.resultIndex] = this.rejectedUploadResult(
          userId,
          clientId,
          candidate.op,
          'Operation ID already belongs to a different operation',
          SYNC_ERROR_CODES.INVALID_OP_ID,
        );
        continue;
      }

      results[candidate.resultIndex] = this.rejectedUploadResult(
        userId,
        clientId,
        candidate.op,
        'Duplicate operation ID',
        SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      );
    }

    const entityPairs = this.getBatchConflictEntityPairs(duplicateFreeCandidates);
    dbRoundtrips += Math.ceil(entityPairs.length / CONFLICT_DETECTION_ENTITY_BATCH_SIZE);
    const latestOpByEntity = await this.prefetchLatestEntityOpsForBatch(
      userId,
      entityPairs,
      tx,
    );

    const accepted: AcceptedBatchOperation[] = [];
    let acceptedDeltaBytes = 0;
    let unserializableAccepted = 0;

    for (const candidate of duplicateFreeCandidates) {
      const { op } = candidate;
      if (!isFullStateOpType(op.opType)) {
        let conflict: ConflictResult | null = null;
        for (const entityId of this.getConflictEntityIds(op)) {
          const existingOp = latestOpByEntity.get(
            this.getEntityConflictKey(op.entityType, entityId),
          );
          if (!existingOp) continue;

          const conflictResult = this.resolveConflictForExistingOp(
            op,
            entityId,
            existingOp,
          );
          if (conflictResult.hasConflict) {
            conflict = conflictResult;
            break;
          }
        }

        if (conflict) {
          const errorCode =
            conflict.conflictType === 'concurrent' ||
            conflict.conflictType === 'equal_different_client'
              ? SYNC_ERROR_CODES.CONFLICT_CONCURRENT
              : SYNC_ERROR_CODES.CONFLICT_SUPERSEDED;
          results[candidate.resultIndex] = this.rejectedUploadResult(
            userId,
            clientId,
            op,
            conflict.reason,
            errorCode,
            conflict.existingClock,
          );
          continue;
        }
      }

      this.pruneVectorClockForStorage(op);
      const sized = computeOpStorageBytes(op);
      acceptedDeltaBytes += sized.bytes;
      if (sized.fallback) unserializableAccepted++;

      const acceptedOperation: AcceptedBatchOperation = {
        ...candidate,
        serverSeq: 0,
        storageBytes: sized.bytes,
      };
      accepted.push(acceptedOperation);

      if (!isFullStateOpType(op.opType)) {
        for (const entityId of this.getConflictEntityIds(op)) {
          latestOpByEntity.set(this.getEntityConflictKey(op.entityType, entityId), {
            entityType: op.entityType,
            entityId,
            clientId: op.clientId,
            vectorClock: op.vectorClock,
          });
        }
      }
    }

    if (accepted.length === 0) {
      return {
        results: results as UploadResult[],
        acceptedDeltaBytes: 0,
        unserializableAccepted: 0,
        dbRoundtrips,
      };
    }

    dbRoundtrips++;
    const syncStateRows = await tx.$queryRaw<Array<{ lastSeq: number | bigint }>>`
      INSERT INTO user_sync_state (user_id, last_seq)
      VALUES (${userId}, ${accepted.length})
      ON CONFLICT (user_id) DO UPDATE
        SET last_seq = user_sync_state.last_seq + EXCLUDED.last_seq
      RETURNING last_seq AS "lastSeq"
    `;
    const lastSeq = toSafeServerSeq(syncStateRows[0]?.lastSeq, userId);
    if (lastSeq < accepted.length) {
      throw new Error(`Failed to reserve server sequence range for user ${userId}`);
    }
    const firstSeq = lastSeq - accepted.length + 1;
    for (let i = 0; i < accepted.length; i++) {
      accepted[i].serverSeq = firstSeq + i;
    }

    dbRoundtrips++;
    await tx.operation.createMany({
      data: accepted.map((candidate) => ({
        id: candidate.op.id,
        userId,
        clientId,
        serverSeq: candidate.serverSeq,
        actionType: candidate.op.actionType,
        opType: candidate.op.opType,
        entityType: candidate.op.entityType,
        entityId: candidate.op.entityId ?? null,
        payload: candidate.op.payload as Prisma.InputJsonValue,
        payloadBytes: BigInt(candidate.storageBytes),
        vectorClock: candidate.op.vectorClock as Prisma.InputJsonValue,
        schemaVersion: candidate.op.schemaVersion,
        clientTimestamp: BigInt(candidate.op.timestamp),
        receivedAt: BigInt(now),
        isPayloadEncrypted: candidate.op.isPayloadEncrypted ?? false,
        syncImportReason: candidate.op.syncImportReason ?? null,
      })),
    });

    let lastFullStateOp: AcceptedBatchOperation | null = null;
    for (const acceptedOp of accepted) {
      if (acceptedOp.fullStateVectorClock) {
        lastFullStateOp = acceptedOp;
      }
    }

    if (lastFullStateOp?.fullStateVectorClock) {
      dbRoundtrips += 2;
      const priorAggregate = await this._aggregatePriorVectorClock(
        tx,
        userId,
        lastFullStateOp.serverSeq,
      );
      const mergedClock: VectorClock = { ...priorAggregate };
      for (const [fullStateClientId, counter] of Object.entries(
        lastFullStateOp.fullStateVectorClock,
      )) {
        mergedClock[fullStateClientId] = Math.max(
          mergedClock[fullStateClientId] ?? 0,
          counter,
        );
      }
      await tx.userSyncState.update({
        where: { userId },
        data: {
          latestFullStateSeq: lastFullStateOp.serverSeq,
          latestFullStateVectorClock: mergedClock as Prisma.InputJsonValue,
        },
      });
    }

    for (const acceptedOp of accepted) {
      results[acceptedOp.resultIndex] = {
        opId: acceptedOp.op.id,
        accepted: true,
        serverSeq: acceptedOp.serverSeq,
      };
    }

    return {
      results: results as UploadResult[],
      acceptedDeltaBytes,
      unserializableAccepted,
      dbRoundtrips,
    };
  }

  /**
   * Process a single operation within a transaction.
   * Handles validation, conflict detection, and persistence.
   */
  private async processOperation(
    userId: number,
    clientId: string,
    op: Operation,
    now: number,
    tx: Prisma.TransactionClient,
  ): Promise<UploadResult> {
    // Clamp future timestamps instead of rejecting them (prevents silent data loss)
    const originalTimestamp = op.timestamp;
    const maxAllowedTimestamp = now + this.config.maxClockDriftMs;
    if (op.timestamp > maxAllowedTimestamp) {
      op.timestamp = maxAllowedTimestamp;
      Logger.audit({
        event: 'TIMESTAMP_CLAMPED',
        userId,
        clientId,
        opId: op.id,
        entityType: op.entityType,
        originalTimestamp,
        clampedTo: maxAllowedTimestamp,
        driftMs: originalTimestamp - now,
      });
    }

    // Validate operation (including clientId match)
    const validation = this.validationService.validateOp(op, clientId);
    if (!validation.valid) {
      Logger.audit({
        event: 'OP_REJECTED',
        userId,
        clientId,
        opId: op.id,
        entityType: op.entityType,
        entityId: op.entityId,
        errorCode: validation.errorCode,
        reason: validation.error,
        opType: op.opType,
      });
      return {
        opId: op.id,
        accepted: false,
        error: validation.error,
        errorCode: validation.errorCode,
      };
    }
    // Capture the *unpruned* vector clock for full-state ops. The op row stores
    // the pruned clock (see `limitVectorClockSize` call below); persisting the
    // unpruned copy on `user_sync_state` lets the download path re-prune at
    // read time with knowledge of `preserveClientIds` (excludeClient, snapshot
    // author), keeping more relevant entries than a pre-pruned snapshot would.
    const fullStateVectorClock = isFullStateOpType(op.opType)
      ? { ...op.vectorClock }
      : undefined;

    // Check for duplicate operation before conflict checks and sequence allocation.
    // This avoids expensive conflict work on retries and prevents rejected duplicates
    // from advancing lastSeq.
    const existingOp = await tx.operation.findUnique({
      where: { id: op.id },
      select: {
        id: true,
        userId: true,
        clientId: true,
        actionType: true,
        opType: true,
        entityType: true,
        entityId: true,
        payload: true,
        vectorClock: true,
        schemaVersion: true,
        clientTimestamp: true,
        receivedAt: true,
        isPayloadEncrypted: true,
        syncImportReason: true,
      },
    });

    if (existingOp) {
      if (!this.isSameDuplicateOperation(existingOp, userId, op, originalTimestamp)) {
        Logger.audit({
          event: 'OP_REJECTED',
          userId,
          clientId,
          opId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
          reason: 'Operation ID already belongs to a different operation',
          opType: op.opType,
        });
        return {
          opId: op.id,
          accepted: false,
          error: 'Operation ID already belongs to a different operation',
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
        };
      }

      Logger.audit({
        event: 'OP_REJECTED',
        userId,
        clientId,
        opId: op.id,
        entityType: op.entityType,
        entityId: op.entityId,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        reason: 'Duplicate operation ID (pre-check)',
        opType: op.opType,
      });
      return {
        opId: op.id,
        accepted: false,
        error: 'Duplicate operation ID',
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      };
    }

    // Check for conflicts with existing operations
    const conflict = await this.detectConflict(userId, op, tx);
    if (conflict.hasConflict) {
      const errorCode =
        conflict.conflictType === 'concurrent' ||
        conflict.conflictType === 'equal_different_client'
          ? SYNC_ERROR_CODES.CONFLICT_CONCURRENT
          : SYNC_ERROR_CODES.CONFLICT_SUPERSEDED;
      Logger.audit({
        event: 'OP_REJECTED',
        userId,
        clientId,
        opId: op.id,
        entityType: op.entityType,
        entityId: op.entityId,
        errorCode,
        reason: conflict.reason,
        opType: op.opType,
      });
      return {
        opId: op.id,
        accepted: false,
        error: conflict.reason,
        errorCode,
        existingClock: conflict.existingClock,
      };
    }

    // Get next sequence number
    const updatedState = await tx.userSyncState.update({
      where: { userId },
      data: { lastSeq: { increment: 1 } },
    });
    const serverSeq = updatedState.lastSeq;

    // FIX 1.5: Re-check for conflicts after sequence allocation.
    // This catches races where another request inserted an operation for the same
    // entity between our initial conflict check and now. Combined with REPEATABLE_READ
    // isolation, this ensures no undetected concurrent modifications.
    const finalConflict = await this.detectConflict(userId, op, tx);
    if (finalConflict.hasConflict) {
      await tx.userSyncState.update({
        where: { userId },
        data: { lastSeq: { decrement: 1 } },
      });

      const errorCode =
        finalConflict.conflictType === 'concurrent' ||
        finalConflict.conflictType === 'equal_different_client'
          ? SYNC_ERROR_CODES.CONFLICT_CONCURRENT
          : SYNC_ERROR_CODES.CONFLICT_SUPERSEDED;
      Logger.audit({
        event: 'OP_REJECTED',
        userId,
        clientId,
        opId: op.id,
        entityType: op.entityType,
        entityId: op.entityId,
        errorCode,
        reason: `[RACE] ${finalConflict.reason}`,
        opType: op.opType,
      });
      return {
        opId: op.id,
        accepted: false,
        error: finalConflict.reason,
        errorCode,
        existingClock: finalConflict.existingClock,
      };
    }

    // Prune vector clock AFTER conflict detection but BEFORE storage.
    // Moved from ValidationService to here so that the full (unpruned) clock is used
    // for conflict comparison. This prevents false CONCURRENT results when the client
    // builds a merged clock with MAX+1 entries during conflict resolution (all entity
    // clock IDs + its own client ID). Pruning before comparison would drop an entity
    // clock ID, causing the comparison to return CONCURRENT instead of GREATER_THAN,
    // leading to an infinite rejection loop.
    const beforeSize = Object.keys(op.vectorClock).length;
    op.vectorClock = limitVectorClockSize(op.vectorClock, [op.clientId]);
    const afterSize = Object.keys(op.vectorClock).length;
    if (afterSize < beforeSize) {
      Logger.debug(
        `[client:${op.clientId}] Vector clock pruned from ${beforeSize} to ${afterSize} before storage`,
      );
    }

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
          payload: op.payload as Prisma.InputJsonValue,
          payloadBytes: BigInt(computeOpStorageBytes(op).bytes),
          vectorClock: op.vectorClock as Prisma.InputJsonValue,
          schemaVersion: op.schemaVersion,
          clientTimestamp: BigInt(op.timestamp),
          receivedAt: BigInt(now),
          isPayloadEncrypted: op.isPayloadEncrypted ?? false,
          syncImportReason: op.syncImportReason ?? null,
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
        select: {
          id: true,
          userId: true,
          clientId: true,
          actionType: true,
          opType: true,
          entityType: true,
          entityId: true,
          payload: true,
          vectorClock: true,
          schemaVersion: true,
          clientTimestamp: true,
          receivedAt: true,
          isPayloadEncrypted: true,
          syncImportReason: true,
        },
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

      if (!this.isSameDuplicateOperation(duplicateOp, userId, op, originalTimestamp)) {
        Logger.audit({
          event: 'OP_REJECTED',
          userId,
          clientId,
          opId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
          reason: 'Operation ID already belongs to a different operation',
          opType: op.opType,
        });
        return {
          opId: op.id,
          accepted: false,
          error: 'Operation ID already belongs to a different operation',
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
        };
      }

      Logger.audit({
        event: 'OP_REJECTED',
        userId,
        clientId,
        opId: op.id,
        entityType: op.entityType,
        entityId: op.entityId,
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        reason: 'Duplicate operation ID (insert race)',
        opType: op.opType,
      });
      return {
        opId: op.id,
        accepted: false,
        error: 'Duplicate operation ID',
        errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
      };
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
      const priorAggregate = await this._aggregatePriorVectorClock(tx, userId, serverSeq);
      const mergedClock: VectorClock = { ...priorAggregate };
      for (const [clientId, counter] of Object.entries(fullStateVectorClock)) {
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

    return {
      opId: op.id,
      accepted: true,
      serverSeq,
    };
  }

  // === Download Operations ===
  // Delegated to OperationDownloadService

  async getOpsSince(
    userId: number,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): Promise<ServerOperation[]> {
    return this.operationDownloadService.getOpsSince(
      userId,
      sinceSeq,
      excludeClient,
      limit,
    );
  }

  async getOpsSinceWithSeq(
    userId: number,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
    includeSnapshotMetadata: boolean = true,
  ): Promise<{
    ops: ServerOperation[];
    latestSeq: number;
    gapDetected: boolean;
    latestSnapshotSeq?: number;
    snapshotVectorClock?: VectorClock;
  }> {
    return this.operationDownloadService.getOpsSinceWithSeq(
      userId,
      sinceSeq,
      excludeClient,
      limit,
      includeSnapshotMetadata,
    );
  }

  async getLatestSeq(userId: number): Promise<number> {
    return this.operationDownloadService.getLatestSeq(userId);
  }

  // === Snapshot Management ===
  // Delegated to SnapshotService

  async getCachedSnapshot(userId: number): Promise<{
    state: unknown;
    serverSeq: number;
    generatedAt: number;
    schemaVersion: number;
  } | null> {
    return this.snapshotService.getCachedSnapshot(userId);
  }

  async prepareSnapshotCache(state: unknown): Promise<PreparedSnapshotCache> {
    return this.snapshotService.prepareSnapshotCache(state);
  }

  async getCachedSnapshotBytes(userId: number): Promise<number> {
    return this.snapshotService.getCachedSnapshotBytes(userId);
  }

  async getCachedSnapshotGeneratedAt(userId: number): Promise<number | null> {
    return this.snapshotService.getCachedSnapshotGeneratedAt(userId);
  }

  async cacheSnapshot(
    userId: number,
    state: unknown,
    serverSeq: number,
    preparedSnapshot?: PreparedSnapshotCache,
  ): Promise<CacheSnapshotResult> {
    return this.snapshotService.cacheSnapshot(userId, state, serverSeq, preparedSnapshot);
  }

  async cacheSnapshotIfReplayable(
    userId: number,
    state: unknown,
    serverSeq: number,
    isPayloadEncrypted: boolean,
    preparedSnapshot?: PreparedSnapshotCache,
  ): Promise<CacheSnapshotResult | null> {
    return this.snapshotService.cacheSnapshotIfReplayable(
      userId,
      state,
      serverSeq,
      isPayloadEncrypted,
      preparedSnapshot,
    );
  }

  async generateSnapshot(
    userId: number,
    onCacheDelta?: (deltaBytes: number) => Promise<void>,
    maxCacheBytes?: number,
  ): Promise<{
    state: unknown;
    serverSeq: number;
    generatedAt: number;
    schemaVersion: number;
  }> {
    return this.snapshotService.generateSnapshot(userId, onCacheDelta, maxCacheBytes);
  }

  async getRestorePoints(
    userId: number,
    limit: number = 30,
  ): Promise<
    {
      serverSeq: number;
      timestamp: number;
      type: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR';
      clientId: string;
      description?: string;
    }[]
  > {
    return this.snapshotService.getRestorePoints(userId, limit);
  }

  async generateSnapshotAtSeq(
    userId: number,
    targetSeq: number,
  ): Promise<{
    state: unknown;
    serverSeq: number;
    generatedAt: number;
  }> {
    return this.snapshotService.generateSnapshotAtSeq(userId, targetSeq);
  }

  // === Rate Limiting & Deduplication ===
  // Delegated to extracted services

  isRateLimited(userId: number): boolean {
    return this.rateLimitService.isRateLimited(userId);
  }

  cleanupExpiredRateLimitCounters(): number {
    return this.rateLimitService.cleanupExpiredCounters();
  }

  checkOpsRequestDedup(userId: number, requestId: string): UploadResult[] | null {
    return this.requestDeduplicationService.checkDeduplication(userId, 'ops', requestId);
  }

  cacheOpsRequestResults(
    userId: number,
    requestId: string,
    results: UploadResult[],
  ): void {
    this.requestDeduplicationService.cacheResults(userId, 'ops', requestId, results);
  }

  checkSnapshotRequestDedup(
    userId: number,
    requestId: string,
  ): SnapshotDedupResponse | null {
    return this.requestDeduplicationService.checkDeduplication(
      userId,
      'snapshot',
      requestId,
    );
  }

  cacheSnapshotRequestResult(
    userId: number,
    requestId: string,
    response: SnapshotDedupResponse,
  ): void {
    this.requestDeduplicationService.cacheResults(
      userId,
      'snapshot',
      requestId,
      response,
    );
  }

  cleanupExpiredRequestDedupEntries(): number {
    return this.requestDeduplicationService.cleanupExpiredEntries();
  }

  // === Storage Quota ===
  // Delegated to StorageQuotaService

  async calculateStorageUsage(userId: number): Promise<{
    operationsBytes: number;
    snapshotBytes: number;
    totalBytes: number;
    hasUnbackfilledRows: boolean;
  }> {
    return this.storageQuotaService.calculateStorageUsage(userId);
  }

  async assertPayloadBytesBackfillComplete(): Promise<void> {
    return this.storageQuotaService.assertPayloadBytesBackfillComplete();
  }

  async checkStorageQuota(
    userId: number,
    additionalBytes: number,
  ): Promise<{ allowed: boolean; currentUsage: number; quota: number }> {
    return this.storageQuotaService.checkStorageQuota(userId, additionalBytes);
  }

  async updateStorageUsage(userId: number): Promise<void> {
    return this.storageQuotaService.updateStorageUsage(userId);
  }

  async incrementStorageUsage(userId: number, deltaBytes: number): Promise<void> {
    return this.storageQuotaService.incrementStorageUsage(userId, deltaBytes);
  }

  async decrementStorageUsage(userId: number, deltaBytes: number): Promise<void> {
    return this.storageQuotaService.decrementStorageUsage(userId, deltaBytes);
  }

  async runWithStorageUsageLock<T>(userId: number, fn: () => Promise<T>): Promise<T> {
    return this.storageQuotaService.runWithStorageUsageLock(userId, fn);
  }

  markStorageNeedsReconcile(userId: number): void {
    this.storageQuotaService.markNeedsReconcile(userId);
  }

  async getStorageInfo(userId: number): Promise<{
    storageUsedBytes: number;
    storageQuotaBytes: number;
  }> {
    return this.storageQuotaService.getStorageInfo(userId);
  }

  // === Cleanup ===

  async deleteOldSyncedOpsForAllUsers(
    cutoffTime: number,
  ): Promise<{ totalDeleted: number; affectedUserIds: number[] }> {
    // S1: order stalest first so when affectedUserIds.length exceeds the
    // cleanup reconcile budget (RECONCILE_INTERVAL_MS * maxScheduled per
    // hour), the most-drifted users are reconciled before fresher ones.
    // Deterministic ordering replaces an earlier random shuffle, which only
    // probabilistically prevented starvation.
    const states = await prisma.userSyncState.findMany({
      where: {
        lastSnapshotSeq: { not: null },
        snapshotAt: { not: null },
      },
      select: {
        userId: true,
        lastSnapshotSeq: true,
        snapshotAt: true,
      },
      orderBy: { snapshotAt: 'asc' },
    });

    let totalDeleted = 0;
    const affectedUserIds: number[] = [];
    const deleteBatchSize = getOldOpsCleanupDeleteBatchSize();
    let remainingDeleteBudget = getOldOpsCleanupMaxDeletedPerRun();

    for (const state of states) {
      if (remainingDeleteBudget <= 0) break;

      const snapshotAt = Number(state.snapshotAt);
      const lastSnapshotSeq = state.lastSnapshotSeq ?? 0;

      // Only prune ops that are both older than the retention window and covered by a snapshot
      if (!(snapshotAt >= cutoffTime && lastSnapshotSeq > 0)) continue;

      // Drain this user across multiple batches until either they're empty or
      // the global per-run budget is exhausted. Without this, a single user
      // with a large backlog would only lose `deleteBatchSize` ops per day
      // even when budget remains — leaving small-backlog users behind it
      // unserviced when their snapshotAt is fresher.
      let userDeleted = 0;
      while (remainingDeleteBudget > 0) {
        const batchLimit = Math.min(deleteBatchSize, remainingDeleteBudget);
        const deletedCount = await this.deleteOldSyncedOpsBatch(
          state.userId,
          lastSnapshotSeq,
          cutoffTime,
          batchLimit,
        );
        if (deletedCount === 0) break;

        // Mark on the *first* successful batch (not after the loop) so that
        // if a later batch throws, the counter still self-heals. Without
        // this, batch-1 commits would leave the counter stale-high until the
        // next daily pass or process restart.
        //
        // Deliberately leave storageUsedBytes stale-high here. A count-based
        // approximate decrement can undercount users with many tiny ops and
        // let them bypass quota indefinitely. The marker tells the next
        // request to run an exact reconcile so drift self-heals.
        //
        // NOTE: the marker is in-memory (process-local). A persistent
        // `users.storage_needs_reconcile` column would survive restarts; see
        // TODO below.
        // TODO: persist the reconcile marker in a DB column so it survives
        // restarts of a single-instance deployment and works correctly across
        // a multi-instance deployment behind a load balancer.
        if (userDeleted === 0) {
          affectedUserIds.push(state.userId);
          this.storageQuotaService.markNeedsReconcile(state.userId);
        }

        userDeleted += deletedCount;
        totalDeleted += deletedCount;
        remainingDeleteBudget -= deletedCount;
        // Short-circuit when the batch returned fewer rows than asked for: the
        // user is empty and another findMany would only confirm zero rows.
        if (deletedCount < batchLimit) break;
      }
    }

    if (remainingDeleteBudget <= 0) {
      Logger.warn(
        `Cleanup [old-ops]: per-run budget exhausted after ${totalDeleted} ops; ` +
          `some users may still have retained old ops. ` +
          `Raise OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN if this happens repeatedly.`,
      );
    }

    return { totalDeleted, affectedUserIds };
  }

  private async deleteOldSyncedOpsBatch(
    userId: number,
    lastSnapshotSeq: number,
    cutoffTime: number,
    limit: number,
  ): Promise<number> {
    const doomedOps = await prisma.operation.findMany({
      where: {
        userId,
        serverSeq: { lte: lastSnapshotSeq },
        receivedAt: { lt: BigInt(cutoffTime) },
      },
      orderBy: { serverSeq: 'asc' },
      take: limit,
      select: { id: true },
    });

    if (doomedOps.length === 0) return 0;

    const result = await prisma.operation.deleteMany({
      where: {
        userId,
        id: { in: doomedOps.map((op) => op.id) },
      },
    });

    return result.count;
  }

  /**
   * Delete oldest restore point and all operations before it to free up storage.
   * Used when storage quota is exceeded to make room for new uploads.
   *
   * Strategy:
   * - If 2+ restore points: Delete oldest restore point AND all ops with serverSeq <= its seq
   * - If 1 restore point: Delete all ops with serverSeq < its seq (keep the restore point)
   * - If 0 restore points: Nothing to delete, return failure
   *
   * @returns Object with deletedCount, approximate freedBytes, and success flag
   */
  async deleteOldestRestorePointAndOps(
    userId: number,
  ): Promise<{ deletedCount: number; freedBytes: number; success: boolean }> {
    // Find all restore points (full-state operations) ordered by serverSeq ASC
    const restorePoints = await prisma.operation.findMany({
      where: {
        userId,
        opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
      },
      orderBy: { serverSeq: 'asc' },
      select: { serverSeq: true, opType: true },
      take: 2,
    });

    if (restorePoints.length === 0) {
      Logger.warn(`[user:${userId}] No restore points found, cannot free storage`);
      return { deletedCount: 0, freedBytes: 0, success: false };
    }

    const oldestRestorePoint = restorePoints[0];
    let deleteUpToSeq: number;

    if (restorePoints.length >= 2) {
      // Delete the oldest restore point AND all ops up to and including it
      deleteUpToSeq = oldestRestorePoint.serverSeq;
      Logger.info(
        `[user:${userId}] Deleting oldest restore point (seq=${deleteUpToSeq}) and all ops before it`,
      );
    } else {
      // Only one restore point - delete all ops BEFORE it, but keep the restore point
      deleteUpToSeq = oldestRestorePoint.serverSeq - 1;
      Logger.info(
        `[user:${userId}] Keeping single restore point (seq=${oldestRestorePoint.serverSeq}), deleting ops before it`,
      );
    }

    if (deleteUpToSeq < 1) {
      Logger.info(`[user:${userId}] No ops to delete (deleteUpToSeq=${deleteUpToSeq})`);
      return { deletedCount: 0, freedBytes: 0, success: false };
    }

    // Full-state ops (SYNC_IMPORT/BACKUP_IMPORT/REPAIR) can be up to 20MB each,
    // so the APPROX_BYTES_PER_OP=1024 fallback used for delta ops would undercount
    // by ~20000x and leave the cached counter permanently low if a reconcile
    // failure later rolls back to that figure. Use the write-time payload_bytes
    // value so cleanup accounting matches quota reconciliation without
    // detoasting JSONB payloads.
    const fullStateRows = await prisma.$queryRaw<
      Array<{ exact_bytes: bigint | null; full_state_count: bigint }>
    >`
      SELECT
        COALESCE(SUM(payload_bytes), 0) AS exact_bytes,
        COUNT(*)::bigint AS full_state_count
      FROM operations
      WHERE user_id = ${userId}
        AND server_seq <= ${deleteUpToSeq}
        AND op_type IN ('SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR')
    `;
    const fullStateExactBytes = Number(fullStateRows[0]?.exact_bytes ?? 0);
    const fullStateCount = Number(fullStateRows[0]?.full_state_count ?? 0);

    // Delete the operations
    const result = await prisma.operation.deleteMany({
      where: {
        userId,
        serverSeq: { lte: deleteUpToSeq },
      },
    });

    // freedBytes is split: exact size for the 0-1 restore-point rows just
    // measured (catches the 20MB-ish payloads that the APPROX_BYTES_PER_OP
    // approximation undercounts by ~20000x), plus the approximate
    // count*APPROX_BYTES_PER_OP for the remaining delta ops (median 150-300B
    // — modest over-estimate so the cleanup loop progresses without scanning
    // every delta payload). Reconciled to exact value once at the end of
    // freeStorageForUpload via a single updateStorageUsage call.
    const deltaOpsCount = Math.max(0, result.count - fullStateCount);
    const freedBytes = fullStateExactBytes + deltaOpsCount * APPROX_BYTES_PER_OP;

    if (result.count > 0) {
      // Clear stale snapshot cache if it references deleted operations
      const cachedRow = await prisma.userSyncState.findUnique({
        where: { userId },
        select: { lastSnapshotSeq: true },
      });

      if (cachedRow?.lastSnapshotSeq && cachedRow.lastSnapshotSeq <= deleteUpToSeq) {
        await prisma.userSyncState.update({
          where: { userId },
          data: {
            snapshotData: null,
            lastSnapshotSeq: null,
            snapshotAt: null,
          },
        });
        Logger.info(
          `[user:${userId}] Cleared stale snapshot cache (was at seq ${cachedRow.lastSnapshotSeq}, deleted up to ${deleteUpToSeq})`,
        );
      }

      // Decrement counter by the approximate freed bytes so freeStorageForUpload
      // can detect progress. Final accuracy is restored by the single
      // updateStorageUsage call at the end of freeStorageForUpload.
      await this.decrementStorageUsage(userId, freedBytes);
      Logger.info(
        `[user:${userId}] Deleted ${result.count} ops (approx freed ~${Math.round(freedBytes / 1024)}KB)`,
      );
    }

    return {
      deletedCount: result.count,
      freedBytes,
      success: result.count > 0,
    };
  }

  /**
   * Iteratively delete old restore points and operations until enough storage
   * space is available for the requested upload. Always keeps at least one
   * restore point and all operations after it (minimum valid sync state).
   *
   * @param userId - User ID
   * @param requiredBytes - Number of bytes needed for the upload
   * @returns Object with success status and cleanup statistics
   */
  async freeStorageForUpload(
    userId: number,
    requiredBytes: number,
  ): Promise<{
    success: boolean;
    freedBytes: number;
    deletedRestorePoints: number;
    deletedOps: number;
  }> {
    let totalFreedBytes = 0;
    let deletedRestorePoints = 0;
    let totalDeletedOps = 0;

    const MAX_CLEANUP_ITERATIONS = 50;
    let iterations = 0;

    // Reconcile the approximate counter once at the end via a single
    // calculateStorageUsage scan. Slow but bounded to a single user per
    // quota-cleanup event (not per upload like the previous regression).
    //
    // If reconcile fails we must NOT leave the counter at its post-decrement
    // (artificially low) value — that would let the user bypass quota until
    // the next successful reconcile. Roll the optimistic decrement back so the
    // counter returns to its pre-cleanup state (which was correctly tracked by
    // incremental upload deltas).
    const reconcileCounter = async (): Promise<boolean> => {
      try {
        await this.updateStorageUsage(userId);
        return true;
      } catch (err) {
        Logger.warn(
          `[user:${userId}] Failed to reconcile storage usage after cleanup: ${
            (err as Error).message
          }`,
        );
        return false;
      }
    };
    const reconcileOrRollback = async (): Promise<void> => {
      const ok = await reconcileCounter();
      if (!ok && totalFreedBytes > 0) {
        try {
          await this.storageQuotaService.incrementStorageUsage(userId, totalFreedBytes);
          Logger.warn(
            `[user:${userId}] Rolled back ${totalFreedBytes} bytes of optimistic cleanup decrement after reconcile failure`,
          );
        } catch (err) {
          Logger.error(
            `[user:${userId}] Failed to roll back cleanup decrement: ${
              (err as Error).message
            }`,
          );
        }
      }
    };

    // Keep trying until we have enough space or hit minimum
    while (iterations < MAX_CLEANUP_ITERATIONS) {
      iterations++;

      // Check if we now have enough space. The cached counter may have been
      // moved by approximate count*const deletes, so verify once with the exact
      // reconciled counter before declaring success.
      const quotaCheck = await this.checkStorageQuota(userId, requiredBytes);
      if (quotaCheck.allowed) {
        // On the success-path we want fresh truth, but if reconcile fails we
        // also want the rollback (otherwise we'd be making the success
        // decision against an artificially-low counter).
        await reconcileOrRollback();
        const reconciledQuotaCheck = await this.checkStorageQuota(userId, requiredBytes);
        if (reconciledQuotaCheck.allowed) {
          return {
            success: true,
            freedBytes: totalFreedBytes,
            deletedRestorePoints,
            deletedOps: totalDeletedOps,
          };
        }
        Logger.warn(
          `[user:${userId}] Storage still exceeded after exact reconcile: ` +
            `${reconciledQuotaCheck.currentUsage}/${reconciledQuotaCheck.quota} bytes`,
        );
      }

      // Only need to know whether at least two restore points remain.
      const restorePoints = await prisma.operation.findMany({
        where: {
          userId,
          opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
        },
        orderBy: { serverSeq: 'asc' },
        select: { serverSeq: true },
        take: 2,
      });

      // Minimum: 1 restore point + all ops after it
      // If we only have 1 or fewer restore points, we can't delete any more
      if (restorePoints.length <= 1) {
        Logger.warn(
          `[user:${userId}] Cannot free more storage: only ${restorePoints.length} restore point(s) remaining`,
        );
        await reconcileOrRollback();
        return {
          success: false,
          freedBytes: totalFreedBytes,
          deletedRestorePoints,
          deletedOps: totalDeletedOps,
        };
      }

      // Delete oldest restore point + all ops before it
      const result = await this.deleteOldestRestorePointAndOps(userId);
      if (!result.success) {
        await reconcileOrRollback();
        return {
          success: false,
          freedBytes: totalFreedBytes,
          deletedRestorePoints,
          deletedOps: totalDeletedOps,
        };
      }

      totalFreedBytes += result.freedBytes;
      deletedRestorePoints++;
      totalDeletedOps += result.deletedCount;

      Logger.info(
        `[user:${userId}] Auto-cleanup iteration: freed ${Math.round(result.freedBytes / 1024)}KB, ` +
          `${restorePoints.length - 1} restore point(s) remaining in current cleanup window`,
      );
    }

    // Exhausted max iterations without freeing enough space
    Logger.warn(
      `[user:${userId}] Storage cleanup exceeded max iterations (${MAX_CLEANUP_ITERATIONS})`,
    );
    await reconcileOrRollback();
    return {
      success: false,
      freedBytes: totalFreedBytes,
      deletedRestorePoints,
      deletedOps: totalDeletedOps,
    };
  }

  async deleteStaleDevices(beforeTime: number): Promise<number> {
    const result = await prisma.syncDevice.deleteMany({
      where: {
        lastSeenAt: { lt: BigInt(beforeTime) },
      },
    });
    return result.count;
  }

  /**
   * Delete ALL sync data for a user. Used for encryption password changes.
   * Deletes operations, devices, and resets sync state.
   */
  async deleteAllUserData(userId: number): Promise<void> {
    await prisma.$transaction(async (tx) => {
      // Delete all operations
      await tx.operation.deleteMany({ where: { userId } });

      // Delete all devices
      await tx.syncDevice.deleteMany({ where: { userId } });

      // Delete sync state entirely, resetting lastSeq to 0.
      // Unlike uploadOps clean slate (which preserves lastSeq), account reset
      // intentionally wipes everything. Clients detect the wipe via latestSeq=0
      // and trigger a full state re-upload. This is correct because account reset
      // (e.g., encryption password change) requires ALL clients to re-sync.
      await tx.userSyncState.deleteMany({ where: { userId } });

      // Reset storage usage
      await tx.user.update({
        where: { id: userId },
        data: { storageUsedBytes: BigInt(0) },
      });
    });

    // Clear caches. Include the request-dedup cache so a retry of an
    // ops-upload from the pre-wipe state cannot resurrect its cached results
    // post-wipe. (Process-local only; persists across requests within the
    // single instance.)
    this.rateLimitService.clearForUser(userId);
    this.snapshotService.clearForUser(userId);
    this.storageQuotaService.clearForUser(userId);
    this.requestDeduplicationService.clearForUser(userId);
  }

  async isDeviceOwner(userId: number, clientId: string): Promise<boolean> {
    return this.deviceService.isDeviceOwner(userId, clientId);
  }

  async getAllUserIds(): Promise<number[]> {
    return this.deviceService.getAllUserIds();
  }

  async getOnlineDeviceCount(userId: number): Promise<number> {
    return this.deviceService.getOnlineDeviceCount(userId);
  }
}

// Singleton instance
let syncServiceInstance: SyncService | null = null;

export const getSyncService = (): SyncService => {
  if (!syncServiceInstance) {
    syncServiceInstance = new SyncService();
  }
  return syncServiceInstance;
};

export const initSyncService = (config?: Partial<SyncConfig>): SyncService => {
  syncServiceInstance = new SyncService(config);
  return syncServiceInstance;
};
