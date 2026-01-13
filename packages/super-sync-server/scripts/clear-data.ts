import { prisma, disconnectDb } from '../src/db';
import { loadConfigFromEnv } from '../src/config';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';
import { Logger } from '../src/logger';

/**
 * Recursively delete a directory and all its contents.
 * Returns true if deleted, false if directory didn't exist.
 */
function deleteDirectory(dirPath: string): boolean {
  if (!fs.existsSync(dirPath)) {
    return false;
  }
  fs.rmSync(dirPath, { recursive: true, force: true });
  return true;
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const question = (query: string): Promise<string> => {
  return new Promise((resolve) => {
    rl.question(query, resolve);
  });
};

async function main() {
  // Load config for dataDir
  const config = loadConfigFromEnv();

  const target = process.argv[2];

  if (!target) {
    console.log('Usage: npm run clear-data -- <email|--all>');
    console.log('  <email> : Clear data for a specific user (keeps account)');
    console.log('  --all   : Clear data for ALL users (keeps accounts)');
    process.exit(1);
  }

  if (target === '--all') {
    const answer = await question(
      'WARNING: This will delete ALL sync data for ALL users (database tables AND file-based storage). Accounts will be preserved. Are you sure? (yes/no): ',
    );
    if (answer.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }

    console.log('Clearing all sync data...');

    try {
      // Clear database tables
      await prisma.$transaction([
        prisma.operation.deleteMany(),
        prisma.userSyncState.deleteMany(),
        prisma.syncDevice.deleteMany(),
      ]);
      Logger.info('Deleted all rows from sync tables (operations, sync_state, devices)');
    } catch (err) {
      Logger.error('Failed to clear database tables:', err);
      process.exit(1);
    }

    // Clear file-based storage directories
    const fileBasedDirs = [
      path.join(config.dataDir, 'storage'),
      path.join(config.dataDir, 'super-productivity'),
    ];

    // Also check for any user-named directories at the root of dataDir
    try {
      if (fs.existsSync(config.dataDir)) {
        const systemFiles = ['database.sqlite', 'storage', 'super-productivity'];
        const entries = fs.readdirSync(config.dataDir, { withFileTypes: true });
        for (const entry of entries) {
          if (entry.isDirectory() && !systemFiles.includes(entry.name)) {
            fileBasedDirs.push(path.join(config.dataDir, entry.name));
          }
        }
      }
    } catch (err) {
      Logger.warn('Failed to scan data directory for cleanup:', err);
    }

    for (const dir of fileBasedDirs) {
      if (deleteDirectory(dir)) {
        console.log(`Deleted file-based storage: ${dir}`);
      }
    }

    console.log('Done.');
  } else {
    // Target is an email
    const user = await prisma.user.findUnique({
      where: { email: target },
    });

    if (!user) {
      console.error(`User not found: ${target}`);
      process.exit(1);
    }

    const answer = await question(
      `WARNING: This will delete all sync data for user '${target}'. The account/token will work, but data will be gone. Are you sure? (yes/no): `,
    );
    if (answer.toLowerCase() !== 'yes') {
      console.log('Aborted.');
      process.exit(0);
    }

    console.log(`Clearing sync data for user ${target} (ID: ${user.id})...`);

    try {
      // Clear database tables for this user
      await prisma.$transaction([
        prisma.operation.deleteMany({ where: { userId: user.id } }),
        prisma.userSyncState.deleteMany({ where: { userId: user.id } }),
        prisma.syncDevice.deleteMany({ where: { userId: user.id } }),
      ]);
      Logger.info(`Deleted sync data for user ${user.id}`);
    } catch (err) {
      Logger.error('Failed to clear user data:', err);
      process.exit(1);
    }

    // Clear file-based storage for this user
    const emailLocalPart = target.split('@')[0];
    const userFileDirs = [
      path.join(config.dataDir, 'storage', `user-${user.id}`),
      path.join(config.dataDir, target),
      path.join(config.dataDir, emailLocalPart),
      path.join(config.dataDir, 'super-productivity', target),
      path.join(config.dataDir, 'super-productivity', emailLocalPart),
    ];

    for (const dir of userFileDirs) {
      if (deleteDirectory(dir)) {
        console.log(`Deleted file-based storage: ${dir}`);
      }
    }

    console.log('Done.');
  }

  await disconnectDb();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
