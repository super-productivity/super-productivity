/**
 * Proves the lock-bounded retry path end-to-end against a REAL PostgreSQL lock
 * timeout: a real concurrent reader starves the ALTER's lock window, Prisma
 * really fails with 55P03, and migrate-deploy.sh's shape gate really recognizes
 * it and really retries until it wins.
 *
 * The sibling unit spec drives a FAKE `npx prisma` emitting a canned error, so
 * nothing else in the repo proves that the script's log anchors
 * (`^Database error code: 55P03$`, `^ERROR: canceling statement due to lock
 * timeout$`) match what Prisma actually prints — if they drifted, the whole
 * retry path would be dead in production with every unit test still green. Nor
 * does anything else prove a plain seq-scan reader can starve the ALTER.
 *
 * It does NOT supersede the unit spec: that one reads the real committed
 * migration.sql, whereas the shape here is written inline.
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

const urlForSchema = (): string => {
  const url = new URL(DATABASE_URL as string);
  url.searchParams.set('schema', TEST_SCHEMA);
  return url.toString();
};

const withAdmin = async <T>(fn: (admin: PrismaClient) => Promise<T>): Promise<T> => {
  const admin = new PrismaClient({ datasources: { db: { url: urlForSchema() } } });
  try {
    return await fn(admin);
  } finally {
    await admin.$disconnect();
  }
};

const dropTestSchema = (): Promise<unknown> =>
  withAdmin((admin) =>
    admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA}" CASCADE`),
  );

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

const LOCK_TIMEOUT_MARKER = 'canceling statement due to lock timeout';

// Must be async: the blocking reader below holds its lock on this process's
// event loop, so a spawnSync here would freeze the blocker and prevent it ever
// releasing — the migration would then exhaust its whole budget.
//
// `onLockTimeout` fires as soon as the script reports its first real 55P03 (it
// `cat`s the migrate log immediately after each failed attempt). Releasing the
// blocker on that observation rather than on a timer makes contention
// guaranteed at any runner speed, instead of racing a wall clock.
const runMigrateDeploy = (onLockTimeout?: () => void): Promise<DeployResult> =>
  new Promise((resolve, reject) => {
    const child = spawn('sh', [migrateScript], {
      cwd: projectDir,
      env: {
        ...process.env,
        DATABASE_URL: urlForSchema(),
        MIGRATE_STEP_TIMEOUT: '60',
      },
    });
    let output = '';
    let signalled = false;
    const collect = (chunk: Buffer): void => {
      output += chunk.toString();
      if (!signalled && output.includes(LOCK_TIMEOUT_MARKER)) {
        signalled = true;
        onLockTimeout?.();
      }
    };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', reject);
    child.on('close', (status: number | null) => resolve({ status, output }));
  });

const readReloptions = (): Promise<string[] | null> =>
  withAdmin(async (admin) => {
    const rows = await admin.$queryRawUnsafe<Array<{ reloptions: string[] | null }>>(
      `SELECT c.reloptions
         FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relname = $1 AND n.nspname = $2`,
      INDEX,
      TEST_SCHEMA,
    );
    return rows[0]?.reloptions ?? null;
  });

describeWithDb('migrate-deploy.sh lock-bounded retry (real PostgreSQL)', () => {
  beforeAll(async () => {
    // A killed run (job timeout, worker crash) leaves the schema behind, and a
    // leftover `_prisma_migrations` would make the next seed a no-op and fail
    // confusingly. Drop first, don't only drop after.
    await dropTestSchema();
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
  }, 60_000);

  afterAll(async () => {
    // Drop the schema even if removing the fixture dir throws, and even if
    // beforeAll died before projectDir was assigned.
    try {
      if (projectDir) {
        rmSync(projectDir, { recursive: true, force: true });
      }
    } finally {
      await dropTestSchema();
    }
  }, 60_000);

  it('retries through a real 55P03 lock timeout and applies the migration', async () => {
    // 1. Seed the table + index with no contention.
    writeMigration('20260101000000_seed', SEED_SQL);
    const seed = await runMigrateDeploy();
    expect(seed.status, seed.output).toBe(0);
    expect(await readReloptions()).toBeNull();

    // 2. Hold a plain seq-scan reader open. The planner takes AccessShareLock on
    //    EVERY index of the table — including the GIN one it cannot use — and
    //    holds it to end of transaction, which is exactly what starves the
    //    ALTER's 1s window in production.
    const blocker = new PrismaClient({
      datasources: { db: { url: urlForSchema() } },
    });
    const maxHoldMs = 120_000;
    let lockHeld: () => void;
    let releaseBlocker: () => void;
    const lockAcquired = new Promise<void>((resolve) => (lockHeld = resolve));
    const blockerReleased = new Promise<void>((resolve) => (releaseBlocker = resolve));
    const blockerDone = blocker
      .$transaction(
        async (tx) => {
          await tx.$queryRawUnsafe(
            `SELECT count(*) FROM "${TEST_SCHEMA}"."${TABLE}" WHERE "id" < 0`,
          );
          lockHeld();
          // Released on the first observed lock timeout; the timer is only a
          // backstop so a broken run cannot hang the suite.
          await Promise.race([
            blockerReleased,
            new Promise((resolve) => setTimeout(resolve, maxHoldMs)),
          ]);
        },
        { timeout: maxHoldMs + 30_000, maxWait: 10_000 },
      )
      .finally(() => blocker.$disconnect());

    // Only start the deploy once the lock is genuinely held, otherwise the ALTER
    // can win before the reader has begun and the test proves nothing.
    await lockAcquired;

    // 3. Deploy the lock-bounded migration while the reader holds its lock. The
    //    blocker steps aside the moment the first attempt genuinely times out,
    //    so contention is guaranteed and the retry wins regardless of how fast
    //    or slow the runner is.
    writeMigration('20260101000001_bound', BOUND_SQL);
    const deploy = await runMigrateDeploy(() => releaseBlocker());
    await blockerDone;

    const output = deploy.output;
    // It must have genuinely lost the race at least once...
    expect(output).toContain(LOCK_TIMEOUT_MARKER);
    const retries = output.match(
      /Retrying prisma migrate deploy after bounded native recovery/g,
    );
    expect(retries?.length ?? 0, output).toBeGreaterThan(0);
    // ...but nowhere near exhausting the budget — otherwise this would pass just
    // as green while sitting one hiccup away from the cliff.
    expect(retries?.length ?? 0, output).toBeLessThan(5);
    // ...and then won.
    expect(deploy.status, output).toBe(0);
    expect(await readReloptions()).toContain('fastupdate=off');
  }, 240_000);
});
