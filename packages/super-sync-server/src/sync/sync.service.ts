import { prisma } from '../db';
import {
  Operation,
  ServerOperation,
  UploadResult,
  SyncConfig,
  DEFAULT_SYNC_CONFIG,
  VectorClock,
  SYNC_ERROR_CODES,
} from './sync.types';
import { Logger } from '../logger';
import { Prisma } from '@prisma/client';
import {
  ValidationService,
  RateLimitService,
  RequestDeduplicationService,
  DeviceService,
  OperationDownloadService,
  OperationUploadService,
  StorageQuotaService,
  SnapshotService,
  type PreparedSnapshotCache,
  type CacheSnapshotResult,
  type SnapshotDedupResponse,
} from './services';
import type { ValidationResult } from './services/validation.service';
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

class CleanSlateUploadRejectedError extends Error {
  constructor(readonly results: UploadResult[]) {
    super('Clean-slate replacement was rejected');
  }
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
  private operationUploadService: OperationUploadService;
  private prevalidatedOps = new WeakMap<Operation, ValidationResult>();

  constructor(config: Partial<SyncConfig> = {}) {
    this.config = { ...DEFAULT_SYNC_CONFIG, ...config };
    this.validationService = new ValidationService(this.config);
    this.rateLimitService = new RateLimitService(this.config);
    this.requestDeduplicationService = new RequestDeduplicationService();
    this.deviceService = new DeviceService();
    this.operationDownloadService = new OperationDownloadService();
    this.storageQuotaService = new StorageQuotaService();
    this.snapshotService = new SnapshotService();
    this.operationUploadService = new OperationUploadService(
      this.validationService,
      this.config,
    );
  }

  getMaxClockDriftMs(): number {
    return this.config.maxClockDriftMs;
  }

  /**
   * Return only operations that can consume storage if this upload commits.
   * Invalid siblings still reach uploadOps so the client receives a terminal
   * per-operation rejection, but they must not inflate the pre-write quota gate
   * and block otherwise valid operations in the same request.
   */
  filterValidOpsForQuota(ops: Operation[], clientId: string): Operation[] {
    const seenOperationIds = new Set<string>();
    return ops.filter((op) => {
      const isFirstOccurrence = !seenOperationIds.has(op.id);
      seenOperationIds.add(op.id);
      const validation = this.validationService.validateOp(op, clientId);
      this.prevalidatedOps.set(op, validation);
      return isFirstOccurrence && validation.valid;
    });
  }

  getPrevalidatedPayloadBytes(op: Operation): number | undefined {
    return this.prevalidatedOps.get(op)?.payloadBytes;
  }

  // === Upload Operations ===

  async uploadOps(
    userId: number,
    clientId: string,
    ops: Operation[],
    isCleanSlate?: boolean,
    requestStartOccupiedIds?: ReadonlySet<string>,
    repairBaseServerSeq?: number,
    allowLegacyRepairWithoutBase: boolean = false,
  ): Promise<UploadResult[]> {
    if (isCleanSlate && ops.length === 0) {
      return [];
    }

    const results: UploadResult[] = [];
    const now = Date.now();
    const txStartedAt = Date.now();
    let uploadDbRoundtrips = 0;
    const prevalidatedResults = new Map<Operation, ValidationResult>();
    const containsRepair = ops.some((op) => op.opType === 'REPAIR');
    const isLegacyRepairUpload =
      containsRepair && repairBaseServerSeq === undefined && allowLegacyRepairWithoutBase;
    const shouldCleanSlate = !!isCleanSlate && !containsRepair;
    if (isCleanSlate && containsRepair) {
      Logger.warn(
        `[user:${userId}] Ignoring destructive clean-slate flag for REPAIR upload`,
      );
    }
    for (const op of ops) {
      const validation = this.prevalidatedOps.get(op);
      if (validation) {
        prevalidatedResults.set(op, validation);
      }
    }

    if (isCleanSlate) {
      const validations = ops.map((op) => {
        const validation =
          prevalidatedResults.get(op) ?? this.validationService.validateOp(op, clientId);
        prevalidatedResults.set(op, validation);
        return validation;
      });
      if (validations.some(({ valid }) => !valid)) {
        return ops.map((op, index) => {
          const validation = validations[index];
          return validation.valid
            ? {
                opId: op.id,
                accepted: false,
                error: 'Clean-slate batch contains an invalid operation',
                errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
              }
            : {
                opId: op.id,
                accepted: false,
                error: validation.error ?? 'Invalid operation',
                errorCode: validation.errorCode,
              };
        });
      }
    }

    try {
      // Use transaction to acquire write lock and ensure atomicity
      await prisma.$transaction(
        async (tx) => {
          if (containsRepair && !isLegacyRepairUpload) {
            // Serialize the causal precondition and the later insert through the
            // same per-user sequence row. A concurrent upload either commits
            // first (making this base stale) or waits and lands after REPAIR.
            await tx.userSyncState.upsert({
              where: { userId },
              create: { userId, lastSeq: 0 },
              update: {},
            });
            const rows = await tx.$queryRaw<Array<{ lastSeq: number }>>`
              SELECT last_seq AS "lastSeq"
              FROM user_sync_state
              WHERE user_id = ${userId}
              FOR UPDATE
            `;
            const currentServerSeq = rows[0]?.lastSeq ?? 0;
            if (
              repairBaseServerSeq === undefined ||
              repairBaseServerSeq !== currentServerSeq
            ) {
              Logger.warn(
                `[user:${userId}] Rejecting stale REPAIR snapshot ` +
                  `(base=${repairBaseServerSeq ?? 'missing'}, current=${currentServerSeq})`,
              );
              results.push(
                ...ops.map((op) =>
                  op.opType === 'REPAIR'
                    ? {
                        opId: op.id,
                        accepted: false,
                        error: 'REPAIR snapshot does not include current server state',
                        errorCode: SYNC_ERROR_CODES.REPAIR_STALE,
                      }
                    : {
                        opId: op.id,
                        accepted: false,
                        error: 'Batch deferred because its REPAIR snapshot is stale',
                        errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
                      },
                ),
              );
              return;
            }
          }

          // If clean slate requested, delete all existing data first
          if (shouldCleanSlate) {
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
            const batchResult = await this.operationUploadService.processOperationBatch(
              userId,
              clientId,
              ops,
              now,
              tx,
              prevalidatedResults,
              requestStartOccupiedIds,
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

            const firstOperationById = new Map<
              string,
              { op: Operation; originalTimestamp: number }
            >();

            for (const op of ops) {
              const firstRequestOperation = firstOperationById.get(op.id);
              if (!firstRequestOperation) {
                firstOperationById.set(op.id, {
                  op,
                  originalTimestamp: op.timestamp,
                });
              }
              const validation =
                prevalidatedResults.get(op) ??
                this.validationService.validateOp(op, clientId);
              prevalidatedResults.set(op, validation);

              const { result, storageBytes, fallback } =
                await this.operationUploadService.processOperation(
                  userId,
                  clientId,
                  op,
                  now,
                  tx,
                  validation,
                  requestStartOccupiedIds?.has(op.id),
                  firstRequestOperation,
                );
              results.push(result);
              if (result.accepted) {
                // Reuse the size computed in processOperation instead of
                // re-measuring (the payload can be multi-MB).
                acceptedDeltaBytes += storageBytes;
                if (fallback) unserializableAccepted += 1;
              }
            }
          }
          if (unserializableAccepted > 0) {
            Logger.warn(
              `computeOpsStorageBytes: ${unserializableAccepted} unserializable op(s) ` +
                `charged at APPROX_BYTES_PER_OP for user=${userId} (uploadOps)`,
            );
          }

          if (
            isCleanSlate &&
            (results.length !== ops.length || results.some(({ accepted }) => !accepted))
          ) {
            throw new CleanSlateUploadRejectedError(
              ops.map((op, index) => {
                const result = results[index];
                return result && !result.accepted
                  ? result
                  : {
                      opId: op.id,
                      accepted: false,
                      error: 'Clean-slate replacement was rolled back',
                      errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
                    };
              }),
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
          if (acceptedDeltaBytes > 0 && !shouldCleanSlate) {
            const delta = BigInt(Math.floor(acceptedDeltaBytes));
            await tx.$executeRaw`
              UPDATE users
              SET storage_used_bytes = GREATEST(storage_used_bytes + ${delta}::bigint, 0::bigint)
              WHERE id = ${userId}
            `;
            uploadDbRoundtrips++;
          } else if (acceptedDeltaBytes > 0 && shouldCleanSlate) {
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
      if (shouldCleanSlate) {
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
      if (err instanceof CleanSlateUploadRejectedError) {
        Logger.warn(
          `[user:${userId}] Clean-slate replacement rejected; existing data preserved`,
        );
        return err.results;
      }

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

  // === Download Operations ===
  // Delegated to OperationDownloadService

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

  async prepareSnapshotCache(state: unknown): Promise<PreparedSnapshotCache> {
    return this.snapshotService.prepareSnapshotCache(state);
  }

  async getCachedSnapshotBytes(userId: number): Promise<number> {
    return this.snapshotService.getCachedSnapshotBytes(userId);
  }

  async getCachedSnapshotGeneratedAt(userId: number): Promise<number | null> {
    return this.snapshotService.getCachedSnapshotGeneratedAt(userId);
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

  checkOpsRequestDedup(
    userId: number,
    requestId: string,
    getFingerprint?: () => string,
  ): UploadResult[] | null {
    return this.requestDeduplicationService.checkDeduplication(
      userId,
      'ops',
      requestId,
      getFingerprint,
    );
  }

  cacheOpsRequestResults(
    userId: number,
    requestId: string,
    results: UploadResult[],
    fingerprint?: string,
  ): void {
    this.requestDeduplicationService.cacheResults(
      userId,
      'ops',
      requestId,
      results,
      fingerprint,
    );
  }

  checkSnapshotRequestDedup(
    userId: number,
    requestId: string,
    getFingerprint?: () => string,
  ): SnapshotDedupResponse | null {
    return this.requestDeduplicationService.checkDeduplication(
      userId,
      'snapshot',
      requestId,
      getFingerprint,
    );
  }

  cacheSnapshotRequestResult(
    userId: number,
    requestId: string,
    response: SnapshotDedupResponse,
    fingerprint?: string,
  ): void {
    this.requestDeduplicationService.cacheResults(
      userId,
      'snapshot',
      requestId,
      response,
      fingerprint,
    );
  }

  cleanupExpiredRequestDedupEntries(): number {
    return this.requestDeduplicationService.cleanupExpiredEntries();
  }

  // === Storage Quota ===
  // Delegated to StorageQuotaService

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
    return this.storageQuotaService.deleteOldSyncedOpsForAllUsers(cutoffTime);
  }

  async deleteOldestRestorePointAndOps(
    userId: number,
  ): Promise<{ deletedCount: number; freedBytes: number; success: boolean }> {
    return this.storageQuotaService.deleteOldestRestorePointAndOps(userId);
  }

  async freeStorageForUpload(
    userId: number,
    requiredBytes: number,
  ): Promise<{
    success: boolean;
    freedBytes: number;
    deletedRestorePoints: number;
    deletedOps: number;
  }> {
    return this.storageQuotaService.freeStorageForUpload(userId, requiredBytes);
  }

  async deleteStaleDevices(beforeTime: number): Promise<number> {
    return this.deviceService.deleteStaleDevices(beforeTime);
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
