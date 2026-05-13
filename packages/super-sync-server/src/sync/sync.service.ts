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
} from './sync.types';
import { APPROX_BYTES_PER_OP, computeOpStorageBytes } from './sync.const';
import { Logger } from '../logger';
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
} from './services';

interface DuplicateOperationCandidate {
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
    const entityIdsToCheck: string[] = op.entityIds?.length
      ? op.entityIds
      : op.entityId
        ? [op.entityId]
        : [];

    // Skip if no entity IDs (can't have entity-level conflicts)
    if (entityIdsToCheck.length === 0) {
      return { hasConflict: false };
    }

    // Check each entity for conflicts
    for (const entityId of entityIdsToCheck) {
      const conflictResult = await this.detectConflictForEntity(userId, op, entityId, tx);
      if (conflictResult.hasConflict) {
        return conflictResult;
      }
    }

    return { hasConflict: false };
  }

  /**
   * Checks for conflicts on a single entity.
   * Extracted from detectConflict to support multi-entity operations.
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

    // Parse the existing operation's vector clock (Prisma returns Json, cast to VectorClock)
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

  // === Upload Operations ===

  async uploadOps(
    userId: number,
    clientId: string,
    ops: Operation[],
    isCleanSlate?: boolean,
  ): Promise<UploadResult[]> {
    const results: UploadResult[] = [];
    const now = Date.now();

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
              },
            });

            // Reset storage usage
            await tx.user.update({
              where: { id: userId },
              data: { storageUsedBytes: BigInt(0) },
            });

            Logger.info(`[user:${userId}] Clean slate completed - all data deleted`);
          }

          // Ensure user has sync state row (init if needed)
          // We assume user exists in `users` table because of foreign key,
          // but if `uploadOps` is called, authentication should have verified user existence.
          // However, `user_sync_state` might not exist yet.
          await tx.userSyncState.upsert({
            where: { userId },
            create: { userId, lastSeq: 0 },
            update: {}, // No-op update to ensure it exists
          });

          // Track the delta-bytes for accepted ops so we can write
          // `users.storage_used_bytes` atomically in the same transaction as the
          // op inserts. Doing the counter write outside this transaction (as
          // the route layer used to) opens a window where the data commits but
          // the counter does not — if the process dies between, the in-memory
          // `markStorageNeedsReconcile` marker is lost too.
          let acceptedDeltaBytes = 0;
          let unserializableAccepted = 0;
          for (const op of ops) {
            const result = await this.processOperation(userId, clientId, op, now, tx);
            results.push(result);
            if (result.accepted) {
              const sized = computeOpStorageBytes(op);
              acceptedDeltaBytes += sized.bytes;
              if (sized.fallback) unserializableAccepted += 1;
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
          } else if (acceptedDeltaBytes > 0 && isCleanSlate) {
            const delta = BigInt(Math.floor(acceptedDeltaBytes));
            await tx.$executeRaw`
              UPDATE users
              SET storage_used_bytes = ${delta}::bigint
              WHERE id = ${userId}
            `;
          }
        },
        {
          // Large operations like SYNC_IMPORT/BACKUP_IMPORT can have payloads up to 20MB.
          // Default Prisma timeout (5s) is too short for these. Use 60s to match generateSnapshot.
          timeout: 60000,
          // FIX 1.6: Set explicit isolation level for strict consistency.
          // REPEATABLE_READ prevents phantom reads and ensures consistent conflict detection.
          // Combined with the FIX 1.5 re-check after sequence allocation, this prevents
          // race conditions where two concurrent requests both pass conflict detection.
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
    } catch (err) {
      // Transaction failed - all operations were rolled back
      const errorMessage = (err as Error).message || 'Unknown error';

      // Check if this is a serialization failure (concurrent transaction conflict)
      // Prisma uses P2034 for "Transaction failed due to a write conflict or a deadlock"
      // PostgreSQL uses 40001 (serialization_failure) and 40P01 (deadlock_detected)
      const isSerializationFailure =
        (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') ||
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

  checkRequestDeduplication(userId: number, requestId: string): UploadResult[] | null {
    return this.requestDeduplicationService.checkDeduplication(userId, requestId);
  }

  cacheRequestResults(userId: number, requestId: string, results: UploadResult[]): void {
    this.requestDeduplicationService.cacheResults(userId, requestId, results);
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
  }> {
    return this.storageQuotaService.calculateStorageUsage(userId);
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

    for (const state of states) {
      const snapshotAt = Number(state.snapshotAt);
      const lastSnapshotSeq = state.lastSnapshotSeq ?? 0;

      // Only prune ops that are both older than the retention window and covered by a snapshot
      if (snapshotAt >= cutoffTime && lastSnapshotSeq > 0) {
        const result = await prisma.operation.deleteMany({
          where: {
            userId: state.userId,
            serverSeq: { lte: lastSnapshotSeq },
            receivedAt: { lt: BigInt(cutoffTime) },
          },
        });
        if (result.count > 0) {
          totalDeleted += result.count;
          affectedUserIds.push(state.userId);
          // Deliberately leave storageUsedBytes stale-high here. A count-based
          // approximate decrement can undercount users with many tiny ops and
          // let them bypass quota indefinitely. Mark the user as needing an
          // exact reconcile so their next request self-heals the drift instead
          // of waiting for the daily pass — and, crucially, so that a crash
          // mid-loop still lets surviving deletes self-reconcile rather than
          // leaving the counter stale-high indefinitely.
          // NOTE: the marker is in-memory (process-local). A persistent
          // `users.storage_needs_reconcile` column would survive restarts; see
          // TODO below.
          // TODO: persist the reconcile marker in a DB column so it survives
          // restarts of a single-instance deployment and works correctly across
          // a multi-instance deployment behind a load balancer.
          this.storageQuotaService.markNeedsReconcile(state.userId);
        }
      }
    }

    return { totalDeleted, affectedUserIds };
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
    // failure later rolls back to that figure. Measure the exact bytes for the
    // restore-point rows in the deletion window via pg_column_size BEFORE we
    // delete them — `deleteOldestRestorePointAndOps` deletes at most ONE
    // restore point per call (or zero, when it keeps the single remaining one),
    // so this is a bounded 0-1 row scan that does not reintroduce the DoS the
    // earlier SUM(pg_column_size) over every delta op caused.
    const fullStateRows = await prisma.$queryRaw<
      Array<{ exact_bytes: bigint | null; full_state_count: bigint }>
    >`
      SELECT
        COALESCE(SUM(pg_column_size(payload) + pg_column_size(vector_clock)), 0) AS exact_bytes,
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
