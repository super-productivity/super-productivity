/**
 * Proves the migration wrapper cancels work in PostgreSQL itself and cleans up
 * a late statement when the whole Prisma process reaches its deadline.
 */
import { PrismaClient } from '@prisma/client';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const DATABASE_URL = process.env.DATABASE_URL;
const describeWithDb = DATABASE_URL ? describe : describe.skip;
const currentDir = dirname(fileURLToPath(import.meta.url));
const packageDir = join(currentDir, '../..');
const migrateScript = join(packageDir, 'scripts/migrate-deploy.sh');

const createAdmin = (): PrismaClient => {
  const url = new URL(DATABASE_URL as string);
  url.searchParams.set('application_name', 'supersync-timeout-test');
  return new PrismaClient({ datasources: { db: { url: url.toString() } } });
};

const runPrismaSql = (sql: string, stepTimeout: number, timeout: number) => {
  const url = new URL(DATABASE_URL as string);
  url.searchParams.append('options', '-c statement_timeout=60000');
  url.searchParams.append('application_name', 'must-not-win');
  const startedAt = Date.now();
  const result = spawnSync(
    'sh',
    [
      migrateScript,
      '--prisma',
      'db',
      'execute',
      '--schema',
      'prisma/schema.prisma',
      '--stdin',
    ],
    {
      cwd: packageDir,
      encoding: 'utf8',
      input: sql,
      timeout,
      env: {
        ...process.env,
        DATABASE_URL: url.toString(),
        MIGRATE_STEP_TIMEOUT: String(stepTimeout),
      },
    },
  );
  return { elapsedMs: Date.now() - startedAt, result };
};

const countActiveTestBackends = async (
  admin: PrismaClient,
  marker: string,
): Promise<number> => {
  const [activity] = await admin.$queryRawUnsafe<Array<{ count: number }>>(
    `SELECT count(*)::integer AS count
       FROM pg_stat_activity
      WHERE application_name LIKE 'supersync-migrator%'
        AND state = 'active'
        AND query LIKE $1`,
    `%${marker}%`,
  );
  return activity.count;
};

const terminateTestBackends = async (
  admin: PrismaClient,
  marker: string,
): Promise<void> => {
  await admin.$queryRawUnsafe(
    `SELECT pg_terminate_backend(pid)
       FROM pg_stat_activity
      WHERE application_name LIKE 'supersync-migrator%'
        AND pid <> pg_backend_pid()
        AND query LIKE $1`,
    `%${marker}%`,
  );
};

describeWithDb('migrate-deploy.sh PostgreSQL timeout', () => {
  it('overrides an existing cap and cancels a long statement on the server', async () => {
    const marker = 'supersync_statement_timeout_test';
    const admin = createAdmin();
    const { elapsedMs, result } = runPrismaSql(
      `/* ${marker} */ SELECT pg_sleep(60);\n`,
      7,
      5_000,
    );

    let lingeringBackends = -1;
    try {
      lingeringBackends = await countActiveTestBackends(admin, marker);
    } finally {
      await terminateTestBackends(admin, marker);
      await admin.$disconnect();
    }

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toContain(
      'canceling statement due to statement timeout',
    );
    expect(elapsedMs).toBeLessThan(5_000);
    expect(lingeringBackends).toBe(0);
  }, 10_000);

  it('terminates a late statement when earlier work consumes the client budget', async () => {
    const marker = 'supersync_cumulative_timeout_test';
    const admin = createAdmin();
    const { elapsedMs, result } = runPrismaSql(
      `/* ${marker} */
SELECT pg_sleep(3);
SELECT pg_sleep(3);
SELECT pg_sleep(60);\n`,
      10,
      15_000,
    );

    let lingeringBackends = -1;
    try {
      lingeringBackends = await countActiveTestBackends(admin, marker);
    } finally {
      await terminateTestBackends(admin, marker);
      await admin.$disconnect();
    }

    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      'canceling statement due to statement timeout',
    );
    expect(elapsedMs).toBeGreaterThanOrEqual(9_000);
    expect(elapsedMs).toBeLessThan(15_000);
    expect(lingeringBackends).toBe(0);
  }, 20_000);
});
