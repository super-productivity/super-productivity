import * as fs from 'fs';
import * as path from 'path';
import { Logger } from './logger';

interface MigrationQueryClient {
  $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): Promise<T>;
}

/**
 * Names of the migrations shipped in `migrationsDir` (one directory with a
 * `migration.sql` each). Returns an empty list when the directory is absent,
 * e.g. in a dev checkout without the prisma folder.
 */
export const listShippedMigrations = (migrationsDir: string): string[] => {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDir, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isDirectory() &&
        fs.existsSync(path.join(migrationsDir, entry.name, 'migration.sql')),
    )
    .map((entry) => entry.name)
    .sort();
};

/**
 * Shipped migrations that the database has not finished applying.
 */
export const findPendingMigrations = (shipped: string[], applied: string[]): string[] => {
  const appliedSet = new Set(applied);
  return shipped.filter((name) => !appliedSet.has(name));
};

/**
 * Logs an error when the database lags behind the migrations shipped with this
 * build. Container startup migrations are off by default, so a plain
 * `docker compose pull && up -d` can run new code against an old schema
 * (#8187, #10434); this turns the later column errors into one actionable line.
 * Warn-only on purpose: refusing to boot would turn a deploy-window race into a
 * crash loop.
 */
export const warnOnPendingMigrations = async (
  db: MigrationQueryClient,
  migrationsDir: string,
): Promise<void> => {
  const shipped = listShippedMigrations(migrationsDir);
  if (shipped.length === 0) {
    return;
  }

  let applied: string[];
  try {
    const rows = await db.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations
      WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    applied = rows.map((row) => row.migration_name);
  } catch (err) {
    // Warn, not error: dev and E2E databases built with `prisma db push` have no
    // _prisma_migrations table and are fine; a never-migrated one is too.
    Logger.warn(
      'Skipped migration check: could not read _prisma_migrations. If this is a new ' +
        'database, run migrations first (scripts/deploy.sh, or RUN_MIGRATIONS_ON_STARTUP=true).',
      err,
    );
    return;
  }

  const pending = findPendingMigrations(shipped, applied);
  if (pending.length > 0) {
    Logger.error(
      `Database is missing ${pending.length} migration(s): ${pending.join(', ')}. ` +
        'Run them with scripts/deploy.sh, or set RUN_MIGRATIONS_ON_STARTUP=true ' +
        'for a single-instance setup and restart.',
    );
  }
};
