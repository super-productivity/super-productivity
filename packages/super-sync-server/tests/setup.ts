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
          findUnique: vi.fn().mockImplementation(async (args: any) => {
            // Check if operation with given ID exists
            return testData.operations.get(args.where?.id) || null;
          }),
          findFirst: vi.fn().mockImplementation(async (args: any) => {
            // Find the first matching operation
            for (const op of testData.operations.values()) {
              if (args.where?.userId === op.userId) {
                if (args.where?.id === op.id) return op;
                if (!args.where?.id) return op;
              }
            }
            return null;
          }),
          findMany: vi.fn().mockImplementation(async (args: any) => {
            const ops = Array.from(testData.operations.values());
            return ops.filter((op) => {
              if (args.where?.userId !== op.userId) return false;
              if (args.where?.serverSeq?.gt !== undefined) {
                return op.serverSeq > args.where.serverSeq.gt;
              }
              return true;
            });
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
      };
      if (typeof callback === 'function') {
        return callback(tx);
      }
      // Handle array of promises (batch transaction)
      return Promise.all(callback);
    }),
    operation: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
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
  verifyToken: vi.fn().mockResolvedValue({ userId: 1, email: 'test@test.com' }),
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
