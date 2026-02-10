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
} from './sync.types';
import { Logger } from '../logger';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';
import { Prisma } from '@prisma/client';
import {
  ValidationService,
  ALLOWED_ENTITY_TYPES,
  RateLimitService,
  RequestDeduplicationService,
  DeviceService,
  OperationDownloadService,
  StorageQuotaService,
  SnapshotService,
} from './services';

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
  ): Promise<{ hasConflict: boolean; reason?: string; existingClock?: VectorClock }> {
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
  ): Promise<{ hasConflict: boolean; reason?: string; existingClock?: VectorClock }> {
    // Get the latest operation for this entity
    const existingOp = await tx.operation.findFirst({
      where: {
        userId,
        entityType: op.entityType,
        entityId,
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
        reason: `Equal vector clocks from different clients for ${op.entityType}:${entityId} (client ${op.clientId} vs ${existingOp.clientId})`,
        existingClock,
      };
    }

    // CONCURRENT means both clocks have entries the other doesn't
    if (comparison === 'CONCURRENT') {
      return {
        hasConflict: true,
        reason: `Concurrent modification detected for ${op.entityType}:${entityId}`,
        existingClock,
      };
    }

    // LESS_THAN means the incoming op is older than what we have
    if (comparison === 'LESS_THAN') {
      return {
        hasConflict: true,
        reason: `Superseded operation: server has newer version of ${op.entityType}:${entityId}`,
        existingClock,
      };
    }

    // Should never reach here - all comparison cases handled above
    // But if we do, default to conflict for safety
    return {
      hasConflict: true,
      reason: `Unknown vector clock comparison result for ${op.entityType}:${entityId}`,
      existingClock,
    };
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

            // Reset sync state (delete if exists)
            await tx.userSyncState.deleteMany({ where: { userId } });

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

          for (const op of ops) {
            const result = await this.processOperation(userId, clientId, op, now, tx);
            results.push(result);
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

      // Clear caches after clean slate transaction completes successfully
      if (isCleanSlate) {
        this.rateLimitService.clearForUser(userId);
        this.snapshotService.clearForUser(userId);
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

      // Mark all "successful" results as failed due to transaction rollback
      // Use INTERNAL_ERROR for all transient failures - client will retry
      return ops.map((op) => ({
        opId: op.id,
        accepted: false,
        error: isSerializationFailure
          ? 'Concurrent transaction conflict - please retry'
          : isTimeout
            ? 'Transaction timeout - server busy, please retry'
            : `Transaction rolled back: ${errorMessage}`,
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
    try {
      // Clamp future timestamps instead of rejecting them (prevents silent data loss)
      const maxAllowedTimestamp = now + this.config.maxClockDriftMs;
      if (op.timestamp > maxAllowedTimestamp) {
        const originalTimestamp = op.timestamp;
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

      // Check for conflicts with existing operations
      const conflict = await this.detectConflict(userId, op, tx);
      if (conflict.hasConflict) {
        const isConcurrent = conflict.reason?.includes('Concurrent');
        const errorCode = isConcurrent
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
        const isConcurrent = finalConflict.reason?.includes('Concurrent');
        const errorCode = isConcurrent
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

      // FIX: Check for duplicate operation BEFORE attempting insert.
      // If we let the insert fail with P2002 (unique constraint), PostgreSQL aborts the
      // entire transaction, causing all subsequent operations in the batch to fail with
      // error code 25P02 ("transaction is aborted"). By checking first, we avoid this
      // and can properly return DUPLICATE_OPERATION for just this op while continuing
      // to process the rest of the batch.
      const existingOp = await tx.operation.findUnique({
        where: { id: op.id },
        select: { id: true }, // Only need to check existence
      });

      if (existingOp) {
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

      // Prune vector clock AFTER conflict detection but BEFORE storage.
      // Moved from ValidationService to here so that the full (unpruned) clock is used
      // for conflict comparison. This prevents false CONCURRENT results when the client
      // builds a merged clock with MAX+1 entries during conflict resolution (all entity
      // clock IDs + its own client ID). Pruning before comparison would drop an entity
      // clock ID, causing the pruning-aware comparison to see a non-shared key and return
      // CONCURRENT instead of GREATER_THAN, leading to an infinite rejection loop.
      const beforeSize = Object.keys(op.vectorClock).length;
      op.vectorClock = limitVectorClockSize(op.vectorClock, [op.clientId]);
      const afterSize = Object.keys(op.vectorClock).length;
      if (afterSize < beforeSize) {
        Logger.debug(
          `[client:${op.clientId}] Vector clock pruned from ${beforeSize} to ${afterSize} before storage`,
        );
      }

      await tx.operation.create({
        data: {
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
        },
      });

      return {
        opId: op.id,
        accepted: true,
        serverSeq,
      };
    } catch (err: unknown) {
      // Duplicate ID - fallback in case of race condition between check and insert.
      // This should be rare now that we pre-check, but kept for safety.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002' // Unique constraint violation
      ) {
        Logger.audit({
          event: 'OP_REJECTED',
          userId,
          clientId,
          opId: op.id,
          entityType: op.entityType,
          entityId: op.entityId,
          errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
          reason: 'Duplicate operation ID (race)',
          opType: op.opType,
        });
        return {
          opId: op.id,
          accepted: false,
          error: 'Duplicate operation ID',
          errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        };
      }
      // Re-throw unexpected errors to trigger transaction rollback
      throw err;
    }
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

  async cacheSnapshot(userId: number, state: unknown, serverSeq: number): Promise<void> {
    return this.snapshotService.cacheSnapshot(userId, state, serverSeq);
  }

  async generateSnapshot(userId: number): Promise<{
    state: unknown;
    serverSeq: number;
    generatedAt: number;
    schemaVersion: number;
  }> {
    return this.snapshotService.generateSnapshot(userId);
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

    // Calculate approximate size of ops being deleted
    const opsToDelete = await prisma.operation.findMany({
      where: {
        userId,
        serverSeq: { lte: deleteUpToSeq },
      },
      select: { payload: true, vectorClock: true },
    });

    const freedBytes = opsToDelete.reduce((sum, op) => {
      const payloadSize = op.payload ? JSON.stringify(op.payload).length : 0;
      const clockSize = op.vectorClock ? JSON.stringify(op.vectorClock).length : 0;
      return sum + payloadSize + clockSize;
    }, 0);

    // Delete the operations
    const result = await prisma.operation.deleteMany({
      where: {
        userId,
        serverSeq: { lte: deleteUpToSeq },
      },
    });

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

      // Update storage usage cache
      await this.updateStorageUsage(userId);
      Logger.info(
        `[user:${userId}] Deleted ${result.count} ops (freed ~${Math.round(freedBytes / 1024)}KB)`,
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

    // Keep trying until we have enough space or hit minimum
    while (true) {
      // Check if we now have enough space
      const quotaCheck = await this.checkStorageQuota(userId, requiredBytes);
      if (quotaCheck.allowed) {
        return {
          success: true,
          freedBytes: totalFreedBytes,
          deletedRestorePoints,
          deletedOps: totalDeletedOps,
        };
      }

      // Count restore points remaining
      const restorePoints = await prisma.operation.findMany({
        where: {
          userId,
          opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
        },
        orderBy: { serverSeq: 'asc' },
        select: { serverSeq: true },
      });

      // Minimum: 1 restore point + all ops after it
      // If we only have 1 or fewer restore points, we can't delete any more
      if (restorePoints.length <= 1) {
        Logger.warn(
          `[user:${userId}] Cannot free more storage: only ${restorePoints.length} restore point(s) remaining`,
        );
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
          `${restorePoints.length - 1} restore points remaining`,
      );
    }
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

      // Reset sync state (delete if exists)
      await tx.userSyncState.deleteMany({ where: { userId } });

      // Reset storage usage
      await tx.user.update({
        where: { id: userId },
        data: { storageUsedBytes: BigInt(0) },
      });
    });

    // Clear caches
    this.rateLimitService.clearForUser(userId);
    this.snapshotService.clearForUser(userId);
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
