/**
 * SnapshotService - Handles snapshot generation and restore points
 *
 * Extracted from SyncService for better separation of concerns.
 * This service handles snapshot caching, generation, and restore points.
 *
 * CRITICAL: FIX 1.7 - Uses in-memory locks to prevent concurrent snapshot
 * generation for the same user. This prevents duplicate expensive computation.
 */
import * as zlib from 'zlib';
import { prisma, Operation as PrismaOperation } from '../../db';
import { Logger } from '../../logger';
import {
  CURRENT_SCHEMA_VERSION,
  migrateState,
  migrateOperation,
  stateNeedsMigration,
  type OperationLike,
} from '@sp/shared-schema';
import { Operation } from '../sync.types';
import { ALLOWED_ENTITY_TYPES } from './validation.service';

/**
 * Maximum operations to process during snapshot generation.
 * Prevents memory exhaustion for users with excessive operation history.
 */
const MAX_OPS_FOR_SNAPSHOT = 100000;

/**
 * Maximum compressed snapshot size in bytes (50MB).
 * Prevents storage exhaustion from excessively large snapshots.
 */
const MAX_SNAPSHOT_SIZE_BYTES = 50 * 1024 * 1024;

/**
 * Maximum decompressed snapshot size in bytes (100MB).
 * Prevents zip bombs from exhausting memory when reading cached snapshots.
 */
const MAX_SNAPSHOT_DECOMPRESSED_BYTES = 100 * 1024 * 1024;

/**
 * Maximum state size during replay (100MB).
 * Prevents memory exhaustion from malicious or corrupted data.
 */
const MAX_REPLAY_STATE_SIZE_BYTES = 100 * 1024 * 1024;

/**
 * How often to check state size during replay (every N operations).
 */
const REPLAY_SIZE_CHECK_INTERVAL = 1000;

export interface SnapshotResult {
  state: unknown;
  serverSeq: number;
  generatedAt: number;
  schemaVersion: number;
}

export interface RestorePoint {
  serverSeq: number;
  timestamp: number;
  type: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR';
  clientId: string;
  description?: string;
}

export class SnapshotService {
  /**
   * FIX 1.7: In-memory lock to prevent concurrent snapshot generation for the same user.
   * Maps userId to a Promise that resolves when generation completes.
   * Concurrent requests wait for the existing generation and reuse its result.
   */
  private snapshotGenerationLocks: Map<number, Promise<SnapshotResult>> = new Map();

  /**
   * Clear any cached state for a user (e.g., when user data is deleted).
   */
  clearForUser(userId: number): void {
    this.snapshotGenerationLocks.delete(userId);
  }

  /**
   * Get cached snapshot for a user.
   */
  async getCachedSnapshot(userId: number): Promise<SnapshotResult | null> {
    const row = await prisma.userSyncState.findUnique({
      where: { userId },
      select: {
        snapshotData: true,
        lastSnapshotSeq: true,
        snapshotAt: true,
        snapshotSchemaVersion: true,
      },
    });

    if (!row?.snapshotData) return null;

    try {
      // Decompress snapshot
      const decompressed = zlib
        .gunzipSync(row.snapshotData, {
          maxOutputLength: MAX_SNAPSHOT_DECOMPRESSED_BYTES,
        })
        .toString('utf-8');
      return {
        state: JSON.parse(decompressed),
        serverSeq: row.lastSnapshotSeq ?? 0,
        generatedAt: Number(row.snapshotAt) ?? 0,
        schemaVersion: row.snapshotSchemaVersion ?? 1,
      };
    } catch (err) {
      Logger.error(
        `[user:${userId}] Failed to decompress cached snapshot: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Cache a snapshot for a user.
   */
  async cacheSnapshot(userId: number, state: unknown, serverSeq: number): Promise<void> {
    const now = Date.now();
    // Compress snapshot
    const compressed = zlib.gzipSync(JSON.stringify(state));

    if (compressed.length > MAX_SNAPSHOT_SIZE_BYTES) {
      Logger.error(
        `[user:${userId}] Snapshot too large: ${compressed.length} bytes ` +
          `(max ${MAX_SNAPSHOT_SIZE_BYTES}). Skipping cache.`,
      );
      return;
    }

    await prisma.userSyncState.update({
      where: { userId },
      data: {
        snapshotData: compressed,
        lastSnapshotSeq: serverSeq,
        snapshotAt: BigInt(now),
        snapshotSchemaVersion: CURRENT_SCHEMA_VERSION,
      },
    });
  }

  /**
   * Generate a snapshot for a user at the latest sequence.
   * Uses FIX 1.7 lock to prevent concurrent generation for the same user.
   */
  async generateSnapshot(userId: number): Promise<SnapshotResult> {
    // FIX 1.7: Check if snapshot generation is already in progress for this user.
    // If so, wait for the existing generation and return its result.
    // This prevents duplicate expensive computation under concurrent requests.
    const existingPromise = this.snapshotGenerationLocks.get(userId);
    if (existingPromise) {
      Logger.info(`Waiting for existing snapshot generation for user ${userId}`);
      return existingPromise;
    }

    // Start new generation and store the promise
    const promise = this._generateSnapshotImpl(userId);
    this.snapshotGenerationLocks.set(userId, promise);

    try {
      return await promise;
    } finally {
      // Clean up lock when done (whether success or failure)
      this.snapshotGenerationLocks.delete(userId);
    }
  }

  /**
   * Internal implementation of snapshot generation.
   * Called only when no concurrent generation is in progress.
   */
  private async _generateSnapshotImpl(userId: number): Promise<SnapshotResult> {
    // Transaction for consistent view
    return prisma.$transaction(
      async (tx) => {
        // Get latest seq in this transaction
        const seqRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: { lastSeq: true },
        });
        const latestSeq = seqRow?.lastSeq ?? 0;

        let state: Record<string, unknown> = {};
        let startSeq = 0;
        let snapshotSchemaVersion = CURRENT_SCHEMA_VERSION;

        // Try to get cached snapshot (need to fetch it inside tx for consistency?
        // Actually, we can fetch it. If it's old, we just replay more ops.)
        // Re-implementing getCachedSnapshot logic inside tx
        const cachedRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: {
            snapshotData: true,
            lastSnapshotSeq: true,
            snapshotAt: true,
            snapshotSchemaVersion: true,
          },
        });

        if (cachedRow?.snapshotData) {
          try {
            const decompressed = zlib
              .gunzipSync(cachedRow.snapshotData, {
                maxOutputLength: MAX_SNAPSHOT_DECOMPRESSED_BYTES,
              })
              .toString('utf-8');
            state = JSON.parse(decompressed) as Record<string, unknown>;
            startSeq = cachedRow.lastSnapshotSeq ?? 0;
            snapshotSchemaVersion = cachedRow.snapshotSchemaVersion ?? 1;
          } catch (err) {
            // Ignore corrupted cache
          }
        }

        if (
          startSeq >= latestSeq &&
          cachedRow?.snapshotData &&
          snapshotSchemaVersion === CURRENT_SCHEMA_VERSION
        ) {
          return {
            state,
            serverSeq: startSeq,
            generatedAt: Date.now(),
            schemaVersion: CURRENT_SCHEMA_VERSION,
          };
        }

        // Migrate snapshot if needed
        if (stateNeedsMigration(snapshotSchemaVersion, CURRENT_SCHEMA_VERSION)) {
          Logger.info(
            `[user:${userId}] Migrating snapshot from v${snapshotSchemaVersion} to v${CURRENT_SCHEMA_VERSION}`,
          );
          const migrationResult = migrateState(
            state,
            snapshotSchemaVersion,
            CURRENT_SCHEMA_VERSION,
          );
          if (!migrationResult.success) {
            throw new Error(`Snapshot migration failed: ${migrationResult.error}`);
          }
          state = migrationResult.data as Record<string, unknown>;
          snapshotSchemaVersion = CURRENT_SCHEMA_VERSION;
        }

        const totalOpsToProcess = latestSeq - startSeq;
        if (totalOpsToProcess > MAX_OPS_FOR_SNAPSHOT) {
          throw new Error(
            `Too many operations to process (${totalOpsToProcess}). ` +
              `Max: ${MAX_OPS_FOR_SNAPSHOT}.`,
          );
        }

        const BATCH_SIZE = 10000;
        let currentSeq = startSeq;
        let totalProcessed = 0;

        while (currentSeq < latestSeq) {
          const batchOps = await tx.operation.findMany({
            where: {
              userId,
              serverSeq: { gt: currentSeq },
            },
            orderBy: { serverSeq: 'asc' },
            take: BATCH_SIZE,
          });

          if (batchOps.length === 0) break;

          // Replay ops
          state = this.replayOpsToState(batchOps, state);

          currentSeq = batchOps[batchOps.length - 1].serverSeq;
          totalProcessed += batchOps.length;

          if (totalProcessed > MAX_OPS_FOR_SNAPSHOT) break;
        }

        const generatedAt = Date.now();

        // Update cache (we can do this async/outside, but doing it inside ensures it matches the returned state)
        // However, we are in a read-only-ish flow, but we can write to cache.
        // We'll call the update directly on tx.
        // Re-implementing cacheSnapshot logic for tx
        const compressed = zlib.gzipSync(JSON.stringify(state));
        if (compressed.length <= MAX_SNAPSHOT_SIZE_BYTES) {
          await tx.userSyncState.update({
            where: { userId },
            data: {
              snapshotData: compressed,
              lastSnapshotSeq: latestSeq,
              snapshotAt: BigInt(generatedAt),
              snapshotSchemaVersion: CURRENT_SCHEMA_VERSION,
            },
          });
        }

        return {
          state,
          serverSeq: latestSeq,
          generatedAt,
          schemaVersion: CURRENT_SCHEMA_VERSION,
        };
      },
      {
        timeout: 60000, // Snapshots can take time
      },
    );
  }

  /**
   * Get available restore points for a user.
   * Returns significant state-change operations (SYNC_IMPORT, BACKUP_IMPORT, REPAIR)
   * which represent complete snapshots of the application state.
   */
  async getRestorePoints(userId: number, limit: number = 30): Promise<RestorePoint[]> {
    // Query for full-state operations only
    const ops = await prisma.operation.findMany({
      where: {
        userId,
        opType: {
          in: ['SYNC_IMPORT', 'BACKUP_IMPORT', 'REPAIR'],
        },
      },
      orderBy: {
        serverSeq: 'desc',
      },
      take: limit,
      select: {
        serverSeq: true,
        clientId: true,
        opType: true,
        clientTimestamp: true,
      },
    });

    return ops.map((op) => ({
      serverSeq: op.serverSeq,
      timestamp: Number(op.clientTimestamp),
      type: op.opType as 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR',
      clientId: op.clientId,
      description: this._getRestorePointDescription(
        op.opType as 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR',
      ),
    }));
  }

  private _getRestorePointDescription(
    opType: 'SYNC_IMPORT' | 'BACKUP_IMPORT' | 'REPAIR',
  ): string {
    switch (opType) {
      case 'SYNC_IMPORT':
        return 'Full sync import';
      case 'BACKUP_IMPORT':
        return 'Backup restore';
      case 'REPAIR':
        return 'Auto-repair';
      default:
        return 'State snapshot';
    }
  }

  /**
   * Generate a snapshot at a specific serverSeq.
   * Replays operations from the beginning (or cached snapshot) up to targetSeq.
   */
  async generateSnapshotAtSeq(
    userId: number,
    targetSeq: number,
  ): Promise<{
    state: unknown;
    serverSeq: number;
    generatedAt: number;
  }> {
    return prisma.$transaction(
      async (tx) => {
        // Verify targetSeq is valid
        const maxSeqRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: { lastSeq: true },
        });
        const maxSeq = maxSeqRow?.lastSeq ?? 0;

        if (targetSeq > maxSeq) {
          throw new Error(
            `Target sequence ${targetSeq} exceeds latest sequence ${maxSeq}`,
          );
        }

        if (targetSeq < 1) {
          throw new Error('Target sequence must be at least 1');
        }

        let state: Record<string, unknown> = {};
        let startSeq = 0;

        // Try to use cached snapshot as base if it's before targetSeq
        const cachedRow = await tx.userSyncState.findUnique({
          where: { userId },
          select: {
            snapshotData: true,
            lastSnapshotSeq: true,
            snapshotSchemaVersion: true,
          },
        });

        if (
          cachedRow?.snapshotData &&
          cachedRow.lastSnapshotSeq &&
          cachedRow.lastSnapshotSeq <= targetSeq
        ) {
          try {
            const decompressed = zlib
              .gunzipSync(cachedRow.snapshotData, {
                maxOutputLength: MAX_SNAPSHOT_DECOMPRESSED_BYTES,
              })
              .toString('utf-8');
            state = JSON.parse(decompressed) as Record<string, unknown>;
            startSeq = cachedRow.lastSnapshotSeq;

            // Migrate if needed
            const snapshotSchemaVersion = cachedRow.snapshotSchemaVersion ?? 1;
            if (stateNeedsMigration(snapshotSchemaVersion, CURRENT_SCHEMA_VERSION)) {
              const migrationResult = migrateState(
                state,
                snapshotSchemaVersion,
                CURRENT_SCHEMA_VERSION,
              );
              if (migrationResult.success) {
                state = migrationResult.data as Record<string, unknown>;
              }
            }
          } catch (err) {
            // Ignore corrupted cache, start from scratch
            Logger.warn(
              `[user:${userId}] Failed to use cached snapshot: ${(err as Error).message}`,
            );
          }
        }

        const totalOpsToProcess = targetSeq - startSeq;
        if (totalOpsToProcess > MAX_OPS_FOR_SNAPSHOT) {
          throw new Error(
            `Too many operations to process (${totalOpsToProcess}). ` +
              `Max: ${MAX_OPS_FOR_SNAPSHOT}.`,
          );
        }

        // Check for encrypted ops in the range - server cannot replay encrypted payloads
        const encryptedOpCount = await tx.operation.count({
          where: {
            userId,
            serverSeq: { gt: startSeq, lte: targetSeq },
            isPayloadEncrypted: true,
          },
        });

        if (encryptedOpCount > 0) {
          throw new Error(
            `ENCRYPTED_OPS_NOT_SUPPORTED: Cannot generate snapshot - ${encryptedOpCount} operations have encrypted payloads. ` +
              `Server-side restore is not available when E2E encryption is enabled. ` +
              `Alternative: Use the client app's "Sync Now" button which can decrypt and restore locally.`,
          );
        }

        // Replay ops from startSeq to targetSeq
        const BATCH_SIZE = 10000;
        let currentSeq = startSeq;

        while (currentSeq < targetSeq) {
          const batchOps = await tx.operation.findMany({
            where: {
              userId,
              serverSeq: { gt: currentSeq, lte: targetSeq },
            },
            orderBy: { serverSeq: 'asc' },
            take: BATCH_SIZE,
          });

          if (batchOps.length === 0) break;

          state = this.replayOpsToState(batchOps, state);
          currentSeq = batchOps[batchOps.length - 1].serverSeq;
        }

        return {
          state,
          serverSeq: targetSeq,
          generatedAt: Date.now(),
        };
      },
      {
        timeout: 60000, // Snapshot generation can take time
      },
    );
  }

  /**
   * Replay operations to build state.
   * Used internally by snapshot generation methods.
   */
  replayOpsToState(
    ops: PrismaOperation[],
    initialState: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const state = { ...(initialState as Record<string, Record<string, unknown>>) };

    for (let i = 0; i < ops.length; i++) {
      const row = ops[i];

      // Skip encrypted operations - server cannot decrypt E2E encrypted payloads
      // This is a defensive check; generateSnapshotAtSeq should reject encrypted ops upfront
      if (row.isPayloadEncrypted) {
        Logger.warn(
          `[replayOpsToState] Skipping encrypted op ${row.id} (seq=${row.serverSeq})`,
        );
        continue;
      }

      // Periodically check state size to prevent memory exhaustion
      if (i > 0 && i % REPLAY_SIZE_CHECK_INTERVAL === 0) {
        const estimatedSize = JSON.stringify(state).length;
        if (estimatedSize > MAX_REPLAY_STATE_SIZE_BYTES) {
          throw new Error(
            `State too large during replay: ${Math.round(estimatedSize / 1024 / 1024)}MB ` +
              `(max: ${Math.round(MAX_REPLAY_STATE_SIZE_BYTES / 1024 / 1024)}MB)`,
          );
        }
      }

      let opType = row.opType as Operation['opType'];
      let entityType = row.entityType;
      let entityId = row.entityId;
      let payload = row.payload;

      const opSchemaVersion = row.schemaVersion ?? 1;

      // Prepare list of operations to process (may be expanded by migration)
      let opsToProcess: Array<{
        opType: string;
        entityType: string;
        entityId: string | null;
        payload: unknown;
      }> = [{ opType, entityType, entityId, payload }];

      if (opSchemaVersion < CURRENT_SCHEMA_VERSION) {
        const opLike: OperationLike = {
          id: row.id,
          opType,
          entityType,
          entityId: entityId ?? undefined,
          payload,
          schemaVersion: opSchemaVersion,
        };

        const migrationResult = migrateOperation(opLike, CURRENT_SCHEMA_VERSION);
        if (!migrationResult.success) {
          continue;
        }
        const migratedOp = migrationResult.data;
        if (!migratedOp) continue;

        // Handle array result (operation was split into multiple)
        if (Array.isArray(migratedOp)) {
          opsToProcess = migratedOp.map((op) => ({
            opType: op.opType,
            entityType: op.entityType,
            entityId: op.entityId ?? null,
            payload: op.payload,
          }));
        } else {
          opsToProcess = [
            {
              opType: migratedOp.opType,
              entityType: migratedOp.entityType,
              entityId: migratedOp.entityId ?? null,
              payload: migratedOp.payload,
            },
          ];
        }
      }

      // Process all operations (original or migrated)
      for (const opToProcess of opsToProcess) {
        const {
          opType: processOpType,
          entityType: processEntityType,
          entityId: processEntityId,
          payload: processPayload,
        } = opToProcess;

        // Handle full-state operations BEFORE entity type check
        // These operations replace the entire state and don't use a specific entity type
        if (
          processOpType === 'SYNC_IMPORT' ||
          processOpType === 'BACKUP_IMPORT' ||
          processOpType === 'REPAIR'
        ) {
          if (
            processPayload &&
            typeof processPayload === 'object' &&
            'appDataComplete' in processPayload
          ) {
            Object.assign(
              state,
              (processPayload as { appDataComplete: unknown }).appDataComplete,
            );
          } else {
            Object.assign(state, processPayload);
          }
          continue;
        }

        if (!ALLOWED_ENTITY_TYPES.has(processEntityType)) continue;

        if (!state[processEntityType]) {
          state[processEntityType] = {};
        }

        switch (processOpType) {
          case 'CRT':
          case 'UPD':
            if (processEntityId) {
              state[processEntityType][processEntityId] = {
                ...(state[processEntityType][processEntityId] as Record<string, unknown>),
                ...(processPayload as Record<string, unknown>),
              };
            }
            break;
          case 'DEL':
            if (processEntityId) {
              delete state[processEntityType][processEntityId];
            }
            break;
          case 'MOV':
            if (processEntityId && processPayload) {
              state[processEntityType][processEntityId] = {
                ...(state[processEntityType][processEntityId] as Record<string, unknown>),
                ...(processPayload as Record<string, unknown>),
              };
            }
            break;
          case 'BATCH':
            if (processPayload && typeof processPayload === 'object') {
              const batchPayload = processPayload as Record<string, unknown>;
              if (batchPayload.entities && typeof batchPayload.entities === 'object') {
                const entities = batchPayload.entities as Record<string, unknown>;
                for (const [id, entity] of Object.entries(entities)) {
                  state[processEntityType][id] = {
                    ...(state[processEntityType][id] as Record<string, unknown>),
                    ...(entity as Record<string, unknown>),
                  };
                }
              } else if (processEntityId) {
                state[processEntityType][processEntityId] = {
                  ...(state[processEntityType][processEntityId] as Record<
                    string,
                    unknown
                  >),
                  ...batchPayload,
                };
              }
            }
            break;
        }
      }
    }
    return state;
  }
}
