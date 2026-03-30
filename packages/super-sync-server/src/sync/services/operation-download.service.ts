/**
 * OperationDownloadService - Handles downloading operations for clients
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles operation retrieval with gap detection and snapshot optimization.
 */
import { prisma } from '../../db';
import {
  Operation,
  ServerOperation,
  VectorClock,
  limitVectorClockSize,
} from '../sync.types';
import { Logger } from '../../logger';

export class OperationDownloadService {
  /**
   * Get operations since a given sequence number.
   * Simple version without gap detection.
   */
  async getOpsSince(
    userId: number,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
  ): Promise<ServerOperation[]> {
    const ops = await prisma.operation.findMany({
      where: {
        userId,
        serverSeq: { gt: sinceSeq },
        ...(excludeClient ? { clientId: { not: excludeClient } } : {}),
      },
      orderBy: {
        serverSeq: 'asc',
      },
      take: limit,
    });

    return ops.map((row) => ({
      serverSeq: row.serverSeq,
      op: {
        id: row.id,
        clientId: row.clientId,
        actionType: row.actionType,
        opType: row.opType as Operation['opType'],
        entityType: row.entityType,
        entityId: row.entityId ?? undefined,
        payload: row.payload,
        vectorClock: row.vectorClock as unknown as VectorClock,
        schemaVersion: row.schemaVersion,
        timestamp: Number(row.clientTimestamp),
        isPayloadEncrypted: row.isPayloadEncrypted,
        syncImportReason: row.syncImportReason ?? undefined,
      },
      receivedAt: Number(row.receivedAt),
    }));
  }

  /**
   * Get operations and latest sequence atomically with gap detection.
   *
   * OPTIMIZATION: When sinceSeq is before the latest full-state operation (SYNC_IMPORT,
   * BACKUP_IMPORT, REPAIR), we skip to that operation's sequence instead. This prevents
   * sending operations that will be filtered out by the client anyway, saving bandwidth
   * and processing time.
   */
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
    return prisma.$transaction(
      async (tx) => {
        // Find the latest full-state operation (SYNC_IMPORT, BACKUP_IMPORT, REPAIR)
        // These operations supersede all previous operations
        const latestFullStateOp = await tx.operation.findFirst({
          where: {
            userId,
            opType: { in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'] },
          },
          orderBy: { serverSeq: 'desc' },
          select: { serverSeq: true, clientId: true },
        });

        const latestSnapshotSeq = latestFullStateOp?.serverSeq ?? undefined;

        // OPTIMIZATION: If client is requesting ops from before the latest full-state op,
        // start from the full-state op instead. Pre-import ops are superseded and will
        // be filtered out by the client anyway.
        let effectiveSinceSeq = sinceSeq;
        let snapshotVectorClock: VectorClock | undefined;

        if (latestSnapshotSeq !== undefined && sinceSeq < latestSnapshotSeq) {
          // Start from one before the snapshot so it's included in results
          effectiveSinceSeq = latestSnapshotSeq - 1;
          Logger.info(
            `[user:${userId}] Optimized download: skipping from sinceSeq=${sinceSeq} to ${effectiveSinceSeq} ` +
              `(latest snapshot at seq ${latestSnapshotSeq})`,
          );

          // Compute aggregated vector clock from all ops up to and including the snapshot.
          // This ensures clients know about all clock entries from skipped ops.
          // Uses a SQL aggregate to avoid loading all individual ops' clocks into memory —
          // the aggregation happens in PostgreSQL, returning only the final per-client max.
          const clockRows = await tx.$queryRaw<
            Array<{ client_id: string; max_counter: bigint }>
          >`
            SELECT kv.key AS client_id, MAX(kv.value::bigint) AS max_counter
            FROM operations, LATERAL jsonb_each_text(vector_clock) AS kv(key, value)
            WHERE user_id = ${userId}
              AND server_seq <= ${latestSnapshotSeq}
              AND jsonb_typeof(vector_clock) = 'object'
              AND kv.value ~ '^[0-9]+$'
            GROUP BY kv.key
          `;

          snapshotVectorClock = {};
          for (const row of clockRows) {
            snapshotVectorClock[row.client_id] = Number(row.max_counter);
          }

          // Limit snapshot clock to MAX_VECTOR_CLOCK_SIZE to prevent oversized
          // clocks from being sent to clients. Preserve the requesting client's ID
          // and the snapshot author's ID to avoid false EQUAL in comparison.
          const preserveIds: string[] = [];
          if (excludeClient) preserveIds.push(excludeClient);
          if (latestFullStateOp?.clientId) preserveIds.push(latestFullStateOp.clientId);
          snapshotVectorClock = limitVectorClockSize(snapshotVectorClock, preserveIds);

          Logger.info(
            `[user:${userId}] Computed snapshotVectorClock with ${Object.keys(snapshotVectorClock).length} entries: ${JSON.stringify(snapshotVectorClock)}`,
          );
        }

        const ops = await tx.operation.findMany({
          where: {
            userId,
            serverSeq: { gt: effectiveSinceSeq },
            ...(excludeClient ? { clientId: { not: excludeClient } } : {}),
          },
          orderBy: {
            serverSeq: 'asc',
          },
          take: limit,
        });

        const seqRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: { lastSeq: true },
        });

        // Get min sequence efficiently
        const minSeqAgg = await tx.operation.aggregate({
          where: { userId },
          _min: { serverSeq: true },
        });

        const latestSeq = seqRow?.lastSeq ?? 0;
        const minSeq = minSeqAgg._min.serverSeq ?? null;

        // Gap detection logic
        let gapDetected = false;

        // Case 1: Client has history but server is empty
        if (sinceSeq > 0 && latestSeq === 0) {
          gapDetected = true;
          Logger.warn(
            `[user:${userId}] Gap detected: client at sinceSeq=${sinceSeq} but server is empty (latestSeq=0)`,
          );
        }

        // Case 2: Client is ahead of server
        if (sinceSeq > latestSeq && latestSeq > 0) {
          gapDetected = true;
          Logger.warn(
            `[user:${userId}] Gap detected: client ahead sinceSeq=${sinceSeq} > latestSeq=${latestSeq}`,
          );
        }

        if (sinceSeq > 0 && latestSeq > 0) {
          // Case 3: Requested seq is purged
          if (minSeq !== null && sinceSeq < minSeq - 1) {
            gapDetected = true;
            Logger.warn(
              `[user:${userId}] Gap detected: sinceSeq=${sinceSeq} but minSeq=${minSeq}`,
            );
          }

          // Case 4: Gap in returned operations (use effectiveSinceSeq which accounts for snapshot skip)
          if (
            !excludeClient &&
            ops.length > 0 &&
            ops[0].serverSeq > effectiveSinceSeq + 1
          ) {
            gapDetected = true;
            Logger.warn(
              `[user:${userId}] Gap detected: expected seq ${effectiveSinceSeq + 1} but got ${ops[0].serverSeq}`,
            );
          }
        }

        const mappedOps = ops.map((row) => ({
          serverSeq: row.serverSeq,
          op: {
            id: row.id,
            clientId: row.clientId,
            actionType: row.actionType,
            opType: row.opType as Operation['opType'],
            entityType: row.entityType,
            entityId: row.entityId ?? undefined,
            payload: row.payload,
            vectorClock: row.vectorClock as unknown as VectorClock,
            schemaVersion: row.schemaVersion,
            timestamp: Number(row.clientTimestamp),
            isPayloadEncrypted: row.isPayloadEncrypted,
            syncImportReason: row.syncImportReason ?? undefined,
          },
          receivedAt: Number(row.receivedAt),
        }));

        return {
          ops: mappedOps,
          latestSeq,
          gapDetected,
          latestSnapshotSeq,
          snapshotVectorClock,
        };
      },
      { timeout: 30000 },
    ); // 30s - consistent with other sync transactions
  }

  /**
   * Get the latest sequence number for a user.
   */
  async getLatestSeq(userId: number): Promise<number> {
    const row = await prisma.userSyncState.findUnique({
      where: { userId },
      select: { lastSeq: true },
    });
    return row?.lastSeq ?? 0;
  }
}
