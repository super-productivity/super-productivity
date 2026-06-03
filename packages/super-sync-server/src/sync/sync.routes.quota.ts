import { FastifyReply } from 'fastify';
import { prisma } from '../db';
import { Logger } from '../logger';
import { getSyncService } from './sync.service';
import { computeOpStorageBytes } from './sync.const';
import { SYNC_ERROR_CODES } from './sync.types';
import { errorMessage, MAX_OPS_PER_BATCH } from './sync.routes.payload';

/**
 * Approximate on-disk byte cost of a set of operations, computed locally so
 * the hot path never scans the operations table. Approximation ignores TOAST
 * compression overhead and is used to size the pre-write quota gate.
 *
 * Delegates to the shared `computeOpStorageBytes` helper so the gate here and
 * the in-transaction counter increment inside `uploadOps` cannot disagree on
 * what "size" means. The `fallback` counter is the number of ops in this
 * batch whose payload could not be JSON-serialized — kept so route callers
 * can log how often unserializable ops are charged at APPROX_BYTES_PER_OP
 * without ever logging op content.
 */
export const computeOpsStorageBytes = (
  ops: Array<{ id?: string; payload: unknown; vectorClock: unknown }>,
): { bytes: number; fallback: number } => {
  let bytes = 0;
  let fallback = 0;
  for (const op of ops) {
    const sized = computeOpStorageBytes(op);
    bytes += sized.bytes;
    if (sized.fallback) fallback += 1;
  }
  return { bytes, fallback };
};

export const computeJsonStorageBytes = (value: unknown, fallback: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(value ?? fallback), 'utf8');
  } catch {
    return 0;
  }
};

export const getRawOpsCount = (body: unknown): number | null => {
  if (typeof body !== 'object' || body === null) return null;
  const ops = (body as { ops?: unknown }).ops;
  return Array.isArray(ops) ? ops.length : null;
};

export const sendOpsBatchTooLargeReply = (
  reply: FastifyReply,
  userId: number,
  opsCount: number,
): FastifyReply => {
  Logger.warn(
    `[user:${userId}] Upload rejected: ${opsCount} ops exceeds max batch size ${MAX_OPS_PER_BATCH}`,
  );
  return reply.status(413).send({
    error: `Too many operations in upload batch. Maximum is ${MAX_OPS_PER_BATCH}.`,
    errorCode: SYNC_ERROR_CODES.PAYLOAD_TOO_LARGE,
    maxOpsPerBatch: MAX_OPS_PER_BATCH,
  });
};

export const applyStorageUsageDelta = async (
  userId: number,
  deltaBytes: number,
  context: string,
): Promise<void> => {
  if (!Number.isFinite(deltaBytes) || deltaBytes === 0) return;
  const syncService = getSyncService();
  try {
    if (deltaBytes > 0) {
      await syncService.incrementStorageUsage(userId, deltaBytes);
    } else {
      await syncService.decrementStorageUsage(userId, Math.abs(deltaBytes));
    }
  } catch (err) {
    // Counter write failed AFTER the data write committed. The cached
    // storage_used_bytes is now stale (low for increments, high for
    // decrements). Mark the user for forced reconcile so the next quota
    // check self-heals rather than waiting for daily cleanup.
    syncService.markStorageNeedsReconcile(userId);
    Logger.warn(
      `[user:${userId}] Failed to update storage usage cache ${context}: ${errorMessage(err)}; marked for forced reconcile`,
    );
  }
};

export const sendQuotaExceededReply = (
  reply: FastifyReply,
  body: {
    storageUsedBytes: number;
    storageQuotaBytes: number;
    autoCleanupAttempted: boolean;
    cleanupStats?: {
      freedBytes: number;
      deletedRestorePoints: number;
      deletedOps: number;
    };
  },
): FastifyReply =>
  reply.status(413).send({
    error: 'Storage quota exceeded',
    errorCode: SYNC_ERROR_CODES.STORAGE_QUOTA_EXCEEDED,
    ...body,
  });

type ExistingSyncImport = {
  id: string;
  clientId: string;
  serverSeq: number;
};

/**
 * Look up an existing full-state op for the user.
 *
 * When `incomingOpId` is provided, try an exact id match first so an
 * idempotent retry (`existing.id === incomingOpId`) is detected deterministically
 * even when multiple full-state ops exist for the user (e.g. an old SYNC_IMPORT
 * plus a later BACKUP_IMPORT). The fallback orders by `serverSeq DESC` so the
 * 409 path consistently reports the most recent restore point instead of
 * whatever Postgres happens to return.
 */
export const findExistingSyncImport = async (
  userId: number,
  incomingOpId?: string,
): Promise<ExistingSyncImport | null> => {
  if (incomingOpId) {
    const exact = await prisma.operation.findUnique({
      where: { id: incomingOpId },
      select: {
        id: true,
        userId: true,
        clientId: true,
        serverSeq: true,
        opType: true,
      },
    });
    if (
      exact &&
      exact.userId === userId &&
      (exact.opType === 'SYNC_IMPORT' ||
        exact.opType === 'BACKUP_IMPORT' ||
        exact.opType === 'REPAIR')
    ) {
      return { id: exact.id, clientId: exact.clientId, serverSeq: exact.serverSeq };
    }
  }
  return prisma.operation.findFirst({
    where: {
      userId,
      opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
    },
    orderBy: { serverSeq: 'desc' },
    select: { id: true, clientId: true, serverSeq: true },
  });
};

/**
 * True when an incoming snapshot upload is a retry of the existing import —
 * the client has reused the same `opId`, so the previous attempt was already
 * persisted server-side and we should respond with idempotent success
 * instead of a 409 SYNC_IMPORT_EXISTS. Returning failure here would force a
 * client whose response was dropped by the network into the "download and
 * merge" path that the 409 normally triggers.
 */
export const isIdempotentSyncImportRetry = (
  existingImport: ExistingSyncImport,
  incomingOpId: string | undefined,
): boolean => Boolean(incomingOpId) && existingImport.id === incomingOpId;

export const sendSyncImportExistsReply = (
  reply: FastifyReply,
  userId: number,
  clientId: string,
  existingImport: ExistingSyncImport,
): FastifyReply => {
  Logger.warn(
    `[user:${userId}] Rejecting duplicate SYNC_IMPORT from client ${clientId}. ` +
      `Existing import from client ${existingImport.clientId} (id: ${existingImport.id}). ` +
      `Client should download and merge instead.`,
  );
  return reply.status(409).send({
    error: 'SYNC_IMPORT_EXISTS',
    errorCode: 'SYNC_IMPORT_EXISTS',
    message:
      'A SYNC_IMPORT already exists. Download existing data and upload your changes as regular operations.',
    existingImportId: existingImport.id,
  });
};

/**
 * Check storage quota, recalculate if stale, and auto-cleanup if needed.
 * @returns `true` if quota is OK (caller can proceed), `false` if reply was sent with 413 error.
 */
export async function enforceStorageQuota(
  userId: number,
  storageDeltaBytes: number,
  reply: FastifyReply,
): Promise<boolean> {
  const syncService = getSyncService();
  let quotaCheck = await syncService.checkStorageQuota(userId, storageDeltaBytes);
  if (quotaCheck.allowed) return true;

  // Cache miss path only — reconcile once before resorting to destructive
  // cleanup. Safe to run the slow scan here because this branch only fires for
  // users actually near quota (rare). The DoS came from running this on every
  // upload success, not on quota misses. Also guards against pre-deploy stale
  // counters where the old code's pg_column_size SUM left an inflated value.
  Logger.info(
    `[user:${userId}] Quota cache miss (cached: ${quotaCheck.currentUsage}/${quotaCheck.quota}). Reconciling before cleanup...`,
  );
  try {
    await syncService.updateStorageUsage(userId);
    quotaCheck = await syncService.checkStorageQuota(userId, storageDeltaBytes);
    if (quotaCheck.allowed) {
      Logger.info(
        `[user:${userId}] Quota OK after reconcile: ${quotaCheck.currentUsage}/${quotaCheck.quota}`,
      );
      return true;
    }
  } catch (err) {
    Logger.warn(
      `[user:${userId}] Reconcile failed, proceeding with cleanup: ${errorMessage(err)}`,
    );
  }

  Logger.warn(
    `[user:${userId}] Storage quota exceeded: ${quotaCheck.currentUsage}/${quotaCheck.quota} bytes. Attempting auto-cleanup...`,
  );

  // Iteratively delete old data until we have enough space
  const cleanupResult = await syncService.freeStorageForUpload(userId, storageDeltaBytes);

  if (cleanupResult.success) {
    Logger.info(
      `[user:${userId}] Auto-cleanup freed ${Math.round(cleanupResult.freedBytes / 1024)}KB ` +
        `(${cleanupResult.deletedRestorePoints} restore points, ${cleanupResult.deletedOps} ops)`,
    );
    return true;
  }

  // Truly out of space - return error
  const finalQuota = await syncService.checkStorageQuota(userId, storageDeltaBytes);
  Logger.warn(
    `[user:${userId}] Storage quota still exceeded after cleanup: ${finalQuota.currentUsage}/${finalQuota.quota} bytes`,
  );
  sendQuotaExceededReply(reply, {
    storageUsedBytes: finalQuota.currentUsage,
    storageQuotaBytes: finalQuota.quota,
    autoCleanupAttempted: true,
    cleanupStats: {
      freedBytes: cleanupResult.freedBytes,
      deletedRestorePoints: cleanupResult.deletedRestorePoints,
      deletedOps: cleanupResult.deletedOps,
    },
  });
  return false;
}

export async function enforceCleanSlateStorageQuota(
  userId: number,
  finalStorageBytes: number,
  reply: FastifyReply,
): Promise<boolean> {
  const syncService = getSyncService();
  const storageInfo = await syncService.getStorageInfo(userId);
  if (finalStorageBytes <= storageInfo.storageQuotaBytes) return true;

  Logger.warn(
    `[user:${userId}] Clean-slate snapshot exceeds quota: ` +
      `${finalStorageBytes}/${storageInfo.storageQuotaBytes} bytes`,
  );
  sendQuotaExceededReply(reply, {
    storageUsedBytes: 0,
    storageQuotaBytes: storageInfo.storageQuotaBytes,
    autoCleanupAttempted: false,
  });
  return false;
}
