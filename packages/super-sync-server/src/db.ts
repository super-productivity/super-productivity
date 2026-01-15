import { PrismaClient } from '@prisma/client';

// Initialize Prisma Client
// Log queries in development for debugging
export const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === 'development'
      ? ['query', 'info', 'warn', 'error']
      : ['error'],
});

// Re-export types for convenience
export type { User, Operation, UserSyncState, SyncDevice } from '@prisma/client';

// Helper to disconnect on shutdown
export const disconnectDb = async (): Promise<void> => {
  await prisma.$disconnect();
};
