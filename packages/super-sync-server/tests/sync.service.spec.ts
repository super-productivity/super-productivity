import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  type MockInstance,
} from 'vitest';
import { uuidv7 } from 'uuidv7';
import { Prisma } from '@prisma/client';
import {
  testState,
  resetTestState,
  isLatestCausalFullStateQuery,
  isUnboundedCausalFullStateQuery,
  latestCausalFullStateRows,
  rawQueryValues,
} from './sync.service.test-state';
import type { OperationWhereAlternative } from './sync.service.test-state';

// Mock the database module with Prisma mocks
vi.mock('../src/db', async () => {
  // Import testState from separate module to avoid circular import
  const {
    applyOperationSelect,
    hasOperationUniqueConflict,
    isEntityArrayBranchQuery,
    entityArrayBranchRows,
    mockOperationGroupByMaxSeq,
    mockOperationFindFirstCausalRepair,
    mockOperationFindFirstFreshBelowBoundary,
    mockUserSyncStateFindMany,
    matchesOperationAlternative,
    testState: state,
  } = await import('./sync.service.test-state');
  const { Prisma: PrismaModule } = await import('@prisma/client');

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
        if (args.where?.id) {
          return (
            applyOperationSelect(state.operations.get(args.where.id), args.select) || null
          );
        }
        const causalRepair = mockOperationFindFirstCausalRepair(state.operations, args);
        if (causalRepair !== undefined) return causalRepair;
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
            args.where?.serverSeq?.gte !== undefined &&
            op.serverSeq < args.where.serverSeq.gte
          )
            shouldDelete = false;
          if (
            args.where?.serverSeq?.lt !== undefined &&
            op.serverSeq >= args.where.serverSeq.lt
          )
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
      findMany: vi
        .fn()
        .mockImplementation(async (args: any) =>
          mockUserSyncStateFindMany(state.userSyncStates, args),
        ),
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
      // The download path's newest-causal-full-state lookup ships as a pre-built
      // `Prisma.Sql` so its op_type values stay literals, so it arrives as ONE object
      // argument rather than a tagged template — see rawQueryText.
      if (isLatestCausalFullStateQuery(strings)) {
        // The upload path's author lookup carries no server_seq bound — counted so
        // tests can pin that it stays one-per-upload rather than one-per-op. The
        // download path's bounded form runs on a different route, so it is not counted.
        if (isUnboundedCausalFullStateQuery(strings, params)) {
          state.fullStateAuthorLookupCount++;
        }
        return latestCausalFullStateRows(
          state.operations,
          rawQueryValues(strings, params),
        );
      }
      const sql = Array.isArray(strings) ? strings.join('') : String(strings);
      // Array branch of the single-entity conflict lookup: MAX(server_seq) over
      // `entity_ids @> ARRAY[id]`, scoped to ONE entity — not a user-wide max
      // (see conflict.ts detectConflictForEntity).
      if (isEntityArrayBranchQuery(strings)) {
        return entityArrayBranchRows(state.operations, params);
      }
      if (sql.includes('FROM user_sync_state') && sql.includes('FOR UPDATE')) {
        const [txUserId] = params as [number];
        const syncState = state.userSyncStates.get(txUserId);
        return [
          {
            lastSeq: syncState?.lastSeq ?? 0,
            latestStateReplacementSeq: syncState?.latestStateReplacementSeq ?? null,
          },
        ];
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
          const freshBelowBoundary = mockOperationFindFirstFreshBelowBoundary(
            state.operations,
            args,
          );
          if (freshBelowBoundary !== undefined) return freshBelowBoundary;
          const causalRepair = mockOperationFindFirstCausalRepair(state.operations, args);
          if (causalRepair !== undefined) return causalRepair;
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
        groupBy: vi
          .fn()
          .mockImplementation(async (args: any) =>
            mockOperationGroupByMaxSeq(state.operations, args),
          ),
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
              args.where?.serverSeq?.gte !== undefined &&
              op.serverSeq < args.where.serverSeq.gte
            )
              shouldDelete = false;
            if (
              args.where?.serverSeq?.lt !== undefined &&
              op.serverSeq >= args.where.serverSeq.lt
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
        findMany: vi
          .fn()
          .mockImplementation(async (args: any) =>
            mockUserSyncStateFindMany(state.userSyncStates, args),
          ),
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
        // Emulates exactly the where-shape deleteAbandonedUnverifiedUsers
        // issues: isVerified equality, createdAt.lt, relation none, token OR.
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          const where = args.where ?? {};
          let deleted = 0;
          for (const [id, user] of state.users) {
            if (where.isVerified !== undefined && user.isVerified !== where.isVerified) {
              continue;
            }
            if (
              where.createdAt?.lt !== undefined &&
              !(user.createdAt instanceof Date && user.createdAt < where.createdAt.lt)
            ) {
              continue;
            }
            if (where.pendingPasskeyRegistrations?.none !== undefined) {
              const hasPending = Array.from(
                state.pendingPasskeyRegistrations.values(),
              ).some((p: any) => p.userId === id);
              if (hasPending) continue;
            }
            if (where.OR !== undefined) {
              const matchesOr = where.OR.some((cond: any) => {
                if (cond.verificationTokenExpiresAt === null) {
                  return user.verificationTokenExpiresAt == null;
                }
                if (cond.verificationTokenExpiresAt?.lt !== undefined) {
                  return (
                    user.verificationTokenExpiresAt != null &&
                    user.verificationTokenExpiresAt < cond.verificationTokenExpiresAt.lt
                  );
                }
                return false;
              });
              if (!matchesOr) continue;
            }
            state.users.delete(id);
            deleted++;
          }
          return { count: deleted };
        }),
      },
      pendingPasskeyRegistration: {
        deleteMany: vi.fn().mockImplementation(async (args: any) => {
          const lt = args.where?.verificationTokenExpiresAt?.lt;
          let deleted = 0;
          for (const [id, row] of state.pendingPasskeyRegistrations) {
            if (lt !== undefined && row.verificationTokenExpiresAt >= lt) continue;
            state.pendingPasskeyRegistrations.delete(id);
            deleted++;
          }
          return { count: deleted };
        }),
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

  const findOpRejected = (
    auditSpy: MockInstance<typeof Logger.audit>,
  ): Parameters<typeof Logger.audit>[0] | undefined =>
    auditSpy.mock.calls.find(([entry]) => entry.event === 'OP_REJECTED')?.[0];

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
    it('rejects a cursor behind the latest state replacement but allows its boundary', async () => {
      const service = new SyncService();
      const op = makeOp({ id: 'post-replacement-edit' });
      const replacement = makeOp({
        id: 'retained-state-replacement',
        opType: 'SYNC_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
      });
      testState.operations.set(replacement.id, {
        ...replacement,
        userId,
        serverSeq: 3,
        entityId: null,
        entityIds: [],
        payloadBytes: BigInt(1),
        clientTimestamp: BigInt(replacement.timestamp),
        receivedAt: BigInt(replacement.timestamp),
        isPayloadEncrypted: false,
        syncImportReason: null,
        repairBaseServerSeq: null,
      });
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 4,
        latestStateReplacementSeq: null,
      });

      const staleResults = await service.uploadOps(
        userId,
        clientId,
        [op],
        undefined,
        undefined,
        undefined,
        false,
        2,
      );

      expect(staleResults).toEqual([
        expect.objectContaining({
          opId: op.id,
          accepted: false,
          errorCode: SYNC_ERROR_CODES.INTERNAL_ERROR,
        }),
      ]);
      expect(testState.operations.has(op.id)).toBe(false);
      expect(testState.userSyncStates.get(userId)?.lastSeq).toBe(4);
      expect(testState.userSyncStates.get(userId)?.latestStateReplacementSeq).toBe(3);

      const currentResults = await service.uploadOps(
        userId,
        clientId,
        [op],
        undefined,
        undefined,
        undefined,
        false,
        3,
      );

      expect(currentResults).toEqual([
        expect.objectContaining({
          opId: op.id,
          accepted: true,
          serverSeq: 5,
        }),
      ]);
      expect(testState.operations.has(op.id)).toBe(true);
    });

    it('resolves the latest state replacement for cached upload checks', async () => {
      const service = new SyncService();
      const replacement = makeOp({
        id: 'cached-check-state-replacement',
        opType: 'BACKUP_IMPORT',
        entityType: 'ALL',
        entityId: undefined,
      });
      testState.operations.set(replacement.id, {
        ...replacement,
        userId,
        serverSeq: 3,
        entityId: null,
        entityIds: [],
        payloadBytes: BigInt(1),
        clientTimestamp: BigInt(replacement.timestamp),
        receivedAt: BigInt(replacement.timestamp),
        isPayloadEncrypted: false,
        syncImportReason: null,
        repairBaseServerSeq: null,
      });
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 4,
        latestStateReplacementSeq: null,
      });

      await expect(service.getLatestStateReplacementSeq(userId)).resolves.toBe(3);
      await expect(service.getLatestStateReplacementSeq(userId + 1)).resolves.toBeNull();
    });

    /**
     * Both pruning paths (the daily old-ops sweep and quota recovery) can
     * delete a SYNC_IMPORT out from under a later causal REPAIR. The resolved
     * cursor is persisted, so an import-only lookup does not just answer one
     * request wrong — it writes 0 down and disarms the guard for good.
     */
    const seedRepair = (serverSeq: number, repairBaseServerSeq: number | null): void => {
      const repair = makeOp({
        id: `retained-repair-${serverSeq}`,
        opType: 'REPAIR',
        entityType: 'ALL',
        entityId: undefined,
      });
      testState.operations.set(repair.id, {
        ...repair,
        userId,
        serverSeq,
        entityId: null,
        entityIds: [],
        payloadBytes: BigInt(1),
        clientTimestamp: BigInt(repair.timestamp),
        receivedAt: BigInt(repair.timestamp),
        isPayloadEncrypted: false,
        syncImportReason: null,
        repairBaseServerSeq,
      });
    };

    it('falls back to the newest causal REPAIR when no import is retained', async () => {
      const service = new SyncService();
      seedRepair(3, 2);
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 4,
        latestStateReplacementSeq: null,
      });

      await expect(service.getLatestStateReplacementSeq(userId)).resolves.toBe(3);
    });

    it('ignores a legacy REPAIR with no causal base', async () => {
      // Legacy REPAIR rows carry no base cursor, so they are not proven to
      // supersede their prefix and must stay invisible to the guard — the same
      // exclusion CAUSAL_FULL_STATE_OPERATION_WHERE makes everywhere else.
      const service = new SyncService();
      seedRepair(3, null);
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 4,
        latestStateReplacementSeq: null,
      });

      await expect(service.getLatestStateReplacementSeq(userId)).resolves.toBeNull();
    });

    it('persists a resolved no-replacement sentinel on the upload path', async () => {
      const service = new SyncService();
      const op = makeOp({ id: 'first-upload-with-cursor' });

      const result = await service.uploadOps(
        userId,
        clientId,
        [op],
        undefined,
        undefined,
        undefined,
        false,
        0,
      );

      expect(result[0].accepted).toBe(true);
      expect(testState.userSyncStates.get(userId)?.latestStateReplacementSeq).toBe(0);
    });

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

    it('preserves the active full-state author when pruning', async () => {
      const service = new SyncService();
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
    });

    it('looks the full-state author up at most once per upload', async () => {
      // The answer cannot change mid-transaction unless this upload itself
      // accepts a full-state op, so one oversized op must not become one query.
      const service = new SyncService();
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
    });

    it('rejects a request-start occupied ID after its row disappears', async () => {
      const service = new SyncService();
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
    });

    it('rejects an intra-batch same-id collision as INVALID_OP_ID', async () => {
      const service = new SyncService();
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
      const service = new SyncService();
      // Single-entity on purpose: the in-memory tx mock does not model the
      // multi-entity conflict SQL (entity-ids-conflict.pglite.spec.ts pins it).
      const retry = makeOp({
        id: uuidv7(),
        entityId: 'task-1',
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
      const service = new SyncService();
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
      const service = new SyncService();
      const privateText = 'private task title that must not be logged';
      const auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => undefined);
      const malformed = makeOp({
        id: privateText,
        entityType: privateText,
      });

      const result = await service.uploadOps(userId, clientId, [malformed]);

      expect(result[0].accepted).toBe(false);
      const rejection = findOpRejected(auditSpy);
      expect(rejection).toBeDefined();
      expect(rejection?.opId).toBe('[invalid]');
      expect(rejection?.entityType).toBe('[invalid]');
      expect(rejection?.reason).toBe(SYNC_ERROR_CODES.INVALID_ENTITY_TYPE);
      expect(JSON.stringify(rejection)).not.toContain(privateText);
    });

    it('audits a composite time-tracking entityId verbatim', async () => {
      const service = new SyncService();
      const auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => undefined);
      // Shape emitted by time-tracking.actions.ts: `CONTEXT_TYPE:contextId:date`.
      const compositeEntityId = 'PROJECT:ctx-1:2026-08-20';
      const op = makeOp({ entityType: 'TIME_TRACKING', entityId: compositeEntityId });

      const results = await service.uploadOps(userId, clientId, [op, { ...op }]);

      expect(results[1].errorCode).toBe(SYNC_ERROR_CODES.DUPLICATE_OPERATION);
      expect(findOpRejected(auditSpy)?.entityId).toBe(compositeEntityId);
    });

    it.each([
      // Space-free, so only the colon rule decides -- pins where the boundary now sits.
      ['TIME_TRACKING', 'TAG:call_mom:2026-08-20:extra:extra'],
      // `pluginId:key`, where key is plugin-authored text with no charset validation.
      ['PLUGIN_USER_DATA', 'some-plugin:Q3_roadmap'],
    ])(
      'redacts a colon-bearing %s entityId that is not a known address',
      async (entityType, entityId) => {
        const service = new SyncService();
        const auditSpy = vi.spyOn(Logger, 'audit').mockImplementation(() => undefined);
        const op = makeOp({ entityType, entityId });

        await service.uploadOps(userId, clientId, [op, { ...op }]);

        expect(findOpRejected(auditSpy)?.entityId).toBe('[invalid]');
      },
    );

    it('terminally rejects a valid sibling whose ID was reserved by an invalid op', async () => {
      const service = new SyncService();
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
    });

    it('should reject intra-batch entity conflicts in order', async () => {
      const service = new SyncService();
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

    it('rejects a v2 tasks write against an already-stored raw v1 misc row', async () => {
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

      const service = new SyncService();
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
    });

    it('atomically rejects a new mixed v1 misc upload that conflicts with v2 tasks', async () => {
      const currentClientId = 'current-client';
      const service = new SyncService();
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
    });

    it('should preserve concurrent additive task-time deltas within one batch', async () => {
      const service = new SyncService();
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

    it('runs the upload transaction at REPEATABLE READ isolation', async () => {
      // Tripwire for the FIX 1.5 removal (ARCHITECTURE-DECISIONS.md #4): the
      // post-allocation conflict re-check was deleted because RepeatableRead
      // pins every statement to one snapshot and the lastSeq increment raises
      // 40001 against concurrent writers. Lowering the isolation level makes
      // that deletion unsound — this must fail loudly, not silently re-arm a
      // missed-conflict race.
      const service = new SyncService();
      await service.uploadOps(userId, clientId, [makeOp({ entityId: 'iso-task' })]);

      expect(prisma.$transaction).toHaveBeenCalledWith(
        expect.any(Function),
        expect.objectContaining({
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
        }),
      );
    });

    it('should create user sync state for first-time uploads', async () => {
      const service = new SyncService();
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

    it('should update device last seen for all-rejected uploads', async () => {
      const service = new SyncService();

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
      // The serial path upserts the sync-state row before processing ops, so an
      // all-rejected upload still leaves a row at lastSeq 0.
      expect(testState.userSyncStates.get(userId)).toEqual(
        expect.objectContaining({ lastSeq: 0 }),
      );
      expect(testState.syncDevices.get(`${userId}:${clientId}`)).toEqual(
        expect.objectContaining({ userId, clientId }),
      );
    });

    it('last full-state op wins, even with multiple full-state ops in one upload', async () => {
      const service = new SyncService();

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
      // Last full-state op wins: marker points at the SECOND import (seq 2),
      // not the first, with its (merged) clock.
      expect(testState.userSyncStates.get(userId)).toEqual(
        expect.objectContaining({
          lastSeq: 3,
          latestFullStateSeq: 2,
          latestFullStateVectorClock: { [clientId]: 9 },
          latestStateReplacementSeq: 2,
        }),
      );
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

    /** A plain delta old enough to be prunable — the prefix `seedFullStateOp` protects. */
    const seedAgedOp = (targetUserId: number, id: string, receivedAt: bigint): void => {
      testState.operations.set(id, {
        id,
        userId: targetUserId,
        clientId: `client-${targetUserId}`,
        serverSeq: 1,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: id,
        entityIds: [],
        payload: {},
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

      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000; // 50 days ago
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 5, // Snapshot covers all ops up to seq 5
        snapshotAt: BigInt(Date.now()), // Snapshot taken recently (>= cutoffTime)
      });

      // No causal full-state op exists anywhere in the history, so the user
      // never becomes a sweep candidate — nothing is deleted, snapshot or not.
      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(0);
      expect(affectedUserIds).not.toContain(userId);

      const remaining = (await operationDownloadService.getOpsSinceWithSeq(userId, 0))
        .ops;
      expect(remaining).toHaveLength(5);
    });

    it('warns and skips a snapshot-capped user with no causal base below the cursor', async () => {
      // The causal boundary (seq 5) sits ABOVE the cached-snapshot cursor
      // (seq 4). While the cursor exists the boundary may not pass it, and no
      // causal full-state op exists at or below it → skip with a warning.
      const service = getSyncService();
      const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 4; i++) {
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `t${i}`,
          entityIds: [],
          payload: {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
          repairBaseServerSeq: null,
        });
      }
      seedFullStateOp(userId, 5, BigInt(cutoffTime - 1));

      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(Date.now()),
        // The cap keys on the cached BLOB, not on the cursor (#9688): without
        // snapshotData this user takes the uncapped path and prunes to seq 5.
        snapshotData: Buffer.from('legacy-cached-snapshot'),
      });

      try {
        const { totalDeleted, affectedUserIds } =
          await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

        expect(totalDeleted).toBe(0);
        expect(affectedUserIds).not.toContain(userId);
        expect(warnSpy).toHaveBeenCalledWith(
          'Cleanup [old-ops]: skipped 1 snapshot-capped user(s) without a causal ' +
            'full-state op at or below their snapshot cursor; their operation ' +
            'histories were left intact.',
        );
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('prunes past a stale snapshot cursor once the cached blob is gone', async () => {
      // Same shape as the capped case above, minus the cached snapshot BLOB.
      // Under mandatory E2EE the server stops caching snapshots, so
      // lastSnapshotSeq freezes at a stale value for the whole fleet (#9688):
      // capping on the cursor would exempt everyone from the sweep forever.
      const service = getSyncService();
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 4; i++) {
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: 'ADD',
          opType: 'CRT',
          entityType: 'TASK',
          entityId: `t${i}`,
          entityIds: [],
          payload: {},
          vectorClock: {},
          schemaVersion: 1,
          clientTimestamp: BigInt(Date.now()),
          receivedAt: BigInt(cutoffTime - 1),
          isPayloadEncrypted: false,
          syncImportReason: null,
          repairBaseServerSeq: null,
        });
      }
      seedFullStateOp(userId, 5, BigInt(cutoffTime - 1));

      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(Date.now()),
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(4);
      expect(affectedUserIds).toContain(userId);

      const remaining = (await operationDownloadService.getOpsSinceWithSeq(userId, 0))
        .ops;
      expect(remaining.map((op) => op.serverSeq)).toEqual([5]);
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
      expect(Array.from(testState.operations.keys())).toEqual(['old-op-4', 'old-op-5']);
      const freshClientOps = (
        await operationDownloadService.getOpsSinceWithSeq(userId, 0)
      ).ops;
      expect(freshClientOps.map((op) => op.serverSeq)).toEqual([4, 5]);
    });

    it('prunes the superseded prefix for a lapsed user whose snapshot predates the cutoff', async () => {
      // Regression for the inverted retention gate: the sweep used to skip any
      // user whose snapshotAt was OLDER than the retention cutoff, so exactly
      // the long-lapsed cohort kept its full operation history forever while
      // deleteStaleDevices pruned the same users' device rows unconditionally.
      // Snapshot age buys no safety here — pruning is bounded by the validated
      // causal full-state op (protectedFromSeq ≤ lastSnapshotSeq), which keeps
      // the replay base, its tail, and the cached snapshot's tail intact
      // regardless of when the snapshot was taken.
      const service = getSyncService();
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 5; i++) {
        const isFullState = i === 4;
        testState.operations.set(`old-op-${i}`, {
          id: `old-op-${i}`,
          userId,
          clientId,
          serverSeq: i,
          actionType: isFullState ? 'LOAD_ALL_DATA' : 'ADD',
          opType: isFullState ? 'SYNC_IMPORT' : 'CRT',
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
          repairBaseServerSeq: null,
        });
      }

      // Snapshot taken 100 days ago — well before the cutoff (lapsed user).
      testState.userSyncStates.set(userId, {
        userId,
        lastSeq: 5,
        lastSnapshotSeq: 4,
        snapshotAt: BigInt(Date.now() - 100 * 24 * 60 * 60 * 1000),
        latestFullStateSeq: 4,
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

      expect(totalDeleted).toBe(3);
      expect(affectedUserIds).toContain(userId);
      expect(Array.from(testState.operations.keys())).toEqual(['old-op-4', 'old-op-5']);
    });

    it('does not prune history behind a stale latestFullStateSeq marker pointing at a legacy REPAIR (primary path)', async () => {
      // Installs upgraded from before the causal-marker migration can carry a
      // `latestFullStateSeq` pointing at a legacy REPAIR (repairBaseServerSeq
      // NULL) — the migration added no backfill to clear it. The sweep no
      // longer consults the marker at all: the boundary groupBy selects only
      // causal full-state rows, so a legacy REPAIR (with or without a stale
      // marker pointing at it) never authorizes pruning.
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
      expect(Array.from(testState.operations.keys())).toEqual([
        'old-op-1',
        'old-op-2',
        'old-op-3',
        'old-op-4',
        'old-op-5',
      ]);
    });

    it('does not prune history behind a legacy REPAIR without a causal base (no marker)', async () => {
      // The boundary query must use the causal-only full-state predicate, like
      // every other full-state query. A legacy REPAIR carries appDataComplete
      // but no `repairBaseServerSeq` proving its state is current as of its
      // seq, so it must NEVER authorize history pruning — ops between its
      // logical base and its seq would be lost for a device replaying from
      // before it. Such a user has no causal boundary and never becomes a
      // sweep candidate.
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
        expect(Array.from(testState.operations.keys())).toEqual([
          'old-op-1',
          'old-op-2',
          'old-op-3',
          'old-op-4',
          'old-op-5',
        ]);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('drains a user past the per-run budget rather than truncating their prefix', async () => {
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
      // Regression for the truncated-prefix bug: with a 250-op budget and a
      // 255-op prefix, the drain used to stop at 250 and leave a plain CRT
      // delta (seq 251) as the lowest surviving row, which makes every
      // restore target throw SNAPSHOT_REPLAY_INCOMPLETE. The budget gates
      // which users we start, not where we stop inside one, so this user
      // drains whole and overshoots by 5.
      expect(totalDeleted).toBe(255);
      expect(affectedUserIds).toEqual([userId]);
      const survivors = Array.from(testState.operations.values())
        .filter((op) => op.userId === userId)
        .sort((a, b) => a.serverSeq - b.serverSeq);
      expect(survivors.map((op) => op.serverSeq)).toEqual([totalOps + 1]);
      expect(survivors[0].opType).toBe('SYNC_IMPORT');
    });

    it('deletes nothing when the per-run budget is set to 0', async () => {
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = '0';
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (let i = 1; i <= 3; i++) {
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
      seedFullStateOp(userId, 4, BigInt(cutoffTime - 1));

      const groupBySpy = vi.mocked(prisma.operation.groupBy);
      groupBySpy.mockClear();
      try {
        const { totalDeleted, affectedUserIds } =
          await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

        // The operator brake. `parsePositiveIntegerEnv` rejects 0 and falls
        // back to the default, so without the explicit decode this knob would
        // silently mean 25 000 — and there is no other way to stop an
        // irreversible, default-on sweep short of patching the image.
        expect(totalDeleted).toBe(0);
        expect(affectedUserIds).toEqual([]);
        expect(testState.operations.size).toBe(4);
        // Disabled must also cost nothing: no fleet-wide scan of `operations`.
        expect(groupBySpy).not.toHaveBeenCalled();
      } finally {
        delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;
      }
    });

    it('keeps draining when a concurrent delete shrinks a batch row count', async () => {
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

      // Quota recovery (deleteOldestRestorePointAndOps) runs unlocked against
      // the same user while the sweep is mid-drain — the sweep does NOT take
      // runWithStorageUsageLock, the upload path does. Simulate it landing
      // between the sweep's findMany (which selected 50 ids) and its
      // deleteMany: two of those rows are already gone, so deleteMany reports
      // 48. That is fewer rows than the batch size, but the user is NOT empty.
      const deleteManySpy = vi.mocked(prisma.operation.deleteMany) as unknown as {
        getMockImplementation: () => (args: any) => Promise<{ count: number }>;
        mockImplementation: (fn: (args: any) => Promise<{ count: number }>) => void;
      };
      const originalDeleteMany = deleteManySpy.getMockImplementation();
      let interceptedBatches = 0;
      deleteManySpy.mockImplementation(async (args: any) => {
        if (interceptedBatches === 0) {
          interceptedBatches += 1;
          for (const id of (args.where?.id?.in ?? []).slice(0, 2)) {
            testState.operations.delete(id);
          }
        }
        return originalDeleteMany(args);
      });

      try {
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      } finally {
        deleteManySpy.mockImplementation(originalDeleteMany);
        delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
        delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;
      }

      // A short row count must mean "these rows are gone", never "this user is
      // drained". Reading it as the latter stops the loop mid-prefix and
      // leaves a plain CRT delta as the lowest surviving row — the exact
      // SNAPSHOT_REPLAY_INCOMPLETE state the whole-or-nothing rule exists to
      // prevent, reached here through concurrency instead of the budget.
      const survivors = Array.from(testState.operations.values())
        .filter((op) => op.userId === userId)
        .sort((a, b) => a.serverSeq - b.serverSeq);
      expect(survivors.map((op) => op.serverSeq)).toEqual([totalOps + 1]);
      expect(survivors[0].opType).toBe('SYNC_IMPORT');
    });

    it('marks user for reconcile and keeps going when a batch throws mid-loop', async () => {
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

      // A second user, ordered after the failing one, proves one user's DB
      // error does not cost the rest of the fleet a day of retention.
      const otherUserId = userId + 1;
      testState.operations.set('other-old-op-1', {
        id: 'other-old-op-1',
        userId: otherUserId,
        clientId: `client-${otherUserId}`,
        serverSeq: 1,
        actionType: 'ADD',
        opType: 'CRT',
        entityType: 'TASK',
        entityId: 'ot1',
        payload: {},
        vectorClock: {},
        schemaVersion: 1,
        clientTimestamp: BigInt(Date.now()),
        receivedAt: BigInt(cutoffTime - 1),
        isPayloadEncrypted: false,
        syncImportReason: null,
      });
      seedFullStateOp(otherUserId, 2, BigInt(cutoffTime - 1));

      // Let the first batch run normally, then simulate a transient DB error
      // on the second batch. Pre-fix this would leave the storage counter
      // stale-high with no reconcile signal until the next daily pass.
      const serviceWithPrivates = service as unknown as {
        storageQuotaService: {
          deleteOldSyncedOpsBatch: (
            ...args: unknown[]
          ) => Promise<{ selectedCount: number; deletedCount: number }>;
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
          if (args[0] === userId) throw new Error('simulated transient DB failure');
          return originalBatch(...args);
        },
      );

      const { affectedUserIds } = await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
      delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;

      // The failing user is contained, not fatal to the run: the sweep logged
      // and moved on, so the second user was still serviced.
      expect(affectedUserIds).toContain(otherUserId);
      expect(
        Array.from(testState.operations.values()).filter(
          (op) => op.userId === otherUserId,
        ),
      ).toHaveLength(1);

      // First batch committed deletes; the user must still be marked so
      // the next request reconciles the now-stale-high counter.
      expect(storageQuotaService.needsReconcile(userId)).toBe(true);
      expect(
        Array.from(testState.operations.values()).filter((op) => op.userId === userId),
      ).toHaveLength(totalOps + 1 - 50);
    });

    it("keeps sweeping the fleet when one user's probe throws", async () => {
      // Production 2026-08-25: the fresh-prefix probe hit `statement_timeout` on a
      // deep prefix, the throw escaped the per-user loop, and `Cleanup [old-ops]`
      // aborted the WHOLE fleet's retention pass. `candidates` is deterministically
      // ordered, so the same user re-blocked it every night and `operations` grew
      // unbounded behind them -- visible only as one ERROR line a day.
      const service = getSyncService();
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
      const warnSpy = vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      seedAgedOp(userId, 'old-op-1', BigInt(cutoffTime - 1));
      seedFullStateOp(userId, 2, BigInt(cutoffTime - 1));

      // Ordered after the failing user, so it is only reached if the run continues.
      const otherUserId = userId + 1;
      seedAgedOp(otherUserId, 'other-old-op-1', BigInt(cutoffTime - 1));
      seedFullStateOp(otherUserId, 2, BigInt(cutoffTime - 1));

      const findFirstMock = prisma.operation.findFirst as unknown as {
        getMockImplementation: () => (args: unknown) => Promise<unknown>;
      };
      const realFindFirst = findFirstMock.getMockImplementation();
      // Counted, and asserted below: if the probe's `where` shape ever changes, this
      // spy stops matching and the test would otherwise pass while proving nothing.
      let thrownCount = 0;
      const probeOrderBys: unknown[] = [];
      const probeSpy = vi
        .spyOn(prisma.operation, 'findFirst')
        .mockImplementation(async (args: any) => {
          if (
            args?.where?.serverSeq?.lt !== undefined &&
            args?.where?.receivedAt?.gte !== undefined
          ) {
            probeOrderBys.push(args?.orderBy);
            if (args?.where?.userId === userId) {
              thrownCount++;
              throw new Error('canceling statement due to statement timeout');
            }
          }
          return realFindFirst(args);
        });

      try {
        const { affectedUserIds } =
          await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

        expect(thrownCount).toBeGreaterThan(0);
        // The probe's whole cost argument rests on the planner staying on
        // `(user_id, received_at)`; without the ORDER BY a NO answer walks the user's
        // entire aged prefix. Nothing else in the unit suite would notice it going away.
        expect(probeOrderBys.length).toBeGreaterThan(0);
        for (const orderBy of probeOrderBys) {
          expect(orderBy).toEqual({ receivedAt: 'asc' });
        }
        expect(affectedUserIds).toEqual([otherUserId]);
        // The failing user keeps their whole history; the rest of the fleet is pruned.
        expect(
          Array.from(testState.operations.values()).filter((op) => op.userId === userId),
        ).toHaveLength(2);
        expect(
          Array.from(testState.operations.values()).filter(
            (op) => op.userId === otherUserId,
          ),
        ).toHaveLength(1);
        expect(
          warnSpy.mock.calls.some(([msg]) =>
            String(msg).includes('1 user(s) threw before their drain'),
          ),
        ).toBe(true);
      } finally {
        probeSpy.mockRestore();
        errorSpy.mockRestore();
        warnSpy.mockRestore();
      }
    });

    it('abandons the run when candidate failures look systemic', async () => {
      // Containment must not turn a fleet-wide fault (dead pool, cold cache) into one
      // statement_timeout per user across the whole fleet: skipped candidates consume no
      // delete budget, so nothing else would ever stop the loop, and cleanup.ts schedules
      // this on a bare setInterval with no re-entrancy guard.
      const service = getSyncService();
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      const errorSpy = vi.spyOn(Logger, 'error').mockImplementation(() => undefined);
      vi.spyOn(Logger, 'warn').mockImplementation(() => undefined);

      const userCount = 40;
      for (let i = 0; i < userCount; i++) {
        const id = userId + i;
        seedAgedOp(id, `systemic-old-${id}`, BigInt(cutoffTime - 1));
        seedFullStateOp(id, 2, BigInt(cutoffTime - 1));
      }

      const findFirstMock = prisma.operation.findFirst as unknown as {
        getMockImplementation: () => (args: unknown) => Promise<unknown>;
      };
      const realFindFirst = findFirstMock.getMockImplementation();
      let probeCalls = 0;
      const probeSpy = vi
        .spyOn(prisma.operation, 'findFirst')
        .mockImplementation(async (args: any) => {
          if (
            args?.where?.serverSeq?.lt !== undefined &&
            args?.where?.receivedAt?.gte !== undefined
          ) {
            probeCalls++;
            throw new Error('canceling statement due to statement timeout');
          }
          return realFindFirst(args);
        });

      try {
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);

        // Stops at the threshold instead of running all 40.
        expect(probeCalls).toBeLessThan(userCount);
        expect(probeCalls).toBe(10);
        expect(
          errorSpy.mock.calls.some(([msg]) =>
            String(msg).includes(
              'abandoned the run after 10 consecutive candidate failures',
            ),
          ),
        ).toBe(true);
      } finally {
        probeSpy.mockRestore();
        vi.restoreAllMocks();
      }
    });

    it('shares the per-run budget across users; tail users wait for next pass', async () => {
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '50';
      process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN = '250';
      const user2Id = 2;
      const user3Id = 3;
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;

      for (const uid of [user2Id, user3Id]) {
        testState.users.set(uid, {
          id: uid,
          email: `test${uid}@test.com`,
          storageQuotaBytes: BigInt(100 * 1024 * 1024),
          storageUsedBytes: BigInt(0),
        });
      }

      // Three users × 200 stale ops against a 250-op budget: user1 drains
      // whole (overshooting nothing), user2 starts because 50 budget remained
      // and also drains whole (overshooting by 150), and user3 is never
      // started because the budget is spent. No prefix is ever truncated.
      const opsPerUser = 200;
      for (const uid of [userId, user2Id, user3Id]) {
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
      testState.userSyncStates.set(user3Id, {
        userId: user3Id,
        lastSeq: opsPerUser + 1,
        lastSnapshotSeq: opsPerUser + 1,
        snapshotAt: BigInt(Date.now() + 1000),
      });

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;
      delete process.env.OLD_OPS_CLEANUP_MAX_DELETED_PER_RUN;

      expect(totalDeleted).toBe(400);
      expect(affectedUserIds).toEqual([userId, user2Id]);
      // Every touched user is left with their full-state op as the lowest
      // surviving row; the untouched tail user keeps their whole history.
      const lowestSurvivorOf = (uid: number): Record<string, unknown> =>
        Array.from(testState.operations.values())
          .filter((op) => op.userId === uid)
          .sort((a, b) => a.serverSeq - b.serverSeq)[0];
      expect(lowestSurvivorOf(userId).opType).toBe('SYNC_IMPORT');
      expect(lowestSurvivorOf(user2Id).opType).toBe('SYNC_IMPORT');
      expect(lowestSurvivorOf(user3Id).serverSeq).toBe(1);
      expect(testState.operations.size).toBe(2 + opsPerUser + 1);
    });

    it('walks the prefix in stated serverSeq windows, never a discovered row set (#9692)', async () => {
      // The delete's scan range must be STATED (a two-sided serverSeq window),
      // never DISCOVERED (scan-until-LIMIT-fills). Production found three ways
      // for a discovered range to blow the 60s statement_timeout: low match
      // density heap-filters the whole prefix, a 5000-row batch is ~5000 cold
      // random heap fetches, and a prefix already deleted-but-unvacuumed is
      // walked entirely without ever filling the limit (measured 88s to return
      // zero rows). Only the call shape encodes that guarantee, so this test
      // pins the shape, not just the outcome.
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '100';
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      const boundarySeq = 250;

      for (let i = 1; i < boundarySeq; i++) {
        testState.operations.set(`w-op-${i}`, {
          id: `w-op-${i}`,
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
      seedFullStateOp(userId, boundarySeq, BigInt(cutoffTime - 1));

      const deleteManySpy = vi.mocked(prisma.operation.deleteMany);
      deleteManySpy.mockClear();
      const { totalDeleted } = await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;

      const wheres = deleteManySpy.mock.calls.map(
        ([args]) => (args as { where: Record<string, any> }).where,
      );
      // ceil(249 / 100) stated windows, covering [1, boundary) exactly, each no
      // wider than the configured width and each carrying the clean-slate
      // receivedAt guard. `id: { in }` appearing here would mean the row set
      // was discovered by a scan again — the exact regression this pins.
      expect(wheres.map((w) => [w.serverSeq?.gte, w.serverSeq?.lt])).toEqual([
        [1, 101],
        [101, 201],
        [201, boundarySeq],
      ]);
      for (const where of wheres) {
        expect(where.id).toBeUndefined();
        expect(where.userId).toBe(userId);
        expect(where.receivedAt?.lt).toBeDefined();
      }
      expect(totalDeleted).toBe(boundarySeq - 1);
    });

    it('keeps advancing windows across an already-pruned gap in the prefix (#9692)', async () => {
      // The dead-prefix cohort: quota recovery already deleted seq 1..200, so
      // the first windows have nothing to do. An empty window proves nothing
      // about the rest of the prefix — the drain must advance to the boundary,
      // not stop early, or the surviving tail is never pruned.
      const service = getSyncService();
      process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE = '100';
      const cutoffTime = Date.now() - 50 * 24 * 60 * 60 * 1000;
      const boundarySeq = 250;

      for (let i = 201; i < boundarySeq; i++) {
        testState.operations.set(`gap-op-${i}`, {
          id: `gap-op-${i}`,
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
      seedFullStateOp(userId, boundarySeq, BigInt(cutoffTime - 1));

      const { totalDeleted, affectedUserIds } =
        await service.deleteOldSyncedOpsForAllUsers(cutoffTime);
      delete process.env.OLD_OPS_CLEANUP_DELETE_BATCH_SIZE;

      expect(totalDeleted).toBe(boundarySeq - 201);
      expect(affectedUserIds).toEqual([userId]);
      const survivors = Array.from(testState.operations.values()).filter(
        (op) => op.userId === userId,
      );
      expect(survivors).toHaveLength(1);
      expect(survivors[0].opType).toBe('SYNC_IMPORT');
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

    it('should delete expired pending passkey registrations and keep unexpired ones', async () => {
      const service = getSyncService();
      const hourMs = 60 * 60 * 1000;

      testState.pendingPasskeyRegistrations.set('expired', {
        id: 'expired',
        userId: 21,
        verificationTokenExpiresAt: BigInt(Date.now() - hourMs),
      });
      testState.pendingPasskeyRegistrations.set('active', {
        id: 'active',
        userId: 22,
        verificationTokenExpiresAt: BigInt(Date.now() + hourMs),
      });

      const deleted = await service.deleteExpiredPendingPasskeyRegistrations(Date.now());

      expect(deleted).toBe(1);
      expect(testState.pendingPasskeyRegistrations.has('expired')).toBe(false);
      expect(testState.pendingPasskeyRegistrations.has('active')).toBe(true);
    });

    it('should delete abandoned unverified users but never verified or in-flight ones', async () => {
      const service = getSyncService();
      const dayMs = 24 * 60 * 60 * 1000;
      const addUser = (id: number, overrides: Record<string, unknown>): void => {
        testState.users.set(id, {
          id,
          email: `user-${id}@test.com`,
          isVerified: 0,
          verificationTokenExpiresAt: BigInt(Date.now() - dayMs),
          createdAt: new Date(Date.now() - 60 * dayMs),
          ...overrides,
        });
      };

      // Abandoned: old, unverified, expired token, nothing pending
      addUser(31, {});
      // Abandoned with the token column already cleared
      addUser(32, { verificationTokenExpiresAt: null });
      // Verified users are never touched, no matter how old
      addUser(33, { isVerified: 1 });
      // Unverified but still within the grace window
      addUser(34, { createdAt: new Date(Date.now() - dayMs) });
      // Unverified with a passkey registration still pending
      addUser(35, {});
      testState.pendingPasskeyRegistrations.set('pending-35', {
        id: 'pending-35',
        userId: 35,
        verificationTokenExpiresAt: BigInt(Date.now() + dayMs),
      });
      // Unverified with a magic-link re-registration in flight (live token)
      addUser(36, { verificationTokenExpiresAt: BigInt(Date.now() + dayMs) });

      const deleted = await service.deleteAbandonedUnverifiedUsers(
        Date.now() - 45 * dayMs,
      );

      expect(deleted).toBe(2);
      expect(testState.users.has(31)).toBe(false);
      expect(testState.users.has(32)).toBe(false);
      expect(testState.users.has(33)).toBe(true);
      expect(testState.users.has(34)).toBe(true);
      expect(testState.users.has(35)).toBe(true);
      expect(testState.users.has(36)).toBe(true);
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

  describe('device touch routing', () => {
    it('getOpsSinceWithSeq does not touch the device row — its other callers (upload piggyback, dedup retry) run right after the upload already upserted lastSeenAt', async () => {
      const service = getSyncService();
      const { prisma } = await import('../src/db');
      const executeRawSpy = vi.mocked(prisma.$executeRaw);
      executeRawSpy.mockClear();

      await service.getOpsSinceWithSeq(userId, 0, clientId);
      // The touch is fire-and-forget — give a stray one a tick to land.
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(executeRawSpy).not.toHaveBeenCalled();
    });

    it('touchDevice() runs the device-row touch (wired to the download route only)', async () => {
      const service = getSyncService();
      const { prisma } = await import('../src/db');
      const executeRawSpy = vi.mocked(prisma.$executeRaw);
      executeRawSpy.mockClear();

      service.touchDevice(userId, clientId);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(executeRawSpy).toHaveBeenCalled();
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
