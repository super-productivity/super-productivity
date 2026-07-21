/**
 * Proves the lock-bounded retry path end-to-end against a REAL PostgreSQL lock
 * timeout: a real concurrent reader starves the ALTER's lock window, Prisma
 * really fails with 55P03, and migrate-deploy.sh's shape gate really recognizes
 * it and really retries until it wins.
 *
 * The sibling unit spec drives a FAKE `npx prisma`, so it can only prove the
 * script's control flow. It cannot prove that the gate matches SQL Postgres
 * actually accepts, that Prisma's real 55P03 output matches the log anchors, or
 * that a plain seq-scan reader is enough to block the ALTER. This does.
 */
import { PrismaClient } from '@prisma/client';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(currentDir, '../..');
const migrateScript = join(packageDir, 'scripts/migrate-deploy.sh');

// A dedicated schema keeps this test's own `_prisma_migrations` bookkeeping out
// of the real one — `migrate deploy` would otherwise record these fixtures
// alongside the production migration history.
const TEST_SCHEMA = 'migrate_lock_retry_test';
const TABLE = 'lock_retry_probe';
const INDEX = 'lock_retry_probe_gin';

const urlForSchema = (applicationName: string): string => {
  const url = new URL(DATABASE_URL as string);
  url.searchParams.set('schema', TEST_SCHEMA);
  url.searchParams.set('application_name', applicationName);
  return url.toString();
};

const SEED_SQL = `CREATE TABLE "${TABLE}" ("id" SERIAL PRIMARY KEY, "tags" TEXT[] NOT NULL DEFAULT '{}');
CREATE INDEX "${INDEX}" ON "${TABLE}" USING GIN ("tags");`;

// The shape under test: a bounded lock wait, then an idempotent reloption change.
const BOUND_SQL = `SET LOCAL lock_timeout = '1s';
ALTER INDEX "${INDEX}" SET (fastupdate = off);`;

let projectDir: string;

const writeMigration = (name: string, sql: string): void => {
  const dir = join(projectDir, 'prisma', 'migrations', name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'migration.sql'), sql);
};

interface DeployResult {
  status: number | null;
  output: string;
}

// Must be async: the blocking reader below holds its lock on this process's
// event loop, so a spawnSync here would freeze the blocker and prevent it ever
// releasing — the migration would then exhaust its whole budget.
const runMigrateDeploy = (): Promise<DeployResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('sh', [migrateScript], {
      cwd: projectDir,
      env: {
        ...process.env,
        DATABASE_URL: urlForSchema('supersync-migrator-locktest'),
        MIGRATE_STEP_TIMEOUT: '60',
      },
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('close', (status: number | null) => resolve({ status, output }));
  });

const readReloptions = async (): Promise<string[] | null> => {
  const admin = new PrismaClient({
    datasources: { db: { url: urlForSchema('locktest-admin') } },
  });
  try {
    const rows = await admin.$queryRawUnsafe<Array<{ reloptions: string[] | null }>>(
      `SELECT c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1 AND n.nspname = $2`,
      INDEX,
      TEST_SCHEMA,
    );
    return rows[0]?.reloptions ?? null;
  } finally {
    await admin.$disconnect();
  }
};

describeWithDb('migrate-deploy.sh lock-bounded retry (real PostgreSQL)', () => {
  beforeAll(() => {
    // Inside the package so `npx prisma` resolves through the normal upward
    // node_modules lookup.
    projectDir = mkdtempSync(join(packageDir, '.tmp-lock-retry-'));
    mkdirSync(join(projectDir, 'prisma', 'migrations'), { recursive: true });
    // Prisma resolves its schema from the nearest project root, so without this
    // it walks up and discovers the REAL prisma/migrations instead of ours.
    writeFileSync(
      join(projectDir, 'package.json'),
      '{ "name": "lock-retry-fixture", "private": true }\n',
    );
    writeFileSync(
      join(projectDir, 'prisma', 'schema.prisma'),
      'datasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n',
    );
    writeFileSync(
      join(projectDir, 'prisma', 'migrations', 'migration_lock.toml'),
      'provider = "postgresql"\n',
    );
  });

  afterAll(async () => {
    rmSync(projectDir, { recursive: true, force: true });
    const admin = new PrismaClient({
      datasources: { db: { url: urlForSchema('locktest-cleanup') } },
    });
    try {
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`);
    } finally {
      await admin.$disconnect();
    }
  });

  it('retries through a real 55P03 lock timeout and applies the migration', async () => {
    // 1. Seed the table + index with no contention.
    writeMigration('20260101000000_seed', SEED_SQL);
    const seed = await runMigrateDeploy();
    expect(seed.output).not.toContain('ERROR:');
    expect(seed.status).toBe(0);
    expect(await readReloptions()).toBeNull();

    // 2. Hold a plain seq-scan reader open. The planner takes AccessShareLock on
    //    EVERY index of the table — including the GIN one it cannot use — and
    //    holds it to end of transaction, which is exactly what starves the
    //    ALTER's 1s window in production.
    const blocker = new PrismaClient({
      datasources: { db: { url: urlForSchema('locktest-blocker') } },
    });
    const holdMs = 12_000;
    let lockHeld: () => void;
    const lockAcquired = new Promise<void>((resolve) => (lockHeld = resolve));
    const blockerDone = blocker
      .$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(
            `SELECT count(*) FROM "${TEST_SCHEMA}"."${TABLE}" WHERE "id" < 0`,
          );
          lockHeld();
          await new Promise((resolve) => setTimeout(resolve, holdMs));
        },
        { timeout: holdMs + 30_000, maxWait: 10_000 },
      )
      .finally(() => blocker.$disconnect());

    // Only start the deploy once the lock is genuinely held, otherwise the ALTER
    // can win before the reader has begun and the test proves nothing.
    await lockAcquired;

    // 3. Deploy the lock-bounded migration while the reader holds its lock.
    writeMigration('20260101000001_bound', BOUND_SQL);
    const deploy = await runMigrateDeploy();
    await blockerDone;

    const output = deploy.output;
    // It must have genuinely lost the race at least once...
    expect(output).toContain('canceling statement due to lock timeout');
    expect(output).toContain(
      'Retrying prisma migrate deploy after bounded native recovery',
    );
    // ...and then won, rather than exhausting the budget.
    expect(deploy.status).toBe(0);
    expect(await readReloptions()).toContain('fastupdate=off');
  }, 240_000);
});
