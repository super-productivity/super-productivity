import 'dotenv/config';
import { createServer } from './server';
import * as path from 'path';
import { Logger } from './logger';
import { prisma } from './db';
import { warnOnPendingMigrations } from './migration-status';

// Create server instance with config overrides
// The server will load additional config from environment variables
const { start, stop } = createServer({
  dataDir: path.join(process.cwd(), 'data'),
});

// Graceful shutdown handling
let isShuttingDown = false;

const shutdown = async (signal: string): Promise<void> => {
  if (isShuttingDown) {
    Logger.info('Shutdown already in progress...');
    return;
  }
  isShuttingDown = true;
  Logger.info(`\n📴 Received ${signal}, shutting down gracefully...`);

  try {
    await stop();
    Logger.info('✅ Server stopped successfully');
    process.exit(0);
  } catch (err) {
    Logger.error('❌ Error during shutdown:', err);
    process.exit(1);
  }
};

// Register signal handlers for graceful shutdown
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGHUP', () => shutdown('SIGHUP'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  Logger.error('❌ Uncaught exception:', err);
  shutdown('uncaughtException').catch(() => process.exit(1));
});

process.on('unhandledRejection', (reason, promise) => {
  Logger.error('❌ Unhandled rejection at:', promise, 'reason:', reason);
});

// Start the server
start()
  .then((address) => {
    Logger.info('');
    Logger.info('🚀 SuperSync Server is running!');
    Logger.info(`   URL: ${address}`);
    Logger.info('');
    Logger.info('Press Ctrl+C to stop the server');
    Logger.info('');
    void warnOnPendingMigrations(
      prisma,
      path.join(process.cwd(), 'prisma', 'migrations'),
    );
  })
  .catch((err: any) => {
    // Provide user-friendly error messages for common errors
    if (err.code === 'EADDRINUSE') {
      Logger.error(`❌ Port is already in use. Try a different port with PORT=xxxx`);
    } else if (err.code === 'EACCES') {
      Logger.error(
        `❌ Permission denied. Try a port > 1024 or run with elevated privileges`,
      );
    } else {
      Logger.error('❌ Failed to start server:', err);
    }
    process.exit(1);
  });
