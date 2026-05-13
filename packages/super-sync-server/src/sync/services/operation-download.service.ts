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

const OPERATION_DOWNLOAD_SELECT = {
  id: true,
  serverSeq: true,
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
} as const;

const DOWNLOAD_TRANSACTION_TIMEOUT_MS = 60000;

type OperationDownloadResult = {
  ops: ServerOperation[];
  latestSeq: number;
  gapDetected: boolean;
  latestSnapshotSeq?: number;
  snapshotVectorClock?: VectorClock;
};

type OperationDownloadTransactionResult = OperationDownloadResult & {
  shouldComputeSnapshotVectorClock: boolean;
  snapshotAuthorClientId?: string;
};

type OperationDownloadRow = {
  id: string;
  serverSeq: number;
  clientId: string;
  actionType: string;
  opType: string;
  entityType: string;
  entityId: string | null;
  payload: unknown;
  vectorClock: unknown;
  schemaVersion: number;
  clientTimestamp: bigint;
  receivedAt: bigint;
  isPayloadEncrypted: boolean;
  syncImportReason: string | null;
};

const mapOperationRow = (row: OperationDownloadRow): ServerOperation => ({
  serverSeq: row.serverSeq,
  op: {
    id: row.id,
    clientId: row.clientId,
    actionType: row.actionType,
    opType: row.opType as Operation['opType'],
    entityType: row.entityType,
    entityId: row.entityId ?? undefined,
    payload: row.payload,
    vectorClock: row.vectorClock as VectorClock,
    schemaVersion: row.schemaVersion,
    timestamp: Number(row.clientTimestamp),
    isPayloadEncrypted: row.isPayloadEncrypted,
    syncImportReason: row.syncImportReason ?? undefined,
  },
  receivedAt: Number(row.receivedAt),
});

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
      select: OPERATION_DOWNLOAD_SELECT,
    });

    return ops.map(mapOperationRow);
  }

  /**
   * Get operations and latest sequence atomically with gap detection.
   *
   * OPTIMIZATION: When sinceSeq is before the latest full-state operation (SYNC_IMPORT,
   * BACKUP_IMPORT, REPAIR), we skip to that operation's sequence instead. This prevents
   * sending operations that will be filtered out by the client anyway, saving bandwidth
   * and processing time.
   *
   * includeSnapshotMetadata controls only the expensive vector-clock aggregate; the
   * full-state fast-forward still applies so piggyback downloads can return the
   * replacing operation without scanning superseded history.
   */
  async getOpsSinceWithSeq(
    userId: number,
    sinceSeq: number,
    excludeClient?: string,
    limit: number = 500,
    includeSnapshotMetadata: boolean = true,
  ): Promise<OperationDownloadResult> {
    const result = await prisma.$transaction(
      async (tx) => {
        const seqRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: { lastSeq: true },
        });
        const latestSeq = seqRow?.lastSeq ?? 0;

        if (latestSeq === 0) {
          const gapDetected = sinceSeq > 0;
          if (gapDetected) {
            Logger.warn(
              `[user:${userId}] Gap detected: client at sinceSeq=${sinceSeq} but server is empty (latestSeq=0)`,
            );
          }

          return {
            ops: [],
            latestSeq,
            gapDetected,
            latestSnapshotSeq: undefined,
            snapshotVectorClock: undefined,
            shouldComputeSnapshotVectorClock: false,
            snapshotAuthorClientId: undefined,
          };
        }

        // Find the latest full-state operation (SYNC_IMPORT, BACKUP_IMPORT, REPAIR)
        // These operations supersede all previous operations
        const latestFullStateOp = await tx.operation.findFirst({
          where: {
            userId,
            serverSeq: { lte: latestSeq },
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
        let shouldComputeSnapshotVectorClock = false;

        if (latestSnapshotSeq !== undefined && sinceSeq < latestSnapshotSeq) {
          // Start from one before the snapshot so it's included in results
          effectiveSinceSeq = latestSnapshotSeq - 1;
          Logger.info(
            `[user:${userId}] Optimized download: skipping from sinceSeq=${sinceSeq} to ${effectiveSinceSeq} ` +
              `(latest snapshot at seq ${latestSnapshotSeq})`,
          );

          shouldComputeSnapshotVectorClock = includeSnapshotMetadata;
        }

        const ops = await tx.operation.findMany({
          where: {
            userId,
            serverSeq: { gt: effectiveSinceSeq, lte: latestSeq },
            ...(excludeClient ? { clientId: { not: excludeClient } } : {}),
          },
          orderBy: {
            serverSeq: 'asc',
          },
          take: limit,
          select: OPERATION_DOWNLOAD_SELECT,
        });

        let minSeq: number | null = null;

        if (sinceSeq > 0 && latestSeq > 0) {
          // Get min sequence efficiently, but only when gap detection can use it.
          const minSeqAgg = await tx.operation.aggregate({
            where: { userId, serverSeq: { lte: latestSeq } },
            _min: { serverSeq: true },
          });
          minSeq = minSeqAgg._min.serverSeq ?? null;
        }

        // Gap detection logic
        let gapDetected = false;
        const gapBaselineSeq = effectiveSinceSeq;

        // Case 1: Client is ahead of server
        if (sinceSeq > latestSeq && latestSeq > 0) {
          gapDetected = true;
          Logger.warn(
            `[user:${userId}] Gap detected: client ahead sinceSeq=${sinceSeq} > latestSeq=${latestSeq}`,
          );
        }

        if (sinceSeq > 0 && latestSeq > 0) {
          // Case 2: Requested seq is purged. Compare against gapBaselineSeq
          // (= effectiveSinceSeq) so the snapshot fast-forward suppresses
          // false positives — when a snapshot supersedes the purged history,
          // the client receives the snapshot and doesn't actually miss
          // anything, so this isn't a gap.
          if (minSeq !== null && gapBaselineSeq < minSeq - 1) {
            gapDetected = true;
            Logger.warn(
              `[user:${userId}] Gap detected: baselineSeq=${gapBaselineSeq} (sinceSeq=${sinceSeq}) but minSeq=${minSeq}`,
            );
          }

          // Case 3: Gap in returned operations (use effectiveSinceSeq which accounts for snapshot skip)
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

        const mappedOps = ops.map(mapOperationRow);

        return {
          ops: mappedOps,
          latestSeq,
          gapDetected,
          latestSnapshotSeq,
          snapshotVectorClock: undefined,
          shouldComputeSnapshotVectorClock,
          snapshotAuthorClientId: latestFullStateOp?.clientId ?? undefined,
        } satisfies OperationDownloadTransactionResult;
      },
      { timeout: DOWNLOAD_TRANSACTION_TIMEOUT_MS },
    ); // Matches other sync transactions; stays below Fastify's 80s request timeout.

    let snapshotVectorClock: VectorClock | undefined;
    if (
      result.shouldComputeSnapshotVectorClock &&
      result.latestSnapshotSeq !== undefined
    ) {
      // Preserve the requesting client's ID and the snapshot author's ID from
      // pruning to avoid false EQUAL in vector-clock comparison.
      const preserveClientIds: string[] = [];
      if (excludeClient) preserveClientIds.push(excludeClient);
      if (result.snapshotAuthorClientId) {
        preserveClientIds.push(result.snapshotAuthorClientId);
      }
      snapshotVectorClock = await this._computeSnapshotVectorClock(
        userId,
        result.latestSnapshotSeq,
        preserveClientIds,
      );
    }

    return {
      ops: result.ops,
      latestSeq: result.latestSeq,
      gapDetected: result.gapDetected,
      latestSnapshotSeq: result.latestSnapshotSeq,
      snapshotVectorClock,
    };
  }

  private async _computeSnapshotVectorClock(
    userId: number,
    latestSnapshotSeq: number,
    preserveClientIds: ReadonlyArray<string>,
  ): Promise<VectorClock> {
    const startedAt = Date.now();
    // Compute aggregated vector clock from all ops up to and including the snapshot.
    // This ensures clients know about all clock entries from skipped ops.
    //
    // Why this runs outside the interactive transaction: on large histories the
    // aggregate is slow enough that holding the transaction open trips Prisma's
    // timeout and breaks follow-up reads with "Transaction already closed". The
    // query is bounded by `latestSnapshotSeq` (captured inside the transaction)
    // so newly-appended ops can't perturb the result. Background cleanup may
    // delete rows in this range between commit and this query; in the common
    // case the snapshot op's own vector_clock subsumes the contribution of the
    // deltas it replaces, so the per-client max is preserved. If cleanup races
    // and removes the snapshot row itself the result is transiently incomplete
    // and the client reconciles on the next sync cycle. The permanent fix is to
    // persist `snapshotVectorClock` at snapshot-write time (separate follow-up).
    const clockRows = await prisma.$queryRaw<
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

    let snapshotVectorClock: VectorClock = {};
    for (const row of clockRows) {
      snapshotVectorClock[row.client_id] = Number(row.max_counter);
    }

    snapshotVectorClock = limitVectorClockSize(snapshotVectorClock, [
      ...preserveClientIds,
    ]);

    const elapsedMs = Date.now() - startedAt;
    const logMessage =
      `[user:${userId}] Computed snapshotVectorClock with ` +
      `${Object.keys(snapshotVectorClock).length} entries in ${elapsedMs}ms: ` +
      `${JSON.stringify(snapshotVectorClock)}`;
    if (elapsedMs > 5000) {
      Logger.warn(logMessage);
    } else {
      Logger.info(logMessage);
    }

    return snapshotVectorClock;
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
