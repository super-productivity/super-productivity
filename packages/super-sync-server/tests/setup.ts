/**
 * Vitest test setup file.
 *
 * This file provides mock implementations for the legacy SQLite-based
 * test infrastructure after the migration to Prisma.
 */
import { vi, beforeEach } from 'vitest';

// In-memory storage for test data
interface TestData {
  users: Map<number, any>;
  operations: Map<string, any>;
  syncDevices: Map<string, any>;
  userSyncStates: Map<number, any>;
}

let testData: TestData = {
  users: new Map(),
  operations: new Map(),
  syncDevices: new Map(),
  userSyncStates: new Map(),
};

let serverSeqCounter = 0;

// Mock better-sqlite3 style database interface
const createMockDb = () => {
  const mockDb = {
    prepare: (sql: string) => {
      return {
        run: (...args: any[]) => {
          // Parse and execute the SQL statement
          if (sql.includes('INSERT INTO users')) {
            const [id, email] = args;
            testData.users.set(id, { id, email, password_hash: 'hash', is_verified: 1 });
            return { changes: 1 };
          }
          if (sql.includes('UPDATE operations SET received_at')) {
            // Handle time-based updates for tests
            return { changes: 1 };
          }
          if (sql.includes('UPDATE sync_devices SET last_seen_at')) {
            return { changes: 1 };
          }
          return { changes: 0 };
        },
        get: (...args: any[]) => {
          if (sql.includes('FROM sync_devices')) {
            const [userId, clientId] = args;
            return testData.syncDevices.get(`${userId}:${clientId}`);
          }
          return undefined;
        },
        all: (...args: any[]) => {
          return [];
        },
      };
    },
    exec: (sql: string) => {
      // For schema creation, no-op
    },
    transaction: (fn: () => void) => {
      return () => fn();
    },
  };
  return mockDb;
};

let mockDb: ReturnType<typeof createMockDb> | null = null;

// Export mock functions that match the old SQLite-based API
export const initDb = (dataPath: string, inMemory: boolean = false) => {
  testData = {
    users: new Map(),
    operations: new Map(),
    syncDevices: new Map(),
    userSyncStates: new Map(),
  };
  serverSeqCounter = 0;
  mockDb = createMockDb();
};

export const getDb = () => {
  if (!mockDb) {
    throw new Error('Database not initialized. Call initDb first.');
  }
  return mockDb;
};

// Mock the db module
vi.mock('../src/db', () => {
  const applySelect = (op: any, select?: Record<string, boolean>) => {
    if (!op || !select) {
      return op;
    }

    return Object.fromEntries(
      Object.entries(select)
        .filter(([, shouldSelect]) => shouldSelect)
        .map(([key]) => [key, op[key]]),
    );
  };

  const matchesWhere = (op: any, where: any) => {
    if (!where) {
      return true;
    }

    if (where.userId !== undefined && op.userId !== where.userId) return false;
    if (where.id !== undefined && op.id !== where.id) return false;
    if (where.entityType !== undefined && op.entityType !== where.entityType) {
      return false;
    }
    if (where.entityId !== undefined && op.entityId !== where.entityId) return false;
    if (where.clientId !== undefined) {
      if (typeof where.clientId === 'object' && where.clientId !== null) {
        if (where.clientId.not !== undefined && op.clientId === where.clientId.not) {
          return false;
        }
      } else if (op.clientId !== where.clientId) {
        return false;
      }
    }

    if (where.serverSeq?.gt !== undefined && op.serverSeq <= where.serverSeq.gt) {
      return false;
    }
    if (where.serverSeq?.gte !== undefined && op.serverSeq < where.serverSeq.gte) {
      return false;
    }
    if (where.serverSeq?.lt !== undefined && op.serverSeq >= where.serverSeq.lt) {
      return false;
    }
    if (where.serverSeq?.lte !== undefined && op.serverSeq > where.serverSeq.lte) {
      return false;
    }

    if (where.opType?.in && !where.opType.in.includes(op.opType)) {
      return false;
    }
    if (typeof where.opType === 'string' && op.opType !== where.opType) {
      return false;
    }
    if (
      where.isPayloadEncrypted !== undefined &&
      op.isPayloadEncrypted !== where.isPayloadEncrypted
    ) {
      return false;
    }

    return true;
  };

  const sortOperations = (ops: any[], orderBy: any) => {
    if (orderBy?.serverSeq === 'desc') {
      return ops.sort((a, b) => b.serverSeq - a.serverSeq);
    }
    if (orderBy?.serverSeq === 'asc') {
      return ops.sort((a, b) => a.serverSeq - b.serverSeq);
    }
    return ops;
  };

  const hasOperationUniqueConflict = (row: any) =>
    Array.from(testData.operations.values()).some(
      (op) =>
        op.id === row.id ||
        (op.userId === row.userId &&
          row.serverSeq !== undefined &&
          op.serverSeq === row.serverSeq),
    );

  // Create Prisma mock with all needed operations
  const prismaMock = {
    $transaction: vi.fn().mockImplementation(async (callback: any) => {
      // Create a transaction context
      const tx = {
        operation: {
          create: vi.fn().mockImplementation(async (args: any) => {
            serverSeqCounter++;
            const op = {
              ...args.data,
              serverSeq: serverSeqCounter,
              receivedAt: BigInt(Date.now()),
            };
            testData.operations.set(args.data.id, op);
            return op;
          }),
          createMany: vi.fn().mockImplementation(async (args: any) => {
            const rows = Array.isArray(args.data) ? args.data : [args.data];
            let count = 0;

            for (const row of rows) {
              if (hasOperationUniqueConflict(row)) {
                if (args.skipDuplicates) {
                  continue;
                }
                throw new Error('Unique constraint failed');
              }

              testData.operations.set(row.id, {
                ...row,
                receivedAt: row.receivedAt ?? BigInt(Date.now()),
              });
              count++;
            }

            return { count };
          }),
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            // Check if operation with given ID exists
            return (
              applySelect(testData.operations.get(args.where?.id), args.select) || null
            );
          }),
          findFirst: vi.fn().mockImplementation(async (args: any) => {
            const ops = sortOperations(
              Array.from(testData.operations.values()).filter((op) =>
                matchesWhere(op, args.where),
              ),
              args.orderBy,
            );
            return applySelect(ops[0], args.select) || null;
          }),
          findMany: vi.fn().mockImplementation(async (args: any) => {
            const ops = Array.from(testData.operations.values()).filter((op) =>
              matchesWhere(op, args.where),
            );
            return sortOperations(ops, args.orderBy).map((op) =>
              applySelect(op, args.select),
            );
          }),
          count: vi.fn().mockImplementation(async (args: any) => {
            return Array.from(testData.operations.values()).filter((op) =>
              matchesWhere(op, args.where),
            ).length;
          }),
          aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        userSyncState: {
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            return testData.userSyncStates.get(args.where.userId) || null;
          }),
          upsert: vi.fn().mockImplementation(async (args: any) => {
            const existing = testData.userSyncStates.get(args.where.userId);
            const result = existing
              ? { ...existing, ...args.update }
              : { userId: args.where.userId, ...args.create };
            testData.userSyncStates.set(args.where.userId, result);
            return result;
          }),
          update: vi.fn().mockImplementation(async (args: any) => {
            const existing = testData.userSyncStates.get(args.where.userId);
            if (existing) {
              const updated = { ...existing };
              // Handle Prisma's increment syntax: { lastSeq: { increment: 1 } }
              if (args.data?.lastSeq?.increment !== undefined) {
                updated.lastSeq = (existing.lastSeq || 0) + args.data.lastSeq.increment;
              } else if (args.data?.lastSeq?.decrement !== undefined) {
                updated.lastSeq = (existing.lastSeq || 0) - args.data.lastSeq.decrement;
              } else {
                Object.assign(updated, args.data);
              }
              testData.userSyncStates.set(args.where.userId, updated);
              return updated;
            }
            return null;
          }),
          findMany: vi.fn().mockResolvedValue([]),
        },
        syncDevice: {
          upsert: vi.fn().mockImplementation(async (args: any) => {
            // Handle both key naming conventions (Prisma uses userId_clientId)
            const compositeKey = args.where.userId_clientId || args.where.clientId_userId;
            const key = `${compositeKey.userId}:${compositeKey.clientId}`;
            const result = { ...args.create, ...args.update };
            testData.syncDevices.set(key, result);
            return result;
          }),
          count: vi.fn().mockResolvedValue(1),
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        user: {
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            return testData.users.get(args.where.id) || null;
          }),
          update: vi.fn().mockResolvedValue({}),
        },
        $queryRaw: vi.fn().mockResolvedValue([{ total: BigInt(0) }]),
        // The upload transaction writes the storage counter atomically via
        // $executeRaw to keep the data write and the counter delta in a single
        // commit. Default mock is a no-op; specs that care about counter
        // behaviour mock it explicitly.
        $executeRaw: vi.fn().mockResolvedValue(0),
      };
      if (typeof callback === 'function') {
        return callback(tx);
      }
      // Handle array of promises (batch transaction)
      return Promise.all(callback);
    }),
    operation: {
      create: vi.fn(),
      createMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn().mockResolvedValue(0),
      aggregate: vi.fn().mockResolvedValue({ _min: { serverSeq: 1 } }),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    userSyncState: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn().mockResolvedValue([]),
    },
    syncDevice: {
      upsert: vi.fn(),
      count: vi.fn().mockResolvedValue(1),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    $queryRaw: vi.fn().mockResolvedValue([{ total: BigInt(0) }]),
    $executeRaw: vi.fn().mockResolvedValue(0),
  };

  return {
    prisma: prismaMock,
    // Legacy SQLite-style exports for backwards compatibility
    initDb: (dataPath: string, inMemory: boolean = false) => {
      testData = {
        users: new Map(),
        operations: new Map(),
        syncDevices: new Map(),
        userSyncStates: new Map(),
      };
      serverSeqCounter = 0;
      mockDb = createMockDb();
    },
    getDb: () => {
      if (!mockDb) {
        mockDb = createMockDb();
      }
      return mockDb;
    },
  };
});

// Mock auth module
vi.mock('../src/auth', () => ({
  verifyToken: vi
    .fn()
    .mockResolvedValue({ valid: true, userId: 1, email: 'test@test.com' }),
  VERIFICATION_TOKEN_EXPIRY_MS: 24 * 60 * 60 * 1000,
  MAX_VERIFICATION_RESEND_COUNT: 20,
}));

// Reset test data before each test
beforeEach(() => {
  testData = {
    users: new Map(),
    operations: new Map(),
    syncDevices: new Map(),
    userSyncStates: new Map(),
  };
  serverSeqCounter = 0;
  vi.clearAllMocks();
});
