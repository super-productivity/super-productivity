import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { uuidv7 } from 'uuidv7';
import { Prisma } from '@prisma/client';
import {
  getEntityConflictKey,
  prefetchLatestEntityOpsForBatch,
} from '../src/sync/conflict';
import { CONFLICT_DETECTION_ENTITY_BATCH_SIZE } from '../src/sync/sync.types';
import { testState, resetTestState } from './sync.service.test-state';

// Mock the database module with Prisma mocks
vi.mock('../src/db', async () => {
  // Import testState from separate module to avoid circular import
  const {
    applyOperationSelect,
    hasOperationUniqueConflict,
    isEntityArrayBranchQuery,
    entityArrayBranchRows,
    testState: state,
  } = await import('./sync.service.test-state');
  const { Prisma: PrismaModule } = await import('@prisma/client');

  type OperationWhereAlternative = {
    opType?: string | { in?: string[] };
    repairBaseServerSeq?: null | { not: null };
  };
  const matchesOperationAlternative = (
    opType: string,
    repairBaseServerSeq: number | null | undefined,
    alternative: OperationWhereAlternative,
  ): boolean => {
    if (typeof alternative.opType === 'string' && opType !== alternative.opType) {
      return false;
    }
    if (alternative.opType?.in && !alternative.opType.in.includes(opType)) {
      return false;
    }
    if (alternative.repairBaseServerSeq === null && repairBaseServerSeq != null) {
      return false;
    }
    if (alternative.repairBaseServerSeq?.not === null && repairBaseServerSeq == null) {
      return false;
    }
    return true;
  };

  const createTxMock = () => ({
    operation: {
      create: vi.fn().mockImplementation(async (args: any) => {
        // Check for duplicate ID (unique constraint)
        if (state.operations.has(args.data.id)) {
          throw new PrismaModule.PrismaClientKnownRequestError(
            'Unique constraint failed',
            { code: 'P2002', clientVersion: '5.0.0' },
          );
        }
        state.serverSeqCounter++;
        const op = {
          ...args.data,
          serverSeq: state.serverSeqCounter,
          receivedAt: BigInt(Date.now()),
        };
        state.operations.set(args.data.id, op);
        return op;
      }),
      createMany: vi.fn().mockImplementation(async (args: any) => {
        const rows = Array.isArray(args.data) ? args.data : [args.data];
        let count = 0;

        for (const row of rows) {
          if (hasOperationUniqueConflict(state.operations, row)) {
            if (args.skipDuplicates) {
              continue;
            }
            throw new PrismaModule.PrismaClientKnownRequestError(
              'Unique constraint failed',
              { code: 'P2002', clientVersion: '5.0.0' },
            );
          }

          state.operations.set(row.id, {
            ...row,
            receivedAt: row.receivedAt ?? BigInt(Date.now()),
          });
          count++;
        }

        return { count };
      }),
      findFirst: vi.fn().mockImplementation(async (args: any) => {
        // Shape of the full-state author query — counted so tests can pin that it
        // stays one-per-upload rather than one-per-op. Selecting clientId ALONE is
        // what separates it from the entity-conflict lookup, which also filters on
        // OR + orders by serverSeq but selects the whole row.
        if (
          Array.isArray(args.where?.OR) &&
          args.where?.entityType === undefined &&
          args.orderBy?.serverSeq === 'desc' &&
          args.select?.clientId === true &&
          Object.keys(args.select).length === 1
        ) {
          state.fullStateAuthorLookupCount++;
        }
        if (args.where?.id) {
          return (
            applyOperationSelect(state.operations.get(args.where.id), args.select) || null
          );
        }
        if (args.where?.opType?.in) {
          const ops = Array.from(state.operations.values())
            .filter((op: any) => args.where.userId === op.userId)
            .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
          for (const op of ops) {
            if (args.where.opType.in.includes(op.opType)) {
              if (args.where.serverSeq?.lte !== undefined) {
                if (op.serverSeq <= args.where.serverSeq.lte) {
                  return applyOperationSelect(op, args.select);
                }
              } else {
                return applyOperationSelect(op, args.select);
              }
            }
          }
        }
        if (
          Array.isArray(args.where?.OR) &&
          args.where.OR.some(
            (alternative: OperationWhereAlternative) => alternative.opType !== undefined,
          )
        ) {
          const ops = Array.from(state.operations.values())
            .filter(
              (op: any) =>
                args.where.userId === op.userId &&
                (args.where.serverSeq?.lte === undefined ||
                  op.serverSeq <= args.where.serverSeq.lte) &&
                (typeof args.where.serverSeq !== 'number' ||
                  op.serverSeq === args.where.serverSeq) &&
                args.where.OR.some((alternative: OperationWhereAlternative) =>
                  matchesOperationAlternative(
                    op.opType,
                    op.repairBaseServerSeq,
                    alternative,
                  ),
                ),
            )
            .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
          return applyOperationSelect(ops[0], args.select) || null;
        }
        // Scalar branch of the single-entity conflict lookup. The entity_ids half is
        // a separate $queryRaw call; the two were one OR + ORDER BY ... LIMIT 1
        // until that degenerated into a full history scan in production (see the
        // PERF note in conflict.ts detectConflictForEntity).
        if (args.where?.entityId && args.where?.entityType) {
          const ops = Array.from(state.operations.values())
            .filter(
              (op: any) =>
                op.userId === args.where.userId &&
                op.entityId === args.where.entityId &&
                op.entityType === args.where.entityType &&
                (args.where.clientId?.not === undefined ||
                  op.clientId !== args.where.clientId.not),
            )
            .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
          return applyOperationSelect(ops[0], args.select) || null;
        }
        return null;
      }),
      findMany: vi.fn().mockImplementation(async (args: any) => {
        const ops = Array.from(state.operations.values());
        return ops
          .filter((op: any) => {
            if (args.where?.userId !== undefined && args.where.userId !== op.userId)
              return false;
            if (args.where?.id?.in && !args.where.id.in.includes(op.id)) return false;
            if (
              args.where?.serverSeq?.gt !== undefined &&
              op.serverSeq <= args.where.serverSeq.gt
            )
              return false;
            if (
              args.where?.serverSeq?.lte !== undefined &&
              op.serverSeq > args.where.serverSeq.lte
            )
              return false;
            if (
              args.where?.serverSeq?.lt !== undefined &&
              op.serverSeq >= args.where.serverSeq.lt
            )
              return false;
            if (args.where?.clientId?.not && op.clientId === args.where.clientId.not)
              return false;
            if (args.where?.opType?.in && !args.where.opType.in.includes(op.opType))
              return false;
            if (
              Array.isArray(args.where?.OR) &&
              !args.where.OR.some((alternative: OperationWhereAlternative) =>
                matchesOperationAlternative(
                  op.opType,
                  op.repairBaseServerSeq,
                  alternative,
                ),
              )
            )
              return false;
            return true;
          })
          .sort((a: any, b: any) => {
            if (args.orderBy?.serverSeq === 'desc') return b.serverSeq - a.serverSeq;
            return a.serverSeq - b.serverSeq;
          })
          .slice(0, args.take || 500);
      }),
      aggregate: vi.fn().mockImplementation(async (args: any) => {
        const ops = Array.from(state.operations.values()).filter(
          (op: any) => args.where?.userId === op.userId,
        );
        if (ops.length === 0)
          return { _min: { serverSeq: null }, _max: { serverSeq: null } };
        const seqs = ops.map((op: any) => op.serverSeq);
        return {
          _min: { serverSeq: Math.min(...seqs) },
          _max: { serverSeq: Math.max(...seqs) },
        };
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let deleted = 0;
        for (const [id, op] of state.operations) {
          let shouldDelete = true;
          if (args.where?.userId !== undefined && op.userId !== args.where.userId)
            shouldDelete = false;
          if (args.where?.id?.in && !args.where.id.in.includes(op.id))
            shouldDelete = false;
          if (
            args.where?.receivedAt?.lt !== undefined &&
            op.receivedAt >= args.where.receivedAt.lt
          )
            shouldDelete = false;
          if (shouldDelete) {
            state.operations.delete(id);
            deleted++;
          }
        }
        return { count: deleted };
      }),
      count: vi.fn().mockImplementation(async (args: any) => {
        let count = 0;
        for (const op of state.operations.values()) {
          let matches = true;
          if (args.where?.userId !== undefined && op.userId !== args.where.userId)
            matches = false;
          if (
            args.where?.serverSeq?.gt !== undefined &&
            op.serverSeq <= args.where.serverSeq.gt
          )
            matches = false;
          if (
            args.where?.serverSeq?.lte !== undefined &&
            op.serverSeq > args.where.serverSeq.lte
          )
            matches = false;
          if (args.where?.isPayloadEncrypted && !op.isPayloadEncrypted) matches = false;
          if (typeof args.where?.opType === 'string' && op.opType !== args.where.opType)
            matches = false;
          if (args.where?.repairBaseServerSeq === null && op.repairBaseServerSeq != null)
            matches = false;
          if (
            args.where?.repairBaseServerSeq?.not === null &&
            op.repairBaseServerSeq == null
          )
            matches = false;
          if (matches) count++;
        }
        return count;
      }),
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        // (user_id, server_seq) compound unique — fetches the conflict lookup's
        // array-branch winner once its max serverSeq is known.
        const compound = args.where?.userId_serverSeq;
        if (compound) {
          const match = Array.from(state.operations.values()).find(
            (op: any) =>
              op.userId === compound.userId && op.serverSeq === compound.serverSeq,
          );
          return applyOperationSelect(match, args.select) || null;
        }
        if (args.where?.id) {
          return (
            applyOperationSelect(state.operations.get(args.where.id), args.select) || null
          );
        }
        return null;
      }),
    },
    userSyncState: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        return state.userSyncStates.get(args.where.userId) || null;
      }),
      upsert: vi.fn().mockImplementation(async (args: any) => {
        const existing = state.userSyncStates.get(args.where.userId);
        const result = existing
          ? { ...existing, ...args.update }
          : { userId: args.where.userId, ...args.create };
        state.userSyncStates.set(args.where.userId, result);
        return result;
      }),
      update: vi.fn().mockImplementation(async (args: any) => {
        const existing = state.userSyncStates.get(args.where.userId);
        if (existing) {
          const updated = { ...existing };
          // Handle Prisma increment syntax
          for (const [key, value] of Object.entries(args.data)) {
            if (typeof value === 'object' && value !== null && 'increment' in value) {
              updated[key] =
                (existing[key] || 0) + (value as { increment: number }).increment;
            } else if (
              typeof value === 'object' &&
              value !== null &&
              'decrement' in value
            ) {
              updated[key] =
                (existing[key] || 0) - (value as { decrement: number }).decrement;
            } else {
              updated[key] = value;
            }
          }
          state.userSyncStates.set(args.where.userId, updated);
          return updated;
        }
        return null;
      }),
      findMany: vi.fn().mockImplementation(async (args: any) => {
        return Array.from(state.userSyncStates.values()).filter((s: any) => {
          if (
            args?.where?.lastSnapshotSeq?.not !== undefined &&
            s.lastSnapshotSeq == null
          )
            return false;
          if (args?.where?.snapshotAt?.not !== undefined && s.snapshotAt == null)
            return false;
          return true;
        });
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let deleted = 0;
        for (const [key, syncState] of state.userSyncStates) {
          if (
            args.where?.userId !== undefined &&
            syncState.userId === args.where.userId
          ) {
            state.userSyncStates.delete(key);
            deleted++;
          }
        }
        return { count: deleted };
      }),
      updateMany: vi.fn().mockImplementation(async (args: any) => {
        let updated = 0;
        for (const [key, syncState] of state.userSyncStates) {
          if (
            args.where?.userId !== undefined &&
            syncState.userId === args.where.userId
          ) {
            Object.assign(syncState, args.data);
            updated++;
          }
        }
        return { count: updated };
      }),
    },
    syncDevice: {
      upsert: vi.fn().mockImplementation(async (args: any) => {
        const key = `${args.where.userId_clientId.userId}:${args.where.userId_clientId.clientId}`;
        const result = {
          ...args.create,
          ...args.update,
          userId: args.where.userId_clientId.userId,
          clientId: args.where.userId_clientId.clientId,
        };
        state.syncDevices.set(key, result);
        return result;
      }),
      count: vi.fn().mockImplementation(async (args: any) => {
        let count = 0;
        for (const device of state.syncDevices.values()) {
          if (args.where?.userId !== undefined && device.userId !== args.where.userId)
            continue;
          if (args.where?.lastSeenAt?.gt !== undefined) {
            if ((device.lastSeenAt || 0) <= args.where.lastSeenAt.gt) continue;
          }
          count++;
        }
        return count;
      }),
      deleteMany: vi.fn().mockImplementation(async (args: any) => {
        let deleted = 0;
        for (const [key, device] of state.syncDevices) {
          if (
            args.where?.lastSeenAt?.lt !== undefined &&
            device.lastSeenAt < args.where.lastSeenAt.lt
          ) {
            state.syncDevices.delete(key);
            deleted++;
          }
        }
        return { count: deleted };
      }),
    },
    user: {
      findUnique: vi.fn().mockImplementation(async (args: any) => {
        return state.users.get(args.where.id) || null;
      }),
      update: vi.fn().mockResolvedValue({}),
    },
    // The upload transaction now writes the storage counter atomically via
    // $executeRaw to keep the data write and the counter delta in a single
    // commit. Mock is a no-op here — the existing spec asserts behaviour at
    // the op level and does not inspect storage_used_bytes inside this file.
    $executeRaw: vi.fn().mockResolvedValue(0),
    // Full-state op uploads aggregate prior vector clocks inside the same
    // transaction. Dispatch on SQL text so unrelated $queryRaw callers keep
    // returning their existing default shape.
    $queryRaw: vi.fn().mockImplementation(async (strings: any, ...params: any[]) => {
      const sql = Array.isArray(strings) ? strings.join('') : String(strings);
      // Array branch of the single-entity conflict lookup: MAX(server_seq) over
      // `entity_ids @> ARRAY[id]`, scoped to ONE entity — not a user-wide max
      // (see conflict.ts detectConflictForEntity).
      if (isEntityArrayBranchQuery(strings)) {
        return entityArrayBranchRows(state.operations, params);
      }
      if (sql.includes('FROM user_sync_state') && sql.includes('FOR UPDATE')) {
        const [txUserId] = params as [number];
        return [
          {
            lastSeq: state.userSyncStates.get(txUserId)?.lastSeq ?? 0,
          },
        ];
      }
      if (sql.includes('INSERT INTO user_sync_state')) {
        const [txUserId, delta] = params as [number, number];
        const existing = state.userSyncStates.get(txUserId);
        const lastSeq = (existing?.lastSeq ?? 0) + delta;
        state.userSyncStates.set(txUserId, {
          ...(existing ?? { userId: txUserId }),
          lastSeq,
        });
        state.serverSeqCounter = Math.max(state.serverSeqCounter, lastSeq);
        return [{ lastSeq }];
      }
      if (sql.includes('JOIN (VALUES')) {
        // Params are [touchedRows (VALUES join), userId, idArray, idArray]: userId
        // is the only number; the VALUES join is the first Sql fragment, whose
        // .values hold the flattened (entity_type, entity_id) touched pairs. The
        // idArray prefilter params (#8334) are not needed by the mock. (Previously
        // userId was the last param and the join the only fragment.)
        const txUserId = params.find((p: unknown) => typeof p === 'number') as number;
        const valuesParam = params.find(
          (p: unknown) =>
            !!p &&
            typeof p === 'object' &&
            Array.isArray((p as { values?: unknown[] }).values),
        ) as { values: unknown[] } | undefined;
        const touchedParams = valuesParam?.values ?? [];
        const touchedPairs = new Set<string>();
        for (let i = 0; i < touchedParams.length; i += 2) {
          touchedPairs.add(`${touchedParams[i]}\u0000${touchedParams[i + 1]}`);
        }

        const latestByEntity = new Map<string, any>();
        for (const op of state.operations.values()) {
          if (op.userId !== txUserId || !op.entityId) continue;
          const key = `${op.entityType}\u0000${op.entityId}`;
          if (!touchedPairs.has(key)) continue;
          const existing = latestByEntity.get(key);
          if (!existing || op.serverSeq > existing.serverSeq) {
            latestByEntity.set(key, op);
          }
        }

        return Array.from(latestByEntity.values()).map((op: any) => ({
          entityType: op.entityType,
          entityId: op.entityId,
          clientId: op.clientId,
          vectorClock: op.vectorClock,
          serverSeq: op.serverSeq,
        }));
      }
      if (sql.includes('jsonb_each_text(vector_clock)')) {
        const [txUserId, beforeServerSeq] = params;
        const aggregate = new Map<string, number>();
        for (const op of state.operations.values()) {
          if (op.userId !== txUserId) continue;
          if (op.serverSeq >= beforeServerSeq) continue;
          const vc = op.vectorClock;
          if (!vc || typeof vc !== 'object') continue;
          for (const [clientKey, rawVal] of Object.entries(
            vc as Record<string, unknown>,
          )) {
            if (typeof rawVal !== 'number' || !Number.isFinite(rawVal)) continue;
            const cur = aggregate.get(clientKey) ?? 0;
            if (rawVal > cur) aggregate.set(clientKey, rawVal);
          }
        }
        return Array.from(aggregate, ([client_id, max_counter]) => ({
          client_id,
          max_counter: BigInt(max_counter),
        }));
      }
      // Unrecognised raw queries must THROW, never return a plausible-looking row.
      // conflict.ts reads an unknown shape via `arrayBranchRows[0]?.maxSeq ?? null`
      // as "no array-branch match", so a tolerant default silently deletes the
      // branch under test instead of failing.
      throw new Error(`Unmocked raw query in tx: ${sql}`);
    }),
  });

  return {
    prisma: {
      $transaction: vi.fn().mockImplementation(async (callback: any) => {
        const transactionStart = {
          operations: new Map(
            Array.from(state.operations, ([id, op]) => [id, { ...op }]),
          ),
          syncDevices: new Map(
            Array.from(state.syncDevices, ([id, device]) => [id, { ...device }]),
          ),
          userSyncStates: new Map(
            Array.from(state.userSyncStates, ([id, syncState]) => [id, { ...syncState }]),
          ),
          users: new Map(Array.from(state.users, ([id, user]) => [id, { ...user }])),
          serverSeqCounter: state.serverSeqCounter,
        };
        try {
          return await callback(createTxMock());
        } catch (error) {
          state.operations = transactionStart.operations;
          state.syncDevices = transactionStart.syncDevices;
          state.userSyncStates = transactionStart.userSyncStates;
          state.users = transactionStart.users;
          state.serverSeqCounter = transactionStart.serverSeqCounter;
          throw error;
        }
      }),
      operation: {
        findFirst: vi.fn().mockImplementation(async (args: any) => {
          if (args.where?.opType?.in) {
            const ops = Array.from(state.operations.values())
              .filter((op: any) => args.where.userId === op.userId)
              .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
            for (const op of ops) {
              if (args.where.opType.in.includes(op.opType)) {
                if (args.where.serverSeq?.lte !== undefined) {
                  if (op.serverSeq <= args.where.serverSeq.lte) return op;
                } else {
                  return op;
                }
              }
            }
          }
          if (
            Array.isArray(args.where?.OR) &&
            args.where.OR.some(
              (alternative: OperationWhereAlternative) =>
                alternative.opType !== undefined,
            )
          ) {
            const ops = Array.from(state.operations.values())
              .filter(
                (op: any) =>
                  args.where.userId === op.userId &&
                  (args.where.serverSeq?.lte === undefined ||
                    op.serverSeq <= args.where.serverSeq.lte) &&
                  args.where.OR.some((alternative: OperationWhereAlternative) =>
                    matchesOperationAlternative(
                      op.opType,
                      op.repairBaseServerSeq,
                      alternative,
                    ),
                  ),
              )
              .sort((a: any, b: any) => b.serverSeq - a.serverSeq);
            return applyOperationSelect(ops[0], args.select) || null;
          }
          return null;
        }),
        findMany: vi.fn().mockImplementation(async (args: any) => {
          const ops = Array.from(state.operations.values());
          return ops
            .filter((op: any) => {
              if (args.where?.id?.in && !args.where.id.in.includes(op.id)) return false;
              if (args.where?.userId !== undefined && args.where.userId !== op.userId)
                return false;
              if (
                args.where?.serverSeq?.gt !== undefined &&
                op.serverSeq <= args.where.serverSeq.gt
              )
                return false;
              if (
                args.where?.serverSeq?.lte !== undefined &&
                op.serverSeq > args.where.serverSeq.lte
              )
                return false;
              if (
                args.where?.serverSeq?.lt !== undefined &&
                op.serverSeq >= args.where.serverSeq.lt
              )
                return false;
              if (
                args.where?.receivedAt?.lt !== undefined &&
                op.receivedAt >= args.where.receivedAt.lt
              )
                return false;
              if (args.where?.clientId?.not && op.clientId === args.where.clientId.not)
                return false;
              if (args.where?.opType?.in && !args.where.opType.in.includes(op.opType))
                return false;
              if (
                Array.isArray(args.where?.OR) &&
                !args.where.OR.some((alternative: OperationWhereAlternative) =>
                  matchesOperationAlternative(
                    op.opType,
                    op.repairBaseServerSeq,
                    alternative,
                  ),
                )
              )
                return false;
              return true;
            })
            .sort((a: any, b: any) => {
              if (args.orderBy?.serverSeq === 'desc') return b.serverSeq - a.serverSeq;
              return a.serverSeq - b.serverSeq;
            })
            .slice(0, args.take || 500)
            .map((op: any) => applyOperationSelect(op, args.select));
        }),
        aggregate: vi.fn().mockImplementation(async (args: any) => {
          const ops = Array.from(state.operations.values()).filter(
            (op: any) => args.where?.userId === op.userId,
          );
          if (ops.length === 0)
            return { _min: { serverSeq: null }, _max: { serverSeq: null } };
          const seqs = ops.map((op: any) => op.serverSeq);
          return {
            _min: { serverSeq: Math.min(...seqs) },
            _max: { serverSeq: Math.max(...seqs) },
          };
        }),
        count: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const op of state.operations.values()) {
            let matches = true;
            if (args.where?.userId !== undefined && op.userId !== args.where.userId)
              matches = false;
            if (
              args.where?.serverSeq?.gt !== undefined &&
              op.serverSeq <= args.where.serverSeq.gt
            )
              matches = false;
            if (
              args.where?.serverSeq?.lte !== undefined &&
              op.serverSeq > args.where.serverSeq.lte
            )
              matches = false;
            if (args.where?.isPayloadEncrypted && !op.isPayloadEncrypted) matches = false;
            if (typeof args.where?.opType === 'string' && op.opType !== args.where.opType)
              matches = false;
            if (
              args.where?.repairBaseServerSeq === null &&
              op.repairBaseServerSeq != null
            )
              matches = false;
            if (
              args.where?.repairBaseServerSeq?.not === null &&
              op.repairBaseServerSeq == null
            )
              matches = false;
            if (matches) count++;
          }
          return count;
        }),
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let deleted = 0;
          for (const [id, op] of state.operations) {
            let shouldDelete = true;
            if (args.where?.id?.in && !args.where.id.in.includes(id))
              shouldDelete = false;
            if (args.where?.userId !== undefined && op.userId !== args.where.userId)
              shouldDelete = false;
            if (
              args.where?.serverSeq?.lte !== undefined &&
              op.serverSeq > args.where.serverSeq.lte
            )
              shouldDelete = false;
            if (
              args.where?.receivedAt?.lt !== undefined &&
              op.receivedAt >= args.where.receivedAt.lt
            )
              shouldDelete = false;
            if (shouldDelete) {
              state.operations.delete(id);
              deleted++;
            }
          }
          return { count: deleted };
        }),
      },
      userSyncState: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return state.userSyncStates.get(args.where.userId) || null;
        }),
        upsert: vi.fn().mockImplementation(async (args: any) => {
          const existing = state.userSyncStates.get(args.where.userId);
          const result = existing
            ? { ...existing, ...args.update }
            : { userId: args.where.userId, ...args.create };
          state.userSyncStates.set(args.where.userId, result);
          return result;
        }),
        update: vi.fn().mockResolvedValue({}),
        findMany: vi.fn().mockImplementation(async (args: any) => {
          return Array.from(state.userSyncStates.values()).filter((s: any) => {
            if (
              args?.where?.lastSnapshotSeq?.not !== undefined &&
              s.lastSnapshotSeq == null
            )
              return false;
            if (args?.where?.snapshotAt?.not !== undefined && s.snapshotAt == null)
              return false;
            return true;
          });
        }),
        updateMany: vi.fn().mockImplementation(async (args: any) => {
          let updated = 0;
          for (const [, syncState] of state.userSyncStates) {
            if (
              args.where?.userId !== undefined &&
              syncState.userId === args.where.userId
            ) {
              Object.assign(syncState, args.data);
              updated++;
            }
          }
          return { count: updated };
        }),
      },
      syncDevice: {
        upsert: vi.fn().mockImplementation(async (args: any) => {
          const key = `${args.where.clientId_userId.userId}:${args.where.clientId_userId.clientId}`;
          const result = {
            ...args.create,
            ...args.update,
            userId: args.where.clientId_userId.userId,
            clientId: args.where.clientId_userId.clientId,
          };
          state.syncDevices.set(key, result);
          return result;
        }),
        count: vi.fn().mockImplementation(async (args: any) => {
          let count = 0;
          for (const device of state.syncDevices.values()) {
            if (args.where?.userId !== undefined && device.userId !== args.where.userId)
              continue;
            if (args.where?.lastSeenAt?.gt !== undefined) {
              if ((device.lastSeenAt || 0) <= args.where.lastSeenAt.gt) continue;
            }
            count++;
          }
          return count;
        }),
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          let deleted = 0;
          for (const [key, device] of state.syncDevices) {
            if (
              args.where?.lastSeenAt?.lt !== undefined &&
              device.lastSeenAt < args.where.lastSeenAt.lt
            ) {
              state.syncDevices.delete(key);
              deleted++;
            }
          }
          return { count: deleted };
        }),
      },
      user: {
        findUnique: vi.fn().mockImplementation(async (args: any) => {
          return state.users.get(args.where.id) || null;
        }),
        update: vi.fn().mockResolvedValue({}),
      },
      $queryRaw: vi.fn().mockResolvedValue([{ total: BigInt(0) }]),
      $executeRaw: vi.fn().mockResolvedValue(0),
    },
  };
});

// Mock auth module
vi.mock('../src/auth', () => ({
  verifyToken: vi
    .fn()
    .mockResolvedValue({ valid: true, userId: 1, email: 'test@test.com' }),
}));

// Import AFTER mocking
import { initSyncService, getSyncService, SyncService } from '../src/sync/sync.service';
import { DeviceService } from '../src/sync/services/device.service';
import { OperationDownloadService } from '../src/sync/services/operation-download.service';
import { Operation, DEFAULT_SYNC_CONFIG, SYNC_ERROR_CODES } from '../src/sync/sync.types';
import { prisma } from '../src/db';
import { Logger } from '../src/logger';
import { CURRENT_SCHEMA_VERSION } from '@sp/shared-schema';

describe('SyncService', () => {
  const userId = 1;
  const clientId = 'test-device-1';
  let deviceService: DeviceService;
  let operationDownloadService: OperationDownloadService;

  // Factory for the repeated Operation fixture (mirrors createOp in
  // sync-fixes.spec.ts). Override only the fields a test cares about.
  const makeOp = (overrides: Partial<Operation> = {}): Operation => ({
    id: uuidv7(),
    clientId,
    actionType: 'ADD_TASK',
    opType: 'CRT',
    entityType: 'TASK',
    entityId: 'task-1',
    payload: { title: 'Test Task' },
    vectorClock: {},
    timestamp: Date.now(),
    schemaVersion: 1,
    ...overrides,
  });

  const makeGlobalConfigOp = (overrides: Partial<Operation> = {}): Operation =>
    makeOp({
      actionType: '[GLOBAL_CONFIG] Update section',
      opType: 'UPD',
      entityType: 'GLOBAL_CONFIG',
      entityId: 'misc',
      payload: {
        sectionKey: 'misc',
        sectionCfg: { defaultProjectId: 'project-1' },
      },
      ...overrides,
    });

  beforeEach(() => {
    // Reset all test data stores
    resetTestState();

    // Add a test user
    testState.users.set(userId, {
      id: userId,
      email: 'test@test.com',
      storageQuotaBytes: BigInt(100 * 1024 * 1024),
      storageUsedBytes: BigInt(0),
    });

    vi.clearAllMocks();

    // Initialize service
    initSyncService();
    deviceService = new DeviceService();
    operationDownloadService = new OperationDownloadService();
  });

  afterEach(() => {
    delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
    delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;
  });

  describe('filterValidOpsForQuota', () => {
    it('excludes invalid schema and oversized payload siblings from quota sizing', () => {
      const service = new SyncService({ maxPayloadSizeBytes: 100 });
      const validOp = makeOp({
        id: 'valid-op',
        payload: { title: 'Fits quota' },
      });
      const invalidSchemaOp = makeOp({
        id: 'invalid-schema-op',
        schemaVersion: 101,
      });
      const oversizedInvalidOp = makeOp({
        id: 'oversized-invalid-op',
        payload: { data: 'x'.repeat(200) },
      });

      const result = service.filterValidOpsForQuota(
        [validOp, invalidSchemaOp, oversizedInvalidOp],
        clientId,
      );

      expect(result).toEqual([validOp]);
    });

    it('does not charge a later valid sibling when an invalid op reserved its ID', () => {
      const service = new SyncService();
      const invalidFirst = makeOp({
        id: 'reserved-by-invalid-op',
        entityType: 'INVALID_ENTITY_TYPE',
      });
      const laterLargeSibling = makeOp({
        id: invalidFirst.id,
        entityId: 'fresh-task',
        payload: { data: 'x'.repeat(10_000) },
      });

      expect(
        service.filterValidOpsForQuota([invalidFirst, laterLargeSibling], clientId),
      ).toEqual([]);
    });
  });

  describe('uploadOps', () => {
    it('should correctly upload operations', async () => {
      const service = getSyncService();
      const op: Operation = makeOp();

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results).toHaveLength(1);
      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBe(1);

      const latestSeq = await service.getLatestSeq(userId);
      expect(latestSeq).toBe(1);
    });

    it('preserves existing data when a clean-slate replacement fails validation', async () => {
      const service = new SyncService({ maxPayloadSizeBytes: 500 });
      const existingOp = makeOp({
        id: 'existing-before-clean-slate',
        payload: { title: 'Keep me' },
      });
      const invalidReplacement = makeOp({
        id: 'invalid-clean-slate-replacement',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
        payload: { data: 'x'.repeat(1_000) },
      });

      const initialResult = await service.uploadOps(userId, clientId, [existingOp]);
      vi.mocked(prisma.$transaction).mockClear();
      const replacementResult = await service.uploadOps(
        userId,
        clientId,
        [invalidReplacement],
        true,
      );

      expect(initialResult[0].accepted).toBe(true);
      expect(replacementResult[0]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.PAYLOAD_TOO_LARGE,
        }),
      );
      expect(testState.operations.has(existingOp.id)).toBe(true);
      expect(testState.operations.has(invalidReplacement.id)).toBe(false);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('preserves existing data when any clean-slate operation is rejected', async () => {
      const service = getSyncService();
      const existingOp = makeOp({ id: 'existing-before-rejected-clean-slate' });
      const replacement = makeOp({
        id: 'duplicate-clean-slate-replacement',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
      });
      await service.uploadOps(userId, clientId, [existingOp]);

      const results = await service.uploadOps(
        userId,
        clientId,
        [replacement, { ...replacement }],
        true,
      );

      expect(results).toHaveLength(2);
      expect(results.every(({ accepted }) => !accepted)).toBe(true);
      expect(results[1].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(testState.operations.has(existingOp.id)).toBe(true);
      expect(testState.operations.has(replacement.id)).toBe(false);
    });

    it('does not wipe existing data for an empty clean-slate upload', async () => {
      const service = getSyncService();
      const existingOp = makeOp({ id: 'existing-before-empty-clean-slate' });
      await service.uploadOps(userId, clientId, [existingOp]);

      const results = await service.uploadOps(userId, clientId, [], true);

      expect(results).toEqual([]);
      expect(testState.operations.has(existingOp.id)).toBe(true);
    });

    it('should handle multiple operations in order', async () => {
      const service = getSyncService();
      const ops: Operation[] = [
        makeOp({ entityId: 'task-1', payload: { title: 'Task 1' } }),
        makeOp({
          entityId: 'task-2',
          payload: { title: 'Task 2' },
          timestamp: Date.now() + 1,
        }),
      ];

      const results = await service.uploadOps(userId, clientId, ops);

      expect(results).toHaveLength(2);
      expect(results[0].serverSeq).toBe(1);
      expect(results[1].serverSeq).toBe(2);
    });

    it('should batch upload operations behind the rollout flag', async () => {
      const service = new SyncService({ batchUpload: true });
      const ops: Operation[] = Array.from({ length: 25 }, (_, index) =>
        makeOp({
          entityId: `task-${index}`,
          payload: { title: `Task ${index}` },
          vectorClock: { [clientId]: index + 1 },
          timestamp: Date.now() + index,
        }),
      );

      const results = await service.uploadOps(userId, clientId, ops);

      expect(results).toHaveLength(25);
      expect(results.every((result) => result.accepted)).toBe(true);
      expect(results.map((result) => result.serverSeq)).toEqual(
        Array.from({ length: 25 }, (_, index) => index + 1),
      );
      expect(testState.userSyncStates.get(userId)?.lastSeq).toBe(25);
      expect(testState.operations.size).toBe(25);
    });

    it.each([
      ['legacy serial', false],
      ['batch', true],
    ])(
      'preserves the active full-state author when pruning in the %s path',
      async (_label, batchUpload) => {
        const service = new SyncService({ batchUpload });
        const fullStateAuthor = 'import-author';
        const uploadClient = 'post-import-client';
        const fullStateOp = makeOp({
          clientId: fullStateAuthor,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          entityId: undefined,
          payload: { TASK: {} },
          vectorClock: { [fullStateAuthor]: 1 },
        });
        const oversizedDelta = makeOp({
          clientId: uploadClient,
          entityId: 'post-import-task',
          vectorClock: {
            [fullStateAuthor]: 1,
            [uploadClient]: 2,
            ...Object.fromEntries(
              Array.from({ length: 25 }, (_, index) => [
                `old-client-${index}`,
                100 + index,
              ]),
            ),
          },
          timestamp: fullStateOp.timestamp + 1,
        });
        const retryDelta = makeOp({
          ...oversizedDelta,
          vectorClock: { ...oversizedDelta.vectorClock },
        });

        expect(
          (await service.uploadOps(userId, fullStateAuthor, [fullStateOp]))[0].accepted,
        ).toBe(true);
        expect(
          (await service.uploadOps(userId, uploadClient, [oversizedDelta]))[0].accepted,
        ).toBe(true);

        const storedClock = testState.operations.get(oversizedDelta.id)?.vectorClock as
          | Record<string, number>
          | undefined;
        expect(storedClock).toBeDefined();
        expect(Object.keys(storedClock ?? {})).toHaveLength(20);
        expect(storedClock?.[fullStateAuthor]).toBe(1);
        expect(storedClock?.[uploadClient]).toBe(2);

        expect((await service.uploadOps(userId, uploadClient, [retryDelta]))[0]).toEqual(
          expect.objectContaining({
            accepted: false,
            errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
          }),
        );
      },
    );

    it.each([
      ['legacy serial', false],
      ['batch', true],
    ])(
      'looks the full-state author up at most once per upload in the %s path',
      async (_label, batchUpload) => {
        // The answer cannot change mid-transaction unless this upload itself
        // accepts a full-state op, so one oversized op must not become one query.
        const service = new SyncService({ batchUpload });
        const fullStateAuthor = 'import-author';
        const uploadClient = 'post-import-client';
        const fullStateOp = makeOp({
          clientId: fullStateAuthor,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          entityId: undefined,
          payload: { TASK: {} },
          vectorClock: { [fullStateAuthor]: 1 },
        });
        expect(
          (await service.uploadOps(userId, fullStateAuthor, [fullStateOp]))[0].accepted,
        ).toBe(true);

        const oversizedDeltas = Array.from({ length: 5 }, (_, index) =>
          makeOp({
            clientId: uploadClient,
            entityId: `post-import-task-${index}`,
            vectorClock: {
              [fullStateAuthor]: 1,
              [uploadClient]: 2 + index,
              ...Object.fromEntries(
                Array.from({ length: 25 }, (_, old) => [`old-client-${old}`, 100 + old]),
              ),
            },
            timestamp: fullStateOp.timestamp + 1 + index,
          }),
        );

        testState.fullStateAuthorLookupCount = 0;

        const results = await service.uploadOps(userId, uploadClient, oversizedDeltas);
        expect(results.every(({ accepted }) => accepted)).toBe(true);

        expect(testState.fullStateAuthorLookupCount).toBe(1);
        // The saved query must not cost the protection it exists for.
        for (const delta of oversizedDeltas) {
          const storedClock = testState.operations.get(delta.id)?.vectorClock as
            | Record<string, number>
            | undefined;
          expect(Object.keys(storedClock ?? {})).toHaveLength(20);
          expect(storedClock?.[fullStateAuthor]).toBe(1);
        }
      },
    );

    it.each([
      ['legacy serial', false],
      ['batch', true],
    ])(
      'rejects a request-start occupied ID in the %s path after its row disappears',
      async (_label, batchUpload) => {
        const service = new SyncService({ batchUpload });
        const op = makeOp({
          id: 'occupied-before-quota-cleanup',
          entityId: 'new-entity-after-cleanup',
          payload: { title: 'Must not consume unestimated storage' },
        });

        const results = await service.uploadOps(
          userId,
          clientId,
          [op],
          undefined,
          new Set([op.id]),
        );

        expect(results).toEqual([
          expect.objectContaining({
            opId: op.id,
            accepted: false,
            errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
          }),
        ]);
        expect(testState.operations.has(op.id)).toBe(false);
      },
    );

    it('rejects an intra-batch same-id collision as INVALID_OP_ID', async () => {
      const service = new SyncService({ batchUpload: true });
      const opId = uuidv7();
      const first = makeOp({
        id: opId,
        entityId: 'task-1',
        payload: { title: 'Task 1' },
        vectorClock: { [clientId]: 1 },
      });
      const sameIdDifferentContent = makeOp({
        id: opId,
        entityId: 'task-2',
        payload: { title: 'Task 2' },
        vectorClock: { [clientId]: 2 },
        timestamp: Date.now() + 1,
      });
      // Guard the premise: the two ops genuinely differ in content.
      expect(sameIdDifferentContent.id).toBe(first.id);
      expect(sameIdDifferentContent.payload).not.toEqual(first.payload);

      const results = await service.uploadOps(userId, clientId, [
        first,
        sameIdDifferentContent,
      ]);

      expect(results[0]).toEqual(
        expect.objectContaining({ accepted: true, serverSeq: 1 }),
      );
      expect(results[1]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
        }),
      );
      // No sequence gap: lastSeq advanced by exactly 1, exactly one row.
      expect(testState.userSyncStates.get(userId)?.lastSeq).toBe(1);
      expect(testState.operations.size).toBe(1);
    });

    it('preserves an exact intra-batch retry as DUPLICATE_OPERATION', async () => {
      const service = new SyncService({ batchUpload: true });
      const retry = makeOp({
        id: uuidv7(),
        entityId: 'task-1',
        entityIds: ['task-1', 'task-2'],
        vectorClock: { [clientId]: 1 },
      });

      const results = await service.uploadOps(userId, clientId, [retry, { ...retry }]);

      expect(results[0]).toEqual(
        expect.objectContaining({ accepted: true, serverSeq: 1 }),
      );
      expect(results[1]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.DUPLICATE_OPERATION,
        }),
      );
    });

    it('terminally rejects a later serial same-ID sibling when the first one conflicts', async () => {
      const service = new SyncService({ batchUpload: false });
      const otherClientId = 'other-device';
      const existing = makeOp({
        id: 'existing-op',
        clientId: otherClientId,
        entityId: 'blocked-task',
        vectorClock: { [otherClientId]: 1 },
      });
      expect(
        (await service.uploadOps(userId, otherClientId, [existing]))[0].accepted,
      ).toBe(true);

      const repeatedId = 'repeated-request-id';
      const first = makeOp({
        id: repeatedId,
        entityId: 'blocked-task',
        payload: { title: 'small' },
        vectorClock: { [clientId]: 1 },
      });
      const laterLargeSibling = makeOp({
        id: repeatedId,
        entityId: 'fresh-task',
        payload: { data: 'x'.repeat(10_000) },
        vectorClock: { [clientId]: 2 },
        timestamp: first.timestamp + 1,
      });

      const results = await service.uploadOps(userId, clientId, [
        first,
        laterLargeSibling,
      ]);

      expect(results[0]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
        }),
      );
      expect(results[1]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
        }),
      );
      expect(testState.operations.has(repeatedId)).toBe(false);
    });

    it('redacts malformed operation metadata from audit logs', async () => {
      const service = new SyncService({ batchUpload: false });
      const privateText = 'private task title that must not be logged';
      const auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => undefined);
      const malformed = makeOp({
        id: privateText,
        entityType: privateText,
      });

      const result = await service.uploadOps(userId, clientId, [malformed]);

      expect(result[0].accepted).toBe(false);
      const rejection = auditSpy.mock.calls
        .map(([entry]) => entry)
        .find((entry) => entry.event === 'OP_REJECTED');
      expect(rejection).toBeDefined();
      expect(rejection?.opId).toBe('[invalid]');
      expect(rejection?.entityType).toBe('[invalid]');
      expect(rejection?.reason).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_TYPE);
      expect(JSON.stringify(rejection)).not.toContain(privateText);
    });

    it.each([
      ['serial', false],
      ['batch', true],
    ])(
      'terminally rejects a valid %s sibling whose ID was reserved by an invalid op',
      async (_label, batchUpload) => {
        const service = new SyncService({ batchUpload });
        const invalidFirst = makeOp({
          id: 'invalid-first-shared-id',
          entityType: 'INVALID_ENTITY_TYPE',
        });
        const laterLargeSibling = makeOp({
          id: invalidFirst.id,
          entityId: 'fresh-task',
          payload: { data: 'x'.repeat(10_000) },
        });

        const results = await service.uploadOps(userId, clientId, [
          invalidFirst,
          laterLargeSibling,
        ]);

        expect(results[0]).toEqual(
          expect.objectContaining({
            accepted: false,
            errorCode: SYNC_ERROR_CODES.INVALID_ENTITY_TYPE,
          }),
        );
        expect(results[1]).toEqual(
          expect.objectContaining({
            accepted: false,
            errorCode: SYNC_ERROR_CODES.INVALID_OP_ID,
          }),
        );
        expect(testState.operations.has(invalidFirst.id)).toBe(false);
      },
    );

    it('should reject intra-batch entity conflicts in order', async () => {
      const service = new SyncService({ batchUpload: true });
      const ops: Operation[] = [
        {
          id: uuidv7(),
          clientId,
          actionType: 'UPDATE_TASK',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'First' },
          vectorClock: { [clientId]: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        {
          id: uuidv7(),
          clientId,
          actionType: 'UPDATE_TASK',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Concurrent' },
          vectorClock: { 'other-client': 1 },
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ];

      const results = await service.uploadOps(userId, clientId, ops);

      expect(results[0].accepted).toBe(true);
      expect(results[1]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
        }),
      );
      expect(testState.userSyncStates.get(userId)?.lastSeq).toBe(1);
      expect(testState.operations.size).toBe(1);
    });

    it.each([
      ['serial', false],
      ['batch', true],
    ])(
      'rejects a v2 tasks write against an already-stored raw v1 misc row in the %s path',
      async (_label, batchUpload) => {
        const legacyClientId = 'legacy-client';
        testState.userSyncStates.set(userId, { userId, lastSeq: 1 });
        testState.serverSeqCounter = 1;
        testState.operations.set('stored-legacy-misc', {
          id: 'stored-legacy-misc',
          userId,
          clientId: legacyClientId,
          serverSeq: 1,
          actionType: '[GLOBAL_CONFIG] Update section',
          opType: 'UPD',
          entityType: 'GLOBAL_CONFIG',
          entityId: 'misc',
          entityIds: [],
          payload: {
            sectionKey: 'misc',
            sectionCfg: { defaultProjectId: 'legacy-project' },
          },
          payloadBytes: BigInt(10),
          vectorClock: { [legacyClientId]: 1 },
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now() - 1_000),
          receivedAt: BigInt(Date.now() - 1_000),
          isPayloadEncrypted: false,
          syncImportReason: null,
        });

        const service = new SyncService({ batchUpload });
        const result = await service.uploadOps(userId, clientId, [
          makeGlobalConfigOp({
            id: 'current-tasks-write',
            entityId: 'tasks',
            payload: {
              sectionKey: 'tasks',
              sectionCfg: { defaultProjectId: 'current-project' },
            },
            vectorClock: { [clientId]: 1 },
            schemaVersion: CURRENT_SCHEMA_VERSION,
          }),
        ]);

        expect(result).toEqual([
          expect.objectContaining({
            opId: 'current-tasks-write',
            accepted: false,
            errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
            existingClock: { [legacyClientId]: 1 },
          }),
        ]);
        expect(testState.operations.size).toBe(1);
      },
    );

    it.each([
      ['serial', false],
      ['batch', true],
    ])(
      'atomically rejects a new mixed v1 misc upload that conflicts with v2 tasks in the %s path',
      async (_label, batchUpload) => {
        const currentClientId = 'current-client';
        const service = new SyncService({ batchUpload });
        const currentResult = await service.uploadOps(userId, currentClientId, [
          makeGlobalConfigOp({
            id: 'existing-current-tasks',
            clientId: currentClientId,
            entityId: 'tasks',
            payload: {
              sectionKey: 'tasks',
              sectionCfg: { defaultProjectId: 'current-project' },
            },
            vectorClock: { [currentClientId]: 1 },
            schemaVersion: CURRENT_SCHEMA_VERSION,
          }),
        ]);
        expect(currentResult[0].accepted).toBe(true);

        const sourceId = 'incoming-legacy-mixed';
        const legacyResult = await service.uploadOps(userId, clientId, [
          makeGlobalConfigOp({
            id: sourceId,
            payload: {
              sectionKey: 'misc',
              sectionCfg: {
                defaultProjectId: 'legacy-project',
                isMinimizeToTray: true,
              },
            },
            vectorClock: { [clientId]: 1 },
            schemaVersion: 1,
          }),
        ]);

        expect(legacyResult).toEqual([
          expect.objectContaining({
            opId: sourceId,
            accepted: false,
            errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
            existingClock: { [currentClientId]: 1 },
          }),
        ]);
        expect(testState.operations.has(`${sourceId}_misc`)).toBe(false);
        expect(testState.operations.has(`${sourceId}_tasks`)).toBe(false);
        expect(testState.operations.has(sourceId)).toBe(false);
        expect(testState.operations.size).toBe(1);
      },
    );

    it('should preserve concurrent additive task-time deltas within one batch', async () => {
      const service = new SyncService({ batchUpload: true });
      const makeTaskTimeOp = (
        id: string,
        vectorClock: Record<string, number>,
        duration: number,
      ): Operation => ({
        id,
        clientId,
        actionType: '[TimeTracking] Sync time spent',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: {
          actionPayload: {
            taskId: 'task-1',
            date: '2026-07-13',
            duration,
          },
          entityChanges: [],
        },
        vectorClock,
        timestamp: Date.now(),
        schemaVersion: 1,
      });

      const results = await service.uploadOps(userId, clientId, [
        makeTaskTimeOp(uuidv7(), { [clientId]: 1 }, 5000),
        makeTaskTimeOp(uuidv7(), { 'other-client': 1 }, 7000),
      ]);

      expect(results.every((result) => result.accepted)).toBe(true);
      expect(testState.operations.size).toBe(2);
    });

    it('should use entityIds when prefetching batch conflicts', async () => {
      const service = new SyncService({ batchUpload: true });
      testState.userSyncStates.set(userId, { userId, lastSeq: 1 });
      testState.operations.set('existing-op', {
        id: 'existing-op',
        userId,
        clientId: 'other-client',
        serverSeq: 1,
        actionType: 'UPDATE_TASK',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task-b',
        payload: { title: 'Existing' },
        payloadBytes: BigInt(10),
        vectorClock: { 'other-client': 1 },
        schemaVersion: 1,
        clientTimestamp: BigInt(Date.now() - 1000),
        receivedAt: BigInt(Date.now() - 1000),
        isPayloadEncrypted: false,
        syncImportReason: null,
      });

      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'BATCH_UPDATE_TASKS',
          opType: 'BATCH',
          entityType: 'TASK',
          entityId: 'task-a',
          entityIds: ['task-a', 'task-b', 'task-c'],
          payload: { entities: { 'task-a': { title: 'A' } } },
          vectorClock: { [clientId]: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      expect(results[0]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.CONFLICT_CONCURRENT,
        }),
      );
      expect(testState.userSyncStates.get(userId)?.lastSeq).toBe(1);
    });

    it.each([
      CONFLICT_DETECTION_ENTITY_BATCH_SIZE,
      CONFLICT_DETECTION_ENTITY_BATCH_SIZE + 1,
    ])(
      'should include the boundary pair and chunk correctly for %i pairs',
      async (pairCount) => {
        const boundaryIndex = pairCount - 1;
        const expectedBatchSizes =
          pairCount > CONFLICT_DETECTION_ENTITY_BATCH_SIZE
            ? [CONFLICT_DETECTION_ENTITY_BATCH_SIZE, 1]
            : [CONFLICT_DETECTION_ENTITY_BATCH_SIZE];
        const entityPairs = Array.from({ length: pairCount }, (_, index) => ({
          entityType: 'TASK',
          entityId: `task-${index}`,
        }));
        const boundaryPair = entityPairs[boundaryIndex];
        const boundaryRow = {
          ...boundaryPair,
          clientId: 'other-client',
          actionType: 'UPDATE_TASK',
          vectorClock: { 'other-client': 1 },
          serverSeq: 1,
        };
        const queriedBatchSizes: number[] = [];
        const tx = {
          $queryRaw: vi
            .fn()
            .mockImplementation(async (_strings: unknown, ...params: unknown[]) => {
              const touchedPairValues = (params[0] as Prisma.Sql).values;
              queriedBatchSizes.push(touchedPairValues.length / 2);
              for (let index = 0; index < touchedPairValues.length; index += 2) {
                if (
                  touchedPairValues[index] === boundaryPair.entityType &&
                  touchedPairValues[index + 1] === boundaryPair.entityId
                ) {
                  return [boundaryRow];
                }
              }
              return [];
            }),
        };

        const latestByEntity = await prefetchLatestEntityOpsForBatch(
          userId,
          entityPairs,
          tx as unknown as Prisma.TransactionClient,
        );

        expect(
          latestByEntity.get(
            getEntityConflictKey(boundaryPair.entityType, boundaryPair.entityId),
          ),
        ).toEqual(boundaryRow);
        expect(queriedBatchSizes).toEqual(expectedBatchSizes);
      },
    );

    it('should create user sync state for first-time batch uploads', async () => {
      const service = new SyncService({ batchUpload: true });
      expect(testState.userSyncStates.get(userId)).toBeUndefined();

      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: { [clientId]: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      expect(results[0]).toEqual(
        expect.objectContaining({ accepted: true, serverSeq: 1 }),
      );
      expect(testState.userSyncStates.get(userId)?.lastSeq).toBe(1);
    });

    it('should update device last seen for all-rejected batch uploads', async () => {
      const service = new SyncService({ batchUpload: true });

      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'INVALID' as Operation['opType'],
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: { [clientId]: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      expect(results[0]).toEqual(
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INVALID_OP_TYPE,
        }),
      );
      expect(testState.operations.size).toBe(0);
      expect(testState.userSyncStates.get(userId)).toBeUndefined();
      expect(testState.syncDevices.get(`${userId}:${clientId}`)).toEqual(
        expect.objectContaining({ userId, clientId }),
      );
    });

    it('runs the prior-vector-clock aggregate exactly once per batch and last full-state op wins, even with multiple full-state ops', async () => {
      // NEW-2: a single full-state op cannot prove the "once" invariant — it
      // would pass even if the expensive _aggregatePriorVectorClock ran per
      // full-state op. Use TWO full-state ops so the test catches a regression
      // that reverts to per-op aggregation (the exact perf footgun the batch
      // path optimizes away), and assert last-write-wins over N full-state ops.
      const service = new SyncService({ batchUpload: true });
      const operationUploadService = (
        service as unknown as {
          operationUploadService: {
            _aggregatePriorVectorClock: (...args: unknown[]) => Promise<unknown>;
          };
        }
      ).operationUploadService;
      const aggregateSpy = vi.spyOn(operationUploadService, '_aggregatePriorVectorClock');

      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { TASK: {} },
          vectorClock: { [clientId]: 7 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { TASK: {} },
          vectorClock: { [clientId]: 9 },
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
        makeOp({
          entityId: 'task-after',
          payload: { title: 'After' },
          vectorClock: { [clientId]: 10 },
          timestamp: Date.now() + 2,
        }),
      ]);

      expect(results.map((result) => result.accepted)).toEqual([true, true, true]);
      // Aggregate is computed once for the batch, not once per full-state op.
      expect(aggregateSpy).toHaveBeenCalledTimes(1);
      // Last full-state op wins: marker points at the SECOND import (seq 2),
      // not the first, with its (merged) clock.
      expect(testState.userSyncStates.get(userId)).toEqual(
        expect.objectContaining({
          lastSeq: 3,
          latestFullStateSeq: 2,
          latestFullStateVectorClock: { [clientId]: 9 },
        }),
      );
      aggregateSpy.mockRestore();
    });

    it('should classify batch createMany P2002 stale-prefetch races as retryable', async () => {
      const service = new SyncService({ batchUpload: true });
      const p2002 = new Prisma.PrismaClientKnownRequestError(
        'Unique constraint failed on the constraint: operations_pkey',
        {
          code: 'P2002',
          clientVersion: '5.0.0',
          meta: { target: 'operations_pkey' },
        },
      );
      const tx = {
        operation: {
          deleteMany: vi.fn(),
          findMany: vi.fn().mockResolvedValue([]),
          createMany: vi.fn().mockRejectedValue(p2002),
        },
        userSyncState: {
          updateMany: vi.fn(),
        },
        syncDevice: {
          deleteMany: vi.fn(),
          upsert: vi.fn(),
        },
        user: {
          update: vi.fn(),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ lastSeq: 1 }]),
        $executeRaw: vi.fn(),
      };

      vi.mocked(prisma.$transaction).mockImplementationOnce(async (callback) =>
        callback(tx as unknown as Prisma.TransactionClient),
      );

      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { TASK: {} },
          vectorClock: { [clientId]: 1 },
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      expect(results).toEqual([
        expect.objectContaining({
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
          error: 'Concurrent transaction conflict - please retry',
        }),
      ]);
      expect(tx.syncDevice.upsert).not.toHaveBeenCalled();
    });

    it('should reject duplicate operation IDs (idempotency)', async () => {
      const service = getSyncService();
      const opId = uuidv7();
      const op: Operation = {
        id: opId,
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // First upload should succeed
      const firstResults = await service.uploadOps(userId, clientId, [op]);
      expect(firstResults[0].accepted).toBe(true);

      // Second upload with same ID should be rejected
      const secondResults = await service.uploadOps(userId, clientId, [op]);
      expect(secondResults[0].accepted).toBe(false);
      expect(secondResults[0].error).toBe('Duplicate operation ID');
    });

    it('should update device last seen timestamp', async () => {
      const service = getSyncService();

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      await service.uploadOps(userId, clientId, [op]);

      const deviceKey = `${userId}:${clientId}`;
      const device = testState.syncDevices.get(deviceKey);

      expect(device).toBeDefined();
      expect(device.lastSeenAt).toBeDefined();
    });
  });

  describe('validation', () => {
    it('should reject operations with invalid opType', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'INVALID' as Operation['opType'],
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Invalid opType');
    });

    it('should reject operations with missing entityType', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: '',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Missing entityType');
    });

    it('should reject operations with missing payload', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: undefined,
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      } as unknown as Operation;

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Missing payload');
    });

    it('should reject operations with invalid ID', async () => {
      const service = getSyncService();
      const op = {
        id: '',
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT' as const,
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Invalid operation ID');
    });

    it('should clamp operations with timestamp too far in the future', async () => {
      const service = getSyncService();
      const now = Date.now();
      const farFuture = now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 10000; // 10s beyond limit

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: farFuture,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      // Should be accepted with clamped timestamp (not rejected)
      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();

      // Verify the stored timestamp was clamped
      const storedOp = testState.operations.get(op.id);
      expect(storedOp).toBeDefined();
      // clientTimestamp should be clamped to approximately now + maxClockDriftMs
      const storedTimestamp = Number(storedOp.clientTimestamp);
      expect(storedTimestamp).toBeLessThanOrEqual(
        now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 100,
      ); // 100ms tolerance
      expect(storedTimestamp).toBeLessThan(farFuture); // Must be less than original
    });

    it('should NOT clamp timestamp exactly at max clock drift boundary', async () => {
      const service = getSyncService();
      const now = Date.now();
      const exactlyAtLimit = now + DEFAULT_SYNC_CONFIG.maxClockDriftMs;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-2',
        payload: { title: 'Boundary Test' },
        vectorClock: {},
        timestamp: exactlyAtLimit,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);

      // Timestamp at exactly the boundary should NOT be clamped
      const storedOp = testState.operations.get(op.id);
      const storedTimestamp = Number(storedOp.clientTimestamp);
      expect(storedTimestamp).toBe(exactlyAtLimit);
    });

    it('should clamp timestamp just 1ms over max clock drift boundary', async () => {
      const service = getSyncService();
      const now = Date.now();
      const justOverLimit = now + DEFAULT_SYNC_CONFIG.maxClockDriftMs + 1;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-3',
        payload: { title: 'Just Over Boundary' },
        vectorClock: {},
        timestamp: justOverLimit,
        schemaVersion: 1,
      };

      // Freeze the clock so the service samples the same `now` as the test.
      // Otherwise a 1ms advance between the two Date.now() calls prevents
      // clamping (the op is then within maxClockDriftMs of the service's now).
      vi.useFakeTimers();
      vi.setSystemTime(now);
      try {
        const results = await service.uploadOps(userId, clientId, [op]);

        expect(results[0].accepted).toBe(true);

        // Timestamp just over the boundary should be clamped to the exact
        // boundary value (time is frozen, so no tolerance needed).
        const storedOp = testState.operations.get(op.id);
        const storedTimestamp = Number(storedOp.clientTimestamp);
        expect(storedTimestamp).toBe(now + DEFAULT_SYNC_CONFIG.maxClockDriftMs);
      } finally {
        vi.useRealTimers();
      }
    });

    it('should accept operations created before the server retention window', async () => {
      const service = getSyncService();
      const tooOld = Date.now() - DEFAULT_SYNC_CONFIG.retentionMs - 10000;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: tooOld,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(testState.operations.get(op.id)?.clientTimestamp).toBe(BigInt(tooOld));
    });

    it('should reject operations with payload exceeding size limit', async () => {
      // Create service with small payload limit for testing
      const testService = new (SyncService as any)({
        maxPayloadSizeBytes: 100,
      });

      const largePayload = { data: 'x'.repeat(200) };
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: largePayload,
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await testService.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Payload too large');
    });

    it('should reject complex payloads for regular operations', async () => {
      const service = getSyncService();

      // Create a deeply nested object that exceeds complexity limits
      const createDeeplyNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createDeeplyNested(depth - 1) };
      };

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'UPDATE_TASK',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: createDeeplyNested(25), // Exceeds max depth of 20
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('Payload too complex (max depth 20, max keys 20000)');
    });

    it('should accept complex payloads for SYNC_IMPORT operations', async () => {
      const service = getSyncService();

      // Create a deeply nested object that would fail complexity check for regular ops
      const createDeeplyNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createDeeplyNested(depth - 1) };
      };

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        payload: createDeeplyNested(25), // Exceeds max depth of 20 but allowed for SYNC_IMPORT
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();
    });

    it('should reject a stale REPAIR without deleting concurrent operations', async () => {
      const service = getSyncService();
      const concurrentOp = makeOp({ id: 'concurrent-op' });
      const repair = makeOp({
        id: 'stale-repair',
        actionType: '[Repair] Auto Repair',
        opType: 'REPAIR',
        entityType: 'ALL',
        entityId: undefined,
        payload: { repaired: true },
      });

      expect(
        (await service.uploadOps(userId, clientId, [concurrentOp]))[0].accepted,
      ).toBe(true);

      const staleResult = await service.uploadOps(
        userId,
        clientId,
        [repair],
        true,
        undefined,
        0,
      );

      expect(staleResult).toEqual([
        expect.objectContaining({
          opId: repair.id,
          accepted: false,
          errorCode: SYNC_ERROR_CODES.REPAIR_STALE,
        }),
      ]);
      expect(testState.operations.has(concurrentOp.id)).toBe(true);
      expect(testState.operations.has(repair.id)).toBe(false);

      const freshRepair = { ...repair, id: 'fresh-repair' };
      const freshResult = await service.uploadOps(
        userId,
        clientId,
        [freshRepair],
        true,
        undefined,
        1,
      );

      expect(freshResult[0].accepted).toBe(true);
      expect(testState.operations.has(concurrentOp.id)).toBe(true);
      expect(testState.operations.has(freshRepair.id)).toBe(true);
    });

    it('should accept a legacy REPAIR without deleting retained history', async () => {
      const service = getSyncService();
      const concurrentOp = makeOp({ id: 'concurrent-op' });
      const legacyRepair = makeOp({
        id: 'legacy-repair',
        actionType: '[Repair] Auto Repair',
        opType: 'REPAIR',
        entityType: 'ALL',
        entityId: undefined,
        payload: { repaired: true },
      });
      await service.uploadOps(userId, clientId, [concurrentOp]);

      const result = await service.uploadOps(
        userId,
        clientId,
        [legacyRepair],
        true,
        undefined,
        undefined,
        true,
      );

      expect(result[0].accepted).toBe(true);
      expect(testState.operations.has(concurrentOp.id)).toBe(true);
      expect(testState.operations.has(legacyRepair.id)).toBe(true);
      expect(testState.userSyncStates.get(userId)?.latestFullStateSeq).toBeUndefined();
    });

    it('should accept complex payloads for BACKUP_IMPORT operations', async () => {
      const service = getSyncService();

      // Create an object with many keys that would fail complexity check
      const manyKeys: Record<string, string> = {};
      for (let i = 0; i < 25000; i++) {
        manyKeys[`key${i}`] = `value${i}`;
      }

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'BACKUP_IMPORT',
        entityType: 'ALL',
        payload: manyKeys, // Exceeds max keys of 20000 but allowed for BACKUP_IMPORT
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);

      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();
    });

    it('should accept complex payloads for REPAIR operations', async () => {
      const service = getSyncService();

      // Create a deeply nested object
      const createDeeplyNested = (depth: number): Record<string, unknown> => {
        if (depth === 0) return { value: 'leaf' };
        return { nested: createDeeplyNested(depth - 1) };
      };

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: '[SP_ALL] Load(import) all data',
        opType: 'REPAIR',
        entityType: 'ALL',
        payload: createDeeplyNested(25), // Exceeds max depth of 20 but allowed for REPAIR
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(
        userId,
        clientId,
        [op],
        false,
        undefined,
        0,
      );

      expect(results[0].accepted).toBe(true);
      expect(results[0].serverSeq).toBeDefined();
    });

    // === VECTOR CLOCK EDGE CASE TESTS ===

    it('should accept vector clock with zero values', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: 0 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      // Zero is a valid clock value (represents initial state)
      expect(results[0].accepted).toBe(true);
    });

    it('should sanitize vector clock with string values (strip invalid entries)', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: '1' as unknown as number },
        timestamp: Date.now(),
        schemaVersion: 1,
      } as Operation;

      // Service sanitizes by stripping invalid entries, not rejecting
      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should sanitize vector clock with negative values (strip invalid entries)', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: -1 },
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Service sanitizes by stripping invalid entries, not rejecting
      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should sanitize vector clock with null entries (strip invalid entries)', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: { client1: null as unknown as number },
        timestamp: Date.now(),
        schemaVersion: 1,
      } as Operation;

      // Service sanitizes by stripping invalid entries, not rejecting
      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should reject payload that is null', async () => {
      const service = getSyncService();
      const op = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: null,
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      } as unknown as Operation;

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toBe('CRT payload must be a non-null object');
    });

    it('should reject schema version at boundary (> 100)', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 101,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toContain('Invalid schema version');
    });

    it('should accept schema version at max boundary (100)', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 100,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(true);
    });

    it('should accept timestamp exactly at max clock drift', async () => {
      const service = getSyncService();
      const exactlyAtDrift = Date.now() + DEFAULT_SYNC_CONFIG.maxClockDriftMs;

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-1',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: exactlyAtDrift,
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      // Should be accepted at exactly the boundary
      expect(results[0].accepted).toBe(true);
    });

    it('should handle unicode characters in entityId', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'task-日本語-émoji-🎉',
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      // Unicode should be accepted
      expect(results[0].accepted).toBe(true);

      // Verify round-trip
      const ops = (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops;
      expect(ops[0].op.entityId).toBe('task-日本語-émoji-🎉');
    });

    it('should reject entityId that is too long', async () => {
      const service = getSyncService();
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD_TASK',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'x'.repeat(300), // Exceeds typical limit
        payload: { title: 'Test Task' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      const results = await service.uploadOps(userId, clientId, [op]);
      expect(results[0].accepted).toBe(false);
      expect(results[0].error).toContain('Invalid entityId');
    });
  });

  describe('uploadOps + OperationDownloadService', () => {
    it('should return operations after given sequence', async () => {
      const service = getSyncService();

      // Upload 5 operations
      for (let i = 1; i <= 5; i++) {
        const op: Operation = {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `task-${i}`,
          payload: { title: `Task ${i}` },
          vectorClock: {},
          timestamp: Date.now() + i,
          schemaVersion: 1,
        };
        await service.uploadOps(userId, clientId, [op]);
      }

      const ops = (await operationDownloadService.getOpsSinceWithSeq(userId, 2)).ops;

      expect(ops).toHaveLength(3);
      expect(ops[0].serverSeq).toBe(3);
      expect(ops[1].serverSeq).toBe(4);
      expect(ops[2].serverSeq).toBe(5);
    });

    it('should exclude operations from specified client', async () => {
      const service = getSyncService();
      const client1 = 'client-1';
      const client2 = 'client-2';

      // Upload from client 1
      await service.uploadOps(userId, client1, [
        {
          id: uuidv7(),
          clientId: client1,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Upload from client 2
      await service.uploadOps(userId, client2, [
        {
          id: uuidv7(),
          clientId: client2,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-2',
          payload: { title: 'Task 2' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const ops = (await operationDownloadService.getOpsSinceWithSeq(userId, 0, client1))
        .ops;

      expect(ops).toHaveLength(1);
      expect(ops[0].op.entityId).toBe('task-2');
    });

    it('should respect limit parameter', async () => {
      const service = getSyncService();

      // Upload 10 operations
      for (let i = 1; i <= 10; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: 'ADD_TASK',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `task-${i}`,
            payload: { title: `Task ${i}` },
            vectorClock: {},
            timestamp: Date.now() + i,
            schemaVersion: 1,
          },
        ]);
      }

      const ops = (
        await operationDownloadService.getOpsSinceWithSeq(userId, 0, undefined, 3)
      ).ops;

      expect(ops).toHaveLength(3);
    });

    it('should return empty array when no operations exist', async () => {
      const ops = (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops;

      expect(ops).toHaveLength(0);
    });
  });

  describe('snapshots', () => {
    it('should reconstruct state from operations (snapshot)', async () => {
      const service = getSyncService();

      // Op 1: Create Task
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Task 1', done: false },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };

      // Op 2: Update Task
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'UPDATE',
        opType: 'UPD',
        entityType: 'TASK',
        entityId: 't1',
        payload: { done: true },
        vectorClock: {},
        timestamp: Date.now() + 100,
        schemaVersion: 1,
      };

      await service.uploadOps(userId, clientId, [op1, op2]);

      const snapshot = await service.generateSnapshot(userId);

      expect(snapshot.serverSeq).toBe(2);

      const state = snapshot.state as Record<
        string,
        Record<string, { title: string; done: boolean }>
      >;
      expect(state.TASK).toBeDefined();
      expect(state.TASK.t1).toBeDefined();
      expect(state.TASK.t1.title).toBe('Task 1');
      expect(state.TASK.t1.done).toBe(true);
    });

    it('should use incremental snapshots', async () => {
      const service = getSyncService();

      // Step 1: Initial State
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'NOTE',
        entityId: 'n1',
        payload: { text: 'Note 1' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op1]);

      // Generate first snapshot (caches it)
      const snap1 = await service.generateSnapshot(userId);
      expect(snap1.serverSeq).toBe(1);
      expect(
        (snap1.state as Record<string, Record<string, { text: string }>>).NOTE.n1.text,
      ).toBe('Note 1');

      // Step 2: Add more operations
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'NOTE',
        entityId: 'n2',
        payload: { text: 'Note 2' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op2]);

      // Generate second snapshot
      // This should internally use the cached state from snap1 and apply op2
      const snap2 = await service.generateSnapshot(userId);

      expect(snap2.serverSeq).toBe(2);
      const state = snap2.state as Record<string, Record<string, { text: string }>>;
      expect(state.NOTE.n1.text).toBe('Note 1'); // Preserved
      expect(state.NOTE.n2.text).toBe('Note 2'); // Added
    });

    it('should handle deletions in snapshots', async () => {
      const service = getSyncService();

      // Create
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TAG',
        entityId: 'tg1',
        payload: { title: 'Tag 1' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op1]);

      await service.generateSnapshot(userId); // Checkpoint

      // Delete
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'DEL',
        opType: 'DEL',
        entityType: 'TAG',
        entityId: 'tg1',
        payload: {},
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op2]);

      const snap = await service.generateSnapshot(userId);
      const state = snap.state as Record<string, Record<string, unknown>>;

      expect(state.TAG.tg1).toBeUndefined();
    });

    it('should handle MOV operations', async () => {
      const service = getSyncService();

      // Create task
      const op1: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Task 1', parentId: null },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op1]);

      // Move task
      const op2: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'MOVE',
        opType: 'MOV',
        entityType: 'TASK',
        entityId: 't1',
        payload: { parentId: 'p1' },
        vectorClock: {},
        timestamp: Date.now() + 100,
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op2]);

      const snap = await service.generateSnapshot(userId);
      const state = snap.state as Record<string, Record<string, { parentId: string }>>;

      expect(state.TASK.t1.parentId).toBe('p1');
    });

    it('should handle BATCH operations with entities payload', async () => {
      const service = getSyncService();

      // BATCH operations still need entityId for validation
      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'BATCH_UPDATE',
        opType: 'BATCH',
        entityType: 'TASK',
        entityId: '*', // Wildcard entityId for batch operations
        payload: {
          entities: {
            t1: { title: 'Task 1', done: false },
            t2: { title: 'Task 2', done: true },
          },
        },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op]);

      const snap = await service.generateSnapshot(userId);
      const state = snap.state as Record<
        string,
        Record<string, { title: string; done: boolean }>
      >;

      expect(state.TASK.t1.title).toBe('Task 1');
      expect(state.TASK.t2.done).toBe(true);
    });

    it('should return cached snapshot if up to date', async () => {
      const service = getSyncService();

      const op: Operation = {
        id: uuidv7(),
        clientId,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 't1',
        payload: { title: 'Task 1' },
        vectorClock: {},
        timestamp: Date.now(),
        schemaVersion: 1,
      };
      await service.uploadOps(userId, clientId, [op]);

      // Generate and cache
      const snap1 = await service.generateSnapshot(userId);

      // Call again - should return cached
      const snap2 = await service.generateSnapshot(userId);

      expect(snap1.serverSeq).toBe(snap2.serverSeq);
      expect(snap1.state).toEqual(snap2.state);
    });
  });

  describe('cleanup', () => {
    const seedFullStateOp = (
      targetUserId: number,
      serverSeq: number,
      receivedAt: bigint,
    ): void => {
      testState.operations.set(`full-state-${targetUserId}-${serverSeq}`, {
        id: `full-state-${targetUserId}-${serverSeq}`,
        userId: targetUserId,
        clientId: `client-${targetUserId}`,
        serverSeq,
        actionType: 'LOAD_ALL_DATA',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: null,
        entityIds: [],
        payload: { appDataComplete: { TASK: {} } },
        vectorClock: {},
        schemaVersion: 1,
        clientTimestamp: BigInt(Date.now()),
        receivedAt,
        isPayloadEncrypted: false,
        syncImportReason: null,
      });
    };

    it('should not delete old operations when no full-state base exists', async () => {
      const service = getSyncService();
      const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      // Upload operations
      for (let i = 1; i <= 5; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: 'ADD',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `t${i}`,
            payload: {},
            vectorClock: {},
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ]);
      }

      // Manually set old received_at to simulate old operations
      for (const [_id, op] of testState.operations) {
        if (op.serverSeq <= 2) {
          op.receivedAt = BigInt(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
        }
      }

      // Set up userSyncState with required fields for cleanup
      // The cleanup requires lastSnapshotSeq and snapshotAt to be set
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000; // 50 days ago
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 5, // Snapshot covers all ops up to seq 5
        snapshotAt: BigInt(Date.now()), // Snapshot taken recently (>= cutoffTime)
      });

      try {
        const { totalDeleted, affectedUserIds } =
          await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

        expect(totalDeleted).toBe(0);
        expect(affectedUserIds).not.toContain(userId);
        expect(warnSpy).toHaveBeenCalledWith(
          'Cleanup [old-ops]: skipped 1 eligible user(s) without a full-state replay base; their operation histories were left intact.',
        );

        const remaining = (await operationDownloadService.getOpsSinceWithSeq(userId, 0))
          .ops;
        expect(remaining).toHaveLength(5);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('should preserve the latest full-state operation and its replay tail', async () => {
      const service = getSyncService();
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 5; i++) {
        const isFullState = i === 2 || i === 4;
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: isFullState ? 'LOAD_ALL_DATA' : 'ADD',
          opType: i === 2 ? 'BACKUP_IMPORT' : i === 4 ? 'REPAIR' : 'CRT',
          entityType: isFullState ? 'ALL' : 'TASK',
          entityId: isFullState ? null : `t${i}`,
          entityIds: [],
          payload: isFullState ? { appDataComplete: { TASK: {} } } : {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
          // seq 4 is a CAUSAL repair (base cursor set), so the marker at seq 4 is
          // a valid pruning boundary once its causality is confirmed.
          repairBaseServerSeq: i === 4 ? 3 : null,
        });
      }

      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(Date.now()),
        latestFullStateSeq: 4,
      });

      const { totalDeleted } = await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(3);
      // The primary `latestFullStateSeq` marker is no longer trusted blindly: it
      // is validated against the causal predicate before authorizing a DELETE.
      expect(prisma.operation.findFirst).toHaveBeenCalled();
      expect(Array.from(testState.operations.keys())).toEqual(['old-op-4', 'old-op-5']);
      const freshClientOps = (
        await operationDownloadService.getOpsSinceWithSeq(userId, 0)
      ).ops;
      expect(freshClientOps.map((op) => op.serverSeq)).toEqual([4, 5]);
    });

    it('does not prune history behind a stale latestFullStateSeq marker pointing at a legacy REPAIR (primary path)', async () => {
      // Regression for the primary-path gap: installs upgraded from before the
      // causal-marker migration can carry a `latestFullStateSeq` that points at a
      // legacy REPAIR (repairBaseServerSeq NULL) — the migration added no backfill
      // to clear it. Trusting that cached marker would prune history behind a
      // repair the replay path refuses as a boundary. The marker must be validated
      // causal before it can authorize a DELETE; a stale one drops to the (causal-
      // only) fallback, which here finds no boundary → the user is skipped.
      const service = getSyncService();
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 5; i++) {
        const isLegacyRepair = i === 4;
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: isLegacyRepair ? 'LOAD_ALL_DATA' : 'ADD',
          opType: isLegacyRepair ? 'REPAIR' : 'CRT',
          entityType: isLegacyRepair ? 'ALL' : 'TASK',
          entityId: isLegacyRepair ? null : `t${i}`,
          entityIds: [],
          payload: isLegacyRepair ? { appDataComplete: { TASK: {} } } : {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
          // Legacy REPAIR = no causal base cursor.
          repairBaseServerSeq: null,
        });
      }

      // Stale marker: points at the markerless legacy REPAIR at seq 4.
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(Date.now()),
        latestFullStateSeq: 4,
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(0);
      expect(affectedUserIds).not.toContain(userId);
      expect(prisma.operation.findFirst).toHaveBeenCalled();
      expect(Array.from(testState.operations.keys())).toEqual([
        'old-op-1',
        'old-op-2',
        'old-op-3',
        'old-op-4',
        'old-op-5',
      ]);
    });

    it('does not prune history behind a legacy REPAIR without a causal base (fallback path)', async () => {
      // Regression guard: the fallback used when `latestFullStateSeq` is absent
      // (legacy/pre-marker installs) must use the causal-only full-state
      // predicate, like every other full-state query. A legacy REPAIR carries
      // appDataComplete but no `repairBaseServerSeq` proving its state is current
      // as of its seq, so it must NEVER authorize history pruning — ops between
      // its logical base and its seq would be lost for a device replaying from
      // before it. Before the fix this fallback used a raw opType filter that
      // selected the legacy REPAIR as the prune boundary and deleted ops 1–3.
      const service = getSyncService();
      const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 5; i++) {
        const isLegacyRepair = i === 4;
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: isLegacyRepair ? 'LOAD_ALL_DATA' : 'ADD',
          opType: isLegacyRepair ? 'REPAIR' : 'CRT',
          entityType: isLegacyRepair ? 'ALL' : 'TASK',
          entityId: isLegacyRepair ? null : `t${i}`,
          entityIds: [],
          payload: isLegacyRepair ? { appDataComplete: { TASK: {} } } : {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
          // Legacy REPAIR = no causal base cursor.
          repairBaseServerSeq: null,
        });
      }

      // latestFullStateSeq deliberately unset → cleanup takes the fallback query
      // path (the branch this fix hardens).
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 5,
        snapshotAt: BigInt(Date.now()),
      });

      try {
        const { totalDeleted, affectedUserIds } =
          await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

        expect(totalDeleted).toBe(0);
        expect(affectedUserIds).not.toContain(userId);
        // The fallback query ran (marker absent) but excluded the legacy REPAIR,
        // so the user has no replay base and is skipped rather than pruned.
        expect(prisma.operation.findFirst).toHaveBeenCalled();
        expect(Array.from(testState.operations.keys())).toEqual([
          'old-op-1',
          'old-op-2',
          'old-op-3',
          'old-op-4',
          'old-op-5',
        ]);
        expect(warnSpy).toHaveBeenCalledWith(
          'Cleanup [old-ops]: skipped 1 eligible user(s) without a full-state replay base; their operation histories were left intact.',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('drains a single user up to the per-run budget', async () => {
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '50';
      process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = '250';
      const totalOps = 255;
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= totalOps; i++) {
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `t${i}`,
          payload: {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
        });
      }
      seedFullStateOp(userId, totalOps + 1, BigInt(cutoffTime - 1));

      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: totalOps + 1,
        lastSnapshotSeq: totalOps + 1,
        snapshotAt: BigInt(Date.now()),
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
      delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;

      // Per-run budget is larger than one delete batch. The inner drain loop keeps
      // deleting until the budget hits zero, not just one batch.
      expect(totalDeleted).toBe(250);
      expect(affectedUserIds).toEqual([userId]);
      expect(testState.operations.size).toBe(6);
    });

    it('marks user for reconcile when a later batch throws mid-loop', async () => {
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '50';
      process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = '250';
      const totalOps = 120;
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= totalOps; i++) {
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `t${i}`,
          payload: {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
        });
      }
      seedFullStateOp(userId, totalOps + 1, BigInt(cutoffTime - 1));

      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: totalOps + 1,
        lastSnapshotSeq: totalOps + 1,
        snapshotAt: BigInt(Date.now()),
      });

      // Let the first batch run normally, then simulate a transient DB error
      // on the second batch. Pre-fix this would leave the storage counter
      // stale-high with no reconcile signal until the next daily pass.
      const serviceWithPrivates = service as unknown as {
        storageQuotaService: {
          deleteOldSyncedOpsBatch: (...args: unknown[]) => Promise<number>;
          needsReconcile: (userId: number) => boolean;
        };
      };
      const storageQuotaService = serviceWithPrivates.storageQuotaService;
      const originalBatch =
        storageQuotaService.deleteOldSyncedOpsBatch.bind(storageQuotaService);
      let callCount = 0;
      vi.spyOn(storageQuotaService, 'deleteOldSyncedOpsBatch').mockImplementation(
        async (...args: unknown[]) => {
          callCount += 1;
          if (callCount === 1) return originalBatch(...args);
          throw new Error('simulated transient DB failure');
        },
      );

      await expect(service.deleteOldSyncedOpsForAllUsers(cutoffTime)).rejects.toThrow(
        'simulated transient DB failure',
      );
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
      delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;

      // First batch committed deletes; the user must still be marked so
      // the next request reconciles the now-stale-high counter.
      expect(storageQuotaService.needsReconcile(userId)).toBe(true);
      expect(testState.operations.size).toBe(totalOps + 1 - 50);
    });

    it('shares the per-run budget across users; tail users wait for next pass', async () => {
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '50';
      process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = '250';
      const user2Id = 2;
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      testState.users.set(user2Id, {
        id: user2Id,
        email: 'test2@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Each user has 200 stale ops — more than the 250 per-run budget combined.
      const opsPerUser = 200;
      for (const uid of [userId, user2Id]) {
        for (let i = 1; i <= opsPerUser; i++) {
          testState.operations.set(`u${uid}-op-${i}`, {
            id: `u${uid}-op-${i}`,
            userId: uid,
            clientId,
            serverSeq: i,
            actionType: 'ADD',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `t${i}`,
            payload: {},
            vectorClock: {},
            schemaVersion: 1,
            clientTimestamp: BigInt(Date.now()),
            receivedAt: BigInt(cutoffTime - 1),
            isPayloadEncrypted: false,
            syncImportReason: null,
          });
        }
        seedFullStateOp(uid, opsPerUser + 1, BigInt(cutoffTime - 1));
      }

      // userSyncStates are processed by `orderBy: snapshotAt asc`, so the
      // stalest snapshot wins the budget first. user1 here is staler.
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: opsPerUser + 1,
        lastSnapshotSeq: opsPerUser + 1,
        snapshotAt: BigInt(Date.now() - 1000),
      });
      testState.userSyncStates.set(user2Id, {
        userId: user2Id,
        lastSeq: opsPerUser + 1,
        lastSnapshotSeq: opsPerUser + 1,
        snapshotAt: BigInt(Date.now()),
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
      delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;

      // user1 drains fully, user2 only gets the remaining budget.
      expect(totalDeleted).toBe(250);
      expect(affectedUserIds).toEqual([userId, user2Id]);
      expect(testState.operations.size).toBe(152);
    });

    it('should delete old operations from all users', async () => {
      const service = getSyncService();
      const user2Id = 2;

      // Create second user
      testState.users.set(user2Id, {
        id: user2Id,
        email: 'test2@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Upload ops for user 1
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Upload ops for user 2
      await service.uploadOps(user2Id, 'client-2', [
        {
          id: uuidv7(),
          clientId: 'client-2',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Make all ops old
      for (const op of testState.operations.values()) {
        op.receivedAt = BigInt(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100 days ago
      }

      // Set up userSyncState with required fields for both users
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      seedFullStateOp(userId, 2, BigInt(cutoffTime - 1));
      seedFullStateOp(user2Id, 3, BigInt(cutoffTime - 1));
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 2,
        lastSnapshotSeq: 2,
        snapshotAt: BigInt(Date.now()),
      });
      testState.userSyncStates.set(user2Id, {
        userId: user2Id,
        lastSeq: 3,
        lastSnapshotSeq: 3,
        snapshotAt: BigInt(Date.now()),
      });

      // Delete ops older than 50 days
      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(2); // Both users' ops deleted
      expect(affectedUserIds).toHaveLength(2);
      expect(affectedUserIds).toContain(userId);
      expect(affectedUserIds).toContain(user2Id);

      expect(
        (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops.length,
      ).toBe(1);
      expect(
        (await operationDownloadService.getOpsSinceWithSeq(user2Id, 0)).ops.length,
      ).toBe(1);
    });

    it('should delete stale devices', async () => {
      const service = getSyncService();

      // Create device by uploading
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Make device stale (100 days ago)
      const deviceKey = `${userId}:${clientId}`;
      const device = testState.syncDevices.get(deviceKey);
      if (device) {
        device.lastSeenAt = Date.now() - 100 * 24 * 60 * 60 * 1000;
      }

      // Delete devices not seen in 50 days
      const deleted = await service.deleteStaleDevices(
        Date.now() - 50 * 24 * 60 * 60 * 1000,
      );

      expect(deleted).toBe(1);
    });

    it('should not delete recent operations', async () => {
      const service = getSyncService();

      // Upload recent operations
      for (let i = 1; i <= 3; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: 'ADD',
            opType: 'CRT',
            entityType: 'TASK',
            entityId: `t${i}`,
            payload: {},
            vectorClock: {},
            timestamp: Date.now(),
            schemaVersion: 1,
          },
        ]);
      }

      // Try to delete with 50-day cutoff - should delete nothing since ops are fresh
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(0);
      expect(affectedUserIds).toHaveLength(0);
      expect(
        (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops.length,
      ).toBe(3);
    });

    it('should not delete recent devices', async () => {
      const service = getSyncService();

      // Create device by uploading (device will have current timestamp)
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Try to delete with 50-day cutoff - should delete nothing since device is fresh
      const deleted = await service.deleteStaleDevices(
        Date.now() - 50 * 24 * 60 * 60 * 1000,
      );

      expect(deleted).toBe(0);
    });
  });

  describe('rate limiting', () => {
    it('should not rate limit initially', () => {
      const service = getSyncService();

      expect(service.isRateLimited(userId)).toBe(false);
    });

    it('should rate limit after exceeding max requests', () => {
      // Create service with low rate limit for testing
      const testService = new (SyncService as any)({
        uploadRateLimit: { max: 2, windowMs: 60000 },
      });

      // First request
      expect(testService.isRateLimited(userId)).toBe(false);
      // Second request
      expect(testService.isRateLimited(userId)).toBe(false);
      // Third request - should be rate limited
      expect(testService.isRateLimited(userId)).toBe(true);
    });

    it('should reset rate limit after window expires', () => {
      vi.useFakeTimers();

      const testService = new (SyncService as any)({
        uploadRateLimit: { max: 1, windowMs: 1000 },
      });

      // Use up the limit
      expect(testService.isRateLimited(userId)).toBe(false);
      expect(testService.isRateLimited(userId)).toBe(true);

      // Advance time past window
      vi.advanceTimersByTime(1500);

      // Should be reset
      expect(testService.isRateLimited(userId)).toBe(false);

      vi.useRealTimers();
    });
  });

  describe('online device count', () => {
    it('should count recently seen devices as online', async () => {
      const service = getSyncService();

      // Create devices by uploading
      await service.uploadOps(userId, 'device-1', [
        {
          id: uuidv7(),
          clientId: 'device-1',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, 'device-2', [
        {
          id: uuidv7(),
          clientId: 'device-2',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const onlineCount = await service.getOnlineDeviceCount(userId);

      expect(onlineCount).toBe(2);
    });

    it('should not count stale devices as online', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Make device stale (last seen 10 minutes ago)
      const deviceKey = `${userId}:${clientId}`;
      const device = testState.syncDevices.get(deviceKey);
      if (device) {
        device.lastSeenAt = Date.now() - 10 * 60 * 1000;
      }

      const onlineCount = await service.getOnlineDeviceCount(userId);

      expect(onlineCount).toBe(0);
    });
  });

  describe('uploadOps + DeviceService user lookup', () => {
    it('should return all users with sync state', async () => {
      const service = getSyncService();
      const user2Id = 2;

      // Create another user
      testState.users.set(user2Id, {
        id: user2Id,
        email: 'user2@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Initialize sync state for both users via upload
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(user2Id, 'device-2', [
        {
          id: uuidv7(),
          clientId: 'device-2',
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: {},
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const userIds = await deviceService.getAllUserIds();

      expect(userIds).toContain(userId);
      expect(userIds).toContain(user2Id);
      expect(userIds).toHaveLength(2);
    });
  });

  describe('getRestorePoints', () => {
    it('should return empty array when no restore points exist', async () => {
      const service = getSyncService();

      // Upload regular operations (not restore points)
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Test Task' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(0);
    });

    it('should return SYNC_IMPORT operations as restore points', async () => {
      const service = getSyncService();
      const timestamp = Date.now();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { globalConfig: {}, tasks: {} },
          vectorClock: {},
          timestamp,
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('SYNC_IMPORT');
      expect(restorePoints[0].serverSeq).toBe(1);
      expect(restorePoints[0].clientId).toBe(clientId);
      expect(restorePoints[0].description).toBe('Full sync import');
    });

    it('should return BACKUP_IMPORT operations as restore points', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'BACKUP_IMPORT',
          entityType: 'ALL',
          payload: { globalConfig: {}, tasks: {} },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('BACKUP_IMPORT');
      expect(restorePoints[0].description).toBe('Backup restore');
    });

    it('should return REPAIR operations as restore points', async () => {
      const service = getSyncService();

      await service.uploadOps(
        userId,
        clientId,
        [
          {
            id: uuidv7(),
            clientId,
            actionType: '[SP_ALL] Load(import) all data',
            opType: 'REPAIR',
            entityType: 'ALL',
            payload: { globalConfig: {}, tasks: {} },
            vectorClock: {},
            timestamp: Date.now(),
            schemaVersion: 1,
            repairBaseServerSeq: 0,
          },
        ],
        false,
        undefined,
        0,
      );

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('REPAIR');
      expect(restorePoints[0].description).toBe('Auto-repair');
    });

    it('should return restore points in descending order by serverSeq', async () => {
      const service = getSyncService();

      // Upload multiple restore points
      for (let i = 1; i <= 3; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: '[SP_ALL] Load(import) all data',
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            payload: { version: i },
            vectorClock: {},
            timestamp: Date.now() + i,
            schemaVersion: 1,
          },
        ]);
      }

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(3);
      expect(restorePoints[0].serverSeq).toBe(3);
      expect(restorePoints[1].serverSeq).toBe(2);
      expect(restorePoints[2].serverSeq).toBe(1);
    });

    it('should respect limit parameter', async () => {
      const service = getSyncService();

      // Upload 5 restore points
      for (let i = 1; i <= 5; i++) {
        await service.uploadOps(userId, clientId, [
          {
            id: uuidv7(),
            clientId,
            actionType: '[SP_ALL] Load(import) all data',
            opType: 'SYNC_IMPORT',
            entityType: 'ALL',
            payload: { version: i },
            vectorClock: {},
            timestamp: Date.now() + i,
            schemaVersion: 1,
          },
        ]);
      }

      const restorePoints = await service.getRestorePoints(userId, 2);

      expect(restorePoints).toHaveLength(2);
      expect(restorePoints[0].serverSeq).toBe(5);
      expect(restorePoints[1].serverSeq).toBe(4);
    });

    it('should only return restore point types, not regular operations', async () => {
      const service = getSyncService();

      // Upload mixed operations
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: { globalConfig: {} },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'UPDATE_TASK',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 'task-1',
          payload: { done: true },
          vectorClock: {},
          timestamp: Date.now() + 2,
          schemaVersion: 1,
        },
      ]);

      const restorePoints = await service.getRestorePoints(userId);

      expect(restorePoints).toHaveLength(1);
      expect(restorePoints[0].type).toBe('SYNC_IMPORT');
      expect(restorePoints[0].serverSeq).toBe(2);
    });
  });

  describe('generateSnapshotAtSeq', () => {
    it('should generate snapshot at a specific serverSeq', async () => {
      const service = getSyncService();

      // Upload 3 operations
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1', done: false },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'Task 2', done: false },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'UPDATE',
          opType: 'UPD',
          entityType: 'TASK',
          entityId: 't1',
          payload: { done: true },
          vectorClock: {},
          timestamp: Date.now() + 2,
          schemaVersion: 1,
        },
      ]);

      // Get snapshot at seq 2 (before the update)
      const snapshot = await service.generateSnapshotAtSeq(userId, 2);

      expect(snapshot.serverSeq).toBe(2);
      const state = snapshot.state as Record<
        string,
        Record<string, { title: string; done: boolean }>
      >;
      expect(state.TASK.t1.done).toBe(false); // Not yet updated
      expect(state.TASK.t2).toBeDefined();
    });

    it('should throw error for targetSeq exceeding latest', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await expect(service.generateSnapshotAtSeq(userId, 100)).rejects.toThrow(
        'Target sequence 100 exceeds latest sequence 1',
      );
    });

    it('should throw error for targetSeq less than 1', async () => {
      const service = getSyncService();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await expect(service.generateSnapshotAtSeq(userId, 0)).rejects.toThrow(
        'Target sequence must be at least 1',
      );
    });

    it('should correctly restore state from SYNC_IMPORT operation', async () => {
      const service = getSyncService();

      const importPayload = {
        globalConfig: { theme: 'dark' },
        tasks: {
          t1: { title: 'Imported Task', done: true },
        },
      };

      // Upload a SYNC_IMPORT (full state)
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: '[SP_ALL] Load(import) all data',
          opType: 'SYNC_IMPORT',
          entityType: 'ALL',
          payload: importPayload,
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Add more operations after
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'New Task' },
          vectorClock: {},
          timestamp: Date.now() + 1,
          schemaVersion: 1,
        },
      ]);

      // Get snapshot at seq 1 (the SYNC_IMPORT)
      const snapshot = await service.generateSnapshotAtSeq(userId, 1);

      expect(snapshot.serverSeq).toBe(1);
      const state = snapshot.state as Record<string, unknown>;
      expect(state.globalConfig).toEqual({ theme: 'dark' });
      expect((state.tasks as Record<string, unknown>).t1).toEqual({
        title: 'Imported Task',
        done: true,
      });
      expect((state.TASK as Record<string, unknown> | undefined)?.t2).toBeUndefined();
    });

    it('should include generatedAt timestamp', async () => {
      const service = getSyncService();
      const beforeTime = Date.now();

      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      const snapshot = await service.generateSnapshotAtSeq(userId, 1);
      const afterTime = Date.now();

      expect(snapshot.generatedAt).toBeGreaterThanOrEqual(beforeTime);
      expect(snapshot.generatedAt).toBeLessThanOrEqual(afterTime);
    });
  });

  describe('deleteAllUserData (Reset Account)', () => {
    it('should delete all operations for the user', async () => {
      const service = getSyncService();

      // Upload some operations
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'Task 2' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Verify operations exist
      const opsBefore = (await operationDownloadService.getOpsSinceWithSeq(userId, 0))
        .ops;
      expect(opsBefore.length).toBe(2);

      // Delete all user data
      await service.deleteAllUserData(userId);

      // Verify operations are gone
      const opsAfter = (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops;
      expect(opsAfter.length).toBe(0);
    });

    it('should allow uploading new operations after reset', async () => {
      const service = getSyncService();

      // Upload initial operation
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'Task 1' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Delete all user data
      await service.deleteAllUserData(userId);

      // Upload new operation after reset
      const results = await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'New Task After Reset' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      expect(results[0].accepted).toBe(true);

      // Verify only new operation exists
      const ops = (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops;
      expect(ops.length).toBe(1);
      expect(ops[0].op.entityId).toBe('t2');
    });

    it('should not affect other users data', async () => {
      const service = getSyncService();
      const otherUserId = 2;

      // Add other user to test state
      testState.users.set(otherUserId, {
        id: otherUserId,
        email: 'other@test.com',
        storageQuotaBytes: BigInt(100 * 1024 * 1024),
        storageUsedBytes: BigInt(0),
      });

      // Upload operations for both users
      await service.uploadOps(userId, clientId, [
        {
          id: uuidv7(),
          clientId,
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't1',
          payload: { title: 'User 1 Task' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      await service.uploadOps(otherUserId, 'other-device', [
        {
          id: uuidv7(),
          clientId: 'other-device',
          actionType: 'ADD_TASK',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: 't2',
          payload: { title: 'User 2 Task' },
          vectorClock: {},
          timestamp: Date.now(),
          schemaVersion: 1,
        },
      ]);

      // Delete user 1's data
      await service.deleteAllUserData(userId);

      // Verify user 1's data is gone
      const user1Ops = (await operationDownloadService.getOpsSinceWithSeq(userId, 0)).ops;
      expect(user1Ops.length).toBe(0);

      // Verify user 2's data still exists
      const user2Ops = (await operationDownloadService.getOpsSinceWithSeq(otherUserId, 0))
        .ops;
      expect(user2Ops.length).toBe(1);
      expect(user2Ops[0].op.entityId).toBe('t2');
    });
  });
});
